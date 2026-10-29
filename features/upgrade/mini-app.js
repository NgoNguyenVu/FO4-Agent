// Thao tác mini-app Auto Nâng Cấp 2.0: menu, cấu hình, chọn target, lọc phôi,
// kiểm tra cuối và bấm bắt đầu.
const { config } = require("../config");
const { isTelegramLoginPage } = require("../../lib/browser-session");
const {
  withTimeout,
  isBrowserSessionClosed
} = require("../../lib/playwright-utils");
const { MINI_APP_BLANK_TIMEOUT_MS } = require("../../lib/bot-patterns");
const {
  chatTextReaders,
  waitForChatChange
} = require("../../lib/chat-runtime");
const {
  countMatches,
  getFreshSince
} = require("../../lib/text-utils");
const {
  countBotSystemErrors,
  hasNewBotSystemError,
  countBotRateLimitNotices,
  getNewBotRateLimitDelay,
  getFreshRateLimitDelay
} = require("../../lib/bot-signals");
const { log } = require("../agent-log");
const {
  closeMiniApp,
  ensureBotChatOpen,
  getPaymentFrameLocator,
  inspectPaymentFrames
} = require("../telegram-io");
const { requestMenuWithTn } = require("../menu-request");
const {
  UG_MENU_BUTTON_RE,
  UG_MENU_EXACT,
  UG_CHECK_BUTTON_TEXT,
  UG_FINAL_START_TEXT,
  UG_FILTER_BUTTON_TEXT,
  isUpgradeModeOptionText,
  isManualUpgradeModeText,
  MINI_APP_LOAD_RETRIES,
  NC_MENU_WAIT_MS,
  UG_EMPTY_LIST_GRACE_MS,
  hasUpgradeTargetCards,
  hasUpgradeForm,
  isUpgradeTargetListExhausted,
  summarizeUpgradeTargetCards,
  shouldProtectBp,
  parseSelectedPhoiOvrs,
  verifyUpgradeFinalUi,
  hasRecentUpgradeMenu,
  hasFreshUpgradeMenu
} = require("./patterns");

async function findNcMenuButton(page) {
  const btns = page.locator(".reply-markup-button");
  let latest = null;
  let fallback = null;
  // Menu mới nhất nằm cuối danh sách DOM. Trước đây lấy nút khớp ĐẦU TIÊN nên
  // dễ bấm lại menu cũ đã hết hiệu lực -> iframe không mở, agent chờ 5 phút.
  for (let i = 0; i < (await btns.count()); i += 1) {
    const btn = btns.nth(i);
    let label = "";
    try { label = (await btn.innerText()).replace(/\s+/g, " ").trim(); }
    catch { continue; }
    if (UG_MENU_BUTTON_RE.test(label) && (await btn.isVisible())) latest = btn;
  }
  if (latest) return latest;
  const texts = page.getByText(UG_MENU_EXACT, { exact: false });
  for (let i = 0; i < (await texts.count()); i += 1) {
    const cand = texts.nth(i);
    if (!(await cand.isVisible())) continue;
    // Chỉ nhận phần tử bấm được. Nếu không, một tin nhắn văn bản có chữ
    // "Auto Nâng Cấp 2.0" sẽ bị coi là nút menu và bấm vào khoảng không.
    let clickable = false;
    try {
      clickable = await cand.evaluate((el) => {
        if (el.closest("button, [role='button'], .reply-markup-button")) return true;
        return el.tagName === "BUTTON" || el.getAttribute("role") === "button";
      });
    } catch { continue; }
    if (clickable) fallback = cand;
  }
  return fallback;
}

async function waitForNcMenuButton(page, timeoutMs, baseline) {
  const reader = chatTextReaders.get(page);
  if (!reader) throw new Error("Chưa khởi tạo theo dõi nội dung Telegram.");
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let snapshot = reader.snapshot();
  const heartbeat = setInterval(() => {
    log(
      `Đang chờ nút ${UG_MENU_EXACT} từ bot (${Math.round((Date.now() - startedAt) / 1000)}s/` +
        `${Math.round(timeoutMs / 1000)}s)...`
    );
  }, NC_MENU_WAIT_MS);
  try {
    while (Date.now() < deadline) {
      if (
        hasNewBotSystemError(snapshot.text, baseline.systemErrors) ||
        (baseline.text && countBotSystemErrors(getFreshSince(baseline.text, snapshot.text) || "") > 0)
      ) {
        return { status: "system-error" };
      }
      const fresh = baseline.text ? getFreshSince(baseline.text, snapshot.text) : null;
      const freshMenu = baseline.text
        ? hasFreshUpgradeMenu(baseline.text, snapshot.text)
        : hasRecentUpgradeMenu(snapshot.text);
      const menuCountIncreased =
        countMatches(snapshot.text, UG_MENU_BUTTON_RE) > (baseline.menuCount ?? 0);
      const replacedSnapshotHasMenu =
        fresh === null &&
        menuCountIncreased &&
        hasRecentUpgradeMenu(snapshot.text);
      if (freshMenu || replacedSnapshotHasMenu) {
        const button = await withTimeout(
          findNcMenuButton(page),
          60_000,
          "tìm nút Auto Nâng Cấp 2.0"
        );
        if (button) return { status: "menu", button };
      }
      const delay =
        getFreshRateLimitDelay(fresh) ??
        getNewBotRateLimitDelay(snapshot.text, baseline.rateLimit);
      if (delay !== null) return { status: "rate-limited", delay };
      const update = await waitForChatChange(page, reader, snapshot.version, deadline - Date.now());
      if (!update) break;
      snapshot = update;
    }
    return { status: "timeout" };
  } finally {
    clearInterval(heartbeat);
  }
}

async function waitForUpgradeFrameReady(page, timeoutMs) {
  const frame = getPaymentFrameLocator(page);
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let nextLogAt = startedAt + 15_000;
  let firstFrameAt = 0;
  let formReadySince = 0;
  let lastFrameInfo = "";
  let lastText = "";
  while (Date.now() < deadline) {
    let text = "";
    try {
      const { count, info } = await inspectPaymentFrames(page);
      if (count > 0) {
        if (!firstFrameAt) firstFrameAt = Date.now();
      } else {
        // Iframe bị gỡ tạm thời: đếm lại 15 giây cho lần mở kế tiếp.
        firstFrameAt = 0;
      }
      lastFrameInfo = info;
      text = await frame.locator("body").innerText({ timeout: 3000 });
      lastText = text;
      if (
        !text.trim() &&
        firstFrameAt &&
        Date.now() - firstFrameAt >= MINI_APP_BLANK_TIMEOUT_MS
      ) {
        // Iframe trắng không phải "đang tải chậm". getUpgradeFrame sẽ đóng và
        // thử lại menu hiện có (không gửi /tn); nếu vẫn trắng thì controller
        // tự reload Telegram Web.
        const error = new Error(
          `Iframe mini-app nâng cấp mở nhưng trắng (không có nội dung) sau ` +
            `${MINI_APP_BLANK_TIMEOUT_MS / 1_000} giây. ` +
            `Telegram: ${page.url()}. Iframe: ${lastFrameInfo}.`
        );
        error.code = "MINI_APP_BLANK";
        throw error;
      }
      if (hasUpgradeTargetCards(text)) return frame;
      // Danh sách rỗng vẫn là trạng thái hợp lệ (đã hết target): form cấu hình
      // render xong thì chờ thêm một nhịp ngắn để chắc danh sách không về muộn,
      // rồi trả frame để runner kết luận NO_UPGRADE_TARGETS. Không phụ thuộc
      // chữ "Đang tải" vì mini-app có thể kẹt spinner dù form đã render.
      if (hasUpgradeForm(text)) {
        if (!formReadySince) formReadySince = Date.now();
        if (Date.now() - formReadySince >= UG_EMPTY_LIST_GRACE_MS) {
          log(
            "Mini-app nâng cấp đã render form nhưng chưa có thẻ target sau " +
              `${Math.round(UG_EMPTY_LIST_GRACE_MS / 1000)}s; coi như danh sách rỗng.`
          );
          return frame;
        }
      } else {
        formReadySince = 0;
      }
    } catch (error) {
      formReadySince = 0;
      if (error.code === "MINI_APP_BLANK") throw error;
      if (isBrowserSessionClosed(error, page)) throw error;
      // chưa load xong
    }
    if (Date.now() >= nextLogAt) {
      let loginRequired = false;
      try {
        loginRequired = await isTelegramLoginPage(page);
      } catch { /* mini-app có thể đang thay DOM; bỏ qua lần này */ }
      if (loginRequired) {
        const error = new Error(
          "Telegram Web chưa đăng nhập; không thể mở mini-app Auto Nâng Cấp."
        );
        error.code = "TELEGRAM_LOGIN_REQUIRED";
        throw error;
      }
      log(
        `Đang chờ mini-app nâng cấp tải danh sách kho (${Math.round((Date.now() - startedAt) / 1000)}s/` +
          `${Math.round(timeoutMs / 1000)}s)... [${lastFrameInfo}]`
      );
      nextLogAt = Date.now() + 15_000;
    }
    await page.waitForTimeout(Math.min(1000, Math.max(1, deadline - Date.now())));
  }
  if (lastText) {
    log(
      `Nội dung mini-app nâng cấp sau timeout (${lastText.length} ký tự): ` +
        `${lastText.replace(/\s+/g, " ").slice(0, 180)}...`
    );
  }
  return null;
}

// Bấm "Tải lại" trong mini-app để đọc lại kho thật. Chỉ trả true khi thấy loader
// của mini-app bật rồi tắt; nếu không thấy loader thì DOM có thể vẫn là dữ liệu
// cũ, không được dùng để kết luận "đã hết target".
async function reloadUpgradeTargetList(frame, page, timeoutMs) {
  const button = frame.locator("#reloadPlayersBtn");
  if ((await button.count().catch(() => 0)) === 0) return false;
  if (!(await button.isVisible().catch(() => false))) return false;
  if (!(await button.isEnabled().catch(() => false))) return false;
  await button.click({ timeout: 5_000 });
  await page.waitForTimeout(150);
  let loading = await frame.locator("#loader").isVisible().catch(() => false);
  if (!loading) return false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(250);
    loading = await frame.locator("#loader").isVisible().catch(() => false);
    if (!loading) {
      // renderTargetList chạy ngay sau fetchAllPlayerInfo; chờ một nhịp ngắn để
      // danh sách mới ổn định trước khi đếm thẻ.
      await page.waitForTimeout(500);
      return true;
    }
  }
  return false;
}

// Kiểm tra kho hiện tại của mini-app nâng cấp. Chỉ kết luận "exhausted" khi:
// - form nâng cấp còn render;
// - không có bộ lọc tìm kiếm do người dùng nhập;
// - vừa tải lại kho thật (thấy loader), không có banner lỗi;
// - không còn thẻ ICON nào dưới target;
// - không có thẻ nào đang bị khóa/training (tránh nhầm target đang chạy).
// KHÔNG đòi mode manual/target grade trên UI: khi iframe tự đóng rồi được mở
// lại, app khởi tạo mode auto_buy_upgrade và target +5, nhưng danh sách target
// vẫn là dữ liệu thật. Spec của agent (targetGrade) được áp dụng khi đọc card,
// không phụ thuộc giá trị mặc định của app.
async function inspectUpgradeTargetAvailability(frame, page, spec) {
  const body = await frame.locator("body").innerText({ timeout: 5_000 });
  if (!hasUpgradeForm(body)) return { status: "unknown", reason: "form-not-ready" };
  if (await frame.locator("#loader").isVisible().catch(() => false)) {
    return { status: "unknown", reason: "loading" };
  }
  const search = await frame.locator("#searchText").inputValue().catch(() => "");
  if (String(search || "").trim()) {
    return { status: "unknown", reason: "search-filter" };
  }
  if (!(await reloadUpgradeTargetList(frame, page, config.upgradeFrameTimeoutSeconds * 1000))) {
    return { status: "unknown", reason: "reload-not-observed" };
  }
  const after = await frame.locator("body").innerText({ timeout: 5_000 });
  if (!hasUpgradeForm(after)) return { status: "unknown", reason: "form-lost" };
  if (await frame.locator("#errorBanner").isVisible().catch(() => false)) {
    return { status: "unknown", reason: "reload-error" };
  }
  // Người dùng có thể gõ vào ô tìm kiếm trong lúc reload; đọc lại sau reload
  // để không kết luận "hết target" từ danh sách đang bị lọc.
  const searchAfter = await frame.locator("#searchText").inputValue().catch(() => "");
  if (String(searchAfter || "").trim()) {
    return { status: "unknown", reason: "search-filter" };
  }
  const cards = await readUpgradeTargetCards(frame);
  const summary = summarizeUpgradeTargetCards(cards, spec.targetGrade);
  return {
    status: isUpgradeTargetListExhausted(cards, spec.targetGrade)
      ? "exhausted"
      : "has-targets",
    cards: cards.length,
    summary
  };
}

async function requestUpgradeMenu(page, rl) {
  const response = await requestMenuWithTn(page, rl, {
    label: UG_MENU_EXACT,
    waitForMenu: waitForNcMenuButton,
    buildBaseline: (snapshotText) => ({
      systemErrors: countBotSystemErrors(snapshotText),
      rateLimit: countBotRateLimitNotices(snapshotText),
      menuCount: countMatches(snapshotText, UG_MENU_BUTTON_RE),
      text: snapshotText
    })
  });
  if (!response || response.status === "timeout" || response.status === "rate-limited") {
    const error = new Error(
      `Bot chưa trả menu có nút ${UG_MENU_EXACT} trong ` +
        `${config.menuResponseTimeoutSeconds} giây ` +
        "(có thể bot chậm hoặc /tn bị rate-limit)."
    );
    error.code = "MENU_BUSY";
    error.userMessage = error.message;
    throw error;
  }
  if (response.status === "system-error") {
    const error = new Error("Bot trả E006 cho /tn; nâng cấp tự dừng.");
    error.code = "BOT_SYSTEM_ERROR";
    throw error;
  }
  if (!response.button) throw new Error(`Không tìm thấy nút ${UG_MENU_EXACT}.`);
  return response.button;
}

async function clickUpgradeMenu(page, rl, forceTn) {
  let menuButton = forceTn
    ? null
    : await withTimeout(findNcMenuButton(page), 60_000, "tìm nút Auto Nâng Cấp 2.0");
  let fresh = forceTn || !menuButton;
  if (!menuButton) menuButton = await requestUpgradeMenu(page, rl);
  try {
    await withTimeout(menuButton.click(), 60_000, "bấm nút Auto Nâng Cấp 2.0");
  } catch (error) {
    // Nút cũ vừa bị Telegram thay bằng menu mới: chỉ lấy menu mới một lần.
    if (fresh || isBrowserSessionClosed(error, page)) throw error;
    log("Nút Auto Nâng Cấp cũ không bấm được; gửi /tn lấy menu mới.");
    menuButton = await requestUpgradeMenu(page, rl);
    await withTimeout(menuButton.click(), 60_000, "bấm nút Auto Nâng Cấp 2.0");
  }
}

async function openUpgradeFrame(page, rl, forceTn = false) {
  await withTimeout(dismissGoodLuckPopup(page, 3000), 30_000, "dọn popup cũ").catch(() => false);
  // forceTn chỉ dùng khi lần trước bấm menu mà iframe không hề mở: menu có thể
  // đã cũ. Iframe trắng thì giữ menu, chỉ đóng rồi bấm lại.
  const existing = getPaymentFrameLocator(page);
  if (!forceTn) {
    try {
      const checkBtn = existing.getByRole("button", { name: UG_CHECK_BUTTON_TEXT });
      if (await checkBtn.isVisible()) {
        const ready = await waitForUpgradeFrameReady(page, 15_000);
        if (ready) return ready;
      }
    } catch (error) {
      if (error.code === "MINI_APP_BLANK") throw error;
      /* mở mới */
    }
  }
  // Iframe còn mở nhưng không phải form nâng cấp (ví dụ mini-app mua sót lại
  // sau /stopagent) sẽ che menu chat và khiến lần mở này đọc nhầm body.
  await closeMiniApp(page).catch(() => {});
  await clickUpgradeMenu(page, rl, forceTn);
  const frame = await waitForUpgradeFrameReady(page, config.upgradeFrameTimeoutSeconds * 1_000);
  if (!frame) {
    // Phân biệt iframe không hề mở (menu có thể cũ -> cần /tn mới) với iframe
    // đã mở nhưng UI chưa render (giữ menu, chỉ đóng và bấm lại).
    let frameCount = 0;
    try { frameCount = (await inspectPaymentFrames(page)).count; } catch { /* bỏ qua */ }
    const error = new Error(
      `Mini-app nâng cấp không tải xong danh sách kho trong ${config.upgradeFrameTimeoutSeconds} giây.`
    );
    error.code = frameCount > 0 ? "MINI_APP_UI_NOT_READY" : "MINI_APP_LOAD_TIMEOUT";
    throw error;
  }
  return frame;
}

// Mở lại mini-app chỉ để đọc trạng thái target khi iframe đã tự đóng sau khi
// bắt đầu nâng. Chỉ dùng nút menu còn trong chat, KHÔNG gửi /tn; không thấy
// menu thì trả null để waitForUpgradeCompletion tiếp tục chờ bot.
async function openUpgradeFrameForCheck(page) {
  await withTimeout(dismissGoodLuckPopup(page, 2000), 10_000, "dọn popup trước khi kiểm tra")
    .catch(() => false);
  let frameInfo = null;
  try {
    frameInfo = await inspectPaymentFrames(page);
  } catch { /* thử mở menu bên dưới */ }
  if (frameInfo?.count > 0 && frameInfo.visible) {
    return getPaymentFrameLocator(page);
  }
  // Iframe cũ còn trong DOM nhưng đang ẩn: dọn trước để lần bấm menu mở iframe
  // mới thật sự, tránh đọc nhầm nội dung cũ.
  await closeMiniApp(page).catch(() => {});
  // Telegram có thể reset về trang chủ trong lúc chờ bot. Mở lại chat bot trước
  // khi tìm menu, nhưng tuyệt đối không gửi /tn ở bước kiểm tra này.
  let chatReopened = false;
  try {
    chatReopened = await ensureBotChatOpen(page);
  } catch { /* không có chat/menu thì bỏ qua, tiếp tục chờ bot */ }
  let menuButton = null;
  // Chat vừa được mở lại có thể chưa render xong bàn phím menu; thử đọc lại
  // trong vài giây thay vì kết luận "không có menu" ngay lập tức.
  const menuAttempts = chatReopened ? 5 : 1;
  for (let attempt = 0; attempt < menuAttempts && !menuButton; attempt += 1) {
    if (attempt > 0) await page.waitForTimeout(1_000);
    try {
      menuButton = await withTimeout(
        findNcMenuButton(page),
        20_000,
        "tìm menu Auto Nâng Cấp để kiểm tra target"
      );
    } catch { /* thử lại nếu vừa mở lại chat */ }
  }
  if (!menuButton) return null;
  try {
    await withTimeout(menuButton.click(), 20_000, "mở lại mini-app nâng cấp để kiểm tra");
  } catch {
    return null;
  }
  return waitForUpgradeFrameReady(page, config.upgradeFrameTimeoutSeconds * 1_000)
    .catch(() => null);
}

async function getUpgradeFrame(page, rl) {
  let forceTn = false;
  for (let retry = 0; ; retry += 1) {
    try {
      return await openUpgradeFrame(page, rl, forceTn);
    } catch (error) {
      const retryable =
        error.code === "MINI_APP_LOAD_TIMEOUT" ||
        error.code === "MINI_APP_UI_NOT_READY" ||
        error.code === "MINI_APP_BLANK";
      if (!retryable || retry >= MINI_APP_LOAD_RETRIES) throw error;
      forceTn = error.code === "MINI_APP_LOAD_TIMEOUT";
      log(
        forceTn
          ? "Mini-app nâng cấp không mở; gửi /tn lấy menu mới rồi thử lại một lần."
          : error.code === "MINI_APP_BLANK"
            ? "Iframe nâng cấp trắng; đóng và thử lại menu hiện có (không gửi /tn nếu nút còn)."
            : "Iframe nâng cấp đã mở nhưng UI chưa sẵn sàng; đóng và thử lại menu hiện có (không gửi /tn nếu nút còn)."
      );
    }
  }
}

// Mở các mục "Cài đặt nâng cao" một cách idempotent. Tuyệt đối không click
// summary nếu section đã mở: app dùng <details>, click lần hai sẽ đóng section
// và làm nút chọn mode biến mất (bug 2026-10-26). Đặt trực tiếp details.open
// vừa nhanh vừa không phụ thuộc animation/scroll.
async function expandUpgradeAdvanced(frame, page) {
  let matchedDetails = 0;
  try {
    matchedDetails = await frame.locator("body").evaluate((body) => {
      const LABELS = ["kiểu chạy", "tỉ lệ", "về phôi"];
      const doc = body.ownerDocument;
      let matched = 0;
      for (const details of doc.querySelectorAll("details")) {
        const summary = details.querySelector("summary");
        const text = String(
          (summary && (summary.innerText || summary.textContent)) || ""
        )
          .replace(/\s+/g, " ")
          .trim()
          .toLocaleLowerCase();
        if (!LABELS.some((label) => text.includes(label))) continue;
        matched += 1;
        if (!details.open) details.open = true;
      }
      return matched;
    });
  } catch {
    matchedDetails = 0;
  }
  if (matchedDetails > 0) {
    await page.waitForTimeout(400);
    return true;
  }

  // Fallback cho UI cũ không dùng <details>. Chỉ click khi biết section đang
  // đóng; nếu không đọc được trạng thái thì click một lần như hành vi cũ.
  let clicked = false;
  for (const label of ["kiểu chạy", "tỉ lệ", "về phôi"]) {
    const loc = frame.getByText(label, { exact: false });
    for (let i = 0; i < (await loc.count().catch(() => 0)); i += 1) {
      try {
        const text = (await loc.nth(i).innerText()).replace(/\s+/g, " ").trim();
        if (text.length >= 60 || !(await loc.nth(i).isVisible())) continue;
        const alreadyOpen = await loc.nth(i).evaluate((el) => {
          const details = el.closest("details");
          if (details) return details.open;
          const expanded = el.closest("[aria-expanded]");
          if (expanded) return expanded.getAttribute("aria-expanded") === "true";
          return null;
        }).catch(() => null);
        if (alreadyOpen === true) break;
        await loc.nth(i).click({ timeout: 3000 });
        clicked = true;
        break;
      } catch { /* mục tiếp theo */ }
    }
    await page.waitForTimeout(500);
  }
  return clicked;
}

async function readUpgradeBody(frame, timeout = 8000) {
  return frame.locator("body").innerText({ timeout });
}

async function waitForManualUpgradeMode(frame, page, timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const body = await readUpgradeBody(frame, 4000);
    if (isManualUpgradeModeText(body)) return true;
    if (Date.now() >= deadline) return false;
    await page.waitForTimeout(250);
  }
}

async function selectManualUpgradeMode(frame, page) {
  await expandUpgradeAdvanced(frame, page);
  const manual = frame.locator("#modeManual");
  const manualCount = await manual.count().catch(() => 0);
  if (manualCount > 0) {
    if (!(await manual.isVisible().catch(() => false))) return false;
    try {
      await manual.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      await manual.click({ timeout: 3000 });
    } catch {
      // Nút bị overlay/iframe đang đổi; để configure thử lại hoặc mở iframe mới
      // thay vì tiếp tục quét 197 button và bấm mù.
      return false;
    }
    return await waitForManualUpgradeMode(frame, page, 2500);
  }

  // Fallback cho app cũ không có id modeManual.
  const buttons = frame.getByRole("button");
  for (let i = 0; i < (await buttons.count().catch(() => 0)); i += 1) {
    try {
      const text = (await buttons.nth(i).innerText()).replace(/\s+/g, " ").trim();
      if (!isUpgradeModeOptionText(text)) continue;
      if (!(await buttons.nth(i).isVisible())) continue;
      await buttons.nth(i).click({ timeout: 3000 });
      return await waitForManualUpgradeMode(frame, page, 2500);
    } catch { /* thử nút tiếp theo */ }
  }
  return false;
}

async function readUpgradeInputs(frame) {
  return frame.locator("body").evaluate((body) => {
    const doc = body.ownerDocument;
    return [...doc.querySelectorAll("input")].map((el, i) => ({
      i,
      label: ((el.labels && el.labels[0] && el.labels[0].innerText) || el.placeholder || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 80),
      value: (el.value || "").slice(0, 40),
      checked: !!el.checked,
      type: el.type || "text",
      visible: !!(el.offsetWidth || el.offsetHeight)
    }));
  });
}

async function fillUpgradeInput(frame, page, labelPart, value) {
  for (let r = 0; r < 4; r += 1) {
    // App có thể re-render và đóng các <details> sau khi đổi mode. Mở lại
    // idempotent trước mỗi lần đọc để input cần điền luôn hiển thị.
    await expandUpgradeAdvanced(frame, page);
    const inputs = await readUpgradeInputs(frame).catch(() => null);
    if (!inputs) { await page.waitForTimeout(1500); continue; }
    const hit = inputs.find((m) => m.visible && m.label.includes(labelPart));
    if (!hit) throw new Error(`Không tìm thấy ô nhập "${labelPart}" đang hiển thị trong mini-app nâng cấp.`);
    try {
      await frame.locator("input").nth(hit.i).fill(String(value), { timeout: 6000 });
      const back = await readUpgradeInputs(frame).catch(() => null);
      const chk = back && back.find((m) => m.label.includes(labelPart));
      if (chk && chk.value === String(value)) return;
    } catch { /* thử lại sau re-render */ }
    await page.waitForTimeout(1500);
  }
  throw new Error(`Không điền được "${labelPart}" = ${value} sau nhiều lần thử.`);
}

async function setUpgradeCheckbox(frame, page, labelPart, checked) {
  for (let r = 0; r < 4; r += 1) {
    const inputs = await readUpgradeInputs(frame).catch(() => null);
    if (!inputs) { await page.waitForTimeout(1500); continue; }
    const hit = inputs.find((m) => m.visible && m.label.includes(labelPart));
    if (!hit) throw new Error(`Không tìm thấy checkbox "${labelPart}" đang hiển thị.`);
    if (!!hit.checked === !!checked) return;
    try {
      if (checked) await frame.locator("input").nth(hit.i).check({ timeout: 4000 });
      else await frame.locator("input").nth(hit.i).uncheck({ timeout: 4000 });
    } catch { /* thử force */ }
    try {
      if (checked) await frame.locator("input").nth(hit.i).check({ timeout: 4000, force: true });
      else await frame.locator("input").nth(hit.i).uncheck({ timeout: 4000, force: true });
    } catch { /* thử JS-set trực tiếp */ }
    try {
      await frame.locator("input").nth(hit.i).evaluate((el, want) => {
        el.checked = !!want;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, checked);
    } catch { /* đọc lại trạng thái bên dưới */ }
    await page.waitForTimeout(1200);
    const after = await readUpgradeInputs(frame).catch(() => null);
    const now = after && after.find((m) => m.label.includes(labelPart));
    if (now && !!now.checked === !!checked) return;
  }
  throw new Error(`Không đặt được checkbox "${labelPart}".`);
}

async function configureUpgradeFrame(frame, page, spec) {
  const protectBp = shouldProtectBp(spec.targetGrade, spec.bpProtectFromGrade);
  let modeSet = false;
  // Đọc mode hiện tại trước, rồi chỉ mở <details> và bấm #modeManual. Không
  // quét toàn bộ button (có hàng trăm card) và không click summary lặp lại.
  for (let attempt = 0; attempt < 4 && !modeSet; attempt += 1) {
    let frameInfo = null;
    try { frameInfo = await inspectPaymentFrames(page); } catch { /* Telegram đang đổi DOM */ }
    if (frameInfo && (frameInfo.count === 0 || !frameInfo.visible)) {
      log("Mini-app nâng cấp không còn hiển thị trong lúc cấu hình; mở lại iframe.");
      break;
    }
    if (await waitForManualUpgradeMode(frame, page, attempt === 0 ? 1500 : 500)) {
      modeSet = true;
      break;
    }
    if (await selectManualUpgradeMode(frame, page)) {
      modeSet = true;
      break;
    }
    await page.waitForTimeout(700);
  }
  if (!modeSet) {
    const bodyText = await readUpgradeBody(frame).catch(() => "");
    const manualVisible = await frame
      .locator("#modeManual")
      .isVisible()
      .catch(() => false);
    const frameInfo = await inspectPaymentFrames(page).catch(() => null);
    log(
      `Mini-app nâng chưa chọn được mode thủ công ` +
        `(body ${bodyText.length} ký tự, #modeManual ${manualVisible ? "hiện" : "ẩn"}, ` +
        `iframe ${frameInfo ? frameInfo.info : "không đọc được"}); mở lại mini-app.`
    );
    const error = new Error(
      "Mini-app nâng chưa render/chọn được mode tự chọn phôi sau khi tải " +
        `(body ${bodyText.length} ký tự).`
    );
    error.code = "UPGRADE_MODE_LOAD_TIMEOUT";
    throw error;
  }
  // Đổi mode làm app re-render; mở lại toàn bộ mục nâng cao trước khi điền
  // các input nằm trong <details>.
  await expandUpgradeAdvanced(frame, page);
  let bodyText = "";
  try { bodyText = await readUpgradeBody(frame); } catch { bodyText = ""; }
  if (!isManualUpgradeModeText(bodyText)) {
    const error = new Error(
      "Mini-app chưa chuyển sang mode thủ công sau khi bấm chọn; mở lại mini-app."
    );
    error.code = "UPGRADE_MODE_LOAD_TIMEOUT";
    throw error;
  }
  await fillUpgradeInput(frame, page, "Thời gian chờ giữa mỗi lần nâng", String(spec.waitMs));
  await fillUpgradeInput(frame, page, "Tỉ lệ tối thiểu", String(spec.minRatio));
  await fillUpgradeInput(frame, page, "OVR phôi", spec.ovrPhoi);
  {
    const inputs = await readUpgradeInputs(frame).catch(() => null);
    const prices = (inputs || []).filter((m) => m.visible && /Giá tối đa/.test(m.label));
    if (!prices.length) throw new Error("Không tìm thấy ô giá tối đa phôi đang hiển thị.");
    for (const m of prices) {
      await fillUpgradeInput(frame, page, m.label, spec.maxPriceEach);
    }
  }
  const combos = frame.getByRole("combobox");
  let gradeSet = false;
  for (let i = 0; i < (await combos.count().catch(() => 0)); i += 1) {
    try {
      const text = (await combos.nth(i).innerText()).replace(/\s+/g, " ").trim();
      if (/\+2.*\+13/.test(text)) {
        await combos.nth(i).selectOption({ label: `+${spec.targetGrade}` });
        gradeSet = true;
        break;
      }
    } catch { /* mục tiếp theo */ }
  }
  if (!gradeSet) throw new Error(`Không đặt được mục tiêu +${spec.targetGrade}.`);
  await setUpgradeCheckbox(frame, page, "BP Protection", protectBp);
  log(
    `Đã cấu hình nâng cấp: mode thủ công, target +${spec.targetGrade}, ` +
      `OVR ${spec.ovrPhoi}, giá ${spec.maxPriceEach}, chờ ${spec.waitMs}ms, ` +
      `tỉ lệ ${spec.minRatio}%, bảo vệ BP ${protectBp ? "BẬT" : "TẮT"}.`
  );
}

async function selectUpgradeTarget(frame, page, target) {
  const buttons = frame.getByRole("button");
  const idRe = new RegExp(`_id:\\s*${target.id}`, "i");
  for (let i = 0; i < (await buttons.count().catch(() => 0)); i += 1) {
    let text = "";
    try {
      text = (await buttons.nth(i).innerText()).replace(/\s+/g, " ").trim();
    } catch { continue; }
    if (!idRe.test(text)) continue;
    if (/KHÓA/.test(text)) throw new Error(`Cầu thủ ${target.id} đang bị KHÓA CHỌN.`);
    if (!(await buttons.nth(i).isEnabled())) throw new Error(`Cầu thủ ${target.id} không bấm được.`);
    await buttons.nth(i).click({ timeout: 8000 });
    log(`Đã chọn cầu thủ chính ${target.name} (+${target.grade}).`);
    return;
  }
  throw new Error(`Không tìm thấy cầu thủ _id:${target.id} trong danh sách.`);
}

async function filterUpgradePhoi(frame, page, allowedOvrs) {
  const loc = frame.getByText(UG_FILTER_BUTTON_TEXT, { exact: false });
  let clicked = false;
  for (let i = 0; i < (await loc.count().catch(() => 0)); i += 1) {
    try {
      if (await loc.nth(i).isVisible()) {
        await loc.nth(i).click({ timeout: 6000 });
        clicked = true;
        break;
      }
    } catch { /* mục tiếp theo */ }
  }
  if (!clicked) throw new Error("Không bấm được nút lọc phôi từ kho.");
  await page.waitForTimeout(2500);
  let text = "";
  try { text = await frame.locator("body").innerText({ timeout: 8000 }); } catch { text = ""; }
  const m = text.match(/Đã chọn (\d+) phôi/);
  const count = m ? Number(m[1]) : 0;
  if (count < 1) {
    const error = new Error("Lọc phôi xong nhưng chưa có phôi nào được chọn.");
    error.code = "NO_UPGRADE_MATERIALS";
    throw error;
  }
  const cardTexts = await frame.locator("body").evaluate((body) => {
    const doc = body.ownerDocument;
    return [...doc.querySelectorAll("button")].map((b) =>
      (b.innerText || "").replace(/\s+/g, " ").trim().slice(0, 200)
    );
  }).catch(() => []);
  const selectedOvrs = parseSelectedPhoiOvrs(cardTexts);
  const allowed = new Set(allowedOvrs);
  const offenders = selectedOvrs.filter((ovr) => !allowed.has(ovr));
  if (offenders.length) {
    throw new Error(
      `Phôi đã chọn sai OVR cho phép (${[...allowed].join(",")}): ${offenders.join(",")}.`
    );
  }
  log(`Bot đã chọn ${count} phôi từ kho (OVR khớp spec).`);
  return count;
}

async function checkUpgradeAndStart(frame, page, spec, phoiCount) {
  const loc = frame.getByText(UG_CHECK_BUTTON_TEXT, { exact: false });
  let clicked = false;
  for (let i = 0; i < (await loc.count().catch(() => 0)); i += 1) {
    try {
      const text = (await loc.nth(i).innerText()).replace(/\s+/g, " ").trim();
      if (text === UG_CHECK_BUTTON_TEXT && (await loc.nth(i).isVisible())) {
        await loc.nth(i).click({ timeout: 8000 });
        clicked = true;
        break;
      }
    } catch { /* mục tiếp theo */ }
  }
  if (!clicked) throw new Error("Không bấm được nút kiểm tra & bắt đầu.");
  await page.waitForTimeout(4000);
  let text = "";
  try { text = await frame.locator("body").innerText({ timeout: 8000 }); } catch { text = ""; }
  verifyUpgradeFinalUi(text, spec, phoiCount);
  log("UI kiểm tra cuối khớp spec.");
  return text;
}

async function pressUpgradeStart(frame) {
  const buttons = frame.getByRole("button");
  for (let i = 0; i < (await buttons.count().catch(() => 0)); i += 1) {
    let text = "";
    try {
      text = (await buttons.nth(i).innerText()).replace(/\s+/g, " ").trim();
    } catch { continue; }
    if (text === UG_FINAL_START_TEXT && (await buttons.nth(i).isVisible()) && (await buttons.nth(i).isEnabled())) {
      await buttons.nth(i).click({ timeout: 8000 });
      log("Đã bấm bắt đầu nâng cấp.");
      return;
    }
  }
  throw new Error("Không tìm thấy nút bắt đầu nâng cấp ở UI kiểm tra cuối.");
}

// Sau khi bấm bắt đầu, mini-app/Telegram có thể hiện popup "Chúc bạn may mắn"
// che màn hình. Đóng nó để không cản các thao tác sau (mở menu, mini-app...).
// Không thấy popup thì bỏ qua, không bao giờ throw.
async function dismissGoodLuckPopup(page, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const text = page.getByText("Chúc bạn may mắn", { exact: false });
      if ((await text.count()) > 0 && (await text.first().isVisible().catch(() => false))) {
        const closeBtns = page.getByRole("button", { name: "CLOSE" });
        const n = await closeBtns.count().catch(() => 0);
        for (let i = n - 1; i >= 0; i -= 1) {
          try {
            if (await closeBtns.nth(i).isVisible()) {
              await closeBtns.nth(i).click({ timeout: 4000 });
              return true;
            }
          } catch { /* nút tiếp theo */ }
        }
        return false;
      }
    } catch { /* thử lại cho tới hết timeout */ }
    try {
      await page.waitForTimeout(500);
    } catch {
      return false;
    }
  }
  return false;
}

async function readUpgradeTargetCards(frame) {
  return frame.locator("body").evaluate((body) => {
    const doc = body.ownerDocument;
    const out = [];
    // Chỉ đọc #targetsList. Trước đây quét toàn bộ button nên mỗi cầu thủ
    // reserve bị đọc thêm một lần từ #materialsList, làm summary báo hàng trăm
    // "trùng" và có thể lấy nhầm bản card không có badge ICON.
    const root = doc.querySelector("#targetsList") || doc.body;
    for (const b of root.querySelectorAll("button")) {
      const t = (b.innerText || "").replace(/\s+/g, " ").trim();
      if (!/_id:/.test(t)) continue;
      out.push({
        text: t.slice(0, 160),
        disabled: !!b.disabled,
        imgSrcs: [...b.querySelectorAll("img")].map((img) => img.src || "")
      });
    }
    return out;
  });
}

module.exports = {
  findNcMenuButton,
  waitForNcMenuButton,
  waitForUpgradeFrameReady,
  openUpgradeFrame,
  getUpgradeFrame,
  openUpgradeFrameForCheck,
  inspectUpgradeTargetAvailability,
  reloadUpgradeTargetList,
  expandUpgradeAdvanced,
  readUpgradeInputs,
  fillUpgradeInput,
  setUpgradeCheckbox,
  configureUpgradeFrame,
  selectUpgradeTarget,
  filterUpgradePhoi,
  checkUpgradeAndStart,
  pressUpgradeStart,
  dismissGoodLuckPopup,
  readUpgradeTargetCards
};
