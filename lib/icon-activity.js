// Mốc thao tác gần nhất của luồng ICON lên chat bot.
//
// Luồng ICON và chu kỳ Auto Mua Phôi dùng chung một chat Telegram. Khi ICON gửi
// /tn, bấm nút hoặc gửi danh sách mua, bot có thể trả E006 cho chính thao tác
// đó. Trước đây chu kỳ Mua phôi đang chờ coi mọi E006 mới là lỗi của mình nên
// agent về idle oan (log 2026-11-10T11:21Z: ICON gửi /tn lúc 11:21:20, E006 lúc
// 11:21:43, agent dừng gần 80 phút). Controller dùng mốc này để quy E006 về
// đúng luồng.
const ICON_E006_ATTRIBUTION_MS = 120_000;
// Menu /stop của ICON runner thường trả về trong vài giây. Buy waiter dùng cửa
// sổ này để KHÔNG coi menu đó là bằng chứng "worker mua đã biến mất".
const ICON_STOP_ATTRIBUTION_MS = 15_000;

let lastActivityAt = 0;
let lastIconStopCommandAt = 0;

function markIconActivity(at = Date.now()) {
  lastActivityAt = at;
}

function getLastIconActivityAt() {
  return lastActivityAt;
}

function markIconStopCommand(at = Date.now()) {
  lastIconStopCommandAt = at;
}

function getLastIconStopCommandAt() {
  return lastIconStopCommandAt;
}

function isRecentIconStopCommand(
  withinMs = ICON_STOP_ATTRIBUTION_MS,
  now = Date.now()
) {
  return (
    lastIconStopCommandAt > 0 &&
    now - lastIconStopCommandAt <= withinMs
  );
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
  lastIconStopCommandAt = 0;
}

module.exports = {
  ICON_E006_ATTRIBUTION_MS,
  ICON_STOP_ATTRIBUTION_MS,
  markIconActivity,
  getLastIconActivityAt,
  markIconStopCommand,
  getLastIconStopCommandAt,
  isRecentIconStopCommand,
  isRecentIconActivity,
  resetIconActivity
};
