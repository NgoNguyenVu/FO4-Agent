// Nhận các đơn ICON đã mua xong trong TTCN (nút "Nhận").
//
// Phần chọn dòng là hàm thuần trong patterns.js; module này chỉ điều phối vòng
// đọc danh sách -> bấm "Nhận" -> đọc lại. Tách khỏi ttcn.js để test được hành
// vi mà không cần Playwright/Telegram thật.
const { log } = require("../agent-log");
const { selectIconOrdersToReceive } = require("./patterns");

// readOrders() phải trả về TOÀN BỘ dòng TTCN (đã cuộn/gộp nhiều trang).
// clickReceive(order) bấm đúng nút "Nhận" của card và trả { ok, message }.
// onReceived(item) được gọi ngay sau mỗi lần nhận thành công để runner chuyển
// tiếp sang mua phôi + nâng cấp.
async function receiveFromPlan({
  readOrders,
  clickReceive,
  players = null,
  grade = null,
  onReceived = null,
  maxRounds = 20
} = {}) {
  const received = [];
  const failed = [];
  // Card có thể còn trên DOM kèm thông báo "Nhận thành công"; đánh dấu đã xử lý
  // để không bấm lặp lại cùng một orderId.
  const handled = new Set();
  const rounds = Math.max(1, Number(maxRounds) || 1);
  for (let round = 0; round < rounds; round += 1) {
    const orders = await readOrders();
    const candidates = selectIconOrdersToReceive(orders, {
      players,
      grade
    }).filter((order) => !handled.has(order.orderId));
    if (!candidates.length) break;
    const order = candidates[0];
    handled.add(order.orderId);
    const result = (await clickReceive(order)) || {
      ok: false,
      message: "không rõ kết quả nhận"
    };
    if (!result.ok) {
      failed.push({ ...order, message: result.message });
      log(`Nhận ICON ${order.spid} thất bại: ${result.message}.`);
      // Không lặp lại cùng một card để tránh vòng lặp vô hạn.
      break;
    }
    const item = { ...order, message: result.message };
    received.push(item);
    log(
      `Đã nhận ICON ${order.spid}` +
        `${order.name ? ` ${order.name}` : ""} từ TTCN (${result.message}).`
    );
    if (typeof onReceived === "function") await onReceived(item);
  }
  return { received, failed };
}

module.exports = {
  receiveFromPlan
};
