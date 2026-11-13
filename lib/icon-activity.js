// Mốc thao tác gần nhất của luồng ICON lên chat bot.
//
// Luồng ICON và chu kỳ Auto Mua Phôi dùng chung một chat Telegram. Khi ICON gửi
// /tn, bấm nút hoặc gửi danh sách mua, bot có thể trả E006 cho chính thao tác
// đó. Trước đây chu kỳ Mua phôi đang chờ coi mọi E006 mới là lỗi của mình nên
// agent về idle oan (log 2026-11-10T11:21Z: ICON gửi /tn lúc 11:21:20, E006 lúc
// 11:21:43, agent dừng gần 80 phút). Controller dùng mốc này để quy E006 về
// đúng luồng.
const ICON_E006_ATTRIBUTION_MS = 120_000;

let lastActivityAt = 0;

function markIconActivity(at = Date.now()) {
  lastActivityAt = at;
}

function getLastIconActivityAt() {
  return lastActivityAt;
}

// Có thao tác ICON trong khoảng `withinMs` tính tới `now` không?
function isRecentIconActivity(
  withinMs = ICON_E006_ATTRIBUTION_MS,
  now = Date.now()
) {
  return lastActivityAt > 0 && now - lastActivityAt <= withinMs;
}

// Dùng cho test để không rò trạng thái giữa các ca.
function resetIconActivity() {
  lastActivityAt = 0;
}

module.exports = {
  ICON_E006_ATTRIBUTION_MS,
  markIconActivity,
  getLastIconActivityAt,
  isRecentIconActivity,
  resetIconActivity
};
