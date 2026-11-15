// Test fail-closed khi agent.lock hỏng (TASK-050, follow-up TASK-047).
//
// Trước đây readJson() trả null cho JSON hỏng nên acquireProcessLock() coi như
// "không có lock" và ghi đè: hai instance có thể cùng chạy (fail-open). Bây giờ
// lock rỗng/JSON hỏng/sai cấu trúc phải được quarantine .corrupt-<ISO> và mọi
// thao tác lock phải dừng an toàn; file gốc được giữ nguyên để kiểm tra.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createWorkerRegistry } = require("./worker-registry");
const { agentIsRunning } = require("../scripts/resolve-worker");

function tempState(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fo4-lock-corrupt-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return {
    dir,
    stateDir: path.join(dir, "state"),
    statePath: path.join(dir, "state", "workers.json"),
    lockPath: path.join(dir, "state", "agent.lock")
  };
}

function writeLock(paths, text) {
  fs.mkdirSync(paths.stateDir, { recursive: true });
  fs.writeFileSync(paths.lockPath, text, "utf8");
}

function createHarness(paths, overrides = {}) {
  const errors = [];
  const registry = createWorkerRegistry({
    ...paths,
    pid: 4242,
    now: () => 1_000_000,
    leaseMs: 60_000,
    log: () => {},
    logError: (line) => errors.push(line),
    ...overrides
  });
  return { registry, errors };
}

function quarantineFiles(paths) {
  if (!fs.existsSync(paths.stateDir)) return [];
  return fs
    .readdirSync(paths.stateDir)
    .filter((name) => name.startsWith("agent.lock.corrupt-"));
}

function assertCorrupt(fn, paths) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, "AGENT_LOCK_CORRUPT");
    assert.equal(error.lockPath, paths.lockPath);
    assert.match(error.message, /hỏng/);
    return true;
  });
}

test("lock thiếu (ENOENT) vẫn cho phép acquire", (t) => {
  const paths = tempState(t);
  const { registry } = createHarness(paths);

  const lock = registry.acquireProcessLock();
  assert.equal(lock.pid, 4242);
  assert.equal(fs.existsSync(paths.lockPath), true);
  assert.equal(quarantineFiles(paths).length, 0);
});

test("lock rỗng: acquire ném AGENT_LOCK_CORRUPT và quarantine bản sao", (t) => {
  const paths = tempState(t);
  writeLock(paths, "   \n");
  const { registry, errors } = createHarness(paths);

  assertCorrupt(() => registry.acquireProcessLock(), paths);

  const quarantined = quarantineFiles(paths);
  assert.equal(quarantined.length, 1, "phải tạo đúng một bản quarantine");
  assert.equal(
    fs.readFileSync(path.join(paths.stateDir, quarantined[0]), "utf8"),
    "   \n"
  );
  // File gốc được giữ nguyên để con người kiểm tra/sửa.
  assert.equal(fs.readFileSync(paths.lockPath, "utf8"), "   \n");
  assert.ok(errors.some((line) => /quarantine/i.test(line)));
});

test("JSON hỏng: acquire ném AGENT_LOCK_CORRUPT và không ghi đè lock", (t) => {
  const paths = tempState(t);
  const broken = "{ not json";
  writeLock(paths, broken);
  const { registry } = createHarness(paths);

  assertCorrupt(() => registry.acquireProcessLock(), paths);

  assert.equal(fs.readFileSync(paths.lockPath, "utf8"), broken);
  assert.equal(quarantineFiles(paths).length, 1);
});

test("cấu trúc lock không hợp lệ cũng fail-closed", (t) => {
  for (const text of [
    "null",
    "[]",
    '"text"',
    "{}",
    '{"token":"x"}',
    '{"token":"","pid":1,"leaseUntil":9999999999999}',
    '{"token":"x","pid":"abc","leaseUntil":9999999999999}',
    '{"token":"x","pid":1}'
  ]) {
    const paths = tempState(t);
    writeLock(paths, text);
    const { registry } = createHarness(paths);
    assertCorrupt(() => registry.acquireProcessLock(), paths);
    assert.equal(fs.readFileSync(paths.lockPath, "utf8"), text);
  }
});

test("heartbeat/release không ghi đè lock hỏng", (t) => {
  const paths = tempState(t);
  const broken = "{ broken";
  writeLock(paths, broken);
  const { registry, errors } = createHarness(paths);

  assert.equal(registry.heartbeatProcessLock(), false);
  assert.equal(registry.releaseProcessLock(), false);
  assert.equal(fs.readFileSync(paths.lockPath, "utf8"), broken);
  assert.ok(errors.some((line) => /không gia hạn lease/i.test(line)));
  assert.ok(errors.some((line) => /không xóa file/i.test(line)));
});

test("isProcessLockHeld coi lock hỏng là đang giữ (fail-closed)", (t) => {
  const paths = tempState(t);
  writeLock(paths, "{ broken");
  const { registry } = createHarness(paths);

  assert.equal(registry.isProcessLockHeld(), true);
  assert.equal(registry.getSnapshot().process.lockHeld, true);
});

test("quarantine chỉ tạo một lần cho mỗi instance dù đọc lỗi nhiều lần", (t) => {
  const paths = tempState(t);
  writeLock(paths, "{ broken");
  const { registry } = createHarness(paths);

  assertCorrupt(() => registry.acquireProcessLock(), paths);
  assertCorrupt(() => registry.acquireProcessLock(), paths);
  assert.equal(registry.heartbeatProcessLock(), false);
  assert.equal(quarantineFiles(paths).length, 1);
});

test("lock hợp lệ vẫn hoạt động bình thường (không hồi quy)", (t) => {
  const paths = tempState(t);
  const { registry } = createHarness(paths);
  registry.acquireProcessLock();

  assert.equal(registry.isProcessLockHeld(), true);
  assert.equal(registry.heartbeatProcessLock(), true);
  assert.equal(registry.releaseProcessLock(), true);
  assert.equal(fs.existsSync(paths.lockPath), false);
  assert.equal(quarantineFiles(paths).length, 0);
});

test("resolve-worker agentIsRunning: lock hỏng/rỗng bị coi là đang chạy", (t) => {
  const paths = tempState(t);
  assert.equal(agentIsRunning(paths.lockPath), false, "ENOENT = không chạy");

  for (const text of [
    "",
    "   ",
    "{ broken",
    "null",
    "[]",
    "{}",
    '{"token":"x"}'
  ]) {
    writeLock(paths, text);
    assert.equal(agentIsRunning(paths.lockPath), true, `phải chặn với: ${text}`);
  }

  // Lock hợp lệ nhưng lease hết hạn + pid chết → được coi là stale.
  writeLock(
    paths,
    JSON.stringify({
      version: 1,
      pid: 0,
      token: "dead-token",
      leaseUntil: Date.now() - 60_000
    })
  );
  assert.equal(agentIsRunning(paths.lockPath), false);
});
