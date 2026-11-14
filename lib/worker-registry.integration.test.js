// Integration test process-level cho process lock (TASK-043).
//
// Stage A chỉ test lock trong một process (unit). Test này spawn process thật để
// chứng minh: hai agent không thể cùng giữ lock, lock stale được tiếp quản, và
// heartbeat thực sự gia hạn lease.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fork } = require("node:child_process");

const CHILD = path.join(__dirname, "__fixtures__", "lock-child.js");
const READY_TIMEOUT_MS = 10_000;

function tempPaths(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fo4-lock-int-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return {
    dir,
    lockPath: path.join(dir, "agent.lock"),
    statePath: path.join(dir, "workers.json")
  };
}

function spawnChild(t, paths) {
  const child = fork(CHILD, [], {
    env: {
      ...process.env,
      FO4_LOCK_PATH: paths.lockPath,
      FO4_STATE_PATH: paths.statePath
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  });
  return {
    child,
    stderr: () => stderr,
    nextEvent: (timeoutMs = READY_TIMEOUT_MS) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Không nhận được IPC sau ${timeoutMs}ms: ${stderr}`));
        }, timeoutMs);
        child.once("message", (message) => {
          clearTimeout(timer);
          resolve(message);
        });
      }),
    exited: new Promise((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    })
  };
}

function readLock(paths) {
  return JSON.parse(fs.readFileSync(paths.lockPath, "utf8"));
}

test("two real processes: exactly one acquires the lock, the other is blocked", async (t) => {
  const paths = tempPaths(t);
  const first = spawnChild(t, paths);
  const acquired = await first.nextEvent();
  assert.equal(acquired.event, "acquired");

  const second = spawnChild(t, paths);
  const blocked = await second.nextEvent();
  assert.equal(blocked.event, "blocked");
  assert.equal(blocked.code, "AGENT_LOCKED");
  await second.exited;

  // Lock vẫn của process đầu.
  assert.equal(readLock(paths).pid, first.child.pid);

  first.child.send("release");
  const released = await first.nextEvent();
  assert.equal(released.event, "released");
  assert.equal(released.released, true);
  await first.exited;
  assert.equal(fs.existsSync(paths.lockPath), false);
});

test("a stale lock (dead pid + expired lease) is taken over", async (t) => {
  const paths = tempPaths(t);
  fs.writeFileSync(
    paths.lockPath,
    JSON.stringify({
      version: 1,
      pid: 0,
      token: "dead-token",
      startedAt: new Date(Date.now() - 600_000).toISOString(),
      heartbeatAt: new Date(Date.now() - 600_000).toISOString(),
      leaseUntil: Date.now() - 60_000
    }),
    "utf8"
  );

  const child = spawnChild(t, paths);
  const event = await child.nextEvent();
  assert.equal(event.event, "acquired");
  assert.equal(readLock(paths).pid, child.child.pid);
  child.child.send("exit");
});

test("a fresh lock held by a live process blocks a new agent", async (t) => {
  const paths = tempPaths(t);
  // Lock do process đang chạy test giữ (pid còn sống) → không được tiếp quản.
  fs.writeFileSync(
    paths.lockPath,
    JSON.stringify({
      version: 1,
      pid: process.pid,
      token: "live-token",
      leaseUntil: Date.now() + 60_000
    }),
    "utf8"
  );

  const child = spawnChild(t, paths);
  const event = await child.nextEvent();
  assert.equal(event.event, "blocked");
  assert.equal(event.code, "AGENT_LOCKED");
  await child.exited;
});

test("heartbeat extends the lease, and release lets the next agent in", async (t) => {
  const paths = tempPaths(t);
  const first = spawnChild(t, paths);
  await first.nextEvent();
  const before = readLock(paths).leaseUntil;

  first.child.send("heartbeat");
  const heartbeat = await first.nextEvent();
  assert.equal(heartbeat.event, "heartbeat");
  assert.equal(heartbeat.ok, true);
  assert.ok(
    heartbeat.leaseUntil > before,
    `lease phải tăng sau heartbeat (${before} -> ${heartbeat.leaseUntil})`
  );

  const second = spawnChild(t, paths);
  const blocked = await second.nextEvent();
  assert.equal(blocked.event, "blocked");
  await second.exited;

  first.child.send("release");
  assert.equal((await first.nextEvent()).event, "released");
  await first.exited;

  const third = spawnChild(t, paths);
  const acquired = await third.nextEvent();
  assert.equal(acquired.event, "acquired");
  third.child.send("exit");
});
