const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createE006Cooldown, E006_FLOWS } = require("./e006-cooldown");

function harness(statePath, start = 1_000_000) {
  let current = start;
  let seq = 0;
  const timers = new Map();
  return {
    statePath,
    cooldown: createE006Cooldown({
      statePath,
      now: () => current,
      setTimeoutFn: (fn, ms) => {
        const id = ++seq;
        timers.set(id, { fn, at: current + Math.max(0, ms) });
        return id;
      },
      clearTimeoutFn: (id) => timers.delete(id)
    }),
    now: () => current,
    advance(ms) {
      current += ms;
      for (const [id, timer] of [...timers.entries()]) {
        if (timer.at > current) continue;
        timers.delete(id);
        timer.fn();
      }
    }
  };
}

function tempState(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fo4-e006-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "e006-cooldown.json");
}

test("E006 cooldown is persisted and hydrated across restarts", (t) => {
  const statePath = tempState(t);
  const first = harness(statePath);
  first.cooldown.defer(E006_FLOWS.UPGRADE, new Error("E006 token"), {
    source: "test"
  });
  const saved = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].flow, E006_FLOWS.UPGRADE);
  assert.equal(saved[0].attempts, 1);

  // Restart cùng mốc thời gian: vẫn còn hiệu lực.
  const second = harness(statePath);
  assert.equal(second.cooldown.isDeferred(E006_FLOWS.UPGRADE), true);
  assert.equal(second.cooldown.snapshot()[0].attempts, 1);

  // Hết hạn trong lúc agent tắt thì không re-arm.
  const expiredPath = tempState(t);
  fs.writeFileSync(
    expiredPath,
    JSON.stringify([
      {
        flow: E006_FLOWS.PHOI_BUY,
        retryAt: second.now() - 1,
        attempts: 2
      }
    ])
  );
  const third = harness(expiredPath);
  assert.equal(third.cooldown.isDeferred(E006_FLOWS.PHOI_BUY), false);
});

test("clearAll clears callbacks and writes an empty state file", (t) => {
  const statePath = tempState(t);
  const h = harness(statePath);
  let fired = 0;
  h.cooldown.onExpire(E006_FLOWS.ICON_BUY, () => { fired += 1; });
  h.cooldown.defer(E006_FLOWS.ICON_BUY, new Error("E006"), { source: "test" });
  h.cooldown.clearAll();
  assert.deepEqual(JSON.parse(fs.readFileSync(statePath, "utf8")), []);
  h.advance(11 * 60_000);
  assert.equal(fired, 0, "callback phải bị xóa cùng timers/states");
});
