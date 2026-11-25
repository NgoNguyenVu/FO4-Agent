const test = require("node:test");
const assert = require("node:assert/strict");
const { withDeadline } = require("./with-deadline");

test("withDeadline resolves with the original value and clears its timer", async () => {
  let cleared = null;
  const fake = {
    setTimeoutFn: (fn) => ({ id: 42, unref() {} }),
    clearTimeoutFn: (timer) => { cleared = timer; }
  };
  assert.equal(await withDeadline(Promise.resolve("ok"), 1_000, "fallback", fake), "ok");
  assert.equal(cleared?.id, 42);
});

test("withDeadline returns fallback on timeout and still clears the timer", async () => {
  let cleared = 0;
  const fake = {
    setTimeoutFn: (fn) => {
      fn(); // kích hoạt fallback ngay để test không chờ 1 giây
      return 9;
    },
    clearTimeoutFn: () => { cleared += 1; }
  };
  assert.equal(await withDeadline(new Promise(() => {}), 5, "timeout", fake), "timeout");
  assert.equal(cleared, 1);
});

test("withDeadline propagates rejection and clears the timer", async () => {
  let cleared = false;
  const failure = new Error("boom");
  await assert.rejects(
    () => withDeadline(Promise.reject(failure), 1_000, undefined, {
      setTimeoutFn: () => 3,
      clearTimeoutFn: () => { cleared = true; }
    }),
    (error) => error === failure
  );
  assert.equal(cleared, true);
});
