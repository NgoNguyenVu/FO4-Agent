// Vòng đời process: starting → running → stopping → stopped.
//
// Mục đích (TASK-004, Stage A):
// - Bắt SIGINT/SIGTERM/SIGBREAK và lỗi không phục hồi để dọn dẹp trước khi thoát:
//   dừng luồng ICON, gửi lệnh dừng worker do agent sở hữu, đóng mini-app,
//   đóng Playwright context, đóng readline.
// - Idempotent: dù nhận nhiều signal/exception, cleanup chỉ chạy một lần.
// - Timeout cứng: cleanup treo không được giữ process sống mãi.
// - Heartbeat file cho runbook/ops (mặc định ngoài repo: <dataDir>/state/).
//
// Module này không import features/ để giữ ranh giới lib/ ↔ features/.
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 20_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_SIGNALS = ["SIGINT", "SIGTERM", "SIGBREAK"];

function exitCodeForSignal(signal) {
  if (signal === "SIGINT") return 130;
  if (signal === "SIGTERM") return 143;
  if (signal === "SIGBREAK") return 130;
  return 1;
}

function createLifecycle(options = {}) {
  const {
    timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
    overallTimeoutMs = timeoutMs + 5_000,
    exit = (code) => process.exit(code),
    log = () => {},
    logError = () => {},
    now = () => Date.now(),
    heartbeatPath = null,
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    processRef = process
  } = options;

  let state = "idle"; // idle | running | stopping | stopped
  const handlers = [];
  let shutdownPromise = null;
  let heartbeatTimer = null;
  let heartbeatOverride = null;
  let heartbeatPayload = null;
  let signalsInstalled = false;
  let signalCount = 0;
  let exitRequested = false;

  // exit() chỉ được gọi một lần: tránh trường hợp signal thứ hai hoặc timeout
  // cứng gọi exit trước, rồi shutdown lại gọi exit lần nữa.
  function requestExit(code) {
    if (exitRequested) return false;
    exitRequested = true;
    exit(code);
    return true;
  }

  function getState() {
    return state;
  }

  function isStopping() {
    return state === "stopping" || state === "stopped";
  }

  function setRunning() {
    if (state === "idle") state = "running";
    return state;
  }

  function register({ name, onShutdown } = {}) {
    if (typeof onShutdown !== "function") {
      throw new TypeError("lifecycle.register cần onShutdown là function.");
    }
    const handler = {
      name: name || `handler-${handlers.length + 1}`,
      onShutdown,
      done: false
    };
    handlers.push(handler);
    return () => {
      const index = handlers.indexOf(handler);
      if (index !== -1) handlers.splice(index, 1);
      return index !== -1;
    };
  }

  function runWithTimeout(task, ms, label) {
    if (!ms || ms <= 0) return Promise.resolve(task);
    return new Promise((resolve, reject) => {
      const timer = setTimeoutFn(() => {
        const error = new Error(`${label} quá ${ms}ms`);
        error.code = "LIFECYCLE_TIMEOUT";
        reject(error);
      }, ms);
      Promise.resolve(task).then(
        (value) => {
          clearTimeoutFn(timer);
          resolve(value);
        },
        (error) => {
          clearTimeoutFn(timer);
          reject(error);
        }
      );
    });
  }

  function writeHeartbeat(payload = {}) {
    if (!heartbeatPath) return false;
    const body = {
      ...payload,
      ...(heartbeatOverride || {}),
      lastHeartbeatAt: new Date(now()).toISOString(),
      state
    };
    try {
      fs.mkdirSync(path.dirname(heartbeatPath), { recursive: true });
      const tmp = `${heartbeatPath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(body, null, 2), "utf8");
      fs.renameSync(tmp, heartbeatPath);
      return true;
    } catch (error) {
      logError(`Không ghi được heartbeat ${heartbeatPath}: ${error.message}`);
      return false;
    }
  }

  function startHeartbeat(payload = {}) {
    setRunning();
    heartbeatPayload = { ...payload };
    writeHeartbeat(heartbeatPayload);
    if (heartbeatTimer || !heartbeatPath || heartbeatIntervalMs <= 0) return;
    heartbeatTimer = setIntervalFn(() => {
      if (state === "stopping" || state === "stopped") return;
      writeHeartbeat(heartbeatPayload);
    }, heartbeatIntervalMs);
    if (typeof heartbeatTimer?.unref === "function") heartbeatTimer.unref();
  }

  function stopHeartbeat() {
    if (!heartbeatTimer) return;
    clearIntervalFn(heartbeatTimer);
    heartbeatTimer = null;
  }

  // Cập nhật dữ liệu heartbeat giữa các nhịp (mode, activeWorkerId...).
  function updateHeartbeat(partial = {}) {
    heartbeatOverride = { ...(heartbeatOverride || {}), ...partial };
    if (heartbeatPayload) heartbeatPayload = { ...heartbeatPayload, ...partial };
  }

  async function shutdown(reason = "shutdown", exitCode = 0) {
    if (shutdownPromise) return shutdownPromise;
    state = "stopping";
    stopHeartbeat();
    log(`Bắt đầu shutdown (${reason}); đang dọn dẹp tài nguyên.`);

    let overallTimer = null;
    if (overallTimeoutMs > 0) {
      overallTimer = setTimeoutFn(() => {
        logError(
          `Shutdown vượt quá ${overallTimeoutMs}ms; buộc thoát với code ${exitCode}.`
        );
        state = "stopped";
        requestExit(exitCode);
      }, overallTimeoutMs);
      if (typeof overallTimer?.unref === "function") overallTimer.unref();
    }

    shutdownPromise = (async () => {
      const results = [];
      // Chạy ngược thứ tự đăng ký: tài nguyên đăng ký sau được dọn trước.
      for (const handler of [...handlers].reverse()) {
        if (handler.done) {
          results.push({ name: handler.name, status: "skipped" });
          continue;
        }
        handler.done = true;
        try {
          await runWithTimeout(
            Promise.resolve().then(() => handler.onShutdown(reason)),
            timeoutMs,
            `cleanup ${handler.name}`
          );
          results.push({ name: handler.name, status: "ok" });
        } catch (error) {
          logError(
            `Cleanup ${handler.name} lỗi: ${error?.stack || error?.message || error}`
          );
          results.push({
            name: handler.name,
            status: "error",
            error: error?.message || String(error)
          });
        }
      }
      if (overallTimer) clearTimeoutFn(overallTimer);
      state = "stopped";
      log(`Đã shutdown (${reason}); thoát với code ${exitCode}.`);
      requestExit(exitCode);
      return { reason, exitCode, results };
    })();

    return shutdownPromise;
  }

  function installSignalHandlers({ signals = DEFAULT_SIGNALS } = {}) {
    if (signalsInstalled) return false;
    signalsInstalled = true;

    for (const signal of signals) {
      // Windows không hỗ trợ mọi signal; bỏ qua signal không đăng ký được.
      try {
        processRef.on(signal, () => {
          signalCount += 1;
          if (signalCount > 1) {
            logError(`Nhận ${signal} lần thứ ${signalCount}; thoát ngay, bỏ qua cleanup.`);
            requestExit(exitCodeForSignal(signal));
            return;
          }
          void shutdown(`signal:${signal}`, exitCodeForSignal(signal));
        });
      } catch (error) {
        logError(`Không đăng ký được handler ${signal}: ${error.message}`);
      }
    }

    processRef.on("uncaughtException", (error) => {
      logError(`uncaughtException: ${error?.stack || error}`);
      void shutdown("uncaughtException", 1);
    });
    processRef.on("unhandledRejection", (reason) => {
      logError(`unhandledRejection: ${reason?.stack || reason}`);
      void shutdown("unhandledRejection", 1);
    });
    return true;
  }

  return {
    getState,
    isStopping,
    setRunning,
    register,
    shutdown,
    installSignalHandlers,
    startHeartbeat,
    stopHeartbeat,
    updateHeartbeat
  };
}

let shared = null;

// Singleton dùng chung giữa entry-point (agent.js) và controller để signal
// handler và cleanup handler nhìn thấy cùng một state.
function getLifecycle(options = {}) {
  if (!shared) shared = createLifecycle(options);
  return shared;
}

function resetSharedLifecycleForTests() {
  shared = null;
}

module.exports = {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  exitCodeForSignal,
  createLifecycle,
  getLifecycle,
  resetSharedLifecycleForTests
};
