const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const {
  createLifecycle,
  exitCodeForSignal,
  DEFAULT_SHUTDOWN_TIMEOUT_MS
} = require("./lifecycle");

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fo4-lifecycle-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function createHarness(overrides = {}) {
  const exits = [];
  const errors = [];
  const lifecycle = createLifecycle({
    exit: (code) => exits.push(code),
    log: () => {},
    logError: (message) => errors.push(message),
    overallTimeoutMs: 0,
    timeoutMs: 200,
    ...overrides
  });
  return { lifecycle, exits, errors };
}

test("lifecycle starts idle, becomes running and stopping synchronously", async () => {
  const { lifecycle, exits } = createHarness();
  assert.equal(lifecycle.getState(), "idle");
  lifecycle.setRunning();
  assert.equal(lifecycle.getState(), "running");
  assert.equal(lifecycle.isStopping(), false);

  const promise = lifecycle.shutdown("test", 0);
  // State phải đổi ngay, trước khi cleanup await xong.
  assert.equal(lifecycle.isStopping(), true);
  await promise;
  assert.equal(lifecycle.getState(), "stopped");
  assert.deepEqual(exits, [0]);
});

test("lifecycle shutdown is idempotent and runs handlers once, in reverse order", async () => {
  const { lifecycle, exits } = createHarness();
  const order = [];
  lifecycle.register({ name: "first", onShutdown: () => order.push("first") });
  lifecycle.register({ name: "second", onShutdown: () => order.push("second") });

  const first = lifecycle.shutdown("sigint", 130);
  const second = lifecycle.shutdown("sigint", 130);
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.deepEqual(firstResult.results, secondResult.results);

  assert.deepEqual(order, ["second", "first"]);
  assert.deepEqual(exits, [130]);
});

test("handler errors and timeouts do not stop the remaining cleanup", async () => {
  const { lifecycle, exits, errors } = createHarness({ timeoutMs: 40 });
  const order = [];
  lifecycle.register({ name: "ok-first", onShutdown: () => order.push("ok-first") });
  lifecycle.register({
    name: "throws",
    onShutdown: () => {
      order.push("throws");
      throw new Error("cleanup boom");
    }
  });
  lifecycle.register({
    name: "hangs",
    onShutdown: () => new Promise(() => {})
  });
  lifecycle.register({ name: "ok-last", onShutdown: () => order.push("ok-last") });

  const result = await lifecycle.shutdown("fatal", 1);
  // Thứ tự chạy ngược: ok-last, hangs(timeout), throws, ok-first.
  assert.deepEqual(order, ["ok-last", "throws", "ok-first"]);
  assert.equal(exits.length, 1);
  assert.equal(exits[0], 1);
  const statuses = Object.fromEntries(
    result.results.map((item) => [item.name, item.status])
  );
  assert.equal(statuses["ok-last"], "ok");
  assert.equal(statuses.hangs, "error");
  assert.equal(statuses.throws, "error");
  assert.equal(statuses["ok-first"], "ok");
  assert.ok(errors.some((line) => /cleanup hangs/.test(line)));
  assert.ok(errors.some((line) => /cleanup boom/.test(line)));
});

test("lifecycle heartbeat writes atomically and reflects updates", async (t) => {
  const dir = tempDir(t);
  const heartbeatPath = path.join(dir, "state", "heartbeat.json");
  const { lifecycle } = createHarness({ heartbeatPath, heartbeatIntervalMs: 0 });

  lifecycle.startHeartbeat({ pid: 123, version: "1.0.0", mode: null });
  const first = JSON.parse(fs.readFileSync(heartbeatPath, "utf8"));
  assert.equal(first.pid, 123);
  assert.equal(first.version, "1.0.0");
  assert.equal(first.state, "running");
  assert.match(first.lastHeartbeatAt, /^\d{4}-\d{2}-\d{2}T/);

  lifecycle.updateHeartbeat({ mode: "master", activeWorkerId: "w-1" });
  lifecycle.startHeartbeat({ pid: 123, version: "1.0.0", mode: "master" });
  const second = JSON.parse(fs.readFileSync(heartbeatPath, "utf8"));
  assert.equal(second.mode, "master");
  assert.equal(second.activeWorkerId, "w-1");
  assert.equal(fs.existsSync(`${heartbeatPath}.tmp`), false);
});

test("lifecycle unregister prevents a handler from running", async () => {
  const { lifecycle, exits } = createHarness();
  let ran = false;
  const unregister = lifecycle.register({
    name: "temporary",
    onShutdown: () => {
      ran = true;
    }
  });
  assert.equal(unregister(), true);
  assert.equal(unregister(), false);
  await lifecycle.shutdown("test", 0);
  assert.equal(ran, false);
  assert.deepEqual(exits, [0]);
});

test("lifecycle maps signals to conventional exit codes", () => {
  assert.equal(exitCodeForSignal("SIGINT"), 130);
  assert.equal(exitCodeForSignal("SIGTERM"), 143);
  assert.equal(exitCodeForSignal("SIGBREAK"), 130);
  assert.equal(exitCodeForSignal("SIGUSR2"), 1);
  assert.equal(DEFAULT_SHUTDOWN_TIMEOUT_MS, 20_000);
});

test("lifecycle installs signal handlers once; second Ctrl+C exits immediately", async () => {
  const fakeProcess = new EventEmitter();
  const { lifecycle, exits } = createHarness({ processRef: fakeProcess });
  let cleaned = 0;
  lifecycle.register({
    name: "cleanup",
    onShutdown: () => {
      cleaned += 1;
    }
  });

  assert.equal(lifecycle.installSignalHandlers(), true);
  assert.equal(lifecycle.installSignalHandlers(), false);

  fakeProcess.emit("SIGINT");
  fakeProcess.emit("SIGINT");
  // Lần 2 phải exit ngay với 130, không chờ cleanup.
  assert.deepEqual(exits, [130]);
  await lifecycle.shutdown("signal:SIGINT", 130);
  assert.equal(cleaned, 1);
  assert.equal(exits.length, 1, "shutdown không được exit lần hai");
});

test("lifecycle registers uncaughtException and unhandledRejection cleanup", async () => {
  const fakeProcess = new EventEmitter();
  const { lifecycle, exits, errors } = createHarness({ processRef: fakeProcess });
  let cleaned = 0;
  lifecycle.register({
    name: "cleanup",
    onShutdown: () => {
      cleaned += 1;
    }
  });
  lifecycle.installSignalHandlers();

  // EventEmitter coi "error" không có listener là lỗi, nhưng uncaughtException
  // là event thường nên emit an toàn.
  fakeProcess.emit("uncaughtException", new Error("boom"));
  await lifecycle.shutdown("uncaughtException", 1);
  assert.equal(cleaned, 1);
  assert.deepEqual(exits, [1]);
  assert.ok(errors.some((line) => /uncaughtException: Error: boom/.test(line)));
});
