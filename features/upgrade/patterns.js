// Parser/pattern thuần của Auto Nâng Cấp 2.0 (không mở browser/chờ chat).
const {
  RECENT_CHAT_TEXT_LENGTH,
  hasFeatureMenuSignature
} = require("../../lib/bot-patterns");
const {
  countMatches,
  lastPatternIndex,
  getFreshSince
} = require("../../lib/text-utils");
const { countBotSystemErrors } = require("../../lib/bot-signals");

// ---- Bot message patterns (nâng cấp; nbsp-safe như auto-buy) ----
const SP = "[ \\u00a0]";
const UG_START_PATTERNS = {
  started: `Đã${SP}khởi${SP}động${SP}Auto${SP}Nâng${SP}Cấp`,
  progress: `Nâng${SP}thành${SP}công${SP}lên${SP}Mức${SP}thẻ\\s+(\\d+)\\s*\\(Số${SP}lượng${SP}nguyên${SP}liệu${SP}còn:\\s*(\\d+)\\)`,
  // Bot kết thúc run bằng 2 dạng: "Nâng thành công X/Y target" và
  // "Nâng thất bại 0/1 target" (kèm "Mức thẻ cuối" + "Dừng do ...").
  // Dạng thất bại cũng là terminal: thiếu nó thì khi Telegram trim/re-render
  // mất dòng "Đã khởi động..." (mọi thứ rơi vào 1 segment), số terminal mới
  // không tăng so với baseline -> fallback đếm không nhận -> agent treo tới
  // timeout (bug 2026-10-19 #2). Dòng checkpoint giữa run "Nâng thất bại 3
  // target lên grade 5" không có dạng X/Y target nên KHÔNG khớp -> không bị
  // đếm nhầm là kết thúc sớm.
  summary: `Nâng${SP}(?:thành${SP}công|thất${SP}bại)\\s+(\\d+)\\s*\\/\\s*(\\d+)\\s*target`,
  finalGrade: `Mức${SP}thẻ${SP}cuối\\s+(\\d+)`,
  // Tiến trình gọn: "- ID ...: 4→5 | m=5 | ..." (m = nguyên liệu còn)
  compactProgress: `(\\d+)\\s*→\\s*(\\d+)\\s*\\|\\s*m=(\\d+)`,
  // Bot bó tay tạm thời: "Không đủ nguyên liệu (tối đa 5 phôi) để đạt 100%, bestPossible=55.33%"
  shortage: `Không${SP}đủ${SP}nguyên${SP}liệu\\s*\\(tối${SP}đa\\s+(\\d+)${SP}phôi\\)${SP}để${SP}đạt\\s+(\\d+)%,${SP}bestPossible=([\\d.]+)%`,
  // Lý do dừng chung: "Dừng do hết nguyên liệu." / "Dừng do đạt mục tiêu." / "Dừng do ... để phù hợp."
  stopReason: `Dừng${SP}do${SP}([^.]+)\\.`
};
const UG_STARTED_RE = new RegExp(UG_START_PATTERNS.started, "gi");
const UG_PROGRESS_RE = new RegExp(UG_START_PATTERNS.progress, "gi");
const UG_SUMMARY_RE = new RegExp(UG_START_PATTERNS.summary, "gi");
const UG_FINAL_GRADE_RE = new RegExp(UG_START_PATTERNS.finalGrade, "gi");
const UG_COMPACT_PROGRESS_RE = new RegExp(UG_START_PATTERNS.compactProgress, "gi");
const UG_SHORTAGE_RE = new RegExp(UG_START_PATTERNS.shortage, "gi");
const UG_STOP_REASON_RE = new RegExp(UG_START_PATTERNS.stopReason, "gi");

const UG_STOP_COMMAND = "/stopnc";
const UG_MENU_BUTTON_RE = /nâng cấp 2\.0/i;
const UG_MENU_EXACT = "Auto Nâng Cấp 2.0";
const UG_CHECK_BUTTON_TEXT = "Kiểm tra & Bắt đầu";
const UG_FINAL_START_TEXT = "Bắt đầu nâng cấp";
const UG_FILTER_BUTTON_TEXT = "Lọc phôi từ kho";
// Panel auto hiển thị thay cho panel lọc phôi khi app ở mode auto_buy_upgrade.
const UG_AUTO_FORM_HEADING = "Bước 3: Nhập giá tối đa mỗi phôi";
// App có thể render "1 Tự chọn phôi", "1. Tự chọn phôi" hoặc "1Tự chọn phôi"
// tuỳ phiên bản/kiểu DOM. Chuẩn hoá khoảng trắng trước khi so khớp để không
// phụ thuộc đúng một kiểu text.
const UG_MODE_OPTION_RE = /^\s*1\s*[.)-]?\s*Tự\s*chọn\s*phôi/i;

function isUpgradeModeOptionText(text) {
  return UG_MODE_OPTION_RE.test(String(text || "").replace(/\s+/g, " ").trim());
}

// Body của mini-app luôn có dòng "mode: manual" hoặc "mode: auto_buy_upgrade".
// Dùng để bỏ qua bước bấm mode khi app đã ở đúng mode (tránh toggle section).
function isManualUpgradeModeText(text) {
  return /^[ \t]*mode:\s*manual\b/im.test(
    String(text || "").replace(/\u00a0/g, " ")
  );
}
// Các mùa ICON dùng nhiều file badge khác nhau trên CDN Nexon:
// icon.png, icontm.png, icontm_b.png, filter/icon_m.png, mcicon.png, tki.png.
// App nâng cấp còn trả badge qua CDN Garena dạng season-icon/<mã mùa>.png.
// Mã các mùa ICON lấy từ danh sách mùa của mini-app: 100 ICON TM,
// 101 ICON, 110 ICON TM Bound, 111 ICONS MATCH, 202 TKI, 213 MCFC ICON.
const UG_ICON_BADGE_RE = /(?:^|\/)(?:(?:mc)?icon[a-z0-9_]*|tki)\.png(?:[?#]|$)/i;
const UG_ICON_SEASON_IDS = new Set(["100", "101", "110", "111", "202", "213"]);
const UG_GARENA_SEASON_ICON_RE = /(?:^|\/)season-icon\/(\d+)\.png(?:[?#]|$)/i;

function isIconSeasonBadge(src) {
  const value = String(src || "");
  if (UG_ICON_BADGE_RE.test(value)) return true;
  const match = value.match(UG_GARENA_SEASON_ICON_RE);
  return !!match && UG_ICON_SEASON_IDS.has(match[1]);
}
const MINI_APP_LOAD_RETRIES = 1;
const NC_MENU_WAIT_MS = 30_000;
const UG_START_ACK_MS = 40 * 60_000;
const UG_PROGRESS_LOG_MS = 5 * 60_000;
const UG_EMPTY_LIST_GRACE_MS = 15_000;

// Thẻ cầu thủ trong danh sách kho luôn chứa "_id:<hex>". Khi kho không còn
// target hợp lệ, danh sách rỗng nên KHÔNG có "_id:" dù mini-app đã tải xong.
function hasUpgradeTargetCards(text) {
  return /_id:\s*[0-9a-f]+/i.test(String(text || ""));
}

// Mini-app đã render xong form cấu hình (kể cả khi danh sách target rỗng).
// Trước đây chỉ chờ "_id:" nên gặp kho rỗng là treo đủ 5 phút rồi mới retry.
// App có 2 panel loại trừ nhau: manual hiện "Lọc phôi từ kho", auto hiện
// "Bước 3: Nhập giá tối đa mỗi phôi". Chỉ panel đang bật nằm trong innerText,
// nên phải nhận cả hai; nếu không, mini-app mở lại ở mode auto sẽ không bao giờ
// được coi là form sẵn sàng.
function hasUpgradeForm(text) {
  const s = String(text || "").replace(/\u00a0/g, " ");
  return (
    s.includes(UG_CHECK_BUTTON_TEXT) &&
    (s.includes(UG_FILTER_BUTTON_TEXT) || s.includes(UG_AUTO_FORM_HEADING))
  );
}

function isUpgradeFrameReady(text) {
  const s = String(text || "").replace(/\u00a0/g, " ");
  if (hasUpgradeTargetCards(s)) return true;
  if (/Đang tải/i.test(s)) return false;
  return hasUpgradeForm(s);
}

// Bảo vệ BP chỉ bật khi target >= ngưỡng (user: chỉ ở +8).
function shouldProtectBp(targetGrade, fromGrade) {
  return targetGrade >= fromGrade;
}

// "54.3M"->54300000, "2B"->2e9, "625,000"->625000, "50000000"->50000000.
function parseMarketPrice(raw) {
  const s = String(raw).trim();
  const m = s.match(/^([\d.,]+)\s*([KMB])?$/i);
  if (!m) throw new Error(`Không đọc được giá thị trường: ${raw}`);
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || "").toUpperCase()] || 1;
  const num = m[2]
    ? Number(m[1].replace(/,/g, ""))
    : Number(m[1].replace(/[.,\s]/g, ""));
  const amount = Math.round(num * mult);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error(`Không đọc được giá thị trường: ${raw}`);
  }
  return amount;
}

function countUpgradeStarts(text) {
  return countMatches(text, UG_STARTED_RE);
}

function parseUpgradeProgress(text) {
  const events = [];
  for (const m of text.matchAll(UG_PROGRESS_RE)) {
    events.push({ index: m.index, grade: Number(m[1]), materials: Number(m[2]) });
  }
  for (const m of text.matchAll(UG_COMPACT_PROGRESS_RE)) {
    events.push({ index: m.index, grade: Number(m[2]), materials: Number(m[3]) });
  }
  events.sort((a, b) => a.index - b.index);
  return events.map(({ grade, materials }) => ({ grade, materials }));
}

function latestUpgradeProgress(text) {
  const all = parseUpgradeProgress(text);
  return all.length ? all.at(-1) : null;
}

// Bot báo tạm bó tay: không đủ nguyên liệu để đạt tỉ lệ yêu cầu.
function parseUpgradeShortage(text) {
  const matches = [...text.matchAll(UG_SHORTAGE_RE)];
  if (!matches.length) return null;
  const latest = matches.at(-1);
  return {
    maxPhoi: Number(latest[1]),
    needRatio: Number(latest[2]),
    best: Number(latest[3])
  };
}

// Chia lịch sử thành các run theo mốc "Đã khởi động..." (+ đoạn lịch sử trước
// start đầu tiên). Mỗi run tối đa 1 terminal nên không cần window heuristic,
// 2 run sát nhau cũng không gán nhầm.
function splitUpgradeRuns(text) {
  const bounds = [0];
  for (const m of text.matchAll(UG_STARTED_RE)) bounds.push(m.index);
  bounds.push(text.length);
  const segments = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    segments.push(text.slice(bounds[i], bounds[i + 1]));
  }
  return { pre: segments[0], runs: segments.slice(1) };
}

function terminalInSegment(segment) {
  const summaries = [...segment.matchAll(UG_SUMMARY_RE)];
  const lastSummary = summaries.at(-1) || null;
  if (lastSummary) {
    const tail = segment.slice(lastSummary.index);
    const finalGrades = [...tail.matchAll(UG_FINAL_GRADE_RE)].map((m) => Number(m[1]));
    const progress = parseUpgradeProgress(tail).at(-1);
    const reasonMatch = [...tail.matchAll(UG_STOP_REASON_RE)].at(-1) || null;
    const shortageMatches = [...tail.matchAll(UG_SHORTAGE_RE)];
    const shortage = shortageMatches.at(-1) || null;
    const reason = reasonMatch ? reasonMatch[1].trim().toLowerCase() : "";
    return {
      success: Number(lastSummary[1]),
      total: Number(lastSummary[2]),
      finalGrade: finalGrades.length ? finalGrades.at(-1) : null,
      reason,
      ...(progress ? { materialsRemaining: progress.materials } : {}),
      ...(shortage
        ? {
            bestPossible: Number(shortage[3]),
            possibleRequired: Number(shortage[2]),
            materialsAvailable: Number(shortage[1])
          }
        : {}),
      outOfMaterial:
        !!shortage ||
        /(nguyên liệu|phôi|thiếu|không đủ|không có|hết)/i.test(reason),
      reachedTarget: /đạt mục tiêu/i.test(reason)
    };
  }
  const grade = [...segment.matchAll(UG_FINAL_GRADE_RE)].at(-1) || null;
  const reason = [...segment.matchAll(UG_STOP_REASON_RE)].at(-1) || null;
  if (!grade || !reason || grade.index > reason.index) return null;
  const reasonText = reason[1].trim().toLowerCase();
  const progress = parseUpgradeProgress(segment).at(-1);
  const shortageMatches = [...segment.matchAll(UG_SHORTAGE_RE)];
  const shortage = shortageMatches.at(-1) || null;
  return {
    success: null,
    total: null,
    finalGrade: Number(grade[1]),
    reason: reasonText,
    ...(progress ? { materialsRemaining: progress.materials } : {}),
    ...(shortage
      ? {
          bestPossible: Number(shortage[3]),
          possibleRequired: Number(shortage[2]),
          materialsAvailable: Number(shortage[1])
        }
      : {}),
    outOfMaterial:
      !!shortage ||
      /(nguyên liệu|phôi|thiếu|không đủ|không có|hết)/i.test(reasonText),
    reachedTarget: /đạt mục tiêu/i.test(reasonText)
  };
}

function parseUpgradeSummary(text) {
  const { pre, runs } = splitUpgradeRuns(text);
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    const terminal = terminalInSegment(runs[i]);
    if (terminal) return terminal;
  }
  return terminalInSegment(pre);
}

// Đếm số lần kết thúc (cả 2 dạng) để phát hiện terminal mới qua baseline.
// Không được phụ thuộc vào dòng "Đã khởi động..." vì bot đôi khi chỉ gửi
// phần kết quả sau khi mini-app đã chạy; khi đó toàn bộ lịch sử nằm trong `pre`.
function countUpgradeTerminals(text) {
  const { pre, runs } = splitUpgradeRuns(text);
  const summaryCount = countMatches(text, UG_SUMMARY_RE);
  let count = summaryCount;
  if (!summaryCount && terminalInSegment(pre)) count += 1;
  for (const run of runs) {
    if (countMatches(run, UG_SUMMARY_RE) === 0 && terminalInSegment(run)) count += 1;
  }
  return count;
}

// Định danh terminal cuối cùng trong cửa sổ chat. Chỉ đếm terminal là không đủ:
// Telegram có thể trim mất terminal cũ và thêm terminal mới trong cùng một nhịp,
// làm count không đổi (bug 2026-10-26). Key gồm nội dung terminal + giờ hiển thị
// của Telegram; giờ giúp phân biệt hai run cùng summary nhưng khác thời điểm.
function normalizeUpgradeTerminalText(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 600);
}

function parseClockMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function getLatestUpgradeTerminal(text) {
  const full = String(text || "");
  if (!full) return null;
  const summary = parseUpgradeSummary(full);
  if (!summary) return null;

  const summaries = [...full.matchAll(UG_SUMMARY_RE)];
  let start;
  if (summaries.length) {
    start = summaries.at(-1).index;
  } else {
    // Dạng terminal cũ không có dòng "Nâng ... X/Y target", chỉ có
    // "Mức thẻ cuối" + "Dừng do ...".
    const finals = [...full.matchAll(UG_FINAL_GRADE_RE)];
    if (!finals.length) return null;
    start = finals.at(-1).index;
  }

  const tail = full.slice(start);
  const reason = [...tail.matchAll(UG_STOP_REASON_RE)][0] || null;
  let blockEnd = reason ? reason.index + reason[0].length : -1;
  if (blockEnd < 0) {
    // Không có "Dừng do": lấy tới mốc giờ Telegram kế tiếp, tránh nuốt các
    // tin nhắn sau terminal làm key đổi liên tục.
    const nextTime = tail.slice(1).search(/\n[ \t]*\d{1,2}:\d{2}[ \t]*(?:\n|$)/);
    blockEnd = nextTime >= 0 ? nextTime + 1 : tail.length;
  }
  const block = normalizeUpgradeTerminalText(tail.slice(0, blockEnd));
  if (!block) return null;
  const after = full.slice(start + blockEnd);
  const time =
    after.match(/(?:^|\n)[ \t]*(\d{1,2}:\d{2})[ \t]*(?:\n|$)/)?.[1] || "";
  const playerId =
    block.match(/(?:Cầu thủ ID|ID Cầu thủ)\s*([0-9a-f]{6,})/i)?.[1]?.toLowerCase() || "";
  return {
    ...summary,
    block,
    time,
    playerId,
    key: `${block}${time ? ` @${time}` : ""}`
  };
}

function getUpgradeTerminalKey(text) {
  return getLatestUpgradeTerminal(text)?.key ?? null;
}

// Nếu cửa sổ chat cuộn ngược làm terminal cũ (giờ sớm hơn nhiều) lộ ra, không
// được coi là kết quả mới. Khoảng cách > 12h gần như chắc chắn là terminal cũ;
// còn qua nửa đêm (23:58 -> 00:03) vẫn được coi là mới.
function isTerminalLikelyOlder(current, baselineTime) {
  const currentMinutes = parseClockMinutes(current?.time);
  const baselineMinutes = parseClockMinutes(baselineTime);
  if (currentMinutes == null || baselineMinutes == null) return false;
  const forwardMinutes = (currentMinutes - baselineMinutes + 24 * 60) % (24 * 60);
  return forwardMinutes > 12 * 60;
}

function hasNewUpgradeTerminal(text, baseline) {
  const current = getLatestUpgradeTerminal(text);
  if (!current) return false;
  const previousKey = baseline?.terminalKey ?? null;
  if (!previousKey || current.key === previousKey) return false;
  // Cùng nội dung terminal, chỉ thiếu mốc giờ do DOM đang re-render: chưa đủ
  // chắc chắn là terminal mới, bỏ qua nhịp này thay vì báo xong sớm.
  const sameBlock = !!baseline?.terminalBlock && current.block === baseline.terminalBlock;
  if (!current.time || !baseline?.terminalTime) return !sameBlock;
  return !isTerminalLikelyOlder(current, baseline.terminalTime);
}

function getUpgradeCycleBaseline(text) {
  const terminal = getLatestUpgradeTerminal(text);
  return {
    starts: countUpgradeStarts(text),
    terminals: countUpgradeTerminals(text),
    systemErrors: countBotSystemErrors(text),
    terminalKey: terminal?.key ?? null,
    terminalTime: terminal?.time ?? "",
    terminalBlock: terminal?.block ?? null
  };
}

function getExistingUpgradeRun(text) {
  const { runs } = splitUpgradeRuns(text);
  const last = runs.at(-1);
  if (!last) return null;
  if (terminalInSegment(last)) return null;
  return { status: "running", baseline: getUpgradeCycleBaseline(text) };
}

function hasNewUpgradeStart(text, baseline, baselineText = null) {
  if (countUpgradeStarts(text) > baseline.starts) return true;
  if (baselineText) {
    const fresh = getFreshSince(baselineText, text);
    if (fresh && countUpgradeStarts(fresh) > 0) return true;
  }
  return false;
}

function getUpgradeOutcomeFromFresh(freshText, fullText) {
  if (!freshText) return null;
  if (countBotSystemErrors(freshText) > 0) return { status: "system-error" };
  if (countUpgradeTerminals(freshText) > 0) {
    const summary = parseUpgradeSummary(freshText) || parseUpgradeSummary(fullText);
    if (summary) return { status: "completed", ...summary };
  }
  return null;
}

// Kết quả của run hiện tại, ưu tiên fresh-text; khi snapshot bị Telegram thay
// hẳn (không tách được phần mới sau baseline — ví dụ ngay sau khi mini-app nâng
// re-render), fallback đếm terminal trên toàn cửa sổ: trim chỉ làm số terminal
// GIẢM, nên count tăng so với baseline chắc chắn là terminal MỚI của run này.
function getUpgradeRunOutcome(snapshotText, baseline, baselineText) {
  const fresh = getFreshSince(baselineText ?? null, snapshotText);
  if (fresh) {
    const outcome = getUpgradeOutcomeFromFresh(fresh, snapshotText);
    if (outcome) return { outcome, fresh };
  }
  // Fallback bằng key: cửa sổ chat có thể vừa trim terminal cũ vừa thêm terminal
  // mới, nên số terminal không tăng dù run hiện tại đã xong.
  if (hasNewUpgradeTerminal(snapshotText, baseline)) {
    const summary = parseUpgradeSummary(snapshotText);
    if (summary) return { outcome: { status: "completed", ...summary }, fresh };
  }
  if (countUpgradeTerminals(snapshotText) > (baseline?.terminals ?? 0)) {
    const summary = parseUpgradeSummary(snapshotText);
    if (summary) return { outcome: { status: "completed", ...summary }, fresh };
  }
  return { outcome: null, fresh };
}

// Summary còn sót trong cửa sổ đã trim mất dòng start => của run này.
function getOrphanUpgradeOutcome(text, baselineHadStart, baselineTerminals = 0) {
  if (!baselineHadStart || countUpgradeTerminals(text) <= baselineTerminals) return null;
  if (lastPatternIndex(text, UG_STARTED_RE) >= 0) return null;
  const summary = parseUpgradeSummary(text);
  if (summary) return { status: "completed", ...summary };
  return null;
}

// Lọc target từ DOM cards: [{text, disabled, imgSrcs}] -> icon + mở khóa +
// dưới target, sort grade asc rồi giá asc.
function parseUpgradeTargetCards(cards, targetGrade) {
  const out = [];
  const seen = new Set();
  for (const card of cards) {
    const idMatch = card.text.match(/_id:\s*([0-9a-f]+)/i);
    const gradeMatch = card.text.match(/\+(\d+)/);
    if (!idMatch || !gradeMatch || seen.has(idMatch[1])) continue;
    seen.add(idMatch[1]);
    const isIcon = (card.imgSrcs || []).some(isIconSeasonBadge);
    const locked = /KHÓA/.test(card.text) || !!card.disabled;
    const grade = Number(gradeMatch[1]);
    if (!isIcon || locked || grade >= targetGrade) continue;
    let priceBp = Number.MAX_SAFE_INTEGER;
    const priceMatch = card.text.match(/Giá\s*([\d.,]+[KMB]?)/i);
    if (priceMatch) {
      try { priceBp = parseMarketPrice(priceMatch[1]); } catch { priceBp = Number.MAX_SAFE_INTEGER; }
    }
    out.push({
      id: idMatch[1],
      name: card.text.split("_id:")[0].trim().slice(0, 40),
      grade,
      priceBp,
      priceRaw: priceMatch ? priceMatch[1] : "?"
    });
  }
  out.sort((a, b) => a.grade - b.grade || a.priceBp - b.priceBp);
  return out;
}

// Giải thích vì sao một danh sách thẻ không có target hợp lệ. Dùng cho log
// chẩn đoán "kho có icon nhưng agent không nâng được".
function summarizeUpgradeTargetCards(cards, targetGrade) {
  const summary = {
    total: cards.length,
    invalid: 0,
    duplicate: 0,
    notIcon: 0,
    locked: 0,
    reachedTarget: 0,
    eligible: 0
  };
  const seen = new Set();
  for (const card of cards) {
    const idMatch = card.text.match(/_id:\s*([0-9a-f]+)/i);
    const gradeMatch = card.text.match(/\+(\d+)/);
    if (!idMatch || !gradeMatch) {
      summary.invalid += 1;
      continue;
    }
    if (seen.has(idMatch[1])) {
      summary.duplicate += 1;
      continue;
    }
    seen.add(idMatch[1]);
    const isIcon = (card.imgSrcs || []).some(isIconSeasonBadge);
    const locked = /KHÓA/.test(card.text) || !!card.disabled;
    if (!isIcon) summary.notIcon += 1;
    else if (locked) summary.locked += 1;
    else if (Number(gradeMatch[1]) >= targetGrade) summary.reachedTarget += 1;
    else summary.eligible += 1;
  }
  return summary;
}

function countInventoryIcons(cards) {
  const seen = new Set();
  let count = 0;
  for (const card of cards) {
    const idMatch = card.text.match(/_id:\s*([0-9a-f]+)/i);
    if (!idMatch) continue;
    const id = idMatch[1].toLowerCase();
    if (seen.has(id) || !(card.imgSrcs || []).some(isIconSeasonBadge)) continue;
    seen.add(id);
    count += 1;
  }
  return count;
}

// Tổng hợp kho ICON để quyết định có cần mua phôi hay không. Chỉ ICON dưới
// target (eligible) mới là việc còn làm được; ICON đã đạt target không được
// kích hoạt chu kỳ mua phôi, nếu không agent sẽ mua phôi + nâng lặp vô ích khi
// con ICON duy nhất đã +target.
function inspectInventoryIcons(cards, targetGrade) {
  const summary = summarizeUpgradeTargetCards(cards, targetGrade);
  return {
    total: summary.eligible + summary.locked + summary.reachedTarget,
    eligible: summary.eligible,
    locked: summary.locked,
    reachedTarget: summary.reachedTarget,
    notIcon: summary.notIcon
  };
}

// Sau khi tải lại kho, danh sách được coi là đã cạn target khi không còn thẻ
// ICON nào dưới target và cũng không có thẻ nào đang bị khóa/training. Điều kiện
// "không có thẻ khóa" rất quan trọng: trong lúc worker đang nâng, backend có thể
// tạm khóa target hiện tại; nếu bỏ qua điều này agent sẽ tưởng đã hết target.
function isUpgradeTargetListExhausted(cards, targetGrade) {
  const summary = summarizeUpgradeTargetCards(cards, targetGrade);
  return summary.eligible === 0 && summary.locked === 0;
}

// "114,115,116" hoặc "112-118" (hint của bot) -> [114,115,116,...].
function parseOvrList(raw) {
  const out = new Set();
  const parts = String(raw).split(",");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) throw new Error(`OVR không hợp lệ: "${part}"`);
    const range = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from > to || to - from > 50) {
        throw new Error(`Dải OVR không hợp lệ: ${trimmed}`);
      }
      for (let ovr = from; ovr <= to; ovr += 1) out.add(ovr);
      continue;
    }
    const single = Number(trimmed);
    if (!Number.isSafeInteger(single)) throw new Error(`OVR không hợp lệ: ${trimmed}`);
    out.add(single);
  }
  if (!out.size) throw new Error(`Danh sách OVR trống: ${raw}`);
  return [...out].sort((a, b) => a - b);
}

// OVR của các thẻ phôi đã chọn (có badge ĐÃ CHỌN) — kiểm tra spec thật thay vì
// tin trạng thái checkbox (app có thể tự revert toggle).
function parseSelectedPhoiOvrs(cardTexts) {
  const ovrs = [];
  for (const text of cardTexts) {
    if (!/ĐÃ CHỌN/.test(text)) continue;
    const m = text.match(/OVR\s*(\d+)/i);
    if (m) ovrs.push(Number(m[1]));
  }
  return ovrs;
}

function verifyUpgradeFinalUi(text, spec, phoiCount) {
  const uiText = String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const checks = [
    [
      /Số(?: lượng)?\s*(?:target|mục tiêu|cầu thủ)(?:\s*(?:cần|nâng))?\s*:?\s*1/i,
      "số target"
    ],
    [new RegExp(`Mục tiêu\\s*:?\\s*\\+${spec.targetGrade}`, "i"), "mục tiêu"],
    [new RegExp(`Tỉ lệ tối thiểu\\s*:?\\s*${spec.minRatio}%`, "i"), "tỉ lệ"],
    [new RegExp(`Số phôi đã chọn\\s*:?\\s*${phoiCount}`, "i"), "số phôi"]
  ];
  for (const [re, name] of checks) {
    if (!re.test(uiText)) throw new Error(`UI kiểm tra cuối thiếu/sai ${name}.`);
  }
  const protectBp = shouldProtectBp(spec.targetGrade, spec.bpProtectFromGrade);
  if (!protectBp && !/KHÔNG KHẢ DỤNG/i.test(uiText)) {
    throw new Error("UI kiểm tra cuối không khớp trạng thái tắt bảo vệ BP.");
  }
  if (protectBp && /KHÔNG KHẢ DỤNG/i.test(uiText)) {
    throw new Error("UI kiểm tra cuối báo bảo vệ BP không khả dụng dù spec yêu cầu bật.");
  }
}

// Menu chức năng mới của bot có chứa nút Auto Nâng Cấp 2.0 hay không.
// Dùng để tránh bấm lại nút menu cũ còn sót trong lịch sử sau khi gửi /tn.
function hasRecentUpgradeMenu(text) {
  const recentText = String(text || "").slice(-RECENT_CHAT_TEXT_LENGTH);
  const normalized = recentText
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
  const menuIndex = normalized.lastIndexOf("bạn muốn sử dụng tính năng nào");
  const featureIndex = normalized.lastIndexOf("nâng cấp 2.0");
  if (menuIndex >= 0 && featureIndex > menuIndex) return true;
  // Menu hiện tại của bot không còn câu dẫn; nhận diện bằng các nhãn nút.
  return hasFeatureMenuSignature(recentText, "nâng cấp 2.0");
}

function hasFreshUpgradeMenu(baselineText, currentText) {
  const fresh = getFreshSince(baselineText || "", currentText || "");
  return Boolean(fresh && hasRecentUpgradeMenu(fresh));
}

module.exports = {
  UG_STOP_COMMAND,
  UG_MENU_BUTTON_RE,
  UG_MENU_EXACT,
  UG_CHECK_BUTTON_TEXT,
  UG_FINAL_START_TEXT,
  UG_FILTER_BUTTON_TEXT,
  UG_AUTO_FORM_HEADING,
  UG_MODE_OPTION_RE,
  isUpgradeModeOptionText,
  isManualUpgradeModeText,
  UG_ICON_BADGE_RE,
  UG_ICON_SEASON_IDS,
  UG_GARENA_SEASON_ICON_RE,
  isIconSeasonBadge,
  MINI_APP_LOAD_RETRIES,
  NC_MENU_WAIT_MS,
  UG_START_ACK_MS,
  UG_PROGRESS_LOG_MS,
  UG_EMPTY_LIST_GRACE_MS,
  hasUpgradeTargetCards,
  hasUpgradeForm,
  isUpgradeFrameReady,
  isUpgradeTargetListExhausted,
  shouldProtectBp,
  parseMarketPrice,
  countUpgradeStarts,
  parseUpgradeProgress,
  latestUpgradeProgress,
  parseUpgradeShortage,
  parseUpgradeSummary,
  countUpgradeTerminals,
  getLatestUpgradeTerminal,
  getUpgradeTerminalKey,
  hasNewUpgradeTerminal,
  getUpgradeCycleBaseline,
  getExistingUpgradeRun,
  hasNewUpgradeStart,
  getUpgradeOutcomeFromFresh,
  getUpgradeRunOutcome,
  getOrphanUpgradeOutcome,
  parseUpgradeTargetCards,
  summarizeUpgradeTargetCards,
  countInventoryIcons,
  inspectInventoryIcons,
  parseOvrList,
  parseSelectedPhoiOvrs,
  verifyUpgradeFinalUi,
  hasRecentUpgradeMenu,
  hasFreshUpgradeMenu
};
