// Một nguồn chuẩn cho các định dạng giá gặp ở bot/Telegram.
// Giữ ba hàm riêng vì ngữ nghĩa khác nhau (ném lỗi vs trả null, dấu phẩy là
// thập phân hay hàng nghìn) nhưng gom chung một chỗ để không còn 3 bản sao.

// "666.666" / "1,234,567" -> 666666 / 1234567 (dấu tách nghìn, không unit).
function parseBp(raw) {
  const digits = String(raw).replace(/[.,\s]/g, "");
  const amount = Number(digits);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error(`Không đọc được giá BP hợp lệ: ${raw}`);
  }
  return amount;
}

// "26.9M" / "1.2B" / "573,000" -> số BP; trả null nếu không đọc được.
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

// "54.3M" -> 54300000, "2,5M" -> 2500000, "625,000" -> 625000.
// Có hậu tố K/M/B: dấu phẩy là thập phân. Không hậu tố: dấu phẩy là hàng nghìn.
function parseMarketPrice(raw) {
  const text = String(raw).trim();
  const match = text.match(/^([\d.,]+)\s*([KMB])?$/i);
  if (!match) throw new Error(`Không đọc được giá thị trường: ${raw}`);
  const multiplier = { K: 1e3, M: 1e6, B: 1e9 }[(match[2] || "").toUpperCase()] || 1;
  const number = match[2]
    ? Number(match[1].replace(/,/g, "."))
    : Number(match[1].replace(/[.,\s]/g, ""));
  const amount = Math.round(number * multiplier);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error(`Không đọc được giá thị trường: ${raw}`);
  }
  return amount;
}

module.exports = { parseBp, parseCompactBp, parseMarketPrice };
