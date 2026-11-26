// Registry các kịch bản khởi chạy. Mỗi mode là một entry ĐỘC LẬP: muốn thêm
// [3], [4]… chỉ cần đăng ký entry mới với `features` riêng; KHÔNG tự động gộp
// vào mode [1] và cũng KHÔNG có khái niệm "master chạy tất cả".
"use strict";

const LAUNCH_MODES = Object.freeze([
  Object.freeze({
    id: 1,
    key: "icon-combo",
    label: "Săn ICON + Mua phôi & Nâng +7",
    description:
      "Chạy đồng thời luồng săn ICON nền và luồng mua phôi/nâng khi có ICON dưới +7.",
    features: Object.freeze(["icon-buy", "buy-upgrade"]),
    default: true
  }),
  Object.freeze({
    id: 2,
    key: "icon-only",
    label: "Chỉ săn đặt mua ICON",
    description:
      "Chỉ đặt mua ICON và theo dõi TTCN; không mở mini-app kiểm tra kho, không mua phôi/nâng.",
    features: Object.freeze(["icon-buy"]),
    default: false
  }),
  Object.freeze({
    id: 3,
    key: "bait-upgrade",
    label: "Nâng thủ công từng nhịp (BAIT/MAIN + AI)",
    description:
      "Mở màn hình Nâng Cấp Cầu Thủ, AI đọc nhịp random, code chốt BAIT/MAIN; độc lập với ICON và nâng lô.",
    features: Object.freeze(["bait-upgrade"]),
    default: false
  })
]);

function getLaunchModes() {
  return LAUNCH_MODES;
}

function getDefaultLaunchMode() {
  return LAUNCH_MODES.find((mode) => mode.default) || LAUNCH_MODES[0];
}

function getLaunchMode(value) {
  if (value == null) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  return (
    LAUNCH_MODES.find((mode) => mode.key.toLowerCase() === raw) ||
    LAUNCH_MODES.find((mode) => String(mode.id) === raw) ||
    null
  );
}

// Giá trị nhập ở menu hoặc `--mode`. Chuỗi rỗng = chọn mặc định [1].
function parseModeSelection(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return getDefaultLaunchMode();
  return getLaunchMode(text);
}

// Đọc cờ --mode từ argv. Trả null nếu không có cờ.
function parseModeArgument(argv = []) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--mode") {
      const next = argv[index + 1];
      return next === undefined || String(next).startsWith("--") ? "" : String(next);
    }
    if (arg.startsWith("--mode=")) return arg.slice("--mode=".length);
  }
  return null;
}

function formatLaunchMenu() {
  const lines = ["Chọn chế độ khởi chạy:"];
  for (const mode of LAUNCH_MODES) {
    lines.push(`  [${mode.id}] ${mode.label}${mode.default ? " (mặc định)" : ""}`);
  }
  lines.push("Nhấn Enter để chọn mặc định.");
  return lines.join("\n");
}

module.exports = {
  LAUNCH_MODES,
  getLaunchModes,
  getDefaultLaunchMode,
  getLaunchMode,
  parseModeSelection,
  parseModeArgument,
  formatLaunchMenu
};
