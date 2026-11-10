// Các thao tác hạ tầng với Telegram Web: mở phiên/trang, ô nhập lệnh, gửi lệnh,
// đảm bảo đang mở đúng chat bot, đóng mini-app.
//
// Không phụ thuộc vào logic mua/nâng để tránh vòng require.
const {
  defaultProfilePath,
  launchTelegramContext: launchBrowserContext
} = require("../lib/browser-session");
const {
  withTimeout,
  isBrowserSessionClosed
} = require("../lib/playwright-utils");
const { reattachChatObserver } = require("../lib/chat-runtime");
const {
  BOT_COMMAND_DELAY_MS,
  TN_COMMAND_COOLDOWN_MS,
  PLAYWRIGHT_TIMEOUT_MS
} = require("../lib/bot-patterns");
const { log } = require("./agent-log");

// Profile hiện tại mở Web K. Có thể trỏ sang Web A bằng FO4_TELEGRAM_URL nếu
// Telegram đổi giao diện; cả hash @username và user ID đều được nhận diện.
const BOT_USERNAME = "Nguyenanh_fo4_bot";
const BOT_USER_ID = "8107829917";
const BOT_URL =
  process.env.FO4_TELEGRAM_URL ||
  `https://web.telegram.org/k/#@${BOT_USERNAME}`;
// Nhận cả hash @username (Web K) và user ID (Web A) để không tưởng nhầm là
// chat bot đã đóng rồi tải lại trang giữa chừng.
const BOT_CHAT_HASH_RE = new RegExp(
  `#(?:@?${BOT_USERNAME}|${BOT_USER_ID})\\b`,
  "i"
);
const BOT_CHAT_TITLE_RE =
  /BOT[\s._-]*(?:TTCN|CHEN)?[\s._-]*F[O0C]4|Nguyenanh_fo4_bot/i;

// Ô nhập chat đang mở? Dùng làm bằng chứng cột chat thật sự mở (không phải
// trang chủ còn giữ hash cũ).
async function isComposerVisible(page) {
  try {
    return await page
      .locator(
        '#editable-message-text, [contenteditable="true"][data-placeholder="Message"], .input-message-input[contenteditable=true]'
      )
      .first()
      .isVisible();
  } catch {
    return false;
  }
}

// Kiểm tra chat bot có đang thực sự mở không. Hash #@bot một mình KHÔNG đủ:
// Telegram Web K có thể đóng cột chat, quay về trang chủ nhưng vẫn giữ hash cũ.
// Tên hiển thị của bot có thể đổi (BOT-TTCN-FO4 -> BOT CHEN FC4), nên khi URL
// đã trỏ đúng bot chỉ cần ô nhập chat đang mở; tránh page.goto lại mỗi lệnh.
async function isBotChatOpen(page) {
  let hashMatches = false;
  try {
    hashMatches = BOT_CHAT_HASH_RE.test(page.url());
  } catch { /* trang đã đóng */ }
  let title = "";
  try {
    const titleLocator = page
      .locator(".chat .topbar .peer-title, .chat-info .peer-title")
      .first();
    if (await titleLocator.isVisible()) {
      title = await titleLocator.innerText({ timeout: 2_000 });
    }
  } catch { /* chưa render xong */ }
  if (BOT_CHAT_TITLE_RE.test(title)) return true;
  if (hashMatches) return isComposerVisible(page);
  return false;
}

// Telegram Web đôi khi hiện lớp "tips" onboarding (Appearance/Color theme...)
// ngay sau khi mở trang, có thể che/ăn click. Chỉ gọi ngay sau khi vừa điều hướng
// nên không ảnh hưởng mini-app đang mở. Best-effort: lỗi/đổi UI thì bỏ qua.
async function dismissTelegramTips(page) {
  try {
    const startedAt = Date.now();
    let sawTip = false;
    while (Date.now() - startedAt < 10_000) {
      const next = page.getByRole("button", {
        name: /^(Next Tip|Tiếp theo|Done|Finish|Got it|Hoàn tất|Xong)$/i
      });
      const count = await next.count().catch(() => 0);
      if (count === 0) {
        // Tips có thể xuất hiện muộn sau khi page.goto domcontentloaded.
        if (!sawTip && Date.now() - startedAt < 3_000) {
          await page.waitForTimeout(250);
          continue;
        }
        return;
      }
      const button = next.first();
      if (!(await button.isVisible())) {
        if (!sawTip && Date.now() - startedAt < 3_000) {
          await page.waitForTimeout(250);
          continue;
        }
        return;
      }
      sawTip = true;
      await button.click({ timeout: 2_000 });
      await page.waitForTimeout(150);
    }
  } catch { /* không có lớp tips hoặc Telegram đổi UI */ }
}

// Tải lại CỨNG trang Telegram. page.goto(BOT_URL) khi URL chỉ khác hash là điều
// hướng same-document nên không dựng lại UI; Telegram Web K có thể vẫn kẹt ở
// màn hình "Chats" với cột chat đã đóng (log 01:48-03:43 kẹt hơn 2 giờ, mỗi
// vòng chỉ đọc được 0 bubble nên không gửi /stop). reload() mới tạo document
// mới và mở lại chat theo hash. Sau reload phải gắn lại MutationObserver để
// vẫn nhận lệnh /stopagent, /resetagent từ xa.
async function hardReloadTelegram(page) {
  await withTimeout(
    page.reload({ waitUntil: "domcontentloaded" }),
    120_000,
    "tải lại trang Telegram"
  );
  await dismissTelegramTips(page);
  // reload() giữ nguyên URL hiện tại. Nếu Telegram đã xóa hash chat bot (thanh
  // địa chỉ chỉ còn /k/, như ảnh màn hình màn hình "Chats") thì reload vẫn về
  // trang chủ; phải điều hướng lại bằng URL chuẩn.
  let hashMatches = false;
  try {
    hashMatches = BOT_CHAT_HASH_RE.test(page.url());
  } catch { /* trang đã đóng, để caller xử lý */ }
  if (!hashMatches) {
    await withTimeout(
      page.goto(BOT_URL, { waitUntil: "domcontentloaded" }),
      120_000,
      "mở lại chat bot sau khi tải lại trang"
    );
    await dismissTelegramTips(page);
  }
  try {
    const reattached = await reattachChatObserver(page);
    if (reattached === false) {
      log("Chưa gắn lại được theo dõi chat sau khi tải lại trang Telegram.");
    }
  } catch (error) {
    log(`Chưa gắn lại được theo dõi chat sau khi tải lại trang: ${error.message}`);
  }
}

async function ensureBotChatOpen(page) {
  if (await isBotChatOpen(page)) return false;
  log("Chat bot không còn là chat đang mở; mở lại chat bot.");
  // Ưu tiên bấm lại chat bot trong danh sách: ít làm Telegram reset/tips hơn
  // page.goto, và xử lý đúng trường hợp URL vẫn còn hash nhưng cột chat đã đóng.
  let clickedFromList = false;
  try {
    const botChat = page
      .locator(".chatlist .chatlist-chat, .chat-list .chatlist-chat, .chatlist-chat")
      .filter({ hasText: BOT_CHAT_TITLE_RE })
      .first();
    if (await botChat.isVisible()) {
      log("Đang ở trang chủ dù URL còn hash; bấm lại chat bot trong danh sách.");
      await withTimeout(botChat.click(), 30_000, "mở lại chat bot từ danh sách");
      clickedFromList = true;
    }
  } catch { /* fallback bên dưới */ }
  if (!clickedFromList) {
    await withTimeout(
      page.goto(BOT_URL, { waitUntil: "domcontentloaded" }),
      120_000,
      "mở lại chat bot Telegram"
    );
  }
  await dismissTelegramTips(page);
  return true;
}

async function sendBotCommand(page, composer, command) {
  await page.waitForTimeout(BOT_COMMAND_DELAY_MS);
  await withTimeout(composer.fill(command), PLAYWRIGHT_TIMEOUT_MS, `điền lệnh ${command}`);
  await withTimeout(composer.press("Enter"), PLAYWRIGHT_TIMEOUT_MS, `gửi lệnh ${command}`);
}

function shortenText(text, max = 100) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

// Nếu Telegram còn giữ iframe cũ trong DOM, iframe cuối cùng là cái mới mở.
function getPaymentFrameLocator(page) {
  return page.locator("iframe.payment-verification").last().contentFrame();
}

// Chỉ dùng cho log/error: số iframe, iframe mới nhất có visible không, src đã
// bỏ query/hash để không ghi token tgWebAppData.
async function inspectPaymentFrames(page) {
  const iframes = page.locator("iframe.payment-verification");
  const count = await withTimeout(
    iframes.count(),
    PLAYWRIGHT_TIMEOUT_MS,
    "đếm iframe mini-app"
  );
  if (count === 0) return { count, info: "không có iframe mini-app" };
  const iframe = iframes.last();
  let visible = false;
  try { visible = await iframe.isVisible(); } catch { /* DOM đang đổi */ }
  let src = "";
  try { src = (await iframe.getAttribute("src")) || ""; } catch { /* bỏ qua */ }
  const safeSrc = src ? ` src=${shortenText(src.split(/[?#]/)[0], 100)}` : "";
  return {
    count,
    visible,
    info: `iframe #${count - 1}/${count} ${visible ? "visible" : "hidden"}${safeSrc}`
  };
}

// Cooldown toàn cục: page có thể bị thay khi controller khôi phục session,
// nhưng bot vẫn là một tài khoản nên không được gửi /tn dồn giữa các page.
let lastTnSentAt = 0;

// Mọi /tn đi qua đây để giữ khoảng cách tối thiểu, tránh spam bot. Lần đầu
// không chờ; các lần sau chờ đủ cooldown (sendBotCommand vẫn cộng thêm delay
// chung 4 giây).
async function sendTnCommand(page, composer) {
  const waitMs = TN_COMMAND_COOLDOWN_MS - (Date.now() - lastTnSentAt);
  if (waitMs > 0) {
    log(`Chờ ${Math.ceil(waitMs / 1_000)}s trước khi gửi /tn để tránh spam bot.`);
    await page.waitForTimeout(waitMs);
  }
  await sendBotCommand(page, composer, "/tn");
  lastTnSentAt = Date.now();
}

async function findMiniAppCloseButton(miniApp) {
  let ancestor = miniApp.locator("xpath=..");
  const candidatesSelector =
    'button[aria-label], button[title], button[class*="close" i], ' +
    '[role="button"][aria-label], [role="button"][title], ' +
    '[role="button"][class*="close" i], div[class*="close" i]';
  for (let depth = 0; depth < 8; depth += 1) {
    const candidates = ancestor.locator(candidatesSelector);
    for (let index = 0; index < (await candidates.count()); index += 1) {
      const candidate = candidates.nth(index);
      if (!(await candidate.isVisible())) continue;
      const label = await candidate.evaluate((element) =>
        [
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("class"),
          element.getAttribute("data-testid"),
          element.innerText
        ]
          .filter(Boolean)
          .join(" ")
      );
      if (/(?:close|dismiss|hide|đóng)/i.test(label)) return candidate;
    }
    ancestor = ancestor.locator("xpath=..");
  }
  return null;
}

async function waitForMiniAppHidden(page, miniApp, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await withTimeout(miniApp.isVisible(), 10_000, "kiểm tra mini-app đã ẩn"))) return true;
    await page.waitForTimeout(100);
  }
  return !(await withTimeout(miniApp.isVisible(), 10_000, "kiểm tra mini-app đã ẩn"));
}

async function closeMiniApp(page, featureName = "mini-app") {
  const miniApps = page.locator("iframe.payment-verification");
  const count = await withTimeout(
    miniApps.count(),
    PLAYWRIGHT_TIMEOUT_MS,
    "đếm mini-app đang mở"
  );
  // Telegram Web có thể giữ nhiều iframe mini-app trong DOM. Đóng từ iframe
  // mới nhất về cũ để không còn iframe cũ che/mở nhầm ở chu kỳ sau.
  for (let i = count - 1; i >= 0; i -= 1) {
    const miniApp = miniApps.nth(i);
    let visible = false;
    try {
      visible = await withTimeout(miniApp.isVisible(), 15_000, "kiểm tra mini-app");
    } catch {
      // Iframe vừa bị Telegram gỡ khỏi DOM; coi như đã đóng.
      continue;
    }
    if (!visible) continue;
    const closeButton = await withTimeout(
      findMiniAppCloseButton(miniApp),
      PLAYWRIGHT_TIMEOUT_MS,
      "tìm nút đóng mini-app"
    );
    if (closeButton) {
      await withTimeout(closeButton.click(), 15_000, "bấm nút đóng mini-app");
      if (!(await waitForMiniAppHidden(page, miniApp, 1_500))) {
        // Iframe có thể vừa tự đóng trong lúc tìm nút. Chỉ bấm Escape khi nó
        // vẫn còn hiển thị; Escape lúc mini-app đã đóng sẽ đóng luôn chat bot
        // và đẩy Telegram về trang chủ.
        if (await miniApp.isVisible().catch(() => false)) {
          await withTimeout(page.keyboard.press("Escape"), 10_000, "bấm Escape");
        }
      }
    } else if (await miniApp.isVisible().catch(() => false)) {
      await withTimeout(page.keyboard.press("Escape"), 10_000, "bấm Escape");
    }
    if (!(await waitForMiniAppHidden(page, miniApp, 3_500))) {
      if (!(await miniApp.isVisible().catch(() => false))) continue;
      throw new Error(
        `Không đóng được ${featureName} bằng nút đóng hoặc Escape; ` +
          "agent dừng, không tạo chu kỳ mới."
      );
    }
  }
}

async function launchTelegramContext(profileDir = defaultProfilePath) {
  return launchBrowserContext(profileDir, { log });
}

async function openTelegramPage(context, page) {
  let currentContext = context;
  let currentPage = page;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const browser = currentContext?.browser?.();
      if (!browser || !browser.isConnected() || currentPage?.isClosed?.()) {
        currentContext?.close?.().catch(() => {});
        currentContext = await withTimeout(
          launchTelegramContext(),
          180_000,
          "mở lại trình duyệt Telegram"
        );
        currentPage = null;
      }
      if (!currentPage || currentPage.isClosed()) {
        currentPage = currentContext.pages()[0] ||
          (await withTimeout(currentContext.newPage(), 60_000, "mở trang Telegram"));
      }
      await withTimeout(
        currentPage.goto(BOT_URL, { waitUntil: "domcontentloaded" }),
        120_000,
        "mở Telegram Web"
      );
      await dismissTelegramTips(currentPage);
      log(`Telegram Web URL: ${currentPage.url()}`);
      return { context: currentContext, page: currentPage };
    } catch (error) {
      if (!isBrowserSessionClosed(error, currentPage, currentContext) || attempt === 1) {
        throw error;
      }
      log("Chromium có cửa sổ bị đóng khi mở Telegram; chuyển sang headless để tiếp tục.");
      try { await currentContext.close(); } catch { /* browser đã đóng */ }
      currentContext = await withTimeout(
        launchBrowserContext(defaultProfilePath, { log, forceHeadless: true }),
        180_000,
        "mở Telegram headless"
      );
      currentPage = null;
    }
  }
  throw new Error("Không thể mở Telegram Web sau khi thử headed và headless.");
}

module.exports = {
  BOT_URL,
  isBotChatOpen,
  dismissTelegramTips,
  hardReloadTelegram,
  ensureBotChatOpen,
  sendBotCommand,
  sendTnCommand,
  getPaymentFrameLocator,
  inspectPaymentFrames,
  findMiniAppCloseButton,
  waitForMiniAppHidden,
  closeMiniApp,
  launchTelegramContext,
  openTelegramPage
};
