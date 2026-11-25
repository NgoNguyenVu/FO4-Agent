// Appender xoay vòng dùng chung cho agent.log và telegram-chat.log.
// current + .1 + .2 (tổng 3 file, mỗi file tối đa 5 MB).
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_FILES = 3;
const ROTATED_SUFFIXES = [".2", ".1", ""]; // cũ nhất -> mới nhất

function rotate(filePath, { fsImpl = fs, maxFiles = DEFAULT_MAX_FILES } = {}) {
  const oldest = `${filePath}.${maxFiles - 1}`;
  try { fsImpl.rmSync(oldest, { force: true }); } catch { /* đã biến mất */ }
  for (let index = maxFiles - 2; index >= 1; index -= 1) {
    const from = `${filePath}.${index}`;
    const to = `${filePath}.${index + 1}`;
    if (!fsImpl.existsSync(from)) continue;
    try { fsImpl.renameSync(from, to); } catch { /* bỏ qua lỗi xoay vòng */ }
  }
  try { fsImpl.renameSync(filePath, `${filePath}.1`); } catch { /* chưa có file */ }
}

function appendRotating(
  filePath,
  line,
  { fsImpl = fs, maxBytes = DEFAULT_MAX_BYTES, maxFiles = DEFAULT_MAX_FILES } = {}
) {
  fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
  const bytes = Buffer.byteLength(String(line), "utf8");
  let size = 0;
  try { size = fsImpl.statSync(filePath).size; } catch { /* file chưa tồn tại */ }
  if (size + bytes > maxBytes) rotate(filePath, { fsImpl, maxFiles });
  fsImpl.appendFileSync(filePath, line, "utf8");
  return line;
}

// Chỉ đọc phần đuôi có kích thước giới hạn cho công cụ so sánh log.
function readLogTail(
  filePath,
  { fsImpl = fs, maxBytes = DEFAULT_MAX_BYTES } = {}
) {
  if (!fsImpl.existsSync(filePath)) return "";
  const stat = fsImpl.statSync(filePath);
  if (!stat.size) return "";
  const start = Math.max(0, stat.size - maxBytes);
  const length = stat.size - start;
  const buffer = Buffer.alloc(length);
  let fd = null;
  try {
    fd = fsImpl.openSync(filePath, "r");
    fsImpl.readSync(fd, buffer, 0, length, start);
  } finally {
    if (fd !== null) {
      try { fsImpl.closeSync(fd); } catch { /* fd đã đóng */ }
    }
  }
  let text = buffer.toString("utf8");
  if (start > 0) {
    const firstNewline = text.indexOf("\n");
    text = firstNewline < 0 ? "" : text.slice(firstNewline + 1);
  }
  return text;
}

// Đọc gộp các file đã xoay vòng theo thứ tự thời gian: .2 -> .1 -> current.
// Mỗi phần được cắt đuôi để không nạp quá nhiều vào RAM; caller nên dedupe.
function readRotatedLogs(basePath, { fsImpl = fs, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const parts = [];
  for (const suffix of ROTATED_SUFFIXES) {
    const part = readLogTail(`${basePath}${suffix}`, { fsImpl, maxBytes });
    if (part) parts.push(part.replace(/\r?\n$/, ""));
  }
  return parts.join("\n");
}

module.exports = {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_FILES,
  ROTATED_SUFFIXES,
  rotate,
  appendRotating,
  readLogTail,
  readRotatedLogs
};
