// Lớp quyết định BAIT/MAIN/HOLD. AI chỉ đề xuất; code phê duyệt.
// Mọi field nhạy感 (chatId/token/path) đã được redact trước khi tới đây.
"use strict";

function guardTokenFor(snapshot) {
  const raw = [
    snapshot?.targetId || "",
    snapshot?.grade ?? "",
    snapshot?.threshold ?? "",
    snapshot?.selectedMain ?? "",
    snapshot?.selectedBait ?? "",
    snapshot?.materialsCount ?? "",
    (snapshot?.history || []).map((h) => `${h.random}:${h.newGrade}`).join("|")
  ].join("|");
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function isMainSeason(card, spec) {
  const season = String(card?.season || "");
  const seasons = (spec?.main?.seasons || []).map((s) => String(s).toLowerCase());
  return seasons.includes(season.toLowerCase());
}

function isAllowedMain(card, spec) {
  if (!isMainSeason(card, spec)) return false;
  const ids = (spec?.main?.playerIds || []).map(String);
  if (ids.length && !ids.includes(String(card?.id || card?.code || ""))) return false;
  const grade = Number(card?.grade);
  if (
    Number.isFinite(grade) &&
    ((spec?.main?.minGrade != null && grade < spec.main.minGrade) ||
      (spec?.main?.maxGrade != null && grade > spec.main.maxGrade))
  ) {
    return false;
  }
  return true;
}

// BAIT: cùng bậc cộng với thẻ chính, NHƯNG không được thuộc main.seasons.
function isSameTierBait(card, uiGrade, spec) {
  if (isMainSeason(card, spec)) return false;
  if ((spec?.bait?.seasons || []).length) {
    const allowed = spec.bait.seasons.map((s) => String(s).toLowerCase());
    if (!allowed.includes(String(card?.season || "").toLowerCase())) return false;
  }
  return Number(card?.grade) === Number(uiGrade);
}

function requiredProbability(ui, spec) {
  const maxRate = Number(ui.maxRate);
  if (!Number.isFinite(maxRate) || maxRate <= 0) return null;
  const ratio = Number(spec?.minFillRatio ?? 0.92);
  return maxRate * Math.min(1, Math.max(0, ratio));
}

function localStatisticalHeuristic(payload) {
  const ui = payload?.ui || {};
  const history = Array.isArray(ui.history) ? ui.history : [];
  const threshold = Number(ui.threshold) || 0;
  const recent = history.slice(-5);
  const below = recent.filter((h) => Number(h.random) < threshold).length;
  // Nhịp gần đây thắng nhiều → cầu đang "cao", thử MAIN; ngược lại thả BAIT.
  const decision = threshold > 0 && below >= Math.ceil(recent.length / 2) ? "MAIN" : "BAIT";
  return {
    decision,
    randomPrediction: recent.length
      ? Math.round(recent.reduce((sum, h) => sum + Number(h.random || 0), 0) / recent.length)
      : Math.round(threshold * 0.8),
    confidence: recent.length ? Math.min(0.6, recent.length / 10) : 0.2,
    reason: "local-statistical-heuristic",
    phoiToAdd: { bait: decision === "BAIT" ? 1 : 0, main: decision === "MAIN" ? 5 : 0 },
    useSoiCau: false,
    riskFlags: ["no-ai-model"]
  };
}

function isValidAiSchema(ai) {
  if (!ai || typeof ai !== "object") return false;
  if (!["BAIT", "MAIN", "HOLD"].includes(ai.decision)) return false;
  if (!ai.phoiToAdd || typeof ai.phoiToAdd !== "object") return false;
  return Number.isFinite(Number(ai.randomPrediction)) && Number.isFinite(Number(ai.confidence));
}

function finalizeDecision(aiInput, ui, spec) {
  const ai = isValidAiSchema(aiInput)
    ? aiInput
    : localStatisticalHeuristic({ ui, spec });
  const blocked = (reason) => ({
    decision: "HOLD",
    reason,
    guardToken: guardTokenFor(ui),
    blocked: true,
    phoiToAdd: { bait: 0, main: 0 }
  });

  if (!ui || !ui.ready || !ui.targetId || !Number.isFinite(Number(ui.threshold))) {
    return blocked("ui-unreadable");
  }
  const required = requiredProbability(ui, spec);
  if (required == null) return blocked("max-rate-unknown");

  const baitCount = Math.max(0, Number(ai.phoiToAdd.bait) || 0);
  const mainCount = Math.max(0, Number(ai.phoiToAdd.main) || 0);
  const capacity = Math.max(0, Number(ui.capacity ?? 5) || 5);
  if (baitCount + mainCount + Number(ui.materialsCount || 0) > capacity) {
    return blocked("capacity-exceeded");
  }
  if (baitCount > Number(spec?.safety?.maxBaitPerRound ?? 2)) {
    return blocked("too-much-bait");
  }
  // Hết phôi có thanh khoản hoặc UI chưa read xong → HOLD, không bấm nâng.
  if (ui.marketFloorAvailable === false) return blocked("no-liquid-phoi");
  if (ui.noSameTierBait === true) return blocked("no-same-tier-bait");

  if (ai.decision === "HOLD") {
    return { ...blocked(ai.reason || "ai-hold"), blocked: true };
  }

  if (ai.decision === "BAIT") {
    if (mainCount > 0) return blocked("main-card-in-bait-round");
    if (baitCount < 1) return blocked("bait-round-without-phoi");
    if (!isSameTierBait(ui.candidate, Number(ui.grade), spec)) {
      return blocked("bait-not-same-tier");
    }
    if (isMainSeason(ui.candidate, spec)) return blocked("main-season-in-bait-round");
    return {
      decision: "BAIT",
      reason: ai.reason,
      guardToken: guardTokenFor(ui),
      phoiToAdd: { bait: baitCount, main: 0 },
      blocked: false
    };
  }

  // MAIN
  if (mainCount < 1) return blocked("main-round-without-phoi");
  if (!isAllowedMain(ui.candidate, spec)) return blocked("main-season-mismatch");
  if (Number(ai.randomPrediction) >= Number(ui.threshold)) return blocked("predicted-fail");
  if (Number(ui.threshold) < Number(spec?.safety?.minRandomForMain ?? 0)) {
    return blocked("threshold-below-floor");
  }
  if (ui.estimatedProbability != null && Number(ui.estimatedProbability) < required) {
    return blocked("probability-below-min-fill");
  }
  if (Number(spec?.safety?.dryRun) === true) {
    return blocked("dry-run");
  }
  return {
    decision: "MAIN",
    reason: ai.reason,
    guardToken: guardTokenFor(ui),
    phoiToAdd: { bait: baitCount, main: mainCount },
    blocked: false
  };
}

module.exports = {
  guardTokenFor,
  isMainSeason,
  isAllowedMain,
  isSameTierBait,
  requiredProbability,
  localStatisticalHeuristic,
  isValidAiSchema,
  finalizeDecision
};
