// Runtime chat dùng chung cho cả hai feature:
// - tạo tracker/đọc chat từ lib/chat-observer
// - cung cấp getFreshSince + đọc lệnh điều khiển
// - verifyTailOrphan (đưa chat về đuôi trước khi tin terminal "mồ côi")
const { createChatObserver } = require("./chat-observer");
const { chatTextReaders } = require("./chat-state");
const { withTimeout } = require("./playwright-utils");
const {
  PLAYWRIGHT_TIMEOUT_MS,
  CHAT_TEXT_POLL_INTERVAL_MS
} = require("./bot-patterns");
const {
  getFreshSince,
  controlCommandMatches,
  getNewTailCommands,
  countMatches,
  lastPatternIndex,
  findNearMissControlCommand,
  findNewNearMissControlCommand
} = require("./text-utils");

const observer = createChatObserver({
  playwrightTimeoutMs: PLAYWRIGHT_TIMEOUT_MS,
  pollIntervalMs: CHAT_TEXT_POLL_INTERVAL_MS,
  readers: chatTextReaders
});

const createChatTextTracker = observer.createTracker;
const waitForChatChange = observer.waitForChange;
const waitForTextToSettle = observer.waitForSettle;
const observeChatText = observer.observe;

// Đưa cửa sổ chat về đuôi (tail) rồi đọc lại, để xác minh terminal "mồ côi".
// Nguy cơ orphan bắn nhầm: user cuộn lên đọc lịch sử cũ, đúng vùng có completion
// cũ nhưng thiếu activity tiếp sau nó => agent tưởng chu kỳ xong (mở chu kỳ
// mới chồng worker = tốn BP thật). Bấm End đưa về đuôi rồi đọc lại: orphan còn
// thì thật, hết thì chỉ là vùng lịch sử cũ. Fail-open: không verify được thì giữ
// hành vi cũ (caller tự quyết accept sau đó).
const ORPHAN_CLEARED_SUPPRESS_MS = 60_000;
async function verifyTailOrphan(page, reader) {
  try {
    await withTimeout(page.keyboard.press("End"), 10_000, "cuộn về đuôi chat");
    await page.waitForTimeout(2_500);
    reader.publish(
      await withTimeout(page.locator("body").innerText(), PLAYWRIGHT_TIMEOUT_MS, "đọc lại đuôi chat")
    );
  } catch {
    // Trang đóng/không bấm được: giữ snapshot cũ, caller xử lý tiếp.
  }
  return reader.snapshot();
}

module.exports = {
  chatTextReaders,
  createChatTextTracker,
  waitForChatChange,
  waitForTextToSettle,
  observeChatText,
  getFreshSince,
  controlCommandMatches,
  getNewTailCommands,
  countMatches,
  lastPatternIndex,
  findNearMissControlCommand,
  findNewNearMissControlCommand,
  ORPHAN_CLEARED_SUPPRESS_MS,
  verifyTailOrphan
};
