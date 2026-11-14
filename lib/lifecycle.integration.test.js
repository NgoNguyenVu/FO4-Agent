// Integration test process-level cho graceful shutdown (TASK-004B).
//
// Stage A chỉ test lifecycle bằng EventEmitter giả. Test này spawn process con
// thật dùng lib/lifecycle.js, gửi SIGINT/SIGTERM (hoặc IPC trên Windows) và
// kiểm tra exit code + cleanup + heartbeat.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fork } = require("node:child_process");

const CHILD = path.join(__dirname, "__fixtures__", "lifecycle-child.js");
const READY_TIMEOUT_MS = 10_000;

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fo4-lifecycle-int-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function startChild(t, env = {}) {
  const dir = tempDir(t);
  const heartbeatPath = path.join(dir, "state", "heartbeat.json");
  const child = fork(CHILD, [], {
    env: {
      ...process.env,
      FO4_HEARTBEAT_PATH: heartbeatPath,
      FO4_SHUTDOWN_TIMEOUT_MS: "400",
      ...env
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`process con không ready sau ${READY_TIMEOUT_MS}ms: ${stderr}`));
    }, READY_TIMEOUT_MS);
    child.on("message", (message) => {
      if (!message || message.ready !== true) return;
      clearTimeout(timer);
      resolve(message);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`process con thoát sớm code=${code} signal=${signal}: ${stderr}`));
    });
  });

  const exited = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });

  return {
    child,
    ready,
    exited,
    heartbeatPath,
    stdout: () => stdout,
    stderr: () => stderr
  };
}

// Windows không giao SIGINT thật cho process khác; dùng IPC để fixture tự
// emit, vẫn đi qua đúng signal handler và exit code của lifecycle.
function sendSignal(child, signal) {
  if (process.platform === "win32") {
    child.send({ signal });
    return;
  }
  child.kill(signal);
}

function readHeartbeat(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

test("SIGINT runs cleanup, writes heartbeat and exits 130", async (t) => {
  const harness = startChild(t);
  const ready = await harness.ready;
  assert.equal(ready.pid, harness.child.pid);

  const heartbeat = readHeartbeat(harness.heartbeatPath);
  assert.equal(heartbeat.pid, harness.child.pid);
  assert.equal(heartbeat.state, "running");
  assert.equal(heartbeat.fixture, "task-004b");
  assert.match(heartbeat.lastHeartbeatAt, /^\d{4}-\d{2}-\d{2}T/);

  sendSignal(harness.child, "SIGINT");
  const { code, signal } = await harness.exited;
  assert.equal(code, 130, `exit code phải là 130 (signal=${signal}): ${harness.stderr()}`);
  assert.equal(signal, null);
  assert.equal(
    (harness.stdout().match(/CLEANUP_OK/g) || []).length,
    1,
    "cleanup phải chạy đúng một lần"
  );
  assert.match(harness.stdout(), /Đã shutdown \(signal:SIGINT\); thoát với code 130/);
});

test("SIGTERM runs cleanup and exits 143", async (t) => {
  const harness = startChild(t);
  await harness.ready;

  sendSignal(harness.child, "SIGTERM");
  const { code } = await harness.exited;
  assert.equal(code, 143, harness.stderr());
  assert.match(harness.stdout(), /CLEANUP_OK/);
});

test("second Ctrl+C exits immediately while cleanup is hanging", async (t) => {
  const harness = startChild(t, {
    FO4_HANG_CLEANUP: "1",
    // Cleanup timeout dài để nếu phải chờ sẽ vượt ngưỡng assert.
    FO4_SHUTDOWN_TIMEOUT_MS: "5000"
  });
  await harness.ready;

  const startedAt = Date.now();
  sendSignal(harness.child, "SIGINT");
  // Chờ signal đầu được xử lý rồi gửi signal thứ hai.
  await new Promise((resolve) => setTimeout(resolve, 100));
  sendSignal(harness.child, "SIGINT");

  const { code } = await harness.exited;
  const elapsed = Date.now() - startedAt;
  assert.equal(code, 130, harness.stderr());
  assert.ok(
    elapsed < 4_500,
    `Ctrl+C lần hai phải thoát ngay, không chờ cleanup 5s (đã chờ ${elapsed}ms)`
  );
});

test("uncaughtException triggers the same cleanup path (exit code 1)", async (t) => {
  const harness = startChild(t);
  await harness.ready;

  harness.child.send({ uncaught: true });
  const { code } = await harness.exited;
  assert.equal(code, 1, harness.stderr());
  assert.match(harness.stdout(), /CLEANUP_OK/);
  assert.match(harness.stderr(), /uncaughtException: Error: fixture boom/);
});
