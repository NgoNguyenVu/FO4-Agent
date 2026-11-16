// Quyết định chuyển tiếp sau khi nhận ICON từ TTCN.
//
// ICON vừa vào kho phải được đưa vào luồng mua phôi + nâng cấp ngay, không chờ
// hết nhịp inventoryCheckIntervalSeconds (30 phút). Hàm thuần để controller và
// test dùng chung, tránh mỗi nơi reset cờ theo một kiểu.
function iconReceivePivotPlan(received) {
  const list = Array.isArray(received) ? received.filter(Boolean) : [];
  if (!list.length) return null;
  return {
    inventoryKnownAvailable: false,
    nextInventoryCheckAt: 0,
    codes: list
      .map((item) => String(item.spid || item.code || ""))
      .filter(Boolean)
  };
}

module.exports = {
  iconReceivePivotPlan
};
