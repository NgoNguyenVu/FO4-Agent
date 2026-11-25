const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveLaunchMode } = require("./launch-cli");

function harness(answers) {
  const queue = [...answers];
  const logs = [];
  return {
    logs,
    resolve: (options = {}) =>
      resolveLaunchMode({
        argv: [],
        log: (message) => logs.push(message),
        ask: async () => {
          if (!queue.length) throw new Error("không còn câu trả lời test");
          return queue.shift();
        },
        ...options
      })
  };
}

test("--mode bypasses the interactive prompt entirely", async () => {
  const h = harness([]);
  const mode = await h.resolve({
    argv: ["--mode", "icon-only"],
    // Nếu ask được gọi thì ném lỗi ngay.
    ask: async () => { throw new Error("không được hỏi khi có --mode"); }
  });
  assert.equal(mode.key, "icon-only");
  assert.deepEqual(h.logs, []);
});

test("menu Enter selects the default icon-combo mode", async () => {
  const h = harness([""]);
  const mode = await h.resolve();
  assert.equal(mode.key, "icon-combo");
  assert.match(h.logs.join("\n"), /\[1\].*Săn ICON/);
});

test("menu accepts 1, 2 and mode keys; retries invalid input", async () => {
  assert.equal((await harness(["1"]).resolve()).key, "icon-combo");
  assert.equal((await harness(["2"]).resolve()).key, "icon-only");
  assert.equal((await harness(["icon-only"]).resolve()).key, "icon-only");

  const retry = harness(["x", "2"]);
  assert.equal((await retry.resolve()).key, "icon-only");
  assert.match(retry.logs.join("\n"), /không hợp lệ/);
});

test("invalid --mode fails fast with a clear code", async () => {
  await assert.rejects(
    () => harness([]).resolve({ argv: ["--mode=master"] }),
    (error) => {
      assert.equal(error.code, "INVALID_LAUNCH_MODE");
      assert.match(error.message, /icon-combo, icon-only/);
      return true;
    }
  );
});

test("menu gives up after maxAttempts without touching agent resources", async () => {
  await assert.rejects(
    () => harness(["x", "y", "z"]).resolve({ maxAttempts: 3 }),
    (error) => error.code === "LAUNCH_MODE_NOT_SELECTED"
  );
});
