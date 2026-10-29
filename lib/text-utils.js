// Tiện ích đọc text thuần (không phụ thuộc Playwright/bot cụ thể).
const {
  FRESH_ANCHOR_LENGTHS,
  CONTROL_COMMAND_TAIL_LENGTH
} = require("./bot-patterns");
const {
  CONTROL_COMMAND_NAMES,
  CONTROL_START_COMMANDS
} = require("./control-commands");

const CONTROL_COMMAND_RE = new RegExp(
  `\\/(${CONTROL_COMMAND_NAMES.join("|")})(?:@\\w+)?(?![a-z0-9_])`,
  "gi"
);

// matchAll bắt buộc regex phải có cờ g. Các parser dùng regex dạng /.../i cho
// .test() (không nên có g vì lastIndex bị giữ trạng thái), nên clone sang regex
// global mới cho mỗi lần đếm/quét thay vì làm crash lúc chạy.
function asGlobalRegex(pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);
  regex.lastIndex = 0;
  return regex;
}

function countMatches(text, pattern) {
  let count = 0;
  for (const _ of text.matchAll(asGlobalRegex(pattern))) count += 1;
  return count;
}

function lastPatternIndex(text, pattern) {
  let lastIndex = -1;
  for (const match of text.matchAll(asGlobalRegex(pattern))) lastIndex = match.index;
  return lastIndex;
}

// ---- Đọc tin nhắn mới kiểu "fresh-text" (chống trôi tin nhắn) ----
// Vấn đề: detector đếm số lượng tuyệt đối (vd: completions.length <= baseline)
// sẽ bỏ lỡ sự kiện mới khi Telegram Web cắt bớt đầu chat (trim) do chat phình
// nhanh lúc user chạy thủ công GLXH/chức năng khác song song. Cách chống trôi:
// ghi lại toàn bộ text lúc lấy baseline, mỗi lần poll chỉ quét phần text mới
// append sau baseline. Tin thủ công (GLXH...) không khớp pattern auto-buy nên
// tự bị loại; phần fresh là dup-free nên tín hiệu trong fresh chắc chắn là mới.
// Hàm này cũng dùng cho tracker phát hiện lệnh điều khiển (/startagent...).
function getFreshSince(baselineText, currentText) {
  if (baselineText === null || baselineText === undefined) return null;
  if (baselineText === "") return currentText ? currentText : null;
  if (currentText.startsWith(baselineText)) {
    const fresh = currentText.slice(baselineText.length);
    return fresh ? fresh : null;
  }
  const fullIndex = currentText.indexOf(baselineText);
  if (fullIndex >= 0) {
    const fresh = currentText.slice(fullIndex + baselineText.length);
    return fresh ? fresh : null;
  }
  for (const anchorLength of FRESH_ANCHOR_LENGTHS) {
    const anchor = baselineText.slice(-anchorLength);
    if (!anchor) continue;
    const anchorIndex = currentText.lastIndexOf(anchor);
    if (anchorIndex < 0) continue;
    const fresh = currentText.slice(anchorIndex + anchor.length);
    return fresh ? fresh : null;
  }
  return null; // snapshot bị thay hẳn: không suy đoán, dùng fallback đếm số lượng
}

function controlCommandMatches(text) {
  return [...text.matchAll(CONTROL_COMMAND_RE)].map((match) => match[1]);
}

function getNewTailCommands(previousText, currentText) {
  const previousTail = previousText.slice(-CONTROL_COMMAND_TAIL_LENGTH);
  const currentTail = currentText.slice(-CONTROL_COMMAND_TAIL_LENGTH);
  const previousCommands = controlCommandMatches(previousTail);
  const currentCommands = controlCommandMatches(currentTail);
  const countBy = (commands) =>
    commands.reduce(
      (counts, command) => ({ ...counts, [command]: counts[command] + 1 }),
      Object.fromEntries(CONTROL_COMMAND_NAMES.map((name) => [name, 0]))
    );
  const previousCounts = countBy(previousCommands);
  const seenCounts = countBy([]);
  return currentCommands.filter((command) => {
    seenCounts[command] += 1;
    return seenCounts[command] > previousCounts[command];
  });
}

function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = temp;
    }
  }
  return prev[b.length];
}

// Liệt kê token gần-đúng lệnh điều khiển (sai ≤2 ký tự), bỏ qua lệnh đúng.
function listNearMissControlCommands(text) {
  const valid = CONTROL_COMMAND_NAMES;
  const out = [];
  for (const token of text.match(/\/[A-Za-z@_]+/g) || []) {
    const base = token.split("@")[0].toLowerCase();
    if (valid.some((v) => base === `/${v}`)) continue;
    const word = base.slice(1);
    if (word.length < 5 || /[^a-z]/.test(word)) continue;
    if (!valid.some((v) => editDistance(word, v) <= 2)) continue;
    out.push(token);
  }
  return out;
}

function findNearMissControlCommand(text) {
  const list = listNearMissControlCommands(text);
  return list.length ? list[0] : null;
}

// Chỉ gợi ý khi token gần-đúng là TIN MỚI (chưa từng xuất hiện trong baseline).
// Nếu quét cả lịch sử cũ, lệnh cũ từ phiên trước sẽ gây gợi ý bậy mỗi lần chat
// có cập nhật. Lệnh gõ sai 2 lần thì lần 2 đã nằm trong baseline nên không nhắc lại.
function findNewNearMissControlCommand(baselineText, currentText) {
  const hit = listNearMissControlCommands(currentText)
    .find((token) => !baselineText || !baselineText.includes(token));
  return hit || null;
}

module.exports = {
  CONTROL_COMMAND_RE,
  CONTROL_START_COMMANDS,
  countMatches,
  lastPatternIndex,
  getFreshSince,
  controlCommandMatches,
  getNewTailCommands,
  editDistance,
  listNearMissControlCommands,
  findNearMissControlCommand,
  findNewNearMissControlCommand
};
