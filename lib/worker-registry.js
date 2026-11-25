// Process lock + worker registry (TASK-005, Stage A).
//
// Mục tiêu Stage A:
// - Chặn hai instance agent cùng thao tác một account (double-start → mua trùng).
// - Có state machine worker tối thiểu (starting → running → stopping → stopped,
//   nhánh unknown) được ghi bền vững để lần khởi động sau reconcile.
// - Lease + heartbeat để phát hiện process chết mà không cần can thiệp tay.
//
// Stage B (backlog): controller dùng registry làm source of truth thay cho
// suy luận từ chat text; hiện tại registry chạy ở chế độ process-lock + ghi state.
const fs = require("node:fs");
const path = require("node:path");
const {
  writeJsonAtomic: writeJsonAtomicFile,
  cleanupStaleTmp
} = require("./atomic-file");

const DEFAULT_LEASE_MS = 60_000;
const MAX_WORKER_HISTORY = 50;
const LOCK_VERSION = 1;
const WORKER_STATES = ["starting", "running", "stopping", "stopped", "unknown"];
// "exclusive": buy/upgrade — chỉ một worker exclusive được chạy tại một thời điểm.
// "background": icon — được chạy song song với worker exclusive, nhưng không
// được có hai worker cùng feature.
const WORKER_CONCURRENCY_GROUPS = ["exclusive", "background"];

function defaultIsProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: process tồn tại nhưng không có quyền signal — vẫn coi là sống.
    return error.code === "EPERM";
  }
}

function createWorkerRegistry({
  statePath,
  lockPath,
  pid = process.pid,
  now = () => Date.now(),
  leaseMs = DEFAULT_LEASE_MS,
  isProcessAlive = defaultIsProcessAlive,
  log = () => {},
  logError = () => {},
  fsImpl = fs
} = {}) {
  if (!lockPath) throw new TypeError("createWorkerRegistry cần lockPath.");
  if (!statePath) throw new TypeError("createWorkerRegistry cần statePath.");

  // Dọn temp file sót sau lần ghi trước bị ngắt (mất điện/kill cứng).
  cleanupStaleTmp(path.dirname(statePath), { fsImpl, isAlive: isProcessAlive });
  cleanupStaleTmp(path.dirname(lockPath), { fsImpl, isAlive: isProcessAlive });

  const token = `${pid}-${now()}-${Math.random().toString(36).slice(2, 10)}`;
  const startedAt = new Date(now()).toISOString();
  let processLock = null; // { pid, token, startedAt, heartbeatAt, leaseUntil }
  // Chỉ quarantine một lần cho mỗi instance để agent retry không sinh hàng loạt
  // file .corrupt-*; file gốc vẫn được giữ nguyên để con người kiểm tra.
  let corruptStateQuarantined = false;
  let corruptLockQuarantined = false;

  function writeJsonAtomic(file, value) {
    return writeJsonAtomicFile(file, value, { fsImpl });
  }

  function lockIsFresh(lock) {
    if (!lock || typeof lock !== "object") return false;
    const leaseUntil = Number(lock.leaseUntil) || 0;
    if (leaseUntil <= now()) return false;
    if (lock.pid === pid) return true;
    return isProcessAlive(lock.pid);
  }

  function isLockRecord(lock) {
    return Boolean(
      lock &&
        typeof lock === "object" &&
        !Array.isArray(lock) &&
        typeof lock.token === "string" &&
        lock.token.trim() &&
        Number.isInteger(Number(lock.pid)) &&
        Number.isFinite(Number(lock.leaseUntil))
    );
  }

  function quarantineCorruptLock() {
    if (corruptLockQuarantined) return null;
    corruptLockQuarantined = true;
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, "-");
    const target = `${lockPath}.corrupt-${stamp}`;
    try {
      fsImpl.copyFileSync(lockPath, target);
      logError(`Đã quarantine process lock hỏng sang ${target}.`);
      return target;
    } catch (copyError) {
      logError(
        `Không quarantine được process lock hỏng ${lockPath}: ${copyError.message}`
      );
      return null;
    }
  }

  function corruptLockError(cause, quarantinePath) {
    const error = new Error(
      `Process lock ${lockPath} bị hỏng (${cause.message}); ` +
        "agent dừng thay vì coi như không có lock để tránh chạy hai instance. " +
        "Kiểm tra file .corrupt-* rồi sửa hoặc di chuyển agent.lock."
    );
    error.code = "AGENT_LOCK_CORRUPT";
    error.cause = cause;
    error.lockPath = lockPath;
    error.quarantinePath = quarantinePath;
    return error;
  }

  // Đọc process lock theo kiểu fail-closed: file rỗng/JSON hỏng/sai cấu trúc
  // KHÔNG được coi là "không có lock" (fail-open), vì như vậy hai instance có
  // thể cùng chạy và mua trùng. Chỉ file thiếu (ENOENT) mới là trạng thái hợp lệ.
  function readLockFile() {
    let text;
    try {
      text = fsImpl.readFileSync(lockPath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return null;
      const quarantinePath = quarantineCorruptLock();
      const corrupt = corruptLockError(error, quarantinePath);
      logError(corrupt.message);
      throw corrupt;
    }
    if (!text.trim()) {
      const quarantinePath = quarantineCorruptLock();
      const corrupt = corruptLockError(new Error("file rỗng"), quarantinePath);
      logError(corrupt.message);
      throw corrupt;
    }
    let lock;
    try {
      lock = JSON.parse(text);
    } catch (error) {
      const quarantinePath = quarantineCorruptLock();
      const corrupt = corruptLockError(error, quarantinePath);
      logError(corrupt.message);
      throw corrupt;
    }
    if (!isLockRecord(lock)) {
      const quarantinePath = quarantineCorruptLock();
      const corrupt = corruptLockError(
        new Error("cấu trúc lock không hợp lệ"),
        quarantinePath
      );
      logError(corrupt.message);
      throw corrupt;
    }
    return lock;
  }

  function acquireProcessLock() {
    const existing = readLockFile();
    if (existing && existing.token !== token) {
      if (lockIsFresh(existing)) {
        const error = new Error(
          `Agent đã chạy ở process ${existing.pid} (lease tới ${new Date(
            Number(existing.leaseUntil)
          ).toISOString()}); từ chối instance thứ hai.`
        );
        error.code = "AGENT_LOCKED";
        error.lock = existing;
        throw error;
      }
      log(
        `Phát hiện process lock cũ (pid ${existing.pid}, hết lease) — ` +
          "coi là stale và tiếp quản."
      );
    }
    processLock = {
      version: LOCK_VERSION,
      pid,
      token,
      startedAt,
      heartbeatAt: new Date(now()).toISOString(),
      leaseUntil: now() + leaseMs
    };
    writeJsonAtomic(lockPath, processLock);
    log(`Đã giữ process lock (pid ${pid}, lease ${leaseMs}ms).`);
    return { ...processLock };
  }

  function heartbeatProcessLock() {
    let current;
    try {
      current = readLockFile();
    } catch (error) {
      if (error.code === "AGENT_LOCK_CORRUPT") {
        logError("Process lock hỏng; không gia hạn lease để tránh ghi đè.");
        return false;
      }
      throw error;
    }
    if (!current || current.token !== token) {
      logError("Mất process lock (token không khớp); không gia hạn lease.");
      return false;
    }
    processLock = {
      ...current,
      heartbeatAt: new Date(now()).toISOString(),
      leaseUntil: now() + leaseMs
    };
    writeJsonAtomic(lockPath, processLock);
    return true;
  }

  function releaseProcessLock() {
    let current;
    try {
      current = readLockFile();
    } catch (error) {
      if (error.code === "AGENT_LOCK_CORRUPT") {
        logError("Process lock hỏng; không xóa file để giữ bằng chứng kiểm tra.");
        return false;
      }
      throw error;
    }
    if (!current) {
      processLock = null;
      return false;
    }
    if (current.token !== token) {
      logError("Không nhả process lock vì token không khớp (lock của instance khác).");
      return false;
    }
    try {
      fsImpl.rmSync(lockPath, { force: true });
    } catch (error) {
      logError(`Không xóa được process lock ${lockPath}: ${error.message}`);
      return false;
    }
    processLock = null;
    log("Đã nhả process lock.");
    return true;
  }

  function isProcessLockHeld() {
    let current;
    try {
      current = readLockFile();
    } catch (error) {
      // Fail-closed: lock hỏng được coi là đang giữ, để không ai mở khóa mua mới.
      if (error.code === "AGENT_LOCK_CORRUPT") return true;
      throw error;
    }
    return Boolean(current && current.token === token && lockIsFresh(current));
  }

  function emptyState() {
    return {
      version: LOCK_VERSION,
      process: {
        pid,
        startedAt,
        heartbeatAt: new Date(now()).toISOString(),
        leaseUntil: now() + leaseMs
      },
      workers: []
    };
  }

  function quarantineCorruptState() {
    if (corruptStateQuarantined) return null;
    corruptStateQuarantined = true;
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, "-");
    const target = `${statePath}.corrupt-${stamp}`;
    try {
      fsImpl.copyFileSync(statePath, target);
      logError(`Đã quarantine worker state hỏng sang ${target}.`);
      return target;
    } catch (copyError) {
      logError(`Không quarantine được worker state hỏng ${statePath}: ${copyError.message}`);
      return null;
    }
  }

  function corruptStateError(cause, quarantinePath) {
    const error = new Error(
      `Worker state ${statePath} bị hỏng (${cause.message}); ` +
        "agent dừng thay vì coi như registry rỗng để tránh mua chồng. " +
        "Kiểm tra file .corrupt-* rồi sửa hoặc di chuyển workers.json."
    );
    error.code = "WORKER_STATE_CORRUPT";
    error.cause = cause;
    error.statePath = statePath;
    error.quarantinePath = quarantinePath;
    return error;
  }

  function isWorkerRecord(worker) {
    return Boolean(
      worker &&
        typeof worker === "object" &&
        typeof worker.workerId === "string" &&
        worker.workerId.trim() &&
        typeof worker.feature === "string" &&
        worker.feature.trim() &&
        WORKER_STATES.includes(worker.state)
    );
  }

  // Đọc state theo kiểu fail-closed: file hỏng/thiếu cấu trúc KHÔNG được coi là
  // registry rỗng, vì như vậy sẽ mở khóa mua mới trong khi worker cũ có thể vẫn
  // đang chạy. File thiếu (ENOENT) mới là trạng thái khởi đầu hợp lệ.
  function loadState() {
    let text;
    try {
      text = fsImpl.readFileSync(statePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return emptyState();
      const quarantinePath = quarantineCorruptState();
      const corrupt = corruptStateError(error, quarantinePath);
      logError(corrupt.message);
      throw corrupt;
    }
    if (!text.trim()) {
      const quarantinePath = quarantineCorruptState();
      const corrupt = corruptStateError(new Error("file rỗng"), quarantinePath);
      logError(corrupt.message);
      throw corrupt;
    }
    let state;
    try {
      state = JSON.parse(text);
    } catch (error) {
      const quarantinePath = quarantineCorruptState();
      const corrupt = corruptStateError(error, quarantinePath);
      logError(corrupt.message);
      throw corrupt;
    }
    if (
      !state ||
      typeof state !== "object" ||
      Array.isArray(state) ||
      !Array.isArray(state.workers) ||
      !state.workers.every(isWorkerRecord)
    ) {
      const quarantinePath = quarantineCorruptState();
      const corrupt = corruptStateError(
        new Error("cấu trúc workers không hợp lệ"),
        quarantinePath
      );
      logError(corrupt.message);
      throw corrupt;
    }
    return {
      version: LOCK_VERSION,
      process: {
        pid,
        startedAt,
        heartbeatAt: new Date(now()).toISOString(),
        leaseUntil: now() + leaseMs
      },
      workers: state.workers
    };
  }

  function workerTime(worker) {
    const stamp = worker.heartbeatAt || worker.updatedAt || worker.startedAt || 0;
    const value = Date.parse(stamp);
    return Number.isFinite(value) ? value : 0;
  }

  // Chỉ cắt bớt bản ghi STOPPED đã cũ. Worker `unknown` KHÔNG BAO GIỜ bị prune:
  // nó là fail-closed, phải đợi con người resolve qua scripts/resolve-worker.js.
  function pruneWorkerHistory(workers) {
    const history = workers.filter((worker) => worker.state === "stopped");
    if (history.length <= MAX_WORKER_HISTORY) return workers;
    const keep = new Set(
      [...history]
        .sort((a, b) => workerTime(b) - workerTime(a))
        .slice(0, MAX_WORKER_HISTORY)
        .map((worker) => worker.workerId)
    );
    return workers.filter(
      (worker) => worker.state !== "stopped" || keep.has(worker.workerId)
    );
  }

  function saveState(state) {
    writeJsonAtomic(statePath, {
      ...state,
      version: LOCK_VERSION,
      workers: pruneWorkerHistory(state.workers),
      process: {
        ...state.process,
        heartbeatAt: new Date(now()).toISOString(),
        leaseUntil: now() + leaseMs
      }
    });
  }

  function findWorker(state, workerId) {
    return state.workers.find((worker) => worker.workerId === workerId) || null;
  }

  function activeWorkers(state) {
    return state.workers.filter(
      (worker) =>
        worker.state === "starting" ||
        worker.state === "running" ||
        worker.state === "unknown"
    );
  }

  function groupOf(worker) {
    return WORKER_CONCURRENCY_GROUPS.includes(worker.concurrencyGroup)
      ? worker.concurrencyGroup
      : "exclusive";
  }

  // Hai worker có xung đột không:
  // - unknown luôn chặn (fail-closed, tránh double-spend).
  // - hai exclusive chặn nhau (buy/upgrade không chạy đồng thời).
  // - cùng feature luôn chặn (không có hai worker ICON cùng lúc).
  // - background + exclusive được phép (ICON chạy nền cùng buy/upgrade).
  function workersConflict(a, b) {
    if (a.state === "unknown" || b.state === "unknown") return true;
    if (a.feature === b.feature) return true;
    return groupOf(a) === "exclusive" && groupOf(b) === "exclusive";
  }

  function beginStart({
    feature,
    cycleId = null,
    workerId,
    concurrencyGroup = "exclusive"
  } = {}) {
    if (!feature) throw new TypeError("beginStart cần feature.");
    if (!WORKER_CONCURRENCY_GROUPS.includes(concurrencyGroup)) {
      throw new TypeError(
        `beginStart: concurrencyGroup phải là ${WORKER_CONCURRENCY_GROUPS.join("|")}.`
      );
    }
    const id = workerId || `${feature}-${now()}-${Math.random().toString(36).slice(2, 8)}`;
    const state = loadState();
    const candidate = { feature, concurrencyGroup };
    const blocking = activeWorkers(state).filter(
      (worker) => worker.workerId !== id && workersConflict(worker, candidate)
    );
    if (blocking.length) {
      const error = new Error(
        `Không thể bắt đầu ${feature}: worker ${blocking
          .map((worker) => `${worker.workerId}(${worker.state})`)
          .join(", ")} đang hoạt động.`
      );
      error.code = "WORKER_ACTIVE";
      error.workers = blocking;
      throw error;
    }
    state.workers.push({
      workerId: id,
      feature,
      cycleId,
      concurrencyGroup,
      state: "starting",
      startedAt: new Date(now()).toISOString(),
      heartbeatAt: new Date(now()).toISOString(),
      leaseUntil: now() + leaseMs,
      owned: true
    });
    saveState(state);
    log(`Worker ${id} (${feature}, ${concurrencyGroup}) → starting.`);
    return id;
  }

  function transition(workerId, fromStates, toState) {
    const state = loadState();
    const worker = findWorker(state, workerId);
    if (!worker) {
      const error = new Error(`Không tìm thấy worker ${workerId}.`);
      error.code = "WORKER_NOT_FOUND";
      throw error;
    }
    if (!fromStates.includes(worker.state)) {
      const error = new Error(
        `Worker ${workerId} đang ${worker.state}; không chuyển được sang ${toState}.`
      );
      error.code = "WORKER_STATE_INVALID";
      throw error;
    }
    worker.state = toState;
    worker.heartbeatAt = new Date(now()).toISOString();
    worker.leaseUntil = toState === "stopped" ? now() : now() + leaseMs;
    saveState(state);
    return { ...worker };
  }

  function markRunning(workerId) {
    return transition(workerId, ["starting"], "running");
  }

  function beginStop(workerId) {
    return transition(workerId, ["starting", "running"], "stopping");
  }

  function markStopped(workerId) {
    return transition(workerId, ["starting", "running", "stopping"], "stopped");
  }

  function markUnknown(workerId, reason = "unknown") {
    const state = loadState();
    const worker = findWorker(state, workerId);
    if (!worker) {
      const error = new Error(`Không tìm thấy worker ${workerId}.`);
      error.code = "WORKER_NOT_FOUND";
      throw error;
    }
    worker.state = "unknown";
    worker.reason = reason;
    worker.heartbeatAt = new Date(now()).toISOString();
    saveState(state);
    log(`Worker ${workerId} → unknown (${reason}).`);
    return { ...worker };
  }

  // Chỉ con người được gọi hàm này, sau khi đã kiểm tra bot/Telegram và xác
  // nhận không còn worker chạy. Không auto-resolve unknown để giữ fail-closed.
  function resolveUnknown(workerId, note = "human-verified-stopped") {
    const state = loadState();
    const worker = findWorker(state, workerId);
    if (!worker) {
      const error = new Error(`Không tìm thấy worker ${workerId}.`);
      error.code = "WORKER_NOT_FOUND";
      throw error;
    }
    if (worker.state !== "unknown") {
      const error = new Error(
        `Worker ${workerId} đang ${worker.state}; chỉ resolve được worker unknown.`
      );
      error.code = "WORKER_STATE_INVALID";
      throw error;
    }
    worker.state = "stopped";
    worker.reason = note;
    worker.heartbeatAt = new Date(now()).toISOString();
    worker.leaseUntil = now();
    saveState(state);
    log(`Worker ${workerId} unknown → stopped (${note}).`);
    return { ...worker };
  }

  // Quyết định khi startup/restart. Chat text chỉ là bằng chứng, registry là
  // nguồn state; unknown luôn chặn để tránh double-spend.
  // `ignoreFeatures` dùng cho worker nền đang chạy TRONG CÙNG process (ICON):
  // chúng không phải worker sót sau restart nên không được đánh unknown chỉ vì
  // chat không có bằng chứng auto-buy.
  function reconcile({ hasWorkerEvidence = false, feature = null, ignoreFeatures = [] } = {}) {
    const state = loadState();
    const ignored = new Set(ignoreFeatures || []);
    const relevant = state.workers.filter(
      (worker) =>
        (!feature || worker.feature === feature) && !ignored.has(worker.feature)
    );
    const active = relevant.filter(
      (worker) => worker.state === "running" || worker.state === "starting"
    );
    const unknown = relevant.filter((worker) => worker.state === "unknown");

    if (unknown.length) {
      return {
        action: "block",
        reason: "worker-unknown",
        workers: unknown
      };
    }
    if (active.length) {
      if (hasWorkerEvidence) {
        return { action: "adopt", reason: "registry+evidence", workers: active };
      }
      const marked = active.map((worker) =>
        markUnknown(worker.workerId, "registry-active-without-evidence")
      );
      return { action: "block", reason: "registry-active-without-evidence", workers: marked };
    }
    if (hasWorkerEvidence) {
      return {
        action: "block",
        reason: "evidence-without-registry",
        workers: []
      };
    }
    return { action: "clear", reason: "no-worker", workers: [] };
  }

  function getSnapshot() {
    const state = loadState();
    return {
      ...state,
      process: {
        ...state.process,
        lockHeld: isProcessLockHeld()
      }
    };
  }

  return {
    token,
    acquireProcessLock,
    heartbeatProcessLock,
    releaseProcessLock,
    isProcessLockHeld,
    beginStart,
    markRunning,
    beginStop,
    markStopped,
    markUnknown,
    resolveUnknown,
    reconcile,
    getSnapshot
  };
}

let shared = null;

// Singleton dùng chung giữa entry-point (agent.js) và controller để cả hai
// nhìn thấy cùng process lock + worker state.
function getWorkerRegistry(options) {
  if (!shared) {
    if (!options) {
      throw new TypeError(
        "getWorkerRegistry cần options ở lần gọi đầu tiên (statePath, lockPath)."
      );
    }
    shared = createWorkerRegistry(options);
  }
  return shared;
}

function resetSharedWorkerRegistryForTests() {
  shared = null;
}

module.exports = {
  DEFAULT_LEASE_MS,
  MAX_WORKER_HISTORY,
  WORKER_STATES,
  WORKER_CONCURRENCY_GROUPS,
  createWorkerRegistry,
  defaultIsProcessAlive,
  getWorkerRegistry,
  resetSharedWorkerRegistryForTests
};
