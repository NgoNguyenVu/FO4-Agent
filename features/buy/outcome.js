// Quyết định sau một chu kỳ mua. Không phụ thuộc module nâng cấp:
// khi kho đầy trong chế độ tổng, chỉ trả tín hiệu pivotToUpgrade để controller
// gọi feature nâng cấp.
const { log } = require("../agent-log");
const { CONTROL_MODE_BY_COMMAND } = require("../../lib/control-commands");
const {
  stopPurchaseWorker,
  waitForInventoryReceipt
} = require("./cycle");
const { idleOutcomeMessage } = require("./patterns");

// Bot báo kho đầy nhưng chưa xác nhận nhận cầu thủ: không đưa cả agent về idle
// và bắt người dùng gửi /startagent. Giữ vòng ACTIVE sống, chờ đúng 5 phút rồi
// kiểm tra lại kho/`/stop`; chỉ mua tiếp khi trạng thái đã an toàn.
const INVENTORY_RECEIPT_RETRY_MS = 5 * 60 * 1000;

async function settleBuyOutcome(
  page,
  rl,
  outcome,
  {
    pivotToUpgrade = false,
    completedLog = "",
    ui = null,
    waitForReceipt = waitForInventoryReceipt
  } = {}
) {
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
  INVENTORY_RECEIPT_RETRY_MS
};
