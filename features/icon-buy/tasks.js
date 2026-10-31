// Đọc menu /stop của bot và dừng đúng task mua ICON do phiên hiện tại tạo ra.
//
// Bot "Chèn Member Thường -> Mua cầu thủ" không trả task id trong log; nó chỉ
// tạo một dòng "THƯỜNG • MUA | <mã> +<grade> x<qty> #<taskId>" trong menu /stop.
// Vì vậy trước khi đặt mua phải chụp baseline các task đang chạy, rồi khi phiên
// hết hạn / bị dừng / gặp lỗi chỉ bấm đúng task mới khớp mã + grade + quantity.
// Tuyệt đối không bấm "Dừng tất cả" và không đụng task có trong baseline.
const { chatTextReaders } = require("../../lib/chat-runtime");
const { STOP_NO_RUNNING_RE } = require("../../lib/bot-patterns");
const { config } = require("../config");
const {
  getVisibleMessageIds,
  readNewChatMessages,
  messagesToText
} = require("./chat-messages");
const { sendSingleLineMessage } = require("./menu");
const { log } = require("../agent-log");

const TASK_BUTTON_RE =
  /•\s*(MUA|BÁN)\s*\|\s*(\d{9})\s*\+(\d+)\s*x\s*(\d+)\s*#(\d+)\s*$/i;
const STOP_MENU_RE = /Chọn luồng cần dừng|Không có luồng nào đang chạy/i;
// E003 (hoặc các câu tương đương) là phản hồi hợp lệ của /stop khi bot không
// có task nào đang chạy. Đây là baseline rỗng, không phải lỗi đọc menu.
const NO_RUNNING_TASKS_RE = new RegExp(
  `\\bE003\\b|${STOP_NO_RUNNING_RE.source}|Không có lệnh nào đang chạy`,
  "i"
);
const STOP_CONFIRMED_RE = /Đã dừng\s+\d+\s+luồng thành công/i;
const CONFIRM_TIMEOUT_MS = 12_000;
const BUTTONS_TIMEOUT_MS = 5_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    const taskId = String(task.taskId || "");
    if (taskId && seen.has(taskId)) continue;
    if (taskId) seen.add(taskId);
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

// Gửi /stop và đọc menu mới nhất. Trả về:
//   { messageId, texts, tasks }  khi thấy menu
//   null                         khi bot không trả menu kịp
// Không bấm nút nào.
async function readStopMenu(page, rl) {
  const reader = chatTextReaders.get(page);
  if (!reader) throw new Error("Chưa khởi tạo theo dõi nội dung Telegram.");
  const baselineIds = await getVisibleMessageIds(page).catch(() => null);
  if (!baselineIds) return null;

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
      do {
        texts = await readButtonsInMessage(page, menuMessage.id);
        if (texts.length) break;
        if (/Không có luồng nào đang chạy/i.test(String(menuMessage.text || ""))) break;
        await sleep(300);
      } while (Date.now() < buttonsDeadline);
      const tasks = parseStopTaskButtons(texts);
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
// taskIds (Set) và tasks (mảng task) để caller tính số luồng/slot đang bận.
// null = không đọc được menu (khi đó caller tuyệt đối không tự dừng task nào).
async function captureStopTaskBaseline(page, rl) {
  const menu = await readStopMenu(page, rl);
  if (!menu) return null;
  const taskIds = new Set(menu.tasks.map((task) => task.taskId));
  if (!menu.tasks.length) {
    log("Baseline /stop: 0 task đang chạy (bot báo không có lệnh nào đang chạy).");
    return { taskIds, tasks: [], empty: true };
  }
  log(
    `Baseline /stop: ${menu.tasks.length} task đang chạy ` +
      `(${menu.tasks.map((task) => `#${task.taskId}`).join(", ")}).`
  );
  return { taskIds, tasks: menu.tasks, empty: false };
}

// Tìm task MUA mới (không có trong baseline) khớp đúng mã + grade + quantity.
function findNewPurchaseTasks(tasks, baselineIds, players, grade, quantity) {
  if (!baselineIds) return [];
  const codes = new Set(players.map((player) => String(player.code)));
  const wantGrade = Number(grade);
  const wantQuantity = Number(quantity);
  const seen = new Set();
  return (tasks || [])
    .filter((task) => {
      if (task.kind !== "MUA") return false;
      if (!codes.has(String(task.code))) return false;
      if (task.grade !== wantGrade || task.quantity !== wantQuantity) return false;
      if (baselineIds.has(task.taskId)) return false;
      if (seen.has(task.taskId)) return false;
      seen.add(task.taskId);
      return true;
    })
    .sort((a, b) => Number(a.taskId) - Number(b.taskId));
}

async function waitForStopConfirmation(page, baselineIds, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await readNewChatMessages(page, baselineIds).catch(() => []);
    if (messages.some((message) => STOP_CONFIRMED_RE.test(String(message.text || "")))) {
      return true;
    }
    await sleep(500);
  }
  return false;
}

// Bấm nút của đúng task, trong menu mới nhất. Không dùng "Dừng tất cả".
async function stopOneTask(page, menu, task) {
  const bubble = page.locator(`.bubble[data-mid="${menu.messageId}"]`).last();
  let button = bubble
    .locator(".reply-markup-button")
    .filter({ hasText: `#${task.taskId}` })
    .filter({ hasText: /MUA/i })
    .last();
  if (!(await button.count().catch(() => 0))) {
    // Một số bản Telegram tách reply-markup khỏi bubble text; fallback về nút
    // cuối cùng khớp task id trong toàn trang.
    button = page
      .locator(".reply-markup-button")
      .filter({ hasText: `#${task.taskId}` })
      .filter({ hasText: /MUA/i })
      .last();
  }
  const count = await button.count().catch(() => 0);
  if (!count) return { ok: false, message: "không còn nút task trong menu" };
  log(`Bấm nút dừng cho task #${task.taskId} trong menu ${menu.messageId}.`);
  const beforeIds = await getVisibleMessageIds(page).catch(() => null);
  try {
    await button.click({ timeout: 15_000 });
  } catch (error) {
    return { ok: false, message: `không bấm được nút task: ${error.message}` };
  }
  const confirmed = beforeIds
    ? await waitForStopConfirmation(page, beforeIds, CONFIRM_TIMEOUT_MS)
    : true;
  return confirmed
    ? { ok: true, message: "bot xác nhận đã dừng" }
    : { ok: false, message: "không thấy xác nhận dừng" };
}

// Dừng các task MUA mới do phiên ICON tạo. Trả về danh sách task đã dừng/lỗi.
async function stopNewIconTasks(page, rl, baselineIds, players, { grade, quantity } = {}) {
  const result = { stopped: [], failed: [], menuUnread: false };
  if (!baselineIds) {
    log(
      "Không có baseline /stop; không tự dừng task ICON để tránh đụng worker khác. " +
        "Kiểm tra menu /stop nếu phiên không đặt được đơn."
    );
    return result;
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const menu = await readStopMenu(page, rl);
    if (!menu) {
      // Không đọc được menu thì chưa thể kết luận đã dọn sạch. Thử lại một
      // lần; nếu vẫn thất bại, caller phải coi đây là lỗi cleanup để người
      // dùng kiểm tra /stop thay vì báo phiên đã kết thúc sạch.
      result.menuUnread = true;
      continue;
    }
    result.menuUnread = false;
    const targets = findNewPurchaseTasks(
      menu.tasks,
      baselineIds,
      players,
      grade,
      quantity
    );
    if (!targets.length) {
      // Menu mới không còn task đã thử dừng: coi như đã dừng dù lần trước
      // không kịp thấy tin xác nhận (Telegram có thể bỏ qua tin dịch vụ).
      const runningIds = new Set(menu.tasks.map((task) => task.taskId));
      const stillFailed = [];
      for (const failed of result.failed) {
        if (runningIds.has(failed.taskId)) {
          stillFailed.push(failed);
        } else {
          result.stopped.push(failed);
          log(`Task ICON #${failed.taskId} không còn trong menu /stop; coi như đã dừng.`);
        }
      }
      result.failed = stillFailed;
      if (result.stopped.length || attempt > 1) {
        log("Không còn task ICON mới trong menu /stop; đã dọn xong.");
      }
      return result;
    }

    // Lần thử lại chỉ giữ kết quả mới nhất cho từng task, không nhân đôi lỗi.
    result.failed = result.failed.filter(
      (failed) => !targets.some((task) => task.taskId === failed.taskId)
    );
    for (const task of targets) {
      log(`Đang dừng riêng task ICON ${task.code} +${task.grade} x${task.quantity} #${task.taskId}.`);
      const stopped = await stopOneTask(page, menu, task);
      if (stopped.ok) {
        result.stopped.push(task);
        baselineIds.add(task.taskId);
        log(`Đã dừng task ICON #${task.taskId} (${stopped.message}).`);
      } else {
        result.failed.push({ ...task, message: stopped.message });
        log(`Chưa dừng được task ICON #${task.taskId}: ${stopped.message}.`);
      }
    }
  }
  return result;
}

module.exports = {
  parseStopTaskButton,
  parseStopTaskButtons,
  readStopMenu,
  captureStopTaskBaseline,
  findNewPurchaseTasks,
  stopNewIconTasks,
  countRunningTaskSlots,
  getAvailableTaskSlots,
  isNoRunningTasksReply
};
