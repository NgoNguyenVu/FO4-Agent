const SP = "[ \\u00a0]";

const STARTED_RE = new RegExp(`Bắt${SP}đầu${SP}treo${SP}auto${SP}mua`, "g");
const ACTIVE_RE = new RegExp(`Đang${SP}treo${SP}mua${SP}cho${SP}chatId`, "g");
const AUTO_BUY_STOPPED_RE = new RegExp(
  `Đã${SP}dừng${SP}treo${SP}auto${SP}mua${SP}cho${SP}chatId\\s+\`?\\d+\`?`,
  "gi"
);
const STOPPED_RE = new RegExp(
  `Đã${SP}dừng${SP}treo${SP}auto${SP}mua${SP}cho${SP}chatId\\s+\`?\\d+\`?|Đã${SP}dừng\\s+\\d+${SP}luồng${SP}thành${SP}công`,
  "gi"
);
const GENERIC_STOPPED_RE = new RegExp(
  `Đã${SP}dừng\\s+\\d+${SP}luồng${SP}thành${SP}công`,
  "gi"
);
const STOP_NO_RUNNING_RE = new RegExp(
  `Hiện${SP}không${SP}có${SP}lệnh${SP}nào${SP}đang${SP}chạy|Không${SP}có${SP}worker${SP}nào${SP}đang${SP}chạy${SP}cho${SP}tài${SP}khoản${SP}này`,
  "gi"
);
const FULL_INVENTORY_STOP_RE = new RegExp(
  `/account\\s+reason\\s*=\\s*43\\b[\\s\\S]{0,400}?(?:Toàn${SP}bộ${SP}kho[\\s\\S]{0,80}?(?:đã${SP}bị${SP}đầy|đầy)|Dừng${SP}auto${SP}mua|Lệnh${SP}auto${SP}mua[\\s\\S]{0,40}?đã${SP}bị${SP}dừng)`,
  "gi"
);
const INVENTORY_RECEIVED_RE = new RegExp(
  `Đã${SP}nhận\\s+(\\d+)${SP}cầu${SP}thủ${SP}trong${SP}kho${SP}mua[\\s\\S]{0,80}?Tiếp${SP}tục${SP}mua`,
  "gi"
);
const STOP_MENU_RE = new RegExp(
  `Chọn${SP}luồng${SP}cần${SP}dừng${SP}cho${SP}chatId\\s+\`?\\d+\`?`,
  "gi"
);
const AUTO_BUY_STOP_OPTION_RE = /Mua[ \u00a0]phôi\s*\|/i;
const BOT_RATE_LIMIT_RE = new RegExp(
  `Bạn${SP}thao${SP}tác${SP}quá${SP}nhanh[\\s\\S]{0,200}?Vui${SP}lòng${SP}chờ\\s+(\\d+)\\s*s\\s+rồi${SP}thử${SP}lại`,
  "gi"
);
const BOT_SYSTEM_ERROR_RE = new RegExp(
  `E006:\\s*Lỗi${SP}hệ${SP}thống,${SP}vui${SP}lòng${SP}thử${SP}lại${SP}sau${SP}hoặc${SP}liên${SP}hệ${SP}hỗ${SP}trợ`,
  "gi"
);
const COMPLETED_RE = new RegExp(
  `Đã${SP}mua${SP}đủ\\s+(\\d+)${SP}cầu${SP}thủ|Hết${SP}thời${SP}gian${SP}treo\\.\\s*Hoàn${SP}thành${SP}mua\\s+(\\d+)${SP}cầu${SP}thủ`,
  "gi"
);
const PURCHASE_RE = new RegExp(`Mua${SP}thành${SP}công!`, "g");

// Bot có thể đổi câu dẫn menu (hoặc bỏ hẳn "Bạn muốn sử dụng tính năng nào?")
// nhưng các nút chức năng vẫn giữ nguyên. Nhận menu bằng chính các nhãn nút,
// không phụ thuộc câu dẫn, để không chờ oan rồi báo "chức năng khác thay thế".
const FEATURE_MENU_LABELS = [
  "auto mua phôi",
  "auto nâng cấp 2.0",
  "auto nâng cấp 1.0",
  "auto glxh",
  "bắn tỉa",
  "chèn vip member",
  "chèn chuyển hàng",
  "tra cứu giờ reset online",
  "nâng cấp cầu thủ"
];

function normalizeFeatureMenuText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

// Menu hợp lệ khi có nhãn bắt buộc + ít nhất một nhãn chức năng khác. Yêu cầu
// 2 nhãn giúp tránh nhầm một câu thông báo đơn lẻ có tên chức năng thành menu.
function hasFeatureMenuSignature(text, requiredLabel) {
  const normalized = normalizeFeatureMenuText(text);
  const required = normalizeFeatureMenuText(requiredLabel);
  if (!required || !normalized.includes(required)) return false;
  const matches = FEATURE_MENU_LABELS.filter((label) =>
    normalized.includes(label)
  );
  return matches.length >= 2;
}

const constants = {
  BOT_COMMAND_DELAY_MS: 4_000,
  // Khoảng cách tối thiểu giữa hai lệnh /tn. Dùng chung cho mua và nâng để
  // không gửi dồn khi mini-app lỗi; bot vẫn có thể yêu cầu chờ lâu hơn.
  TN_COMMAND_COOLDOWN_MS: 15_000,
  // Iframe mở nhưng body rỗng quá lâu là lỗi render, không phải tải chậm.
  MINI_APP_BLANK_TIMEOUT_MS: 15_000,
  // Bot thường xác nhận "Bắt đầu treo auto mua" trong vài giây. Nếu quá lâu,
  // kiểm tra /stop rồi bấm lại thay vì treo 5 phút (bot đôi lúc lag).
  BUY_START_ACK_TIMEOUT_MS: 90_000,
  PLAYWRIGHT_TIMEOUT_MS: 30_000,
  RECENT_CHAT_TEXT_LENGTH: 100_000,
  CHAT_HISTORY_LOAD_TIMEOUT_MS: 30_000,
  CHAT_TEXT_POLL_INTERVAL_MS: 500,
  CONTROL_COMMAND_STATUS_LOG_INTERVAL_MS: 15_000,
  CONTROL_COMMAND_TAIL_LENGTH: 1_000,
  MINI_APP_BP_LOAD_RETRIES: 2,
  FRESH_ANCHOR_LENGTHS: [4_000, 1_000, 256],
  DISPLAYED_BP_RE: /Giá hiển thị\s*:\s*[\d.,]+\s*BP\b/i
};

module.exports = {
  ...constants,
  STARTED_RE,
  ACTIVE_RE,
  AUTO_BUY_STOPPED_RE,
  STOPPED_RE,
  GENERIC_STOPPED_RE,
  STOP_NO_RUNNING_RE,
  FULL_INVENTORY_STOP_RE,
  INVENTORY_RECEIVED_RE,
  STOP_MENU_RE,
  AUTO_BUY_STOP_OPTION_RE,
  BOT_RATE_LIMIT_RE,
  BOT_SYSTEM_ERROR_RE,
  COMPLETED_RE,
  PURCHASE_RE,
  FEATURE_MENU_LABELS,
  hasFeatureMenuSignature
};
