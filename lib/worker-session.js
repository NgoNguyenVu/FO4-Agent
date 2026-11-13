// Adapter mỏng giữa controller và worker registry (TASK-005 Stage B).
//
// Mục đích:
// - Giữ map feature → workerId cho phiên hiện tại để controller không phải
//   truyền workerId khắp nơi.
// - Biến lỗi "đang có worker" thành tín hiệu fail-closed (trả null) thay vì
//   throw, để controller về idle và chờ con người thay vì mua chồng.
// - Gói logic reconcile khi khởi động/khôi phục phiên.
//
// Module này không import features/ hay Playwright nên test được bằng registry
// thật ghi ra thư mục tạm.
const GROUPS = ["exclusive", "background"];

function createWorkerSession({
  registry,
  log = () => {},
  logError = () => {}
} = {}) {
  if (!registry) throw new TypeError("createWorkerSession cần registry.");

  const current = new Map(); // feature → { workerId, state, concurrencyGroup }
  let lastBlock = null;

  function entry(feature) {
    return current.get(feature) || null;
  }

  function isRegistered(feature) {
    return current.has(feature);
  }

  function tryBegin(
    feature,
    { cycleId = null, concurrencyGroup = "exclusive", quiet = false } = {}
  ) {
    if (!GROUPS.includes(concurrencyGroup)) {
      throw new TypeError(`tryBegin: concurrencyGroup phải là ${GROUPS.join("|")}.`);
    }
    const existing = entry(feature);
    if (existing) return { ...existing, reused: true };
    try {
      const workerId = registry.beginStart({ feature, cycleId, concurrencyGroup });
      const worker = { workerId, state: "starting", concurrencyGroup };
      current.set(feature, worker);
      lastBlock = null;
      log(`Đăng ký worker ${workerId} (${feature}, ${concurrencyGroup}).`);
      return { ...worker, reused: false };
    } catch (error) {
      if (error.code !== "WORKER_ACTIVE") throw error;
      lastBlock = {
        reason: error.code,
        message: error.message,
        workers: error.workers || []
      };
      if (!quiet) {
        log(
          `Không bắt đầu ${feature}: ${error.message} ` +
            "Agent giữ nguyên trạng thái, không mua chồng."
        );
      }
      return null;
    }
  }

  function markRunning(feature) {
    const worker = entry(feature);
    if (!worker) return null;
    if (worker.state === "running") return { ...worker };
    registry.markRunning(worker.workerId);
    worker.state = "running";
    return { ...worker };
  }

  function markUnknown(feature, reason = "unknown") {
    const worker = entry(feature);
    if (!worker) return null;
    current.delete(feature);
    return registry.markUnknown(worker.workerId, reason);
  }

  function stop(feature, { reason = "done", unknown = false } = {}) {
    const worker = entry(feature);
    if (!worker) return null;
    current.delete(feature);
    try {
      if (unknown) {
        const record = registry.markUnknown(worker.workerId, reason);
        logError(
          `Worker ${worker.workerId} (${feature}) → unknown (${reason}); ` +
            "chặn mua mới tới khi con người xác nhận."
        );
        return record;
      }
      if (worker.state === "starting" || worker.state === "running") {
        registry.beginStop(worker.workerId);
      }
      const record = registry.markStopped(worker.workerId);
      log(`Worker ${worker.workerId} (${feature}) → stopped (${reason}).`);
      return record;
    } catch (error) {
      logError(
        `Không đóng được worker ${feature} (${worker.workerId}): ${error.message}`
      );
      return null;
    }
  }

  // Khôi phục phiên: worker nền (icon) không thể adopt sau restart vì process
  // cũ đã chết. Worker exclusive (buy/upgrade) chỉ được adopt khi chat còn bằng
  // chứng đang chạy; nếu không, registry sẽ mark unknown và chặn.
  function reconcileOnStartup({
    hasWorkerEvidence = false,
    staleFeatures = ["icon"]
  } = {}) {
    const snapshot = registry.getSnapshot();
    const staleStopped = [];
    for (const worker of snapshot.workers) {
      if (!staleFeatures.includes(worker.feature)) continue;
      if (worker.state !== "starting" && worker.state !== "running") continue;
      try {
        staleStopped.push(registry.markStopped(worker.workerId));
        log(
          `Worker ${worker.workerId} (${worker.feature}) còn sót sau restart → stopped.`
        );
      } catch (error) {
        logError(
          `Không dọn được worker ${worker.workerId} sau restart: ${error.message}`
        );
      }
    }

    const outcome = registry.reconcile({ hasWorkerEvidence });
    if (outcome.action === "adopt") {
      for (const worker of outcome.workers) {
        current.set(worker.feature, {
          workerId: worker.workerId,
          state: worker.state,
          concurrencyGroup: worker.concurrencyGroup || "exclusive"
        });
      }
      log(
        `Adopt ${outcome.workers.length} worker từ registry ` +
          `(${outcome.workers.map((worker) => worker.workerId).join(", ")}).`
      );
    } else if (outcome.action === "block") {
      logError(
        `Registry chặn khởi động worker (${outcome.reason}); ` +
          "agent sẽ không bấm mua/nâng cho tới khi được xử lý."
      );
    }
    return { ...outcome, staleStopped };
  }

  function listActive() {
    return [...current.entries()].map(([feature, worker]) => ({
      feature,
      ...worker
    }));
  }

  function activeWorkerIds() {
    return listActive().map((worker) => worker.workerId);
  }

  function blockedReason() {
    return lastBlock;
  }

  return {
    tryBegin,
    markRunning,
    markUnknown,
    stop,
    reconcileOnStartup,
    isRegistered,
    listActive,
    activeWorkerIds,
    blockedReason
  };
}

module.exports = { createWorkerSession };
