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
const { createIconSession } = require("./icon-session");
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
  getLatestActivityMarker
} = require("./buy");
const {
  runSingleUpgrade,
  pivotMasterToUpgrade,
  checkInventoryIcons
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
  let mode = null; // null=idle, "master"=mua+nâng, "buy"=chỉ mua, "nang"=chỉ nâng
  let upgradeBlockedTargetIds = new Set();
  let sessionUnavailable = false;
  let nextMenuAttemptAt = 0;
  // Khi bot chưa trả menu, giãn dần khoảng thử lại để không gửi /tn dồn dập.
  let menuBackoffSeconds = config.menuBusyRetrySeconds;
  let pendingBuyCompletion = null;
  // Đếm số lần mini-app trắng/không render để tự reload Telegram Web thay vì
  // dừng agent và bắt người dùng gửi /resetagent.
  let miniAppRecoveryAttempts = 0;
  // /starticon chạy nền, dùng chung page/chat observer với luồng mua/nâng.
  // Khóa UI bảo đảm hai luồng không mở/đóng mini-app hay gửi lệnh Telegram chen
  // nhau; các đoạn chờ chat chỉ đọc sẽ nhả khóa.
  const ui = createUiLock();

  const rememberBuyCompletion = (outcome, source) => {
    const record = createBuyCompletionRecord(outcome, source);
    if (record) pendingBuyCompletion = record;
  };

  const logIconResult = (result) => {
    if (result.action === "stop") {
      log("Phiên ICON nền đã dừng; worker Auto Mua/Auto Nâng (nếu có) giữ nguyên.");
    } else if (result.action === "exhausted") {
      log(
        `Đã dùng hết cầu thủ ICON yêu thích trong phiên này ` +
          `(${result.batches} lượt, ${result.purchased} đơn đặt mua, ${result.canceled} đơn đã hủy); ` +
          "chờ lệnh mới."
      );
    } else if (result.action === "limit") {
      log(
        `Đã đạt giới hạn ${result.batches} lượt của phiên ICON ` +
          `(${result.purchased} đơn đặt mua, ${result.canceled} đơn đã hủy); chờ lệnh mới.`
      );
    } else {
      log(
        `Phiên ICON dừng do lỗi (${result.reason || "không rõ"}) sau ${result.batches} lượt: ` +
          `${result.purchased} đơn đặt mua, ${result.canceled} đơn đã hủy. ` +
          "Kiểm tra TTCN trước khi gửi /starticon lại."
      );
    }
  };

  const iconSession = createIconSession({
    runIconBuy,
    ui,
    log,
    logError,
    onResult: logIconResult
  });

  const startIconSession = () => {
    if (sessionUnavailable || remoteResetRequested) {
      log(
        "Nhận /starticon nhưng Telegram Web đang được khôi phục; bỏ qua lệnh này, " +
          "gửi lại sau khi agent READY."
      );
      return;
    }
    if (!page || (typeof page.isClosed === "function" && page.isClosed())) {
      log("Nhận /starticon nhưng Telegram Web chưa sẵn sàng; bỏ qua lệnh này.");
      return;
    }
    iconSession.start(page, rl);
  };

  const handleControlCommand = (command) => {
    // /starticon không đổi mode mua/nâng. Nó được mở ngay từ callback của chat
    // observer để có thể chạy song song cả khi controller đang bận một chu kỳ.
    if (command === "starticon") {
      startIconSession();
      return;
    }
    if (command === "stopagent") {
      iconSession.abort("/stopagent");
      return;
    }
    if (command !== "resetagent" || remoteResetRequested) return;
    iconSession.abort("/resetagent");
    remoteResetRequested = true;
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
      const pivot = await pivotMasterToUpgrade(
        page,
        rl,
        async (...args) => {
          if (!(await checkMasterInventory())) return { action: "no-inventory" };
          return runSingleUpgrade(...args);
        },
        log,
        ui
      );
      agentActive = pivot.agentActive;
      if (pivot.mode && pivot.mode !== "icon") mode = pivot.mode;
      return false;
    }
    agentActive = next.agentActive;
    if (next.mode && next.mode !== "icon") mode = next.mode;
    return next.openNext;
  };

  const checkMasterInventory = async () => {
    await ui.acquire();
    try {
      const count = await checkInventoryIcons(page, rl);
      if (count === 0) {
        agentActive = false;
        log("Kho không còn icon; dừng /startagent và chờ lệnh mới.");
        return false;
      }
      return true;
    } finally {
      ui.release();
    }
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
    "Đang chờ /startagent (tổng), /startmua (chỉ mua), /startnang (chỉ nâng), " +
      "/starticon (mua ICON yêu thích), /stopagent hoặc /resetagent."
  );

  while (true) {
    const enteredActive = agentActive;
    try {
      if (sessionUnavailable) {
        // Không để phiên ICON nền tiếp tục dùng page cũ trong lúc Telegram Web
        // được mở lại; chờ tối đa 45s rồi khôi phục như cũ.
        await iconSession.stopAndWait("khôi phục Telegram Web", 45_000);
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
          // Khóa UI vì phiên ICON nền có thể đang mở mini-app TTCN.
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
          if (restartRequested === "starticon") {
            // Handler đã mở phiên ICON nền khi lệnh đến; không biến main mode
            // thành icon và không chờ phiên ICON xong mới xử lý lệnh khác.
            agentActive = false;
            log(
              "Đã nhận /starticon trong lúc dừng worker mua; phiên ICON chạy nền, " +
                "agent chờ lệnh mua/nâng mới."
            );
            continue;
          }
          agentActive = Boolean(restartRequested);
          if (agentActive) {
            mode = CONTROL_MODE_BY_COMMAND[restartRequested] || "master";
          }
          continue;
        }
        if (command === "startagent") {
          mode = "master";
          upgradeBlockedTargetIds = new Set();
          miniAppRecoveryAttempts = 0;
          menuBackoffSeconds = config.menuBusyRetrySeconds;
          nextMenuAttemptAt = 0;
          agentActive = true;
          log("Nhận /startagent; chạy vòng tổng mua+nâng (đầy kho -> nâng, xong -> mua tiếp).");
          continue;
        }
        if (command === "startmua") {
          mode = "buy";
          miniAppRecoveryAttempts = 0;
          menuBackoffSeconds = config.menuBusyRetrySeconds;
          nextMenuAttemptAt = 0;
          agentActive = true;
          log("Nhận /startmua; chỉ chạy Auto Mua Phôi (đầy kho -> chờ lệnh).");
          continue;
        }
        if (command === "startnang") {
          mode = "nang";
          upgradeBlockedTargetIds = new Set();
          miniAppRecoveryAttempts = 0;
          menuBackoffSeconds = config.menuBusyRetrySeconds;
          nextMenuAttemptAt = 0;
          agentActive = true;
          log("Nhận /startnang; chỉ chạy Auto Nâng Cấp tới khi hết icon dưới target.");
          continue;
        }
        if (command === "starticon") {
          // Callback của chat observer đã mở phiên ICON nền ngay khi lệnh đến.
          // Không đặt agentActive/mode để luồng mua/nâng hiện tại không bị thay.
          log(
            (iconSession.isActive()
              ? `Đã nhận /starticon; phiên ICON nền #${iconSession.activeId()} đang chạy song song với luồng mua/nâng (nếu có).`
              : "Đã nhận /starticon; phiên ICON one-shot đã xử lý xong hoặc đang chờ khóa UI.")
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

      // --- ACTIVE: đồng bộ với worker mua đang chạy (nếu có, vòng buy/master) ---
      // Nếu đã ghi nhận completion của chính worker mua, không gửi /stop lại
      // khi đang chờ menu. Tin chức năng khác có thể làm menu bị thay thế;
      // gửi /stop lặp lại khi đó chỉ tạo E003 và spam chat.
      if (!pendingBuyCompletion) {
        const status = await ui.withLock(() => checkAutoBuyRunning(page, rl));
        if (status.running) {
          const adoptedWorker = getLatestWorkerId(status.baselineText) || "không rõ";
          log(`Bot đang có luồng Mua phôi (worker ${adoptedWorker}); agent chờ luồng này hoàn tất.`);
          const outcome = await waitForCycleCompletion(page, status.baseline, status.baselineText);
          rememberBuyCompletion(outcome, "adopted-worker");
          const openNext = await handleBuyOutcome(
            outcome,
            `Luồng Mua phôi đã hoàn tất, bot báo mua ${outcome.playersBought} cầu thủ; agent sẽ bắt đầu chu kỳ mới.`
          );
          if (!openNext) continue;
        }
      }

      // /stopagent đến ngay trước khi mở chu kỳ mới -> về idle, không mở mini-app.
      if (reader.takeCommand("stopagent")) {
        agentActive = false;
        log("Nhận /stopagent trước khi bắt đầu chu kỳ; agent đang chờ /startagent.");
        continue;
      }

      // --- Mở 1 chu kỳ mua mới ---
      // Chốt chặn trước khi bấm bắt đầu: nếu /stop kiểm tra trước đó miss mà
      // thật ra worker vẫn chạy (activity mới hơn mọi terminal), KHÔNG bấm để
      // tránh mở chồng worker tốn BP thật. Nhưng cửa sổ chat có thể đang đậu ở
      // lịch sử cũ (user cuộn lên) khiến activity cũ trông như đang chạy dù bot
      // vừa báo E003 không có gì chạy — nên verify đuôi chat trước. Phần này chỉ
      // đọc chat nên chạy trước khi chiếm khóa UI; phiên ICON nền vẫn được chạy.
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
                ? await waitForCycleCompletion(page, confirm.baseline, confirm.baselineText)
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
      log("Đang kiểm tra menu Auto Mua Phôi và mini-app cho chu kỳ tiếp theo.");
      if (mode === "master" && !(await checkMasterInventory())) {
        continue;
      }
      let startAckBaseline;
      let cycleBaselineBeforeStart;
      // Mở/điền/bấm bắt đầu phải trọn gói dưới khóa UI để phiên ICON nền không
      // đóng nhầm iframe hoặc chen lệnh vào composer.
      await ui.acquire();
      try {
        const frame = await getTradeFrame(page, rl);
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
        await withTimeout(startButton.click(), 60_000, "bấm Bắt đầu Auto Mua");
      } finally {
        ui.release();
      }
      await waitForStartAcknowledgement(page, startAckBaseline);
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
      const outcome = await waitForCycleCompletion(page, cycleBaseline, acknowledgedCycleText);
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
              ? ` Phát hiện tin nhắn gần giống lệnh (${nearMiss}) — kiểm tra chính tả, lệnh đúng là /startagent, /startmua, /startnang, /starticon, /stopagent, /resetagent.`
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
