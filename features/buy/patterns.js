// Parser/pattern thuần của Auto Mua Phôi. Không mở browser, không chờ chat.
const {
  STARTED_RE,
  ACTIVE_RE,
  AUTO_BUY_STOPPED_RE,
  STOPPED_RE,
  GENERIC_STOPPED_RE,
  STOP_NO_RUNNING_RE,
  FULL_INVENTORY_STOP_RE,
  INVENTORY_RECEIVED_RE,
  STOP_MENU_RE,
  AUTO_BUY_STOP_OPTION_RE,
  COMPLETED_RE,
  RECENT_CHAT_TEXT_LENGTH,
  MINI_APP_BP_LOAD_RETRIES,
  DISPLAYED_BP_RE,
  hasFeatureMenuSignature
} = require("../../lib/bot-patterns");
const {
  countMatches,
  lastPatternIndex,
  getFreshSince
} = require("../../lib/text-utils");
const { countBotSystemErrors } = require("../../lib/bot-signals");

function isTradeFrameLoaded(text) {
  return !/Đang tải/i.test(text) && DISPLAYED_BP_RE.test(text);
}

function shouldRetryMiniAppBpLoad(retriesUsed) {
  return retriesUsed < MINI_APP_BP_LOAD_RETRIES;
}

const RETRYABLE_MINI_APP_ERRORS = new Set([
  "MINI_APP_BP_LOAD_TIMEOUT",
  "MINI_APP_UI_NOT_READY",
  "MINI_APP_NOT_OPENED",
  "MINI_APP_BLANK"
]);

function shouldRetryMiniAppOpen(error, retriesUsed) {
  return (
    RETRYABLE_MINI_APP_ERRORS.has(error?.code) &&
    shouldRetryMiniAppBpLoad(retriesUsed)
  );
}

function lastActiveIndex(text) {
  return Math.max(
    lastPatternIndex(text, STARTED_RE),
    lastPatternIndex(text, ACTIVE_RE)
  );
}

function getLatestStartedMarker(text) {
  const matches = [...text.matchAll(STARTED_RE)];
  const latest = matches.at(-1);
  if (!latest) return null;
  const lineStart = text.lastIndexOf("\n", latest.index) + 1;
  const lineEnd = text.indexOf("\n", latest.index);
  return text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).trim();
}

// Worker id mới nhất trong tin "Bắt đầu treo auto mua (worker ...)".
// Dùng để đối chiếu worker mình mở vs worker adopt, tránh nhầm khi debug.
function getLatestWorkerId(text) {
  const matches = [...text.matchAll(/\(worker\s+([0-9A-Za-z_-]+)\)/g)];
  return matches.length ? matches.at(-1)[1] : null;
}

// Bot đã xác nhận "Bắt đầu treo auto mua" mới sau baseline chưa?
// Chống trôi: ngoài đếm số lượng, còn so marker dòng Started (trim làm tổng số
// giảm nhưng marker mới vẫn khác marker cũ).
function hasNewStartAcknowledgement(text, baseline) {
  if (countStartedNotices(text) > baseline.started) return true;
  const marker = getLatestStartedMarker(text);
  if (!marker) return false;
  return marker !== baseline.marker;
}

// Completion mới nhất đứng sau activity mới nhất (loại completion cũ của chu kỳ trước).
function getLatestCompletionAfterActivity(text) {
  const activityIdx = lastActiveIndex(text);
  let result = null;
  for (const match of text.matchAll(COMPLETED_RE)) {
    if (match.index > activityIdx) result = Number(match[1] || match[2]);
  }
  return result;
}

// Kết quả chu kỳ suy từ phần tin mới (ưu tiên), dùng trong waitForCycleCompletion.
function getCycleOutcomeFromFresh(freshText, fullText) {
  if (!freshText) return null;
  if (countBotSystemErrors(freshText) > 0) return { status: "system-error" };
  if (countMatches(freshText, FULL_INVENTORY_STOP_RE) > 0) {
    if (lastPatternIndex(fullText, FULL_INVENTORY_STOP_RE) > lastActiveIndex(fullText)) {
      return { status: "inventory-full" };
    }
  }
  if (countMatches(freshText, AUTO_BUY_STOPPED_RE) > 0) {
    const stopIdx = lastPatternIndex(fullText, AUTO_BUY_STOPPED_RE);
    if (
      stopIdx > lastActiveIndex(fullText) &&
      stopIdx > lastPatternIndex(fullText, COMPLETED_RE)
    ) {
      return { status: "purchase-stopped" };
    }
  }
  if (countMatches(freshText, COMPLETED_RE) > 0) {
    const completed = getLatestCompletionAfterActivity(fullText);
    if (completed !== null) return { status: "completed", playersBought: completed };
  }
  return null;
}

// Phân loại reply tươi của /stop (ưu tiên), dùng trong checkAutoBuyRunning.
// So vị trí trong fresh (toàn tin mới, dup-free) nên tin thủ công xen vào không ảnh hưởng.
function classifyFreshStopReply(freshText, fullText) {
  if (!freshText) return null;
  if (lastPatternIndex(freshText, STOP_MENU_RE) >= 0) {
    const menuTail = freshText.slice(lastPatternIndex(freshText, STOP_MENU_RE));
    if (!AUTO_BUY_STOP_OPTION_RE.test(menuTail)) return "auto-buy-not-running";
    const fullMenuIdx = lastPatternIndex(fullText, STOP_MENU_RE);
    const afterMenu = fullText.slice(fullMenuIdx);
    const terminalAfter = Math.max(
      lastPatternIndex(afterMenu, COMPLETED_RE),
      lastPatternIndex(afterMenu, AUTO_BUY_STOPPED_RE)
    );
    if (terminalAfter >= 0) {
      const activityAfter = Math.max(
        lastPatternIndex(afterMenu, STARTED_RE),
        lastPatternIndex(afterMenu, ACTIVE_RE)
      );
      if (terminalAfter > activityAfter) return "auto-buy-not-running";
    }
    return "auto-buy-running";
  }
  const activeIdx = Math.max(
    lastPatternIndex(freshText, ACTIVE_RE),
    lastPatternIndex(freshText, STARTED_RE)
  );
  const terminalIdx = Math.max(
    lastPatternIndex(freshText, COMPLETED_RE),
    lastPatternIndex(freshText, AUTO_BUY_STOPPED_RE),
    lastPatternIndex(freshText, STOP_NO_RUNNING_RE),
    lastPatternIndex(freshText, FULL_INVENTORY_STOP_RE)
  );
  if (activeIdx < 0 && terminalIdx < 0) return null;
  return activeIdx > terminalIdx ? "auto-buy-running" : "auto-buy-not-running";
}

// Xác nhận dừng suy từ tin mới, dùng trong stopPurchaseWorker.
function hasFreshStopConfirmation(freshText, fullText) {
  if (!freshText) return false;
  if (countMatches(freshText, STOP_NO_RUNNING_RE) > 0) return true;
  if (countMatches(freshText, AUTO_BUY_STOPPED_RE) > 0) {
    const stopIdx = lastPatternIndex(fullText, AUTO_BUY_STOPPED_RE);
    if (
      stopIdx > lastActiveIndex(fullText) &&
      stopIdx > lastPatternIndex(fullText, COMPLETED_RE)
    ) {
      return true;
    }
  }
  if (countMatches(freshText, COMPLETED_RE) > 0) {
    return getLatestCompletionAfterActivity(fullText) !== null;
  }
  return false;
}

// Tin xác nhận dừng (dùng chung cho cả 2 điểm kiểm tra trong stopPurchaseWorker
// để 2 bản không lệch nhau): xác nhận dừng auto-buy mới, completion mới,
// hoặc bot báo không còn lệnh — đều tính là đã dừng.
function isStopConfirmed(snapshotText, freshText, stopBaseline) {
  return (
    hasFreshStopConfirmation(freshText, snapshotText) ||
    getOrphanCycleOutcome(snapshotText, true) !== null ||
    hasNewStoppedNotice(snapshotText, stopBaseline.stopped, stopBaseline.autoBuyStopped, false) ||
    getNewCompletionNotice(snapshotText, stopBaseline.completions) !== null ||
    [...snapshotText.matchAll(STOP_NO_RUNNING_RE)].length > stopBaseline.noRunning
  );
}

// Tin kết thúc chu kỳ đưa agent về idle (E006/kho đầy/bot dừng).
// Trả về thông điệp để log, hoặc null nếu chu kỳ hoàn tất (caller tự xử lý tiếp).
function idleOutcomeMessage(outcome) {
  if (outcome.status === "system-error") {
    return "Bot trả E006; agent đã tự dừng và chờ /startagent.";
  }
  if (outcome.status === "inventory-full") {
    return "Kho và TTCN đã đầy; agent dừng mua và chờ /startagent.";
  }
  if (outcome.status === "purchase-stopped") {
    return "Bot đã dừng Auto Mua Phôi; agent chờ /startagent, không chạy lại chu kỳ.";
  }
  return null;
}

// Terminal "mồ côi": cửa sổ chat đã trim/unload mất dòng activity của chu kỳ
// (chu kỳ dài, nhiều tin mua + tin thủ công chen ngang) nhưng terminal đặc thù
// auto-buy vẫn còn. Trim luôn cắt từ đầu (tin cũ nhất) nên terminal còn lại mà
// không còn activity nào trong cửa sổ thì chắc chắn mới hơn mọi activity đã mất
// => thuộc chu kỳ này. Chỉ áp dụng pattern đặc thù auto-buy, KHÔNG áp dụng
// "Đã dừng N luồng thành công" chung chung (có thể của worker thủ công khác).
function getOrphanCycleOutcome(text, baselineHadActivity) {
  if (!baselineHadActivity) return null;
  if (lastActiveIndex(text) >= 0) return null; // còn activity: dùng logic thường
  const completions = [...text.matchAll(COMPLETED_RE)];
  if (completions.length > 0) {
    const latest = completions.at(-1);
    return { status: "completed", playersBought: Number(latest[1] || latest[2]) };
  }
  if (lastPatternIndex(text, AUTO_BUY_STOPPED_RE) >= 0) {
    return { status: "purchase-stopped" };
  }
  if (lastPatternIndex(text, FULL_INVENTORY_STOP_RE) >= 0) {
    return { status: "inventory-full" };
  }
  return null;
}

function parseBp(raw) {
  const digits = raw.replace(/[.,\s]/g, "");
  const amount = Number(digits);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error(`Không đọc được giá BP hợp lệ: ${raw}`);
  }
  return amount;
}

function countStartedNotices(text) {
  return countMatches(text, STARTED_RE);
}

function countStoppedNotices(text) {
  return countMatches(text, STOPPED_RE);
}

function countAutoBuyStoppedNotices(text) {
  return countMatches(text, AUTO_BUY_STOPPED_RE);
}

function countFullInventoryStops(text) {
  return countMatches(text, FULL_INVENTORY_STOP_RE);
}

function hasNewFullInventoryStop(text, previousCount) {
  const notices = [...text.matchAll(FULL_INVENTORY_STOP_RE)];
  if (notices.length <= previousCount) return false;
  const latestNotice = notices.at(-1);
  const latestActivity = Math.max(
    [...text.matchAll(STARTED_RE)].at(-1)?.index ?? -1,
    [...text.matchAll(ACTIVE_RE)].at(-1)?.index ?? -1
  );
  return latestNotice.index > latestActivity;
}

function parseCompletionNotices(text) {
  return [...text.matchAll(COMPLETED_RE)].map((match) =>
    Number(match[1] || match[2])
  );
}

// Trạng thái auto-buy hiện tại từ lịch sử chat:
// "running" nếu activity mới nhất đứng sau terminal mới nhất.
function getLatestAutoBuyStatus(text) {
  const activity = Math.max(
    lastPatternIndex(text, STARTED_RE),
    lastPatternIndex(text, ACTIVE_RE)
  );
  const terminal = Math.max(
    lastPatternIndex(text, COMPLETED_RE),
    lastPatternIndex(text, AUTO_BUY_STOPPED_RE),
    lastPatternIndex(text, FULL_INVENTORY_STOP_RE)
  );
  if (activity < 0 && terminal < 0) return null;
  return activity > terminal ? "running" : "not-running";
}

function hasNewStoppedNotice(
  text,
  previousStoppedCount,
  previousAutoBuyStoppedCount = 0,
  includeUnattributed = true
) {
  const stoppedNotices = [...text.matchAll(STOPPED_RE)];
  if (stoppedNotices.length <= previousStoppedCount) return false;
  const autoBuyStoppedNotices = [...text.matchAll(AUTO_BUY_STOPPED_RE)];
  const previousGenericStoppedCount =
    previousStoppedCount - previousAutoBuyStoppedCount;
  const genericStoppedCount = [...text.matchAll(GENERIC_STOPPED_RE)].length;
  if (
    autoBuyStoppedNotices.length <= previousAutoBuyStoppedCount &&
    (!includeUnattributed ||
      genericStoppedCount <= previousGenericStoppedCount)
  ) {
    return false;
  }
  const latestStopped =
    autoBuyStoppedNotices.length > previousAutoBuyStoppedCount
      ? autoBuyStoppedNotices.at(-1)
      : includeUnattributed
        ? stoppedNotices.at(-1)
        : null;
  if (!latestStopped) return false;
  const latestActivity = Math.max(
    [...text.matchAll(STARTED_RE)].at(-1)?.index ?? -1,
    [...text.matchAll(ACTIVE_RE)].at(-1)?.index ?? -1
  );
  const latestCompletion = [...text.matchAll(COMPLETED_RE)].at(-1);
  return (
    latestStopped.index > latestActivity &&
    (!latestCompletion || latestStopped.index > latestCompletion.index)
  );
}

function getStopCheckBaseline(text) {
  return {
    noRunning: [...text.matchAll(STOP_NO_RUNNING_RE)].length,
    inventoryFullStops: countFullInventoryStops(text),
    stopMenus: [...text.matchAll(STOP_MENU_RE)].length,
    active: [...text.matchAll(ACTIVE_RE)].length,
    completions: parseCompletionNotices(text).length,
    stopped: countStoppedNotices(text),
    autoBuyStopped: countAutoBuyStoppedNotices(text),
    systemErrors: countBotSystemErrors(text)
  };
}

// Kết quả kiểm tra /stop: chỉ quan tâm auto-buy đang chạy hay không.
// Ưu tiên quét phần tin mới (baselineText) để chống trôi khi chat bị trim hoặc
// lẫn tin thủ công; fallback đếm số lượng khi snapshot bị thay hẳn.
function getStopCheckResult(text, baseline, baselineText = null) {
  if (baselineText) {
    const fresh = getFreshSince(baselineText, text);
    const freshResult = classifyFreshStopReply(fresh, text);
    if (freshResult) return freshResult;
    // Telegram đôi khi thay toàn bộ snapshot sau khi trim. Khi đó không thể
    // cắt bằng chuỗi baseline, nhưng số lượng reply mới vẫn là bằng chứng
    // an toàn: chỉ nhận loại tin nào tăng so với đúng baseline của /stop.
    const current = getStopCheckBaseline(text);
    if (current.stopMenus > baseline.stopMenus) {
      const latestMenu = [...text.matchAll(STOP_MENU_RE)].at(-1);
      const menuText = text.slice(latestMenu.index);
      return AUTO_BUY_STOP_OPTION_RE.test(menuText)
        ? "auto-buy-running"
        : "auto-buy-not-running";
    }
    if (current.noRunning > baseline.noRunning) return "auto-buy-not-running";
    if (current.active > baseline.active) return "auto-buy-running";
    if (current.completions > baseline.completions) return "auto-buy-not-running";
    if (current.inventoryFullStops > baseline.inventoryFullStops) {
      return "auto-buy-not-running";
    }
    // Snapshot bị thay nhưng không có loại reply nào tăng: tiếp tục chờ,
    // tuyệt đối không suy luận từ tin cũ còn lại trong chat.
    return null;
  }
  const current = getStopCheckBaseline(text);
  if (current.stopMenus > baseline.stopMenus) {
    const latestMenu = [...text.matchAll(STOP_MENU_RE)].at(-1);
    const menuText = text.slice(latestMenu.index);
    if (!AUTO_BUY_STOP_OPTION_RE.test(menuText)) return "auto-buy-not-running";
    const latestActivity = Math.max(
      [...text.matchAll(STARTED_RE)].at(-1)?.index ?? -1,
      [...text.matchAll(ACTIVE_RE)].at(-1)?.index ?? -1
    );
    const latestTerminal = Math.max(
      [...text.matchAll(COMPLETED_RE)].at(-1)?.index ?? -1,
      [...text.matchAll(AUTO_BUY_STOPPED_RE)].at(-1)?.index ?? -1
    );
    if (
      (current.completions > baseline.completions ||
        current.autoBuyStopped > baseline.autoBuyStopped) &&
      latestTerminal > latestActivity
    ) {
      return "auto-buy-not-running";
    }
    return "auto-buy-running";
  }
  if (current.active > baseline.active) return "auto-buy-running";
  if (current.completions > baseline.completions) return "auto-buy-not-running";
  if (current.noRunning > baseline.noRunning) return "auto-buy-not-running";
  if (current.inventoryFullStops > baseline.inventoryFullStops) {
    return "auto-buy-not-running";
  }
  return null;
}

function getNewCompletionNotice(text, previousCompletionCount) {
  const startedNotices = [...text.matchAll(STARTED_RE)];
  const activityNotices = [...text.matchAll(ACTIVE_RE)];
  const completionMatches = [...text.matchAll(COMPLETED_RE)];
  const notices = parseCompletionNotices(text);
  const latestCompletion = completionMatches[completionMatches.length - 1];
  if (!latestCompletion) return null;
  if (notices.length <= previousCompletionCount) return null;
  const latestActivityIndex = Math.max(
    startedNotices.at(-1)?.index ?? -1,
    activityNotices.at(-1)?.index ?? -1
  );
  if (latestActivityIndex > latestCompletion.index) return null;
  return Number(latestCompletion[1] || latestCompletion[2]);
}

function getLatestActivityMarker(text) {
  const activityMatches = [
    ...text.matchAll(STARTED_RE),
    ...text.matchAll(ACTIVE_RE)
  ];
  const latestActivity = activityMatches.reduce(
    (latest, match) => (!latest || match.index > latest.index ? match : latest),
    null
  );
  if (!latestActivity) return null;
  const lineStart = text.lastIndexOf("\n", latestActivity.index) + 1;
  const lineEnd = text.indexOf("\n", latestActivity.index);
  return text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).trim();
}

function getCycleCompletionNotice(text, baseline) {
  const completionMatches = [...text.matchAll(COMPLETED_RE)];
  const latestCompletion = completionMatches.at(-1);
  if (!latestCompletion) return null;
  const latestActivityIndex = Math.max(
    [...text.matchAll(STARTED_RE)].at(-1)?.index ?? -1,
    [...text.matchAll(ACTIVE_RE)].at(-1)?.index ?? -1
  );
  if (latestActivityIndex >= 0 && latestActivityIndex > latestCompletion.index) {
    return null;
  }
  const currentActivityMarker = getLatestActivityMarker(text);
  const cycleActivityIsPresent =
    baseline.latestActivityMarker !== null &&
    currentActivityMarker === baseline.latestActivityMarker;
  const activityIsNew =
    currentActivityMarker !== null &&
    currentActivityMarker !== baseline.latestActivityMarker;
  if (completionMatches.length <= baseline.completions) {
    const currentActiveCount = [...text.matchAll(ACTIVE_RE)].length;
    const activityWasTrimmed =
      completionMatches.length < baseline.completions &&
      cycleActivityIsPresent &&
      currentActiveCount <= baseline.active;
    if (!activityWasTrimmed && !activityIsNew) return null;
  }
  return Number(latestCompletion[1] || latestCompletion[2]);
}

function getCycleBaseline(text) {
  return {
    completions: parseCompletionNotices(text).length,
    started: countStartedNotices(text),
    active: [...text.matchAll(ACTIVE_RE)].length,
    latestActivityMarker: getLatestActivityMarker(text),
    stopped: countStoppedNotices(text),
    autoBuyStopped: countAutoBuyStoppedNotices(text),
    inventoryFullStops: countFullInventoryStops(text),
    systemErrors: countBotSystemErrors(text),
    noRunning: [...text.matchAll(STOP_NO_RUNNING_RE)].length,
    inventoryReceived: [...text.matchAll(INVENTORY_RECEIVED_RE)].length
  };
}

function countInventoryReceivedNotices(text) {
  return [...String(text).matchAll(INVENTORY_RECEIVED_RE)].length;
}

function getLatestInventoryReceived(text) {
  const matches = [...String(text).matchAll(INVENTORY_RECEIVED_RE)];
  const latest = matches.at(-1);
  return latest ? Number(latest[1]) : null;
}

function getExistingAutoBuyCycle(text) {
  if (getLatestAutoBuyStatus(text) !== "running") return null;
  return { status: "running", baseline: getCycleBaseline(text) };
}

function hasRecentFeatureMenu(text) {
  const recentText = String(text || "").slice(-RECENT_CHAT_TEXT_LENGTH);
  const normalized = recentText
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
  const menuIndex = normalized.lastIndexOf("bạn muốn sử dụng tính năng nào");
  const featureIndex = normalized.lastIndexOf("auto mua phôi");
  if (menuIndex >= 0 && featureIndex > menuIndex) return true;
  // Menu hiện tại của bot không còn câu dẫn; nhận diện bằng các nhãn nút.
  return hasFeatureMenuSignature(recentText, "auto mua phôi");
}

function getFeatureMenuAction(text) {
  return hasRecentFeatureMenu(text) ? "select-auto-buy" : "send-tn";
}

function hasFreshFeatureMenu(baselineText, currentText) {
  const fresh = getFreshSince(baselineText || "", currentText || "");
  return Boolean(fresh && hasRecentFeatureMenu(fresh));
}

module.exports = {
  isTradeFrameLoaded,
  shouldRetryMiniAppBpLoad,
  shouldRetryMiniAppOpen,
  lastActiveIndex,
  getLatestStartedMarker,
  getLatestWorkerId,
  hasNewStartAcknowledgement,
  getLatestCompletionAfterActivity,
  getCycleOutcomeFromFresh,
  classifyFreshStopReply,
  hasFreshStopConfirmation,
  isStopConfirmed,
  idleOutcomeMessage,
  getOrphanCycleOutcome,
  parseBp,
  countStartedNotices,
  countStoppedNotices,
  countAutoBuyStoppedNotices,
  countFullInventoryStops,
  hasNewFullInventoryStop,
  parseCompletionNotices,
  getLatestAutoBuyStatus,
  hasNewStoppedNotice,
  countBotSystemErrors,
  getStopCheckBaseline,
  getStopCheckResult,
  getNewCompletionNotice,
  getLatestActivityMarker,
  getCycleCompletionNotice,
  getCycleBaseline,
  countInventoryReceivedNotices,
  getLatestInventoryReceived,
  getExistingAutoBuyCycle,
  hasRecentFeatureMenu,
  getFeatureMenuAction,
  hasFreshFeatureMenu
};
