// Điều phối phiên /starticon:
//   1. đọc menu /stop để biết bao nhiêu slot MUA đang dùng (E003 = 0 slot)
//   2. mua bù đủ maxTaskSlots của bot (mặc định 3), tối đa 3 mã mỗi lượt
//   3. đọc log đặt mua; vị trí > ngưỡng hoặc không đọc được thì hủy qua TTCN
//   4. dừng task của đơn đã hủy để nhả slot, rồi lặp lại để giữ đủ slot
//
// Bot "Mua cầu thủ" có thể chỉ theo dõi giá và chưa tạo đơn trong thời gian chờ.
// Vì vậy trước khi đặt, runner chụp baseline menu /stop; nếu hết hạn, bị dừng
// hoặc lỗi sau khi đã gửi lệnh, runner dừng đúng task MUA mới (không bấm nút
// dừng toàn bộ) rồi kiểm tra TTCN để hủy đơn vừa xuất hiện. Nhờ đó phiên ICON
// không để lại worker theo dõi giá hoặc đơn chưa xử lý.
//
// Module tuyệt đối không gọi /stop để dừng worker Auto Mua/Auto Nâng có sẵn;
// menu /stop chỉ được dùng để đọc task và bấm đúng task ICON mới của phiên này.
// Controller chạy runner này ở nền; các thao tác UI được bảo vệ bởi khóa chung.
const { chatTextReaders } = require("../../lib/chat-runtime");
const { config } = require("../config");
const { log } = require("../agent-log");
const { lookupFavoriteIconPlayers } = require("./favorites");
const { placeIconOrders } = require("./order");
const { captureTtcnBaseline, cancelIconOrders } = require("./ttcn");
const {
  captureStopTaskBaseline,
  stopNewIconTasks,
  countRunningTaskSlots,
  getAvailableTaskSlots
} = require("./tasks");
const {
  selectRandomIconPlayers,
  getPositionAction,
  shouldCancelIconOrder
} = require("./patterns");

function makeStopSignal(reader, isStopRequested) {
  if (typeof isStopRequested === "function") {
    return () => Boolean(isStopRequested());
  }
  return () => Boolean(reader.takeCommand("stopagent"));
}

function withUi(ui, fn) {
  return ui ? ui.withLock(fn) : fn();
}

async function placeWithRetry(page, rl, selected, stopSignal, ui) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (stopSignal()) return { stop: true };
    try {
      // placeIconOrders tự nhả khóa trong lúc chờ log mua (chỉ đọc chat), rồi
      // giữ lại khóa trước khi trả về để phần hủy TTCN không chạy chen.
      return await withUi(ui, () =>
        placeIconOrders(page, rl, selected, { ui, isStopRequested: stopSignal })
      );
    } catch (error) {
      lastError = error;
      // Đã gửi lệnh mua rồi thì không retry: retry có thể tạo thêm task/đơn.
      if (error.purchaseSent) throw error;
      const retryable = [
        "ICON_UI_STALE",
        "ICON_RATE_LIMITED",
        "ICON_UI_NOT_READY"
      ].includes(error.code);
      if (!retryable || attempt === 2) throw error;
      if (stopSignal()) return { stop: true };
      log(
        `Luồng ICON gặp ${error.code} (${error.message}); ` +
          `chờ 5s rồi mở lại menu Mua cầu thủ (lần ${attempt + 1}/2).`
      );
      await page.waitForTimeout(5_000);
    }
  }
  throw lastError;
}

async function stopOrphanIconTasks(page, rl, taskBaseline, selected, ui) {
  const taskIds = taskBaseline?.taskIds || taskBaseline;
  if (!taskBaseline) {
    log(
      "Không có baseline /stop; bỏ qua bước dừng task ICON để tránh đụng worker khác. " +
        "Hãy kiểm tra menu /stop nếu phiên không đặt được đơn."
    );
    return null;
  }
  try {
    const result = await withUi(ui, () =>
      stopNewIconTasks(page, rl, taskIds, selected, {
        grade: config.iconBuy.grade,
        quantity: config.iconBuy.quantity
      })
    );
    if (result.menuUnread) {
      log(
        "Không đọc được menu /stop sau 2 lần; chưa thể xác nhận task ICON mới " +
          "đã dừng. Kiểm tra menu /stop trước khi gửi /starticon lại."
      );
      result.failed.push({
        code: selected.map((player) => player.code).join(","),
        message: "không đọc được menu /stop"
      });
    }
    if (result.failed.length) {
      log(
        `Có ${result.failed.length} task ICON mới chưa dừng được; ` +
          "kiểm tra menu /stop trước khi gửi /starticon lại."
      );
    }
    return result;
  } catch (error) {
    log(`Không dọn được task ICON mới: ${error.message}`);
    return { stopped: [], failed: [{ message: error.message }], menuUnread: true };
  }
}

// Hủy các đơn mới xuất hiện cho mã chưa có log thành công (vị trí không xác
// định). Chỉ làm khi có baseline TTCN để không chọn nhầm đơn cũ của cùng mã.
async function cancelUnconfirmedOrders(page, rl, players, knownOrderIds, ui) {
  if (!players.length) return null;
  if (!knownOrderIds) {
    log(
      "Không có baseline TTCN; không tự hủy đơn cho mã chưa xác nhận để tránh " +
        "đụng đơn cũ. Hãy kiểm tra TTCN thủ công."
    );
    return null;
  }
  try {
    const result = await withUi(ui, () =>
      cancelIconOrders(
        page,
        rl,
        players.map((player) => ({
          code: player.code,
          grade: config.iconBuy.grade,
          position: null,
          positionError: "unknown"
        })),
        knownOrderIds
      )
    );
    if (result.canceled.length) {
      log(
        `Đã hủy ${result.canceled.length} đơn TTCN mới cho mã chưa xác nhận ` +
          `(${players.map((player) => player.code).join(", ")}).`
      );
    }
    if (result.failed.length) {
      log(
        `Hủy TTCN cho mã chưa xác nhận thất bại: ` +
          `${result.failed.map((item) => item.code).join(", ")}.`
      );
    }
    return result;
  } catch (error) {
    log(`Không kiểm tra/hủy được TTCN cho mã chưa xác nhận: ${error.message}`);
    return null;
  }
}

async function runIconBuy(page, rl, { pickPlayers = null, isStopRequested = null, ui = null } = {}) {
  const reader = chatTextReaders.get(page);
  if (!reader) throw new Error("Chưa khởi tạo theo dõi nội dung Telegram.");
  const stopSignal = makeStopSignal(reader, isStopRequested);
  const maxTaskSlots = config.iconBuy.maxTaskSlots;
  const continuous = config.iconBuy.continuous !== false;

  let batches = 0;
  let purchased = 0;
  let canceled = 0;
  let knownOrderIds = null;
  let sessionTaskBaseline = null;
  const sessionPlayers = new Map();

  // Khi phiên kết thúc (kể cả lỗi), chỉ dừng các task do chính phiên này tạo.
  // Task có trong baseline đầu tiên không bao giờ bị đụng.
  const finish = async (result) => {
    if (!sessionPlayers.size || !sessionTaskBaseline) return result;
    const stopped = await stopOrphanIconTasks(
      page,
      rl,
      sessionTaskBaseline,
      [...sessionPlayers.values()],
      ui
    );
    if (stopped?.failed?.length && result.action !== "stop") {
      return { ...result, action: "error", reason: "icon-task-stop-failed" };
    }
    return result;
  };

  while (true) {
    if (stopSignal()) {
      log("Nhận lệnh dừng; dừng luồng ICON, giữ nguyên worker Auto Mua/Auto Nâng.");
      return finish({ action: "stop", batches, purchased, canceled });
    }

    // Đọc /stop mỗi vòng để biết slot MUA đang dùng. E003 / "không có lệnh nào
    // đang chạy" là baseline rỗng hợp lệ, không phải lỗi.
    const taskBaseline = await withUi(ui, () => captureStopTaskBaseline(page, rl));
    if (stopSignal()) {
      return finish({ action: "stop", batches, purchased, canceled });
    }
    if (!taskBaseline) {
      log(
        "Không đọc được baseline menu /stop; không đặt mua ICON để tránh tạo " +
          "task theo dõi giá không thể dọn. Kiểm tra Telegram rồi gửi lại /starticon."
      );
      return finish({
        action: "error",
        batches,
        purchased,
        canceled,
        reason: "no-task-baseline"
      });
    }
    if (!sessionTaskBaseline) sessionTaskBaseline = taskBaseline;

    const runningTaskList = taskBaseline.tasks || taskBaseline;
    const usedTaskSlots = countRunningTaskSlots(runningTaskList, "MUA");
    const availableTaskSlots = getAvailableTaskSlots(
      runningTaskList,
      maxTaskSlots,
      "MUA"
    );

    if (availableTaskSlots <= 0) {
      if (!continuous) {
        log(
          `Đã có ${usedTaskSlots}/${maxTaskSlots} task MUA đang chạy; ` +
            "/starticon không đặt thêm (hết slot mua)."
        );
        return finish({
          action: "error",
          batches,
          purchased,
          canceled,
          reason: "task-slots-full"
        });
      }
      log(
        `Đã đủ ${usedTaskSlots}/${maxTaskSlots} slot MUA; chờ slot trống rồi mua tiếp.`
      );
      await page.waitForTimeout(config.iconBuy.slotPollSeconds * 1_000);
      continue;
    }

    // Chỉ check TTCN khi thực sự sắp đặt thêm đơn; baseline này dùng để không
    // chọn nhầm đơn cũ khi cần hủy.
    if (config.iconBuy.captureTtcnBaseline) {
      knownOrderIds = await withUi(ui, () => captureTtcnBaseline(page, rl));
      if (stopSignal()) {
        return finish({ action: "stop", batches, purchased, canceled });
      }
    }

    const favorites = await withUi(ui, () => lookupFavoriteIconPlayers(page, rl));
    if (stopSignal()) {
      return finish({ action: "stop", batches, purchased, canceled });
    }

    // Không chọn lại mã đang có task MUA chạy để tránh đặt trùng.
    const activeCodes = new Set(
      (runningTaskList || [])
        .filter((task) => String(task?.kind || "").toUpperCase() === "MUA")
        .map((task) => String(task.code || ""))
        .filter(Boolean)
    );
    const batchLimit = Math.min(
      availableTaskSlots,
      config.iconBuy.maxPlayersPerBatch
    );
    let selected;
    if (pickPlayers) {
      // Chỉ dùng cho debug/test có kiểm soát (ví dụ chọn cầu thủ rẻ nhất).
      // Vẫn đối chiếu lại với danh sách yêu thích vừa tra cứu.
      const allowed = new Map(favorites.map((player) => [player.code, player]));
      selected = pickPlayers(favorites)
        .map((player) => allowed.get(player.code))
        .filter((player) => player && !activeCodes.has(player.code))
        .slice(0, batchLimit);
    } else {
      selected = selectRandomIconPlayers(favorites, batchLimit, {
        exclude: activeCodes
      });
    }

    if (!selected.length) {
      const waitingForActive = favorites.some((player) =>
        activeCodes.has(player.code)
      );
      if (continuous && waitingForActive) {
        log(
          `Tất cả ${favorites.length} mã ICON yêu thích đang có task chạy; ` +
            "chờ task kết thúc rồi thử lại."
        );
        await page.waitForTimeout(config.iconBuy.slotPollSeconds * 1_000);
        continue;
      }
      log(
        `Không còn cầu thủ ICON yêu thích chưa mua trong phiên này ` +
          `(${favorites.length} mã).`
      );
      return finish({ action: "exhausted", batches, purchased, canceled });
    }

    selected.forEach((player) => sessionPlayers.set(player.code, player));
    log(
      `Lượt ICON ${batches + 1}: mua ${selected
        .map((player) => `${player.code} ${player.name}`)
        .join(", ")} ` +
        `(slot ${usedTaskSlots}/${maxTaskSlots} -> ` +
        `${usedTaskSlots + selected.length}/${maxTaskSlots}).`
    );

    let result;
    try {
      result = await placeWithRetry(page, rl, selected, stopSignal, ui);
    } catch (error) {
      // Lỗi sau khi đã gửi lệnh: dừng task mới (nếu có) và kiểm tra TTCN trước
      // khi kết thúc để không để lại worker theo dõi giá hoặc đơn chưa xử lý.
      if (error.purchaseSent) {
        await stopOrphanIconTasks(page, rl, taskBaseline, selected, ui);
        await cancelUnconfirmedOrders(page, rl, selected, knownOrderIds, ui);
      }
      throw error;
    }

    if (result.stop) {
      return finish({ action: "stop", batches, purchased, canceled });
    }
    if (result.stopped) {
      // /stopagent đến trong lúc chờ log mua: dừng task mới, hủy đơn chưa xác
      // nhận (nếu có) rồi kết thúc. Nếu đã có success thì vẫn xử lý vị trí ở
      // luồng bên dưới trước khi dừng, để không giữ đơn vị trí xấu.
      if (!result.successes.length) {
        const stopped = await stopOrphanIconTasks(
          page,
          rl,
          taskBaseline,
          selected,
          ui
        );
        await cancelUnconfirmedOrders(
          page,
          rl,
          result.missing.length ? result.missing : selected,
          knownOrderIds,
          ui
        );
        if (stopped?.failed?.length) {
          return finish({
            action: "error",
            batches,
            purchased,
            canceled,
            reason: "icon-task-stop-failed"
          });
        }
        log("Nhận lệnh dừng trong lúc chờ đặt mua ICON; đã dọn task mới và kết thúc phiên.");
        return finish({ action: "stop", batches, purchased, canceled });
      }
      log("Nhận lệnh dừng nhưng đã có đơn ICON; xử lý vị trí rồi kết thúc phiên.");
    }
    batches += 1;

    if (!result.successes.length) {
      const missing = result.missing.length ? result.missing : selected;
      if (result.fatalError) {
        const reason = /E007|giới hạn lệnh mua đang chạy/i.test(result.fatalError)
          ? "order-limit"
          : "bot-error";
        log(
          `Lượt ICON ${batches} dừng (${reason}): ${result.fatalError} ` +
            `(chưa nhận được log đặt mua cho: ` +
            `${missing.map((player) => player.code).join(", ") || "không rõ"}).`
        );
        if (reason !== "order-limit") {
          // E007 nghĩa là bot chưa tạo task mới; các lỗi khác vẫn có thể đã tạo.
          await stopOrphanIconTasks(page, rl, taskBaseline, selected, ui);
          await cancelUnconfirmedOrders(page, rl, missing, knownOrderIds, ui);
        }
        return finish({
          action: "error",
          batches,
          purchased,
          canceled,
          reason
        });
      }

      log(
        `Không nhận được log đặt mua thành công cho lượt ${batches} ` +
          `(thiếu: ${missing.map((player) => player.code).join(", ") || "không rõ"}); ` +
          "dừng task ICON mới và kiểm tra TTCN trước khi kết thúc."
      );
      const stopped = await stopOrphanIconTasks(
        page,
        rl,
        taskBaseline,
        selected,
        ui
      );
      const orphanOrders = await cancelUnconfirmedOrders(
        page,
        rl,
        missing,
        knownOrderIds,
        ui
      );
      if (stopped?.failed?.length) {
        return finish({
          action: "error",
          batches,
          purchased,
          canceled,
          reason: "icon-task-stop-failed"
        });
      }
      if (orphanOrders?.failed?.length) {
        return finish({
          action: "error",
          batches,
          purchased,
          canceled,
          reason: "ttcn-cancel-failed"
        });
      }
      return finish({
        action: "error",
        batches,
        purchased,
        canceled,
        reason: "no-purchase-success"
      });
    }

    purchased += result.successes.length;
    let missingCleanupFailed = false;
    if (result.missing.length) {
      log(
        `Bot chưa xác nhận đặt mua ${result.missing
          .map((player) => player.code)
          .join(", ")}; các mã này vẫn được coi là đã dùng trong phiên để tránh mua trùng. ` +
          "Đang dừng task mới (nếu còn) và kiểm tra TTCN."
      );
      // Chỉ dừng task của các mã chưa xác nhận; task của đơn giữ lại phải tiếp
      // tục chạy để giữ slot 3/3.
      const stopped = await stopOrphanIconTasks(
        page,
        rl,
        taskBaseline,
        result.missing,
        ui
      );
      const orphanOrders = await cancelUnconfirmedOrders(
        page,
        rl,
        result.missing,
        knownOrderIds,
        ui
      );
      missingCleanupFailed = Boolean(
        stopped?.failed?.length || orphanOrders?.failed?.length
      );
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
        const cancelResult = await withUi(ui, () =>
          cancelIconOrders(page, rl, cancelTargets, knownOrderIds)
        );
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
          // Vẫn dừng task ICON mới (nếu còn) để nó không đặt thêm đơn.
          await stopOrphanIconTasks(page, rl, taskBaseline, selected, ui);
          return finish({
            action: "error",
            batches,
            purchased,
            canceled,
            reason: "ttcn-cancel-failed"
          });
        }

        // Đơn đã hủy nhả slot: dừng đúng task của các mã vừa hủy để vòng sau
        // mua bù lại. Task của các đơn giữ lại không bị đụng.
        const stopped = await stopOrphanIconTasks(
          page,
          rl,
          taskBaseline,
          cancelTargets,
          ui
        );
        if (stopped?.failed?.length) {
          return finish({
            action: "error",
            batches,
            purchased,
            canceled,
            reason: "icon-task-stop-failed"
          });
        }
      } catch (error) {
        // Hủy lỗi không được làm mất trạng thái các đơn đã mua; chỉ log và
        // dừng phiên để người dùng kiểm tra TTCN, không tự mua tiếp.
        log(`Không hủy được đơn TTCN: ${error.message}`);
        await stopOrphanIconTasks(page, rl, taskBaseline, selected, ui);
        return finish({
          action: "error",
          batches,
          purchased,
          canceled,
          reason: "ttcn-cancel-failed"
        });
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
      if (reason !== "order-limit") {
        await stopOrphanIconTasks(page, rl, taskBaseline, selected, ui);
        await cancelUnconfirmedOrders(
          page,
          rl,
          result.missing,
          knownOrderIds,
          ui
        );
      }
      return finish({
        action: "error",
        batches,
        purchased,
        canceled,
        reason
      });
    }

    if (missingCleanupFailed) {
      return finish({
        action: "error",
        batches,
        purchased,
        canceled,
        reason: "icon-task-cleanup-failed"
      });
    }

    if (stopSignal()) {
      log("Nhận lệnh dừng sau khi xử lý xong đơn ICON; kết thúc phiên.");
      return finish({ action: "stop", batches, purchased, canceled });
    }

    const reachedLimit =
      config.iconBuy.maxBatchesPerRun > 0 &&
      batches >= config.iconBuy.maxBatchesPerRun;
    if (!continuous && reachedLimit) {
      log(`Đã đạt giới hạn ${config.iconBuy.maxBatchesPerRun} lượt của phiên ICON.`);
      return finish({ action: "limit", batches, purchased, canceled });
    }

    // Chờ một nhịp ngắn rồi đọc lại /stop. Nếu các task vừa đặt còn chạy, vòng
    // sau sẽ thấy đủ slot và chờ; nếu task đã xong/hủy, vòng sau mua bù.
    await page.waitForTimeout(config.iconBuy.batchIntervalSeconds * 1_000);
  }
}

module.exports = {
  runIconBuy
};
