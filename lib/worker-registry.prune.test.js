const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createWorkerRegistry,
  MAX_WORKER_HISTORY
} = require("./worker-registry");

test("workers.json prunes old stopped/unknown history but keeps active workers", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fo4-prune-"));
  const statePath = path.join(dir, "workers.json");
  const lockPath = path.join(dir, "agent.lock");
  const registry = createWorkerRegistry({
    statePath,
    lockPath,
    isProcessAlive: () => false
  });

  for (let i = 0; i < MAX_WORKER_HISTORY + 10; i += 1) {
    const id = `buy-${i}`;
    registry.beginStart({ feature: "buy", workerId: id });
    registry.markStopped(id);
  }
  // Một worker đang chạy phải được giữ dù lịch sử đã vượt ngưỡng.
  registry.beginStart({ feature: "icon", workerId: "icon-live", concurrencyGroup: "background" });
  // Worker unknown KHÔNG BAO GIỜ bị prune (fail-closed).
  registry.beginStart({ feature: "buy", workerId: "buy-unknown", concurrencyGroup: "exclusive" });
  registry.markUnknown("buy-unknown", "operator-check");

  const workers = JSON.parse(fs.readFileSync(statePath, "utf8")).workers;
  const history = workers.filter((worker) => worker.state === "stopped");
  assert.equal(history.length, MAX_WORKER_HISTORY, "chỉ stopped bị cắt về ngưỡng");
  assert.ok(workers.some((worker) => worker.workerId === "icon-live"));
  assert.ok(
    workers.some((worker) => worker.workerId === "buy-unknown" && worker.state === "unknown"),
    "unknown phải sống sót qua prune"
  );
  assert.ok(workers.some((worker) => worker.workerId === `buy-${MAX_WORKER_HISTORY + 9}`));
});
