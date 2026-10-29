const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");

const dataDir = path.join(
  process.env.LOCALAPPDATA || os.homedir(),
  "FO4PurchaseAgent"
);
const defaultProfilePath = path.join(dataDir, "telegram-profile");

let headlessMode = String(process.env.FO4_HEADLESS || "").toLowerCase() === "true";
const edgeExecutablePath =
  process.env.FO4_BROWSER_PATH ||
  [
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ].find((candidate) => fs.existsSync(candidate)) ||
  null;

function isChromiumLaunchCrash(error) {
  return /target page, context or browser has been closed|browser has been closed|browser context đóng ngay sau khi khởi động|exitCode=3221225477|0xc0000005/i.test(
    error?.message || ""
  );
}

async function launchAndValidate(profileDir, options) {
  const context = await chromium.launchPersistentContext(profileDir, options);
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const browser = context.browser();
  const pages = context.pages().filter((page) => !page.isClosed());
  if (!browser || !browser.isConnected() || pages.length === 0) {
    try { await context.close(); } catch { /* browser already closed */ }
    throw new Error("Browser context đóng ngay sau khi khởi động.");
  }
  return context;
}

async function launchTelegramContext(
  profileDir = defaultProfilePath,
  { log = () => {}, forceHeadless = false } = {}
) {
  const options = {
    headless: forceHeadless || headlessMode,
    viewport: { width: 1360, height: 900 },
    timeout: 120_000,
    // Giảm nhiễu sau khi Chromium crash/thoát không sạch: ẩn bong bóng
    // "Restore pages? Chromium didn't shut down correctly" và các hộp thoại
    // first-run có thể che UI. Cờ lạ được Chromium/Edge bỏ qua an toàn.
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-crash-restore-bubble",
      "--disable-session-crashed-bubble"
    ]
  };

  try {
    return await launchAndValidate(profileDir, options);
  } catch (error) {
    if (options.headless || !isChromiumLaunchCrash(error)) {
      throw error;
    }

    if (edgeExecutablePath) {
      log(
        "Chromium Playwright bị crash khi mở cửa sổ (0xC0000005); " +
          `chuyển sang trình duyệt Chromium thay thế: ${edgeExecutablePath}.`
      );
      try {
        return await launchAndValidate(profileDir, {
          ...options,
          executablePath: edgeExecutablePath
        });
      } catch (edgeError) {
        if (!isChromiumLaunchCrash(edgeError)) throw edgeError;
        log("Trình duyệt thay thế cũng không mở được; chuyển sang headless.");
      }
    }

    headlessMode = true;
    log(
      "Không mở được trình duyệt có cửa sổ; chuyển sang headless. " +
        "Nếu Telegram yêu cầu đăng nhập, cần đăng nhập lại trong cửa sổ có giao diện."
    );
    return launchAndValidate(profileDir, {
      ...options,
      headless: true
    });
  }
}

async function isTelegramLoginPage(page) {
  const text = await page.locator("body").innerText({ timeout: 15_000 });
  return /Log in by QR Code|LOG IN BY PHONE NUMBER|Scan with Telegram app on your phone/i.test(
    text
  );
}

module.exports = {
  defaultProfilePath,
  isChromiumLaunchCrash,
  isTelegramLoginPage,
  launchTelegramContext
};
