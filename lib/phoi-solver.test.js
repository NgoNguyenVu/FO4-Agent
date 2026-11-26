const test = require("node:test");
const assert = require("node:assert/strict");
const {
  maxRateForGrade,
  rateForGrade,
  probabilityForMaterial,
  combineProbabilities,
  solveCheapestCombo,
  normalizeOpenRouter
} = require("./phoi-solver");

test("grade caps and per-slot probability match the FIFAaddict oracle samples", () => {
  assert.equal(maxRateForGrade(7), 7);
  assert.equal(rateForGrade(1), 50);
  assert.equal(rateForGrade(2), 100 / 3);
  assert.equal(rateForGrade(7), 20);
  assert.equal(Math.round(probabilityForMaterial(126, 126, 1)), 50);
  assert.equal(Math.round(probabilityForMaterial(120, 126, 1)), 8);
  assert.equal(
    Math.round(combineProbabilities([120, 120, 120, 120, 120], 126, 1, 100).realProb),
    42
  );
});

test("solver finds the cheapest combo above the relative fill threshold", () => {
  const candidates = [
    { id: "cheap", ovr: 112, priceBP: 100 },
    { id: "mid", ovr: 120, priceBP: 400 },
    { id: "good", ovr: 126, priceBP: 900 }
  ];
  const best = solveCheapestCombo({
    candidates,
    curOvr: 126,
    grade: 1,
    maxRate: 100,
    minFillRatio: 0.5
  });
  assert.ok(best);
  assert.equal(best.phoi.length, 1);
  assert.equal(best.phoi[0].id, "good");
  assert.equal(best.costBP, 900);
  assert.equal(
    solveCheapestCombo({ candidates: [], curOvr: 126, grade: 1, maxRate: 7, minFillRatio: 0.92 }),
    null
  );
});

test("module does not import OpenRouter helper by mistake", () => {
  assert.equal(typeof normalizeOpenRouter, "undefined");
});
