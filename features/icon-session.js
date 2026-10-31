// Phiên /starticon chạy nền.
//
// Controller chỉ dùng module này cho /starticon: mỗi lệnh mở một phiên ICON
// one-shot, không thay đổi mode mua/nâng hiện tại. Chỉ một phiên ICON chạy tại
// một thời điểm; lệnh /starticon mới đến khi phiên cũ chưa xong bị bỏ qua để
// không đặt trùng. /stopagent hoặc /resetagent đánh dấu abort; runner kiểm tra
// cờ này ở các bước an toàn và vẫn hoàn tất hủy TTCN nếu đã đặt đơn.
const { log: defaultLog, logError: defaultLogError } = require("./agent-log");

function createIconSession({
  runIconBuy,
  ui = null,
  log = defaultLog,
  logError = defaultLogError,
  onResult = () => {}
}) {
  let active = null;
  let nextId = 0;

  function start(page, rl) {
    if (active) {
      log(
        `Đã có phiên ICON nền #${active.id} đang chạy; bỏ qua /starticon mới ` +
          "để tránh đặt trùng."
      );
      return { started: false, reason: "busy", id: active.id };
    }

    const task = {
      id: ++nextId,
      aborted: false,
      abortReason: null,
      promise: null
    };
    active = task;
    log(
      `Bắt đầu phiên ICON nền #${task.id}; luồng mua/nâng hiện tại (nếu có) ` +
        "vẫn chạy bình thường."
    );

    task.promise = (async () => {
      try {
        const result = await runIconBuy(page, rl, {
          isStopRequested: () => task.aborted,
          ui
        });
        if (task.aborted) {
          log(
            `Phiên ICON nền #${task.id} đã dừng theo ` +
              `${task.abortReason || "yêu cầu dừng"}.`
          );
        } else {
          onResult(result, task);
        }
        return result;
      } catch (error) {
        if (task.aborted) {
          log(
            `Phiên ICON nền #${task.id} kết thúc sau ` +
              `${task.abortReason || "yêu cầu dừng"}: ${error.message}`
          );
        } else {
          logError(
            `Phiên ICON nền #${task.id} dừng do lỗi: ${error.stack || error.message}`
          );
        }
        return null;
      } finally {
        if (active === task) active = null;
      }
    })();

    // Promise đã tự bắt lỗi bên trong; giữ tham chiếu để stopAndWait có thể chờ.
    void task.promise;
    return { started: true, id: task.id, task };
  }

  function abort(reason) {
    if (!active) return false;
    if (!active.aborted) {
      active.aborted = true;
      active.abortReason = reason;
      log(
        `Đã yêu cầu dừng phiên ICON nền #${active.id} (${reason}); ` +
          "dừng ở bước an toàn kế tiếp, vẫn hủy TTCN nếu cần."
      );
    }
    return true;
  }

  // Dùng trước khi đóng/khôi phục Telegram Web. Chờ có giới hạn để một bước
  // đang chờ bot không giữ controller quá lâu; quá hạn thì vẫn khôi phục và
  // phiên cũ sẽ tự kết thúc khi page cũ đóng.
  async function stopAndWait(reason, timeoutMs = 45_000) {
    if (!active) return true;
    abort(reason);
    const task = active;
    let timer = null;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    try {
      const outcome = await Promise.race([
        task.promise.then(() => "done"),
        timeout
      ]);
      if (outcome === "timeout") {
        log(
          `Phiên ICON nền #${task.id} chưa dừng sau ` +
            `${Math.round(timeoutMs / 1_000)}s; tiếp tục khôi phục Telegram Web.`
        );
        return false;
      }
      return true;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    start,
    abort,
    stopAndWait,
    isActive: () => Boolean(active),
    activeId: () => (active ? active.id : null)
  };
}

module.exports = {
  createIconSession
};
