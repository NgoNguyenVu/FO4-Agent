// Thao tác mini-app "Nâng Cấp Cầu Thủ" (đã calibrate DOM thực tế 2026-11-25).
"use strict";

const { config } = require("../config");
const {
  withTimeout,
  isBrowserSessionClosed
} = require("../../lib/playwright-utils");
const {
  chatTextReaders,
  waitForChatChange
} = require("../../lib/chat-runtime");
const {
  countBotSystemErrors,
  hasNewBotSystemError,
  countBotRateLimitNotices,
  getNewBotRateLimitDelay,
  getFreshRateLimitDelay
} = require("../../lib/bot-signals");
const { getFreshSince, countMatches } = require("../../lib/text-utils");
const { requestMenuWithTn } = require("../menu-request");
const { log } = require("../agent-log");
const {
  closeMiniApp,
  getPaymentFrameLocator,
  inspectPaymentFrames,
  ensureBotChatOpen
} = require("../telegram-io");
const {
  isBaitMenuButton,
  hasRecentBaitMenu,
  normalizeUiText,
  parseBaitUi
} = require("./patterns");

const BAIT_LABEL_BUTTONS = Object.freeze({
  chooseMain: "Chọn cầu thủ chính",
  plus: "+",
  upgrade: "Nâng cấp",
  soiRandom: "Dựa trên chỉ số Random",
  soiGrade: "Dựa trên mức thẻ mới",
  soiBoth: "Dựa trên chỉ số Random và Mức Thẻ Mới"
});

async function findBaitMenuButton(page) {
  const buttons = page.locator(".reply-markup-button");
  let latest = null;
  const count = await buttons.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    const text = await button.innerText().catch(() => "");
    if (!isBaitMenuButton(text)) continue;
    if (await button.isVisible().catch(() => false)) latest = button;
  }
  return latest;
}

async function waitForBaitMenuButton(page, timeoutMs, baseline) {
  const reader = chatTextReaders.get(page);
  if (!reader) throw new Error("Chưa khởi tạo theo dõi nội dung Telegram.");
  const deadline = Date.now() + timeoutMs;
  let snapshot = reader.snapshot();
  while (Date.now() < deadline) {
    if (
      hasNewBotSystemError(snapshot.text, baseline.systemErrors) ||
      (baseline.text && countBotSystemErrors(getFreshSince(baseline.text, snapshot.text) || "") > 0)
    ) {
      return { status: "system-error" };
    }
    const fresh = baseline.text ? getFreshSince(baseline.text, snapshot.text) : null;
    if (
      (fresh && hasRecentBaitMenu(fresh)) ||
      (!baseline.text && hasRecentBaitMenu(snapshot.text))
    ) {
      const button = await withTimeout(findBaitMenuButton(page), 30_000, "tìm nút Nâng Cấp Cầu Thủ");
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
}

async function requestBaitMenu(page, rl) {
  const response = await requestMenuWithTn(page, rl, {
    label: "Nâng Cấp Cầu Thủ",
    waitForMenu: waitForBaitMenuButton,
    buildBaseline: (text) => ({
      systemErrors: countBotSystemErrors(text),
      rateLimit: countBotRateLimitNotices(text),
      text
    })
  });
  if (response?.status === "system-error") {
    const error = new Error("Bot trả E006 khi lấy menu Nâng Cấp Cầu Thủ.");
    error.code = "BOT_SYSTEM_ERROR";
    throw error;
  }
  if (!response || response.status === "timeout" || response.status === "rate-limited") {
    const error = new Error("Bot chưa trả menu Nâng Cấp Cầu Thủ.");
    error.code = "MENU_BUSY";
    throw error;
  }
  if (!response.button) throw new Error("Không tìm thấy nút Nâng Cấp Cầu Thủ.");
  return response.button;
}

async function waitForBaitFrame(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastText = "";
  while (Date.now() < deadline) {
    if (await isTelegramLoginRequired(page)) {
      const error = new Error("Telegram Web chưa đăng nhập.");
      error.code = "TELEGRAM_LOGIN_REQUIRED";
      throw error;
    }
    const info = await inspectPaymentFrames(page).catch(() => null);
    if (info?.count > 0) {
      const frame = getPaymentFrameLocator(page);
      lastText = await frame.locator("body").innerText({ timeout: 3000 }).catch(() => "");
      if (/ERR_NGROK|upstream web service/i.test(lastText)) {
        const error = new Error("Mini-app bot down.");
        error.code = "MINI_APP_SERVER_DOWN";
        throw error;
      }
      if (lastText.includes("Mốc Random") && lastText.includes("Nguyên liệu")) return frame;
    }
    await page.waitForTimeout(500);
  }
  const error = new Error(`Mini-app Nâng Cấp Cầu Thủ không sẵn sàng: ${lastText.slice(0, 120)}`);
  error.code = "MINI_APP_UI_NOT_READY";
  throw error;
}

async function isTelegramLoginRequired(page) {
  try {
    const text = await page.locator("body").innerText({ timeout: 2000 });
    return /Log in by QR Code|LOG IN BY PHONE NUMBER/i.test(text);
  } catch {
    return false;
  }
}

async function openBaitFrame(page, rl) {
  let button = await withTimeout(findBaitMenuButton(page), 20_000, "tìm menu Nâng Cấp Cầu Thủ")
    .catch(() => null);
  if (!button) {
    try { await ensureBotChatOpen(page); } catch { /* bỏ qua */ }
    button = await requestBaitMenu(page, rl);
  }
  await closeMiniApp(page).catch(() => {});
  await withTimeout(button.click(), 45_000, "bấm nút Nâng Cấp Cầu Thủ");
  return waitForBaitFrame(page, config.upgradeFrameTimeoutSeconds * 1_000);
}

async function readBaitUi(frame, targetGrade = 7) {
  const text = await frame.locator("body").innerText({ timeout: 8000 }).catch(() => "");
  return parseBaitUi(text, targetGrade);
}

async function findButtonByLabel(frame, label) {
  const buttons = frame.locator("button");
  const count = await buttons.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const raw = await buttons.nth(i).innerText().catch(() => "");
    if (normalizeUiText(raw) === label) return buttons.nth(i);
  }
  return null;
}

async function clickBaitButton(frame, label) {
  const button = await findButtonByLabel(frame, label);
  if (!button || !(await button.isVisible().catch(() => false))) {
    throw new Error(`Không thấy nút "${label}" trong mini-app nâng cấp thủ công.`);
  }
  await button.click({ timeout: 8000 });
}

async function readPlayerCards(frame) {
  const text = await frame.locator("body").innerText({ timeout: 8000 }).catch(() => "");
  return text;
}

async function selectPlayerCard(frame, cardName) {
  const buttons = frame.locator("button");
  const count = await buttons.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const raw = await buttons.nth(i).innerText().catch(() => "");
    if (normalizeUiText(raw) === normalizeUiText(cardName)) {
      await buttons.nth(i).click({ timeout: 8000 });
      return;
    }
  }
  throw new Error(`Không tìm thấy thẻ ${cardName} trong danh sách cầu thủ.`);
}

async function addBaitMaterial(frame, times = 1) {
  for (let i = 0; i < times; i += 1) {
    await clickBaitButton(frame, BAIT_LABEL_BUTTONS.plus);
    await frame.page().waitForTimeout(250);
  }
}

async function clickSoiCau(frame, which = "both") {
  const label =
    which === "random"
      ? BAIT_LABEL_BUTTONS.soiRandom
      : which === "grade"
        ? BAIT_LABEL_BUTTONS.soiGrade
        : BAIT_LABEL_BUTTONS.soiBoth;
  await clickBaitButton(frame, label);
}

// Chỉ gọi sau khi lib/bait-decision.finalizeDecision đã chốt guardToken.
async function clickBaitUpgrade(frame) {
  await clickBaitButton(frame, BAIT_LABEL_BUTTONS.upgrade);
  await frame.page().waitForTimeout(400);
}

module.exports = {
  BAIT_LABEL_BUTTONS,
  findBaitMenuButton,
  hasRecentBaitMenu,
  openBaitFrame,
  readBaitUi,
  findButtonByLabel,
  clickBaitButton,
  readPlayerCards,
  selectPlayerCard,
  addBaitMaterial,
  clickSoiCau,
  clickBaitUpgrade
};
