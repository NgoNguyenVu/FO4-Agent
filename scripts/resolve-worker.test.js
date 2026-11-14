const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { createWorkerRegistry } = require("../lib/worker-registry");

const CLI = path.join(__dirname, "resolve-worker.js");

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fo4-resolve-worker-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function seedRegistry(dir) {
  const registry = createWorkerRegistry({
    statePath: path.join(dir, "workers.json"),
    lockPath: path.join(dir, "agent.lock"),
    pid: 4321,
    log: () => {},
    logError: () => {}
  });
  return registry;
}

function run(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8"
  });
  return {
    code: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || ""
  };
}

function readState(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "workers.json"), "utf8"));
}

test("--list reports an empty registry when no state file exists", (t) => {
  const dir = tempDir(t);
  const result = run(["--state-dir", dir]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Chưa có file worker state/);
});

test("--list shows unknown workers with a resolve hint", (t) => {
  const dir = tempDir(t);
  const registry = seedRegistry(dir);
  const workerId = registry.beginStart({ feature: "buy" });
  registry.markRunning(workerId);
  registry.markUnknown(workerId, "browser-closed");

  const result = run(["--state-dir", dir]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, new RegExp(workerId));
  assert.match(result.stdout, /unknown/);
  assert.match(result.stdout, /browser-closed/);
  assert.match(result.stdout, /--resolve/);
});

test("--resolve moves one unknown worker to stopped", (t) => {
  const dir = tempDir(t);
  const registry = seedRegistry(dir);
  const workerId = registry.beginStart({ feature: "buy" });
  registry.markRunning(workerId);
  registry.markUnknown(workerId, "browser-closed");

  const result = run([
    "--state-dir",
    dir,
    "--resolve",
    workerId,
    "--note",
    "operator checked Telegram"
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /unknown -> stopped/);

  const worker = readState(dir).workers[0];
  assert.equal(worker.state, "stopped");
  assert.equal(worker.reason, "operator checked Telegram");
});

test("--resolve refuses a worker that is not unknown", (t) => {
  const dir = tempDir(t);
  const registry = seedRegistry(dir);
  const workerId = registry.beginStart({ feature: "buy" });
  registry.markRunning(workerId);

  const result = run(["--state-dir", dir, "--resolve", workerId]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /chỉ resolve được worker unknown/);
  assert.equal(readState(dir).workers[0].state, "running");
});

test("--resolve reports a missing worker id", (t) => {
  const dir = tempDir(t);
  seedRegistry(dir);
  const result = run(["--state-dir", dir, "--resolve", "does-not-exist"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Không tìm thấy worker/);
});

test("--resolve-all resolves every unknown worker and keeps running ones", (t) => {
  const dir = tempDir(t);
  const registry = seedRegistry(dir);
  // ICON là worker nền: tạo trước, vì worker unknown sẽ chặn mọi beginStart mới.
  const runningId = registry.beginStart({
    feature: "icon",
    concurrencyGroup: "background"
  });
  registry.markRunning(runningId);
  const unknownId = registry.beginStart({ feature: "buy" });
  registry.markRunning(unknownId);
  registry.markUnknown(unknownId, "browser-closed");

  const result = run(["--state-dir", dir, "--resolve-all"]);
  assert.equal(result.code, 0, result.stderr);
  const states = Object.fromEntries(
    readState(dir).workers.map((worker) => [worker.workerId, worker.state])
  );
  assert.equal(states[unknownId], "stopped");
  assert.equal(states[runningId], "running");
});

test("--resolve-all is a no-op when nothing is unknown", (t) => {
  const dir = tempDir(t);
  seedRegistry(dir);
  const result = run(["--state-dir", dir, "--resolve-all"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Không có worker unknown/);
});

test("CLI refuses to modify state while the agent process lock is alive", (t) => {
  const dir = tempDir(t);
  const registry = seedRegistry(dir);
  const workerId = registry.beginStart({ feature: "buy" });
  registry.markRunning(workerId);
  registry.markUnknown(workerId, "browser-closed");

  // Lock của process đang chạy test → lease còn hạn và pid còn sống.
  fs.writeFileSync(
    path.join(dir, "agent.lock"),
    JSON.stringify({
      version: 1,
      pid: process.pid,
      token: "live-agent",
      leaseUntil: Date.now() + 60_000
    }),
    "utf8"
  );

  const result = run(["--state-dir", dir, "--resolve-all"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /agent vẫn đang chạy/);
  assert.equal(readState(dir).workers[0].state, "unknown");
});

test("a stale lock (dead pid) does not block resolve", (t) => {
  const dir = tempDir(t);
  const registry = seedRegistry(dir);
  const workerId = registry.beginStart({ feature: "buy" });
  registry.markRunning(workerId);
  registry.markUnknown(workerId, "browser-closed");
  fs.writeFileSync(
    path.join(dir, "agent.lock"),
    JSON.stringify({
      version: 1,
      pid: 0,
      token: "dead-agent",
      leaseUntil: Date.now() + 60_000
    }),
    "utf8"
  );

  const result = run(["--state-dir", dir, "--resolve-all"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(readState(dir).workers[0].state, "stopped");
});

test("--json --list emits parseable JSON with worker details", (t) => {
  const dir = tempDir(t);
  const registry = seedRegistry(dir);
  const workerId = registry.beginStart({ feature: "buy" });
  registry.markRunning(workerId);

  const result = run(["--state-dir", dir, "--json"]);
  assert.equal(result.code, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.agentRunning, false);
  assert.equal(parsed.workers.length, 1);
  assert.equal(parsed.workers[0].workerId, workerId);
  assert.equal(parsed.workers[0].feature, "buy");
  assert.equal(parsed.workers[0].concurrencyGroup, "exclusive");
  assert.equal(parsed.workers[0].state, "running");
});

test("CLI preserves the original process block in workers.json", (t) => {
  const dir = tempDir(t);
  const registry = seedRegistry(dir);
  const workerId = registry.beginStart({ feature: "buy" });
  registry.markRunning(workerId);
  registry.markUnknown(workerId, "browser-closed");
  const before = readState(dir).process;

  const result = run(["--state-dir", dir, "--resolve", workerId]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(readState(dir).process, before);
});

test("invalid flags exit with code 2 and print usage", (t) => {
  const dir = tempDir(t);
  const result = run(["--state-dir", dir, "--nope"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Tham số không hợp lệ/);
  assert.match(result.stderr, /Cách dùng/);
});

test("--list fails clearly on a corrupted state file", (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, "workers.json"), "{ not json", "utf8");
  const result = run(["--state-dir", dir]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Không đọc được/);
});

test("--help exits 0 and documents exit codes", () => {
  const result = run(["--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /--resolve-all/);
  assert.match(result.stdout, /Mã thoát/);
});
