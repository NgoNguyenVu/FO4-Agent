// Spend guard — hard cap chi tiêu theo run/ngày/tuần + reservation (TASK-003, Stage A).
//
// Nguyên tắc an toàn:
// - Cap `0` hoặc thiếu = fail closed (không cho chi đồng nào).
// - `assertCanSpend`/`reserve` là hàm đồng bộ: hai lượt reserve trong cùng tick
//   không thể cùng vượt cap (JS single-thread + kiểm tra atomic trong bộ nhớ).
// - Reservation `unknown` (timeout, không rõ bot đã nhận đơn) giữ tiền in-flight
//   và chặn mọi reservation mới cho tới khi human reconcile.
// - Stage A chỉ cung cấp module + config + snapshot. Chưa nối vào buy/icon/upgrade
//   để không đổi hành vi giao dịch thật khi chưa có Owner Decision.
const DEFAULT_FEATURES = ["buy", "upgrade", "icon"];

function isoWeekKey(ms) {
  const date = new Date(ms);
  const day = (date.getUTCDay() + 6) % 7; // Thứ 2 = 0
  date.setUTCDate(date.getUTCDate() - day + 3); // Thứ 5 của tuần ISO
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((date - firstThursday) / (7 * 86_400_000));
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function requireNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`spendLimits.${name} phải là số nguyên >= 0.`);
  }
}

function validateSpendLimits(limits = {}) {
  if (typeof limits !== "object" || limits === null) {
    throw new Error("spendLimits phải là object.");
  }
  if ("enabled" in limits && typeof limits.enabled !== "boolean") {
    throw new Error("spendLimits.enabled phải là true/false.");
  }
  for (const key of ["perRunBP", "perDayBP", "perWeekBP"]) {
    if (limits[key] !== undefined) requireNonNegativeInteger(limits[key], key);
  }
  if (limits.perFeatureBP !== undefined) {
    if (typeof limits.perFeatureBP !== "object" || limits.perFeatureBP === null) {
      throw new Error("spendLimits.perFeatureBP phải là object.");
    }
    for (const [feature, value] of Object.entries(limits.perFeatureBP)) {
      requireNonNegativeInteger(value, `perFeatureBP.${feature}`);
    }
  }
  if (
    limits.enabled === true &&
    !(limits.perRunBP > 0) &&
    !(limits.perDayBP > 0) &&
    !(limits.perWeekBP > 0)
  ) {
    throw new Error(
      "spendLimits đã bật nhưng chưa đặt cap nào > 0; cấu hình sẽ chặn mọi giao dịch."
    );
  }
  return true;
}

// Live gate thuần: trả lý do từ chối đầu tiên (fail closed).
function checkLiveGate({
  liveTrading = {},
  env = process.env,
  flagLive = false,
  profile = null,
  confirmed = false
} = {}) {
  if (liveTrading.enabled !== true) return { allowed: false, reason: "liveTrading.disabled" };
  if (String(env.FO4_LIVE_TRADING || "").toUpperCase() !== "YES") {
    return { allowed: false, reason: "env.FO4_LIVE_TRADING" };
  }
  if (flagLive !== true) return { allowed: false, reason: "flag.--live" };
  const allowedProfiles = Array.isArray(liveTrading.allowedProfiles)
    ? liveTrading.allowedProfiles
    : [];
  if (!profile || !allowedProfiles.includes(profile)) {
    return { allowed: false, reason: "profile.not-allowed" };
  }
  if (liveTrading.requireConfirmation === true && confirmed !== true) {
    return { allowed: false, reason: "confirmation.required" };
  }
  return { allowed: true, reason: "ok" };
}

function createSpendGuard({
  limits = {},
  liveTrading = {},
  now = () => Date.now(),
  log = () => {},
  logError = () => {},
  idPrefix = "res"
} = {}) {
  const features = new Set([
    ...DEFAULT_FEATURES,
    ...Object.keys(limits.perFeatureBP || {})
  ]);
  const perFeatureBP = { ...(limits.perFeatureBP || {}) };

  let halted = false;
  let haltReason = null;
  let sequence = 0;
  const reservations = new Map();
  const byIdempotencyKey = new Map();
  // runBP/dayBP/weekBP chỉ cộng khi reservation commit; reservation đang giữ
  // (reserved/unknown) được cộng riêng trong inFlightBP.
  let runCommittedBP = 0;
  const dayCommitted = new Map();
  const weekCommitted = new Map();
  const featureCommitted = new Map();
  const featureInFlight = new Map();

  function limitsForFeature(feature) {
    return Number(perFeatureBP[feature]) || 0;
  }

  function committedFor(feature, at) {
    return {
      run: runCommittedBP,
      day: dayCommitted.get(dayKey(at)) || 0,
      week: weekCommitted.get(isoWeekKey(at)) || 0,
      feature: featureCommitted.get(feature) || 0
    };
  }

  function inFlightFor(feature) {
    let total = 0;
    for (const reservation of reservations.values()) {
      if (reservation.feature !== feature) continue;
      if (reservation.status === "reserved" || reservation.status === "unknown") {
        total += reservation.amountBP;
      }
    }
    return total;
  }

  function assertCanSpend({ feature, amountBP, at = now() } = {}) {
    if (!features.has(feature)) {
      return { allowed: false, reason: "feature.unknown" };
    }
    if (!Number.isSafeInteger(amountBP) || amountBP <= 0) {
      return { allowed: false, reason: "amount.invalid" };
    }
    if (halted) {
      return { allowed: false, reason: "halted", detail: haltReason };
    }
    const unknown = [...reservations.values()].filter(
      (reservation) => reservation.status === "unknown"
    );
    if (unknown.length) {
      return {
        allowed: false,
        reason: "reservation.unknown",
        detail: unknown.map((reservation) => reservation.id)
      };
    }

    const committed = committedFor(feature, at);
    const inFlight = inFlightFor(feature);
    const projected = {
      run: committed.run + inFlight + amountBP,
      day: committed.day + inFlight + amountBP,
      week: committed.week + inFlight + amountBP,
      feature: committed.feature + inFlight + amountBP
    };
    const caps = {
      run: Number(limits.perRunBP) || 0,
      day: Number(limits.perDayBP) || 0,
      week: Number(limits.perWeekBP) || 0,
      feature: limitsForFeature(feature)
    };

    for (const window of ["run", "day", "week", "feature"]) {
      // Cap 0/thiếu = fail closed cho cửa sổ đó.
      if (projected[window] > caps[window]) {
        return {
          allowed: false,
          reason: `cap.${window}`,
          detail: {
            window,
            amountBP,
            projectedBP: projected[window],
            capBP: caps[window]
          }
        };
      }
    }
    return {
      allowed: true,
      reason: "ok",
      remaining: {
        run: caps.run - projected.run,
        day: caps.day - projected.day,
        week: caps.week - projected.week,
        feature: caps.feature - projected.feature
      }
    };
  }

  function reserve({ feature, amountBP, idempotencyKey = null, context = {} } = {}) {
    if (idempotencyKey && byIdempotencyKey.has(idempotencyKey)) {
      return { ...reservations.get(byIdempotencyKey.get(idempotencyKey)) };
    }
    const decision = assertCanSpend({ feature, amountBP });
    if (!decision.allowed) {
      const error = new Error(
        `Không được chi ${amountBP} BP cho ${feature}: ${decision.reason}`
      );
      error.code =
        decision.reason === "halted" ? "SPEND_HALTED" : "SPEND_CAP_EXCEEDED";
      error.decision = decision;
      throw error;
    }
    sequence += 1;
    const reservation = {
      id: `${idPrefix}-${sequence}`,
      feature,
      amountBP,
      idempotencyKey,
      context,
      status: "reserved",
      createdAt: new Date(now()).toISOString()
    };
    reservations.set(reservation.id, reservation);
    if (idempotencyKey) byIdempotencyKey.set(idempotencyKey, reservation.id);
    featureInFlight.set(feature, inFlightFor(feature));
    log(`Giữ chỗ ${amountBP} BP cho ${feature} (${reservation.id}).`);
    return { ...reservation };
  }

  function commit(reservationId, { orderId = null } = {}) {
    const reservation = reservations.get(reservationId);
    if (!reservation) {
      const error = new Error(`Không tìm thấy reservation ${reservationId}.`);
      error.code = "RESERVATION_NOT_FOUND";
      throw error;
    }
    if (reservation.status === "committed") return { ...reservation };
    if (reservation.status === "released") {
      const error = new Error(`Reservation ${reservationId} đã release, không commit được.`);
      error.code = "RESERVATION_RELEASED";
      throw error;
    }
    reservation.status = "committed";
    reservation.orderId = orderId;
    reservation.committedAt = new Date(now()).toISOString();

    const at = now();
    runCommittedBP += reservation.amountBP;
    const day = dayKey(at);
    dayCommitted.set(day, (dayCommitted.get(day) || 0) + reservation.amountBP);
    const week = isoWeekKey(at);
    weekCommitted.set(week, (weekCommitted.get(week) || 0) + reservation.amountBP);
    featureCommitted.set(
      reservation.feature,
      (featureCommitted.get(reservation.feature) || 0) + reservation.amountBP
    );
    featureInFlight.set(reservation.feature, inFlightFor(reservation.feature));
    return { ...reservation };
  }

  function release(reservationId, reason = "released") {
    const reservation = reservations.get(reservationId);
    if (!reservation) {
      const error = new Error(`Không tìm thấy reservation ${reservationId}.`);
      error.code = "RESERVATION_NOT_FOUND";
      throw error;
    }
    if (reservation.status === "committed") {
      const error = new Error(`Reservation ${reservationId} đã commit, không release được.`);
      error.code = "RESERVATION_COMMITTED";
      throw error;
    }
    reservation.status = "released";
    reservation.releaseReason = reason;
    reservation.releasedAt = new Date(now()).toISOString();
    featureInFlight.set(reservation.feature, inFlightFor(reservation.feature));
    return { ...reservation };
  }

  function markUnknown(reservationId, reason = "timeout") {
    const reservation = reservations.get(reservationId);
    if (!reservation) {
      const error = new Error(`Không tìm thấy reservation ${reservationId}.`);
      error.code = "RESERVATION_NOT_FOUND";
      throw error;
    }
    if (reservation.status === "committed" || reservation.status === "released") {
      return { ...reservation };
    }
    reservation.status = "unknown";
    reservation.unknownReason = reason;
    logError(
      `Reservation ${reservationId} (${reservation.amountBP} BP) ở trạng thái unknown; ` +
        "chặn giao dịch mới tới khi con người đối soát."
    );
    return { ...reservation };
  }

  function halt(reason = "halted") {
    halted = true;
    haltReason = reason;
    logError(`Kill switch bật: ${reason}. Không nhận giao dịch mới.`);
    return getSnapshot();
  }

  function reset(reason = "manual-reset") {
    halted = false;
    haltReason = null;
    log(`Spend guard reset (${reason}).`);
    return getSnapshot();
  }

  function getSnapshot() {
    const at = now();
    const committed = {
      runBP: runCommittedBP,
      dayBP: dayCommitted.get(dayKey(at)) || 0,
      weekBP: weekCommitted.get(isoWeekKey(at)) || 0,
      byFeatureBP: Object.fromEntries(
        [...features].map((feature) => [feature, featureCommitted.get(feature) || 0])
      )
    };
    const inFlight = Object.fromEntries(
      [...features].map((feature) => [feature, inFlightFor(feature)])
    );
    const inFlightBP = Object.values(inFlight).reduce((sum, value) => sum + value, 0);
    return {
      halted,
      haltReason,
      limits: {
        perRunBP: Number(limits.perRunBP) || 0,
        perDayBP: Number(limits.perDayBP) || 0,
        perWeekBP: Number(limits.perWeekBP) || 0,
        perFeatureBP: { ...perFeatureBP }
      },
      committed,
      inFlightBP,
      inFlightByFeature: inFlight,
      reservations: [...reservations.values()].map((reservation) => ({ ...reservation }))
    };
  }

  return {
    assertCanSpend,
    reserve,
    commit,
    release,
    markUnknown,
    halt,
    reset,
    getSnapshot,
    isoWeekKey: (ms = now()) => isoWeekKey(ms),
    dayKey: (ms = now()) => dayKey(ms)
  };
}

module.exports = {
  DEFAULT_FEATURES,
  isoWeekKey,
  dayKey,
  validateSpendLimits,
  checkLiveGate,
  createSpendGuard
};
