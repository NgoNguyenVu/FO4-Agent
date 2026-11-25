const { CLOSED_SESSION_RE, toNavigationError } = require("./playwright-utils");

function isClosedSessionError(error) {
  return CLOSED_SESSION_RE.test(error?.message || "");
}

// watchDog gọi hàm này nhiều lần trong cùng một nhịp; cache ngắn tránh querySelector
// + getComputedStyle lặp lại trên chat dài.
const SCROLL_CACHE_MS = 1_000;
let scrollCache = new WeakMap();

function clearScrollCache() {
  scrollCache = new WeakMap();
}

async function scrollChatToBottom(page) {
  if (!page || typeof page.evaluate !== "function") return false;
  const cached = scrollCache.get(page);
  if (cached && Date.now() - cached.at < SCROLL_CACHE_MS) return cached.result;
  try {
    const result = await page.evaluate(() => {
      const candidates = [
        ...document.querySelectorAll(
          [
            '[class*="chat-history"]',
            '[class*="bubbles"]',
            '[class*="messages"]',
            '[data-testid*="chat"]',
            '[data-testid*="message"]',
            "main",
            "body"
          ].join(",")
        )
      ].filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 250 &&
          rect.height > 200 &&
          element.scrollHeight > element.clientHeight &&
          /(auto|scroll)/i.test(`${style.overflowY} ${style.overflow}`)
        );
      });
      const target = candidates.sort(
        (a, b) =>
          b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight)
      )[0];
      if (!target) return false;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const before = target.scrollTop;
        target.scrollTop = target.scrollHeight;
        target.dispatchEvent(new Event("scroll", { bubbles: true }));
        if (target.scrollTop === before && target.scrollTop + target.clientHeight >= target.scrollHeight - 2) {
          break;
        }
      }
      const lastMessage = [...target.querySelectorAll(
        '[class*="message"], [class*="bubble"], [data-message-id]'
      )].at(-1);
      if (lastMessage && typeof lastMessage.scrollIntoView === "function") {
        lastMessage.scrollIntoView({ block: "nearest" });
        target.scrollTop = target.scrollHeight;
      }
      return target.scrollTop + target.clientHeight >= target.scrollHeight - 4;
    });
    scrollCache.set(page, { at: Date.now(), result });
    return result;
  } catch (error) {
    if (isClosedSessionError(error)) {
      scrollCache.set(page, { at: Date.now(), result: false });
      return false;
    }
    // page.evaluate bị hủy giữa lúc Telegram Web reload/điều hướng. Không nuốt
    // lỗi này: controller cần biết để mở lại chat và gắn lại observer.
    throw toNavigationError(error, "Telegram Web điều hướng khi cuộn chat");
  }
}

module.exports = { scrollChatToBottom, clearScrollCache, SCROLL_CACHE_MS };
