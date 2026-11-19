// Ghi log hội thoại Telegram độc lập với agent.log.
//
// Mỗi tin nhắn trong chat bot được ghi thành một dòng:
//   [2026-11-18T07:00:00.000Z] [Direction: IN] /startagent
// Trong đó:
//   IN  = tin từ tài khoản người dùng gửi tới bot (kể cả lệnh agent tự gửi
//         như /tn, /stopauto vì đều đi từ phía tài khoản đang đăng nhập).
//   OUT = tin bot gửi về (thông báo mua/nâng, lỗi E006, menu...).
//
// File mặc định nằm cạnh agent.log: <LOCALAPPDATA>/FO4PurchaseAgent/
// telegram-chat.log. Có thể override bằng FO4_TELEGRAM_CHAT_LOG (hữu ích khi
// test hoặc khi muốn tách log theo phiên).
const fs = require("node:fs");
const path = require("node:path");
const { telegramChatLogPath } = require("./log-paths");

// Cùng selector với features/icon-buy/chat-messages.js. Đặt ở lib/ để
// chat-observer không phải require ngược lên feature.
const CHAT_MESSAGE_SELECTOR = '.bubble[role="article"][data-mid]';

const DIRECTIONS = Object.freeze({ IN: "IN", OUT: "OUT" });
const CHAT_LINE_RE = /^\[([^\]]+)\]\s*\[Direction:\s*(IN|OUT)\]\s?(.*)$/;

function normalizeContent(content) {
  const cleaned = String(content ?? "")
    // Telegram Web K chèn icon font (checkmark, trạng thái gửi...) trong vùng
    // Private Use Area; bỏ để nội dung log đọc được bằng text thuần.
    .replace(/[\uE000-\uF8FF]/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
  // Bubble .message của Telegram chứa cả giờ gửi ở cuối (vd " 13:05").
  // Bỏ phần giờ này để content chỉ còn nội dung tin nhắn.
  return /^.+?\s+\d{1,2}:\d{2}$/u.test(cleaned)
    ? cleaned.replace(/\s+\d{1,2}:\d{2}$/u, "").trim()
    : cleaned;
}

function normalizeDirection(direction) {
  const value = String(direction || "").trim().toUpperCase();
  if (value !== DIRECTIONS.IN && value !== DIRECTIONS.OUT) {
    throw new TypeError(`Hướng log Telegram không hợp lệ: ${direction}`);
  }
  return value;
}

function toIsoTimestamp(timestamp) {
  if (timestamp instanceof Date) return timestamp.toISOString();
  if (timestamp === undefined || timestamp === null) return new Date().toISOString();
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`Timestamp log Telegram không hợp lệ: ${timestamp}`);
  }
  return parsed.toISOString();
}

function formatChatLine({ timestamp, direction, content }) {
  const iso = toIsoTimestamp(timestamp);
  const dir = normalizeDirection(direction);
  return `[${iso}] [Direction: ${dir}] ${normalizeContent(content)}`;
}

function resolveChatLogPath() {
  return process.env.FO4_TELEGRAM_CHAT_LOG || telegramChatLogPath;
}

// Trả về dòng đã ghi, hoặc null nếu nội dung rỗng (bỏ qua sticker/animation
// không có text để log không bị dòng trống vô nghĩa).
function appendChatLine(entry, { filePath = resolveChatLogPath() } = {}) {
  const content = normalizeContent(entry.content);
  if (!content) return null;
  const line = formatChatLine({ ...entry, content });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${line}\n`, "utf8");
  return line;
}

// Best-effort: lỗi đĩa/quyền ghi không được làm sập vòng theo dõi chat.
function logTelegramMessage(direction, content, options) {
  try {
    return appendChatLine({ direction, content }, options);
  } catch (error) {
    try {
      console.error(`Không ghi được telegram-chat.log: ${error.message}`);
    } catch { /* console cũng lỗi thì bỏ qua */ }
    return null;
  }
}

// Tin outgoing trên Telegram Web (class is-out) là tin của tài khoản đang
// đăng nhập -> IN so với bot. Tin còn lại là bot trả về -> OUT.
function directionForMessage(message) {
  return message && message.out ? DIRECTIONS.IN : DIRECTIONS.OUT;
}

function parseChatLog(text) {
  const entries = [];
  for (const line of String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = CHAT_LINE_RE.exec(line);
    if (!match) continue;
    const at = Date.parse(match[1]);
    if (Number.isNaN(at)) continue;
    entries.push({
      at,
      timestamp: new Date(at).toISOString(),
      direction: match[2],
      content: match[3].trim()
    });
  }
  return entries;
}

function readChatLog(filePath = resolveChatLogPath()) {
  if (!fs.existsSync(filePath)) return [];
  return parseChatLog(fs.readFileSync(filePath, "utf8"));
}

module.exports = {
  CHAT_MESSAGE_SELECTOR,
  DIRECTIONS,
  normalizeContent,
  normalizeDirection,
  formatChatLine,
  resolveChatLogPath,
  appendChatLine,
  logTelegramMessage,
  directionForMessage,
  parseChatLog,
  readChatLog
};
