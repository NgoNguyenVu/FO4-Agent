// Các thao tác Telegram dùng riêng cho luồng ICON:
// - tìm nút theo nhãn trong menu gần nhất
// - tự xin /tn khi menu không còn / bị token cũ
// - gửi tin nhắn nhiều dòng theo đúng định dạng bot yêu cầu
//
// Module này không gọi /stop và không đụng worker Auto Mua/Auto Nâng.
const { withTimeout } = require("../../lib/playwright-utils");
const { chatTextReaders, waitForChatChange } = require("../../lib/chat-runtime");
const { scrollChatToBottom } = require("../../lib/chat-scroll");
const { getFreshSince } = require("../../lib/text-utils");
const {
  BOT_COMMAND_DELAY_MS,
  PLAYWRIGHT_TIMEOUT_MS
} = require("../../lib/bot-patterns");
const { config } = require("../config");
const { log } = require("../agent-log");
const { ensureMessageComposer } = require("../composer");
const { sendBotCommand, sendTnCommand } = require("../telegram-io");
const { markIconActivity } = require("../../lib/icon-activity");
const {
  hasIconMenuSignature,
  getLatestBotError,
  parseRetryAfterSeconds
} = require("./patterns");

const STALE_TOKEN_RE = /E002|Token không hợp lệ|token không hợp lệ/i;
const RATE_LIMIT_RE = /thao tác quá nhanh|chờ\s*\d+\s*s\s*rồi thử lại/i;
// Bot đôi khi không trả lời /tn (đã gặp: /stop trả lời bình thường nhưng /tn
// im lặng). Sau khoảng này, dùng lại nút menu cũ còn hiển thị thay vì chờ hết
// menuTimeoutSeconds rồi báo lỗi — nút cũ vẫn mở được mini-app TTCN.
const MENU_FALLBACK_MS = 15_000;

function makeFlowError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function findButtonByText(page, label) {
  const selectors = [
    page.getByRole("button", { name: label, exact: true }),
    page.locator(".reply-markup-button").filter({ hasText: label })
  ];
  for (const buttons of selectors) {
    const count = await withTimeout(buttons.count(), 5_000, `đếm nút ${label}`);
    for (let i = count - 1; i >= 0; i -= 1) {
      const button = buttons.nth(i);
      if (await button.isVisible().catch(() => false)) return button;
    }
  }
  return null;
}

async function waitForButtonByText(page, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await scrollChatToBottom(page).catch(() => {});
    const button = await findButtonByText(page, label);
    if (button) return button;
    await page.waitForTimeout(500);
  }
  return null;
}

// Tìm nút gần nhất trong chat; nếu không có thì gửi /tn đúng một lần và chờ
// menu mới. Với `refresh`, bỏ qua nút cũ đang còn trong lịch sử và chỉ nhận nút
// sau khi bot thật sự trả menu mới (tránh bấm lại đúng callback đã hết token).
// `allowTn=false` dùng cho lượt dò TTCN phụ: chỉ bấm nút cũ nếu còn, tuyệt đối
// không gửi /tn trong lúc bot đang xử lý đơn.
async function ensureFeatureButton(
  page,
  rl,
  label,
  { refresh = false, allowTn = true } = {}
) {
  const reader = chatTextReaders.get(page);
  if (!reader) throw new Error("Chưa khởi tạo theo dõi nội dung Telegram.");

  await scrollChatToBottom(page).catch(() => {});
  const existingButton = await findButtonByText(page, label);
  if (!refresh && existingButton) return existingButton;
  if (!allowTn) {
    throw makeFlowError(
      `Không còn nút "${label}" hiển thị; không gửi /tn trong lúc chờ đơn ICON.`,
      "MENU_BUSY"
    );
  }

  const normalizedLabel = String(label).toLocaleLowerCase();
  const deadline = Date.now() + config.iconBuy.menuTimeoutSeconds * 1_000;
  const fallbackAt = Date.now() + MENU_FALLBACK_MS;
  // Mỗi lượt chỉ gửi /tn đúng một lần. Trước đây vòng lặp ở đây cộng với vòng
  // lặp của openAutoBuyFrame khiến một lần đọc TTCN gửi 2 /tn liên tiếp, mỗi
  // lần chờ 45s: vừa khóa UI, vừa dễ làm bot rate-limit/E006. Thất bại thì
  // nhường cho backoff bên ngoài, không gửi dồn trong cùng một lượt.
  const baseline = reader.snapshot();
  const composer = await ensureMessageComposer(page, rl);
  markIconActivity();
  await sendTnCommand(page, composer);
  log(`Đã gửi /tn để lấy menu cho nút "${label}".`);

  let menuSeen = !refresh;
  while (Date.now() < deadline) {
    if (!menuSeen) {
      const update = await waitForChatChange(
        page,
        reader,
        reader.snapshot().version,
        1_000
      );
      if (update) {
        const fresh = getFreshSince(baseline.text, update.text) || "";
        const botError = getLatestBotError(fresh);
        if (/E006/i.test(botError || "")) {
          throw makeFlowError(`Bot trả E006 khi lấy menu "${label}".`, "BOT_SYSTEM_ERROR");
        }
        if (RATE_LIMIT_RE.test(fresh)) {
          const delay = parseRetryAfterSeconds(fresh) * 1_000 + 500;
          log(`Bot giới hạn thao tác khi lấy menu "${label}"; chờ ${delay / 1_000}s.`);
          await page.waitForTimeout(delay);
          break;
        }
        if (fresh.toLocaleLowerCase().includes(normalizedLabel)) {
          menuSeen = true;
          // Chờ Telegram render xong reply markup của tin menu mới.
          await page.waitForTimeout(300);
        }
      }
      if (!menuSeen && existingButton && Date.now() >= fallbackAt) {
        // /tn không được trả lời: dùng lại nút cũ thay vì treo 45s rồi báo lỗi.
        if (await existingButton.isVisible().catch(() => false)) {
          log(
            `Bot chưa trả menu mới cho "${label}" sau ` +
              `${Math.round(MENU_FALLBACK_MS / 1_000)}s; dùng lại nút cũ đang hiển thị.`
          );
          return existingButton;
        }
      }
      if (!menuSeen) continue;
    }

    const button = await findButtonByText(page, label);
    if (button) return button;
    await page.waitForTimeout(300);
  }

  throw makeFlowError(
    `Bot chưa trả menu có nút "${label}" trong ${config.iconBuy.menuTimeoutSeconds}s.`,
    "MENU_BUSY"
  );
}

// Bấm nút chức năng. Nếu callback token đã cũ (E002) thì xin menu mới rồi bấm
// lại; nếu bot báo thao tác nhanh thì chờ đúng thời gian bot yêu cầu.
// `button` cho phép caller truyền locator đã tìm được để không gọi
// ensureFeatureButton lần hai (tránh gửi thêm /tn khi menu vẫn còn).
async function clickFeatureButton(
  page,
  rl,
  label,
  { retries = 2, refresh = false, button = null, allowTn = true } = {}
) {
  const reader = chatTextReaders.get(page);
  if (!reader) throw new Error("Chưa khởi tạo theo dõi nội dung Telegram.");

  // Chỉ xin menu mới khi cần: lượt đầu theo `refresh` của caller, các lượt sau
  // chỉ refresh nếu gặp E002. Tránh mỗi lần bấm lỗi lại gửi thêm một /tn.
  let forceRefresh = refresh;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    // Luôn lấy locator từ menu gần nhất ngay trước khi bấm; locator truyền từ
    // caller có thể trỏ vào callback cũ sau khi Telegram render lại chat.
    const target =
      button && attempt === 0
        ? button
        : await ensureFeatureButton(page, rl, label, {
            refresh: attempt === 0 ? refresh : forceRefresh,
            allowTn
          });
    forceRefresh = false;
    const baseline = reader.snapshot();
    try {
      markIconActivity();
      await withTimeout(target.click(), 30_000, `bấm nút ${label}`);
    } catch (error) {
      if (attempt >= retries) throw error;
      log(`Nút "${label}" không bấm được (${error.message}); tìm lại nút.`);
      continue;
    }

    await page.waitForTimeout(2_200);
    const fresh = getFreshSince(baseline.text, reader.snapshot().text) || "";
    if (STALE_TOKEN_RE.test(fresh)) {
      log(`Menu "${label}" đã hết token (E002); gửi /tn lấy menu mới rồi thử lại.`);
      forceRefresh = true;
      continue;
    }
    if (RATE_LIMIT_RE.test(fresh)) {
      const delay = parseRetryAfterSeconds(fresh) * 1_000 + 500;
      log(`Bot giới hạn thao tác sau khi bấm "${label}"; chờ ${delay / 1_000}s.`);
      await page.waitForTimeout(delay);
      await waitForButtonByText(page, label, 10_000);
      continue;
    }
    if (/E006/i.test(getLatestBotError(fresh) || "")) {
      throw makeFlowError(`Bot trả E006 sau khi bấm "${label}".`, "BOT_SYSTEM_ERROR");
    }
    return;
  }
  throw makeFlowError(`Không bấm được nút "${label}" sau ${retries + 1} lần.`, "ICON_UI_STALE");
}

// Gửi danh sách nhiều dòng đúng như prompt của bot. Dùng Shift+Enter để giữ
// newline trong composer Telegram, tránh gửi mỗi dòng thành một tin riêng.
async function sendMultilineMessage(page, rl, text) {
  const composer = await ensureMessageComposer(page, rl);
  await page.waitForTimeout(BOT_COMMAND_DELAY_MS);
  await withTimeout(composer.click(), PLAYWRIGHT_TIMEOUT_MS, "focus ô nhập Telegram");
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  const lines = String(text).split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i]) await page.keyboard.insertText(lines[i]);
    if (i < lines.length - 1) await composer.press("Shift+Enter");
  }
  const typed = (
    (await composer.innerText().catch(() => "")) ||
    (await composer.inputValue().catch(() => ""))
  )
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const missingLine = lines.find(
    (line) => line.trim() && !typed.includes(line.trim().replace(/\s+/g, " "))
  );
  if (missingLine) {
    throw new Error(
      `Không nhập đủ danh sách cầu thủ vào ô chat Telegram (thiếu dòng ${missingLine.trim()}).`
    );
  }
  markIconActivity();
  await withTimeout(composer.press("Enter"), PLAYWRIGHT_TIMEOUT_MS, "gửi danh sách cầu thủ");
  log(`Đã gửi ${lines.length} dòng đặt mua ICON.`);
}

async function sendSingleLineMessage(page, rl, text) {
  const composer = await ensureMessageComposer(page, rl);
  markIconActivity();
  await sendBotCommand(page, composer, text);
}

module.exports = {
  makeFlowError,
  findButtonByText,
  waitForButtonByText,
  ensureFeatureButton,
  clickFeatureButton,
  sendMultilineMessage,
  sendSingleLineMessage,
  hasIconMenuSignature
};
