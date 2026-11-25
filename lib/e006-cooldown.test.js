const test = require("node:test");
const assert = require("node:assert/strict");
const {
  E006_COOLDOWN_MS,
  E006_FLOWS,
  isE006Error,
  identifyE006Flow,
  createE006Cooldown
} = require("./e006-cooldown");

function createFakeClock(start = 1_000_000) {
  let current = start;
  let sequence = 0;
  const timers = new Map();
  return {
    now: () => current,
    setTimeoutFn: (fn, ms) => {
      const id = ++sequence;
      timers.set(id, { fn, at: current + Math.max(0, ms) });
      return id;
    },
    clearTimeoutFn: (id) => {
      timers.delete(id);
    },
    advance: (ms) => {
      current += ms;
      for (const [id, timer] of [...timers.entries()]) {
        if (timer.at > current) continue;
        timers.delete(id);
        timer.fn();
      }
    },
    pending: () => timers.size
  };
}

test("E006 cooldown is exactly 10 minutes", () => {
  assert.equal(E006_COOLDOWN_MS, 10 * 60 * 1000);
  assert.equal(E006_COOLDOWN_MS, 600_000);
});

test("E006 error detection covers code, message and raw token text", () => {
  assert.equal(isE006Error({ code: "BOT_SYSTEM_ERROR", message: "x" }), true);
  assert.equal(isE006Error(new Error("E006: Không thể làm mới token")), true);
  assert.equal(isE006Error(new Error("Worker dừng do không thể làm mới token sau 3 lần thử")), true);
  assert.equal(isE006Error(new Error("E007: giới hạn lệnh mua")), false);
  assert.equal(isE006Error(null), false);
});

test("identifies the exact flow from explicit tags, messages and stacks", () => {
  assert.equal(identifyE006Flow({ flow: "icon-buy" }), E006_FLOWS.ICON_BUY);
  assert.equal(identifyE006Flow({ flow: "buy" }), E006_FLOWS.PHOI_BUY);
  assert.equal(identifyE006Flow({ flow: "nang" }), E006_FLOWS.UPGRADE);

  assert.equal(
    identifyE006Flow({ error: new Error("Bot trả E006 ở bước Mua cầu thủ.") }),
    E006_FLOWS.ICON_BUY
  );
  assert.equal(
    identifyE006Flow({ error: new Error("Bot trả E006 khi lấy menu Auto Mua Phôi.") }),
    E006_FLOWS.PHOI_BUY
  );
  assert.equal(
    identifyE006Flow({ error: new Error("Bot trả E006 trong lúc chờ /stopnc.") }),
    E006_FLOWS.UPGRADE
  );
  assert.equal(
    identifyE006Flow({
      error: Object.assign(new Error("boom"), {
        stack: "Error: boom\n    at run (features/icon-buy/order.js:1:1)"
      })
    }),
    E006_FLOWS.ICON_BUY
  );
  assert.equal(
    identifyE006Flow({
      error: Object.assign(new Error("boom"), {
        stack: "Error: boom\n    at run (features/upgrade/runner.js:1:1)"
      })
    }),
    E006_FLOWS.UPGRADE
  );
});

test("defers only the failed flow for exactly 10 minutes and auto-resets", () => {
  const clock = createFakeClock();
  const logs = [];
  const cooldown = createE006Cooldown({
    statePath: null, // test cũ không cần persist; test persist dùng file riêng
    now: clock.now,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    log: (line) => logs.push(line)
  });

  const state = cooldown.defer(
    E006_FLOWS.PHOI_BUY,
    new Error("E006: Không thể làm mới token"),
    { source: "test" }
  );

  assert.equal(state.flow, E006_FLOWS.PHOI_BUY);
  assert.equal(state.retryAt - state.failedAt, E006_COOLDOWN_MS);
  assert.equal(cooldown.isDeferred(E006_FLOWS.PHOI_BUY), true);
  assert.equal(cooldown.remainingMs(E006_FLOWS.PHOI_BUY), E006_COOLDOWN_MS);

  // Các luồng khác không bị ảnh hưởng.
  assert.equal(cooldown.isDeferred(E006_FLOWS.ICON_BUY), false);
  assert.equal(cooldown.isDeferred(E006_FLOWS.UPGRADE), false);

  clock.advance(E006_COOLDOWN_MS - 1);
  assert.equal(cooldown.isDeferred(E006_FLOWS.PHOI_BUY), true);
  assert.equal(cooldown.remainingMs(E006_FLOWS.PHOI_BUY), 1);

  clock.advance(1);
  assert.equal(cooldown.isDeferred(E006_FLOWS.PHOI_BUY), false);
  assert.equal(cooldown.remainingMs(E006_FLOWS.PHOI_BUY), 0);
  assert.deepEqual(cooldown.snapshot(), []);
  assert.ok(
    logs.some((line) => line.includes("E006 [phoi-buy]") && line.includes("10 phút")),
    "log must name the flow and the 10-minute cooldown"
  );
});

test("auto-runs the registered feature callback once after the cooldown", () => {
  const clock = createFakeClock();
  const calls = [];
  const cooldown = createE006Cooldown({
    statePath: null, // test cũ không cần persist; test persist dùng file riêng
    now: clock.now,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn
  });

  cooldown.onExpire(E006_FLOWS.UPGRADE, (state) => {
    calls.push(state.flow);
  });
  cooldown.defer(E006_FLOWS.UPGRADE, null, {
    message: "Bot nâng cấp trả E006.",
    source: "test"
  });

  clock.advance(E006_COOLDOWN_MS - 1);
  assert.deepEqual(calls, []);
  clock.advance(1);
  assert.deepEqual(calls, [E006_FLOWS.UPGRADE]);
  assert.equal(cooldown.isDeferred(E006_FLOWS.UPGRADE), false);

  // Timer đã chạy: không gọi lại lần nữa.
  clock.advance(E006_COOLDOWN_MS * 2);
  assert.deepEqual(calls, [E006_FLOWS.UPGRADE]);
});

test("a failing retry callback is logged and does not break other flows", () => {
  const clock = createFakeClock();
  const errors = [];
  const cooldown = createE006Cooldown({
    statePath: null, // test cũ không cần persist; test persist dùng file riêng
    now: clock.now,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    logError: (line) => errors.push(line)
  });

  cooldown.onExpire(E006_FLOWS.ICON_BUY, () => {
    throw new Error("retry failed");
  });
  cooldown.defer(E006_FLOWS.ICON_BUY, new Error("E006: Không thể làm mới token"));

  assert.doesNotThrow(() => clock.advance(E006_COOLDOWN_MS));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /icon-buy/);
  assert.equal(cooldown.isDeferred(E006_FLOWS.ICON_BUY), false);
});

test("a newer E006 replaces the old timer and restarts the 10-minute window", () => {
  const clock = createFakeClock();
  const calls = [];
  const cooldown = createE006Cooldown({
    statePath: null, // test cũ không cần persist; test persist dùng file riêng
    now: clock.now,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn
  });

  cooldown.onExpire(E006_FLOWS.PHOI_BUY, () => calls.push("retry"));
  cooldown.defer(E006_FLOWS.PHOI_BUY, new Error("E006"));
  clock.advance(5 * 60 * 1000);
  cooldown.defer(E006_FLOWS.PHOI_BUY, new Error("E006"));

  // Cửa sổ mới tính từ lần lỗi thứ hai: chưa đủ 10 phút thì chưa chạy lại,
  // dù mốc cũ (5 phút trước) đã qua.
  clock.advance(E006_COOLDOWN_MS - 1);
  assert.deepEqual(calls, []);
  assert.equal(cooldown.isDeferred(E006_FLOWS.PHOI_BUY), true);

  clock.advance(1);
  assert.deepEqual(calls, ["retry"]);
});

test("reset clears only the requested flow and its timer", () => {
  const clock = createFakeClock();
  const cooldown = createE006Cooldown({
    statePath: null, // test cũ không cần persist; test persist dùng file riêng
    now: clock.now,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn
  });

  cooldown.defer(E006_FLOWS.ICON_BUY, new Error("E006"));
  cooldown.defer(E006_FLOWS.UPGRADE, new Error("E006"));

  assert.equal(cooldown.reset(E006_FLOWS.ICON_BUY), true);
  assert.equal(cooldown.isDeferred(E006_FLOWS.ICON_BUY), false);
  assert.equal(cooldown.isDeferred(E006_FLOWS.UPGRADE), true);
  assert.equal(clock.pending(), 1);
});
