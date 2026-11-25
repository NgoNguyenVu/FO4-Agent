// Ghi file state/lock/heartbeat an toàn với mất điện: temp duy nhất theo PID,
// writeSync + fsyncSync trước rename, và dọn temp stale lúc khởi động.
const fs = require("node:fs");
const path = require("node:path");

let tmpSeq = 0;

function tmpPathFor(file) {
  return `${file}.tmp-${process.pid}-${Date.now()}-${tmpSeq++}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function writeFileAtomic(file, content, { fsImpl = fs, encoding = "utf8" } = {}) {
  const dir = path.dirname(file);
  fsImpl.mkdirSync(dir, { recursive: true });
  const tmp = tmpPathFor(file);
  let fd = null;
  try {
    fd = fsImpl.openSync(tmp, "w");
    fsImpl.writeSync(fd, Buffer.from(String(content), encoding));
    fsImpl.fsyncSync(fd);
    fsImpl.closeSync(fd);
    fd = null;
    fsImpl.renameSync(tmp, file);
  } finally {
    if (fd !== null) {
      try { fsImpl.closeSync(fd); } catch { /* fd đã đóng */ }
    }
  }
  return file;
}

function writeJsonAtomic(file, value, options = {}) {
  return writeFileAtomic(file, JSON.stringify(value, null, 2), options);
}

// Chỉ xóa các temp do chính pattern này tạo; không đụng file `.tmp` cũ do
// bản trước đó để lại nếu caller muốn giữ lại để điều tra.
function cleanupStaleTmp(
  dir,
  { fsImpl = fs, isAlive = null, maxAgeMs = 60_000, now = () => Date.now() } = {}
) {
  if (!dir || !fsImpl.existsSync(dir)) return 0;
  let removed = 0;
  for (const name of fsImpl.readdirSync(dir)) {
    const match = /\.tmp-(\d+)-(\d+)-\d+-[0-9a-z]+$/i.exec(name);
    if (!match) continue;
    // File vừa tạo có thể đang được tiến trình khác ghi dở: không đụng vào.
    if (now() - Number(match[2]) < maxAgeMs) continue;
    if (typeof isAlive === "function" && isAlive(Number(match[1]))) continue;
    try {
      fsImpl.rmSync(path.join(dir, name), { force: true });
      removed += 1;
    } catch { /* file có thể đã biến mất */ }
  }
  return removed;
}

module.exports = {
  writeFileAtomic,
  writeJsonAtomic,
  cleanupStaleTmp,
  tmpPathFor
};
