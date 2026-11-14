const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createWorkerRegistry } = require("./worker-registry");
const { createWorkerSession } = require("./worker-session");

function tempState(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fo4-session-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return {
    dir,
    statePath: path.join(dir, "state", "workers.json"),
    lockPath: path.join(dir, "state", "agent.lock")
  };
}

function makeSession(t, overrides = {}) {
  const paths = tempState(t);
  const logs = [];
  const errors = [];
  const registry = createWorkerRegistry({
    ...paths,
    pid: 5150,
    log: () => {},
    logError: () => {},
    ...overrides
  });
  const session = createWorkerSession({
    registry,
    log: (line) => logs.push(line),
    logError: (line) => errors.push(line)
  });
  return { registry, session, logs, errors, paths };
}

test("session registers a worker, marks it running and stops it", (t) => {
  const { registry, session, paths } = makeSession(t);
  const started = session.tryBegin("buy", { cycleId: "c1" });
  assert.equal(started.state, "starting");
  assert.equal(started.reused, false);
  assert.equal(session.isRegistered("buy"), true);

  const running = session.markRunning("buy");
  assert.equal(running.state, "running");
  assert.deepEqual(session.activeWorkerIds(), [started.workerId]);

  const stopped = session.stop("buy", { reason: "completed" });
  assert.equal(stopped.state, "stopped");
  assert.equal(session.isRegistered("buy"), false);
  const persisted = JSON.parse(fs.readFileSync(paths.statePath, "utf8"));
  assert.equal(persisted.workers[0].state, "stopped");
  assert.equal(registry.getSnapshot().workers[0].state, "stopped");
});

test("tryBegin is idempotent within a session (retry keeps one worker)", (t) => {
  const { registry, session } = makeSession(t);
  const first = session.tryBegin("buy");
  const second = session.tryBegin("buy");
  assert.equal(second.workerId, first.workerId);
  assert.equal(second.reused, true);
  assert.equal(registry.getSnapshot().workers.length, 1);
});

test("background ICON coexists with exclusive buy; duplicate ICON is blocked", (t) => {
  const { registry, session } = makeSession(t);
  assert.ok(session.tryBegin("buy"));
  session.markRunning("buy");
  const icon = session.tryBegin("icon", { concurrencyGroup: "background" });
  assert.ok(icon);
  session.markRunning("icon");

  // Một session khác (hoặc feature trùng) không được tạo ICON thứ hai.
  const other = createWorkerSession({ registry });
  assert.equal(
    other.tryBegin("icon", { concurrencyGroup: "background" }),
    null
  );
  assert.equal(other.blockedReason().reason, "WORKER_ACTIVE");
  assert.equal(registry.getSnapshot().workers.length, 2);
});

test("two exclusive workers cannot start together; blocked tryBegin returns null", (t) => {
  const { registry, session } = makeSession(t);
  assert.ok(session.tryBegin("buy"));
  session.markRunning("buy");

  const other = createWorkerSession({ registry });
  assert.equal(other.tryBegin("upgrade"), null);
  assert.match(other.blockedReason().message, /buy/);
  assert.equal(registry.getSnapshot().workers.length, 1);
});

test("unknown worker blocks every new begin until resolveUnknown", (t) => {
  const { registry, session } = makeSession(t);
  const started = session.tryBegin("buy");
  session.markRunning("buy");
  session.stop("buy", { unknown: true, reason: "browser-closed" });

  assert.equal(session.tryBegin("buy"), null);
  const iconBlocked = createWorkerSession({ registry });
  assert.equal(iconBlocked.tryBegin("icon", { concurrencyGroup: "background" }), null);

  const unknown = registry.getSnapshot().workers[0];
  assert.equal(unknown.state, "unknown");
  registry.resolveUnknown(unknown.workerId, "human checked");
  assert.ok(session.tryBegin("buy"));
  assert.equal(
    registry.getSnapshot().workers.at(-1).state,
    "starting"
  );
});

test("reconcileOnStartup closes stale ICON workers from the previous process", (t) => {
  const { registry, session } = makeSession(t);
  const icon = registry.beginStart({ feature: "icon", concurrencyGroup: "background" });
  registry.markRunning(icon);

  const outcome = session.reconcileOnStartup({ hasWorkerEvidence: false });
  assert.equal(outcome.action, "clear");
  assert.equal(outcome.staleStopped.length, 1);
  assert.equal(session.isRegistered("icon"), false);
  assert.equal(registry.getSnapshot().workers[0].state, "stopped");
});

test("reconcileOnStartup adopts a buy worker only with chat evidence", (t) => {
  const { registry, session } = makeSession(t);
  const buy = registry.beginStart({ feature: "buy" });
  registry.markRunning(buy);

  const outcome = session.reconcileOnStartup({ hasWorkerEvidence: true });
  assert.equal(outcome.action, "adopt");
  assert.equal(session.isRegistered("buy"), true);
  assert.equal(session.listActive()[0].workerId, buy);
  // Khi adopt, stop phải đóng đúng worker đã adopt.
  assert.equal(session.stop("buy", { reason: "completed" }).state, "stopped");
});

test("reconcileOnStartup marks a running worker unknown without evidence (fail-closed)", (t) => {
  const { registry, session, errors } = makeSession(t);
  const upgrade = registry.beginStart({ feature: "upgrade" });
  registry.markRunning(upgrade);

  const outcome = session.reconcileOnStartup({ hasWorkerEvidence: false });
  assert.equal(outcome.action, "block");
  assert.equal(outcome.reason, "registry-active-without-evidence");
  assert.equal(registry.getSnapshot().workers[0].state, "unknown");
  assert.equal(session.tryBegin("upgrade"), null);
  assert.ok(errors.some((line) => /chặn khởi động/.test(line)));
});

test("reconcileOnStartup with staleFeatures [] leaves in-process ICON alone", (t) => {
  const { registry, session } = makeSession(t);
  const icon = registry.beginStart({ feature: "icon", concurrencyGroup: "background" });
  registry.markRunning(icon);

  const outcome = session.reconcileOnStartup({
    hasWorkerEvidence: false,
    staleFeatures: []
  });
  assert.equal(outcome.staleStopped.length, 0);
  // ICON không bị dọn như worker stale, nhưng vì không có evidence nên
  // registry vẫn mark unknown (fail-closed) thay vì adopt mù.
  assert.equal(registry.getSnapshot().workers[0].state, "unknown");
  // ICON đang chạy là active, không có evidence → registry đánh unknown.
  assert.equal(session.tryBegin("icon", { concurrencyGroup: "background" }), null);
});

test("stop is safe when no worker is registered", (t) => {
  const { session } = makeSession(t);
  assert.equal(session.stop("buy"), null);
  assert.equal(session.markRunning("buy"), null);
  assert.equal(session.markUnknown("buy"), null);
});
