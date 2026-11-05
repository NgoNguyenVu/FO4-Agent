// Thao tác mini-app Auto Mua Phôi: mở iframe, cấu hình và xác minh.
const fs = require("node:fs");
const path = require("node:path");
const { config } = require("../config");
const { isTelegramLoginPage } = require("../../lib/browser-session");
const {
  withTimeout,
  isBrowserSessionClosed
} = require("../../lib/playwright-utils");
const {
  PLAYWRIGHT_TIMEOUT_MS,
  CHAT_TEXT_POLL_INTERVAL_MS,
  MINI_APP_BLANK_TIMEOUT_MS
} = require("../../lib/bot-patterns");
const {
  chatTextReaders
} = require("../../lib/chat-runtime");
const { log } = require("../agent-log");
const {
  closeMiniApp,
  getPaymentFrameLocator,
  inspectPaymentFrames
} = require("../telegram-io");
const { requestMenuWithTn } = require("../menu-request");
const {
  findCurrentButton,
  waitForMenuReply
} = require("./menu");
const {
  countBotSystemErrors,
  countBotRateLimitNotices
} = require("../../lib/bot-signals");
const {
  isTradeFrameLoaded,
  shouldRetryMiniAppOpen,
  getFeatureMenuAction,
  parseBp
} = require("./patterns");

const START_BUTTON_NAME = "Bắt đầu Auto Mua";

function shortenText(text, max = 180) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

async function saveMiniAppDebug(page, error) {
  try {
    const dir = path.join(process.cwd(), "debug");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `auto-mua-${stamp}.png`);
    await page.screenshot({ path: file });
    error.debugScreenshot = file;
    log(`Đã lưu ảnh màn hình lỗi mini-app Auto Mua: ${file}`);
  } catch (captureError) {
    log(`Không lưu được ảnh mini-app Auto Mua: ${captureError.message}`);
  }
}

async function waitForTradeFrame(page) {
  const deadline = Date.now() + config.botResponseTimeoutMinutes * 60_000;
  const frameDeadline = Date.now() + 20_000;
  const startButtonDeadline = Date.now() + 45_000;
  const startWait = Date.now();
  // Bắt đầu đếm từ lúc mở; lần log đầu chỉ sau 15s để không báo "chưa thấy nút"
  // ngay khi mini-app còn đang tải bình thường (gây cảm giác lỗi ảo).
  let lastLoadingLogAt = Date.now();
  let firstFrameAt = 0;
  let lastFrameInfo = "";
  let lastBodyText = "";
  while (Date.now() < deadline) {
    if (await isTelegramLoginPage(page)) {
      const error = new Error(
        "Telegram Web chưa đăng nhập; không thể mở mini-app Auto Mua."
      );
      error.code = "TELEGRAM_LOGIN_REQUIRED";
      throw error;
    }
    const frame = getPaymentFrameLocator(page);
    const { count: frameCount, info: frameInfo } = await inspectPaymentFrames(page);
    lastBodyText = "";
    lastFrameInfo = frameInfo;
    if (frameCount > 0) {
      if (!firstFrameAt) firstFrameAt = Date.now();
    } else {
      // Iframe bị Telegram gỡ tạm thời: đếm lại 15 giây cho lần mở kế tiếp.
      firstFrameAt = 0;
    }
    if (frameCount === 0 && Date.now() >= frameDeadline) {
      const error = new Error(
        "Đã chọn Auto Mua Phôi nhưng Telegram không mở iframe mini-app trong 20 giây."
      );
      error.code = "MINI_APP_NOT_OPENED";
      throw error;
    }
    const startButton = frame.getByRole("button", { name: START_BUTTON_NAME });
    const startVisible = await withTimeout(
      startButton.isVisible(),
      15_000,
      "chờ nút Bắt đầu Auto Mua"
    );
    if (startVisible) {
      let text = "";
      try {
        text = await withTimeout(
          frame.locator("body").innerText(),
          PLAYWRIGHT_TIMEOUT_MS,
          "đọc mini-app"
        );
      } catch (error) {
        if (isBrowserSessionClosed(error, page)) throw error;
        // Iframe vừa bị Telegram thay/refresh; vòng sau sẽ chọn lại frame.
      }
      lastBodyText = text;
      if (isTradeFrameLoaded(text)) return frame;
      if (Date.now() - lastLoadingLogAt >= 15_000) {
        lastLoadingLogAt = Date.now();
        log(
          `Mini-app Auto Mua đã có nút Bắt đầu nhưng chưa hiện BP ` +
            `(${Math.round((Date.now() - startWait) / 1000)}s); tiếp tục chờ... ` +
            `[Telegram ${page.url()}] [${lastFrameInfo}] ` +
            `Nội dung: ${shortenText(text) || "(trống)"}`
        );
      }
    } else if (
      firstFrameAt &&
      Date.now() - firstFrameAt >= MINI_APP_BLANK_TIMEOUT_MS &&
      Date.now() - lastLoadingLogAt >= MINI_APP_BLANK_TIMEOUT_MS
    ) {
      lastLoadingLogAt = Date.now();
      let current = "";
      try {
        current = await frame.locator("body").innerText({ timeout: 3000 });
      } catch { /* iframe chưa có body */ }
      lastBodyText = current;
      if (!shortenText(current)) {
        // Iframe trắng không phải "đang tải chậm". getTradeFrame sẽ đóng và thử
        // lại chính menu hiện có (không gửi /tn); nếu vẫn trắng thì controller
        // tự reload Telegram Web.
        const error = new Error(
          `Iframe mini-app Auto Mua mở nhưng trắng (không có nội dung) sau ` +
            `${MINI_APP_BLANK_TIMEOUT_MS / 1_000} giây. ` +
            `Telegram: ${page.url()}. Iframe: ${lastFrameInfo}.`
        );
        error.code = "MINI_APP_BLANK";
        throw error;
      }
      log(
        `Mini-app Auto Mua đang tải, chưa thấy nút Bắt đầu ` +
          `(${Math.round((Date.now() - startWait) / 1000)}s); tiếp tục chờ... ` +
          `[Telegram ${page.url()}] [${lastFrameInfo}] ` +
          `Nội dung iframe: ${shortenText(current)}`
      );
    }
    // Deadline phải kiểm tra cả khi nút CHƯA từng hiện. Trước đây check nằm
    // trong nhánh startVisible nên nút không xuất hiện sẽ chờ tới 5 phút.
    if (Date.now() >= startButtonDeadline) {
      const state = startVisible
        ? "đã có nút Bắt đầu nhưng chưa hiện BP"
        : "đã mở nhưng không hiển thị nút Bắt đầu";
      const error = new Error(
        `Iframe mini-app Auto Mua ${state} trong 45 giây. ` +
          `Telegram: ${page.url()}. Iframe: ${lastFrameInfo}. ` +
          `Nội dung: ${shortenText(lastBodyText) || "(trống)"}`
      );
      error.code = "MINI_APP_UI_NOT_READY";
      throw error;
    }
    await page.waitForTimeout(Math.min(CHAT_TEXT_POLL_INTERVAL_MS, deadline - Date.now()));
  }
  const error = new Error(
    `Mini-app Auto Mua Phôi vẫn đang tải hoặc chưa hiển thị Giá hiển thị bằng BP ` +
      `sau ${config.botResponseTimeoutMinutes} phút. Iframe: ${lastFrameInfo}.`
  );
  error.code = "MINI_APP_BP_LOAD_TIMEOUT";
  throw error;
}

async function requestBuyMenu(page, rl, stale = false) {
  const reader = chatTextReaders.get(page);
  if (!reader) throw new Error("Chưa khởi tạo theo dõi nội dung Telegram.");
  if (!stale && getFeatureMenuAction(reader.snapshot().text) === "select-auto-buy") {
    // Menu còn trong lịch sử nhưng không còn nút bấm được (bàn phím đã bị
    // tin thủ công GLXH/chức năng khác thay thế): gửi /tn lấy menu mới.
    log("Menu Auto Mua Phôi còn trong lịch sử nhưng không thấy nút bấm; gửi /tn để lấy menu mới.");
  }
  const response = await requestMenuWithTn(page, rl, {
    label: "Auto Mua Phôi",
    waitForMenu: waitForMenuReply,
    buildBaseline: (snapshotText) => ({
      systemErrors: countBotSystemErrors(snapshotText),
      rateLimit: countBotRateLimitNotices(snapshotText),
      text: snapshotText
    })
  });
  if (response?.status === "system-error") {
    // E006 là lỗi hệ thống của bot: dừng auto, không thử /tn liên tục.
    const error = new Error("Bot trả E006 khi lấy menu Auto Mua Phôi.");
    error.code = "BOT_SYSTEM_ERROR";
    throw error;
  }
  if (
    !response ||
    response.status === "timeout" ||
    response.status === "rate-limited"
  ) {
    // Timeout không đồng nghĩa "chức năng khác đang chạy": bot có thể chậm,
    // tin menu bị trôi, hoặc /tn bị rate-limit. Controller sẽ thử lại với
    // backoff tăng dần, không gửi /tn dồn dập.
    const error = new Error(
      "Bot chưa trả menu Auto Mua Phôi trong thời gian chờ " +
        "(có thể bot chậm hoặc /tn bị rate-limit)."
    );
    error.code = "MENU_BUSY";
    error.userMessage = error.message;
    throw error;
  }
  if (!response.button) {
    throw new Error("Không tìm thấy nút Auto Mua Phôi sau khi tải menu.");
  }
  return response.button;
}

async function clickBuyMenu(page, rl, forceTn) {
  let button = forceTn ? null : await findCurrentButton(page);
  let fresh = forceTn || !button;
  if (!button) button = await requestBuyMenu(page, rl);
  try {
    await withTimeout(button.click(), 60_000, "bấm nút Auto Mua Phôi");
  } catch (error) {
    if (fresh || isBrowserSessionClosed(error, page)) throw error;
    // Menu cũ còn hiện nhưng Telegram đã thay bàn phím: chỉ lấy menu mới một lần.
    log("Nút Auto Mua Phôi cũ không bấm được; gửi /tn lấy menu mới.");
    button = await requestBuyMenu(page, rl, true);
    await withTimeout(button.click(), 60_000, "bấm nút Auto Mua Phôi");
  }
}

async function openTradeFrame(page, rl, forceTn = false) {
  // forceTn chỉ dùng khi lần trước bấm menu mà iframe không hề mở: menu có thể
  // đã cũ. Iframe trắng/UI chưa sẵn sàng thì giữ menu, chỉ đóng rồi bấm lại.
  const existingFrame = getPaymentFrameLocator(page);
  if (!forceTn) {
    const existingStartButton = existingFrame.getByRole("button", { name: START_BUTTON_NAME });
    let existingVisible = false;
    try {
      existingVisible = await withTimeout(
        existingStartButton.isVisible(),
        15_000,
        "kiểm tra mini-app cũ"
      );
    } catch (error) {
      if (
        /target page, context or browser has been closed|browser has been closed|context has been closed|target crashed|page crashed/i.test(
          error?.message || ""
        )
      ) {
        throw error;
      }
      if (!/timeout|not attached|detached|no node found/i.test(error?.message || "")) {
        throw error;
      }
    }
    if (existingVisible) {
      return waitForTradeFrame(page);
    }
  }
  // Iframe cũ (ví dụ mini-app nâng cấp còn mở) sẽ che menu Auto Mua và khiến
  // lần mở này đọc nhầm body; đóng trước khi bấm menu.
  await closeMiniApp(page).catch(() => {});
  await clickBuyMenu(page, rl, forceTn);
  return waitForTradeFrame(page);
}

async function getTradeFrame(page, rl) {
  let forceTn = false;
  for (let retry = 0; ; retry += 1) {
    try {
      return await openTradeFrame(page, rl, forceTn);
    } catch (error) {
      if (!shouldRetryMiniAppOpen(error, retry)) {
        // Chỉ chụp ảnh cho lỗi render mini-app; lỗi menu/bot không cần ảnh.
        if (
          error.code === "TELEGRAM_LOGIN_REQUIRED" ||
          (typeof error.code === "string" && error.code.startsWith("MINI_APP_"))
        ) {
          await saveMiniAppDebug(page, error);
        }
        throw error;
      }
      forceTn = error.code === "MINI_APP_NOT_OPENED";
      const retryAction = forceTn
        ? "gửi /tn lấy menu mới rồi thử lại một lần"
        : "đóng và thử lại menu hiện có (không gửi /tn nếu nút còn)";
      log(
        error.code === "MINI_APP_BP_LOAD_TIMEOUT"
          ? `Mini-app quá ${config.botResponseTimeoutMinutes} phút chưa hiện BP; ${retryAction}.`
          : error.code === "MINI_APP_BLANK"
            ? `Iframe mini-app Auto Mua bị trắng; ${retryAction}.`
            : `Mini-app Auto Mua chưa sẵn sàng (${error.code}); ${retryAction}.`
      );
    }
  }
}

async function readCycleConfiguration(fields, price) {
  return {
    ovrMin: Number(await fields.nth(0).inputValue()),
    ovrMax: Number(await fields.nth(1).inputValue()),
    maxPriceBP: parseBp(await price.inputValue()),
    quantityPerAttempt: Number(await fields.nth(2).inputValue()),
    maxPerCycle: Number(await fields.nth(3).inputValue())
  };
}

async function configureCycle(frame, quantity) {
  const fields = frame.getByRole("spinbutton");
  const price = frame.getByRole("textbox");
  if ((await fields.count()) < 4 || (await price.count()) !== 1) {
    throw new Error("Không nhận diện được các trường cấu hình trong mini-app.");
  }
  const values = [
    [fields.nth(0), config.ovrMin],
    [fields.nth(1), config.ovrMax],
    [fields.nth(2), config.quantityPerAttempt],
    [fields.nth(3), quantity]
  ];
  for (const [field, value] of values) {
    await field.fill("");
    await field.fill(String(value));
  }
  await price.fill("");
  await price.fill(String(config.maxPriceBP));

  let actual = await readCycleConfiguration(fields, price);
  if (actual.maxPriceBP !== config.maxPriceBP) {
    // Một số bản mini-app giữ phần giá cũ khi re-render ô BP. Chọn toàn bộ
    // rồi xóa trước khi ghi lại một lần nữa, sau đó vẫn phải đọc xác minh.
    await price.click();
    await price.press("Control+A");
    await price.press("Backspace");
    await price.fill(String(config.maxPriceBP));
    actual = await readCycleConfiguration(fields, price);
  }
  if (
    actual.ovrMin !== config.ovrMin ||
    actual.ovrMax !== config.ovrMax ||
    actual.maxPriceBP !== config.maxPriceBP ||
    actual.quantityPerAttempt !== config.quantityPerAttempt ||
    actual.maxPerCycle !== quantity
  ) {
    throw new Error(`Không xác minh được cấu hình: ${JSON.stringify(actual)}`);
  }
}

module.exports = {
  waitForTradeFrame,
  openTradeFrame,
  getTradeFrame,
  configureCycle
};
