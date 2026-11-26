// Cấu hình tập trung + validate cho từng feature.
// Trước đây validateConfig trong autobuy.js phải lazy-require autonangcap,
// tạo phụ thuộc chéo giữa hai feature.
const rawConfig = require("../config.json");
const { createValidators } = require("../lib/config-validators");
const { parseOvrSpec } = require("../lib/ovr-spec");

const {
  requirePositiveInteger,
  requireNonNegativeInteger,
  requireBoolean,
  requireNonEmptyString
} = createValidators("Cấu hình ");

// Chuẩn hóa chuỗi OVR trước khi lưu/gõ vào mini-app: " 115, 118 - 120 " ->
// "115,118-120". Không lọc phần tử rỗng để giá trị sai ("118,") vẫn bị
// validate chặn thay vì âm thầm hợp lệ.
function normalizeOvrSpec(raw) {
  return String(raw ?? "")
    .split(",")
    .map((part) => part.trim().replace(/\s*-\s*/g, "-"))
    .join(",");
}

// "2,5M" là thập phân kiểu Việt; chuẩn về "2.5M" để parseMarketPrice và bot
// không đọc nhầm thành 25M. Dấu phẩy ở số không có hậu tố ("625,000") giữ nguyên
// vì đó là dấu hàng nghìn.
function normalizePriceSpec(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/^(\d+),(\d+)(\s*[KMB])$/i, "$1.$2$3");
}

const config = {
  ...rawConfig,
  // Chờ menu /tn ngắn hơn thời gian chờ ack dài (mua/nâng cấp). Bot thường trả
  // menu trong vài giây; nếu quá lâu thì giao diện đang bận và nên thử lại sớm.
  menuResponseTimeoutSeconds: rawConfig.menuResponseTimeoutSeconds ?? 45,
  menuBusyRetrySeconds: rawConfig.menuBusyRetrySeconds ?? 15,
  upgradeFrameTimeoutSeconds: rawConfig.upgradeFrameTimeoutSeconds ?? 30,
  upgrade: {
    targetGrade: 6,
    // Không đặt dải phôi mặc định: người dùng tự chọn trong config.json.
    // Để trống thì validateConfig báo lỗi rõ thay vì âm thầm áp một dải lạ.
    maxPriceEach: "2M",
    waitMs: 3000,
    minRatio: 100,
    bpProtectFromGrade: 8,
    maxUpgradeWaitMinutes: 180,
    // Khi bot không gửi terminal, mini-app còn mở: sau 60 giây bắt đầu kiểm tra
    // danh sách target, sau đó lặp lại mỗi 120 giây. Tải lại kho là thao tác đọc.
    targetCheckDelaySeconds: 60,
    targetCheckIntervalSeconds: 120,
    ...(rawConfig.upgrade || {}),
    // Luôn lưu dạng đã chuẩn hóa; mini-app nhận chuỗi này nguyên văn.
    ovrPhoi: normalizeOvrSpec(rawConfig.upgrade?.ovrPhoi ?? ""),
    maxPriceEach: normalizePriceSpec(rawConfig.upgrade?.maxPriceEach ?? "2M")
  },
  // Giới hạn chi tiêu / live trading đã bị bỏ: TASK-003 Stage B là WONT_DO,
  // giữ lại block config chỉ gây hiểu nhầm là agent đang enforce.
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
  },
  // Mode [3] bait-upgrade: nâng thủ công từng nhịp, AI advisory + code guard.
  baitUpgrade: {
    targetGrade: 7,
    main: { seasons: ["ICON"], playerIds: [], minGrade: 1, maxGrade: 13 },
    bait: { seasons: [], maxPriceBP: 500000 },
    minFillRatio: 0.92,
    maxMaterials: 5,
    maxBaitPerRound: 2,
    maxBaitPerTarget: 8,
    stopAfterConsecutiveFails: 3,
    ai: { timeoutMs: 15000, maxRetries: 2, fallback: "local" },
    safety: {
      minRandomForMain: 0,
      maxBaitPerRound: 2,
      maxMainSpendBP: 2000000,
      allowSoiCau: true,
      maxSoiCauClicksPerRound: 3,
      dryRun: false
    },
    market: { minLiquidity: 3, maxPriceBP: 500000, bands: ["108-112", "113-114", "115-118", "119-120"] },
    fifa: { locale: "vn" },
    timing: { roundTimeoutMs: 60000, cooldownMs: 3000 },
    ...(rawConfig.baitUpgrade || {})
  }
};

// Kiểm tra sớm định dạng OVR trước khi mini-app mở: trước đây lỗi chỉ nổi ở
// features/upgrade/patterns.parseOvrList() giữa phiên nâng cấp. Từ TASK-051 cả
// hai dùng chung lib/ovr-spec.js, nên config và runtime không thể lệch luật.
function validateOvrSpec(raw) {
  requireNonEmptyString(raw, "upgrade.ovrPhoi");
  try {
    parseOvrSpec(raw);
  } catch (error) {
    throw new Error(`Cấu hình upgrade.ovrPhoi không hợp lệ: ${error.message}`);
  }
}

// maxPriceEach được gõ nguyên văn vào ô "Giá tối đa" của mini-app, nên chỉ chấp
// nhận dạng bot hiểu: số nguyên hoặc thập phân + hậu tố K/M/B tuỳ chọn.
function validatePriceSpec(raw) {
  requireNonEmptyString(raw, "upgrade.maxPriceEach");
  if (!/^\d+(?:[.,]\d+)?\s*[KMB]?$/i.test(raw.trim())) {
    throw new Error(
      `Cấu hình upgrade.maxPriceEach không hợp lệ: "${raw}" (ví dụ hợp lệ: 2M, 500K, 2000000).`
    );
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
  return {
    ...config.upgrade,
    // Chuẩn hóa lại ở điểm xuất ra: test/đổi config lúc runtime vẫn được sạch.
    ovrPhoi: normalizeOvrSpec(config.upgrade.ovrPhoi),
    maxPriceEach: normalizePriceSpec(config.upgrade.maxPriceEach)
  };
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
  // Combobox của mini-app nâng chỉ có +2 .. +13. Giá trị ngoài dải này vẫn qua
  // được validate kiểu số nhưng sẽ throw giữa phiên khi selectOption.
  if (s.targetGrade < 2 || s.targetGrade > 13) {
    throw new Error("Cấu hình upgrade.targetGrade phải nằm trong 2..13 (dải combobox của mini-app).");
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
  validateOvrSpec(s.ovrPhoi);
  validatePriceSpec(s.maxPriceEach);
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
  requireBoolean(s.monitorExistingOrders, "iconBuy.monitorExistingOrders");
  if (typeof s.captureTtcnBaseline !== "boolean") {
    throw new Error("iconBuy.captureTtcnBaseline phải là true/false.");
  }
  requirePositiveInteger(s.maxTaskSlots, "iconBuy.maxTaskSlots");
  if (s.maxTaskSlots > 3) {
    throw new Error("iconBuy.maxTaskSlots tối đa là 3 (giới hạn của bot).");
  }
}

function getBaitSpec() {
  return { ...config.baitUpgrade };
}

function validateBaitConfig() {
  const s = getBaitSpec();
  if (!Number.isInteger(s.targetGrade) || s.targetGrade < 2 || s.targetGrade > 13) {
    throw new Error("Cấu hình baitUpgrade.targetGrade phải nằm trong 2..13.");
  }
  const ratio = Number(s.minFillRatio);
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
    throw new Error("Cấu hình baitUpgrade.minFillRatio phải nằm trong (0..1].");
  }
  if (!Array.isArray(s.main?.seasons) || !s.main.seasons.length) {
    throw new Error("Cấu hình baitUpgrade.main.seasons không được rỗng.");
  }
  if (!Number.isInteger(s.maxMaterials) || s.maxMaterials < 1 || s.maxMaterials > 5) {
    throw new Error("Cấu hình baitUpgrade.maxMaterials phải nằm trong 1..5.");
  }
  if (!Number.isFinite(Number(s.ai?.timeoutMs)) || Number(s.ai.timeoutMs) < 1000) {
    throw new Error("Cấu hình baitUpgrade.ai.timeoutMs phải >= 1000.");
  }
  if (!Number.isFinite(Number(s.market?.minLiquidity)) || Number(s.market.minLiquidity) < 1) {
    throw new Error("Cấu hình baitUpgrade.market.minLiquidity phải >= 1.");
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
  validateBaitConfig();
  validateWorkerConfig();
}

module.exports = {
  config,
  getUpgradeSpec,
  getBaitSpec,
  normalizeOvrSpec,
  normalizePriceSpec,
  validateBuyConfig,
  validateUpgradeConfig,
  validateIconBuyConfig,
  validateBaitConfig,
  validateWorkerConfig,
  validateConfig
};
