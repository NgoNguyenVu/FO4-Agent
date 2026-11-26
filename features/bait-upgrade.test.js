const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeUiText,
  isBaitMenuButton,
  hasRecentBaitMenu,
  parseHistory,
  parseBaitUi,
  parseBaitPlayerCards,
  verifyBaitSnapshot,
  AI_SCHEMA,
  chooseCandidate
} = require("./bait-upgrade");

const baitSpec = {
  main: { seasons: ["ICON"], playerIds: ["F. Beckenbauer"] },
  bait: { seasons: ["TOTS"] }
};

const SAMPLE = [
  "Nâng cấp cầu thủ",
  "Quay lại",
  "Chọn cầu thủ chính",
  "Tỉ lệ thành công: 0.00%",
  "Mốc Random: 712",
  "Nguyên liệu (0/5):",
  "Chưa chọn nguyên liệu",
  "+",
  "Nâng cấp",
  "Lịch sử Chỉ số Random và Mức Thẻ Mới",
  "366:3 747:2 142:6",
  "Chỉ số Random < Mốc Random = Nâng cấp thành công",
  "Soi cầu tự động"
].join("\n");

test("DOM calibration: menu button and menu detection use real labels", () => {
  assert.equal(isBaitMenuButton("\uf097\nNâng Cấp Cầu Thủ"), true);
  assert.equal(isBaitMenuButton("Auto Mua Phôi"), false);
  assert.equal(
    hasRecentBaitMenu("Bạn muốn sử dụng tính năng nào?\nAuto Mua Phôi\nNâng Cấp Cầu Thủ"),
    true
  );
  assert.equal(hasRecentBaitMenu("Nâng Cấp Cầu Thủ"), false);
});

test("UI parser reads threshold, materials, history and soi-cau", () => {
  const ui = parseBaitUi(SAMPLE, 7);
  assert.equal(ui.ready, true);
  assert.equal(ui.threshold, 712);
  assert.equal(ui.successRate, 0);
  assert.equal(ui.materialsCount, 0);
  assert.equal(ui.capacity, 5);
  assert.equal(ui.maxRate, 7);
  assert.equal(ui.hasSoiCau, true);
  assert.deepEqual(ui.history, [
    { random: 366, newGrade: 3 },
    { random: 747, newGrade: 2 },
    { random: 142, newGrade: 6 }
  ]);
  assert.equal(parseHistory("không có lịch sử").length, 0);
  assert.equal(normalizeUiText("A\u00a0B\uf097C"), "A B C");
});

test("player card parser reads same-tier candidates", () => {
  const cards = parseBaitPlayerCards(
    "Chọn cầu thủ chính\nF. Beckenbauer\n131\n6\n1.62B\nP. Lahm\n114\n8\n0B"
  );
  assert.equal(cards.length, 2);
  assert.deepEqual(
    cards.map((c) => [c.name, c.ovr, c.grade]),
    [["F. Beckenbauer", 131, 6], ["P. Lahm", 114, 8]]
  );
  assert.equal(cards[0].priceBP, 1_620_000_000);
});

test("runner picks same-tier MAIN/BAIT candidates and enforces AI schema", () => {
  const cards = [
    { name: "F. Beckenbauer", ovr: 131, grade: 6 },
    { name: "P. Lahm", ovr: 114, grade: 8 }
  ];
  const ui = { grade: 6 };
  const main = chooseCandidate(cards, ui, baitSpec, "MAIN");
  const bait = chooseCandidate(cards, { grade: 8 }, baitSpec, "BAIT");
  assert.equal(main.name, "F. Beckenbauer");
  assert.equal(main.season, "ICON");
  assert.equal(bait.name, "P. Lahm");
  assert.equal(bait.season, "TOTS");
  assert.equal(AI_SCHEMA.required.includes("decision"), true);
});

test("runner fails closed on AI HOLD, thin market and guard mismatch", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "bait-upgrade", "runner.js"), "utf8");
  assert.match(src, /if \(ai\.decision === "HOLD"\)/);
  assert.match(src, /no-liquid-phoi/);
  assert.match(src, /guardTokenFor\(snapshot\)/);
  assert.match(src, /guard-token-mismatch/);
  assert.match(src, /no-same-tier-candidate/);
});

test("snapshot token guard changes with threshold/history", () => {
  const snap = {
    targetId: "x", grade: 5, threshold: 712, selectedMain: 0, selectedBait: 1,
    materialsCount: 1, history: [{ random: 366, newGrade: 3 }]
  };
  const token = verifyBaitSnapshot(snap);
  assert.equal(verifyBaitSnapshot(snap, token), token);
  assert.throws(() => verifyBaitSnapshot({ ...snap, threshold: 713 }, token), /BAIT_SNAPSHOT_MISMATCH/);
});
