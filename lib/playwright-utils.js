const CLOSED_SESSION_RE =
  /target page, context or browser has been closed|browser has been closed|context has been closed|target crashed|page crashed/i;
const NAVIGATION_RE =
  /execution context was destroyed|most likely because of a navigation|frame was detached|cannot find context with specified id|page navigated/i;

function isNavigationError(error) {
  return NAVIGATION_RE.test(error?.message || "");
}

// Chuyển lỗi do Telegram Web tự reload/điều hướng thành mã riêng để controller
// mở lại chat và gắn lại observer, thay vì dừng agent và bắt người dùng /resetagent.
function toNavigationError(error, label = "Telegram Web vừa điều hướng/tải lại") {
  if (!isNavigationError(error)) return error;
  if (error.code === "TELEGRAM_NAVIGATED") return error;
  const wrapped = new Error(`${label}: ${error.message}`);
  wrapped.code = "TELEGRAM_NAVIGATED";
  wrapped.cause = error;
  return wrapped;
}

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Playwright timeout sau ${ms}ms: ${label}`)),
      ms
    );
  });
  return Promise.race([
    promise.then(
      (value) => {
        clearTimeout(timer);
        return value;
      },
      (error) => {
        clearTimeout(timer);
        throw error;
      }
    ),
    timeout
  ]);
}

function isPlaywrightTimeout(error) {
  return /Playwright timeout sau \d+ms:/i.test(error?.message || "");
}

function isBrowserSessionClosed(error, page, context) {
  const browser = context?.browser?.();
  return (
    page?.isClosed?.() ||
    (browser !== null && browser !== undefined && !browser.isConnected()) ||
    CLOSED_SESSION_RE.test(error?.message || "")
  );
}

module.exports = {
  CLOSED_SESSION_RE,
  NAVIGATION_RE,
  isNavigationError,
  toNavigationError,
  withTimeout,
  isPlaywrightTimeout,
  isBrowserSessionClosed
};
