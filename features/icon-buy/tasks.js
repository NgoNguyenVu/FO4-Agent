// Đọc menu /stop của bot để đếm task mua ICON đang chạy.
//
// Bot "Chèn Member Thường -> Mua cầu thủ" không trả task id trong log; nó chỉ
// tạo một dòng "THƯỜNG • MUA | <mã> +<grade> x<qty> #<taskId>" trong menu /stop.
// Vì vậy trước khi đặt mua phải chụp baseline các task đang chạy. Module này
// chỉ đọc menu; tuyệt đối không bấm nút dừng hoặc hủy nào.
const { chatTextReaders } = require("../../lib/chat-runtime");
const { STOP_NO_RUNNING_RE } = require("../../lib/bot-patterns");
const { config } = require("../config");
const {
  getVisibleMessageIds,
  readNewChatMessages,
  messagesToText
} = require("./chat-messages");
const { sendSingleLineMessage } = require("./menu");
const { ensureMessageComposer } = require("../composer");
const { log } = require("../agent-log");

const TASK_BUTTON_RE =
  /•\s*(MUA|BÁN)\s*\|\s*(\d{9})\s*\+(\d+)\s*x\s*(\d+)\s*#(\d+)/i;
const STOP_MENU_RE = /Chọn luồng cần dừng|Không có luồng nào đang chạy/i;
// E003 (hoặc các câu tương đương) là phản hồi hợp lệ của /stop khi bot không
// có task nào đang chạy. Đây là baseline rỗng, không phải lỗi đọc menu.
const NO_RUNNING_TASKS_RE = new RegExp(
  `\\bE003\\b|${STOP_NO_RUNNING_RE.source}|Không có lệnh nào đang chạy`,
  "i"
);
const BUTTONS_TIMEOUT_MS = 5_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTaskIdentity(task) {
  return [
    String(task?.kind || "").toUpperCase(),
    String(task?.code || ""),
    String(task?.grade ?? ""),
    String(task?.quantity ?? ""),
    String(task?.taskId || "")
  ].join(":");
}

// Đếm số task MUA đang chạy trong danh sách /stop. Task có thể là task thủ
// công của người dùng hoặc task do Auto Mua/Auto Nâng do agent quản lý; đều
// dùng chung một bộ bong bóng để tính số luồng/slot đang bận.
function countRunningTaskSlots(tasks, kind = "MUA") {
  const normalizedKind = String(kind || "MUA").toUpperCase();
  const seen = new Set();
  const running = [];
  for (const task of tasks || []) {
    const taskKind = String(task?.kind || "").toUpperCase();
    if (taskKind !== normalizedKind) continue;
    const identity = getTaskIdentity(task);
    if (seen.has(identity)) continue;
    seen.add(identity);
    running.push(task);
  }
  return running.length;
}

// Số slot mua còn trống theo giới hạn của bot. Task thủ công hoặc task của
// worker khác đang chạy cũng chiếm slot, nên chỉ mua bù phần còn thiếu.
function getAvailableTaskSlots(tasks, maxTaskSlots, kind = "MUA") {
  const limit = Number(maxTaskSlots);
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  return Math.max(0, limit - countRunningTaskSlots(tasks, kind));
}

function isNoRunningTasksReply(text) {
  return NO_RUNNING_TASKS_RE.test(String(text || ""));
}

// "THƯỜNG • MUA | 101214101 +1 x1 #8849" -> object; null nếu không phải task.
function parseStopTaskButton(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  const match = normalized.match(TASK_BUTTON_RE);
  if (!match) return null;
  return {
    kind: match[1].toUpperCase(),
    code: match[2],
    grade: Number(match[3]),
    quantity: Number(match[4]),
    taskId: match[5],
    text: normalized
  };
}

function parseStopTaskButtons(texts) {
  return (texts || [])
    .map(parseStopTaskButton)
    .filter(Boolean);
}

async function readButtonsInMessage(page, messageId) {
  const bubble = page.locator(`.bubble[data-mid="${messageId}"]`).last();
  if (!(await bubble.count().catch(() => 0))) return [];
  return bubble
    .locator(".reply-markup-button")
    .evaluateAll((buttons) =>
      buttons.map((button) => String(button.innerText || "").replace(/\s+/g, " ").trim())
    )
    .catch(() => []);
}

async function readButtonsInMessages(page, messages) {
  const texts = [];
  for (const message of messages || []) {
    texts.push(...(await readButtonsInMessage(page, message.id)));
  }
  return texts;
}

// Gửi /stop và đọc menu mới nhất. Trả về:
//   { messageId, texts, tasks }  khi thấy menu
//   null                         khi bot không trả menu kịp
// Không bấm nút nào.
async function readStopMenu(page, rl) {
  const reader = chatTextReaders.get(page);
  if (!reader) throw new Error("Chưa khởi tạo theo dõi nội dung Telegram.");
  // Mở lại chat bot TRƯỚC khi chụp mốc. Trước đây lấy baseline id trước nên khi
  // Telegram kẹt ở màn hình "Chats" (không còn bubble), hàm trả null ngay mà
  // không hề gửi /stop và lặp lại hàng giờ (log 01:48-03:43). ensureMessageComposer
  // sẽ mở lại chat và có nhánh tải lại cứng trang nếu cần.
  await ensureMessageComposer(page, rl);
  const baselineIds = await getVisibleMessageIds(page).catch(() => null);
  if (!baselineIds) {
    log(
      "Không đọc được nội dung chat (chat bot chưa mở hoặc trang chưa render); " +
        "bỏ qua lần đọc /stop này, không gửi lệnh."
    );
    return null;
  }

  await sendSingleLineMessage(page, rl, "/stop");
  log(`Đã gửi /stop để chụp baseline task; chờ menu trong ${config.iconBuy.menuTimeoutSeconds}s.`);
  // Menu /stop được phục vụ theo cùng cấu hình menuResponseTimeoutSeconds của
  // bot; chỉ chờ trong khoảng đó rồi coi là không đọc được (fail-closed).
  const deadline = Date.now() + config.iconBuy.menuTimeoutSeconds * 1_000;
  let lastNewTexts = [];
  let newMessagesRead = 0;
  while (Date.now() < deadline) {
    const messages = await readNewChatMessages(page, baselineIds).catch(() => []);
    newMessagesRead += 1;
    lastNewTexts = messages.map((message) => message.text).filter(Boolean);
    const menuMessage = [...messages]
      .reverse()
      .find(
        (message) =>
          STOP_MENU_RE.test(String(message.text || "")) ||
          isNoRunningTasksReply(message.text)
      );
    if (menuMessage) {
      // E003 / "Hiện không có lệnh nào đang chạy" là baseline rỗng hợp lệ:
      // bot xác nhận không có task nào đang chạy, không phải menu lỗi.
      if (isNoRunningTasksReply(menuMessage.text)) {
        log("Bot báo không có lệnh nào đang chạy; baseline task rỗng (0 slot đang dùng).");
        return {
          messageId: menuMessage.id,
          texts: [],
          tasks: [],
          empty: true
        };
      }
      // Text và reply-markup có thể render lệch nhau vài nhịp.
      const buttonsDeadline = Date.now() + BUTTONS_TIMEOUT_MS;
      let texts = [];
      let latestMessages = messages;
      let tasks = [];
      do {
        latestMessages = await readNewChatMessages(page, baselineIds).catch(() => messages);
        texts = await readButtonsInMessages(page, latestMessages);
        const taskTexts = [
          ...texts,
          ...latestMessages.flatMap((message) =>
            String(message.text || "").split(/\r?\n/)
          )
        ];
        tasks = parseStopTaskButtons(taskTexts).filter(
          (task, index, all) =>
            all.findIndex(
              (candidate) =>
                candidate.kind === task.kind &&
                candidate.code === task.code &&
                candidate.grade === task.grade &&
                candidate.quantity === task.quantity &&
                candidate.taskId === task.taskId
            ) === index
        );
        if (tasks.length) break;
        if (/Không có luồng nào đang chạy/i.test(String(menuMessage.text || ""))) break;
        await sleep(300);
      } while (Date.now() < buttonsDeadline);
      if (!tasks.length) {
        log("Menu /stop không có task MUA/BÁN nào; baseline task rỗng.");
        return {
          messageId: menuMessage.id,
          texts,
          tasks: [],
          empty: true
        };
      }
      // Menu vừa hiện chưa chắc đã gắn callback; chờ một nhịp ngắn trước khi
      // caller bấm nút. Bấm quá sớm từng bị Telegram bỏ qua mà không báo lỗi.
      await sleep(2_500);
      return { messageId: menuMessage.id, texts, tasks };
    }
    await sleep(500);
  }
  log("Không đọc được menu /stop trong thời gian chờ; bỏ qua bước đối chiếu task.");
  log(
    `Đã đọc ${newMessagesRead} lần, nội dung mới gần nhất: ` +
      `${messagesToText(lastNewTexts) || "(không có tin nhắn mới nào)"}`
  );
  return null;
}

// Chụp danh sách task đang chạy trước khi đặt mua. Trả về snapshot gồm
// taskIds (Set), taskKeys (Set) và tasks (mảng task) để caller tính số
// luồng/slot đang bận. taskId hiển thị có thể bị trùng giữa các dòng.
// null = không đọc được menu (khi đó caller tuyệt đối không tự dừng task nào).
async function captureStopTaskBaseline(page, rl) {
  const menu = await readStopMenu(page, rl);
  if (!menu) return null;
  const taskIds = new Set(menu.tasks.map((task) => task.taskId));
  const taskKeys = new Set(menu.tasks.map(getTaskIdentity));
  if (!menu.tasks.length) {
    log("Baseline /stop: 0 task đang chạy (bot báo không có lệnh nào đang chạy).");
    return { taskIds, taskKeys, tasks: [], empty: true };
  }
  log(
    `Baseline /stop: ${menu.tasks.length} task đang chạy ` +
      `(${menu.tasks.map((task) => `#${task.taskId}`).join(", ")}).`
  );
  return { taskIds, taskKeys, tasks: menu.tasks, empty: false };
}

// Tìm task MUA mới (không có trong baseline) khớp đúng mã + grade + quantity.
function findNewPurchaseTasks(tasks, baselineIds, players, grade, quantity) {
  if (!baselineIds) return [];
  const baselineKeys = baselineIds.taskKeys || baselineIds;
  const legacyBaselineIds = baselineIds.taskKeys ? null : baselineIds;
  const codes = new Set(players.map((player) => String(player.code)));
  const wantGrade = Number(grade);
  const wantQuantity = Number(quantity);
  const seen = new Set();
  return (tasks || [])
    .filter((task) => {
      if (task.kind !== "MUA") return false;
      if (!codes.has(String(task.code))) return false;
      if (task.grade !== wantGrade || task.quantity !== wantQuantity) return false;
      if (
        baselineKeys.has(getTaskIdentity(task)) ||
        (legacyBaselineIds && legacyBaselineIds.has(task.taskId))
      ) return false;
      const taskKey = getTaskIdentity(task);
      if (seen.has(taskKey)) return false;
      seen.add(taskKey);
      return true;
    })
    .sort((a, b) => Number(a.taskId) - Number(b.taskId));
}

module.exports = {
  parseStopTaskButton,
  parseStopTaskButtons,
  readStopMenu,
  captureStopTaskBaseline,
  findNewPurchaseTasks,
  countRunningTaskSlots,
  getAvailableTaskSlots,
  isNoRunningTasksReply
};
