// Fixture process con cho integration test process lock (TASK-043).
//
// Không phải file test: `node --test` chỉ chạy file khớp pattern test. File này
// được spawn bởi lib/worker-registry.integration.test.js.
//
// Giao thức IPC:
//   child -> parent: { event: "acquired" } | { event: "blocked", code }
//                    { event: "heartbeat", leaseUntil } | { event: "released" }
//   parent -> child: "heartbeat" | "release" | "exit"
"use strict";

const { createWorkerRegistry } = require("../worker-registry");

const lockPath = process.env.FO4_LOCK_PATH;
const statePath = process.env.FO4_STATE_PATH;

if (!lockPath || !statePath) {
  console.error("Thiếu FO4_LOCK_PATH/FO4_STATE_PATH.");
  process.exit(2);
}

const registry = createWorkerRegistry({
  statePath,
  lockPath,
  log: () => {},
  logError: () => {}
});

try {
  const lock = registry.acquireProcessLock();
  process.send?.({ event: "acquired", pid: process.pid, leaseUntil: lock.leaseUntil });
} catch (error) {
  process.send?.({ event: "blocked", code: error.code || "UNKNOWN" });
  process.exit(0);
}

process.on("message", (message) => {
  if (message === "heartbeat") {
    const ok = registry.heartbeatProcessLock();
    const lock = JSON.parse(require("node:fs").readFileSync(lockPath, "utf8"));
    process.send?.({ event: "heartbeat", ok, leaseUntil: lock.leaseUntil });
    return;
  }
  if (message === "release") {
    const released = registry.releaseProcessLock();
    process.send?.({ event: "released", released });
    process.exit(0);
    return;
  }
  if (message === "exit") process.exit(0);
});

// Giữ process sống tới khi parent yêu cầu release/exit.
setInterval(() => {}, 1_000);
