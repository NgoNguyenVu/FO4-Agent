// Quyết định sau một chu kỳ mua. Không phụ thuộc module nâng cấp:
// khi kho đầy trong chế độ tổng, chỉ trả tín hiệu pivotToUpgrade để controller
// gọi feature nâng cấp.
const { log } = require("../agent-log");
const { CONTROL_MODE_BY_COMMAND } = require("../../lib/control-commands");
const {
  checkAutoBuyRunning,
  stopPurchaseWorker,
  waitForInventoryReceipt
} = require("./cycle");
const { closeMiniApp } = require("../telegram-io");
const { idleOutcomeMessage } = require("./patterns");

// Bot báo kho đầy nhưng chưa xác nhận nhận cầu thủ: không đưa cả agent về idle
// và bắt người dùng gửi /startagent. Giữ vòng ACTIVE sống, chờ đúng 5 phút rồi
// kiểm tra lại kho/`/stop`; chỉ mua tiếp khi trạng thái đã an toàn.
const INVENTORY_RECEIPT_RETRY_MS = 5 * 60 * 1000;

// Chu kỳ mua vượt maxCycleWaitMinutes: không bỏ cuộc mà đóng mini-app, xác minh
// /stop, dừng worker nếu còn chạy rồi quay lại vòng chính sau cooldown ngắn để
// kiểm tra lại kho ICON. 45 giây đủ để bot nhả task và tránh mở chu kỳ chồng.
const BUY_TIMEOUT_RECOVERY_COOLDOWN_MS = 45 * 1000;

// Dọn an toàn worker mua sau timeout. Mọi lỗi mạng/bot ở bước này chỉ được log
// và bỏ qua: agent phải sống tiếp để kiểm tra lại kho, không rơi vào unknown.
async function recoverTimedOutCycle(
  page,
  rl,
  {
    ui = null,
    checkRunning = checkAutoBuyRunning,
    stopWorker = stopPurchaseWorker,
    closeApp = closeMiniApp,
    logFn = log
  } = {}
) {
  const withLock = (fn) => (ui ? ui.withLock(fn) : fn());
  try {
    await closeApp(page, "Auto Mua Phôi");
  } catch (error) {
    logFn(`Không đóng được mini-app sau timeout (bỏ qua): ${error.message}`);
  }

  let running = null;
  let checkFailed = false;
  try {
    // checkAutoBuyRunning tự giữ khóa UI chỉ lúc gửi /stop.
    const status = await checkRunning(page, rl, { ui });
    running = Boolean(status?.running);
  } catch (error) {
    checkFailed = true;
    logFn(
      `Không xác minh được trạng thái worker sau timeout ` +
        `(${error.code || error.message}); vẫn thử dừng worker để tránh mua chồng.`
    );
  }

  if (running === true || checkFailed) {
    try {
      await withLock(() => stopWorker(page, rl));
      logFn("Đã xác nhận worker Mua phôi dừng sau timeout; sẽ kiểm tra lại kho ICON.");
    } catch (error) {
      logFn(
        `Chưa xác nhận được việc dừng worker sau timeout ` +
          `(${error.code || error.message}); agent vẫn sống và sẽ kiểm tra /stop lại ` +
          "trước khi mở chu kỳ mới."
      );
    }
  } else {
    logFn("Kiểm tra /stop sau timeout xác nhận worker Mua phôi đã dừng; không bấm chồng.");
  }

  return { running };
}

async function settleBuyOutcome(
  page,
  rl,
  outcome,
  {
    pivotToUpgrade = false,
    completedLog = "",
    ui = null,
    waitForReceipt = waitForInventoryReceipt,
    checkRunning = checkAutoBuyRunning,
    stopWorker = stopPurchaseWorker,
    closeApp = closeMiniApp,
    recoveryCooldownMs = BUY_TIMEOUT_RECOVERY_COOLDOWN_MS
  } = {}
) {
  if (outcome.status === "cycle-timeout") {
    const waitedMinutes =
      outcome.waitedMinutes ??
      Math.max(1, Math.round((outcome.waitedMs || 0) / 60_000));
    log(
      `Chu kỳ Mua phôi vượt ${waitedMinutes} phút; tự recovery: đóng mini-app, ` +
        "xác minh /stop, dừng worker nếu còn chạy rồi kiểm tra lại kho ICON."
    );
    await recoverTimedOutCycle(page, rl, {
      ui,
      checkRunning,
      stopWorker,
      closeApp,
      logFn: log
    });
    log(
      `Giữ agent sống; kiểm tra lại kho ICON sau ` +
        `${Math.round(recoveryCooldownMs / 1_000)} giây rồi tiếp tục chu kỳ nếu ` +
        "còn ICON nâng được lên target."
    );
    return {
      agentActive: true,
      openNext: false,
      pivotToUpgrade: false,
      retryInventoryCheck: true,
      inventoryCheckDelayMs: recoveryCooldownMs
    };
  }
  if (outcome.status === "stop-requested") {
    const restart = ui
      ? await ui.withLock(() => stopPurchaseWorker(page, rl))
      : await stopPurchaseWorker(page, rl);
    log(
      restart
        ? `Đã nhận /${restart} trong lúc dừng; tiếp tục sau khi xác nhận.`
        : "Agent đã dừng theo /stopagent; đang chờ lệnh /startagent mới."
    );
    return {
      agentActive: Boolean(restart),
      mode: restart ? CONTROL_MODE_BY_COMMAND[restart] : null,
      openNext: false,
      pivotToUpgrade: false
    };
  }
  if (outcome.status === "inventory-full") {
    const received = await waitForReceipt(page, outcome);
    if (received === null) {
      // Fail-safe nhưng không đứng chờ người dùng: trả tín hiệu để controller
      // giữ vòng ACTIVE sống và kiểm tra lại kho sau INVENTORY_RECEIPT_RETRY_MS.
      log(
        "Chưa xác nhận nhận cầu thủ sau khi kho đầy; giữ agent sống và " +
          `kiểm tra lại kho sau ${Math.round(
            INVENTORY_RECEIPT_RETRY_MS / 60_000
          )} phút thay vì chờ /startagent.`
      );
      return {
        agentActive: true,
        openNext: false,
        pivotToUpgrade: false,
        retryInventoryReceipt: true
      };
    }
    if (pivotToUpgrade) {
      log("Đã nhận cầu thủ vào kho sau khi kho đầy; vòng tổng chuyển sang nâng cấp.");
      return { agentActive: true, openNext: false, pivotToUpgrade: true };
    }
    log("Đã nhận cầu thủ vào kho sau khi kho đầy; tiếp tục chu kỳ Auto Mua.");
    return { agentActive: true, openNext: true, pivotToUpgrade: false };
  }
  // Bot tự dừng Auto Mua Phôi: trong chế độ tổng KHÔNG được đưa agent về idle
  // khi chưa biết kho còn ICON hay không. Quay lại kiểm tra kho (và chỉ mua
  // tiếp nếu có ICON dưới target). Chế độ không tổng giữ hành vi cũ.
  if (outcome.status === "purchase-stopped" && pivotToUpgrade) {
    log(
      "Bot đã dừng Auto Mua Phôi; KHÔNG về idle. Kiểm tra lại kho ICON sau " +
        `${Math.round(BUY_TIMEOUT_RECOVERY_COOLDOWN_MS / 1_000)} giây ` +
        "rồi mới quyết định mua phôi hay chờ ICON mới."
    );
    return {
      agentActive: true,
      openNext: false,
      pivotToUpgrade: false,
      retryInventoryCheck: true,
      inventoryCheckDelayMs: BUY_TIMEOUT_RECOVERY_COOLDOWN_MS
    };
  }
  const idleMessage = idleOutcomeMessage(outcome);
  if (idleMessage) {
    log(idleMessage);
    return { agentActive: false, openNext: false, pivotToUpgrade: false };
  }
  log(completedLog);
  return { agentActive: true, openNext: true, pivotToUpgrade: false };
}

// Ghi nhận completion của chu kỳ mua để các bước sau không gửi /stop lặp lại
// và không bị tin của chức năng khác ghi đè trạng thái.
function createBuyCompletionRecord(outcome, source) {
  if (outcome?.status !== "completed") return null;
  log(
    `Đã lưu kết quả chu kỳ mua (${outcome.playersBought} cầu thủ); ` +
      "tin chức năng khác sẽ không ghi đè trạng thái này."
  );
  return {
    playersBought: outcome.playersBought,
    source,
    recordedAt: Date.now()
  };
}

module.exports = {
  settleBuyOutcome,
  createBuyCompletionRecord,
  recoverTimedOutCycle,
  INVENTORY_RECEIPT_RETRY_MS,
  BUY_TIMEOUT_RECOVERY_COOLDOWN_MS
};
