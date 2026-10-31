// Mở đúng luồng "Chèn Member Thường -> Mua cầu thủ" và gửi danh sách tối đa
// 3 cầu thủ. Luôn gửi MứcThẻ=1, SốLượng=1 theo yêu cầu.
const { chatTextReaders, waitForChatChange } = require("../../lib/chat-runtime");
const { getFreshSince } = require("../../lib/text-utils");
const { withTimeout } = require("../../lib/playwright-utils");
const { scrollChatToBottom } = require("../../lib/chat-scroll");
const { config } = require("../config");
const { log } = require("../agent-log");
const {
  ensureFeatureButton,
  clickFeatureButton,
  sendMultilineMessage,
  makeFlowError
} = require("./menu");
const {
  buildPurchaseLines,
  parsePurchaseSuccesses,
  filterIconPurchaseSuccesses,
  mergePurchaseSuccesses,
  getLatestBotError,
  isOrderLimitError,
  parseRetryAfterSeconds
} = require("./patterns");
const {
  getVisibleMessageIds,
  readNewChatMessages,
  messagesToText
} = require("./chat-messages");

const STALE_TOKEN_RE = /E002|Token không hợp lệ|token không hợp lệ/i;
const RATE_LIMIT_RE = /thao tác quá nhanh|chờ\s*\d+\s*s\s*rồi thử lại/i;
const PROMPT_RE = /Vui lòng nhập danh sách mã cầu thủ|MãCầuThủ\s+MứcThẻ\s+SốLượng/i;

function shorten(text, max = 600) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

async function waitForBuyPrompt(
  page,
  reader,
  baselineText,
  timeoutMs,
  baselineIds = null
) {
  const deadline = Date.now() + timeoutMs;
  let latest = reader.snapshot().text;
  while (Date.now() < deadline) {
    const update = await waitForChatChange(page, reader, reader.snapshot().version, 1_000);
    if (update) latest = update.text;
    // Ưu tiên id tin nhắn mới: chat dài bị Telegram trim mất mốc text cũ làm
    // getFreshSince trả null dù bot đã gửi prompt. Fallback text nếu DOM không
    // đọc được bubble (Telegram đổi cấu trúc).
    let fresh = "";
    if (baselineIds) {
      const messages = await readNewChatMessages(page, baselineIds);
      fresh = messagesToText(messages);
    }
    if (!fresh) fresh = getFreshSince(baselineText, latest) || "";
    if (PROMPT_RE.test(fresh)) return fresh;
    if (STALE_TOKEN_RE.test(fresh)) {
      throw makeFlowError("Nút Mua cầu thủ đã hết token (E002).", "ICON_UI_STALE");
    }
    if (RATE_LIMIT_RE.test(fresh)) {
      const delay = parseRetryAfterSeconds(fresh) * 1_000 + 500;
      log(`Bot giới hạn thao tác ở bước Mua cầu thủ; chờ ${delay / 1_000}s.`);
      await page.waitForTimeout(delay);
      return null;
    }
  }
  return null;
}

async function waitForBuyMenuButton(page, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await scrollChatToBottom(page).catch(() => {});
    // Chỉ tìm trong bubble menu mới nhất: tránh bấm nhầm nút "Mua cầu thủ"
    // của menu cũ còn sót trong lịch sử, và tránh locator theo index toàn cục
    // bị Telegram render lại làm mất phần tử.
    const menus = page
      .locator('.bubble[role="article"][data-mid]')
      .filter({ hasText: "CHÈN MEMBER THƯỜNG" });
    const count = await menus.count().catch(() => 0);
    for (let i = count - 1; i >= 0; i -= 1) {
      const menu = menus.nth(i);
      const button = menu
        .getByRole("button", { name: "Mua cầu thủ", exact: true })
        .last();
      if (await button.isVisible().catch(() => false)) return button;
    }
    await page.waitForTimeout(300);
  }
  return null;
}

async function clickBuySubmenu(page, reader, button) {
  let target = button;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!target) target = await waitForBuyMenuButton(page, 10_000);
    if (!target) {
      lastError = new Error("Không thấy nút Mua cầu thủ trong menu mới nhất.");
      await page.waitForTimeout(500);
      continue;
    }
    const baseline = reader.snapshot();
    try {
      // Bot yêu cầu tối thiểu 2s giữa các thao tác; chờ thêm để tránh cảnh
      // báo "thao tác quá nhanh" ngay sau khi mở menu Chèn Member Thường.
      await page.waitForTimeout(1_000);
      await withTimeout(
        target.click({ timeout: 10_000 }),
        12_000,
        "bấm nút Mua cầu thủ"
      );
    } catch (error) {
      lastError = error;
      log(
        `Nút "Mua cầu thủ" chưa bấm được (${error.message.split("\n")[0]}); ` +
          `tìm lại trong menu mới nhất (lần ${attempt + 1}/3).`
      );
      target = null;
      await page.waitForTimeout(500);
      continue;
    }
    await page.waitForTimeout(2_200);
    const fresh = getFreshSince(baseline.text, reader.snapshot().text) || "";
    if (STALE_TOKEN_RE.test(fresh)) {
      throw makeFlowError("Nút Mua cầu thủ đã hết token (E002).", "ICON_UI_STALE");
    }
    if (RATE_LIMIT_RE.test(fresh)) {
      const delay = parseRetryAfterSeconds(fresh) * 1_000 + 500;
      log(`Bot giới hạn thao tác sau khi bấm Mua cầu thủ; chờ ${delay / 1_000}s.`);
      await page.waitForTimeout(delay);
      throw makeFlowError("Bot giới hạn thao tác ở bước Mua cầu thủ.", "ICON_RATE_LIMITED");
    }
    const botError = getLatestBotError(fresh);
    if (/E006/i.test(botError || "")) {
      throw makeFlowError("Bot trả E006 ở bước Mua cầu thủ.", "BOT_SYSTEM_ERROR");
    }
    return;
  }
  throw makeFlowError(
    `Không bấm được nút Mua cầu thủ sau 3 lần: ${lastError?.message || "không rõ lỗi"}`,
    "ICON_UI_NOT_READY"
  );
}

async function openMemberBuyPrompt(page, rl) {
  const reader = chatTextReaders.get(page);
  if (!reader) throw new Error("Chưa khởi tạo theo dõi nội dung Telegram.");

  const memberButton = await ensureFeatureButton(page, rl, "Chèn Member Thường");
  await clickFeatureButton(page, rl, "Chèn Member Thường", { button: memberButton });
  log("Đã mở menu Chèn Member Thường.");

  const buyButton = await waitForBuyMenuButton(page);
  if (!buyButton) {
    throw makeFlowError(
      "Không thấy nút Mua cầu thủ sau khi mở Chèn Member Thường.",
      "ICON_UI_NOT_READY"
    );
  }

  const promptBaseline = reader.snapshot().text;
  // Chụp id ngay trước khi bấm; prompt của bot luôn là tin mới nên không phụ
  // thuộc mốc text có còn trong lịch sử Telegram hay không.
  const promptBaselineIds = await getVisibleMessageIds(page).catch(() => null);
  await clickBuySubmenu(page, reader, buyButton);
  const prompt = await waitForBuyPrompt(
    page,
    reader,
    promptBaseline,
    20_000,
    promptBaselineIds
  );
  if (!prompt) {
    // Có thể rate-limit đã được xử lý; thử đọc lại tin mới một lần.
    let fresh = "";
    if (promptBaselineIds) {
      const messages = await readNewChatMessages(page, promptBaselineIds);
      fresh = messagesToText(messages);
    }
    if (!fresh) {
      const current = reader.snapshot().text;
      fresh = getFreshSince(promptBaseline, current) || "";
    }
    if (!PROMPT_RE.test(fresh)) {
      throw makeFlowError(
        `Không thấy prompt nhập danh sách cầu thủ. Đuôi chat: ${shorten(fresh)}`,
        "ICON_UI_NOT_READY"
      );
    }
  }
  log("Bot đã yêu cầu nhập danh sách mã cầu thủ (MãCầuThủ MứcThẻ SốLượng).");
}

async function waitForPurchaseResults(
  page,
  reader,
  baselineText,
  players,
  baselineIds = null,
  { isStopRequested = null } = {}
) {
  const deadline = Date.now() + config.iconBuy.purchaseTimeoutSeconds * 1_000;
  let successes = [];
  let latestText = reader.snapshot().text;
  // Chỉ reset đồng hồ im lặng khi dữ liệu của chính các mã ICON thay đổi.
  // Log của Auto Mua đang chạy song song không được kéo dài thời gian chờ.
  let lastRelevantAt = Date.now();
  let lastSignature = "";
  let lastFresh = "";
  let fatalError = null;
  let fatalStopAt = Infinity;

  while (Date.now() < deadline) {
    if (typeof isStopRequested === "function" && isStopRequested()) {
      const found = new Set(successes.map((item) => item.code));
      return {
        successes,
        missing: players.filter((player) => !found.has(player.code)),
        fresh: lastFresh,
        fatalError,
        stopped: true
      };
    }
    const update = await waitForChatChange(page, reader, reader.snapshot().version, 1_000);
    if (update) latestText = update.text;
    // Ưu tiên message id mới để không bỏ sót log khi Telegram trim mất mốc
    // text cũ. Fallback về fresh-text nếu DOM không đọc được bubble.
    let fresh = "";
    if (baselineIds) {
      const messages = await readNewChatMessages(page, baselineIds);
      fresh = messagesToText(messages);
    }
    if (!fresh) fresh = getFreshSince(baselineText, latestText) || "";
    if (fresh) lastFresh = fresh;
    // Auto Mua có thể đang chạy song song và cũng ghi log "Đã đặt mua thành
    // công"; chỉ nhận log khớp đúng mã + grade + số lượng của lượt ICON này.
    // Nếu chỉ lọc theo mã, log +1 x3 của Auto Mua cùng mã sẽ bị coi là đơn ICON
    // và có thể khiến agent giữ/hủy nhầm đơn của worker đang chạy song song.
    const parsed = filterIconPurchaseSuccesses(
      parsePurchaseSuccesses(fresh || ""),
      players,
      config.iconBuy.grade,
      config.iconBuy.quantity
    );
    if (parsed.length) {
      successes = mergePurchaseSuccesses(successes, parsed);
      const signature = successes
        .map(
          (item) =>
            `${item.code}:${item.grade}:${item.position ?? ""}:${item.positionError ?? ""}`
        )
        .sort()
        .join("|");
      if (signature !== lastSignature) {
        lastSignature = signature;
        lastRelevantAt = Date.now();
      }
    }
    const found = new Set(successes.map((item) => item.code));
    const botError = getLatestBotError(fresh || "");
    // E006/E010 có thể đến sau khi bot đã đặt một phần danh sách. Không throw
    // ngay: đánh dấu lỗi, chờ tối đa 10 giây để nhận log đặt mua, rồi để runner
    // hủy các đơn vị trí xấu trước khi dừng phiên.
    if (/E006/i.test(botError || "")) {
      fatalError =
        fatalError || `Bot báo E006 khi đặt mua ICON (${shorten(botError, 120)}).`;
      fatalStopAt = Math.min(fatalStopAt, Date.now() + 10_000);
    }
    if (isOrderLimitError(fresh || "")) {
      // Chạm giới hạn lệnh đang chạy: không đặt được thêm, dừng ngay thay vì
      // chờ đủ purchaseTimeoutSeconds. Không tự hủy lệnh của Auto Mua.
      fatalError =
        fatalError ||
        "Tài khoản đã đạt giới hạn lệnh mua đang chạy (E007); chưa đặt thêm đơn nào.";
      fatalStopAt = Math.min(fatalStopAt, Date.now());
    }
    if (botError && /E010|Vip Member|VIP Member/i.test(fresh || "")) {
      fatalError =
        fatalError || `Bot từ chối do VIP/giới hạn (${shorten(botError, 120)}).`;
      fatalStopAt = Math.min(fatalStopAt, Date.now() + 10_000);
    }
    if (!successes.length && !fatalError) {
      if (RATE_LIMIT_RE.test(fresh || "")) {
        const delay = parseRetryAfterSeconds(fresh) * 1_000 + 500;
        log(`Bot giới hạn thao tác đặt mua ICON; chờ ${delay / 1_000}s rồi thử lại.`);
        await page.waitForTimeout(delay);
        throw makeFlowError("Bot giới hạn thao tác đặt mua ICON.", "ICON_RATE_LIMITED");
      }
      if (PROMPT_RE.test(fresh || "")) {
        throw makeFlowError(
          "Bot vẫn yêu cầu nhập danh sách sau khi gửi; chưa nhận được đơn.",
          "ICON_UI_NOT_READY"
        );
      }
      if (/không hợp lệ|sai định dạng|sai cú pháp|không đúng định dạng/i.test(fresh || "")) {
        throw makeFlowError(
          `Bot từ chối danh sách cầu thủ: ${shorten(fresh)}`,
          "ICON_BOT_REJECTED"
        );
      }
    }
    // Sau khi đã có kết quả, chờ thêm cho log vị trí (có thể bot gửi bổ sung).
    // Có vị trí/E004 rồi thì 5s; chưa có vị trí thì 15s để không bỏ sót đơn > 5.
    const unresolvedPosition = successes.some(
      (item) => item.position == null && !item.positionError
    );
    const quietMs = unresolvedPosition ? 15_000 : 5_000;
    const allFound = successes.length && players.every((player) => found.has(player.code));
    if (allFound && !unresolvedPosition) {
      await page.waitForTimeout(1_000);
      return { successes, missing: [], fresh: lastFresh, fatalError };
    }
    if (successes.length && Date.now() - lastRelevantAt >= quietMs) {
      const missing = players.filter((player) => !found.has(player.code));
      return { successes, missing, fresh: lastFresh, fatalError };
    }
    if (fatalError && Date.now() >= fatalStopAt && !unresolvedPosition) {
      const missing = players.filter((player) => !found.has(player.code));
      log(`Dừng chờ kết quả ICON do lỗi bot: ${fatalError}`);
      return { successes, missing, fresh: lastFresh, fatalError };
    }
  }

  const found = new Set(successes.map((item) => item.code));
  const missing = players.filter((player) => !found.has(player.code));
  if (missing.length) {
    log(
      `Chưa thấy log đặt mua cho ${missing.map((p) => p.code).join(", ")} ` +
        `sau ${config.iconBuy.purchaseTimeoutSeconds}s. Đuôi chat: ${shorten(lastFresh)}`
    );
  }
  return { successes, missing, fresh: lastFresh, fatalError };
}

async function placeIconOrders(page, rl, players, { ui = null, isStopRequested = null } = {}) {
  const reader = chatTextReaders.get(page);
  if (!reader) throw new Error("Chưa khởi tạo theo dõi nội dung Telegram.");
  if (!players.length) return { successes: [], missing: [], fresh: "" };

  await openMemberBuyPrompt(page, rl);
  const baseline = reader.snapshot();
  const baselineIds = await getVisibleMessageIds(page).catch(() => null);
  const lines = buildPurchaseLines(players, config.iconBuy.grade, config.iconBuy.quantity);
  log(`Gửi ${players.length} cầu thủ ICON: ${lines.replace(/\n/g, "; ")}.`);
  await sendMultilineMessage(page, rl, lines);
  // Đã gửi lệnh mua: chỉ còn đọc chat để chờ log/vị trí. Nhả khóa UI để luồng
  // mua/nâng đang chạy song song mở/đóng mini-app của nó. Nếu đơn ICON cần hủy,
  // runner sẽ lấy lại khóa trước khi mở TTCN.
  if (ui) ui.release();
  let result;
  try {
    result = await waitForPurchaseResults(
      page,
      reader,
      baseline.text,
      players,
      baselineIds,
      { isStopRequested }
    );
  } catch (error) {
    // Đã gửi lệnh mua thì không được thử lại mù: retry có thể tạo thêm task
    // hoặc đặt thêm đơn. Runner dùng cờ này để dừng đúng task mới và kiểm tra
    // TTCN trước khi kết thúc phiên.
    error.purchaseSent = true;
    throw error;
  } finally {
    if (ui) await ui.acquire();
  }
  for (const success of result.successes) {
    const positionText = success.position == null
      ? success.positionError || "không rõ vị trí"
      : String(success.position);
    log(
      `Bot đã đặt mua ${success.code} | ${success.grade} | ${success.price} | ` +
        `${success.quantity}/${success.total}; vị trí: ${positionText}.`
    );
  }
  return result;
}

module.exports = {
  waitForBuyPrompt,
  openMemberBuyPrompt,
  waitForPurchaseResults,
  placeIconOrders
};
