// Tra cứu danh sách yêu thích từ chức năng "Tra cứu mã cầu thủ offline".
// Kết quả bot trả về là text trong chat (có thể chia nhiều tin), không phải
// mini-app. Chỉ đọc, không mua.
const { chatTextReaders, waitForChatChange } = require("../../lib/chat-runtime");
const { getFreshSince } = require("../../lib/text-utils");
const { config } = require("../config");
const { log } = require("../agent-log");
const { ensureFeatureButton, clickFeatureButton } = require("./menu");
const {
  getVisibleMessageIds,
  readNewChatMessages,
  messagesToText
} = require("./chat-messages");
const {
  parseFavoriteIconPlayers,
  parseRetryAfterSeconds
} = require("./patterns");

const RATE_LIMIT_RE = /thao tác quá nhanh|chờ\s*\d+\s*s\s*rồi thử lại/i;
const STALE_TOKEN_RE = /E002|Token không hợp lệ|token không hợp lệ/i;
// Bot có thể chia danh sách dài thành nhiều tin. Chờ một khoảng ngắn sau khi
// số cầu thủ ICON đọc được không còn tăng, thay vì chờ toàn bộ chat im lặng
// (Auto Mua đang chạy có thể ghi log liên tục và làm chậm mỗi lượt 60 giây).
const QUIET_MS = 4_000;

function shorten(text, max = 500) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

async function waitForLookupResult(
  page,
  reader,
  baselineText,
  timeoutMs,
  baselineIds = null
) {
  const deadline = Date.now() + timeoutMs;
  let lastPlayerAt = 0;
  let latestPlayers = [];
  let latestText = reader.snapshot().text;
  let latestFresh = "";

  while (Date.now() < deadline) {
    const update = await waitForChatChange(
      page,
      reader,
      reader.snapshot().version,
      1_000
    );
    if (update) latestText = update.text;

    // Ưu tiên message id mới: Telegram có thể trim mất mốc text cũ, làm
    // getFreshSince trả null dù bot đã trả kết quả. Nếu DOM không có bubble
    // (Telegram đổi UI), quay lại cách đọc text cũ.
    let fresh = "";
    if (baselineIds) {
      const messages = await readNewChatMessages(page, baselineIds);
      fresh = messagesToText(messages);
    }
    if (!fresh) fresh = getFreshSince(baselineText, latestText) || "";

    if (fresh) {
      latestFresh = fresh;
      const players = parseFavoriteIconPlayers(fresh);
      if (players.length) {
        const previousCount = latestPlayers.length;
        // Gộp theo mã: bot có thể chia danh sách thành nhiều tin, hoặc mỗi lần
        // đọc chỉ thấy một phần do Telegram cắt bớt lịch sử.
        const byCode = new Map(latestPlayers.map((player) => [player.code, player]));
        for (const player of players) byCode.set(player.code, player);
        latestPlayers = [...byCode.values()];
        if (latestPlayers.length > previousCount) lastPlayerAt = Date.now();
      }
    }
    if (latestPlayers.length && Date.now() - lastPlayerAt >= QUIET_MS) {
      return { players: latestPlayers, fresh: latestFresh };
    }
  }
  return { players: latestPlayers, fresh: latestFresh };
}

async function lookupFavoriteIconPlayers(page, rl) {
  const reader = chatTextReaders.get(page);
  if (!reader) throw new Error("Chưa khởi tạo theo dõi nội dung Telegram.");

  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const baseline = reader.snapshot();
    // Chụp id ngay trước khi bấm: các tin menu do /tn vừa gửi không bị coi là
    // kết quả tra cứu, còn tin bot trả sau đó luôn có id mới.
    const baselineIds = await getVisibleMessageIds(page).catch(() => null);
    log(`Đang tra cứu danh sách ICON yêu thích (lần ${attempt}/2).`);
    await clickFeatureButton(page, rl, "Tra cứu mã cầu thủ offline");

    const result = await waitForLookupResult(
      page,
      reader,
      baseline.text,
      config.iconBuy.favoritesTimeoutSeconds * 1_000,
      baselineIds
    );

    if (result.players.length) {
      log(
        `Tra cứu offline: ${result.players.length} cầu thủ ICON yêu thích ` +
          `(${result.players.slice(0, 5).map((p) => `${p.code} ${p.name}`).join(", ")}...).`
      );
      return result.players;
    }

    if (STALE_TOKEN_RE.test(result.fresh)) {
      lastError = "menu tra cứu đã hết token (E002)";
      continue;
    }
    if (RATE_LIMIT_RE.test(result.fresh)) {
      const delay = parseRetryAfterSeconds(result.fresh) * 1_000 + 500;
      log(`Bot giới hạn thao tác tra cứu; chờ ${delay / 1_000}s rồi thử lại.`);
      await page.waitForTimeout(delay);
      lastError = "bot giới hạn thao tác";
      continue;
    }

    log(`Không đọc được danh sách ICON từ kết quả tra cứu. Đuôi chat: ${shorten(result.fresh)}`);
    lastError = "không thấy dòng cầu thủ ICON trong kết quả tra cứu";
  }

  const error = new Error(
    `Không lấy được danh sách ICON yêu thích: ${lastError || "không rõ lỗi"}.`
  );
  error.code = "ICON_LOOKUP_FAILED";
  throw error;
}

module.exports = {
  lookupFavoriteIconPlayers,
  waitForLookupResult
};
