const test = require("node:test");
const assert = require("node:assert/strict");
const {
  guardTokenFor,
  isMainSeason,
  isAllowedMain,
  isSameTierBait,
  requiredProbability,
  localStatisticalHeuristic,
  finalizeDecision
} = require("./bait-decision");

const spec = {
  main: { seasons: ["ICON"], playerIds: ["pid-main"], minGrade: 1, maxGrade: 13 },
  bait: { seasons: ["TOTS"] },
  minFillRatio: 0.92,
  safety: { minRandomForMain: 70, maxBaitPerRound: 2, dryRun: false }
};

const ui = {
  ready: true,
  targetId: "pid-main",
  grade: 5,
  threshold: 712,
  maxRate: 26,
  candidate: { id: "pid-main", season: "ICON", grade: 5 },
  materialsCount: 0,
  capacity: 5,
  history: []
};

function ai(decision, extra = {}) {
  return {
    decision,
    randomPrediction: 300,
    confidence: 0.8,
    reason: "test",
    phoiToAdd: { bait: decision === "BAIT" ? 1 : 0, main: decision === "MAIN" ? 5 : 0 },
    useSoiCau: false,
    ...extra
  };
}

test("season helpers classify main vs same-tier bait", () => {
  assert.equal(isMainSeason({ season: "ICON" }, spec), true);
  assert.equal(isMainSeason({ season: "TOTS" }, spec), false);
  assert.equal(isAllowedMain({ id: "pid-main", season: "ICON", grade: 5 }, spec), true);
  assert.equal(isAllowedMain({ id: "pid-other", season: "ICON", grade: 5 }, spec), false);
  assert.equal(isSameTierBait({ season: "TOTS", grade: 5 }, 5, spec), true);
  assert.equal(isSameTierBait({ season: "ICON", grade: 5 }, 5, spec), false);
  assert.equal(isSameTierBait({ season: "TOTS", grade: 4 }, 5, spec), false);
});

test("relative threshold and guard token are deterministic", () => {
  assert.equal(requiredProbability(ui, spec), 26 * 0.92);
  assert.equal(guardTokenFor(ui), guardTokenFor({ ...ui }));
  assert.notEqual(guardTokenFor(ui), guardTokenFor({ ...ui, threshold: 700 }));
});

test("hard block prevents MAIN with main-season bait or low random", () => {
  const baitRound = finalizeDecision(ai("MAIN", { phoiToAdd: { bait: 2, main: 1 } }), {
    ...ui,
    candidate: { season: "TOTS", grade: 5 }
  }, spec);
  assert.equal(baitRound.blocked, true);
  assert.equal(baitRound.reason, "main-season-mismatch");

  const predictedFail = finalizeDecision(ai("MAIN", { randomPrediction: 800 }), ui, spec);
  assert.equal(predictedFail.blocked, true);
  assert.equal(predictedFail.reason, "predicted-fail");

  const belowFill = finalizeDecision(ai("MAIN"), { ...ui, estimatedProbability: 10 }, spec);
  assert.equal(belowFill.reason, "probability-below-min-fill");
});

test("BAIT approves same-tier non-main card only", () => {
  const decision = finalizeDecision(ai("BAIT"), {
    ...ui,
    candidate: { season: "TOTS", grade: 5 }
  }, spec);
  assert.equal(decision.decision, "BAIT");
  assert.equal(decision.blocked, false);
  assert.ok(decision.guardToken);
});

test("missing phoi, thin market and missing same-tier bait all HOLD", () => {
  const emptyBait = finalizeDecision(ai("BAIT", { phoiToAdd: { bait: 0, main: 0 } }), {
    ...ui,
    candidate: { season: "TOTS", grade: 5 }
  }, spec);
  assert.equal(emptyBait.reason, "bait-round-without-phoi");

  const emptyMain = finalizeDecision(ai("MAIN", { phoiToAdd: { bait: 0, main: 0 } }), ui, spec);
  assert.equal(emptyMain.reason, "main-round-without-phoi");

  assert.equal(
    finalizeDecision(ai("MAIN"), { ...ui, marketFloorAvailable: false }, spec).reason,
    "no-liquid-phoi"
  );
  assert.equal(
    finalizeDecision(ai("BAIT"), { ...ui, candidate: { season: "TOTS", grade: 4 } }, spec).reason,
    "bait-not-same-tier"
  );
  assert.equal(
    finalizeDecision(ai("BAIT"), { ...ui, noSameTierBait: true, candidate: { season: "TOTS", grade: 5 } }, spec).reason,
    "no-same-tier-bait"
  );
});

test("local heuristic is a safe fallback", () => {
  const fallback = localStatisticalHeuristic({ ui: { history: [], threshold: 500 } });
  assert.ok(["BAIT", "MAIN"].includes(fallback.decision));
  assert.equal(fallback.riskFlags[0], "no-ai-model");
  assert.equal(finalizeDecision(null, ui, spec).blocked, false);
});
