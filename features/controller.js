// Controller trung tâm: giữ Telegram session, nhận lệnh điều khiển và điều phối
// các feature độc lập:
//   - features/buy      : Auto Mua Phôi
//   - features/upgrade  : Auto Nâng Cấp
//   - features/icon-buy : Mua ICON yêu thích qua Chèn Member Thường
// Controller chỉ quyết định chạy phase nào; logic mua/nâng nằm hoàn toàn trong
// module tương ứng.
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const { isTelegramLoginPage } = require("../lib/browser-session");
const { withDeadline } = require("../lib/with-deadline");
const {
  withTimeout,
  isPlaywrightTimeout,
  isBrowserSessionClosed,
  isNavigationError
} = require("../lib/playwright-utils");
const {
  chatTextReaders,
  observeChatText,
  waitForTextToSettle,
  waitForChatChange,
  verifyTailOrphan,
  findNewNearMissControlCommand
} = require("../lib/chat-runtime");
const {
  countBotSystemErrors,
  hasNewBotSystemError
} = require("../lib/bot-signals");
const { isRecentIconActivity } = require("../lib/icon-activity");
const {
  CONTROL_START_COMMANDS,
  CONTROL_MODE_BY_COMMAND
} = require("../lib/control-commands");
const {
  CONTROL_COMMAND_STATUS_LOG_INTERVAL_MS,
  PLAYWRIGHT_TIMEOUT_MS
} = require("../lib/bot-patterns");
const { config, validateConfig } = require("./config");
const { getLaunchMode, getDefaultLaunchMode } = require("../lib/launch-modes");
const { log, logError } = require("./agent-log");
const { createUiLock } = require("../lib/ui-lock");
const { getLifecycle } = require("../lib/lifecycle");
const { getWorkerRegistry } = require("../lib/worker-registry");
const { createWorkerSession } = require("../lib/worker-session");
const {
  createE006Cooldown,
  identifyE006Flow,
  isE006Error,
  E006_FLOWS
} = require("../lib/e006-cooldown");
const {
  promptWakeable,
  wakeAllPendingPrompts,
  setWaitingForRecoveryPrompt,
  isWaitingForPrompt
} = require("./interactive-prompt");
const {
  openTelegramPage,
  launchTelegramContext,
  closeMiniApp
} = require("./telegram-io");
const { ensureMessageComposer } = require("./composer");
const {
  checkAutoBuyRunning,
  waitForCycleCompletion,
  settleBuyOutcome,
  INVENTORY_RECEIPT_RETRY_MS,
  BUY_TIMEOUT_RECOVERY_COOLDOWN_MS,
  createBuyCompletionRecord,
  getTradeFrame,
  configureCycle,
  waitForStartAcknowledgement,
  stopPurchaseWorker,
  confirmSuspectedWorker,
  getCycleBaseline,
  countStartedNotices,
  getLatestStartedMarker,
  getLatestWorkerId,
  getLatestAutoBuyStatus,
  getLatestActivityMarker,
  isEarlyCompletion,
  countInventoryReceivedNotices
} = require("./buy");
const {
  runSingleUpgrade,
  pivotMasterToUpgrade,
  checkInventoryIcons,
  decideInventoryAction,
  stopUpgradeWorker,
  upgradeFailureBackoffMs
} = require("./upgrade");
const { runIconBuy } = require("./icon-buy");
const { iconReceivePivotPlan } = require("./upgrade/receive-pivot");

async function restoreTelegramSession(context, page, rl, onCommand) {
  ({ context, page } = await openTelegramPage(context, page));
  if (await isTelegramLoginPage(page)) {
    log("Telegram Web chưa đăng nhập sau khi khôi phục; cần đăng nhập lại trước khi tiếp tục.");
  }
  await observeChatText(page, onCommand);
  await ensureMessageComposer(page, rl);
  const reader = chatTextReaders.get(page);
  reader.arm();
  await waitForTextToSettle(reader, 1_500, 30_000, page);
  log("Đã mở lại Telegram Web và khôi phục theo dõi chat.");
  return { context, page, reader };
}

async function main({ launchMode } = {}) {
  const resolvedMode = getLaunchMode(launchMode) || getDefaultLaunchMode();
  const enabledFeatures = new Set(resolvedMode.features);
  const iconEnabled = enabledFeatures.has("icon-buy");
  const buyUpgradeEnabled = enabledFeatures.has("buy-upgrade");
  log(
    `Launch mode [${resolvedMode.id}] ${resolvedMode.key}; ` +
      `features: ${resolvedMode.features.join(", ")}.`
  );
  validateConfig();
  const rl = readline.createInterface({ input: stdin, output: stdout });
  let context = await withTimeout(launchTelegramContext(), 180_000, "mở trình duyệt Telegram");
  let page = context.pages()[0] || (await withTimeout(context.newPage(), 60_000, "mở trang Telegram"));
  let remoteResetRequested = false;
  let resetClosePromise = Promise.resolve();
  // /resetagent chỉ tự chạy lại nếu agent ĐANG chạy trước khi reset. Nếu người
  // dùng đã /stopagent rồi mới reset thì giữ nguyên trạng thái nghỉ.
  let autoResumeAfterReset = false;
  let agentActive = false;
  let mode = null; // null=idle; "master"=buy-upgrade; "icon-only"=chỉ ICON
  let sessionUnavailable = false;
  let nextMenuAttemptAt = 0;
  // Khi bot chưa trả menu, giãn dần khoảng thử lại để không gửi /tn dồn dập.
  let menuBackoffSeconds = config.menuBusyRetrySeconds;
  // Mini-app của bot chết hạ tầng (ngrok/upstream web service) là lỗi phía
  // bot, không phải lỗi agent: giãn dần thời gian thử lại thay vì tự dừng.
  let miniAppServerDownBackoffSeconds = 60;
  let pendingBuyCompletion = null;
  let initialWorkerCheckDone = false;
  let inventoryKnownAvailable = false;
  // Mốc sớm nhất được mở mini-app kiểm tra kho lần kế tiếp. Tránh mở mini-app
  // liên tục khi kho còn 0 icon (trước đây kiểm tra 3 lần mỗi ~20-30s).
  let nextInventoryCheckAt = 0;
  // Số receipt "nhận cầu thủ vào kho" đã thấy; tăng lên thì kiểm tra kho ngay
  // thay vì chờ hết nhịp 30 phút.
  let inventoryReceiptSeen = 0;
  // Số lần bấm lại nút Bắt đầu khi bot lag làm mất ACK (không có worker chạy).
  let startAckRetries = 0;
  // Đếm số lần mini-app trắng/không render để tự reload Telegram Web thay vì
  // dừng agent và bắt người dùng gửi /resetagent.
  let miniAppRecoveryAttempts = 0;
  const ui = createUiLock();
  let iconStopRequested = false;
  let iconMonitor = null;
  // TASK-005 Stage B: registry là nguồn sự thật về worker đang chạy.
  const registry = getWorkerRegistry();
  const workerSession = createWorkerSession({ registry, log, logError });
  let iconBeginBlocked = false;
  // E006 được cô lập theo từng feature: feature lỗi bị hoãn 10 phút, các feature
  // khác vẫn chạy. Không đẩy worker vào unknown và không đưa cả agent về idle.
  const e006Cooldown = createE006Cooldown({ log, logError });
  // Upgrade bị E006 giữa phase nâng: sau cooldown chạy lại đúng phase nâng.
  let pendingUpgradeRetry = false;
  // Số lượt nâng thất bại liên tiếp (không tiêu thụ phôi) do pivot báo về.
  // Tồn tại qua nhiều phase nâng để chặn vòng "mua phôi -> nâng fail -> mua".
  const upgradeFailureState = { consecutive: 0 };

  const deferE006 = (flow, error = null, options = {}) => {
    const state = e006Cooldown.defer(flow, error, options);
    if (flow === E006_FLOWS.UPGRADE) pendingUpgradeRetry = true;
    return state;
  };

  // Dùng chung cho 3 nguồn: auto-start lúc launch, /startagent từ xa, và tự
  // chạy lại sau /resetagent. Không cần gõ /startagent sau khi chọn mode.
  const activateSelectedMode = (source = "command") => {
    mode = buyUpgradeEnabled ? "master" : resolvedMode.key;
    initialWorkerCheckDone = false;
    inventoryKnownAvailable = false;
    nextInventoryCheckAt = 0;
    pendingBuyCompletion = null;
    pendingUpgradeRetry = false;
    upgradeFailureState.consecutive = 0;
    inventoryReceiptSeen = reader
      ? countInventoryReceivedNotices(reader.snapshot().text)
      : 0;
    miniAppRecoveryAttempts = 0;
    startAckRetries = 0;
    menuBackoffSeconds = config.menuBusyRetrySeconds;
    nextMenuAttemptAt = 0;
    agentActive = true;

    const prefix =
      source === "launch"
        ? `Tự động bắt đầu chạy chế độ [${resolvedMode.id}] ${resolvedMode.key}; `
        : source === "reset"
          ? `Đã khôi phục phiên; tự động chạy lại chế độ [${resolvedMode.id}] ${resolvedMode.key}; `
          : "Nhận /startagent; ";
    log(
      prefix +
        (buyUpgradeEnabled
          ? "giữ tối đa 3 task ICON chạy liên tục, có ICON trong kho thì mua phôi và nâng."
          : "chỉ giữ tối đa 3 task ICON chạy liên tục, không mua phôi/nâng.")
    );
  };

  const stopIconMonitor = async (reason) => {
    iconStopRequested = true;
    if (!iconMonitor) return true;
    const task = iconMonitor;
    const stopped = await withDeadline(task.then(() => true), 45_000, false);
    if (!stopped) {
      log(`Luồng ICON chưa dừng sau 45s (${reason}); tiếp tục khôi phục an toàn.`);
    }
    return stopped;
  };

  const ensureIconMonitor = () => {
    if (iconMonitor) return;
    // Đang trong cooldown E006 của chính icon-buy: không mở worker mới, chờ
    // timer hết hạn rồi tự chạy lại. Các feature khác không bị ảnh hưởng.
    if (e006Cooldown.isDeferred(E006_FLOWS.ICON_BUY)) return;
    // ICON là worker nền: được chạy song song với buy/upgrade nhưng không được
    // trùng feature và bị chặn nếu registry đang có worker unknown.
    const started = workerSession.tryBegin("icon", {
      concurrencyGroup: "background",
      quiet: iconBeginBlocked
    });
    if (!started) {
      iconBeginBlocked = true;
      return;
    }
    iconBeginBlocked = false;
    workerSession.markRunning("icon");
    iconStopRequested = false;
    iconMonitor = runIconBuy(page, rl, {
      ui,
      isStopRequested: () => iconStopRequested || remoteResetRequested,
      // E006 do chính icon-buy: ghi cooldown theo flow, không đẩy registry sang
      // unknown và không làm dừng vòng tổng.
      onE006: (error, options = {}) =>
        deferE006(E006_FLOWS.ICON_BUY, error, {
          source: options.source || "icon-buy:runner"
        }),
      // ICON vừa nhận từ TTCN phải vào kho ngay: bỏ qua nhịp chờ 30 phút để
      // vòng chính kiểm tra kho rồi chuyển sang mua phôi + nâng cấp.
      onIconReceived: (received) => {
        const plan = iconReceivePivotPlan(received);
        if (!plan) return;
        inventoryKnownAvailable = plan.inventoryKnownAvailable;
        nextInventoryCheckAt = plan.nextInventoryCheckAt;
        log(
          `Đã nhận ${plan.codes.length} ICON từ TTCN` +
            `${plan.codes.length ? ` (${plan.codes.join(", ")})` : ""}; ` +
            "ép kiểm tra kho ngay để mua phôi + nâng cấp."
        );
      }
    })
      .then((result) => {
        if (result?.action === "e006-cooldown") {
          log(
            `Luồng ICON tạm hoãn do E006 (${result.reason || "token"}); ` +
              `sẽ tự chạy lại sau ${Math.ceil(
                e006Cooldown.remainingMs(E006_FLOWS.ICON_BUY) / 1_000
              )}s.`
          );
          return result;
        }
        if (!iconStopRequested && result?.action !== "stop") {
          log(
            `Luồng ICON kết thúc (${result?.reason || result?.action || "không rõ"}); ` +
              "sẽ tự khởi động lại ở nhịp kế tiếp."
          );
        }
        return result;
      })
      .catch((error) => {
        if (isE006Error(error)) {
          // Lỗi token của icon-buy: chỉ hoãn icon-buy, không log stack và không
          // đụng tới worker buy/upgrade đang chạy.
          deferE006(E006_FLOWS.ICON_BUY, error, {
            source: "ensureIconMonitor"
          });
          log(
            `Luồng ICON tạm hoãn do E006; sẽ tự chạy lại sau ${Math.ceil(
              e006Cooldown.remainingMs(E006_FLOWS.ICON_BUY) / 1_000
            )}s.`
          );
          return null;
        }
        if (error?.code === "TELEGRAM_CHAT_UNREADABLE") {
          // Chat Telegram bị đóng/kẹt quá lâu: mở lại phiên ở vòng kế tiếp
          // thay vì để luồng ICON lặp /stop vô hạn.
          log("Không đọc được chat Telegram sau nhiều lần thử; mở lại phiên Telegram.");
          sessionUnavailable = true;
        }
        if (!iconStopRequested && !remoteResetRequested) {
          logError(`Luồng ICON dừng do lỗi: ${error.stack || error.message}`);
        }
        return null;
      })
      .finally(() => {
        workerSession.stop("icon", {
          reason: iconStopRequested ? "stop-requested" : "completed"
        });
        iconMonitor = null;
      });
  };

  // Hết cooldown E006: tự mở lại đúng feature đã lỗi, không cần người dùng gửi
  // lệnh mới. Callback chạy sau khi state cooldown đã được reset.
  e006Cooldown.onExpire(E006_FLOWS.ICON_BUY, () => {
    if (!agentActive || remoteResetRequested || getLifecycle().isStopping()) return;
    log("E006 [icon-buy] hết cooldown; tự khởi động lại luồng ICON.");
    ensureIconMonitor();
  });
  e006Cooldown.onExpire(E006_FLOWS.PHOI_BUY, () => {
    if (!agentActive || remoteResetRequested || getLifecycle().isStopping()) return;
    log("E006 [phoi-buy] hết cooldown; vòng ACTIVE sẽ thử lại Auto Mua Phôi.");
  });
  e006Cooldown.onExpire(E006_FLOWS.UPGRADE, () => {
    if (!agentActive || remoteResetRequested || getLifecycle().isStopping()) return;
    if (buyUpgradeEnabled && mode === "master") {
      pendingUpgradeRetry = true;
      log("E006 [upgrade] hết cooldown; sẽ chạy lại Auto Nâng Cấp.");
    }
  });

  // TASK-004: dọn tài nguyên khi SIGINT/SIGTERM/uncaughtException. Handler chạy
  // một lần, có timeout cứng trong lib/lifecycle. Chỉ dừng worker do agent sở
  // hữu (agentActive) và chỉ gửi /stopauto hoặc /stopnc — không đụng task MUA
  // thủ công vì các lệnh này không dừng task thủ công.
  getLifecycle().register({
    name: "controller",
    onShutdown: async (reason) => {
      remoteResetRequested = true;
      iconStopRequested = true;
      if (iconEnabled) {
        try {
          await stopIconMonitor(`shutdown:${reason}`);
        } catch (error) {
          logError(`Không dừng được luồng ICON khi shutdown: ${error.message}`);
        }
      }
      if (agentActive && buyUpgradeEnabled) {
        // Chế độ icon-combo có thể có cả worker mua lẫn worker nâng; icon-only
        // không bao giờ chạm tới 2 worker này.
        for (const stopWorker of [stopPurchaseWorker, stopUpgradeWorker]) {
          try {
            await stopWorker(page, rl);
          } catch (error) {
            logError(`Không dừng được worker khi shutdown: ${error.message}`);
          }
        }
      }
      try {
        await closeMiniApp(page);
      } catch (error) {
        logError(`Không đóng được mini-app khi shutdown: ${error.message}`);
      }
      try {
        await context.close();
      } catch (error) {
        logError(`Không đóng được trình duyệt khi shutdown: ${error.message}`);
      }
      try {
        rl.close();
      } catch {
        // readline đã đóng.
      }
      // Nhả mọi worker còn ghi trong registry để lần khởi động sau reconcile
      // không thấy "running" giả.
      for (const active of workerSession.listActive()) {
        workerSession.stop(active.feature, { reason: "shutdown" });
      }
      pendingUpgradeRetry = false;
      e006Cooldown.clearAll();
    }
  });
  const rememberBuyCompletion = (outcome, source) => {
    const record = createBuyCompletionRecord(outcome, source);
    // Chỉ giữ dấu completion của chu kỳ vừa KẾT THÚC THẬT (completed). Mọi outcome
    // khác (timeout, stopped, system-error...) phải xóa cờ này, nếu không vòng
    // sau sẽ bỏ qua bước /stop và có thể mở chồng worker mua.
    pendingBuyCompletion = record || null;
  };

  const handleControlCommand = (command) => {
    if (command === "stopagent") {
      void stopIconMonitor("/stopagent").catch((error) =>
        logError(`Không dừng được ICON khi nhận /stopagent: ${error.message}`)
      );
      return;
    }
    if (command !== "resetagent" || remoteResetRequested) return;
    remoteResetRequested = true;
    autoResumeAfterReset = agentActive;
    void stopIconMonitor("/resetagent").catch((error) =>
      logError(`Không dừng được ICON khi nhận /resetagent: ${error.message}`)
    );
    agentActive = false;
    mode = null;
    pendingBuyCompletion = null;
    pendingUpgradeRetry = false;
    upgradeFailureState.consecutive = 0;
    sessionUnavailable = true;
    log(
      "Nhận /resetagent; đang khởi động lại Telegram Web, " +
        (autoResumeAfterReset
          ? "sẽ tự chạy lại chế độ đã chọn sau khi phiên sẵn sàng."
          : "sẽ giữ trạng thái nghỉ như trước khi reset.")
    );
    resetClosePromise = withDeadline(
      context.close().catch((error) => {
        console.error(`Không đóng được Chrome để reset agent: ${error.message}`);
      }),
      20_000,
      "close-timeout"
    );
    if (isWaitingForPrompt()) wakeAllPendingPrompts();
  };

  // Chạy phase nâng cấp. Tách khỏi handleBuyOutcome để vòng ACTIVE có thể gọi
  // lại đúng phase này sau cooldown E006 mà không phải giả lập một chu kỳ mua.
  const runUpgradePivot = async () => {
    // Chuyển pha mua -> nâng: dấu completion của chu kỳ mua trước không còn
    // giá trị, không được giữ lại làm bỏ qua /stop ở chu kỳ mua kế tiếp.
    pendingBuyCompletion = null;
    if (e006Cooldown.isDeferred(E006_FLOWS.UPGRADE)) {
      // Kho vẫn đầy nhưng upgrade đang bị hoãn: không mở mini-app kiểm tra kho
      // liên tục, chờ hết cooldown rồi pendingUpgradeRetry chạy lại.
      inventoryKnownAvailable = false;
      nextInventoryCheckAt =
        Date.now() + Math.max(1_000, e006Cooldown.remainingMs(E006_FLOWS.UPGRADE));
      agentActive = true;
      log(
        `Auto Nâng Cấp đang tạm hoãn do E006; còn ` +
          `${Math.ceil(e006Cooldown.remainingMs(E006_FLOWS.UPGRADE) / 1_000)}s.`
      );
      return false;
    }
    // Đặt lại trước khi pivot: nếu mini-app nâng lỗi hạ tầng (bot down) thì
    // lần chạy lại vẫn kiểm tra kho trước, không nhảy thẳng vào mua phôi.
    inventoryKnownAvailable = false;
    nextInventoryCheckAt = 0;
    const upgradeBegin = workerSession.tryBegin("upgrade");
    if (!upgradeBegin) {
      log("Registry đang chặn worker nâng cấp; agent về idle.");
      agentActive = false;
      return false;
    }
    workerSession.markRunning("upgrade");
    let pivot;
    try {
      pivot = await pivotMasterToUpgrade(
        page,
        rl,
        async (...args) => runSingleUpgrade(...args),
        log,
        ui,
        upgradeFailureState
      );
    } catch (error) {
      if (isE006Error(error)) {
        // E006 của upgrade: hoãn riêng upgrade, không đẩy worker sang unknown.
        deferE006(E006_FLOWS.UPGRADE, error, {
          source: "pivotMasterToUpgrade"
        });
        workerSession.stop("upgrade", { reason: "e006-cooldown" });
        inventoryKnownAvailable = false;
        nextInventoryCheckAt =
          Date.now() + Math.max(1_000, e006Cooldown.remainingMs(E006_FLOWS.UPGRADE));
        agentActive = true;
        return false;
      }
      // UI/spec mismatch hoặc thiếu nút start: lỗi an toàn, không phải worker hỏng.
      // Đóng worker sạch, backoff rồi kiểm tra lại kho thay vì idle/unknown.
      if (
        error.code === "UPGRADE_UI_MISMATCH" ||
        error.code === "UPGRADE_START_BUTTON_MISSING"
      ) {
        workerSession.stop("upgrade", { reason: error.code });
        upgradeFailureState.consecutive += 1;
        const backoffMs = upgradeFailureBackoffMs(upgradeFailureState.consecutive);
        inventoryKnownAvailable = false;
        nextInventoryCheckAt = Date.now() + backoffMs;
        agentActive = true;
        log(
          `Lỗi UI nâng (${error.code}); giữ agent sống, kiểm tra lại kho sau ` +
            `${Math.round(backoffMs / 1_000)}s.`
        );
        return false;
      }
      workerSession.stop("upgrade", {
        unknown: true,
        reason: error.code || "pivot-error"
      });
      throw error;
    }
    if (pivot.e006) {
      deferE006(E006_FLOWS.UPGRADE, null, {
        message: "Bot nâng cấp trả E006.",
        source: "pivotMasterToUpgrade"
      });
      workerSession.stop("upgrade", { reason: "e006-cooldown" });
      inventoryKnownAvailable = false;
      nextInventoryCheckAt =
        Date.now() + Math.max(1_000, e006Cooldown.remainingMs(E006_FLOWS.UPGRADE));
      agentActive = true;
      return false;
    }
    workerSession.stop("upgrade", {
      reason: pivot.pauseBuy ? "upgrade-failures" : pivot.reason || "pivot"
    });
    miniAppServerDownBackoffSeconds = 60;
    agentActive = pivot.agentActive;
    if (pivot.mode && pivot.mode !== "icon") mode = pivot.mode;
    if (pivot.pauseBuy) {
      inventoryKnownAvailable = false;
      const pauseBackoffMs =
        pivot.backoffMs || upgradeFailureBackoffMs(upgradeFailureState.consecutive);
      nextInventoryCheckAt = Date.now() + pauseBackoffMs;
      log(
        `Tạm dừng mua thêm phôi sau ${pivot.failureCount || upgradeFailureState.consecutive} ` +
          `lần nâng thất bại liên tiếp; kiểm tra lại kho ICON sau ` +
          `${Math.round(pauseBackoffMs / 1_000)}s. ` +
          "Agent vẫn chạy ICON nền, KHÔNG dừng luồng."
      );
      return false;
    }
    if (pivot.retryInventoryCheck) {
      inventoryKnownAvailable = false;
      nextInventoryCheckAt = Date.now() + (pivot.inventoryCheckDelayMs || 0);
    }
    return false;
  };

  // Áp dụng kết quả 1 chu kỳ mua. Nếu kho đầy ở chế độ tổng thì pivot sang
  // feature nâng cấp; buy module không cần biết gì về upgrade.
  const handleBuyOutcome = async (outcome, completedLog) => {
    if (outcome?.status === "system-error") {
      // E006 của chính chu kỳ mua phôi: hoãn phoi-buy 10 phút, giữ agent sống
      // để ICON và các feature khác tiếp tục. Không dùng unknown/evidence.
      deferE006(E006_FLOWS.PHOI_BUY, null, {
        message:
          outcome.reason === "worker-token-stop"
            ? "Worker Auto Mua Phôi dừng do không thể làm mới token."
            : "Chu kỳ Auto Mua Phôi trả E006.",
        source: "settleBuyOutcome"
      });
      if (workerSession.isRegistered("buy")) {
        workerSession.stop("buy", { reason: "e006-cooldown" });
      }
      pendingBuyCompletion = null;
      agentActive = true;
      return false;
    }
    const next = await settleBuyOutcome(page, rl, outcome, {
      pivotToUpgrade: buyUpgradeEnabled && mode === "master",
      completedLog,
      ui
    });
    if (next.retryInventoryCheck) {
      // Chu kỳ mua vượt maxCycleWaitMinutes đã được dọn an toàn: giữ agent
      // sống, kiểm tra lại kho ICON sau cooldown ngắn rồi chạy tiếp nếu còn
      // ICON nâng được. Chỉ dừng chu kỳ mua/nâng khi kho xác nhận eligible = 0.
      inventoryKnownAvailable = false;
      nextInventoryCheckAt =
        Date.now() +
        Math.max(
          1_000,
          next.inventoryCheckDelayMs || BUY_TIMEOUT_RECOVERY_COOLDOWN_MS
        );
      // Buộc vòng sau kiểm tra /stop trước khi mở chu kỳ mới: recovery có thể
      // chưa dừng được worker nếu bot chậm, nên không bấm chồng.
      initialWorkerCheckDone = true;
      pendingBuyCompletion = null;
      agentActive = true;
      return false;
    }
    if (next.retryInventoryReceipt) {
      // Bot báo kho đầy nhưng chưa xác nhận nhận cầu thủ: không đưa agent về
      // idle và không mở chu kỳ mua mới ngay. Coi kho là chưa xác định, kiểm
      // tra lại sau 5 phút; vòng ACTIVE vẫn nhận /stopagent.
      inventoryKnownAvailable = false;
      nextInventoryCheckAt = Date.now() + INVENTORY_RECEIPT_RETRY_MS;
      pendingBuyCompletion = null;
      agentActive = true;
      return false;
    }
    if (next.pivotToUpgrade) {
      pendingBuyCompletion = null;
      return runUpgradePivot();
    }
    if (!next.openNext) pendingBuyCompletion = null;
    agentActive = next.agentActive;
    if (next.mode && next.mode !== "icon") mode = next.mode;
    return next.openNext;
  };

  // checkInventoryIcons có thể không xác nhận được dữ liệu kho (mini-app đang
  // tải lại, form render nhưng chưa có card). Đó là lỗi tạm thời của mini-app,
  // không phải lỗi chí mạng: giữ vòng tổng sống và kiểm tra lại nhịp sau thay
  // vì làm sập cả agent (từng gặp INVENTORY_READ_UNCONFIRMED lúc 06:29).
  //
  // Mỗi lần kiểm tra chỉ mở mini-app MỘT lượt. Trước đây hàm này thử 3 lần
  // cách nhau 10s, cộng với vòng tổng chờ 15s nên mini-app bị mở liên tục
  // (~20-30s/lần) khi kho còn 0 icon. Nhịp kiểm tra giờ do
  // iconBuy.inventoryCheckIntervalSeconds quy định (mặc định 30 phút).
  const checkMasterInventory = async () => {
    await ui.acquire();
    let inventory = null;
    try {
      inventory = await checkInventoryIcons(page, rl);
      miniAppServerDownBackoffSeconds = 60;
    } catch (error) {
      if (error.code !== "INVENTORY_READ_UNCONFIRMED") throw error;
      log(
        "Chưa xác nhận được danh sách kho (mini-app chưa sẵn sàng); " +
          "không kết luận hết icon, sẽ kiểm tra lại ở nhịp sau."
      );
      return false;
    } finally {
      ui.release();
    }
    // Chỉ mua phôi khi còn ICON dưới target. Nếu con ICON duy nhất đã +target
    // thì mua phôi chỉ khiến bot báo kho đầy rồi agent dừng vì không có receipt
    // mới; chờ ICON mới rồi mới bật lại mua phôi + nâng.
    if (decideInventoryAction(inventory) === "buy") return true;
    const intervalMinutes = Math.max(
      1,
      Math.round(config.iconBuy.inventoryCheckIntervalSeconds / 60)
    );
    const targetGrade = config.upgrade.targetGrade;
    if (inventory.total === 0) {
      log(
        "Kho chưa có ICON; giữ agent sống và kiểm tra lại sau " +
          `${intervalMinutes} phút thay vì mở mini-app liên tục.`
      );
    } else if (inventory.reachedTarget >= inventory.total) {
      log(
        `Kho có ${inventory.total} ICON nhưng tất cả đã đạt +${targetGrade}; ` +
          "dừng mua phôi + nâng, chờ ICON mới hoặc khi bot báo nhận cầu thủ " +
          `(kiểm tra lại sau ${intervalMinutes} phút).`
      );
    } else {
      log(
        `Kho có ${inventory.total} ICON nhưng chưa có icon nào nâng được ` +
          `(${inventory.locked} đang khóa, ${inventory.reachedTarget} đã đạt +${targetGrade}); ` +
          "chưa mua phôi, kiểm tra lại sau " +
          `${intervalMinutes} phút hoặc khi bot báo nhận cầu thủ.`
      );
    }
    return false;
  };

  ({ context, page } = await openTelegramPage(context, page));
  log("Telegram Web Open");
  if (await isTelegramLoginPage(page)) {
    log("Telegram Web chưa đăng nhập; hãy đăng nhập trong cửa sổ trình duyệt trước khi tiếp tục.");
  }
  await observeChatText(page, handleControlCommand);
  await ensureMessageComposer(page, rl);
  let reader = chatTextReaders.get(page);
  reader.arm();
  await waitForTextToSettle(reader, 1_500, 30_000, page);
  // TASK-005B: reconcile worker state trước khi nhận lệnh. Chat chỉ là bằng
  // chứng, registry là nguồn sự thật. Worker ICON còn sót sau restart được
  // đóng (process cũ đã chết); buy/upgrade chỉ adopt khi chat xác nhận.
  let startupBuyEvidence = false;
  if (getLatestAutoBuyStatus(reader.snapshot().text) === "running") {
    const tail = await verifyTailOrphan(page, reader).catch(() => reader.snapshot());
    startupBuyEvidence = getLatestAutoBuyStatus(tail.text) === "running";
  }
  if (buyUpgradeEnabled) {
    const reconciled = workerSession.reconcileOnStartup({
      hasWorkerEvidence: startupBuyEvidence
    });
    if (reconciled.action === "block") {
      if (reconciled.reason === "evidence-without-registry") {
        log(
          "Chat còn dấu hiệu worker mua nhưng registry trống; " +
            "agent sẽ xác minh bằng /stop trước khi bấm chu kỳ mới."
        );
      } else {
        log(
          `Registry worker đang chặn khởi động (${reconciled.reason}); ` +
            "agent chỉ chờ lệnh, không tự bấm mua/nâng."
        );
      }
    }
  }
  log("Agent READY");
  log(
    "Tự động khởi động theo mode đã chọn; " +
      "/stopagent để tạm dừng, /startagent để chạy lại, /resetagent để khôi phục phiên."
  );
  // Auto-start on launch: không cần gõ /startagent sau khi chọn [1]/[2].
  activateSelectedMode("launch");

  while (true) {
    if (getLifecycle().isStopping()) break;
    getLifecycle().updateHeartbeat({
      mode,
      agentActive,
      activeWorkerId: workerSession.activeWorkerIds().join(",") || null,
      e006Cooldowns: e006Cooldown.snapshot()
    });
    const enteredActive = agentActive;
    try {
      if (sessionUnavailable) {
        // Khôi phục Telegram Web trên page mới; chờ tối đa 45s rồi tiếp tục.
        ({ context, page, reader } = await restoreTelegramSession(context, page, rl, handleControlCommand));
        sessionUnavailable = false;
        // Trong cùng process, KHÔNG coi worker ICON là stale. Chế độ icon-only
        // không chạy buy/upgrade nên cũng không cần reconcile 2 feature đó.
        if (buyUpgradeEnabled) {
          const restored = workerSession.reconcileOnStartup({
            hasWorkerEvidence:
              getLatestAutoBuyStatus(reader.snapshot().text) === "running",
            staleFeatures: [],
            ignoreFeatures: ["icon"]
          });
          if (
            restored.action === "block" &&
            restored.reason !== "evidence-without-registry"
          ) {
            log(
              `Registry chặn sau khi khôi phục phiên (${restored.reason}); ` +
                "không mở chu kỳ mới cho tới khi worker được xử lý."
            );
          }
        }
      }

      // --- IDLE: chờ lệnh ---
      if (!agentActive) {
        const command = await waitForControlCommand(page);
        if (command === "resetagent") {
          await resetClosePromise;
          const shouldResume = autoResumeAfterReset;
          autoResumeAfterReset = false;
          remoteResetRequested = false;
          sessionUnavailable = true;
          if (shouldResume) activateSelectedMode("reset");
          else {
            agentActive = false;
            mode = null;
          }
          continue;
        }
        if (command === "stopagent") {
          // icon-only: module duy nhất đang chạy là ICON, không đụng tới worker
          // mua/nâng (dù bot có task thủ công của người dùng).
          if (!buyUpgradeEnabled) {
            if (iconEnabled) await stopIconMonitor("/stopagent");
            agentActive = false;
            log("Nhận /stopagent; đã dừng luồng săn ICON, agent chờ lệnh mới.");
            continue;
          }
          // /stopagent chỉ dừng worker mua do agent quản lý. Không dò hoặc
          // dừng worker nâng/chức năng khác mà người dùng đang chạy trực tiếp.
          // checkAutoBuyRunning tự giữ khóa chỉ lúc gửi /stop; stopPurchaseWorker
          // là thao tác UI nên được khóa riêng.
          const currentStatus = await checkAutoBuyRunning(page, rl, { ui });
          let restartRequested = null;
          if (currentStatus.running) {
            log("Đang có worker Mua phôi; gửi lệnh dừng theo /stopagent.");
            restartRequested = await ui.withLock(() => stopPurchaseWorker(page, rl));
            log(
              restartRequested
                ? "Worker mua đã dừng; đã nhận lệnh start mới trong lúc dừng."
                : "Đã dừng worker Mua phôi; agent chờ lệnh mới."
            );
          } else {
            log("Không có worker Mua phôi do agent quản lý; các worker khác được giữ nguyên.");
          }
          agentActive = Boolean(restartRequested);
          if (agentActive) {
            mode = buyUpgradeEnabled
              ? CONTROL_MODE_BY_COMMAND[restartRequested] || "master"
              : resolvedMode.key;
          }
          continue;
        }
        if (command === "startagent") {
          if (buyUpgradeEnabled) {
            const startReconcile = workerSession.reconcileOnStartup({
              hasWorkerEvidence:
                getLatestAutoBuyStatus(reader.snapshot().text) === "running",
              // Trong cùng process, ICON đang chạy không phải worker stale và
              // cũng không được đánh unknown (unknown chặn mọi chu kỳ mới).
              staleFeatures: [],
              ignoreFeatures: ["icon"]
            });
            if (
              startReconcile.action === "block" &&
              startReconcile.reason !== "evidence-without-registry"
            ) {
              log(
                `Registry vẫn đang chặn (${startReconcile.reason}); ` +
                  "không bấm mua mới. Xem runbook để xử lý worker unknown."
              );
            }
          }
          activateSelectedMode("command");
          continue;
        }
        log(`Lệnh lạ ${command}; bỏ qua, tiếp tục chờ.`);
        continue;
      }

      // --- ACTIVE: icon-only ---
      // Chỉ duy trì luồng săn ICON. Không đọc kho, không mở mini-app nâng,
      // không gọi /stop hay bất kỳ thao tác mua phôi nào.
      if (!buyUpgradeEnabled) {
        if (iconEnabled) ensureIconMonitor();
        if (reader.takeCommand("stopagent")) {
          agentActive = false;
          log("Nhận /stopagent trong lúc chạy; đã dừng luồng săn ICON, chờ lệnh mới.");
          if (iconEnabled) await stopIconMonitor("/stopagent");
          continue;
        }
        await page.waitForTimeout(config.iconBuy.slotPollSeconds * 1_000);
        continue;
      }

      // Chế độ "nang" (upgrade-only) đã bị bỏ: không có lệnh điều khiển nào chọn
      // mode này. Auto Nâng chỉ chạy qua runUpgradePivot() trong master; mọi
      // rewrite mode cũ đều bị bỏ qua ở các nhánh `mode !== "master"`.

      // Đang chờ backoff vì bot chưa trả menu: không gửi /stop kiểm tra mỗi
      // vòng (trước đây backoff 15s nên ít thấy, giờ backoff tới 5 phút nên sẽ
      // spam nếu vẫn kiểm tra liên tục). Nghỉ ngắn rồi quay lại đầu vòng.
      if (Date.now() < nextMenuAttemptAt) {
        await page.waitForTimeout(Math.min(5_000, nextMenuAttemptAt - Date.now()));
        continue;
      }

      // --- ACTIVE: đồng bộ với worker mua đang chạy ---
      // Nếu đã ghi nhận completion của chính worker mua, không gửi /stop lại
      // khi đang chờ menu. Tin chức năng khác có thể làm menu bị thay thế;
      // Ở nhịp đầu, runner ICON đã đọc /stop để lấy baseline task; chỉ gửi
      // thêm /stop nếu chat đã cho thấy worker Auto Mua đang chạy.
      if (
        !pendingBuyCompletion &&
        (initialWorkerCheckDone ||
          getLatestAutoBuyStatus(reader.snapshot().text) === "running")
      ) {
        const status = await checkAutoBuyRunning(page, rl, { ui });
        if (status.running) {
          const adoptedWorker = getLatestWorkerId(status.baselineText) || "không rõ";
          log(`Bot đang có luồng Mua phôi (worker ${adoptedWorker}); agent chờ luồng này hoàn tất.`);
          const outcome = await waitForCycleCompletion(
            page,
            status.baseline,
            status.baselineText,
            { isIgnorableSystemError: () => isRecentIconActivity() }
          );
          rememberBuyCompletion(outcome, "adopted-worker");
          const openNext = await handleBuyOutcome(
            outcome,
            `Luồng Mua phôi đã hoàn tất, bot báo mua ${outcome.playersBought} cầu thủ; agent sẽ bắt đầu chu kỳ mới.`
          );
          if (!openNext) continue;
        }
        initialWorkerCheckDone = true;
      }

      // /stopagent đến ngay trước khi mở chu kỳ mới -> về idle, không mở mini-app.
      if (reader.takeCommand("stopagent")) {
        agentActive = false;
        log("Nhận /stopagent trước khi bắt đầu chu kỳ; agent đang chờ /startagent.");
        continue;
      }

      // --- Xác minh worker cũ rồi chuẩn bị chu kỳ mới ---
      // Chốt chặn trước khi bấm bắt đầu: nếu /stop kiểm tra trước đó miss mà
      // thật ra worker vẫn chạy (activity mới hơn mọi terminal), KHÔNG bấm để
      // tránh mở chồng worker tốn BP thật. Nhưng cửa sổ chat có thể đang đậu ở
      // lịch sử cũ (user cuộn lên) khiến activity cũ trông như đang chạy dù bot
      // vừa báo E003 không có gì chạy — nên verify đuôi chat trước. Phần này chỉ
      // đọc chat nên chạy trước khi chiếm khóa UI.
      if (getLatestAutoBuyStatus(reader.snapshot().text) === "running") {
        const tailSnap = await verifyTailOrphan(page, reader);
        if (getLatestAutoBuyStatus(tailSnap.text) !== "running") {
          log("Cửa sổ chat đang xem là lịch sử cũ; đã đưa về đuôi và không còn worker chạy, tiếp tục mở chu kỳ.");
        } else {
          log("Nghi ngờ worker Mua phôi đang chạy; xác minh bằng chứng 5 phút thay vì bấm chồng.");
          const confirm = await confirmSuspectedWorker(page, reader);
          if (confirm.decision === "clear") {
            log("5 phút không thấy worker hoạt động (mua/ping/hoàn tất mới); coi như đã dừng, tiếp tục mở chu kỳ.");
          } else {
            const adoptOutcome =
              confirm.decision === "adopt"
                ? await waitForCycleCompletion(
                    page,
                    confirm.baseline,
                    confirm.baselineText,
                    { isIgnorableSystemError: () => isRecentIconActivity() }
                  )
                : confirm.outcome;
            rememberBuyCompletion(adoptOutcome, "suspected-worker");
            const openNext = await handleBuyOutcome(
              adoptOutcome,
              `Luồng Mua phôi đã hoàn tất, bot báo mua ${adoptOutcome.playersBought} cầu thủ; agent sẽ bắt đầu chu kỳ mới.`
            );
            if (!openNext) continue;
          }
        }
      }

      const units = config.maxPerCycle;
      const systemErrorCountBeforeMenu = countBotSystemErrors(reader.snapshot().text);
      if (iconEnabled) ensureIconMonitor();
      // Upgrade bị E006 ở phase trước: sau cooldown chạy lại đúng phase nâng,
      // không cần chờ thêm một chu kỳ mua phôi.
      if (!buyUpgradeEnabled) pendingUpgradeRetry = false;
      if (pendingUpgradeRetry && mode !== "master") pendingUpgradeRetry = false;
      if (
        pendingUpgradeRetry &&
        buyUpgradeEnabled &&
        mode === "master" &&
        !e006Cooldown.isDeferred(E006_FLOWS.UPGRADE)
      ) {
        pendingUpgradeRetry = false;
        log("E006 [upgrade] hết cooldown; chạy lại Auto Nâng Cấp.");
        await runUpgradePivot();
        continue;
      }
      if (!inventoryKnownAvailable) {
        const now = Date.now();
        if (now < nextInventoryCheckAt) {
          // Receipt mới của bot = có cầu thủ vào kho: kiểm tra ngay, không chờ
          // hết nhịp 30 phút.
          const receiptCount = countInventoryReceivedNotices(
            reader.snapshot().text
          );
          if (receiptCount > inventoryReceiptSeen) {
            inventoryReceiptSeen = receiptCount;
            nextInventoryCheckAt = 0;
            log(
              "Bot vừa báo nhận cầu thủ vào kho; kiểm tra kho ngay thay vì " +
                "chờ hết nhịp kiểm tra."
            );
            continue;
          }
          // Chưa tới nhịp kiểm tra kho: nghỉ ngắn, không mở mini-app, không
          // đặt mua phôi khi chưa biết có ICON trong kho.
          await page.waitForTimeout(
            Math.min(30_000, Math.max(1_000, nextInventoryCheckAt - now))
          );
          continue;
        }
        const ok = await checkMasterInventory();
        const intervalSeconds = config.iconBuy.inventoryCheckIntervalSeconds;
        nextInventoryCheckAt = intervalSeconds
          ? Date.now() + intervalSeconds * 1_000
          : 0;
        if (!ok) {
          await page.waitForTimeout(config.iconBuy.slotPollSeconds * 1_000);
          continue;
        }
        inventoryKnownAvailable = true;
      }
      if (e006Cooldown.isDeferred(E006_FLOWS.PHOI_BUY)) {
        // Chỉ phoi-buy bị hoãn; ICON vẫn chạy nền. Chờ theo lát ngắn để còn
        // nhận /stopagent và receipt mới, không mở mini-app trong cooldown.
        await page.waitForTimeout(
          Math.min(
            30_000,
            Math.max(1_000, e006Cooldown.remainingMs(E006_FLOWS.PHOI_BUY))
          )
        );
        continue;
      }
      log("Đang kiểm tra menu Auto Mua Phôi và mini-app cho chu kỳ tiếp theo.");
      let startAckBaseline;
      let cycleBaselineBeforeStart;
      let cycleStartedAt = 0;
      // Mở/điền/bấm bắt đầu phải trọn gói dưới khóa UI để không chen lệnh.
      await ui.acquire();
      try {
        const frame = await getTradeFrame(page, rl);
        miniAppServerDownBackoffSeconds = 60;
        menuBackoffSeconds = config.menuBusyRetrySeconds;
        nextMenuAttemptAt = 0;
        if (hasNewBotSystemError(reader.snapshot().text, systemErrorCountBeforeMenu)) {
          deferE006(E006_FLOWS.PHOI_BUY, null, {
            message: "Bot trả E006 trước khi bắt đầu Auto Mua Phôi.",
            source: "controller:pre-start"
          });
          await closeMiniApp(page).catch(() => {});
          continue;
        }
        await withTimeout(configureCycle(frame, units), 90_000, "điền cấu hình mini-app");
        const startButton = frame.getByRole("button", { name: "Bắt đầu Auto Mua" });
        if (!(await startButton.isEnabled())) {
          throw new Error("Nút bắt đầu không khả dụng. Hãy kiểm tra trạng thái bot; không tạo chu kỳ khác.");
        }
        if (reader.takeCommand("stopagent")) {
          agentActive = false;
          log("Nhận /stopagent; bỏ qua nút bắt đầu và chờ /startagent.");
          continue;
        }
        if (hasNewBotSystemError(reader.snapshot().text, systemErrorCountBeforeMenu)) {
          deferE006(E006_FLOWS.PHOI_BUY, null, {
            message: "Bot trả E006 sau khi mở form Auto Mua Phôi.",
            source: "controller:pre-click"
          });
          await closeMiniApp(page).catch(() => {});
          continue;
        }
        const body = reader.snapshot().text;
        startAckBaseline = {
          started: countStartedNotices(body),
          marker: getLatestStartedMarker(body),
          systemErrors: countBotSystemErrors(body),
          text: body
        };
        cycleBaselineBeforeStart = getCycleBaseline(body);
        cycleStartedAt = Date.now();
        // TASK-005B: đăng ký worker TRƯỚC khi bấm, để registry là nguồn sự
        // thật. Nếu registry đang chặn (worker khác/unknown) thì không bấm.
        const buyBegin = workerSession.tryBegin("buy", {
          cycleId: `buy-${cycleStartedAt}`
        });
        if (!buyBegin) {
          const block = workerSession.blockedReason();
          const blockers = (block?.workers || [])
            .map(
              (worker) =>
                `${worker.workerId || "?"} (${worker.feature || "?"}, ` +
                `${worker.state || "?"})`
            )
            .join(", ");
          log(
            "Registry đang chặn worker mua" +
              (blockers ? `: ${blockers}` : "") +
              (block?.reason ? ` [${block.reason}]` : "") +
              "; agent về idle, không bấm Bắt đầu. " +
              "Kiểm tra Telegram rồi resolve worker unknown nếu có."
          );
          agentActive = false;
          continue;
        }
        try {
          await withTimeout(startButton.click(), 60_000, "bấm Bắt đầu Auto Mua");
        } catch (error) {
          workerSession.stop("buy", { reason: "start-click-failed" });
          throw error;
        }
      } finally {
        ui.release();
      }
      try {
        await waitForStartAcknowledgement(page, startAckBaseline, rl, { ui });
        workerSession.markRunning("buy");
      } catch (error) {
        workerSession.stop("buy", {
          // E006 là lỗi token đã biết: không đẩy worker sang unknown, chỉ hoãn
          // phoi-buy 10 phút ở nhánh xử lý E006 bên dưới.
          unknown:
            error.code === "START_ACK_UNVERIFIED" && !isE006Error(error),
          reason: error.code || "start-ack"
        });
        throw error;
      }
      startAckRetries = 0;
      const acknowledgedCycleText = reader.snapshot().text;
      const cycleBaseline = {
        ...cycleBaselineBeforeStart,
        latestActivityMarker: getLatestActivityMarker(acknowledgedCycleText)
      };
      await ui.withLock(() => closeMiniApp(page));
      const startedWorker = getLatestWorkerId(acknowledgedCycleText) || "không rõ";
      miniAppRecoveryAttempts = 0;
      log(`Đã bắt đầu chu kỳ mua ${units} cầu thủ (worker ${startedWorker}).`);
      if (pendingBuyCompletion) {
        pendingBuyCompletion = null;
        log("Đã bắt đầu lại chu kỳ mua; hoàn tất cũ đã được xử lý.");
      }
      let outcome = await waitForCycleCompletion(
        page,
        cycleBaseline,
        acknowledgedCycleText,
        { isIgnorableSystemError: () => isRecentIconActivity() }
      );
      if (isEarlyCompletion(outcome, Date.now() - cycleStartedAt)) {
        // Tin hoàn tất đến vài giây sau khi bắt đầu gần như chắc chắn là tin cũ
        // bị phát lại. Xác minh bằng /stop: worker còn chạy thì bỏ qua tin cũ,
        // tránh bấm thêm chu kỳ chồng lên worker đang mua thật.
        const earlySeconds = Math.round((Date.now() - cycleStartedAt) / 1_000);
        log(
          `Bot báo hoàn tất chỉ ${earlySeconds}s sau khi bắt đầu; ` +
            "kiểm tra /stop trước khi nhận kết quả để tránh tin hoàn tất cũ."
        );
        let earlyStatus = null;
        try {
          earlyStatus = await checkAutoBuyRunning(page, rl, { ui });
        } catch (error) {
          log(
            `Không xác minh được /stop cho tin hoàn tất sớm: ${error.message}; ` +
              "chờ tiếp với mốc chat hiện tại, không bấm chu kỳ mới."
          );
          const snap = reader.snapshot();
          outcome = await waitForCycleCompletion(
            page,
            getCycleBaseline(snap.text),
            snap.text,
            { isIgnorableSystemError: () => isRecentIconActivity() }
          );
        }
        if (earlyStatus?.running) {
          log(
            "Worker Auto Mua vẫn đang chạy; bỏ qua tin hoàn tất cũ và tiếp tục " +
              "chờ chu kỳ thật."
          );
          outcome = await waitForCycleCompletion(
            page,
            earlyStatus.baseline,
            earlyStatus.baselineText,
            { isIgnorableSystemError: () => isRecentIconActivity() }
          );
        }
      }
      workerSession.stop("buy", {
        reason: outcome.status === "cycle-timeout" ? "cycle-timeout" : "completed"
      });
      rememberBuyCompletion(outcome, "agent-worker");
      const openNext = await handleBuyOutcome(
        outcome,
        `Chu kỳ Mua phôi hoàn tất; bot báo mua ${outcome.playersBought} cầu thủ.`
      );
      if (!openNext) continue;
      // completed -> lặp lại: về đầu vòng ACTIVE để /stop kiểm tra lại rồi mở chu kỳ kế tiếp.
    } catch (error) {
      // /resetagent là ý định của người dùng: ưu tiên xử lý TRƯỚC mọi phân loại
      // lỗi (kể cả E006) để không defer cooldown oan hay giữ context đã đóng.
      if (remoteResetRequested) {
        await resetClosePromise;
        remoteResetRequested = false;
        sessionUnavailable = true;
        agentActive = false;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        continue;
      }
      // TASK-005B: lỗi xảy ra khi worker đang ghi trong registry → phải đóng
      // worker. Lỗi recoverable đã biết coi như đã dừng; lỗi còn lại → unknown
      // vì không chắc bot đã dừng (fail-closed, chặn mua chồng).
      // /resetagent chỉ khôi phục phiên: KHÔNG đóng worker để lần reconcile sau
      // còn adopt được worker đang chạy thật trên bot.
      if (!remoteResetRequested) {
        const recoverableWorkerErrors = new Set([
          "MENU_BUSY",
          "START_ACK_TIMEOUT",
          "MINI_APP_SERVER_DOWN",
          "MINI_APP_BLANK",
          "MINI_APP_UI_NOT_READY",
          "MINI_APP_NOT_OPENED",
          "MINI_APP_LOAD_TIMEOUT",
          "UPGRADE_MODE_LOAD_TIMEOUT",
          "BOT_SYSTEM_ERROR",
          "TELEGRAM_NAVIGATED",
          "TELEGRAM_CHAT_UNREADABLE",
          "STOP_CHECK_TIMEOUT",
          "STOP_CONFIRM_TIMEOUT"
        ]);
        const recoverable =
          recoverableWorkerErrors.has(error.code) || isE006Error(error);
        for (const feature of ["buy", "upgrade"]) {
          if (!workerSession.isRegistered(feature)) continue;
          workerSession.stop(feature, {
            unknown: !recoverable,
            reason: error.code || "agent-error"
          });
        }
      }
      if (error.code === "MENU_BUSY") {
        const backoffSeconds = menuBackoffSeconds;
        nextMenuAttemptAt = Date.now() + backoffSeconds * 1_000;
        // Giãn dần để một bot chậm/rate-limit không bị spam /tn mỗi 15 giây.
        menuBackoffSeconds = Math.min(backoffSeconds * 2, 300);
        log(
          `${error.userMessage || "Chưa lấy được menu chức năng."} ` +
          "Giữ agent ở trạng thái chạy, không dừng worker và sẽ thử lại sau " +
          `${backoffSeconds} giây (giãn dần, tối đa 5 phút).`
        );
        continue;
      }
      if (
        error.code === "STOP_CHECK_TIMEOUT" ||
        error.code === "STOP_CONFIRM_TIMEOUT"
      ) {
        // Bot/Telegram không trả lời /stop hoặc /stopauto kịp: lỗi tạm thời,
        // không phải worker hỏng. Giữ agent sống, coi kho là chưa xác định và
        // kiểm tra lại sau cooldown ngắn thay vì dừng cả agent.
        inventoryKnownAvailable = false;
        nextInventoryCheckAt =
          Date.now() + BUY_TIMEOUT_RECOVERY_COOLDOWN_MS;
        agentActive = true;
        log(
          `${error.userMessage || error.message} ` +
            "Đây là lỗi tạm thời của bot/Telegram; giữ agent sống và kiểm tra " +
            `lại kho ICON sau ${Math.round(
              BUY_TIMEOUT_RECOVERY_COOLDOWN_MS / 1_000
            )} giây.`
        );
        continue;
      }
      if (error.code === "START_ACK_TIMEOUT" && startAckRetries < 2) {
        // Bot lag làm mất click/ACK nhưng /stop đã xác nhận KHÔNG có worker:
        // bấm lại an toàn, không tạo chu kỳ mua chồng.
        startAckRetries += 1;
        log(
          `${error.userMessage || error.message} ` +
            `Đóng mini-app và bấm lại nút Bắt đầu (lần ${startAckRetries}/2).`
        );
        await ui.withLock(() => closeMiniApp(page)).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        continue;
      }
      if (error.code === "START_ACK_UNVERIFIED" && startAckRetries < 2) {
        // Không đọc được /stop: mở lại Telegram Web để kiểm tra trạng thái
        // thật, không bấm mù và không treo chờ Enter.
        startAckRetries += 1;
        log(
          `${error.userMessage || error.message} ` +
            `Mở lại Telegram Web để kiểm tra worker (lần ${startAckRetries}/2).`
        );
        sessionUnavailable = true;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        continue;
      }
      if (error.code === "MINI_APP_SERVER_DOWN") {
        // Trang lỗi ERR_NGROK_* / "upstream web service" = máy chủ mini-app
        // phía bot chết. Không phải lỗi agent và không sửa được bằng cách mở
        // lại Telegram Web; giữ agent sống và thử lại giãn dần cho tới khi bot
        // khôi phục. Không dừng worker ICON đang chạy.
        const backoffSeconds = miniAppServerDownBackoffSeconds;
        miniAppServerDownBackoffSeconds = Math.min(backoffSeconds * 2, 300);
        nextMenuAttemptAt = Date.now() + backoffSeconds * 1_000;
        miniAppRecoveryAttempts = 0;
        log(
          "Máy chủ mini-app của bot đang lỗi (ngrok/upstream web service), " +
            "không phải lỗi agent. " +
            `Chi tiết: ${String(error.message || "").replace(/\s+/g, " ").slice(0, 180)}. ` +
            "Giữ agent sống, không dừng worker ICON; " +
            `thử lại sau ${backoffSeconds} giây.`
        );
        continue;
      }
      if (
        (error.code === "MINI_APP_BLANK" ||
          error.code === "MINI_APP_UI_NOT_READY" ||
          error.code === "MINI_APP_NOT_OPENED" ||
          error.code === "MINI_APP_LOAD_TIMEOUT" ||
          error.code === "UPGRADE_MODE_LOAD_TIMEOUT") &&
        miniAppRecoveryAttempts < 2
      ) {
        miniAppRecoveryAttempts += 1;
        log(
          "Mini-app không render sau 2 lần thử; tự khôi phục Telegram Web " +
            `(lần ${miniAppRecoveryAttempts}/2), không dừng worker.`
        );
        sessionUnavailable = true;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        continue;
      }
      if (isE006Error(error)) {
        // E006: chỉ hoãn đúng feature đang lỗi. Không đưa agent về idle, không
        // đẩy worker sang unknown; feature tự chạy lại sau 10 phút.
        const flow =
          identifyE006Flow({ error }) === E006_FLOWS.UNKNOWN
            ? E006_FLOWS.PHOI_BUY
            : identifyE006Flow({ error });
        deferE006(flow, error, { source: "controller:active-catch" });
        agentActive = true;
        continue;
      }
      // Telegram Web có thể tự reload/điều hướng về trang chủ trong lúc đang
      // đọc DOM. page.evaluate khi đó báo "Execution context was destroyed".
      // Đây là lỗi tạm thời của trang, không phải agent hỏng: mở lại chat bot,
      // gắn lại observer và giữ nguyên worker đang chạy.
      if (error.code === "TELEGRAM_NAVIGATED" || isNavigationError(error)) {
        log(
          "Telegram Web vừa điều hướng/tải lại; mở lại chat bot và theo dõi tiếp, " +
            "không dừng worker."
        );
        sessionUnavailable = true;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        continue;
      }
      const message = `Agent gặp lỗi: ${error.stack || error.message}`;
      logError(message);
      if (isBrowserSessionClosed(error, page, context) || isPlaywrightTimeout(error)) {
        if (isPlaywrightTimeout(error) && !isBrowserSessionClosed(error, page, context)) {
          console.error("Trình duyệt không phản hồi (treo renderer); đóng và mở lại session.");
          try {
            await withDeadline(context.close().catch(() => {}), 15_000, undefined);
          } catch { /* tiếp tục mở mới */ }
        } else {
          console.error("Chrome/Telegram đã đóng; agent sẽ mở lại và khôi phục theo dõi.");
        }
        sessionUnavailable = true;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        continue;
      }
      // Recovery chuẩn: dừng về idle, chờ Enter tại PC hoặc /resetagent từ xa.
      // Dừng luồng ICON đang chờ nền trước, nếu không promise đó vẫn tiếp tục
      // log "Đang chờ bot hoàn tất đơn ICON" mỗi 5 phút dù vòng tổng đã chết.
      await stopIconMonitor("agent-error").catch(() => {});
      setWaitingForRecoveryPrompt(true);
      try {
        await promptWakeable(rl, "Nhấn Enter hoặc gửi /resetagent để agent khôi phục và thử lại...");
      } finally {
        setWaitingForRecoveryPrompt(false);
      }
      if (remoteResetRequested) {
        await resetClosePromise;
        remoteResetRequested = false;
        sessionUnavailable = true;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        continue;
      }
      agentActive = false;
    } finally {
      if (!agentActive) {
        mode = null;
        // Về idle thì xoá luôn dấu hoàn tất cũ; lần chạy sau phải kiểm tra
        // /stop lại từ đầu thay vì bỏ qua vì tưởng vẫn còn chu kỳ vừa xong.
        pendingBuyCompletion = null;
        pendingUpgradeRetry = false;
        upgradeFailureState.consecutive = 0;
      }
      // Chỉ khi vừa chuyển từ active về idle: bỏ lệnh start còn đọng từ lúc
      // active (vd gửi lúc đang chạy). Lệnh cũ mà chạy theo sẽ tốn tiền thật
      // khi không còn ý định mới; user muốn chạy lại chỉ cần gửi lệnh mới.
      // Idle sẵn thì không đụng queue để khỏi ăn lệnh mới gửi nhanh sau lệnh
      // vừa xử lý. /stopagent và /resetagent luôn giữ.
      if (!agentActive && enteredActive) {
        for (const staleStart of CONTROL_START_COMMANDS) {
          if (reader.takeCommand(staleStart)) {
            log(`Bỏ /${staleStart} cũ còn đọng từ lúc agent đang chạy; chờ lệnh mới.`);
            break;
          }
        }
      }
    }
  }
}

// Chờ lệnh điều khiển khi idle.
async function waitForControlCommand(page) {
  const reader = chatTextReaders.get(page);
  if (!reader) throw new Error("Chưa khởi tạo theo dõi nội dung Telegram.");
  let lastStatusLogAt = Date.now();
  let hintBaseline = reader.snapshot().text;
  while (true) {
    const command = reader.takeNextCommand();
    if (command) return command;
    const snapshot = reader.snapshot();
    const update = await waitForChatChange(
      page,
      reader,
      snapshot.version,
      CONTROL_COMMAND_STATUS_LOG_INTERVAL_MS
    );
    const nextCommand = reader.takeNextCommand();
    if (nextCommand) return nextCommand;
    if (Date.now() - lastStatusLogAt >= CONTROL_COMMAND_STATUS_LOG_INTERVAL_MS) {
      if (update) {
        const nearMiss = findNewNearMissControlCommand(hintBaseline, update.text.slice(-2000));
        hintBaseline = update.text;
        log(
          "Telegram chat có cập nhật nhưng không thấy lệnh điều khiển mới." +
            (nearMiss
              ? ` Phát hiện tin nhắn gần giống lệnh (${nearMiss}) — kiểm tra chính tả, lệnh đúng là /startagent, /stopagent, /resetagent.`
              : "")
        );
      } else {
        const currentText = await withTimeout(
          page.locator("body").innerText(),
          PLAYWRIGHT_TIMEOUT_MS,
          "đọc lại DOM Telegram"
        );
        reader.publish(currentText);
        const recoveredCommand = reader.takeNextCommand();
        if (recoveredCommand) return recoveredCommand;
        const nearMiss = findNewNearMissControlCommand(hintBaseline, currentText.slice(-2000));
        hintBaseline = currentText;
        log(
          `Vẫn chờ lệnh điều khiển; đã đọc lại DOM Telegram ` +
            `(${currentText.length} ký tự), không thấy lệnh mới.` +
            (nearMiss
              ? ` Phát hiện tin nhắn gần giống lệnh (${nearMiss}) — kiểm tra chính tả.`
              : "")
        );
      }
      lastStatusLogAt = Date.now();
    }
  }
}

// Entry-point dùng bởi agent.js: chạy vòng điều khiển và rethrow lỗi khởi động
// để entry-point quyết định retry. `main()` tự xử lý các lỗi recoverable bên
// trong nên ở đây chỉ còn lỗi phát sinh lúc khởi động.
async function runAgent(options = {}) {
  try {
    await main(options);
  } catch (error) {
    logError(`Agent dừng: ${error.stack || error.message}`);
    throw error;
  }
}

module.exports = { runAgent };
