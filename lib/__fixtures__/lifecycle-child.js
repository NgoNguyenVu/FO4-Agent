// Fixture process con cho integration test shutdown (TASK-004B).
//
// Không phải file test: `node --test` chỉ chạy các file khớp pattern test, nên
// file này không bị chạy trực tiếp. Nó chỉ được spawn bởi
// lib/lifecycle.integration.test.js.
//
// Windows không cho process khác gửi SIGINT thật; parent gửi IPC
// { signal: "SIGINT" } và process con tự `process.emit(signal)` — vẫn là
// process thật, signal handler thật, exit code thật.
"use strict";

const { getLifecycle } = require("../lifecycle");

const heartbeatPath = process.env.FO4_HEARTBEAT_PATH || null;
const timeoutMs = Number(process.env.FO4_SHUTDOWN_TIMEOUT_MS || 400);
const overallTimeoutMs = Number(
  process.env.FO4_OVERALL_SHUTDOWN_TIMEOUT_MS || 5_000
);
const hangCleanup = process.env.FO4_HANG_CLEANUP === "1";

const lifecycle = getLifecycle({
  heartbeatPath,
  heartbeatIntervalMs: 0,
  timeoutMs,
  overallTimeoutMs,
  log: (line) => console.log(`[lifecycle] ${line}`),
  logError: (line) => console.error(`[lifecycle:error] ${line}`)
});
lifecycle.installSignalHandlers();
lifecycle.startHeartbeat({ pid: process.pid, fixture: "task-004b" });

// Đăng ký cleanup trước, handler treo sau: cleanup chạy ngược thứ tự nên
// handler treo chạy trước, cho phép test "Ctrl+C lần hai thoát ngay".
lifecycle.register({
  name: "cleanup",
  onShutdown: () => {
    console.log("CLEANUP_OK");
  }
});
if (hangCleanup) {
  lifecycle.register({
    name: "hang",
    onShutdown: () => new Promise(() => {})
  });
}

process.on("message", (message) => {
  if (!message) return;
  if (message.uncaught === true) {
    process.emit("uncaughtException", new Error("fixture boom"));
    return;
  }
  if (typeof message.signal !== "string") return;
  // Chỉ chấp nhận signal hợp lệ để fixture không tự bắn event lạ.
  if (!["SIGINT", "SIGTERM", "SIGBREAK"].includes(message.signal)) return;
  process.emit(message.signal);
});

process.send?.({ ready: true, pid: process.pid });

// Giữ process sống tới khi nhận signal.
setInterval(() => {}, 1_000);
