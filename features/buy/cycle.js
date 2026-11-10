// Các vòng chờ/kiểm tra trạng thái worker Auto Mua Phôi.
const { config } = require("../config");
const {
  chatTextReaders,
  waitForChatChange,
  verifyTailOrphan,
  ORPHAN_CLEARED_SUPPRESS_MS
} = require("../../lib/chat-runtime");
const {
  PURCHASE_RE,
  STARTED_RE,
  ACTIVE_RE,
  BUY_START_ACK_TIMEOUT_MS,
  CONTROL_COMMAND_STATUS_LOG_INTERVAL_MS
} = require("../../lib/bot-patterns");
const {
  countMatches,
  getFreshSince,
  findNearMissControlCommand,
  findNewNearMissControlCommand
} = require("../../lib/text-utils");
const {
  countBotSystemErrors,
  hasNewBotSystemError,
  countBotRateLimitNotices,
  getNewBotRateLimitDelay,
  getFreshRateLimitDelay,
  throwBotSystemError
} = require("../../lib/bot-signals");
const { CONTROL_START_COMMANDS } = require("../../lib/control-commands");
const {
  ensureMessageComposer,
  refillComposer
} = require("../composer");
const { sendBotCommand } = require("../telegram-io");
const { log } = require("../agent-log");
const {
  getCycleOutcomeFromFresh,
  getOrphanCycleOutcome,
  getLatestCompletionAfterActivity,
  countStoppedNotices,
  countFullInventoryStops,
  countStartedNotices,
  hasNewStartAcknowledgement,
  hasNewStoppedNotice,
  getCycleCompletionNotice,
  getCycleBaseline,
  getStopCheckBaseline,
  getStopCheckResult,
  isStopConfirmed,
  parseCompletionNotices,
  countInventoryReceivedNotices,
  getLatestInventoryReceived,
  hasNewFullInventoryStop
} = require("./patterns");

async function waitForStartAcknowledgement(page, baseline, rl, { ui = null } = {}) {
  const reader = chatTextReaders.get(page);
  if (!reader) throw new Error("Chưa khởi tạo theo dõi nội dung Telegram.");
  // Bình thường bot ACK trong vài giây. Chỉ chờ tối đa 90s (hoặc cấu hình nếu
  // ngắn hơn) rồi xác minh /stop, thay vì treo cả 5 phút khi bot lag.
  const waitMs = Math.min(
    config.botResponseTimeoutMinutes * 60_000,
    BUY_START_ACK_TIMEOUT_MS
  );
  const deadline = Date.now() + waitMs;
  let snapshot = reader.snapshot();
  while (Date.now() < deadline) {
    const fresh = baseline.text ? getFreshSince(baseline.text, snapshot.text) : null;
    if (
      hasNewBotSystemError(snapshot.text, baseline.systemErrors) ||
      (fresh && countBotSystemErrors(fresh) > 0)
    ) {
      throwBotSystemError("sau khi bấm bắt đầu");
    }
    if ((fresh && countStartedNotices(fresh) > 0) || hasNewStartAcknowledgement(snapshot.text, baseline)) return;
    const update = await waitForChatChange(page, reader, snapshot.version, deadline - Date.now());
    if (!update) break;
    snapshot = update;
  }
  // Bot có thể đã nhận nút bắt đầu nhưng gửi ACK rất muộn. Xác minh trạng
  // thái thật bằng /stop trước khi kết luận thất bại:
  // - worker đang chạy -> nhận worker đó, không bấm lại (tránh mua chồng);
  // - /stop xác nhận không có worker -> báo lỗi retryable để controller bấm lại
  //   nút Bắt đầu (bot lag làm mất click);
  // - không xác minh được -> báo lỗi riêng để controller mở lại Telegram Web
  //   kiểm tra tiếp, tuyệt đối không bấm mù.
  let status = null;
  let verifyError = null;
  for (let attempt = 1; attempt <= 2 && !status; attempt += 1) {
    try {
      status = ui
        ? await ui.withLock(() => checkAutoBuyRunning(page, rl))
        : await checkAutoBuyRunning(page, rl);
    } catch (error) {
      verifyError = error;
      if (attempt < 2) {
        log(
          `Chưa xác minh được worker sau khi thiếu ACK (lần ${attempt}/2): ` +
            `${error.message}; thử lại.`
        );
        await page.waitForTimeout(5_000);
      }
    }
  }
  if (status?.running) {
    log(
      "Bot chưa gửi ACK bắt đầu đúng hạn nhưng worker Auto Mua đang chạy; " +
        "nhận worker hiện tại và tiếp tục theo dõi."
    );
    return { adopted: true, baseline: status.baseline, baselineText: status.baselineText };
  }
  if (status && !status.running) {
    const error = new Error(
      `Bot chưa xác nhận bắt đầu sau ${Math.round(waitMs / 1_000)} giây và /stop ` +
        "xác nhận không có worker đang chạy; agent sẽ bấm lại nút Bắt đầu."
    );
    error.code = "START_ACK_TIMEOUT";
    error.userMessage = error.message;
    throw error;
  }
  const error = new Error(
    `Bot chưa xác nhận bắt đầu trong ${Math.round(waitMs / 1_000)} giây và chưa ` +
      "xác minh được trạng thái worker; agent dừng để tránh mua chồng." +
      (verifyError ? ` Lỗi /stop: ${verifyError.message}` : "")
  );
  error.code = "START_ACK_UNVERIFIED";
  error.userMessage = error.message;
  throw error;
}

// Gửi /stop để kiểm tra worker auto-buy có đang chạy không.
// Không bao giờ bấm option trong menu /stop. Ưu tiên đọc phần tin mới
// (baselineText) để chống trôi khi chat bị trim hoặc lẫn tin thủ công;
// nếu bot báo rate-limit cho /stop thì chờ đúng delay rồi gửi lại.
async function checkAutoBuyRunning(page, rl) {
  const reader = chatTextReaders.get(page);
  if (!reader) throw new Error("Chưa khởi tạo theo dõi nội dung Telegram.");
  let composer = await ensureMessageComposer(page, rl);
  let baseline = getStopCheckBaseline(reader.snapshot().text);
  let baselineText = reader.snapshot().text;
  let rateLimitCount = countBotRateLimitNotices(baselineText);
  await sendBotCommand(page, composer, "/stop");
  const deadline = Date.now() + config.botResponseTimeoutMinutes * 60_000;
  let snapshot = reader.snapshot();
  while (Date.now() < deadline) {
    const result = getStopCheckResult(snapshot.text, baseline, baselineText);
    if (result === "auto-buy-running" || result === "auto-buy-not-running") {
      const running = result === "auto-buy-running";
      const evidence = snapshot.text.slice(-300).replace(/\s+/g, " ").trim();
      log(
        `Kết quả kiểm tra /stop: luồng Mua phôi ${running ? "đang chạy" : "KHÔNG chạy"}; ` +
          `tin mới nhất: ${evidence || "(trống)"}`
      );
      // Menu có thể chỉ còn task MUA của ICON (không phải Mua phôi). Nói rõ để
      // log "KHÔNG chạy" không bị hiểu nhầm là không có task nào.
      if (!running && /THƯỜNG\s*•\s*MUA/i.test(evidence)) {
        log(
          "Menu /stop chỉ có task MUA khác (ICON), không có luồng Mua phôi; " +
            "coi là rảnh cho chu kỳ mua phôi mới."
        );
      }
      return { running, baseline: getCycleBaseline(snapshot.text), baselineText: snapshot.text };
    }
    const checkFresh = getFreshSince(baselineText, snapshot.text);
    if (
      hasNewBotSystemError(snapshot.text, baseline.systemErrors) ||
      (checkFresh && countBotSystemErrors(checkFresh) > 0)
    ) {
      throwBotSystemError("trong lúc kiểm tra /stop");
    }
    const retryDelayMs =
      getFreshRateLimitDelay(getFreshSince(baselineText, snapshot.text)) ??
      getNewBotRateLimitDelay(snapshot.text, rateLimitCount);
    if (retryDelayMs !== null) {
      rateLimitCount = countBotRateLimitNotices(snapshot.text);
      if (retryDelayMs >= deadline - Date.now()) break;
      log(`Bot từ chối /stop do gửi quá nhanh; chờ ${Math.ceil(retryDelayMs / 1_000)} giây rồi gửi lại.`);
      await page.waitForTimeout(retryDelayMs);
      baseline = getStopCheckBaseline(reader.snapshot().text);
      baselineText = reader.snapshot().text;
      rateLimitCount = countBotRateLimitNotices(baselineText);
      composer = await refillComposer(page, rl, composer, "/stop");
      snapshot = reader.snapshot();
      continue;
    }
    const update = await waitForChatChange(page, reader, snapshot.version, deadline - Date.now());
    if (!update) break;
    snapshot = update;
  }
  const response = snapshot.text.slice(-1_000).replace(/\s+/g, " ").trim();
  throw new Error(
    `Không xác định được trạng thái Auto Mua Phôi sau /stop trong ` +
      `${config.botResponseTimeoutMinutes} phút; agent không khởi chạy chu kỳ mới. ` +
      `Phản hồi gần nhất: ${response || "(trống)"}`
  );
}

// Chờ chu kỳ hiện tại kết thúc: completed | purchase-stopped | inventory-full | system-error | stop-requested
// Ưu tiên đọc phần tin mới (baselineText) để chống trôi khi chat bị trim hoặc
// lẫn tin thủ công GLXH/chức năng khác; fallback đếm số lượng khi snapshot bị thay hẳn.
async function waitForCycleCompletion(page, baseline, baselineText = null) {
  const reader = chatTextReaders.get(page);
  if (!reader) throw new Error("Chưa khởi tạo theo dõi nội dung Telegram.");
  const startedAt = Date.now();
  // Chờ này chỉ chạy khi worker đã xác nhận chạy (adopt qua /stop hoặc vừa ack
  // sau click), nên orphan luôn được phép: cửa sổ không còn activity mà còn
  // terminal đặc thù auto-buy thì terminal đó mới hơn mọi activity đã trim.
  const baselineHadActivity =
    baseline.latestActivityMarker !== null ||
    baseline.started > 0 ||
    baseline.active > 0;
  let lastProgressLogAt = startedAt;
  let lastOrphanClearedAt = 0;
  let hintBaseline = baselineText;
  let snapshot = reader.snapshot();
  while (true) {
    if (Date.now() - startedAt > config.maxCycleWaitMinutes * 60_000) {
      throw new Error(
        `Quá thời gian chờ | chưa thấy tin hoàn tất sau ` +
          `${config.maxCycleWaitMinutes} phút; agent dừng, không tự khởi chạy lại.`
      );
    }
    if (reader.takeCommand("stopagent")) return { status: "stop-requested" };
    const freshOutcome = getCycleOutcomeFromFresh(
      getFreshSince(baselineText, snapshot.text),
      snapshot.text
    );
    if (freshOutcome) {
      return {
        ...freshOutcome,
        inventoryReceiptBaseline: baseline.inventoryReceived,
        inventoryReceiptBaselineText: baselineText,
        inventoryReceiptSystemErrors: baseline.systemErrors
      };
    }
    const orphanOutcome = getOrphanCycleOutcome(snapshot.text, baselineHadActivity);
    if (orphanOutcome && Date.now() - lastOrphanClearedAt >= ORPHAN_CLEARED_SUPPRESS_MS) {
      snapshot = await verifyTailOrphan(page, reader);
      lastOrphanClearedAt = Date.now();
      continue;
    }
    if (orphanOutcome) {
      log(
        "Cửa sổ đuôi chat trim mất dòng activity nhưng còn tin kết thúc chu kỳ; " +
          `nhận kết quả ${orphanOutcome.status}.`
      );
      return {
        ...orphanOutcome,
        inventoryReceiptBaseline: baseline.inventoryReceived,
        inventoryReceiptBaselineText: baselineText,
        inventoryReceiptSystemErrors: baseline.systemErrors
      };
    }
    if (hasNewBotSystemError(snapshot.text, baseline.systemErrors)) return { status: "system-error" };
    if (hasNewFullInventoryStop(snapshot.text, baseline.inventoryFullStops)) {
      return {
        status: "inventory-full",
        inventoryReceiptBaseline: baseline.inventoryReceived,
        inventoryReceiptBaselineText: baselineText,
        inventoryReceiptSystemErrors: baseline.systemErrors
      };
    }
    if (hasNewStoppedNotice(snapshot.text, baseline.stopped, baseline.autoBuyStopped, false)) {
      return { status: "purchase-stopped" };
    }
    const completedCount = getCycleCompletionNotice(snapshot.text, baseline);
    if (completedCount !== null) {
      return { status: "completed", playersBought: completedCount };
    }
    if (Date.now() - lastProgressLogAt >= 15 * 60_000) {
      const currentText = reader.snapshot().text;
      const markerState = baseline.latestActivityMarker
        ? (currentText.includes(baseline.latestActivityMarker) ? "có" : "không")
        : "không rõ (baseline không có marker)";
      const nearMiss = baselineText
        ? findNewNearMissControlCommand(hintBaseline, currentText.slice(-2000))
        : findNearMissControlCommand(currentText.slice(-2000));
      hintBaseline = currentText;
      log(
        `Vẫn chờ kết thúc chu kỳ (phút ${Math.floor((Date.now() - startedAt) / 60_000)}): ` +
          `chat ${currentText.length} ký tự, completion ${parseCompletionNotices(currentText).length} ` +
          `(baseline ${baseline.completions}), activity còn trong cửa sổ: ${markerState}.` +
          (nearMiss ? ` Có tin gần giống lệnh điều khiển (${nearMiss}) — kiểm tra chính tả.` : "")
      );
      lastProgressLogAt = Date.now();
    }
    const elapsedMs = Date.now() - startedAt;
    const update = await waitForChatChange(
      page,
      reader,
      snapshot.version,
      Math.min(config.maxCycleWaitMinutes * 60_000 - elapsedMs, CONTROL_COMMAND_STATUS_LOG_INTERVAL_MS * 4)
    );
    if (!update) continue;
    snapshot = update;
  }
}

// Gửi /stopauto và chờ bot xác nhận dừng.
// Trả về lệnh /startagent nhận trong lúc dừng để chạy tiếp, hoặc null.
async function stopPurchaseWorker(page, rl) {
  const reader = chatTextReaders.get(page);
  if (!reader) throw new Error("Chưa khởi tạo theo dõi nội dung Telegram.");
  let composer = await ensureMessageComposer(page, rl);
  const stopBaseline = getCycleBaseline(reader.snapshot().text);
  let stopBaselineText = reader.snapshot().text;
  const deadline = Date.now() + config.botResponseTimeoutMinutes * 60_000;
  let rateLimitCount = countBotRateLimitNotices(stopBaselineText);
  await sendBotCommand(page, composer, "/stopauto");
  log("Đã gửi /stopauto theo yêu cầu /stopagent; đang chờ xác nhận dừng.");
  let snapshot = reader.snapshot();
  let restartCommand = null;
  let lastOrphanClearedAt = 0;
  while (Date.now() < deadline) {
    for (const command of reader.takeCommandsMatching(["stopagent", ...CONTROL_START_COMMANDS])) {
      if (CONTROL_START_COMMANDS.includes(command)) {
        restartCommand = command;
        log(`Đã nhận /${command} trong lúc dừng; sẽ khởi động lại sau khi bot xác nhận dừng.`);
      } else {
        restartCommand = null;
      }
    }
    const orphanStopped =
      getOrphanCycleOutcome(snapshot.text, true) !== null;
    if (orphanStopped && Date.now() - lastOrphanClearedAt >= ORPHAN_CLEARED_SUPPRESS_MS) {
      snapshot = await verifyTailOrphan(page, reader);
      lastOrphanClearedAt = Date.now();
      continue;
    }
    const fresh = getFreshSince(stopBaselineText, snapshot.text);
    if (
      hasNewBotSystemError(snapshot.text, stopBaseline.systemErrors) ||
      (fresh && countBotSystemErrors(fresh) > 0)
    ) {
      throwBotSystemError("trong lúc chờ xác nhận dừng /stopauto");
    }
    if (isStopConfirmed(snapshot.text, fresh, stopBaseline)) {
      return restartCommand;
    }
    const retryDelayMs =
      getFreshRateLimitDelay(fresh) ??
      getNewBotRateLimitDelay(snapshot.text, rateLimitCount);
    if (retryDelayMs !== null) {
      rateLimitCount = countBotRateLimitNotices(snapshot.text);
      if (retryDelayMs >= deadline - Date.now()) break;
      log(`Bot từ chối /stopauto do gửi quá nhanh; chờ ${Math.ceil(retryDelayMs / 1_000)} giây rồi gửi lại.`);
      await page.waitForTimeout(retryDelayMs);
      snapshot = reader.snapshot();
      const freshAfterWait = getFreshSince(stopBaselineText, snapshot.text);
      if (
        hasNewBotSystemError(snapshot.text, stopBaseline.systemErrors) ||
        (freshAfterWait && countBotSystemErrors(freshAfterWait) > 0)
      ) {
        throwBotSystemError("trong lúc chờ xác nhận dừng /stopauto");
      }
      if (
        getOrphanCycleOutcome(snapshot.text, true) !== null &&
        Date.now() - lastOrphanClearedAt >= ORPHAN_CLEARED_SUPPRESS_MS
      ) {
        snapshot = await verifyTailOrphan(page, reader);
        lastOrphanClearedAt = Date.now();
      }
      if (isStopConfirmed(snapshot.text, getFreshSince(stopBaselineText, snapshot.text), stopBaseline)) {
        return restartCommand;
      }
      // Tiêu thụ warning cũ và mọi tin hiện có TRƯỚC khi gửi lại /stopauto;
      // phản hồi mới đến rất nhanh vẫn nằm sau baseline nên không bị bỏ sót.
      stopBaselineText = snapshot.text;
      rateLimitCount = countBotRateLimitNotices(stopBaselineText);
      composer = await refillComposer(page, rl, composer, "/stopauto");
      log("Đã gửi lại /stopauto; tiếp tục chờ xác nhận dừng.");
      continue;
    }
    const update = await waitForChatChange(page, reader, snapshot.version, deadline - Date.now());
    if (!update) break;
    snapshot = update;
  }
  throw new Error(
    `Đã gửi /stopauto nhưng không nhận xác nhận dừng trong ${config.botResponseTimeoutMinutes} phút.`
  );
}

// Worker bị nghi ngờ đang chạy (guard positional) nhưng /stop không xác nhận:
// dùng bằng chứng 5 phút thay vì đếm lần nghi ngờ. Trả về:
// - { decision: "adopt", baseline, baselineText }: thấy mua/ping mới -> caller chờ.
// - { decision: "ended", outcome }: thấy terminal/stop/E006 -> caller xử lý chung.
// - { decision: "clear" }: 5 phút im ắng -> coi như đã dừng, caller bấm tiếp.
async function confirmSuspectedWorker(page, reader, timeoutMs = 5 * 60_000) {
  const startText = reader.snapshot().text;
  const baseline = getCycleBaseline(startText);
  const baselineText = startText;
  const startedAt = Date.now();
  let snapshot = reader.snapshot();
  while (Date.now() - startedAt < timeoutMs) {
    if (reader.takeCommand("stopagent")) {
      return { decision: "ended", outcome: { status: "stop-requested" } };
    }
    const fresh = getFreshSince(baselineText, snapshot.text);
    const terminal = getCycleOutcomeFromFresh(fresh, fresh);
    if (terminal) return { decision: "ended", outcome: terminal };
    if (fresh && countBotSystemErrors(fresh) > 0) {
      return { decision: "ended", outcome: { status: "system-error" } };
    }
    if (fresh && countStoppedNotices(fresh) > 0) {
      return { decision: "ended", outcome: { status: "purchase-stopped" } };
    }
    if (fresh && countFullInventoryStops(fresh) > 0) {
      return { decision: "ended", outcome: { status: "inventory-full" } };
    }
    const completedCount = fresh ? getLatestCompletionAfterActivity(fresh) : null;
    if (completedCount !== null) {
      return { decision: "ended", outcome: { status: "completed", playersBought: completedCount } };
    }
    const freshText = fresh || "";
    const newPurchase = countMatches(freshText, PURCHASE_RE) > 0;
    const newActivity =
      freshText &&
      (countMatches(freshText, STARTED_RE) > 0 ||
        countMatches(freshText, ACTIVE_RE) > 0);
    if (newPurchase || newActivity) {
      return {
        decision: "adopt",
        baseline: getCycleBaseline(snapshot.text),
        baselineText: snapshot.text
      };
    }
    const remaining = timeoutMs - (Date.now() - startedAt);
    const update = await waitForChatChange(
      page,
      reader,
      snapshot.version,
      Math.min(remaining, 10_000)
    );
    if (!update) continue;
    snapshot = update;
  }
  return { decision: "clear" };
}

async function waitForInventoryReceipt(page, outcome) {
  const reader = chatTextReaders.get(page);
  if (!reader) throw new Error("Chưa khởi tạo theo dõi nội dung Telegram.");
  const baselineText = outcome.inventoryReceiptBaselineText || "";
  const baselineCount = outcome.inventoryReceiptBaseline ?? 0;
  const deadline = Date.now() + config.botResponseTimeoutMinutes * 60_000;
  let snapshot = reader.snapshot();
  while (Date.now() < deadline) {
    const fresh = getFreshSince(baselineText, snapshot.text);
    const received =
      (fresh && getLatestInventoryReceived(fresh) !== null) ||
      countInventoryReceivedNotices(snapshot.text) > baselineCount;
    if (received) {
      const count = getLatestInventoryReceived(fresh || snapshot.text);
      log(`Bot đã xác nhận nhận ${count ?? "đủ"} cầu thủ vào kho; tiếp tục bước kế tiếp.`);
      return count;
    }
    if (reader.takeCommand("stopagent")) {
      return null;
    }
    if (hasNewBotSystemError(snapshot.text, outcome.inventoryReceiptSystemErrors ?? 0)) {
      throwBotSystemError("trong lúc chờ bot nhận cầu thủ vào kho");
    }
    const update = await waitForChatChange(
      page,
      reader,
      snapshot.version,
      Math.min(deadline - Date.now(), CONTROL_COMMAND_STATUS_LOG_INTERVAL_MS * 4)
    );
    if (update) snapshot = update;
  }
  log(
    `Bot đã báo kho đầy nhưng chưa xác nhận nhận cầu thủ vào kho trong ` +
      `${config.botResponseTimeoutMinutes} phút; giữ an toàn, không thực hiện ` +
      "lệnh kế tiếp và chờ /startagent mới."
  );
  return null;
}

module.exports = {
  waitForStartAcknowledgement,
  checkAutoBuyRunning,
  waitForCycleCompletion,
  stopPurchaseWorker,
  confirmSuspectedWorker,
  waitForInventoryReceipt
};
