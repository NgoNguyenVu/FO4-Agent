// Tìm nút Auto Mua Phôi và chờ menu mới sau /tn.
const { withTimeout } = require("../../lib/playwright-utils");
const { scrollChatToBottom } = require("../../lib/chat-scroll");
const {
  chatTextReaders,
  waitForChatChange
} = require("../../lib/chat-runtime");
const { getFreshSince } = require("../../lib/text-utils");
const {
  countBotSystemErrors,
  hasNewBotSystemError,
  getFreshRateLimitDelay,
  getNewBotRateLimitDelay
} = require("../../lib/bot-signals");
const { hasFreshFeatureMenu, hasRecentFeatureMenu } = require("./patterns");
const { PLAYWRIGHT_TIMEOUT_MS } = require("../../lib/bot-patterns");
const { log } = require("../agent-log");

const MENU_WAIT_HEARTBEAT_MS = 30_000;

async function findAutoBuyButton(page) {
  const selectors = [
    page.getByRole("button", { name: "Auto Mua Phôi", exact: true }),
    page.locator(".reply-markup-button").filter({ hasText: "Auto Mua Phôi" })
  ];
  for (const buttons of selectors) {
    const count = await withTimeout(buttons.count(), 5_000, "đếm nút Auto Mua Phôi");
    if (count === 0) continue;
    const button = buttons.last();
    if (await withTimeout(button.isVisible(), 5_000, "kiểm tra nút Auto Mua Phôi")) {
      return button;
    }
  }
  return null;
}

async function findCurrentButton(page) {
  const reader = chatTextReaders.get(page);
  if (!reader) throw new Error("Chưa khởi tạo theo dõi nội dung Telegram.");
  await withTimeout(
    scrollChatToBottom(page),
    PLAYWRIGHT_TIMEOUT_MS,
    "cuộn chat Telegram xuống tin mới nhất"
  );
  return withTimeout(findAutoBuyButton(page), 10_000, "tìm nút Auto Mua Phôi");
}

async function waitForMenuReply(page, timeoutMs, baseline) {
  const reader = chatTextReaders.get(page);
  if (!reader) throw new Error("Chưa khởi tạo theo dõi nội dung Telegram.");
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let snapshot = reader.snapshot();
  // Chờ menu là khoảng lặng dài (tới botResponseTimeoutMinutes) và
  // waitForChatChange chặn suốt thời gian đó, nên dùng nhịp tim định kỳ để thấy
  // agent đang chờ menu mới chứ không bị treo.
  const heartbeat = setInterval(() => {
    log(
      `Đang chờ menu mới từ bot sau /tn (${Math.round((Date.now() - startedAt) / 1000)}s/` +
        `${Math.round(timeoutMs / 1000)}s)...`
    );
  }, MENU_WAIT_HEARTBEAT_MS);
  try {
    while (Date.now() < deadline) {
      if (hasNewBotSystemError(snapshot.text, baseline.systemErrors)) {
        return { status: "system-error" };
      }
      const fresh = getFreshSince(baseline.text, snapshot.text);
      if (fresh && countBotSystemErrors(fresh) > 0) {
        return { status: "system-error" };
      }
      // Snapshot có thể bị Telegram thay hẳn (getFreshSince trả null). Khi đó
      // vẫn nhận menu nếu text hiện tại đúng chữ ký menu; nút phải thật sự
      // visible thì mới bấm, nên không sợ bấm nhầm tin nhắn văn bản.
      const replacedSnapshotHasMenu =
        fresh === null && hasRecentFeatureMenu(snapshot.text);
      if (hasFreshFeatureMenu(baseline.text, snapshot.text) || replacedSnapshotHasMenu) {
        const button = await findAutoBuyButton(page);
        if (button) return { status: "menu", button };
      }
      const freshRateLimit =
        getFreshRateLimitDelay(fresh) ??
        getNewBotRateLimitDelay(snapshot.text, baseline.rateLimit);
      if (freshRateLimit !== null) {
        return { status: "rate-limited", delay: freshRateLimit };
      }
      const update = await waitForChatChange(
        page,
        reader,
        snapshot.version,
        deadline - Date.now()
      );
      if (!update) break;
      snapshot = update;
    }
    return { status: "timeout" };
  } finally {
    clearInterval(heartbeat);
  }
}

module.exports = {
  findAutoBuyButton,
  findCurrentButton,
  waitForMenuReply
};
