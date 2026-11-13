const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createSpendGuard,
  validateSpendLimits,
  checkLiveGate,
  isoWeekKey,
  dayKey
} = require("./spend-guard");

const BASE_LIMITS = {
  enabled: true,
  perRunBP: 1_000,
  perDayBP: 5_000,
  perWeekBP: 10_000,
  perFeatureBP: { buy: 1_000, upgrade: 2_000, icon: 1_000 }
};

function guard(overrides = {}, limits = BASE_LIMITS) {
  return createSpendGuard({
    limits,
    now: () => Date.parse("2026-11-13T05:00:00Z"),
    log: () => {},
    logError: () => {},
    ...overrides
  });
}

test("validateSpendLimits accepts safe caps and rejects invalid/unsafe config", () => {
  assert.equal(validateSpendLimits(BASE_LIMITS), true);
  assert.equal(validateSpendLimits({}), true);

  assert.throws(() => validateSpendLimits({ perRunBP: -1 }), />= 0/);
  assert.throws(() => validateSpendLimits({ perDayBP: 1.5 }), /số nguyên/);
  assert.throws(() => validateSpendLimits({ enabled: "yes" }), /true\/false/);
  assert.throws(() => validateSpendLimits({ perFeatureBP: null }), /object/);
  assert.throws(
    () => validateSpendLimits({ enabled: true, perRunBP: 0, perDayBP: 0, perWeekBP: 0 }),
    /chưa đặt cap nào/
  );
});

test("checkLiveGate fails closed unless every condition holds", () => {
  const liveTrading = {
    enabled: true,
    requireConfirmation: true,
    allowedProfiles: ["fo4-live"]
  };
  const env = { FO4_LIVE_TRADING: "YES" };
  const ok = checkLiveGate({
    liveTrading,
    env,
    flagLive: true,
    profile: "fo4-live",
    confirmed: true
  });
  assert.deepEqual(ok, { allowed: true, reason: "ok" });

  assert.equal(checkLiveGate({ liveTrading: {}, env }).reason, "liveTrading.disabled");
  assert.equal(
    checkLiveGate({ liveTrading, env: {}, flagLive: true, profile: "fo4-live", confirmed: true })
      .reason,
    "env.FO4_LIVE_TRADING"
  );
  assert.equal(
    checkLiveGate({ liveTrading, env, flagLive: false, profile: "fo4-live", confirmed: true })
      .reason,
    "flag.--live"
  );
  assert.equal(
    checkLiveGate({ liveTrading, env, flagLive: true, profile: "other", confirmed: true })
      .reason,
    "profile.not-allowed"
  );
  assert.equal(
    checkLiveGate({ liveTrading, env, flagLive: true, profile: "fo4-live", confirmed: false })
      .reason,
    "confirmation.required"
  );
});

test("spend exactly at cap is allowed, one BP over is rejected", () => {
  const g = guard();
  assert.equal(g.assertCanSpend({ feature: "buy", amountBP: 1_000 }).allowed, true);
  const over = g.assertCanSpend({ feature: "buy", amountBP: 1_001 });
  assert.equal(over.allowed, false);
  assert.equal(over.reason, "cap.run");
  assert.equal(over.detail.capBP, 1_000);
});

test("zero or missing cap fails closed", () => {
  const zero = guard({}, { enabled: true, perRunBP: 0, perDayBP: 100, perWeekBP: 100, perFeatureBP: { buy: 100 } });
  assert.equal(zero.assertCanSpend({ feature: "buy", amountBP: 1 }).allowed, false);

  const missingFeature = guard({}, { enabled: true, perRunBP: 100, perDayBP: 100, perWeekBP: 100 });
  const decision = missingFeature.assertCanSpend({ feature: "buy", amountBP: 1 });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "cap.feature");
});

test("per-feature and cross-feature daily caps are enforced", () => {
  const g = guard({
    now: () => Date.parse("2026-11-13T05:00:00Z")
  }, {
    enabled: true,
    perRunBP: 10_000,
    perDayBP: 100,
    perWeekBP: 10_000,
    perFeatureBP: { buy: 100, icon: 100 }
  });
  const buy = g.reserve({ feature: "buy", amountBP: 60 });
  g.commit(buy.id);
  const icon = g.reserve({ feature: "icon", amountBP: 30 });
  g.commit(icon.id);

  const denied = g.assertCanSpend({ feature: "icon", amountBP: 20 });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, "cap.day");

  const featureCapped = guard({}, {
    enabled: true,
    perRunBP: 10_000,
    perDayBP: 10_000,
    perWeekBP: 10_000,
    perFeatureBP: { buy: 50 }
  });
  assert.equal(featureCapped.assertCanSpend({ feature: "buy", amountBP: 51 }).reason, "cap.feature");
});

test("reserve then release does not count toward spend", () => {
  const g = guard();
  const reservation = g.reserve({ feature: "buy", amountBP: 900 });
  assert.equal(g.getSnapshot().inFlightBP, 900);
  g.release(reservation.id, "order-rejected");
  const snapshot = g.getSnapshot();
  assert.equal(snapshot.inFlightBP, 0);
  assert.equal(snapshot.committed.runBP, 0);
  assert.equal(g.assertCanSpend({ feature: "buy", amountBP: 1_000 }).allowed, true);
});

test("reserve then commit counts exactly once (commit is idempotent)", () => {
  const g = guard();
  const reservation = g.reserve({ feature: "upgrade", amountBP: 500 });
  g.commit(reservation.id, { orderId: "o-1" });
  g.commit(reservation.id, { orderId: "o-1" });
  const snapshot = g.getSnapshot();
  assert.equal(snapshot.committed.runBP, 500);
  assert.equal(snapshot.committed.byFeatureBP.upgrade, 500);
  assert.equal(snapshot.inFlightBP, 0);
});

test("unknown reservation keeps BP in flight and blocks new purchases", () => {
  const g = guard();
  const reservation = g.reserve({ feature: "buy", amountBP: 400 });
  g.markUnknown(reservation.id, "timeout");

  const decision = g.assertCanSpend({ feature: "upgrade", amountBP: 1 });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "reservation.unknown");
  assert.deepEqual(decision.detail, [reservation.id]);
  assert.equal(g.getSnapshot().inFlightBP, 400);
});

test("two concurrent reservations near the cap: only one is accepted", () => {
  const g = guard({}, {
    enabled: true,
    perRunBP: 100,
    perDayBP: 100,
    perWeekBP: 100,
    perFeatureBP: { buy: 100 }
  });
  const first = g.reserve({ feature: "buy", amountBP: 60 });
  assert.throws(
    () => g.reserve({ feature: "buy", amountBP: 60 }),
    (error) => error.code === "SPEND_CAP_EXCEEDED"
  );
  g.release(first.id);
});

test("halt stops all spending until manual reset", () => {
  const g = guard();
  g.halt("daily-cap");
  const denied = g.assertCanSpend({ feature: "buy", amountBP: 1 });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, "halted");
  assert.throws(
    () => g.reserve({ feature: "buy", amountBP: 1 }),
    (error) => error.code === "SPEND_HALTED"
  );
  g.reset("test");
  assert.equal(g.assertCanSpend({ feature: "buy", amountBP: 1 }).allowed, true);
});

test("idempotency key returns the same reservation", () => {
  const g = guard();
  const first = g.reserve({ feature: "icon", amountBP: 10, idempotencyKey: "batch-1" });
  const second = g.reserve({ feature: "icon", amountBP: 10, idempotencyKey: "batch-1" });
  assert.equal(second.id, first.id);
  assert.equal(g.getSnapshot().reservations.length, 1);
});

test("snapshot exposes committed, in-flight and remaining windows", () => {
  const g = guard();
  const reservation = g.reserve({ feature: "buy", amountBP: 250, context: { batch: 1 } });
  g.commit(reservation.id);
  const snapshot = g.getSnapshot();
  assert.equal(snapshot.halted, false);
  assert.equal(snapshot.committed.runBP, 250);
  assert.equal(snapshot.committed.dayBP, 250);
  assert.equal(snapshot.committed.weekBP, 250);
  assert.equal(snapshot.committed.byFeatureBP.buy, 250);
  assert.equal(snapshot.limits.perRunBP, 1_000);
});

test("ISO week and day keys use UTC", () => {
  assert.equal(dayKey(Date.parse("2026-11-13T23:59:00Z")), "2026-11-13");
  // Thứ 5 2026-01-01 thuộc tuần ISO 01 của năm 2026.
  assert.equal(isoWeekKey(Date.parse("2026-01-01T00:00:00Z")), "2026-W01");
  // 2027-01-01 là thứ 6 → thuộc tuần ISO cuối của 2026.
  assert.equal(isoWeekKey(Date.parse("2027-01-01T00:00:00Z")), "2026-W53");
});
