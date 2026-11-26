// Parser thuần cho màn hình "Nâng Cấp Cầu Thủ" (đã calibrate DOM thực tế).
"use strict";

const { RECENT_CHAT_TEXT_LENGTH, hasFeatureMenuSignature } = require("../../lib/bot-patterns");
const { guardTokenFor } = require("../../lib/bait-decision");
const { maxRateForGrade } = require("../../lib/phoi-solver");

const BAIT_MENU_LABEL = "Nâng Cấp Cầu Thủ";
// Nút menu có icon private-use + newline trước nhãn; match bằng mã Unicode để
// không phụ thuộc encoding của shell/terminal.
const BAIT_MENU_TAIL_CODE = 0x1ee7; // ủ

function normalizeUiText(text) {
  return String(text ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\ue000-\uf8ff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isBaitMenuButton(raw) {
  const text = normalizeUiText(raw);
  return text.length > 0 && text.charCodeAt(text.length - 1) === BAIT_MENU_TAIL_CODE && /Th/.test(text);
}

function hasRecentBaitMenu(text) {
  const recent = normalizeUiText(String(text || "").slice(-RECENT_CHAT_TEXT_LENGTH));
  return hasFeatureMenuSignature(recent, "nâng cấp cầu thủ");
}

function parseHistory(text) {
  const section = String(text || "").split("Lịch sử Chỉ số Random")[1] || "";
  const rows = [];
  for (const match of section.matchAll(/(\d{1,4})\s*:\s*(\d{1,2})/g)) {
    rows.push({ random: Number(match[1]), newGrade: Number(match[2]) });
  }
  return rows;
}

function parseBaitUi(text, targetGrade = 7) {
  const ui = normalizeUiText(text);
  const success = ui.match(/Tỉ lệ thành công\s*:\s*([\d.,]+)\s*%/i);
  const threshold = ui.match(/Mốc Random\s*:\s*(\d+)/i);
  const materials = ui.match(/Nguyên liệu\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)/i);
  const hasSoiCau = ui.includes("Soi cầu tự động");
  const history = parseHistory(text);
  return {
    ready: Boolean(success && threshold && materials && ui.includes("Chọn cầu thủ chính")),
    successRate: success ? Number(success[1].replace(",", ".")) : null,
    threshold: threshold ? Number(threshold[1]) : null,
    maxRate: maxRateForGrade(targetGrade),
    materialsCount: materials ? Number(materials[1]) : null,
    capacity: materials ? Number(materials[2]) : 5,
    history,
    hasSoiCau,
    canUpgrade: /Nâng cấp/.test(ui) && !/Chưa chọn nguyên liệu/.test(ui),
    raw: ui.slice(0, 600)
  };
}

// Danh sách thẻ sau khi bấm "Chọn cầu thủ chính": mỗi thẻ 3 dòng
// "Tên / OVR / bậc cộng / giá".
function parseBaitPlayerCards(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const out = [];
  for (let i = 0; i + 2 < lines.length; i += 1) {
    const ovr = Number(lines[i + 1]);
    const grade = Number(lines[i + 2]);
    if (!Number.isFinite(ovr) || ovr < 50 || ovr > 200) continue;
    if (!Number.isFinite(grade) || grade < 1 || grade > 15) continue;
    const priceRaw = lines[i + 3] || "0B";
    const multiplier = /B/i.test(priceRaw) ? 1e9 : /M/i.test(priceRaw) ? 1e6 : 1;
    const priceBP = Number(String(priceRaw).replace(/[^\d.,]/g, "").replace(/,/g, "")) * multiplier;
    out.push({
      name: lines[i],
      ovr,
      grade,
      priceBP: Number.isFinite(priceBP) ? priceBP : 0,
      season: null // điền bởi caller qua badge/DOM; mặc định không phải main
    });
  }
  return out;
}

function verifyBaitSnapshot(snapshot, expectedToken) {
  const token = guardTokenFor(snapshot);
  if (expectedToken && token !== expectedToken) throw new Error("BAIT_SNAPSHOT_MISMATCH");
  return token;
}

module.exports = {
  BAIT_MENU_LABEL,
  normalizeUiText,
  isBaitMenuButton,
  hasRecentBaitMenu,
  parseHistory,
  parseBaitUi,
  parseBaitPlayerCards,
  verifyBaitSnapshot
};
