const test = require("node:test");
const assert = require("node:assert/strict");
const { createUiLock } = require("./ui-lock");

function tick(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("ui lock serializes UI work and runs waiters in FIFO order", async () => {
  const ui = createUiLock();
  const order = [];
  let releaseFirst;
  const first = ui.withLock(async () => {
    order.push("first-start");
    await new Promise((resolve) => {
      releaseFirst = resolve;
    });
    order.push("first-end");
  });
  const second = ui.withLock(async () => {
    order.push("second");
  });
  await tick();
  assert.deepEqual(order, ["first-start"]);
  assert.equal(ui.isHeld(), true);
  assert.equal(ui.waitingCount(), 1);

  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first-start", "first-end", "second"]);
  assert.equal(ui.isHeld(), false);
});

test("ui lock passes ownership directly from release to the next waiter", async () => {
  const ui = createUiLock();
  const order = [];
  await ui.acquire();
  const second = ui.acquire().then(() => order.push("second"));
  const third = ui.acquire().then(() => order.push("third"));
  assert.equal(ui.waitingCount(), 2);

  ui.release();
  await tick();
  assert.deepEqual(order, ["second"]);
  assert.equal(ui.isHeld(), true);

  ui.release();
  await Promise.all([second, third]);
  assert.deepEqual(order, ["second", "third"]);
  ui.release();
  assert.equal(ui.isHeld(), false);
});

test("ui lock releases after a failing task and ignores extra releases", async () => {
  const ui = createUiLock();
  await assert.rejects(
    ui.withLock(async () => {
      throw new Error("ui boom");
    }),
    /ui boom/
  );
  assert.equal(ui.isHeld(), false);
  assert.equal(ui.release(), false);

  const result = await ui.withLock(async () => 42);
  assert.equal(result, 42);
  assert.equal(ui.isHeld(), false);
});
