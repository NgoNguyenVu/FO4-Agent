// Điều phối một lần gọi /starticon:
//   1. tra cứu lại danh sách ICON yêu thích (có thể đổi bất cứ lúc nào)
//   2. chọn ngẫu nhiên 1 mã
//   3. đặt mua +1/1
//   4. đọc Vị trí mua; vị trí > ngưỡng hoặc không đọc được vị trí thì hủy
//      đơn mới qua TTCN
//   5. kết thúc sau 1 lượt (maxBatchesPerRun mặc định = 1), không chờ vòng lặp
//
// Module tuyệt đối không gọi /stop, không kiểm tra/dừng worker Auto Mua hay
// Auto Nâng. Controller chỉ gọi runner này khi mode === "icon".
const { chatTextReaders } = require("../../lib/chat-runtime");
const { config } = require("../config");
const { log } = require("../agent-log");
const { lookupFavoriteIconPlayers } = require("./favorites");
const { placeIconOrders } = require("./order");
const { captureTtcnBaseline, cancelIconOrders } = require("./ttcn");
const {
  selectRandomIconPlayers,
  getPositionAction,
  shouldCancelIconOrder
} = require("./patterns");

function stopRequested(reader) {
  return Boolean(reader.takeCommand("stopagent"));
}

async function placeWithRetry(page, rl, selected, reader) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (stopRequested(reader)) return { stop: true };
    try {
      return await placeIconOrders(page, rl, selected);
    } catch (error) {
      lastError = error;
      const retryable = [
        "ICON_UI_STALE",
        "ICON_RATE_LIMITED",
        "ICON_UI_NOT_READY"
      ].includes(error.code);
      if (!retryable || attempt === 2) throw error;
      log(
        `Luồng ICON gặp ${error.code} (${error.message}); ` +
          `chờ 5s rồi mở lại menu Mua cầu thủ (lần ${attempt + 1}/2).`
      );
      await page.waitForTimeout(5_000);
    }
  }
  throw lastError;
}

async function runIconBuy(page, rl, { pickPlayers = null } = {}) {
  const reader = chatTextReaders.get(page);
  if (!reader) throw new Error("Chưa khởi tạo theo dõi nội dung Telegram.");

  const usedCodes = new Set();
  let batches = 0;
  let purchased = 0;
  let canceled = 0;
  let consecutiveEmptyBatches = 0;
  let knownOrderIds = null;

  if (config.iconBuy.captureTtcnBaseline) {
    knownOrderIds = await captureTtcnBaseline(page, rl);
    if (stopRequested(reader)) return { action: "stop", batches, purchased, canceled };
  }

  while (true) {
    if (stopRequested(reader)) {
      log("Nhận /stopagent; dừng luồng ICON, giữ nguyên worker Auto Mua/Auto Nâng.");
      return { action: "stop", batches, purchased, canceled };
    }

    const favorites = await lookupFavoriteIconPlayers(page, rl);
    let selected;
    if (pickPlayers) {
      // Chỉ dùng cho debug/test có kiểm soát (ví dụ chọn cầu thủ rẻ nhất).
      // Vẫn đối chiếu lại với danh sách yêu thích vừa tra cứu.
      const allowed = new Map(favorites.map((player) => [player.code, player]));
      selected = pickPlayers(favorites)
        .map((player) => allowed.get(player.code))
        .filter((player) => player && !usedCodes.has(player.code))
        .slice(0, config.iconBuy.maxPlayersPerBatch);
    } else {
      selected = selectRandomIconPlayers(
        favorites,
        config.iconBuy.maxPlayersPerBatch,
        { exclude: usedCodes }
      );
    }
    if (!selected.length) {
      log(
        `Không còn cầu thủ ICON yêu thích chưa mua trong phiên này ` +
          `(${favorites.length} mã, đã dùng ${usedCodes.size}).`
      );
      return { action: "exhausted", batches, purchased, canceled };
    }
    selected.forEach((player) => usedCodes.add(player.code));
    log(
      `Lượt ICON ${batches + 1}: mua ${selected.map((p) => `${p.code} ${p.name}`).join(", ")}.`
    );

    const result = await placeWithRetry(page, rl, selected, reader);
    if (result.stop) {
      return { action: "stop", batches, purchased, canceled };
    }
    batches += 1;

    if (!result.successes.length) {
      if (result.fatalError) {
        const reason = /E007|giới hạn lệnh mua đang chạy/i.test(result.fatalError)
          ? "order-limit"
          : "bot-error";
        log(
          `Lượt ICON ${batches} dừng (${reason}): ${result.fatalError} ` +
            `(chưa nhận được log đặt mua cho: ` +
            `${result.missing.map((p) => p.code).join(", ") || "không rõ"}).`
        );
        return { action: "error", batches, purchased, canceled, reason };
      }
      consecutiveEmptyBatches += 1;
      log(
        `Không nhận được log đặt mua thành công cho lượt ${batches} ` +
          `(thiếu: ${result.missing.map((p) => p.code).join(", ") || "không rõ"}).`
      );
      if (consecutiveEmptyBatches >= 2) {
        return { action: "error", batches, purchased, canceled, reason: "no-purchase-success" };
      }
    } else {
      consecutiveEmptyBatches = 0;
      purchased += result.successes.length;
      if (result.missing.length) {
        log(
          `Bot chưa xác nhận đặt mua ${result.missing.map((p) => p.code).join(", ")}; ` +
            "các mã này vẫn được coi là đã dùng trong phiên để tránh mua trùng."
        );
      }
    }

    const cancelTargets = [];
    for (const success of result.successes) {
      const action = getPositionAction(success, config.iconBuy.cancelPositionAbove);
      if (shouldCancelIconOrder(success, config.iconBuy.cancelPositionAbove)) {
        cancelTargets.push(success);
        if (action === "unknown") {
          log(
            `Không lấy được vị trí mua cho ${success.code}` +
              `${success.positionError ? ` (${success.positionError})` : ""}; ` +
              "vẫn hủy đơn mới theo mã/grade để không giữ đơn chưa xác định vị trí."
          );
        }
      } else {
        log(
          `Giữ đơn ${success.code} vì vị trí ${success.position} ` +
            `<= ${config.iconBuy.cancelPositionAbove}.`
        );
      }
    }

    if (cancelTargets.length) {
      if (!knownOrderIds) {
        log(
          "Chưa có baseline TTCN; sẽ chọn card mới nhất khớp mã/grade để hủy. " +
            "Nên kiểm tra lại danh sách TTCN nếu có nhiều đơn cũ cùng cầu thủ."
        );
      }
      try {
        const cancelResult = await cancelIconOrders(page, rl, cancelTargets, knownOrderIds);
        canceled += cancelResult.canceled.length;
        if (cancelResult.failed.length || cancelResult.notFound.length) {
          log(
            `Hủy TTCN: ${cancelResult.canceled.length} thành công, ` +
              `${cancelResult.failed.length} thất bại, ` +
              `${cancelResult.notFound.length} không tìm thấy đơn mới.`
          );
        }
        if (cancelResult.failed.length) {
          // Đã có đơn đặt ở vị trí xấu mà không hủy được: dừng mua tiếp để
          // tránh tích thêm đơn ngoài ý muốn, chờ người dùng kiểm tra TTCN.
          return {
            action: "error",
            batches,
            purchased,
            canceled,
            reason: "ttcn-cancel-failed"
          };
        }
      } catch (error) {
        // Hủy lỗi không được làm mất trạng thái các đơn đã mua; chỉ log và
        // dừng phiên để người dùng kiểm tra TTCN, không tự mua tiếp.
        log(`Không hủy được đơn TTCN: ${error.message}`);
        return { action: "error", batches, purchased, canceled, reason: "ttcn-cancel-failed" };
      }
    }

    if (result.fatalError) {
      // Đã cố hủy các đơn vị trí xấu ở trên trước khi dừng.
      const reason = /E007|giới hạn lệnh mua đang chạy/i.test(result.fatalError)
        ? "order-limit"
        : "bot-error";
      log(
        `${result.fatalError} Đã xử lý TTCN (${canceled} đơn hủy thành công); ` +
          "dừng phiên ICON để tránh đặt thêm đơn."
      );
      return { action: "error", batches, purchased, canceled, reason };
    }

    if (
      config.iconBuy.maxBatchesPerRun > 0 &&
      batches >= config.iconBuy.maxBatchesPerRun
    ) {
      log(`Đã đạt giới hạn ${config.iconBuy.maxBatchesPerRun} lượt của phiên ICON.`);
      return { action: "limit", batches, purchased, canceled };
    }
    await page.waitForTimeout(config.iconBuy.batchIntervalSeconds * 1_000);
  }
}

module.exports = {
  runIconBuy
};
