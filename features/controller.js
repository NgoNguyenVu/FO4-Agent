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
const { log, logError } = require("./agent-log");
const { createUiLock } = require("../lib/ui-lock");
const { getLifecycle } = require("../lib/lifecycle");
const {
  promptWakeable,
  wakePendingPrompt,
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
  stopUpgradeWorker
} = require("./upgrade");
const { runIconBuy } = require("./icon-buy");

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

async function main() {
  validateConfig();
  const rl = readline.createInterface({ input: stdin, output: stdout });
  let context = await withTimeout(launchTelegramContext(), 180_000, "mở trình duyệt Telegram");
  let page = context.pages()[0] || (await withTimeout(context.newPage(), 60_000, "mở trang Telegram"));
  let remoteResetRequested = false;
  let resetClosePromise = Promise.resolve();
  let agentActive = false;
  let mode = null; // null=idle, "master"=mua+nâng; buy/nang chỉ là pivot nội bộ
  let upgradeBlockedTargetIds = new Set();
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

  const stopIconMonitor = async (reason) => {
    iconStopRequested = true;
    if (!iconMonitor) return true;
    const task = iconMonitor;
    const timeout = new Promise((resolve) => setTimeout(() => resolve(false), 45_000));
    const stopped = await Promise.race([task.then(() => true), timeout]);
    if (!stopped) {
      log(`Luồng ICON chưa dừng sau 45s (${reason}); tiếp tục khôi phục an toàn.`);
    }
    return stopped;
  };

  const ensureIconMonitor = () => {
    if (iconMonitor) return;
    iconStopRequested = false;
    iconMonitor = runIconBuy(page, rl, {
      ui,
      isStopRequested: () => iconStopRequested || remoteResetRequested
    })
      .then((result) => {
        if (!iconStopRequested && result?.action !== "stop") {
          log(
            `Luồng ICON kết thúc (${result?.reason || result?.action || "không rõ"}); ` +
              "sẽ tự khởi động lại ở nhịp kế tiếp."
          );
        }
        return result;
      })
      .catch((error) => {
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
        iconMonitor = null;
      });
  };

  // TASK-004: dọn tài nguyên khi SIGINT/SIGTERM/uncaughtException. Handler chạy
  // một lần, có timeout cứng trong lib/lifecycle. Chỉ dừng worker do agent sở
  // hữu (agentActive) và chỉ gửi /stopauto hoặc /stopnc — không đụng task MUA
  // thủ công vì các lệnh này không dừng task thủ công.
  getLifecycle().register({
    name: "controller",
    onShutdown: async (reason) => {
      remoteResetRequested = true;
      iconStopRequested = true;
      try {
        await stopIconMonitor(`shutdown:${reason}`);
      } catch (error) {
        logError(`Không dừng được luồng ICON khi shutdown: ${error.message}`);
      }
      if (agentActive) {
        const stopWorkers =
          mode === "nang"
            ? [stopUpgradeWorker]
            : [stopPurchaseWorker, stopUpgradeWorker];
        for (const stopWorker of stopWorkers) {
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
    }
  });
  const rememberBuyCompletion = (outcome, source) => {
    const record = createBuyCompletionRecord(outcome, source);
    if (record) pendingBuyCompletion = record;
  };

  const handleControlCommand = (command) => {
    if (command === "stopagent") {
      void stopIconMonitor("/stopagent");
      return;
    }
    if (command !== "resetagent" || remoteResetRequested) return;
    remoteResetRequested = true;
    void stopIconMonitor("/resetagent");
    agentActive = false;
    mode = null;
    upgradeBlockedTargetIds = new Set();
    pendingBuyCompletion = null;
    sessionUnavailable = true;
    log("Nhận /resetagent; agent về idle ngay, đang khởi động lại Telegram Web, không dừng worker bot.");
    resetClosePromise = Promise.race([
      context.close().catch((error) => {
        console.error(`Không đóng được Chrome để reset agent: ${error.message}`);
      }),
      new Promise((resolve) => setTimeout(() => resolve("close-timeout"), 20_000))
    ]);
    if (isWaitingForPrompt()) wakePendingPrompt();
  };

  // Áp dụng kết quả 1 chu kỳ mua. Nếu kho đầy ở chế độ tổng thì pivot sang
  // feature nâng cấp; buy module không cần biết gì về upgrade.
  const handleBuyOutcome = async (outcome, completedLog) => {
    const next = await settleBuyOutcome(page, rl, outcome, {
      pivotToUpgrade: mode === "master",
      completedLog,
      ui
    });
    if (next.pivotToUpgrade) {
      // Đặt lại trước khi pivot: nếu mini-app nâng lỗi hạ tầng (bot down) thì
      // lần chạy lại vẫn kiểm tra kho trước, không nhảy thẳng vào mua phôi.
      inventoryKnownAvailable = false;
      nextInventoryCheckAt = 0;
      const pivot = await pivotMasterToUpgrade(
        page,
        rl,
        async (...args) => runSingleUpgrade(...args),
        log,
        ui
      );
      miniAppServerDownBackoffSeconds = 60;
      agentActive = pivot.agentActive;
      if (pivot.mode && pivot.mode !== "icon") mode = pivot.mode;
      return false;
    }
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
  log("Agent READY");
  log(
    "Đang chờ /startagent (mua ICON → nhận → mua phôi → nâng), " +
      "/stopagent hoặc /resetagent."
  );

  while (true) {
    if (getLifecycle().isStopping()) break;
    getLifecycle().updateHeartbeat({ mode, agentActive });
    const enteredActive = agentActive;
    try {
      if (sessionUnavailable) {
        // Khôi phục Telegram Web trên page mới; chờ tối đa 45s rồi tiếp tục.
        ({ context, page, reader } = await restoreTelegramSession(context, page, rl, handleControlCommand));
        sessionUnavailable = false;
      }

      // --- IDLE: chờ lệnh ---
      if (!agentActive) {
        const command = await waitForControlCommand(page);
        if (command === "resetagent") {
          await resetClosePromise;
          remoteResetRequested = false;
          sessionUnavailable = true;
          continue;
        }
        if (command === "stopagent") {
          // /stopagent chỉ dừng worker mua do agent quản lý. Không dò hoặc
          // dừng worker nâng/chức năng khác mà người dùng đang chạy trực tiếp.
          // Khóa UI cho các thao tác kiểm tra và dừng worker.
          const { restartRequested } = await ui.withLock(async () => {
            const currentStatus = await checkAutoBuyRunning(page, rl);
            let requested = null;
            if (currentStatus.running) {
              log("Đang có worker Mua phôi; gửi lệnh dừng theo /stopagent.");
              requested = await stopPurchaseWorker(page, rl);
              log(
                requested
                  ? "Worker mua đã dừng; đã nhận lệnh start mới trong lúc dừng."
                  : "Đã dừng worker Mua phôi; agent chờ lệnh mới."
              );
            }
            if (!currentStatus.running) {
              log("Không có worker Mua phôi do agent quản lý; các worker khác được giữ nguyên.");
            }
            return { restartRequested: requested };
          });
          agentActive = Boolean(restartRequested);
          if (agentActive) {
            mode = CONTROL_MODE_BY_COMMAND[restartRequested] || "master";
          }
          continue;
        }
        if (command === "startagent") {
          mode = "master";
          initialWorkerCheckDone = false;
          inventoryKnownAvailable = false;
          nextInventoryCheckAt = 0;
          inventoryReceiptSeen = countInventoryReceivedNotices(
            reader.snapshot().text
          );
          upgradeBlockedTargetIds = new Set();
          miniAppRecoveryAttempts = 0;
          startAckRetries = 0;
          menuBackoffSeconds = config.menuBusyRetrySeconds;
          nextMenuAttemptAt = 0;
          agentActive = true;
          log(
            "Nhận /startagent; giữ tối đa 3 task ICON chạy liên tục, " +
              "có ICON trong kho thì chạy mua phôi và nâng."
          );
          continue;
        }
        log(`Lệnh lạ ${command}; bỏ qua, tiếp tục chờ.`);
        continue;
      }

      // --- ACTIVE: vòng nâng riêng (không đụng mua) ---
      if (mode === "nang") {
        if (Date.now() < nextMenuAttemptAt) {
          await page.waitForTimeout(Math.min(5_000, nextMenuAttemptAt - Date.now()));
          continue;
        }
        const buyStatus = await ui.withLock(() => checkAutoBuyRunning(page, rl));
        if (buyStatus.running) {
          agentActive = false;
          log(
            "Auto Mua Phôi đang chạy; không mở Auto Nâng Cấp đồng thời. " +
              "Agent chờ lệnh mới sau khi worker mua kết thúc."
          );
          continue;
        }
        const up = await runSingleUpgrade(page, rl, upgradeBlockedTargetIds, ui);
        if (up.action === "continue" || up.action === "blocked-target") {
          miniAppRecoveryAttempts = 0;
          menuBackoffSeconds = config.menuBusyRetrySeconds;
          nextMenuAttemptAt = 0;
          if (up.mode && up.mode !== "icon") mode = up.mode;
          continue;
        }
        agentActive = false;
        if (up.action === "no-targets") {
          log("Hết icon dưới target; dừng auto nâng, chờ lệnh mới.");
        }
        if (up.action === "no-materials") {
          log("Hết phôi phù hợp hoặc không có nguyên liệu hợp lệ; dừng auto nâng, chờ lệnh mới.");
        }
        if (up.action === "no-progress") {
          log("Lượt nâng không đạt và không làm target tăng grade; dừng auto nâng, chờ lệnh mới.");
        }
        continue;
      }

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
        const status = await ui.withLock(() => checkAutoBuyRunning(page, rl));
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
      ensureIconMonitor();
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
          agentActive = false;
          log("Bot trả E006; agent đã tự dừng và chờ /startagent.");
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
          agentActive = false;
          log("Bot trả E006; agent đã tự dừng và chờ /startagent.");
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
        await withTimeout(startButton.click(), 60_000, "bấm Bắt đầu Auto Mua");
      } finally {
        ui.release();
      }
      await waitForStartAcknowledgement(page, startAckBaseline, rl, { ui });
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
          earlyStatus = await ui.withLock(() => checkAutoBuyRunning(page, rl));
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
      rememberBuyCompletion(outcome, "agent-worker");
      const openNext = await handleBuyOutcome(
        outcome,
        `Chu kỳ Mua phôi hoàn tất; bot báo mua ${outcome.playersBought} cầu thủ.`
      );
      if (!openNext) continue;
      // completed -> lặp lại: về đầu vòng ACTIVE để /stop kiểm tra lại rồi mở chu kỳ kế tiếp.
    } catch (error) {
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
      if (error.code === "BOT_SYSTEM_ERROR") {
        agentActive = false;
        log("Bot trả E006; agent đã tự dừng và chờ /startagent.");
        continue;
      }
      // /resetagent từ xa đóng context đang chạy -> thao tác đang dở throw
      // "Target page, context or browser has been closed". Đó là reset chủ động,
      // không phải lỗi, nên khôi phục im lặng thay vì in stack gây hoang mang.
      if (remoteResetRequested) {
        await resetClosePromise;
        remoteResetRequested = false;
        sessionUnavailable = true;
        agentActive = false;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
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
            await Promise.race([
              context.close().catch(() => {}),
              new Promise((resolve) => setTimeout(resolve, 15_000))
            ]);
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
async function runAgent() {
  try {
    await main();
  } catch (error) {
    logError(`Agent dừng: ${error.stack || error.message}`);
    throw error;
  }
}

// Chạy trực tiếp (không qua agent.js): ghi log rồi thoát với mã lỗi.
function runAgentCli() {
  runAgent().catch(() => {
    process.exitCode = 1;
  });
}

module.exports = {
  runAgent,
  runAgentCli,
  runAutoBuy: runAgent,
  runAutoBuyCli: runAgentCli
};
