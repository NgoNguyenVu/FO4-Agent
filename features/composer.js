// Composer Telegram dùng chung (Auto Mua + Auto Nâng + controller).
// Tách khỏi autobuy.js để feature nâng không phải require module mua.
const { withTimeout } = require("../lib/playwright-utils");
const { PLAYWRIGHT_TIMEOUT_MS } = require("../lib/bot-patterns");
const {
  chatTextReaders,
  waitForChatChange
} = require("../lib/chat-runtime");
const {
  BOT_URL,
  ensureBotChatOpen,
  dismissTelegramTips,
  hardReloadTelegram
} = require("./telegram-io");
const {
  promptWakeable,
  setWaitingForLoginPrompt
} = require("./interactive-prompt");
const { log } = require("./agent-log");

async function getMessageComposer(page) {
  const selectors = [
    '[contenteditable="true"][data-placeholder="Message"]',
    '[contenteditable="true"][aria-label*="Message" i]',
    "#editable-message-text",
    ".input-message-input[contenteditable=true]",
    '[role="textbox"][contenteditable="true"]',
    'textarea[placeholder*="Message" i]',
    'input[placeholder*="Message" i]',
    '[contenteditable="true"]'
  ];
  for (const selector of selectors) {
    const fields = page.locator(selector);
    const total = await withTimeout(fields.count(), 15_000, "đếm ô nhập tin nhắn");
    for (let index = 0; index < total; index += 1) {
      const field = fields.nth(index);
      if (await withTimeout(field.isVisible(), 15_000, "kiểm tra ô nhập tin nhắn")) return field;
    }
  }
  return null;
}

async function waitForMessageComposer(page, timeoutMs) {
  const reader = chatTextReaders.get(page);
  if (!reader) throw new Error("Chưa khởi tạo theo dõi nội dung Telegram.");
  const deadline = Date.now() + timeoutMs;
  let snapshot = reader.snapshot();
  while (Date.now() < deadline) {
    const composer = await getMessageComposer(page);
    if (composer) return composer;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    // Poll ngắn thay vì chặn tới hết timeout: composer có thể xuất hiện mà
    // nội dung chat không đổi (Telegram vừa đóng mini-app, chưa có tin mới).
    const update = await waitForChatChange(
      page,
      reader,
      snapshot.version,
      Math.min(1_000, remaining)
    );
    if (update) snapshot = update;
  }
  return null;
}

async function ensureMessageComposer(page, rl) {
  // Trước khi tìm ô nhập / gửi lệnh: chắc chắn đang mở đúng chat bot. Tránh
  // trường hợp Telegram reset về trang chủ khiến nút menu và /tn đi sai chỗ.
  await ensureBotChatOpen(page);
  let composer = await waitForMessageComposer(page, 10_000);
  // Chưa thấy ô nhập: có thể trang load chậm/transient. Chỉ tải lại chat MỘT
  // lần; reload lần hai làm mini-app timeout oan (bug 2026-10-19). (goto/page-op
  // throw khi context đã đóng bởi /resetagent -> để caller xử lý recovery.)
  if (!composer) {
    log("Không thấy ô nhập tin nhắn; tải lại trang Telegram một lần và chờ thêm...");
    await page.goto(BOT_URL, { waitUntil: "domcontentloaded" });
    await dismissTelegramTips(page);
    composer = await waitForMessageComposer(page, 15_000);
    if (!composer) {
      // page.goto(BOT_URL) khi URL chỉ khác hash là điều hướng same-document:
      // Telegram Web K có thể vẫn kẹt ở màn hình "Chats" (log 01:48-03:43).
      // reload() mới tạo document mới và mở lại chat theo hash.
      log("Vẫn không thấy ô nhập sau khi điều hướng; tải lại cứng trang Telegram.");
      await hardReloadTelegram(page);
      composer = await waitForMessageComposer(page, 30_000);
    }
  }
  if (!composer) {
    setWaitingForLoginPrompt(true);
    try {
      await promptWakeable(rl, "Nhấn Enter sau khi đăng nhập Telegram xong (hoặc gửi /resetagent để thử lại)...");
    } finally {
      setWaitingForLoginPrompt(false);
    }
    await page.goto(BOT_URL, { waitUntil: "domcontentloaded" });
    await dismissTelegramTips(page);
    composer = await waitForMessageComposer(page, 30_000);
    if (!composer) {
      await hardReloadTelegram(page);
      composer = await waitForMessageComposer(page, 30_000);
    }
  }
  if (!composer) {
    throw new Error("Không tìm thấy ô nhập tin nhắn Telegram sau khi mở chat; agent chưa gửi lệnh.");
  }
  return composer;
}

// Gửi lại lệnh khi composer cũ đã detach khỏi DOM (chat re-render sau nhiều
// phút chờ). Trả về composer đang dùng được để caller tái sử dụng, tránh
// phải tìm lại composer ngay sau đó.
async function refillComposer(page, rl, composer, command) {
  try {
    await withTimeout(composer.fill(command), PLAYWRIGHT_TIMEOUT_MS, `điền lại lệnh ${command}`);
  } catch {
    composer = await ensureMessageComposer(page, rl);
    await withTimeout(composer.fill(command), PLAYWRIGHT_TIMEOUT_MS, `điền lại lệnh ${command}`);
  }
  await withTimeout(composer.press("Enter"), PLAYWRIGHT_TIMEOUT_MS, `gửi lại lệnh ${command}`);
  return composer;
}

module.exports = {
  getMessageComposer,
  waitForMessageComposer,
  ensureMessageComposer,
  refillComposer
};
