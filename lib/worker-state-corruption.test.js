// Test fail-closed khi workers.json hỏng (TASK-047).
//
// Trước đây readJson() trả null cho JSON hỏng nên loadState() coi như registry
// rỗng: agent có thể bấm mua mới trong khi worker cũ vẫn đang chạy (fail-open).
// Bây giờ file hỏng phải được quarantine và mọi thao tác worker phải bị chặn.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createWorkerRegistry } = require("./worker-registry");
const { createWorkerSession } = require("./worker-session");

function tempState(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fo4-corrupt-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return {
    dir,
    stateDir: path.join(dir, "state"),
    statePath: path.join(dir, "state", "workers.json"),
    lockPath: path.join(dir, "state", "agent.lock")
  };
}

function writeState(paths, text) {
  fs.mkdirSync(paths.stateDir, { recursive: true });
  fs.writeFileSync(paths.statePath, text, "utf8");
}

function createHarness(t, paths) {
  const errors = [];
  const registry = createWorkerRegistry({
    ...paths,
    pid: 4242,
    log: () => {},
    logError: (line) => errors.push(line)
  });
  const session = createWorkerSession({ registry, log: () => {}, logError: () => {} });
  return { registry, session, errors };
}

function quarantineFiles(paths) {
  if (!fs.existsSync(paths.stateDir)) return [];
  return fs
    .readdirSync(paths.stateDir)
    .filter((name) => name.startsWith("workers.json.corrupt-"));
}

function assertCorrupt(fn, paths) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, "WORKER_STATE_CORRUPT");
    assert.equal(error.statePath, paths.statePath);
    assert.match(error.message, /hỏng/);
    return true;
  });
}

test("state file thiếu (ENOENT) vẫn là registry rỗng hợp lệ", (t) => {
  const paths = tempState(t);
  const { registry } = createHarness(t, paths);

  assert.deepEqual(registry.getSnapshot().workers, []);
  assert.equal(registry.beginStart({ feature: "buy" }).startsWith("buy-"), true);
});

test("JSON hỏng: getSnapshot ném WORKER_STATE_CORRUPT và quarantine bản sao", (t) => {
  const paths = tempState(t);
  const broken = "{ not json";
  writeState(paths, broken);
  const { registry, errors } = createHarness(t, paths);

  assertCorrupt(() => registry.getSnapshot(), paths);

  const quarantined = quarantineFiles(paths);
  assert.equal(quarantined.length, 1, "phải tạo đúng một bản quarantine");
  assert.equal(
    fs.readFileSync(path.join(paths.stateDir, quarantined[0]), "utf8"),
    broken
  );
  // File gốc được giữ nguyên để con người kiểm tra/sửa.
  assert.equal(fs.readFileSync(paths.statePath, "utf8"), broken);
  assert.ok(errors.some((line) => /quarantine/i.test(line)));
});

test("JSON hỏng: reconcileOnStartup chặn thay vì clear, tryBegin trả null", (t) => {
  const paths = tempState(t);
  writeState(paths, "{ broken");
  const { session } = createHarness(t, paths);

  const outcome = session.reconcileOnStartup({ hasWorkerEvidence: true });
  assert.equal(outcome.action, "block");
  assert.equal(outcome.reason, "registry-corrupt");
  assert.deepEqual(outcome.workers, []);

  assert.equal(session.tryBegin("buy"), null);
  assert.equal(session.blockedReason().reason, "WORKER_STATE_CORRUPT");
  // Vẫn không ghi đè state hỏng.
  assert.equal(fs.readFileSync(paths.statePath, "utf8"), "{ broken");
});

test("cấu trúc workers không hợp lệ cũng fail-closed", (t) => {
  for (const text of [
    "",
    "null",
    "[]",
    '{"workers":"nope"}',
    '{"workers":[{"workerId":"w1","feature":"buy","state":"bogus"}]}',
    '{"workers":[{"workerId":"","feature":"buy","state":"running"}]}',
    '{"workers":[{"workerId":"w1","state":"running"}]}'
  ]) {
    const paths = tempState(t);
    writeState(paths, text);
    const { registry } = createHarness(t, paths);
    assertCorrupt(() => registry.getSnapshot(), paths);
  }
});

test("quarantine chỉ tạo một lần cho mỗi instance dù đọc lỗi nhiều lần", (t) => {
  const paths = tempState(t);
  writeState(paths, "{ broken");
  const { registry } = createHarness(t, paths);

  assertCorrupt(() => registry.getSnapshot(), paths);
  assertCorrupt(() => registry.getSnapshot(), paths);
  assert.equal(quarantineFiles(paths).length, 1);
});

test("state hợp lệ vẫn đọc bình thường (không hồi quy)", (t) => {
  const paths = tempState(t);
  const { registry } = createHarness(t, paths);
  const workerId = registry.beginStart({ feature: "buy" });
  registry.markRunning(workerId);

  const restarted = createHarness(t, paths);
  const snapshot = restarted.registry.getSnapshot();
  assert.equal(snapshot.workers.length, 1);
  assert.equal(snapshot.workers[0].workerId, workerId);
  assert.equal(snapshot.workers[0].state, "running");
  assert.equal(quarantineFiles(paths).length, 0);
});
