const test = require("node:test");
const assert = require("node:assert/strict");
const { createIconSession } = require("./icon-session");

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeSession(overrides = {}) {
  const events = [];
  const errors = [];
  const results = [];
  const session = createIconSession({
    runIconBuy: async () => ({ action: "limit", batches: 1, purchased: 1, canceled: 0 }),
    log: (message) => events.push(message),
    logError: (message) => errors.push(message),
    onResult: (result) => results.push(result),
    ...overrides
  });
  return { session, events, errors, results };
}

test("icon session starts in the background and rejects a duplicate run", async () => {
  let release;
  let capturedOptions = null;
  const { session, results } = makeSession({
    runIconBuy: (_page, _rl, options) => {
      capturedOptions = options;
      return new Promise((resolve) => {
        release = resolve;
      });
    }
  });

  const first = session.start("page", "rl");
  assert.equal(first.started, true);
  await tick();
  assert.equal(typeof capturedOptions.isStopRequested, "function");
  assert.equal(capturedOptions.ui, null);

  const duplicate = session.start("page", "rl");
  assert.equal(duplicate.started, false);
  assert.equal(duplicate.reason, "busy");
  assert.equal(session.isActive(), true);

  release({ action: "limit", batches: 1, purchased: 1, canceled: 0 });
  await first.task.promise;
  assert.deepEqual(results, [{ action: "limit", batches: 1, purchased: 1, canceled: 0 }]);
  assert.equal(session.isActive(), false);
});

test("aborting an icon session flips its stop signal and suppresses the result log", async () => {
  let release;
  let capturedOptions = null;
  const { session, results } = makeSession({
    runIconBuy: (_page, _rl, options) => {
      capturedOptions = options;
      return new Promise((resolve) => {
        release = resolve;
      });
    }
  });

  const started = session.start("page", "rl");
  await tick();
  assert.equal(capturedOptions.isStopRequested(), false);
  assert.equal(session.abort("/stopagent"), true);
  assert.equal(capturedOptions.isStopRequested(), true);

  release({ action: "stop", batches: 0, purchased: 0, canceled: 0 });
  await started.task.promise;
  assert.deepEqual(results, []);
  assert.equal(session.isActive(), false);
});

test("icon session stopAndWait waits for the active one-shot to finish", async () => {
  let release;
  const { session } = makeSession({
    runIconBuy: () =>
      new Promise((resolve) => {
        release = resolve;
      })
  });

  const started = session.start("page", "rl");
  await tick();
  let settled = false;
  const waiting = session.stopAndWait("/resetagent", 1_000).then((value) => {
    settled = true;
    return value;
  });
  await tick();
  assert.equal(settled, false);

  release({ action: "limit", batches: 1, purchased: 1, canceled: 0 });
  assert.equal(await waiting, true);
  await started.task.promise;
});

test("icon session logs task errors without crashing the controller", async () => {
  const { session, errors, results } = makeSession({
    runIconBuy: async () => {
      throw new Error("boom");
    }
  });

  const started = session.start("page", "rl");
  const result = await started.task.promise;
  assert.equal(result, null);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /boom/);
  assert.deepEqual(results, []);
});
