const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createWorkerRegistry,
  getWorkerRegistry,
  resetSharedWorkerRegistryForTests,
  DEFAULT_LEASE_MS,
  WORKER_CONCURRENCY_GROUPS
} = require("./worker-registry");

function tempState(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fo4-registry-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return {
    dir,
    statePath: path.join(dir, "state", "workers.json"),
    lockPath: path.join(dir, "state", "agent.lock")
  };
}

function createRegistry(paths, overrides = {}) {
  const logs = [];
  const errors = [];
  const registry = createWorkerRegistry({
    ...paths,
    pid: 4242,
    log: (line) => logs.push(line),
    logError: (line) => errors.push(line),
    ...overrides
  });
  return { registry, logs, errors };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

test("process lock is exclusive for a live process and writes lease", (t) => {
  const paths = tempState(t);
  let clock = 1_000_000;
  const first = createRegistry(paths, { now: () => clock, leaseMs: 60_000 });
  const lock = first.registry.acquireProcessLock();

  assert.equal(lock.pid, 4242);
  assert.equal(lock.leaseUntil, clock + 60_000);
  assert.equal(fs.existsSync(paths.lockPath), true);
  assert.equal(fs.existsSync(`${paths.lockPath}.tmp`), false);
  assert.equal(first.registry.isProcessLockHeld(), true);

  const second = createRegistry(paths, {
    now: () => clock,
    pid: 7777,
    isProcessAlive: () => true
  });
  assert.throws(
    () => second.registry.acquireProcessLock(),
    (error) => error.code === "AGENT_LOCKED" && /7777|4242/.test(error.message)
  );

  // Instance thứ hai không được xóa lock của instance đầu.
  assert.equal(second.registry.releaseProcessLock(), false);
  assert.equal(fs.existsSync(paths.lockPath), true);
  assert.equal(first.registry.releaseProcessLock(), true);
  assert.equal(fs.existsSync(paths.lockPath), false);
});

test("expired lease or dead pid is treated as stale and taken over", (t) => {
  const paths = tempState(t);
  let clock = 1_000_000;
  const first = createRegistry(paths, { now: () => clock, leaseMs: 60_000 });
  first.registry.acquireProcessLock();

  // Lease hết hạn nhưng process cũ vẫn "sống" → được tiếp quản.
  clock += 60_001;
  const second = createRegistry(paths, {
    now: () => clock,
    pid: 8888,
    isProcessAlive: () => true
  });
  const lock = second.registry.acquireProcessLock();
  assert.equal(lock.pid, 8888);
  assert.ok(second.logs.some((line) => /stale/.test(line)));
});

test("dead pid is taken over even when lease time remains", (t) => {
  const paths = tempState(t);
  let clock = 1_000_000;
  const first = createRegistry(paths, {
    now: () => clock,
    isProcessAlive: () => true
  });
  first.registry.acquireProcessLock();

  const second = createRegistry(paths, {
    now: () => clock,
    pid: 9999,
    isProcessAlive: () => false
  });
  assert.equal(second.registry.acquireProcessLock().pid, 9999);
});

test("heartbeat extends the lease and rejects a lost lock", (t) => {
  const paths = tempState(t);
  let clock = 1_000_000;
  const { registry, errors } = createRegistry(paths, {
    now: () => clock,
    leaseMs: 60_000
  });
  registry.acquireProcessLock();
  clock += 30_000;
  assert.equal(registry.heartbeatProcessLock(), true);
  assert.equal(readJson(paths.lockPath).leaseUntil, clock + 60_000);

  // Instance khác chiếm lock: heartbeat của ta phải thất bại, không ghi đè.
  clock += 60_001;
  const takeover = createRegistry(paths, {
    now: () => clock,
    pid: 5151,
    isProcessAlive: () => true
  });
  takeover.registry.acquireProcessLock();
  assert.equal(registry.heartbeatProcessLock(), false);
  assert.equal(readJson(paths.lockPath).pid, 5151);
  assert.ok(errors.some((line) => /Mất process lock/.test(line)));
});

test("worker state machine persists transitions", (t) => {
  const paths = tempState(t);
  const { registry } = createRegistry(paths);
  registry.acquireProcessLock();

  const workerId = registry.beginStart({ feature: "buy", cycleId: "c1" });
  let snapshot = registry.getSnapshot();
  assert.equal(snapshot.workers.length, 1);
  assert.equal(snapshot.workers[0].state, "starting");
  assert.equal(snapshot.workers[0].owned, true);

  registry.markRunning(workerId);
  assert.equal(registry.getSnapshot().workers[0].state, "running");

  registry.beginStop(workerId);
  assert.equal(registry.getSnapshot().workers[0].state, "stopping");

  registry.markStopped(workerId);
  snapshot = registry.getSnapshot();
  assert.equal(snapshot.workers[0].state, "stopped");
  assert.equal(fs.existsSync(`${paths.statePath}.tmp`), false);

  // Instance mới đọc lại state từ đĩa.
  const reloaded = createRegistry(paths, { pid: 4343 });
  assert.equal(reloaded.registry.getSnapshot().workers[0].state, "stopped");
});

test("invalid worker transitions throw and do not write", (t) => {
  const paths = tempState(t);
  const { registry } = createRegistry(paths);
  registry.acquireProcessLock();
  const workerId = registry.beginStart({ feature: "upgrade" });
  registry.markStopped(workerId);

  assert.throws(
    () => registry.markRunning(workerId),
    (error) => error.code === "WORKER_STATE_INVALID"
  );
  assert.throws(
    () => registry.markRunning("missing-worker"),
    (error) => error.code === "WORKER_NOT_FOUND"
  );
  assert.equal(registry.getSnapshot().workers[0].state, "stopped");
});

test("beginStart is rejected while another worker is running or unknown", (t) => {
  const paths = tempState(t);
  const { registry } = createRegistry(paths);
  registry.acquireProcessLock();
  const running = registry.beginStart({ feature: "buy" });
  registry.markRunning(running);

  assert.throws(
    () => registry.beginStart({ feature: "icon" }),
    (error) => error.code === "WORKER_ACTIVE"
  );

  registry.markUnknown(running, "test");
  assert.throws(
    () => registry.beginStart({ feature: "icon" }),
    (error) => error.code === "WORKER_ACTIVE"
  );
});

test("reconcile blocks unknown, adopts running+evidence, clears clean state", (t) => {
  const paths = tempState(t);
  const { registry } = createRegistry(paths);
  registry.acquireProcessLock();

  assert.equal(registry.reconcile().action, "clear");

  const workerId = registry.beginStart({ feature: "buy" });
  registry.markRunning(workerId);
  assert.equal(registry.reconcile({ hasWorkerEvidence: true }).action, "adopt");

  // Registry đang chạy nhưng chat không còn dấu hiệu worker → unknown + block.
  const blocked = registry.reconcile({ hasWorkerEvidence: false });
  assert.equal(blocked.action, "block");
  assert.equal(blocked.reason, "registry-active-without-evidence");
  assert.equal(registry.getSnapshot().workers[0].state, "unknown");

  // unknown luôn chặn, kể cả khi có bằng chứng.
  assert.equal(registry.reconcile({ hasWorkerEvidence: true }).action, "block");
  assert.equal(registry.reconcile().reason, "worker-unknown");
});

test("reconcile blocks chat evidence when registry is idle", (t) => {
  const paths = tempState(t);
  const { registry } = createRegistry(paths);
  registry.acquireProcessLock();
  const result = registry.reconcile({ hasWorkerEvidence: true, feature: "buy" });
  assert.equal(result.action, "block");
  assert.equal(result.reason, "evidence-without-registry");
});

test("registry defaults to a 60s lease", () => {
  assert.equal(DEFAULT_LEASE_MS, 60_000);
});

test("background worker coexists with exclusive worker; duplicate feature is blocked", (t) => {
  const paths = tempState(t);
  const { registry } = createRegistry(paths);
  registry.acquireProcessLock();
  const buy = registry.beginStart({ feature: "buy" });
  registry.markRunning(buy);

  const icon = registry.beginStart({
    feature: "icon",
    concurrencyGroup: "background"
  });
  registry.markRunning(icon);
  assert.equal(registry.getSnapshot().workers.length, 2);

  assert.throws(
    () =>
      registry.beginStart({ feature: "icon", concurrencyGroup: "background" }),
    (error) => error.code === "WORKER_ACTIVE"
  );
});

test("two exclusive workers cannot start together", (t) => {
  const paths = tempState(t);
  const { registry } = createRegistry(paths);
  registry.acquireProcessLock();
  registry.markRunning(registry.beginStart({ feature: "buy" }));

  assert.throws(
    () => registry.beginStart({ feature: "upgrade" }),
    (error) => error.code === "WORKER_ACTIVE" && /buy/.test(error.message)
  );
});

test("unknown blocks even a background worker", (t) => {
  const paths = tempState(t);
  const { registry } = createRegistry(paths);
  registry.acquireProcessLock();
  const buy = registry.beginStart({ feature: "buy" });
  registry.markRunning(buy);
  registry.markUnknown(buy, "browser-closed");

  assert.throws(
    () =>
      registry.beginStart({ feature: "icon", concurrencyGroup: "background" }),
    (error) => error.code === "WORKER_ACTIVE"
  );
});

test("beginStart rejects an unknown concurrency group", (t) => {
  const paths = tempState(t);
  const { registry } = createRegistry(paths);
  assert.throws(
    () => registry.beginStart({ feature: "buy", concurrencyGroup: "parallel" }),
    /concurrencyGroup/
  );
  assert.ok(WORKER_CONCURRENCY_GROUPS.includes("exclusive"));
  assert.ok(WORKER_CONCURRENCY_GROUPS.includes("background"));
});

test("resolveUnknown moves unknown to stopped and unblocks new workers", (t) => {
  const paths = tempState(t);
  const { registry } = createRegistry(paths);
  registry.acquireProcessLock();
  const workerId = registry.beginStart({ feature: "buy" });
  registry.markRunning(workerId);
  registry.markUnknown(workerId, "unverified");

  const resolved = registry.resolveUnknown(workerId, "operator confirmed no bot worker");
  assert.equal(resolved.state, "stopped");
  assert.equal(resolved.reason, "operator confirmed no bot worker");

  const next = registry.beginStart({ feature: "buy" });
  assert.ok(next);
});

test("resolveUnknown only applies to unknown workers", (t) => {
  const paths = tempState(t);
  const { registry } = createRegistry(paths);
  registry.acquireProcessLock();
  const workerId = registry.beginStart({ feature: "buy" });
  assert.throws(
    () => registry.resolveUnknown(workerId),
    (error) => error.code === "WORKER_STATE_INVALID"
  );
  assert.throws(
    () => registry.resolveUnknown("missing"),
    (error) => error.code === "WORKER_NOT_FOUND"
  );
});

test("shared registry singleton returns the same instance", (t) => {
  const paths = tempState(t);
  resetSharedWorkerRegistryForTests();
  assert.throws(() => getWorkerRegistry(), /options/);

  const registry = getWorkerRegistry({ ...paths, pid: 6060 });
  assert.equal(getWorkerRegistry(), registry);
  assert.equal(getWorkerRegistry({ ...paths, pid: 9999 }), registry);
  resetSharedWorkerRegistryForTests();
});
