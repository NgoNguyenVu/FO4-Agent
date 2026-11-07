// Chạy một lượt Auto Nâng Cấp: mở app -> cấu hình -> chọn target -> lọc phôi ->
// kiểm tra cuối -> start -> chờ kết quả. Toàn bộ parser nằm ở patterns.js.
const {
  config,
  getUpgradeSpec,
  validateUpgradeConfig
} = require("../config");
const {
  chatTextReaders,
  waitForChatChange,
  verifyTailOrphan,
  ORPHAN_CLEARED_SUPPRESS_MS
} = require("../../lib/chat-runtime");
const { withTimeout, isBrowserSessionClosed } = require("../../lib/playwright-utils");
const { CONTROL_START_COMMANDS } = require("../../lib/control-commands");
const {
  countBotSystemErrors,
  hasNewBotSystemError,
  countBotRateLimitNotices,
  getNewBotRateLimitDelay,
  getFreshRateLimitDelay
} = require("../../lib/bot-signals");
const { getFreshSince } = require("../../lib/text-utils");
const {
  ensureMessageComposer,
  refillComposer
} = require("../composer");
const {
  sendBotCommand,
  getPaymentFrameLocator,
  inspectPaymentFrames,
  closeMiniApp
} = require("../telegram-io");
const { log } = require("../agent-log");
const {
  UG_STOP_COMMAND,
  UG_START_ACK_MS,
  UG_PROGRESS_LOG_MS,
  countUpgradeStarts,
  parseUpgradeProgress,
  latestUpgradeProgress,
  parseUpgradeShortage,
  countUpgradeTerminals,
  parseUpgradeSummary,
  hasNewUpgradeTerminal,
  getUpgradeCycleBaseline,
  hasNewUpgradeStart,
  getUpgradeOutcomeFromFresh,
  getUpgradeRunOutcome,
  getOrphanUpgradeOutcome,
  parseUpgradeTargetCards,
  summarizeUpgradeTargetCards,
  countInventoryIcons,
  parseOvrList
} = require("./patterns");
const {
  getUpgradeFrame,
  reloadUpgradeTargetList,
  configureUpgradeFrame,
  readUpgradeTargetCards,
  openUpgradeFrameForCheck,
  inspectUpgradeTargetAvailability,
  selectUpgradeTarget,
  filterUpgradePhoi,
  checkUpgradeAndStart,
  pressUpgradeStart,
  dismissGoodLuckPopup
} = require("./mini-app");

async function waitForUpgradeStartAck(page, baseline) {
  const reader = chatTextReaders.get(page);
  if (!reader) throw new Error("Chưa khởi tạo theo dõi nội dung Telegram.");
  const startedAt = Date.now();
  const deadline = startedAt + UG_START_ACK_MS;
  let snapshot = reader.snapshot();
  // Backend có thể ack rất chậm; log nhịp tim để biết agent đang chờ chứ không treo.
  const heartbeat = setInterval(() => {
    log(
      `Đang chờ bot xác nhận khởi động nâng cấp (phút ${Math.floor(
        (Date.now() - startedAt) / 60_000
      )}/${Math.round(UG_START_ACK_MS / 60_000)})...`
    );
  }, 60_000);
  try {
    while (Date.now() < deadline) {
      const fresh = baseline.text ? getFreshSince(baseline.text, snapshot.text) : null;
      if (
        hasNewBotSystemError(snapshot.text, baseline.systemErrors ?? 0) ||
        (fresh && countBotSystemErrors(fresh) > 0)
      ) {
        const error = new Error(
          "Bot trả E006 trong lúc chờ xác nhận khởi động nâng cấp; dừng và chờ lệnh mới."
        );
        error.code = "BOT_SYSTEM_ERROR";
        throw error;
      }
      const freshStarted = fresh ? countUpgradeStarts(fresh) > 0 : false;
      const freshProgress = fresh ? parseUpgradeProgress(fresh).length > 0 : false;
      if (
        freshStarted ||
        freshProgress ||
        (fresh && countUpgradeTerminals(fresh) > 0) ||
        countUpgradeTerminals(snapshot.text) > (baseline.terminals ?? 0) ||
        hasNewUpgradeTerminal(snapshot.text, baseline) ||
        hasNewUpgradeStart(snapshot.text, baseline, baseline.text) ||
        parseUpgradeProgress(snapshot.text).length > (baseline.progress ?? 0)
      ) {
        return;
      }
      const update = await waitForChatChange(page, reader, snapshot.version, deadline - Date.now());
      if (!update) break;
      snapshot = update;
    }
    throw new Error(
      `Bot chưa xác nhận khởi động nâng cấp trong ${UG_START_ACK_MS / 60_000} phút; dừng và không tự gửi lại.`
    );
  } finally {
    clearInterval(heartbeat);
  }
}

async function waitForUpgradeCompletion(page, baseline, baselineText = null, timeoutMs = null, ui = null) {
  const reader = chatTextReaders.get(page);
  if (!reader) throw new Error("Chưa khởi tạo theo dõi nội dung Telegram.");
  const spec = getUpgradeSpec();
  const limitMs =
    timeoutMs ??
    (spec.maxUpgradeWaitMinutes * 60_000);
  const startedAt = Date.now();
  const baselineHadStart = true;
  let lastProgressLogAt = startedAt;
  let lastProgressKey = "";
  let lastShortageKey = "";
  let lastOrphanClearedAt = 0;
  let freshWindowBrokenWarned = false;
  let nextTargetCheckAt = startedAt + spec.targetCheckDelaySeconds * 1_000;
  let lastTargetCheckKey = "";
  let targetExhaustedAt = 0;
  let autoOpenAttempted = false;
  let snapshot = reader.snapshot();
  while (true) {
    if (Date.now() - startedAt > limitMs) {
      throw new Error(
        `Quá thời gian chờ nâng cấp sau ${Math.round(limitMs / 60_000)} phút; dừng, không tự chạy lại.`
      );
    }
    if (reader.takeCommand("stopagent")) return { status: "stop-requested" };
    const { outcome: freshOutcome, fresh } = getUpgradeRunOutcome(
      snapshot.text,
      baseline,
      baselineText
    );
    if (freshOutcome) return freshOutcome;
    if (!fresh && !freshWindowBrokenWarned) {
      freshWindowBrokenWarned = true;
      log(
        "Không tách được phần tin mới sau khi bắt đầu nâng (Telegram thay snapshot chat); " +
          "chuyển sang fallback đếm terminal trên toàn bộ cửa sổ chat."
      );
    }
    const orphanOutcome = getOrphanUpgradeOutcome(
      snapshot.text,
      baselineHadStart,
      baseline.terminals ?? 0
    );
    if (orphanOutcome && Date.now() - lastOrphanClearedAt >= ORPHAN_CLEARED_SUPPRESS_MS) {
      snapshot = await verifyTailOrphan(page, reader);
      lastOrphanClearedAt = Date.now();
      continue;
    }
    if (orphanOutcome) return orphanOutcome;
    if (hasNewBotSystemError(snapshot.text, baseline.systemErrors)) return { status: "system-error" };
    // Nếu bot không gửi terminal nhưng mini-app vẫn mở, đọc lại kho định kỳ.
    // Chỉ kết luận khi form vẫn đúng spec và vừa tải lại dữ liệu thật; tránh
    // coi target đang khóa/training là "đã hết target".
    if (Date.now() >= nextTargetCheckAt) {
      nextTargetCheckAt = Date.now() + spec.targetCheckIntervalSeconds * 1_000;
      // Kiểm tra mini-app là thao tác UI: chỉ chiếm khóa trong đoạn này.
      if (ui) await ui.acquire();
      try {
        let frameInfo = null;
        try {
          frameInfo = await inspectPaymentFrames(page);
        } catch (error) {
          if (isBrowserSessionClosed(error, page)) throw error;
        }
        if (!(frameInfo?.count > 0 && frameInfo.visible) && !autoOpenAttempted) {
          autoOpenAttempted = true;
          log(
            "Mini-app nâng cấp đã đóng sau khi bắt đầu; thử mở lại bằng menu còn trong chat " +
              "(không gửi /tn) để kiểm tra target."
          );
          let opened = null;
          try {
            opened = await withTimeout(
              openUpgradeFrameForCheck(page),
              config.upgradeFrameTimeoutSeconds * 1_000 + 30_000,
              "mở lại mini-app nâng cấp để kiểm tra target"
            );
          } catch (error) {
            if (isBrowserSessionClosed(error, page)) throw error;
            log(`Không mở lại được mini-app nâng cấp để kiểm tra: ${error.message}`);
          }
          if (opened) {
            frameInfo = { count: 1, visible: true };
            log("Đã mở lại mini-app nâng cấp bằng menu cũ; đọc trạng thái target.");
          } else {
            log("Không thấy menu nâng cấp còn trong chat; không gửi /tn, tiếp tục chờ bot.");
          }
        }
        if (frameInfo?.count > 0 && frameInfo.visible) {
          const frame = getPaymentFrameLocator(page);
          let availability = null;
          try {
            availability = await withTimeout(
              inspectUpgradeTargetAvailability(frame, page, spec),
              config.upgradeFrameTimeoutSeconds * 1_000 + 15_000,
              "kiểm tra target còn lại trong mini-app"
            );
          } catch (error) {
            if (isBrowserSessionClosed(error, page)) throw error;
            log(`Chưa kiểm tra được target còn lại trong mini-app: ${error.message}`);
          }
          if (availability?.status === "exhausted") {
            const s = availability.summary;
            if (!targetExhaustedAt) {
              targetExhaustedAt = Date.now();
              log(
                `Mini-app nâng cấp tạm thời không còn icon target dưới +${spec.targetGrade} sau khi tải lại kho ` +
                  `(${s.total} thẻ: không badge ICON ${s.notIcon}, khóa ${s.locked}, ` +
                  `đã đạt +${spec.targetGrade} ${s.reachedTarget}, hợp lệ ${s.eligible}); ` +
                  `sẽ xác nhận lại sau ${Math.round(spec.targetCheckIntervalSeconds)} giây.`
              );
            } else {
              log(
                `Xác nhận lần 2: mini-app không còn icon target dưới +${spec.targetGrade} ` +
                  `(${s.total} thẻ: không badge ICON ${s.notIcon}, khóa ${s.locked}, ` +
                  `đã đạt +${spec.targetGrade} ${s.reachedTarget}, hợp lệ ${s.eligible}); ` +
                  "dừng chờ bot và về trạng thái chờ lệnh."
              );
              return { status: "targets-exhausted" };
            }
          } else {
            targetExhaustedAt = 0;
          }
          if (availability?.status === "has-targets") {
            const s = availability.summary;
            const key = `has:${s.eligible}:${s.locked}:${s.reachedTarget}`;
            if (key !== lastTargetCheckKey) {
              lastTargetCheckKey = key;
              log(
                `Kiểm tra target trong mini-app: còn ${s.eligible} icon dưới +${spec.targetGrade} ` +
                  `(${s.total} thẻ, ${s.locked} khóa, ${s.reachedTarget} đã đạt target); tiếp tục chờ bot.`
              );
            }
          } else if (availability) {
            const key = `unknown:${availability.reason}`;
            if (key !== lastTargetCheckKey) {
              lastTargetCheckKey = key;
              log(`Chưa kết luận được target còn lại trong mini-app (${availability.reason}); tiếp tục chờ bot.`);
            }
          }
        }
      } finally {
        if (ui) ui.release();
      }
    }
    const progress = latestUpgradeProgress(fresh || "");
    const progressKey = progress ? `${progress.grade}/${progress.materials}` : "";
    if (progressKey && progressKey !== lastProgressKey) {
      lastProgressKey = progressKey;
      log(`Nâng cấp tiến triển: lên +${progress.grade} (nguyên liệu còn ${progress.materials}).`);
    }
    const shortage = parseUpgradeShortage(snapshot.text);
    const shortageKey = shortage ? `${shortage.maxPhoi}/${shortage.needRatio}/${shortage.best}` : "";
    if (shortageKey && shortageKey !== lastShortageKey) {
      lastShortageKey = shortageKey;
      log(`Bot báo thiếu nguyên liệu: tối đa ${shortage.maxPhoi} phôi để đạt ${shortage.needRatio}%, tốt nhất ${shortage.best}%.`);
    }
    if (Date.now() - lastProgressLogAt >= UG_PROGRESS_LOG_MS) {
      // fresh có thể null khi Telegram thay snapshot; heartbeat vẫn phải đọc
      // progress từ toàn cửa sổ để log không báo sai "chưa có".
      const observed = progress || latestUpgradeProgress(snapshot.text);
      const observedKey = observed ? `${observed.grade}/${observed.materials}` : "";
      log(
        `Vẫn chờ nâng cấp (phút ${Math.floor((Date.now() - startedAt) / 60_000)}): ` +
          `tiến triển hiện tại ${observedKey || "chưa có"} ` +
          `(terminal ${countUpgradeTerminals(snapshot.text)}/${baseline.terminals ?? 0}).`
      );
      lastProgressLogAt = Date.now();
    }
    const update = await waitForChatChange(
      page,
      reader,
      snapshot.version,
      Math.min(limitMs - (Date.now() - startedAt), 60_000)
    );
    if (!update) continue;
    snapshot = update;
  }
}

async function stopUpgradeWorker(page, rl) {
  const reader = chatTextReaders.get(page);
  if (!reader) throw new Error("Chưa khởi tạo theo dõi nội dung Telegram.");
  let composer = await ensureMessageComposer(page, rl);
  const stopBaseline = getUpgradeCycleBaseline(reader.snapshot().text);
  let stopBaselineText = reader.snapshot().text;
  const deadline = Date.now() + config.botResponseTimeoutMinutes * 60_000;
  let rateLimitCount = countBotRateLimitNotices(stopBaselineText);
  await sendBotCommand(page, composer, UG_STOP_COMMAND);
  log("Đã gửi /stopnc; đang chờ bot xác nhận dừng nâng cấp.");
  let snapshot = reader.snapshot();
  let restartCommand = null;
  while (Date.now() < deadline) {
    for (const command of reader.takeCommandsMatching(["stopagent", ...CONTROL_START_COMMANDS])) {
      if (CONTROL_START_COMMANDS.includes(command)) {
        restartCommand = command;
        log(`Đã nhận /${command} trong lúc dừng nâng cấp; sẽ chạy tiếp sau khi xác nhận.`);
      } else {
        restartCommand = null;
      }
    }
    const fresh = getFreshSince(stopBaselineText, snapshot.text);
    if (
      hasNewBotSystemError(snapshot.text, stopBaseline.systemErrors) ||
      (fresh && countBotSystemErrors(fresh) > 0)
    ) {
      const error = new Error("Bot trả E006 trong lúc chờ /stopnc; dừng và chờ lệnh mới.");
      error.code = "BOT_SYSTEM_ERROR";
      throw error;
    }
    const stopped =
      countUpgradeTerminals(fresh || "") > 0 ||
      countUpgradeTerminals(snapshot.text) > stopBaseline.terminals;
    if (stopped) return restartCommand;
    const retryDelayMs =
      getFreshRateLimitDelay(fresh) ??
      getNewBotRateLimitDelay(snapshot.text, rateLimitCount);
    if (retryDelayMs !== null) {
      rateLimitCount = countBotRateLimitNotices(snapshot.text);
      if (retryDelayMs >= deadline - Date.now()) break;
      log(`Bot từ chối /stopnc do gửi quá nhanh; chờ ${Math.ceil(retryDelayMs / 1_000)} giây rồi gửi lại.`);
      await page.waitForTimeout(retryDelayMs);
      // Tiêu thụ warning cũ và mọi tin hiện có TRƯỚC khi gửi lại: phản hồi mới
      // (kể cả đến rất nhanh) vẫn nằm sau baseline và không bị bỏ sót.
      snapshot = reader.snapshot();
      stopBaselineText = snapshot.text;
      rateLimitCount = countBotRateLimitNotices(stopBaselineText);
      composer = await refillComposer(page, rl, composer, UG_STOP_COMMAND);
      log("Đã gửi lại /stopnc.");
      continue;
    }
    const update = await waitForChatChange(page, reader, snapshot.version, deadline - Date.now());
    if (!update) break;
    snapshot = update;
  }
  throw new Error(`Đã gửi /stopnc nhưng bot chưa xác nhận dừng trong ${config.botResponseTimeoutMinutes} phút.`);
}

// Chạy trọn 1 target: mở app -> cấu hình -> chọn target -> lọc phôi ->
// kiểm tra cuối -> start -> chờ kết quả. Sai spec chỗ nào là throw (không start).
// dryRun=true: đi hết tới UI kiểm tra cuối rồi DỪNG, không bấm start — dùng để
// kiểm tra cấu hình/thử integration mà không tốn BP/phôi.
async function runUpgradeOnce({
  page,
  rl,
  spec = getUpgradeSpec(),
  targetId = null,
  excludedTargetIds = new Set(),
  timeoutMs = null,
  dryRun = false,
  ui = null
}) {
  validateUpgradeConfig();
  // Mỗi phase có bound riêng (chỉ phòng renderer treo; thao tác khỏe mạnh xong
  // trong vài chục giây, lỗi spec vẫn throw rõ ràng bên trong).
  let frame = await withTimeout(getUpgradeFrame(page, rl), 8 * 60_000, "mở mini-app nâng cấp");
  try {
    await withTimeout(configureUpgradeFrame(frame, page, spec), 12 * 60_000, "cấu hình nâng cấp");
  } catch (error) {
    if (error.code !== "UPGRADE_MODE_LOAD_TIMEOUT") throw error;
    // Không có thẻ target nào thì đừng retry mở lại mini-app vô ích: đây là
    // trạng thái "đã hết icon dưới target", không phải app load chậm.
    const earlyCards = await readUpgradeTargetCards(frame).catch(() => []);
    if (!earlyCards.length) {
      const empty = new Error(
        "Mini-app nâng cấp không có thẻ cầu thủ nào; coi như đã hết icon dưới target."
      );
      empty.code = "NO_UPGRADE_TARGETS";
      throw empty;
    }
    // getUpgradeFrame tự đóng mini-app cũ (closeMiniApp) trước khi mở lại; không
    // bấm Escape ở đây để tránh đóng nhầm khi iframe đang re-render.
    log("Mini-app nâng chưa render xong phần chọn mode; mở lại mini-app một lần.");
    frame = await withTimeout(getUpgradeFrame(page, rl), 8 * 60_000, "mở lại mini-app nâng cấp");
    await withTimeout(configureUpgradeFrame(frame, page, spec), 12 * 60_000, "cấu hình lại nâng cấp");
  }
  const cards = await withTimeout(readUpgradeTargetCards(frame), 60_000, "đọc danh sách cầu thủ");
  const allCandidates = parseUpgradeTargetCards(cards, spec.targetGrade);
  const excluded = new Set([...excludedTargetIds].map((id) => String(id).toLowerCase()));
  const candidates = allCandidates.filter(
    (candidate) => !excluded.has(candidate.id.toLowerCase())
  );
  log(
    `Kho hiện còn ${allCandidates.length} icon dưới target trước khi nâng cấp ` +
    `(có thể chọn ${candidates.length} target trong phase này).`
  );
  if (!candidates.length) {
    if (!allCandidates.length) {
      const s = summarizeUpgradeTargetCards(cards, spec.targetGrade);
      log(
        `Không có icon hợp lệ để nâng: ${s.total} thẻ có _id ` +
          `(không badge ICON: ${s.notIcon}, bị khóa: ${s.locked}, ` +
          `đã đạt +${spec.targetGrade}: ${s.reachedTarget}, ` +
          `thiếu _id/grade: ${s.invalid}, trùng: ${s.duplicate}, hợp lệ: ${s.eligible}).`
      );
    } else {
      log(
        `Tất cả ${allCandidates.length} icon hợp lệ đều đã bị blacklist trong phase này.`
      );
    }
    const error = new Error("Không còn cầu thủ icon nào dưới target để nâng.");
    error.code = "NO_UPGRADE_TARGETS";
    throw error;
  }
  let target = null;
  if (targetId) {
    target = candidates.find((c) => c.id.toLowerCase() === String(targetId).toLowerCase());
    if (!target) {
      const error = new Error(
        `Cầu thủ _id:${targetId} không thuộc diện nâng (không icon/khóa/đã đạt target).`
      );
      error.code = "NO_UPGRADE_TARGETS";
      throw error;
    }
  } else {
    target = candidates[0];
  }
  log(`Target nâng cấp: ${target.name} (+${target.grade}, giá ${target.priceRaw}).`);
  await withTimeout(selectUpgradeTarget(frame, page, target), 3 * 60_000, "chọn cầu thủ chính");
  const phoiCount = await withTimeout(
    filterUpgradePhoi(frame, page, parseOvrList(spec.ovrPhoi), {
      ovrPhoi: spec.ovrPhoi,
      maxPriceEach: spec.maxPriceEach
    }),
    3 * 60_000,
    "lọc phôi từ kho"
  );
  const finalUi = await withTimeout(
    checkUpgradeAndStart(frame, page, spec, phoiCount),
    3 * 60_000,
    "kiểm tra cuối nâng cấp"
  );
  if (dryRun) {
    log(`Dry-run: dừng ở UI kiểm tra cuối (target ${target.id}, ${phoiCount} phôi), KHÔNG bấm bắt đầu nâng cấp.`);
    return { dryRun: true, outcome: null, target, phoiCount, finalUi };
  }
  const reader = chatTextReaders.get(page);
  if (!reader) throw new Error("Chưa khởi tạo theo dõi nội dung Telegram.");
  const body = reader.snapshot().text;
  const ackBaseline = {
    ...getUpgradeCycleBaseline(body),
    progress: parseUpgradeProgress(body).length,
    text: body
  };
  await withTimeout(pressUpgradeStart(frame), 2 * 60_000, "bấm bắt đầu nâng cấp");
  await withTimeout(dismissGoodLuckPopup(page), 30_000, "đóng popup chúc may mắn").catch(() => false);
  // Từ đây chỉ chờ ack/kết quả trong chat; waitForUpgradeCompletion tự lấy
  // khóa trong các lần kiểm tra mini-app.
  if (ui) ui.release();
  try {
    await waitForUpgradeStartAck(page, ackBaseline);
    const acknowledgedText = reader.snapshot().text;
    const immediateOutcome = getUpgradeOutcomeFromFresh(
      getFreshSince(ackBaseline.text, acknowledgedText),
      acknowledgedText
    );
    const ackTerminalChanged = hasNewUpgradeTerminal(acknowledgedText, ackBaseline);
    const snapshotOutcome =
      immediateOutcome ||
      (ackTerminalChanged || countUpgradeTerminals(acknowledgedText) > ackBaseline.terminals
        ? (() => {
            const summary = parseUpgradeSummary(acknowledgedText);
            return summary ? { status: "completed", ...summary } : null;
          })()
        : null);
    if (snapshotOutcome) {
      log("Bot đã gửi completion ngay sau khi bắt đầu nâng; ghi nhận kết quả trực tiếp.");
      return { outcome: snapshotOutcome, target, phoiCount };
    }
    const cycleBaseline = getUpgradeCycleBaseline(acknowledgedText);
    log(`Đã bắt đầu nâng cấp ${target.name} lên +${spec.targetGrade}.`);
    const outcome = await waitForUpgradeCompletion(
      page,
      cycleBaseline,
      acknowledgedText,
      timeoutMs,
      ui
    );
    return { outcome, target, phoiCount };
  } finally {
    if (ui) await ui.acquire();
  }
}

async function checkInventoryIcons(page, rl) {
  let frame = null;
  try {
    frame = await withTimeout(getUpgradeFrame(page, rl), 8 * 60_000, "mở mini-app để kiểm tra kho");
    let cards = await withTimeout(
      readUpgradeTargetCards(frame),
      60_000,
      "đọc số icon trong kho"
    );
    if (!cards.length) {
      // Đọc rỗng có thể gặp khi mini-app đang tải lại kho; không kết luận "hết
      // icon" khi chưa xác nhận được reload. Giữ chờ trong bound trước khi trả
      // INVENTORY_READ_UNCONFIRMED để không hủy nhịp mua khi chưa chắc chắn.
      const reloadDeadline = Date.now() + config.upgradeFrameTimeoutSeconds * 1_000;
      let reloaded = false;
      while (!reloaded) {
        const remainingMs = reloadDeadline - Date.now();
        if (remainingMs <= 0) break;
        reloaded = await reloadUpgradeTargetList(frame, page, remainingMs);
        if (!reloaded) {
          await page.waitForTimeout(1_000);
        }
      }
      if (!reloaded) {
        throw Object.assign(
          new Error(
            "Mini-app chưa xác nhận tải lại danh sách kho; không thể kết luận kho hết icon."
          ),
          { code: "INVENTORY_READ_UNCONFIRMED" }
        );
      }
      cards = await withTimeout(
        readUpgradeTargetCards(frame),
        60_000,
        "đọc lại số icon trong kho"
      );
    }
    const count = countInventoryIcons(cards);
    log(`Kiểm tra kho trước khi chạy: còn ${count} icon.`);
    return count;
  } finally {
    if (frame) await closeMiniApp(page).catch(() => {});
  }
}

module.exports = {
  waitForUpgradeStartAck,
  waitForUpgradeCompletion,
  stopUpgradeWorker,
  checkInventoryIcons,
  runUpgradeOnce
};
