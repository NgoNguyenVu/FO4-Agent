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

async function settleBuyOutcome(
  page,
  rl,
  outcome,
  { pivotToUpgrade = false, completedLog = "" } = {}
) {
  if (outcome.status === "stop-requested") {
    const restart = await stopPurchaseWorker(page, rl);
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
    const received = await waitForInventoryReceipt(page, outcome);
    if (received === null) {
      return { agentActive: false, openNext: false, pivotToUpgrade: false };
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
  createBuyCompletionRecord
};
