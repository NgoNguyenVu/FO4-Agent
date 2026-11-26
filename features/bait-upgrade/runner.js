// Điều phối 1 nhịp "Nâng Cấp Cầu Thủ" (BAIT/MAIN/HOLD).
"use strict";

const { log } = require("../agent-log");
const { finalizeDecision } = require("../../lib/bait-decision");
const { combineProbabilities } = require("../../lib/phoi-solver");
const {
  openBaitFrame,
  readBaitUi,
  clickBaitButton,
  readPlayerCards,
  selectPlayerCard,
  addBaitMaterial,
  clickSoiCau,
  clickBaitUpgrade,
  BAIT_LABEL_BUTTONS
} = require("./mini-app");
const { parseBaitPlayerCards } = require("./patterns");

const AI_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["decision", "randomPrediction", "confidence", "reason", "phoiToAdd", "useSoiCau"],
  properties: {
    decision: { enum: ["BAIT", "MAIN", "HOLD"] },
    randomPrediction: { type: "number", minimum: 0 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string", maxLength: 240 },
    phoiToAdd: {
      type: "object",
      additionalProperties: false,
      required: ["bait", "main"],
      properties: {
        bait: { type: "integer", minimum: 0, maximum: 5 },
        main: { type: "integer", minimum: 0, maximum: 5 }
      }
    },
    useSoiCau: { type: "boolean" },
    riskFlags: { type: "array", items: { type: "string" } }
  }
});

function chooseCandidate(cards, ui, spec, decision) {
  const mainNames = (spec.main?.playerIds || []).map((name) => String(name).toLowerCase());
  const grade = Number(ui.grade ?? (cards[0] && cards[0].grade));
  if (decision === "MAIN") {
    const main = cards.find(
      (card) =>
        Number(card.grade) === grade &&
        (mainNames.length === 0 || mainNames.includes(String(card.name).toLowerCase()))
    );
    if (main) return { ...main, season: (spec.main.seasons || [])[0] || "" };
    return null;
  }
  const bait = cards.find(
    (card) =>
      Number(card.grade) === grade &&
      !mainNames.includes(String(card.name).toLowerCase()) &&
      !/Không xác định/i.test(String(card.name))
  );
  if (bait) return { ...bait, season: (spec.bait.seasons || [])[0] || "" };
  return null;
}

async function waitForRoundResult(frame, baseline, timeoutMs, targetGrade = 7) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ui = await readBaitUi(frame, Number(targetGrade || 7));
    if (ui.history.length > baseline.history.length) {
      return {
        status: "completed",
        last: ui.history.at(-1),
        added: ui.history.slice(baseline.history.length)
      };
    }
    await frame.page().waitForTimeout(500);
  }
  return { status: "timeout" };
}

async function runBaitRound({
  page,
  rl,
  ui: uiLock = null,
  spec,
  aiClient,
  solveCombo = null,
  logFn = log,
  timeoutMs = null
} = {}) {
  const withUi = (fn) => (uiLock ? uiLock.withLock(fn) : fn());
  const frame = await withUi(() => openBaitFrame(page, rl));
  try {
    const initial = await readBaitUi(frame, Number(spec.targetGrade || 7));
    if (!initial.ready) return { action: "ui-not-ready", ui: initial };

    const payload = {
      ui: initial,
      spec: {
        main: spec.main,
        bait: spec.bait,
        safety: spec.safety,
        minFillRatio: spec.minFillRatio
      }
    };
    const ai = await aiClient.askJson(payload, AI_SCHEMA);
    logFn(
      `AI đề xuất ${ai.decision} (${ai._model}); random dự kiến ${ai.randomPrediction}; ` +
        `confidence ${ai.confidence}.`
    );

    // Chọn thẻ: cùng bậc cộng. Đây là thao tác UI nhưng KHÔNG tiêu thụ tài nguyên.
    await withUi(() => clickBaitButton(frame, BAIT_LABEL_BUTTONS.chooseMain));
    const cards = parseBaitPlayerCards(await readPlayerCards(frame));
    const candidate = chooseCandidate(cards, initial, spec, ai.decision);
    if (!candidate) return { action: "hold", reason: "no-same-tier-candidate" };
    await withUi(() => selectPlayerCard(frame, candidate.name));

    const ui = await readBaitUi(frame, Number(spec.targetGrade || 7));
    const snapshot = {
      targetId: candidate.name,
      grade: candidate.grade,
      threshold: ui.threshold,
      maxRate: ui.maxRate ?? 100,
      selectedMain: ai.decision === "MAIN" ? 1 : 0,
      selectedBait: ai.decision === "BAIT" ? 1 : 0,
      materialsCount: ui.materialsCount,
      history: ui.history,
      candidate,
      capacity: ui.capacity,
      estimatedProbability:
        ai.decision === "MAIN"
          ? solveCombo
            ? (solveCombo({ curOvr: candidate.ovr, grade: candidate.grade }) || {}).realProb
            : combineProbabilities(
                Array(Math.min(5, Number(spec.maxMaterials || 5))).fill(
                  Number(candidate.ovr) - 2
                ),
                candidate.grade,
                ui.maxRate ?? 100
              ).realProb
          : null
    };
    const decision = finalizeDecision(ai, snapshot, spec);
    if (decision.blocked) {
      logFn(`Chốt chặn an toàn: ${decision.reason}; KHÔNG bấm Nâng cấp.`);
      return { action: "hold", reason: decision.reason, decision };
    }

    if (ai.useSoiCau && spec.safety?.allowSoiCau !== false) {
      const clicks = Math.min(Number(spec.safety?.maxSoiCauClicksPerRound ?? 3), 3);
      for (let i = 0; i < clicks; i += 1) {
        await withUi(() => clickSoiCau(frame, "both"));
      }
    }
    const addCount = Math.max(1, Number(decision.phoiToAdd.main || decision.phoiToAdd.bait || 1));
    await withUi(() => addBaitMaterial(frame, addCount));

    const beforeClick = await readBaitUi(frame, Number(spec.targetGrade || 7));
    if (
      beforeClick.threshold !== ui.threshold ||
      beforeClick.materialsCount === null ||
      beforeClick.history.length !== ui.history.length
    ) {
      logFn("UI thay đổi sau khi thêm phôi; guardToken không khớp, KHÔNG bấm Nâng cấp.");
      return { action: "hold", reason: "guard-token-mismatch" };
    }
    await withUi(() => clickBaitUpgrade(frame));
    const outcome = await waitForRoundResult(
      frame,
      ui,
      timeoutMs || spec.timing?.roundTimeoutMs || 60_000,
      spec.targetGrade
    );
    return { action: "upgraded", decision, outcome };
  } finally {
    await withUi(() => page.locator("iframe.payment-verification").count().catch(() => 0));
  }
}

module.exports = { AI_SCHEMA, runBaitRound, chooseCandidate };
