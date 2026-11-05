// Parser/pattern thuần của luồng "Mua ICON yêu thích".
// Không mở browser, không gửi tin nhắn: toàn bộ logic đọc chữ nằm ở đây để test
// và debug độc lập với phần điều khiển Telegram.
const PLAYER_LINE_RE =
  /^\s*(\d{9})\s*-\s*(.+?)\s*-\s*(.+?)\s*-\s*Grade:\s*\+?(\d+)\s*-\s*OVR:\s*(\d+)\s*-\s*([\d.,]+)\s*$/gm;
const PURCHASE_LINE_RE =
  /Đã đặt mua thành công\s+(\d{9})\s*\|\s*(\d+)\s*\|\s*([\d.,]+)\s*\|\s*(\d+)\/(\d+)\s*lúc\s*([^\n]+)/gi;
const POSITION_RE = /Vị trí mua:\s*(\d+)/i;
const POSITION_E004_RE = /Không lấy được vị trí mua\s*\(?E004\)?/i;
const ORDER_LIMIT_RE = /E007|giới hạn tối đa\s*\d+\s*lệnh đang chạy/i;
const ERROR_CODE_RE = /\bE\d{3}\b[^\n]*/gi;
const RATE_LIMIT_RE = /(?:chờ|đợi)\s*(\d+)\s*s\s*(?:rồi|nữa)?\s*(?:hãy\s*)?(?:thử lại)?/i;
const ICON_SEASON_RE = /^ICON$/i;

// Menu chức năng của bot có nhãn "Chèn Member Thường" và "Auto Mua Phôi".
// Dùng để nhận biết menu còn dùng được sau /tn hoặc trong lịch sử gần đây.
function hasIconMenuSignature(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").toLocaleLowerCase();
  return (
    normalized.includes("chèn member thường") &&
    normalized.includes("auto mua phôi")
  );
}

function isIconSeason(season) {
  // Chỉ mùa "ICON" thuần được tính; các biến thể như ICONTM/ICONS MATCH/TKI
  // không phải là ICON cho luồng /starticon.
  return ICON_SEASON_RE.test(String(season || ""));
}

// Đọc danh sách bot trả về sau khi bấm "Tra cứu mã cầu thủ offline".
// Mỗi dòng có dạng:
//   101042331 - Rivaldo - ICON - Grade: +1 - OVR: 111 - 23,400,000
// Chỉ giữ mùa ICON/ICONTM/ICONS MATCH/TKI... và bỏ trùng theo mã cầu thủ.
function parseFavoriteIconPlayers(text) {
  const players = [];
  const seen = new Set();
  for (const match of String(text || "").matchAll(PLAYER_LINE_RE)) {
    const code = match[1];
    const season = match[3].trim();
    if (!isIconSeason(season) || seen.has(code)) continue;
    seen.add(code);
    players.push({
      code,
      name: match[2].trim(),
      season,
      listedGrade: Number(match[4]),
      ovr: Number(match[5]),
      listedPrice: match[6].trim()
    });
  }
  return players;
}

// Bot luôn nhận MứcThẻ và SốLượng theo từng dòng. Luồng ICON cố định +1/1
// theo yêu cầu, không lấy mức thẻ đang có trong danh sách yêu thích.
// Chỉ giữ mùa ICON thuần: ICONTM / ICONS MATCH / TKI không được tính là ICON
// cho luồng /starticon.
function buildPurchaseLines(players, grade = 1, quantity = 1) {
  return players
    .map((player) => `${player.code} ${grade} ${quantity}`)
    .join("\n");
}

// Chọn ngẫu nhiên không trùng. `exclude` dùng để tránh mua lại cùng mã trong
// một phiên /starticon. Truyền rng (0..1) để test ổn định.
function selectRandomIconPlayers(players, limit, { exclude = new Set(), rng = Math.random } = {}) {
  const unique = [];
  const seen = new Set(exclude);
  for (const player of players) {
    if (!player || !/^\d{9}$/.test(String(player.code)) || seen.has(player.code)) continue;
    seen.add(player.code);
    unique.push(player);
  }
  for (let i = unique.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [unique[i], unique[j]] = [unique[j], unique[i]];
  }
  const max = Math.max(0, Number(limit) || 0);
  return unique.slice(0, max);
}

// Đọc log đặt mua. Một log có thể kèm vị trí hoặc E004:
//   Đã đặt mua thành công 101214649 | 1 | 26,900,000 | 1/1 lúc ... Vị trí mua: 13
//   Đã đặt mua thành công ... lúc ... Không lấy được vị trí mua (E004)
function parsePurchaseSuccesses(text) {
  const successes = [];
  for (const match of String(text || "").matchAll(PURCHASE_LINE_RE)) {
    const line = match[0];
    const positionMatch = line.match(POSITION_RE);
    successes.push({
      code: match[1],
      grade: Number(match[2]),
      price: match[3],
      quantity: Number(match[4]),
      total: Number(match[5]),
      time: match[6]
        .replace(/\s*(?:Vị trí mua:|Không lấy được vị trí mua).*$/i, "")
        .trim(),
      position: positionMatch ? Number(positionMatch[1]) : null,
      positionError: positionMatch
        ? null
        : POSITION_E004_RE.test(line)
          ? "E004"
          : null
    });
  }
  return successes;
}

// Auto Mua có thể chạy song song và mua cùng mã với grade/số lượng khác.
// Chỉ log khớp đúng mã + grade + số lượng của phiên ICON mới được coi là đơn
// của phiên này; nếu chỉ lọc theo mã, agent có thể đọc nhầm log của worker khác
// rồi giữ/hủy đơn của worker đó.
function filterIconPurchaseSuccesses(successes, players, grade, quantity) {
  const wanted = new Set((players || []).map((player) => String(player.code)));
  const wantGrade = Number(grade);
  const wantQuantity = Number(quantity);
  return (successes || []).filter(
    (item) =>
      wanted.has(String(item.code)) &&
      Number(item.grade) === wantGrade &&
      Number(item.quantity) === wantQuantity &&
      // total cũng phải khớp: log 1/3 của Auto Mua mua hộ/khớp một phần không
      // được coi là đơn ICON 1/1.
      Number(item.total) === wantQuantity
  );
}

// Gộp log mới nhất theo mã. Nếu bot lặp log (retry), log sau thắng; nhưng log
// sau thiếu vị trí/E004 thì giữ dữ liệu vị trí đã đọc được từ log trước để
// không bỏ sót đơn cần hủy.
function mergePurchaseSuccesses(existing, incoming) {
  const byCode = new Map(existing.map((item) => [item.code, item]));
  for (const item of incoming) {
    const previous = byCode.get(item.code);
    if (previous && item.position == null) {
      byCode.set(item.code, {
        ...item,
        position: item.position ?? previous.position ?? null,
        positionError: item.positionError || previous.positionError || null
      });
      continue;
    }
    byCode.set(item.code, item);
  }
  return [...byCode.values()];
}

function getLatestBotError(text) {
  const matches = [...String(text || "").matchAll(ERROR_CODE_RE)];
  return matches.length ? matches.at(-1)[0].trim() : null;
}

// E007: tài khoản đã chạm giới hạn số lệnh mua đang chạy. Đây không phải lỗi
// hạ tầng và không được vượt giới hạn; /starticon phải dừng ngay, không chờ
// timeout mua và không đụng tới các lệnh đang chạy của Auto Mua.
function isOrderLimitError(text) {
  return ORDER_LIMIT_RE.test(String(text || ""));
}

function parseRetryAfterSeconds(text, fallback = 5) {
  const match = String(text || "").match(RATE_LIMIT_RE);
  const seconds = match ? Number(match[1]) : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : fallback;
}

// "26.9M" / "1.2B" / "573,000" -> số BP để so khớp card TTCN.
function parseCompactBp(raw) {
  const text = String(raw == null ? "" : raw).trim();
  const match = text.match(/([\d.,]+)\s*([KMB])?/i);
  if (!match) return null;
  let number = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(number)) return null;
  const unit = (match[2] || "").toUpperCase();
  if (unit === "K") number *= 1_000;
  if (unit === "M") number *= 1_000_000;
  if (unit === "B") number *= 1_000_000_000;
  return Math.round(number);
}

// Card TTCN có dạng: "Tên | Mùa | OVR | Grade | Giá".
function parseTtcnCardText(text) {
  const parts = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" | ");
  if (parts.length < 5) return null;
  return {
    name: parts[0],
    season: parts[1],
    ovr: Number(parts[2]) || null,
    grade: Number(parts[3]) || null,
    priceText: parts[4],
    price: parseCompactBp(parts[4])
  };
}

// Chọn đúng đơn mới để hủy. orderId có trong baseline là đơn cũ, tuyệt đối
// không chọn. Nếu baseline không đọc được, chỉ chọn card khớp mã + grade và
// đang có nút Hủy; caller phải ghi cảnh báo để người dùng biết rủi ro.
function selectOrderToCancel(orders, success, knownOrderIds = null) {
  const matches = (orders || []).filter((order) => {
    if (!order || !order.orderId) return false;
    if (success.orderId && String(order.orderId) !== String(success.orderId)) {
      return false;
    }
    if (String(order.spid) !== String(success.code)) return false;
    if (Number(order.orderType) !== 1) return false;
    if (!/Hủy/i.test(String(order.action || ""))) return false;
    if (knownOrderIds && knownOrderIds.has(order.orderId)) return false;
    if (success.grade != null && order.grade != null && Number(order.grade) !== Number(success.grade)) {
      return false;
    }
    return true;
  });
  if (!matches.length) return null;
  // Buy orders thường được nối ở cuối danh sách; chọn card cuối cùng.
  return matches.at(-1);
}

function getPositionAction(success, threshold = 5) {
  if (
    success &&
    success.position !== null &&
    success.position !== undefined &&
    success.position !== "" &&
    Number.isFinite(Number(success.position))
  ) {
    return Number(success.position) > Number(threshold) ? "cancel" : "keep";
  }
  return "unknown";
}

// Chỉ hủy khi đọc được vị trí và vị trí vượt ngưỡng. Không hủy đơn chỉ vì
// không đọc được vị trí.
function shouldCancelIconOrder(success, threshold = 5) {
  return Boolean(success) && getPositionAction(success, threshold) === "cancel";
}

module.exports = {
  PLAYER_LINE_RE,
  PURCHASE_LINE_RE,
  ICON_SEASON_RE,
  hasIconMenuSignature,
  isIconSeason,
  parseFavoriteIconPlayers,
  buildPurchaseLines,
  selectRandomIconPlayers,
  parsePurchaseSuccesses,
  filterIconPurchaseSuccesses,
  mergePurchaseSuccesses,
  getLatestBotError,
  isOrderLimitError,
  parseRetryAfterSeconds,
  parseCompactBp,
  parseTtcnCardText,
  selectOrderToCancel,
  getPositionAction,
  shouldCancelIconOrder
};
