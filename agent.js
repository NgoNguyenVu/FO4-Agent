const path = require("node:path");
const { runAgent } = require("./features/controller");
const { config } = require("./features/config");
const { dataDir, log, logError } = require("./features/agent-log");
const { getLifecycle } = require("./lib/lifecycle");
const { getWorkerRegistry } = require("./lib/worker-registry");

// `runAgent()` chạy vòng điều khiển nội bộ (main) và tự xử lý mọi lỗi có thể
// phục hồi (E006, mất session, timeout...) ngay trong vòng lặp của nó. Vì vậy nó
// chỉ reject với lỗi phát sinh lúc khởi động (cấu hình sai, không mở được
// trình duyệt...). Ở đây retry có giới hạn đúng những lỗi đó rồi mới bỏ cuộc,
// tránh vòng lặp vô hạn khi lỗi là cố định (vd config sai).
const MAX_STARTUP_RETRIES = 3;

const lifecycle = getLifecycle({
  log: (message) => log(message),
  logError: (message) => logError(message),
  // Heartbeat/state nằm ngoài repo để `git status` vẫn sạch.
  heartbeatPath: path.join(dataDir, "state", "heartbeat.json")
});
lifecycle.installSignalHandlers();
lifecycle.startHeartbeat({
  pid: process.pid,
  startedAt: new Date().toISOString(),
  version: require("./package.json").version,
  mode: null,
  activeWorkerId: null
});

const registry = getWorkerRegistry({
  statePath: path.join(dataDir, "state", "workers.json"),
  lockPath: path.join(dataDir, "state", "agent.lock"),
  leaseMs: (config.worker?.leaseSeconds || 60) * 1_000,
  log: (message) => log(message),
  logError: (message) => logError(message)
});
let lockHeartbeatTimer = null;

function startProcessLockHeartbeat() {
  if (lockHeartbeatTimer) return;
  const intervalMs = (config.worker?.heartbeatSeconds || 20) * 1_000;
  lockHeartbeatTimer = setInterval(() => {
    registry.heartbeatProcessLock();
  }, intervalMs);
  if (typeof lockHeartbeatTimer.unref === "function") lockHeartbeatTimer.unref();
}

function stopProcessLockHeartbeat() {
  if (!lockHeartbeatTimer) return;
  clearInterval(lockHeartbeatTimer);
  lockHeartbeatTimer = null;
}

async function main() {
  try {
    registry.acquireProcessLock();
  } catch (error) {
    logError(`Không khởi động được agent: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  startProcessLockHeartbeat();
  lifecycle.register({
    name: "process-lock",
    onShutdown: () => {
      stopProcessLockHeartbeat();
      registry.releaseProcessLock();
    }
  });

  for (let attempt = 0; attempt <= MAX_STARTUP_RETRIES; attempt += 1) {
    try {
      await runAgent();
      return;
    } catch {
      // Lỗi đã được runAgent ghi log; ở đây chỉ quyết định thử lại.
      // Nếu đang shutdown (signal/exception) thì không restart.
      if (lifecycle.isStopping()) return;
      if (attempt === MAX_STARTUP_RETRIES) break;
      console.log(`Restarting agent (lần ${attempt + 1}/${MAX_STARTUP_RETRIES}) sau 10 giây...`);
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }
  process.exitCode = 1;
}

main();
