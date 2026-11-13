// Cấu hình tập trung + validate cho từng feature.
// Trước đây validateConfig trong autobuy.js phải lazy-require autonangcap,
// tạo phụ thuộc chéo giữa hai feature.
const rawConfig = require("../config.json");

const config = {
  ...rawConfig,
  // Chờ menu /tn ngắn hơn thời gian chờ ack dài (mua/nâng cấp). Bot thường trả
  // menu trong vài giây; nếu quá lâu thì giao diện đang bận và nên thử lại sớm.
  menuResponseTimeoutSeconds: rawConfig.menuResponseTimeoutSeconds ?? 45,
  menuBusyRetrySeconds: rawConfig.menuBusyRetrySeconds ?? 15,
  upgradeFrameTimeoutSeconds: rawConfig.upgradeFrameTimeoutSeconds ?? 30,
  upgrade: {
    targetGrade: 6,
    ovrPhoi: "114,115,116,117",
    maxPriceEach: "2M",
    waitMs: 3000,
    minRatio: 100,
    bpProtectFromGrade: 8,
    maxUpgradeWaitMinutes: 180,
    // Khi bot không gửi terminal, mini-app còn mở: sau 60 giây bắt đầu kiểm tra
    // danh sách target, sau đó lặp lại mỗi 120 giây. Tải lại kho là thao tác đọc.
    targetCheckDelaySeconds: 60,
    targetCheckIntervalSeconds: 120,
    ...(rawConfig.upgrade || {})
  },
  // Process lock + worker registry (TASK-005). State ghi ngoài repo ở
  // <LOCALAPPDATA>/FO4PurchaseAgent/state/; đường dẫn do agent.js quyết định.
  worker: {
    leaseSeconds: 60,
    heartbeatSeconds: 20,
    ...(rawConfig.worker || {})
  },
  // Lượt ICON: chọn ngẫu nhiên 1 cầu thủ yêu thích, mua +1/1 rồi chuyển sang
  // mua phôi và nâng cấp.
  iconBuy: {
    // Mỗi lượt gửi tối đa 3 mã (giới hạn của bot).
    maxPlayersPerBatch: 3,    grade: 1,
    quantity: 1,
    cancelPositionAbove: 3,
    menuTimeoutSeconds: 45,
    favoritesTimeoutSeconds: 60,
    // 0 = theo dõi không giới hạn khi bot chưa trả kết quả.
    purchaseTimeoutSeconds: 0,
    // Chờ tối đa trước khi quay lại đọc /stop dù chưa có log đặt mua. Không
    // hủy task, chỉ tránh treo vô hạn khi bot không gửi log (0 = tắt watchdog).
    purchaseSoftTimeoutSeconds: 1800,
    // Mỗi lần theo dõi task đang chạy chỉ chờ tối đa N giây rồi đọc lại /stop,
    // tránh kẹt mãi ở một lần chờ log (0 = chờ không giới hạn như cũ).
    monitorWaitSeconds: 900,
    ttcnTimeoutSeconds: 60,
    batchIntervalSeconds: 2,
    // Giữ tối đa 3 task ICON và theo dõi vô hạn; vòng chính mua phôi/nâng
    // độc lập khi phát hiện ICON đã vào kho.
    continuous: true,
    monitorExistingOrders: true,
    slotPollSeconds: 15,
    maxBatchesPerRun: 1,
    captureTtcnBaseline: true,
    // Số task mua cho phép của bot; task thủ công đang chạy sẽ dùng slot này.
    maxTaskSlots: 3,
    // Khoảng cách tối thiểu giữa hai lần mở mini-app kiểm tra kho khi chưa
    // thấy ICON. 30 phút để không mở mini-app liên tục (trước đây ~15-30s/lần).
    inventoryCheckIntervalSeconds: 1800,
    ...(rawConfig.iconBuy || {})
  }
};

function requirePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Cấu hình ${name} phải là số nguyên dương.`);
  }
}

function requireNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Cấu hình ${name} phải là số nguyên >= 0.`);
  }
}

function validateBuyConfig() {
  requirePositiveInteger(config.ovrMin, "ovrMin");
  requirePositiveInteger(config.ovrMax, "ovrMax");
  requirePositiveInteger(config.maxPriceBP, "maxPriceBP");
  requirePositiveInteger(config.quantityPerAttempt, "quantityPerAttempt");
  requirePositiveInteger(config.maxPerCycle, "maxPerCycle");
  requirePositiveInteger(config.maxCycleWaitMinutes, "maxCycleWaitMinutes");
  requirePositiveInteger(config.botResponseTimeoutMinutes, "botResponseTimeoutMinutes");
  requirePositiveInteger(
    config.menuResponseTimeoutSeconds,
    "menuResponseTimeoutSeconds"
  );
  requirePositiveInteger(config.menuBusyRetrySeconds, "menuBusyRetrySeconds");
  requirePositiveInteger(
    config.upgradeFrameTimeoutSeconds,
    "upgradeFrameTimeoutSeconds"
  );
  if (config.ovrMin > config.ovrMax) {
    throw new Error("ovrMin không được lớn hơn ovrMax.");
  }
  if (config.quantityPerAttempt > 5) {
    throw new Error("Bot ghi số lượng mỗi lượt phải nhỏ hơn hoặc bằng 5.");
  }
}

function getUpgradeSpec() {
  return { ...config.upgrade };
}

function validateUpgradeConfig() {
  const s = getUpgradeSpec();
  for (const [key, value] of Object.entries({
    targetGrade: s.targetGrade,
    waitMs: s.waitMs,
    minRatio: s.minRatio,
    bpProtectFromGrade: s.bpProtectFromGrade,
    maxUpgradeWaitMinutes: s.maxUpgradeWaitMinutes,
    targetCheckDelaySeconds: s.targetCheckDelaySeconds,
    targetCheckIntervalSeconds: s.targetCheckIntervalSeconds
  })) {
    requireNonNegativeInteger(value, `upgrade.${key}`);
  }
  if (s.targetGrade < 1) {
    throw new Error("Cấu hình upgrade.targetGrade phải >= 1.");
  }
  if (s.minRatio > 100) {
    throw new Error("Cấu hình upgrade.minRatio phải nằm trong 0..100.");
  }
  if (s.maxUpgradeWaitMinutes < 1) {
    throw new Error("Cấu hình upgrade.maxUpgradeWaitMinutes phải >= 1.");
  }
  requirePositiveInteger(
    s.targetCheckDelaySeconds,
    "upgrade.targetCheckDelaySeconds"
  );
  requirePositiveInteger(
    s.targetCheckIntervalSeconds,
    "upgrade.targetCheckIntervalSeconds"
  );
  if (!s.ovrPhoi || !s.maxPriceEach) {
    throw new Error("Cấu hình upgrade.ovrPhoi và upgrade.maxPriceEach không được trống.");
  }
}

function validateIconBuyConfig() {
  const s = config.iconBuy;
  requirePositiveInteger(s.maxPlayersPerBatch, "iconBuy.maxPlayersPerBatch");
  if (s.maxPlayersPerBatch > 3) {
    throw new Error("iconBuy.maxPlayersPerBatch tối đa là 3 (giới hạn của bot).");
  }
  requirePositiveInteger(s.grade, "iconBuy.grade");
  requirePositiveInteger(s.quantity, "iconBuy.quantity");
  requirePositiveInteger(s.cancelPositionAbove, "iconBuy.cancelPositionAbove");
  requirePositiveInteger(s.menuTimeoutSeconds, "iconBuy.menuTimeoutSeconds");
  requirePositiveInteger(s.favoritesTimeoutSeconds, "iconBuy.favoritesTimeoutSeconds");
  requireNonNegativeInteger(s.purchaseTimeoutSeconds, "iconBuy.purchaseTimeoutSeconds");
  requireNonNegativeInteger(
    s.purchaseSoftTimeoutSeconds,
    "iconBuy.purchaseSoftTimeoutSeconds"
  );
  requireNonNegativeInteger(s.monitorWaitSeconds, "iconBuy.monitorWaitSeconds");
  requireNonNegativeInteger(
    s.inventoryCheckIntervalSeconds,
    "iconBuy.inventoryCheckIntervalSeconds"
  );
  requirePositiveInteger(s.ttcnTimeoutSeconds, "iconBuy.ttcnTimeoutSeconds");
  requireNonNegativeInteger(s.batchIntervalSeconds, "iconBuy.batchIntervalSeconds");
  requirePositiveInteger(s.slotPollSeconds, "iconBuy.slotPollSeconds");
  requireNonNegativeInteger(s.maxBatchesPerRun, "iconBuy.maxBatchesPerRun");
  if (s.grade !== 1 || s.quantity !== 1) {
    throw new Error("Luồng ICON chỉ hỗ trợ mức thẻ +1 và số lượng 1.");
  }
  if (typeof s.continuous !== "boolean") {
    throw new Error("iconBuy.continuous phải là true/false.");
  }
  if (typeof s.captureTtcnBaseline !== "boolean") {
    throw new Error("iconBuy.captureTtcnBaseline phải là true/false.");
  }
  requirePositiveInteger(s.maxTaskSlots, "iconBuy.maxTaskSlots");
  if (s.maxTaskSlots > 3) {
    throw new Error("iconBuy.maxTaskSlots tối đa là 3 (giới hạn của bot).");
  }
}

function validateWorkerConfig() {
  const w = config.worker || {};
  requirePositiveInteger(w.leaseSeconds, "worker.leaseSeconds");
  requirePositiveInteger(w.heartbeatSeconds, "worker.heartbeatSeconds");
  if (w.heartbeatSeconds >= w.leaseSeconds) {
    throw new Error(
      "Cấu hình worker.heartbeatSeconds phải nhỏ hơn worker.leaseSeconds để lease không hết hạn giữa hai nhịp."
    );
  }
}

function validateConfig() {
  validateBuyConfig();
  validateUpgradeConfig();
  validateIconBuyConfig();
  validateWorkerConfig();
}

module.exports = {
  config,
  getUpgradeSpec,
  validateBuyConfig,
  validateUpgradeConfig,
  validateIconBuyConfig,
  validateWorkerConfig,
  validateConfig
};
