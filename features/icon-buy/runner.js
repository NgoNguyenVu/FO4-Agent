// Điều phối một lượt mua ICON:
//   1. đọc menu /stop để biết bao nhiêu slot MUA đang dùng (E003 = 0 slot)
//   2. mua bù đủ maxTaskSlots của bot (mặc định 3), tối đa 3 mã mỗi lượt
//   3. đọc log đặt mua; chỉ vị trí > ngưỡng mới hủy qua TTCN
//   4. trả quyền điều khiển cho vòng phôi/nâng sau một lượt thành công
//
// Bot "Mua cầu thủ" có thể chỉ theo dõi giá và chưa tạo đơn trong thời gian chờ.
// Vì vậy trước khi đặt, runner chụp baseline menu /stop; nếu hết hạn, bị dừng
// hoặc lỗi sau khi đã gửi lệnh, runner giữ nguyên task. /stop tuyệt đối không
// được dùng để dừng hay hủy bất cứ thứ gì.
//
// Module tuyệt đối không gọi /stop để dừng worker Auto Mua/Auto Nâng có sẵn;
// menu /stop chỉ được dùng để đọc và đếm task; không bấm bất kỳ nút dừng nào.
// Controller chạy runner này ở nền; các thao tác UI được bảo vệ bởi khóa chung.
const { chatTextReaders } = require("../../lib/chat-runtime");
const { config } = require("../config");
const { log } = require("../agent-log");
const { lookupFavoriteIconPlayers } = require("./favorites");
const { placeIconOrders, waitForPurchaseResults } = require("./order");
const { getVisibleMessageIds } = require("./chat-messages");
const { captureTtcnBaseline, cancelIconOrders } = require("./ttcn");
const { hardReloadTelegram } = require("../telegram-io");
const {
  captureStopTaskBaseline,
  countRunningTaskSlots,
  getAvailableTaskSlots
} = require("./tasks");
const {
  selectRandomIconPlayers,
  selectMonitoredIconTasks,
  getPositionAction,
  decideCancelTargets,
  findLatestKnownPositions
} = require("./patterns");

const CANCEL_RETRY_DELAY_MS = 60_000;
const CANCEL_MAX_ATTEMPTS = 2;
// Đơn vị trí xấu chưa hủy được sẽ thử lại ở nhịp chậm dần (tối đa 30 phút).
// KHÔNG chặn việc mua bù slot: trước đây chặn nên khi bot không trả /tn, agent
// đứng im hàng giờ (log 19:xx-01:xx chỉ lặp /stop + /tn).
const CANCEL_PENDING_MAX_BACKOFF_MS = 1_800_000;
// Số lần liên tiếp không đọc được /stop trước khi báo controller mở lại phiên
// Telegram. Với backoff tối đa 5 phút, 8 lần tương đương ~30-40 phút kẹt; không
// để agent lặp vô hạn như log 01:48-03:43 (hơn 2 giờ chỉ đọc được 0 bubble).
const STOP_READ_MAX_FAILURES = 8;

function pendingCancelKey(item) {
  return `${item.code}:${item.orderId || item.position || ""}`;
}

function makeStopSignal(reader, isStopRequested) {
  if (typeof isStopRequested === "function") {
    return () => Boolean(isStopRequested());
  }
  return () => Boolean(reader.takeCommand("stopagent"));
}

function withUi(ui, fn) {
  return ui ? ui.withLock(fn) : fn();
}

// Bot thường không trả menu /tn trong lúc còn xử lý đơn mua, nên lần mở TTCN
// đầu tiên có thể thất bại dù đơn vẫn còn. Chờ một nhịp rồi thử lại đúng một
// lần; mỗi lần chỉ mở mini-app một lượt để không spam /tn.
async function cancelIconOrdersWithRetry(page, rl, targets, knownOrderIds, ui) {
  let lastError = null;
  for (let attempt = 1; attempt <= CANCEL_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await withUi(ui, () =>
        cancelIconOrders(page, rl, targets, knownOrderIds)
      );
    } catch (error) {
      lastError = error;
      const retryable = /MENU_BUSY|MINI_APP_NOT_OPENED|E006/i.test(
        `${error.code || ""} ${error.message || ""}`
      );
      if (attempt >= CANCEL_MAX_ATTEMPTS || !retryable) throw error;
      log(
        `Chưa mở được TTCN để hủy đơn (${error.message}); chờ ` +
          `${CANCEL_RETRY_DELAY_MS / 1_000}s rồi thử lại ` +
          `(lần ${attempt + 1}/${CANCEL_MAX_ATTEMPTS}).`
      );
      await page.waitForTimeout(CANCEL_RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

// Quét toàn bộ cửa sổ chat để lấy vị trí xấu của mọi mã đã đặt trong phiên.
// Bot có thể gửi "Vị trí mua" sau khi task đã kết thúc và rời /stop (đơn
// 101005099 vị trí 4 lúc 11:03), nên nguồn phải là sessionPlayers chứ không
// chỉ các task đang chạy.
function collectLateBadPositions(reader, players, tried) {
  const targets = [];
  if (!Array.isArray(players) || !players.length) return targets;
  const knownPositions = findLatestKnownPositions(
    reader.snapshot().text,
    players,
    config.iconBuy.grade,
    config.iconBuy.quantity
  );
  for (const [code, position] of knownPositions) {
    if (Number(position) <= Number(config.iconBuy.cancelPositionAbove)) continue;
    const key = `${code}:${position}`;
    // Mỗi cặp mã:vị trí chỉ thử một lần, tránh mở TTCN lặp lại.
    if (tried.has(key)) continue;
    tried.add(key);
    targets.push({
      code: String(code),
      grade: config.iconBuy.grade,
      quantity: config.iconBuy.quantity,
      total: config.iconBuy.quantity,
      position: Number(position),
      positionError: null
    });
  }
  return targets;
}

async function cancelLateBadPositions(
  page,
  rl,
  targets,
  baselineForCancel,
  tried,
  ui
) {
  if (!targets.length) return { canceled: 0, failed: [] };
  if (!baselineForCancel) {
    // Chưa có baseline TTCN thì không phân biệt được đơn cũ/đơn phiên này;
    // bỏ qua và xóa dấu để lần quét sau (đã có baseline) thử lại.
    log(
      "Thấy vị trí mua xấu trong log chat nhưng chưa có baseline TTCN; " +
        "không hủy để tránh nhầm đơn cũ."
    );
    for (const item of targets) tried.delete(`${item.code}:${item.position}`);
    return { canceled: 0, failed: [] };
  }
  log(
    `Phát hiện ${targets.length} đơn vị trí xấu từ log chat: ` +
      targets
        .map((item) => `${item.code} (vị trí ${item.position})`)
        .join(", ") +
      "; hủy qua TTCN."
  );
  try {
    const late = await cancelIconOrdersWithRetry(
      page,
      rl,
      targets,
      baselineForCancel,
      ui
    );
    if (late.canceled.length) {
      log(
        `Đã hủy ${late.canceled.length} đơn vị trí xấu đọc từ log chat; ` +
          "quay lại /stop để mua bù slot vừa trống."
      );
    }
    if (late.failed.length) {
      log(
        `Hủy TTCN từ log chat thất bại cho ` +
          `${late.failed.map((item) => item.code).join(", ")}; ` +
          "sẽ thử lại ở nhịp theo dõi sau."
      );
    }
    return { canceled: late.canceled.length, failed: late.failed };
  } catch (error) {
    log(
      `Không hủy được đơn vị trí xấu từ log chat: ${error.message}; ` +
        "sẽ thử lại ở nhịp theo dõi sau."
    );
    return { canceled: 0, failed: targets };
  }
}

async function placeWithRetry(
  page,
  rl,
  selected,
  stopSignal,
  ui,
  ttcnBaselineIds,
  { scanPlayers = null, onBadPositions = null } = {}
) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (stopSignal()) return { stop: true };
    try {
      // placeIconOrders tự nhả khóa trong lúc chờ log mua (chỉ đọc chat), rồi
      // giữ lại khóa trước khi trả về để phần hủy TTCN không chạy chen.
      return await withUi(ui, () =>
        placeIconOrders(page, rl, selected, {
          ui,
          isStopRequested: stopSignal,
          ttcnBaselineIds,
          scanPlayers,
          onBadPositions
        })
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
  log(
    `Giữ nguyên ${selected.length} task ICON; /stop chỉ dùng để đọc số lượng ` +
      "và tuyệt đối không bấm dừng task."
  );
  return { stopped: [], failed: [], menuUnread: false };
}

async function cancelBadPositions(page, rl, successes, knownOrderIds, canceled, ui, tried = null) {
  const cancelTargets = decideCancelTargets(
    successes,
    config.iconBuy.cancelPositionAbove
  );
  // Đánh dấu đã xử lý để vòng quét log chat không thử hủy lại đúng đơn này
  // (log vẫn còn trong cửa sổ chat vài chục phút).
  if (tried instanceof Set) {
    for (const item of cancelTargets) {
      tried.add(`${item.code}:${item.position}`);
    }
  }
  for (const success of successes) {
    const action = getPositionAction(success, config.iconBuy.cancelPositionAbove);
    if (action === "unknown") {
      log(
        `Không xác định được vị trí mua ${success.code}` +
          `${success.positionError ? ` (${success.positionError})` : ""}; ` +
          "giữ nguyên đơn, không hủy."
      );
    } else if (action === "keep") {
      log(
        `Giữ đơn ${success.code} vì vị trí ${success.position} ` +
          `<= ${config.iconBuy.cancelPositionAbove}.`
      );
    } else if (action === "cancel") {
      // Log rõ vị trí trước khi hủy: trước đây đơn bị hủy mà log chỉ có mã/giá,
      // không biết vị trí nào vượt ngưỡng (log 08:40:22).
      log(
        `Hủy đơn ${success.code} vì vị trí ${success.position} > ` +
          `${config.iconBuy.cancelPositionAbove}.`
      );
    }
  }
  if (!cancelTargets.length) return { canceled, failed: false, failedTargets: [] };
  const result = await cancelIconOrdersWithRetry(
    page,
    rl,
    cancelTargets,
    knownOrderIds,
    ui
  );
  const nextCanceled = canceled + result.canceled.length;
  if (result.failed.length) {
    log(`Hủy TTCN thất bại cho ${result.failed.map((item) => item.code).join(", ")}.`);
  }
  return {
    canceled: nextCanceled,
    failed: result.failed.length > 0,
    failedTargets: result.failed
  };
}

async function monitorExistingOrders(
  page,
  reader,
  rl,
  tasks,
  stopSignal,
  knownOrderIds,
  sessionTtcnBaselineIds,
  ui,
  {
    maxWaitMs = Infinity,
    triedPositions = null,
    sessionPlayers = null,
    onBadPositions = null
  } = {}
) {
  const players = selectMonitoredIconTasks(tasks, {
    grade: config.iconBuy.grade,
    quantity: config.iconBuy.quantity
  }).map((task) => ({ code: String(task.code), name: String(task.code) }));
  if (!players.length) return { stopped: false, canceled: 0, failed: false };

  const baselineForCancel = sessionTtcnBaselineIds || knownOrderIds || null;
  const tried = triedPositions instanceof Set ? triedPositions : new Set();
  // Quét cả mã đã mua trong phiên dù task đã kết thúc và rời /stop. Bot có thể
  // gửi "Vị trí mua" rất muộn (đơn 101005099 vị trí 4 lúc 11:03), nếu chỉ quét
  // task đang chạy thì đơn vị trí xấu bị bỏ sót.
  const scanMap = new Map(players.map((player) => [player.code, player]));
  for (const player of sessionPlayers || []) {
    const code = String(player?.code || player || "");
    if (code && !scanMap.has(code)) scanMap.set(code, { code, name: code });
  }
  const scanPlayers = [...scanMap.values()];
  // Quét toàn bộ cửa sổ chat mỗi vòng để bắt vị trí xấu ngay khi nó xuất hiện,
  // không phụ thuộc việc log có rơi đúng lúc đang chờ hay không.
  const lateTargets = collectLateBadPositions(reader, scanPlayers, tried);
  let canceled = 0;
  if (lateTargets.length) {
    // Log vị trí đọc được từ log chat trước khi hủy, để không còn cảnh
    // "thấy hủy đơn mà không biết vị trí mấy" (log 08:40:22).
    const late = await cancelLateBadPositions(
      page,
      rl,
      lateTargets,
      baselineForCancel,
      tried,
      ui
    );
    canceled += late.canceled;
    if (late.canceled) {
      return { stopped: false, canceled, failed: false, failedTargets: [] };
    }
    if (late.failed.length) {
      // Đưa vào pendingCancels (runner) để thử lại có backoff thay vì mở TTCN
      // lại mỗi vòng quét.
      return {
        stopped: false,
        canceled,
        failed: true,
        failedTargets: late.failed
      };
    }
  }

  const baselineIds = await getVisibleMessageIds(page).catch(() => null);
  const result = await waitForPurchaseResults(
    page,
    reader,
    reader.snapshot().text,
    players,
    baselineIds,
    {
      isStopRequested: stopSignal,
      // Không dò TTCN trong chế độ theo dõi: /stop đã xác nhận task đang chạy,
      // còn vị trí mua chỉ có trong log chat. Tránh mở mini-app định kỳ.
      ttcnBaselineIds: null,
      ui,
      rl,
      maxWaitMs,
      // Nhịp theo dõi đã có heartbeat 5 phút/lần; không lặp thêm dòng
      // "chưa thấy log" mỗi cửa sổ 15 phút.
      quietTimeout: true,
      // Chỉ theo dõi task có sẵn: không coi E006/prompt/giới hạn của bot là
      // lỗi của đơn vừa gửi (trước đây làm dừng cả luồng ICON).
      monitorOnly: true,
      // Trong lúc chờ 15 phút vẫn quét vị trí xấu của mọi đơn trong phiên.
      scanPlayers,
      onBadPositions
    }
  );
  if (result.stopped) return { stopped: true, canceled, failed: false, failedTargets: [] };
  let handled = { canceled: 0, failed: false, failedTargets: [] };
  try {
    handled = await cancelBadPositions(
      page,
      rl,
      result.successes,
      baselineForCancel,
      0,
      ui,
      tried
    );
  } catch (error) {
    // Không để lỗi mở TTCN biến thành promise treo/không rõ trạng thái.
    log(`Không hủy được đơn vị trí xấu: ${error.message}`);
    return {
      stopped: false,
      canceled,
      failed: true,
      failedTargets: decideCancelTargets(
        result.successes,
        config.iconBuy.cancelPositionAbove
      )
    };
  }
  return {
    stopped: false,
    canceled: canceled + handled.canceled,
    failed: handled.failed,
    failedTargets: handled.failedTargets || []
  };
}

// Tải lại trang Telegram khi cửa sổ chat không còn bubble. Lỗi reload không
// được làm chết luồng: caller sẽ chờ backoff rồi đọc lại.
async function reloadTelegramForRecovery(page, ui) {
  try {
    log("Cửa sổ chat không còn nội dung; tải lại trang Telegram để khôi phục chat bot.");
    await withUi(ui, () => hardReloadTelegram(page));
    return true;
  } catch (error) {
    log(`Không tải lại được trang Telegram: ${error.message}`);
    return false;
  }
}

async function captureStopBaselineWithRetry(page, rl, stopSignal, ui) {
  const maxAttempts = 3;
  let reloaded = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (stopSignal()) return null;
    const baseline = await withUi(ui, () => captureStopTaskBaseline(page, rl));
    if (baseline) return baseline;
    if (attempt >= maxAttempts) break;
    log(
      `Chưa đọc được menu /stop (lần ${attempt}/${maxAttempts}); ` +
        "có thể luồng mua/nâng đang ghi chat, sẽ thử lại."
    );
    // Không còn bubble nào = Telegram đã đóng cột chat/kẹt màn hình "Chats".
    // page.goto cùng hash không dựng lại UI, phải reload cứng một lần.
    const visibleIds = await getVisibleMessageIds(page).catch(() => null);
    if (!visibleIds && !reloaded) {
      reloaded = true;
      if (await reloadTelegramForRecovery(page, ui)) continue;
    }
    await page.waitForTimeout(2_000);
  }
  return null;
}

async function runIconBuy(page, rl, {
  pickPlayers = null,
  isStopRequested = null,
  ui = null,
  onPurchaseSuccess = null
} = {}) {
  const reader = chatTextReaders.get(page);
  if (!reader) throw new Error("Chưa khởi tạo theo dõi nội dung Telegram.");
  const stopSignal = makeStopSignal(reader, isStopRequested);
  const maxTaskSlots = config.iconBuy.maxTaskSlots;
  const continuous = config.iconBuy.continuous !== false;

  let batches = 0;
  let purchased = 0;
  let canceled = 0;
  let knownOrderIds = null;
  let sessionTtcnBaselineIds = null;
  let sessionTaskBaseline = null;
  const sessionPlayers = new Map();
  // Mỗi cặp mã:vị trí chỉ thử hủy một lần trong phiên, tránh mở TTCN lặp lại
  // khi bot vẫn chưa trả menu.
  const monitorTriedPositions = new Set();
  // Đơn vị trí xấu đã xác định nhưng TTCN chưa hủy được. Giữ cả orderId để lần
  // sau hủy đúng card dù card đó đã nằm trong baseline TTCN của phiên (nếu
  // không, baseline sẽ loại trừ và đơn xấu không bao giờ được hủy).
  const pendingCancels = new Map();
  let pendingCancelBackoffMs = CANCEL_RETRY_DELAY_MS;
  // Mốc sớm nhất được thử hủy lại đơn treo (không chặn mua bù slot).
  let nextPendingCancelAt = 0;
  // Khi bot không trả menu /stop (đang bận xử lý đơn), giãn nhịp đọc lại thay
  // vì gửi /stop mỗi 15s.
  let stopReadBackoffMs = config.iconBuy.slotPollSeconds * 1_000;
  let stopReadFailures = 0;

  // Khi phiên kết thúc (kể cả lỗi), chỉ dừng các task do chính phiên này tạo.
  // Task có trong baseline đầu tiên không bao giờ bị đụng.
  const finish = async (result) => {
    if (pendingCancels.size) {
      log(
        `Kết thúc phiên còn ${pendingCancels.size} đơn vị trí xấu chưa hủy được (` +
          [...pendingCancels.values()]
            .map(
              (item) =>
                `${item.code}${item.orderId ? ` orderId ${item.orderId}` : ""}`
            )
            .join(", ") +
          "); cần kiểm tra TTCN thủ công."
      );
    }
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

  // Khi bot gửi "Vị trí mua" muộn cho một đơn cũ (không còn trong /stop), hàm
  // này hủy ngay qua TTCN bằng baseline đầu phiên. Dùng chung
  // monitorTriedPositions để mỗi mã:vị trí chỉ mở TTCN một lần.
  const handleStrayBadPositions = async (found) => {
    const targets = [];
    for (const item of found || []) {
      const position = Number(item?.position);
      if (!Number.isFinite(position)) continue;
      const key = `${item.code}:${position}`;
      if (monitorTriedPositions.has(key)) continue;
      monitorTriedPositions.add(key);
      targets.push({
        code: String(item.code),
        grade: config.iconBuy.grade,
        quantity: config.iconBuy.quantity,
        total: config.iconBuy.quantity,
        position,
        positionError: null
      });
    }
    if (!targets.length) return { canceled: 0, failed: [] };
    const late = await cancelLateBadPositions(
      page,
      rl,
      targets,
      sessionTtcnBaselineIds || knownOrderIds,
      monitorTriedPositions,
      ui
    );
    canceled += late.canceled;
    for (const item of late.failed || []) {
      pendingCancels.set(pendingCancelKey(item), item);
    }
    if (late.failed?.length && !nextPendingCancelAt) {
      nextPendingCancelAt = Date.now() + pendingCancelBackoffMs;
    }
    return late;
  };

  // Quét chủ động ở đầu vòng: bắt đơn vị trí xấu đến trong lúc agent đang đọc
  // /stop hoặc tra cứu, kể cả khi chưa vào cửa sổ theo dõi.
  const scanStrayBadPositions = async () => {
    if (!sessionPlayers.size) return 0;
    const targets = collectLateBadPositions(
      reader,
      [...sessionPlayers.values()],
      monitorTriedPositions
    );
    if (!targets.length) return 0;
    const late = await cancelLateBadPositions(
      page,
      rl,
      targets,
      sessionTtcnBaselineIds || knownOrderIds,
      monitorTriedPositions,
      ui
    );
    canceled += late.canceled;
    for (const item of late.failed || []) {
      pendingCancels.set(pendingCancelKey(item), item);
    }
    if (late.failed?.length && !nextPendingCancelAt) {
      nextPendingCancelAt = Date.now() + pendingCancelBackoffMs;
    }
    return late.canceled;
  };

  while (true) {
    if (stopSignal()) {
      log("Nhận lệnh dừng; dừng luồng ICON, giữ nguyên worker Auto Mua/Auto Nâng.");
      return finish({ action: "stop", batches, purchased, canceled });
    }

    // Hủy đơn vị trí xấu vừa được bot báo muộn trước khi đọc /stop, để số slot
    // đọc được đã tính cả slot vừa trống.
    await scanStrayBadPositions();

    // Còn đơn vị trí xấu chưa hủy được: thử lại theo nhịp giãn dần nhưng KHÔNG
    // chặn việc mua bù slot. Trước đây khối này nằm sau bước đọc /stop và luôn
    // `continue`, nên khi bot không trả /tn agent đứng im vô hạn.
    if (pendingCancels.size && Date.now() >= nextPendingCancelAt) {
      const pendingTargets = [...pendingCancels.values()];
      // Dùng baseline đầu phiên để đơn đặt trong phiên không bị loại trừ (baseline
      // từng lượt có thể đã chứa chính đơn xấu cần hủy).
      const pendingBaseline = sessionTtcnBaselineIds || knownOrderIds;
      let retryResult = null;
      if (!pendingBaseline && pendingTargets.some((item) => !item.orderId)) {
        log(
          "Chưa có baseline TTCN khi hủy lại đơn treo; sẽ chọn card cuối khớp " +
            "mã/grade, cần kiểm tra lại TTCN nếu có nhiều đơn cũ cùng cầu thủ."
        );
      }
      try {
        retryResult = await cancelIconOrdersWithRetry(
          page,
          rl,
          pendingTargets,
          pendingBaseline,
          ui
        );
      } catch (error) {
        log(`Chưa hủy lại được đơn vị trí xấu: ${error.message}`);
      }
      if (retryResult) {
        for (const item of [...retryResult.canceled, ...retryResult.notFound]) {
          pendingCancels.delete(pendingCancelKey(item));
        }
        canceled += retryResult.canceled.length;
        if (retryResult.canceled.length) {
          log(
            `Đã hủy ${retryResult.canceled.length} đơn vị trí xấu còn treo; ` +
              "quay lại đọc /stop để mua bù slot."
          );
        }
      }
      if (!pendingCancels.size) {
        pendingCancelBackoffMs = CANCEL_RETRY_DELAY_MS;
        nextPendingCancelAt = 0;
      } else {
        log(
          `Vẫn chưa hủy được ${pendingTargets.map((item) => item.code).join(", ")}; ` +
            `vẫn tiếp tục mua bù slot và thử lại sau ${Math.ceil(
              pendingCancelBackoffMs / 1_000
            )}s.`
        );
        nextPendingCancelAt = Date.now() + pendingCancelBackoffMs;
        pendingCancelBackoffMs = Math.min(
          pendingCancelBackoffMs * 2,
          CANCEL_PENDING_MAX_BACKOFF_MS
        );
      }
    }

    // Đọc /stop mỗi vòng để biết slot MUA đang dùng. E003 / "không có lệnh nào
    // đang chạy" là baseline rỗng hợp lệ, không phải lỗi.
    const taskBaseline = await captureStopBaselineWithRetry(
      page,
      rl,
      stopSignal,
      ui
    );
    if (stopSignal()) {
      return finish({ action: "stop", batches, purchased, canceled });
    }
    if (!taskBaseline) {
      stopReadFailures += 1;
      if (stopReadFailures >= STOP_READ_MAX_FAILURES) {
        const error = new Error(
          `Không đọc được menu /stop sau ${stopReadFailures} lần liên tiếp ` +
            "(chat Telegram có thể bị đóng/kẹt); cần mở lại phiên Telegram."
        );
        error.code = "TELEGRAM_CHAT_UNREADABLE";
        throw error;
      }
      log(
        "Chưa đọc được baseline menu /stop sau nhiều lần thử; " +
          `giữ nguyên phiên ICON và chờ ${Math.ceil(stopReadBackoffMs / 1_000)}s ` +
          "rồi thử lại, không đặt thêm task."
      );
      await page.waitForTimeout(stopReadBackoffMs);
      stopReadBackoffMs = Math.min(stopReadBackoffMs * 2, 300_000);
      continue;
    }
    stopReadFailures = 0;
    stopReadBackoffMs = config.iconBuy.slotPollSeconds * 1_000;
    if (!sessionTaskBaseline) sessionTaskBaseline = taskBaseline;

    const runningTaskList = taskBaseline.tasks || taskBaseline;
    const usedTaskSlots = countRunningTaskSlots(runningTaskList, "MUA");
    const availableTaskSlots = getAvailableTaskSlots(
      runningTaskList,
      maxTaskSlots,
      "MUA"
    );
    log(
      `Đọc /stop: ${usedTaskSlots}/${maxTaskSlots} task MUA đang chạy; ` +
        `chỉ được mua thêm ${availableTaskSlots}.`
    );

    if (availableTaskSlots <= 0) {
      if (!continuous) {
        log(
          `Đã có ${usedTaskSlots}/${maxTaskSlots} task MUA đang chạy; ` +
            "không đặt thêm vì đã hết slot mua."
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
      if (config.iconBuy.captureTtcnBaseline && !knownOrderIds) {
        knownOrderIds = await withUi(ui, () => captureTtcnBaseline(page, rl));
        sessionTtcnBaselineIds = knownOrderIds;
      }
      if (config.iconBuy.monitorExistingOrders !== false) {
        const monitored = await monitorExistingOrders(
          page,
          reader,
          rl,
          runningTaskList,
          stopSignal,
          knownOrderIds,
          sessionTtcnBaselineIds,
          ui,
          {
            maxWaitMs:
              config.iconBuy.monitorWaitSeconds > 0
                ? config.iconBuy.monitorWaitSeconds * 1_000
                : Infinity,
            triedPositions: monitorTriedPositions,
            // Quét cả đơn của các lượt trước dù task đã kết thúc.
            sessionPlayers: [...sessionPlayers.values()],
            onBadPositions: handleStrayBadPositions
          }
        );
        canceled += monitored.canceled;
        if (monitored.stopped) {
          return finish({ action: "stop", batches, purchased, canceled });
        }
        if (monitored.failed) {
          // Không kết thúc phiên chỉ vì TTCN đang bận: ghi nhận đơn xấu vào
          // danh sách chờ hủy và thử lại ở nhịp sau, tránh bỏ rơi đơn vị trí
          // xấu (trước đây phiên kết thúc và baseline mới loại trừ luôn đơn).
          for (const item of monitored.failedTargets || []) {
            pendingCancels.set(pendingCancelKey(item), item);
          }
          if (pendingCancels.size) {
            log(
              `Chưa hủy được đơn vị trí xấu (TTCN bận); ghi nhận ` +
                `${pendingCancels.size} đơn để thử lại, vẫn tiếp tục mua bù slot.`
            );
            await page.waitForTimeout(CANCEL_RETRY_DELAY_MS);
            continue;
          }
          return finish({
            action: "error",
            batches,
            purchased,
            canceled,
            reason: "ttcn-cancel-failed"
          });
        }
      }
      await page.waitForTimeout(config.iconBuy.slotPollSeconds * 1_000);
      continue;
    }

    // Chỉ check TTCN khi thực sự sắp đặt thêm đơn; baseline này dùng để không
    // chọn nhầm đơn cũ khi cần hủy.
    if (config.iconBuy.captureTtcnBaseline) {
      knownOrderIds = await withUi(ui, () => captureTtcnBaseline(page, rl));
      if (!sessionTtcnBaselineIds) sessionTtcnBaselineIds = knownOrderIds;
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
    // Không mua lại mã đang có đơn vị trí xấu chờ hủy: tránh chồng thêm đơn
    // cho cùng cầu thủ trong lúc TTCN chưa hủy được.
    for (const item of pendingCancels.values()) {
      if (item?.code) activeCodes.add(String(item.code));
    }
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

    selected.forEach((player) => {
      const code = String(player.code);
      sessionPlayers.set(code, player);
      // Mua lại cùng mã sau khi đơn cũ bị hủy: xóa dấu vị trí cũ để vị trí xấu
      // của đơn mới (dù trùng số) vẫn được hủy.
      for (const key of monitorTriedPositions) {
        if (key.startsWith(`${code}:`)) monitorTriedPositions.delete(key);
      }
    });
    log(
      `Lượt ICON ${batches + 1}: mua ${selected
        .map((player) => `${player.code} ${player.name}`)
        .join(", ")} ` +
        `(slot ${usedTaskSlots}/${maxTaskSlots} -> ` +
        `${usedTaskSlots + selected.length}/${maxTaskSlots}).`
    );

    let result;
    try {
      // Quét đơn của các lượt trước trong lúc chờ lượt này: bot có thể báo vị
      // trí của đơn cũ muộn (101005099 vị trí 4 lúc 11:03 khi đang chờ
      // 101048940). Đơn của lượt hiện tại do waitForPurchaseResults xử lý.
      const currentCodes = new Set(selected.map((player) => String(player.code)));
      const strayScanPlayers = [...sessionPlayers.values()].filter(
        (player) => !currentCodes.has(String(player.code))
      );
      result = await placeWithRetry(
        page,
        rl,
        selected,
        stopSignal,
        ui,
        knownOrderIds,
        {
          scanPlayers: strayScanPlayers,
          onBadPositions: handleStrayBadPositions
        }
      );
    } catch (error) {
      // Lỗi sau khi đã gửi lệnh: giữ nguyên task; chỉ đơn có vị trí xác nhận
      // lớn hơn ngưỡng mới được xử lý riêng qua TTCN.
      if (error.purchaseSent) {
        await stopOrphanIconTasks(page, rl, taskBaseline, selected, ui);
      }
      throw error;
    }

    if (result.stop) {
      return finish({ action: "stop", batches, purchased, canceled });
    }
    if (result.rateLimited) {
      // Bot từ chối vì thao tác nhanh: KHÔNG gửi lại ngay (có thể tạo đơn
      // trùng). Đọc lại /stop để xem task có được tạo không rồi mới quyết định.
      batches += 1;
      log(
        "Bot giới hạn thao tác nhanh; giữ nguyên task và đọc lại /stop " +
          "trước khi thử lại, không gửi mua dồn."
      );
      await page.waitForTimeout(config.iconBuy.slotPollSeconds * 1_000);
      continue;
    }
    if (result.stopped) {
      // /stopagent đến trong lúc chờ log mua: dừng task mới rồi kết thúc.
      // Nếu đã có success thì vẫn xử lý vị trí ở luồng bên dưới trước khi dừng.
      if (!result.successes.length) {
        const stopped = await stopOrphanIconTasks(
          page,
          rl,
          taskBaseline,
          selected,
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

    // Watchdog mềm: chưa có log sau purchaseSoftTimeoutSeconds. Không coi là
    // lỗi và không hủy task; xử lý vị trí xấu đã biết rồi quay lại đọc /stop.
    if (result.timedOut) {
      if (result.successes.length) {
        try {
          const handled = await cancelBadPositions(
            page,
            rl,
            result.successes,
            knownOrderIds,
            canceled,
            ui,
            monitorTriedPositions
          );
          canceled = handled.canceled;
        } catch (error) {
          log(`Không hủy được đơn vị trí xấu sau watchdog: ${error.message}`);
        }
      }
      log(
        "Hết thời gian chờ log đặt mua ICON; giữ nguyên task và quay lại " +
          "kiểm tra /stop thay vì chờ tiếp."
      );
      await page.waitForTimeout(config.iconBuy.slotPollSeconds * 1_000);
      continue;
    }

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
        if (/E006|làm mới token/i.test(result.fatalError)) {
            log(
              "E006 là lỗi token tạm thời; giữ nguyên task ICON, không đặt lại " +
                "và tiếp tục vòng theo dõi để tránh mua trùng."
            );
            await page.waitForTimeout(config.iconBuy.slotPollSeconds * 1_000);
            continue;
        }
        if (reason !== "order-limit") {
          // E007 nghĩa là bot chưa tạo task mới; các lỗi khác vẫn có thể đã tạo.
          await stopOrphanIconTasks(page, rl, taskBaseline, selected, ui);
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
          "giữ nguyên task ICON và kết thúc; không hủy qua /stop."
      );
      const stopped = await stopOrphanIconTasks(
        page,
        rl,
        taskBaseline,
        selected,
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
      return finish({
        action: "error",
        batches,
        purchased,
        canceled,
        reason: "no-purchase-success"
      });
    }

    purchased += result.successes.length;
    if (typeof onPurchaseSuccess === "function") {
      await onPurchaseSuccess(result.successes);
    }
    let missingCleanupFailed = false;
    if (result.missing.length) {
      log(
        `Bot chưa xác nhận đặt mua ${result.missing
          .map((player) => player.code)
          .join(", ")}; các mã này vẫn được coi là đã dùng trong phiên để tránh mua trùng. ` +
          "Giữ nguyên task mới; không hủy qua /stop."
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
      missingCleanupFailed = Boolean(stopped?.failed?.length);
    }

    const cancelTargets = decideCancelTargets(
      result.successes,
      config.iconBuy.cancelPositionAbove
    );
    // Đánh dấu đã xử lý để vòng quét log chat không hủy lại cùng mã:vị trí.
    for (const item of cancelTargets) {
      monitorTriedPositions.add(`${item.code}:${item.position}`);
    }
    for (const success of result.successes) {
      const action = getPositionAction(success, config.iconBuy.cancelPositionAbove);
      if (action === "cancel") continue;
      if (action === "unknown") {
        log(
          `Không xác định được vị trí mua ${success.code}` +
            `${success.positionError ? ` (${success.positionError})` : ""}; ` +
          "giữ nguyên đơn, không hủy."
        );
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
        const cancelResult = await cancelIconOrdersWithRetry(
          page,
          rl,
          cancelTargets,
          knownOrderIds,
          ui
        );
        canceled += cancelResult.canceled.length;
        if (cancelResult.failed.length || cancelResult.notFound.length) {
          log(
            `Hủy TTCN: ${cancelResult.canceled.length} thành công, ` +
              `${cancelResult.failed.length} thất bại, ` +
              `${cancelResult.notFound.length} không tìm thấy đơn mới.`
          );
        }
        if (cancelResult.notFound.length) {
          log(
            `Không dừng phiên ICON vì ${cancelResult.notFound.length} đơn vị trí xấu ` +
              "không còn xuất hiện trong TTCN; tiếp tục theo dõi các task còn lại."
          );
        }
        if (cancelResult.failed.length) {
          // Đã có đơn đặt ở vị trí xấu mà không hủy được: ghi nhận để thử lại
          // (giữ orderId để không bị baseline TTCN loại trừ) và tạm dừng mua
          // thêm, tránh tích thêm đơn ngoài ý muốn.
          for (const item of cancelResult.failed) {
            pendingCancels.set(pendingCancelKey(item), item);
          }
          log(
            `Chưa hủy được ${cancelResult.failed.length} đơn vị trí xấu; ` +
              "giữ nguyên đơn, thử hủy lại ở nhịp sau và vẫn mua bù slot."
          );
          await stopOrphanIconTasks(page, rl, taskBaseline, selected, ui);
          await page.waitForTimeout(CANCEL_RETRY_DELAY_MS);
          nextPendingCancelAt = Date.now() + CANCEL_RETRY_DELAY_MS;
          pendingCancelBackoffMs = Math.min(
            CANCEL_RETRY_DELAY_MS * 2,
            CANCEL_PENDING_MAX_BACKOFF_MS
          );
          continue;
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
        // Không kết thúc phiên chỉ vì chưa mở được TTCN: đơn xấu vẫn cần hủy
        // nên ghi nhận vào danh sách chờ và thử lại ở nhịp sau.
        log(`Không hủy được đơn TTCN: ${error.message}`);
        for (const item of cancelTargets) {
          pendingCancels.set(pendingCancelKey(item), item);
        }
        await stopOrphanIconTasks(page, rl, taskBaseline, selected, ui);
        await page.waitForTimeout(CANCEL_RETRY_DELAY_MS);
        pendingCancelBackoffMs = Math.min(
          CANCEL_RETRY_DELAY_MS * 2,
          CANCEL_PENDING_MAX_BACKOFF_MS
        );
        continue;
      }
    }

    if (result.fatalError) {
      // Đã cố hủy các đơn vị trí xấu ở trên trước khi dừng.
      if (/E006|làm mới token/i.test(result.fatalError)) {
        log(
          "E006 là lỗi token tạm thời sau khi đã có đơn; giữ nguyên các task " +
            "và tiếp tục theo dõi, không đặt lại."
        );
        await page.waitForTimeout(config.iconBuy.slotPollSeconds * 1_000);
        continue;
      }
      const reason = /E007|giới hạn lệnh mua đang chạy/i.test(result.fatalError)
        ? "order-limit"
        : "bot-error";
      log(
        `${result.fatalError} Đã xử lý TTCN (${canceled} đơn hủy thành công); ` +
          "dừng phiên ICON để tránh đặt thêm đơn."
      );
      if (reason !== "order-limit") {
        await stopOrphanIconTasks(page, rl, taskBaseline, selected, ui);
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
