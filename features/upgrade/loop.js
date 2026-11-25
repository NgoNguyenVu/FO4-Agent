// Vòng nâng cấp trong chế độ tổng (/startagent) và các quyết định sau 1 lượt nâng.
const { log } = require("../agent-log");
const { closeMiniApp } = require("../telegram-io");
const { chatTextReaders } = require("../../lib/chat-runtime");
const { CONTROL_MODE_BY_COMMAND } = require("../../lib/control-commands");
const { getUpgradeSpec } = require("../config");
const {
  getExistingUpgradeRun
} = require("./patterns");
const {
  runUpgradeOnce,
  waitForUpgradeCompletion,
  stopUpgradeWorker
} = require("./runner");

// Chống vòng "mua phôi -> nâng fail -> mua tiếp" đốt BP: sau N lần về mua mà
// lượt nâng vẫn không tiêu thụ phôi/đổi kho, tạm dừng mua và backoff thay vì
// mở chu kỳ mới mãi. Bộ đếm nằm ở controller và truyền vào đây để tồn tại qua
// nhiều phase nâng (mỗi phase được gọi lại sau một chu kỳ mua).
const MAX_CONSECUTIVE_UPGRADE_FAILURES = 3;
const UPGRADE_FAILURE_BASE_BACKOFF_MS = 60_000;
const UPGRADE_FAILURE_MAX_BACKOFF_MS = 15 * 60_000;

function upgradeFailureBackoffMs(failures) {
  const n = Math.max(0, Number(failures) || 0);
  if (!n) return 0;
  return Math.min(
    UPGRADE_FAILURE_BASE_BACKOFF_MS * 2 ** (n - 1),
    UPGRADE_FAILURE_MAX_BACKOFF_MS
  );
}

// Xử lý kết quả 1 lượt nâng cấp cho vòng lặp (master/nang).
// Trả về action: "continue" (chạy tiếp), "idle" (về chờ lệnh),
// "no-materials" (hết phôi), "no-targets" (hết icon), "blocked-target",
// "no-progress", "targets-exhausted" (mini-app hết icon trong lúc chờ bot).
// Kèm `mode` khi người dùng đã gửi lệnh start khác trong lúc dừng.
// target null = luồng adopt (không rõ target).
async function settleUpgradeOutcome(outcome, target, spec, page, rl) {
  if (outcome.status === "targets-exhausted") {
    log(
      `Mini-app không còn icon target dưới +${spec.targetGrade}; ` +
        "quay lại kiểm tra kho ICON trước khi quyết định mua phôi hay chờ ICON mới."
    );
    return { action: "targets-exhausted", outcome, target, retryInventoryCheck: true };
  }
  if (outcome.status === "upgrade-timeout") {
    log(
      `Chu kỳ nâng vượt ${outcome.waitedMinutes ?? "?"} phút; ` +
        "không dừng agent, đóng mini-app rồi quay lại kiểm tra kho ICON."
    );
    return {
      action: "upgrade-timeout",
      outcome,
      target,
      retryInventoryCheck: true,
      inventoryCheckDelayMs: UPGRADE_FAILURE_BASE_BACKOFF_MS
    };
  }
  if (outcome.status === "system-error") {
    // E006: không đưa cả agent về idle. Controller sẽ hoãn riêng upgrade
    // 10 phút rồi tự chạy lại phase nâng.
    log("Bot nâng cấp trả E006; tạm hoãn riêng luồng nâng cấp.");
    return { action: "system-error", outcome, target };
  }
  if (outcome.status === "stop-requested") {
    // Target check có thể đã mở lại mini-app và để nó trên màn hình. Đóng trước
    // khi gửi /stopnc, nếu không composer bị iframe che và lệnh dừng không đi.
    await closeMiniApp(page).catch(() => {});
    const restart = await stopUpgradeWorker(page, rl);
    log(
      restart
        ? `Đã nhận /${restart} trong lúc dừng nâng cấp; tiếp tục.`
        : "Đã dừng nâng cấp theo /stopagent; chờ lệnh mới."
    );
    return {
      action: restart ? "continue" : "idle",
      mode: restart ? CONTROL_MODE_BY_COMMAND[restart] : null
    };
  }
  if (outcome.materialsRemaining === 0) {
    log(
      `Đã hết phôi sau lượt nâng${target ? ` ${target.name}` : ""}; ` +
        "dừng phase nâng, không mở target tiếp theo."
    );
    // Lượt nâng đã chạy thật (bot trả materialsRemaining = 0) nên chắc chắn có
    // phôi bị tiêu thụ; mua tiếp là an toàn vì kho đã có chỗ trống.
    return { action: "no-materials", outcome, target, consumed: true };
  }
  if (
    (outcome.outOfMaterial ||
      (outcome.bestPossible != null &&
        outcome.possibleRequired != null &&
        outcome.bestPossible < outcome.possibleRequired)) &&
    !outcome.reachedTarget &&
    (outcome.success ?? 0) === 0
  ) {
    log(
      `Target ${target?.name || "không rõ"} không đủ phôi hợp lệ để đạt target; ` +
        (outcome.bestPossible != null
          ? `possible ${outcome.bestPossible}% < ${outcome.possibleRequired}%; `
          : "") +
        "đưa vào danh sách đen tạm thời của phase nâng."
    );
    return { action: "blocked-target", outcome, target };
  }
  const advanced =
    target?.grade != null &&
    outcome.finalGrade != null &&
    outcome.finalGrade > target.grade;
  const progressed =
    outcome.reachedTarget ||
    (outcome.success ?? 0) > 0 ||
    advanced;
  if (!progressed) {
    log(
      `${target ? `Target ${target.name}` : "Lượt nâng"} không có tiến triển ` +
        (target
          ? `(grade cuối +${outcome.finalGrade ?? "?"}, bắt đầu +${target.grade}); `
          : `(grade cuối +${outcome.finalGrade ?? "?"}); `) +
        "đưa vào danh sách đen tạm thời để không lặp lại."
    );
    return target
      ? { action: "blocked-target", outcome, target }
      : { action: "no-progress", outcome };
  }
  const who = target
    ? `${target.name} (+${target.grade} -> +${spec.targetGrade})`
    : "luồng nâng cấp có sẵn";
  log(
    `Nâng cấp xong ${who}: ` +
      `thành công ${outcome.success ?? "?"}/${outcome.total ?? "?"} ` +
      `(grade cuối ${outcome.finalGrade ?? "?"}), lý do: ${outcome.reason || "?"}.`
  );
  return { action: "continue", outcome, target };
}

async function runSingleUpgrade(page, rl, blockedTargetIds = new Set(), ui = null) {
  if (ui) await ui.acquire();
  try {
    const spec = getUpgradeSpec();
    const adopted = getExistingUpgradeRun(chatTextReaders.get(page).snapshot().text);
    if (adopted) {
      log("Đã có worker Nâng cấp đang chạy; chờ luồng này thay vì mở mới.");
      // Chờ bot là thao tác chỉ đọc: nhả khóa UI trong lúc chờ.
      if (ui) ui.release();
      let outcome;
      try {
        outcome = await waitForUpgradeCompletion(page, adopted.baseline, null, null, ui);
      } finally {
        if (ui) await ui.acquire();
      }
      const settled = await settleUpgradeOutcome(outcome, null, spec, page, rl);
      if (outcome?.materialsRemaining === 0) {
        settled.consumedCount = 1;
        log("Worker nâng có sẵn báo còn 0 phôi; coi như đã tiêu thụ phôi.");
      }
      await closeMiniApp(page).catch(() => {});
      return settled;
    }
    let result;
    try {
      result = await runUpgradeOnce({
        page,
        rl,
        spec,
        targetId: null,
        excludedTargetIds: blockedTargetIds,
        ui
      });
    } catch (error) {
      if (error.code === "NO_UPGRADE_TARGETS" || /Không còn cầu thủ/.test(error.message || "")) {
        await closeMiniApp(page).catch(() => {});
        return { action: "no-targets" };
      }
      if (error.code === "NO_UPGRADE_MATERIALS") {
        await closeMiniApp(page).catch(() => {});
        log("Không còn phôi phù hợp để nâng cấp; quay lại kiểm tra kho/Auto Mua.");
        // Chưa bấm bắt đầu -> chưa tiêu thụ phôi nào trong lượt này. availableCount
        // phân biệt "kho thật sự hết phôi" (về mua) với "lọc sai dải OVR" (về mua
        // nhưng tính là thất bại để chống vòng lặp đốt BP).
        return {
          action: "no-materials",
          consumed: false,
          availableCount:
            error.availableCount === null || error.availableCount === undefined
              ? null
              : Number(error.availableCount),
          availableOvrs: Array.isArray(error.availableOvrs) ? error.availableOvrs : []
        };
      }
      // Lỗi UI/render khác với hết phôi thật: không được gọi NO_UPGRADE_MATERIALS,
      // nếu không controller sẽ mua thêm phôi vô hạn dù bot chưa bao giờ start.
      if (
        error.code === "UPGRADE_START_BUTTON_MISSING" ||
        error.code === "UPGRADE_UI_MISMATCH"
      ) {
        await closeMiniApp(page).catch(() => {});
        log(
          `Không bấm được start nâng cấp (${error.code}): ${error.message}. ` +
            "Đây là lỗi UI/cấu hình, KHÔNG phải hết phôi."
        );
        return {
          action: error.code === "UPGRADE_UI_MISMATCH" ? "upgrade-ui-mismatch" : "upgrade-start-failed",
          consumed: false,
          reason: error.code,
          message: error.message
        };
      }
      // Lỗi khác (spec sai, renderer treo, browser đóng...): đóng mini-app best-effort
      // để lần khôi phục sau không bị iframe cũ che mất UI Telegram.
      await closeMiniApp(page).catch(() => {});
      throw error;
    }
    const settled = await settleUpgradeOutcome(result.outcome, result.target, spec, page, rl);
    // Số phôi đã lọc ở đầu lượt vs số bot báo còn lại: đây là số phôi thực sự
    // đã tiêu thụ trong lượt này, dùng để quyết định có quay lại mua hay không.
    settled.materialsBefore = result.phoiCount ?? null;
    if (result.phoiCount != null && result.outcome?.materialsRemaining != null) {
      settled.consumedCount = Math.max(
        0,
        Number(result.phoiCount) - Number(result.outcome.materialsRemaining)
      );
      log(
        `Đã tiêu thụ ${settled.consumedCount} phôi trong lượt này ` +
          `(bắt đầu ${result.phoiCount}, bot báo còn ${result.outcome.materialsRemaining}).`
      );
    } else if (result.outcome?.materialsRemaining === 0) {
      settled.consumedCount = 1;
      log("Bot báo còn 0 phôi sau lượt nâng; coi như lượt này đã tiêu thụ phôi.");
    }
    if (settled.action === "blocked-target" && settled.target?.id) {
      blockedTargetIds.add(settled.target.id);
    }
    // Đóng mini-app sau MỌI lượt nâng (kể cả thành công) để lần mở target kế
    // tiếp không bấm nhầm menu cũ hoặc bị iframe cũ che mất giao diện chat.
    await closeMiniApp(page).catch(() => {});
    return settled;
  } finally {
    if (ui) ui.release();
  }
}

// Có nên mua tiếp sau 1 lượt nâng xong? ĐÚNG khi kho đã thay đổi (đạt target,
// thành công, hoặc grade dịch chuyển = đã đốt phôi). SAI (idle) chỉ khi không
// có bằng chứng gì thay đổi — lúc đó kho vẫn đầy như cũ, mua tiếp cũng kẹt.
// `consumedCount` (số phôi lọc được ban đầu trừ số bot báo còn lại) là bằng
// chứng tiêu thụ mạnh nhất: dù target không lên grade, phôi vẫn đã mất.
function shouldResumeBuyAfterUpgrade(outcome, startGrade, consumedCount = 0) {
  const o = outcome || {};
  if (Number(consumedCount) > 0) return true;
  if (o.reachedTarget) return true;
  if ((o.success ?? 0) > 0) return true;
  if (o.finalGrade != null && startGrade != null && o.finalGrade > startGrade) return true;
  return false;
}

// Quyết định của phase nâng trong chế độ tổng:
// - "continue": thử target khác trong cùng phase.
// - "buy": quay lại Auto Mua (hết phôi hoặc hết target khả thi).
// - "e006": hoãn riêng upgrade 10 phút, giữ agent active để feature khác chạy.
// - "idle": dừng, chờ can thiệp.
function decideMasterUpgradePhase(action) {
  if (action === "continue" || action === "blocked-target") return "continue";
  if (
    action === "no-materials" ||
    action === "no-targets" ||
    action === "targets-exhausted" ||
    action === "upgrade-timeout" ||
    action === "upgrade-start-failed" ||
    action === "upgrade-ui-mismatch" ||
    action === "no-progress"
  ) {
    // Kho vẫn còn ICON nâng được thì chỉ quay lại kiểm tra kho/chu kỳ tiếp theo.
    // "idle" giữ riêng cho stop-requested thật sự do người dùng gửi.
    return "buy";
  }
  if (action === "system-error") return "e006";
  return "idle";
}

// Kho có ICON nhưng không còn con nào nâng được (tất cả đã đạt target, hoặc
// đang khóa) thì mua phôi là vô ích và dễ rơi vào vòng "kho đầy nhưng không
// nhận được cầu thủ" rồi agent tự dừng. Chỉ mở chu kỳ mua phôi khi có ít nhất
// một ICON dưới target đang nâng được; còn lại chờ ICON mới.
function decideInventoryAction(inventory) {
  if ((inventory?.eligible ?? 0) > 0) return "buy";
  return "wait-new-icon";
}

function formatAvailableOvrCounts(ovrs) {
  if (!Array.isArray(ovrs) || !ovrs.length) return "không đọc được OVR trên thẻ";
  const counts = new Map();
  for (const ovr of ovrs) counts.set(ovr, (counts.get(ovr) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ovr, count]) => `${ovr}:${count}`)
    .join(", ");
}

// Kho đầy ở vòng master: chạy phase nâng liên tục cho tới khi sạch phôi.
// - Còn target: nâng tiếp (target thiếu phôi "possible" -> blacklist, thử con khác).
// - Hết phôi sau một lượt nâng thật (đã tiêu thụ phôi): quay lại mua.
// - Bộ lọc không chọn được phôi / lỗi UI: dù kho còn phôi không khớp dải config
//   vẫn quay lại mua (KHÔNG dừng khi còn ICON), nhưng tính là thất bại liên tiếp.
// - Hết target khả thi (kể cả đã blacklist): quay lại mua để lấy thêm phôi;
//   blacklist chỉ có hiệu lực trong 1 phase nên phase sau thử lại từ đầu.
// - Không tiến triển/không đổi kho: quay lại kiểm tra kho, KHÔNG đưa agent về idle.
// - Sau MAX_CONSECUTIVE_UPGRADE_FAILURES lần về mua mà vẫn không tiêu thụ phôi:
//   tạm dừng mua thêm (pauseBuy) với backoff tăng dần, agent vẫn sống.
async function pivotMasterToUpgrade(
  page,
  rl,
  runUpgrade = runSingleUpgrade,
  logFn = log,
  ui = null,
  failureState = { consecutive: 0 }
) {
  logFn("Kho/TTCN đầy; vòng tổng chuyển sang phase nâng liên tục cho tới khi hết phôi.");
  let upgradedTargets = 0;
  let consumedPhoi = 0;
  const blockedTargetIds = new Set();
  if (!failureState || typeof failureState !== "object") {
    failureState = { consecutive: 0 };
  }
  const resetFailures = () => {
    failureState.consecutive = 0;
  };
  const noteFailure = (action, detail = "") => {
    failureState.consecutive = (Number(failureState.consecutive) || 0) + 1;
    const backoffMs = upgradeFailureBackoffMs(failureState.consecutive);
    logFn(
      `Lượt nâng thất bại liên tiếp thứ ${failureState.consecutive} (${action})` +
        `${detail ? `: ${detail}` : ""}.`
    );
    if (failureState.consecutive >= MAX_CONSECUTIVE_UPGRADE_FAILURES) {
      logFn(
        `Đã ${failureState.consecutive} lần quay lại mua phôi nhưng nâng vẫn không ` +
          `tiêu thụ phôi/đổi kho; tạm dừng mua thêm ${Math.round(backoffMs / 1_000)}s ` +
          "để tránh đốt BP. Agent vẫn sống và sẽ kiểm tra lại kho ICON."
      );
      return {
        agentActive: true,
        pauseBuy: true,
        reason: "consecutive-upgrade-failures",
        failureCount: failureState.consecutive,
        backoffMs
      };
    }
    return null;
  };

  while (true) {
    const up = await runUpgrade(page, rl, blockedTargetIds, ui);
    const consumedCount = Number(up.consumedCount);
    if (Number.isFinite(consumedCount) && consumedCount > 0) {
      consumedPhoi += consumedCount;
    }
    const madeProgress =
      consumedCount > 0 ||
      up.consumed === true ||
      Boolean(up.outcome?.reachedTarget) ||
      (up.outcome?.success ?? 0) > 0;
    if (madeProgress) resetFailures();

    if (up.action === "continue") {
      if (up.mode && up.mode !== "master") {
        logFn(`Đã nhận lệnh chuyển sang chế độ ${up.mode} trong lúc dừng nâng cấp.`);
        return { agentActive: true, mode: up.mode };
      }
      const startGrade = up.target ? up.target.grade : null;
      if (shouldResumeBuyAfterUpgrade(up.outcome, startGrade, up.consumedCount)) {
        upgradedTargets += 1;
        logFn(
          `Đã xử lý ${upgradedTargets} target trong phase nâng ` +
            `(tiêu thụ lũy kế ${consumedPhoi} phôi); tiếp tục target kế tiếp để ` +
            "tiêu hết phôi đã lọc."
        );
        continue;
      }
      const pause = noteFailure(
        "no-progress",
        "nâng xong nhưng kho không đổi (không tiêu thụ phôi)"
      );
      if (pause) return pause;
      logFn(
        "Nâng cấp xong mà kho không thay đổi gì; KHÔNG dừng agent, " +
          "quay lại kiểm tra kho ICON cho chu kỳ tiếp theo."
      );
      return { agentActive: true, retryInventoryCheck: true };
    }

    const decision = decideMasterUpgradePhase(up.action);
    if (decision === "continue") continue;
    if (decision === "e006") {
      logFn(
        "Phase nâng gặp E006; hoãn riêng upgrade 10 phút rồi tự chạy lại, " +
          "không dừng toàn bộ agent."
      );
      return { agentActive: true, e006: true };
    }
    if (decision === "idle") {
      logFn("Đã dừng nâng theo yêu cầu điều khiển; agent chờ lệnh mới.");
      return { agentActive: false };
    }
    if (decision === "buy") {
      if (up.action === "no-materials" && up.consumed === false) {
        // Bộ lọc không chọn được phôi và lượt này chưa bấm bắt đầu. Dù kho còn
        // phôi không khớp dải config, KHÔNG dừng khi vẫn còn ICON: quay lại mua
        // phôi đúng upgrade.ovrPhoi rồi nâng tiếp. Controller sẽ tự kiểm tra
        // kho ICON và chỉ dừng khi không còn icon nào dưới target.
        const outOfPhôi =
          up.availableCount === 0 ||
          (up.availableCount == null && consumedPhoi > 0);
        if (outOfPhôi) {
          logFn(
            `Mini-app báo hết phôi${up.availableCount === 0 ? " (0 phôi hợp lệ trong kho)" : ""}; ` +
              `phase này đã tiêu thụ ${consumedPhoi} phôi. Quay lại Auto Mua ` +
              "để lấy phôi tiếp; sẽ dừng chỉ khi kho không còn ICON nâng được."
          );
        } else {
          logFn(
            "Auto Nâng không chọn được phôi theo dải đã setup trong khi kho vẫn " +
              `còn ${up.availableCount == null ? "?" : up.availableCount} phôi (chưa lọc); ` +
              "không dừng luồng, quay lại Auto Mua để lấy phôi đúng cấu hình. " +
              `OVR thật trên thẻ: ${formatAvailableOvrCounts(up.availableOvrs)}. ` +
              `Dải phôi đang dùng (upgrade.ovrPhoi): ${getUpgradeSpec().ovrPhoi}.`
          );
          const pause = noteFailure(
            "filter-no-match",
            `kho còn ${up.availableCount == null ? "?" : up.availableCount} phôi nhưng lọc ra 0`
          );
          if (pause) return pause;
        }
        return { agentActive: true };
      }
      if (up.action === "upgrade-start-failed" || up.action === "upgrade-ui-mismatch") {
        const pause = noteFailure(up.action, up.message);
        if (pause) return pause;
        logFn("Lỗi UI nâng chưa tới ngưỡng dừng mua; quay lại kiểm tra kho/chu kỳ tiếp theo.");
        return { agentActive: true, retryInventoryCheck: true };
      }
      if (up.action === "upgrade-timeout") {
        resetFailures();
        logFn(
          "Timeout nâng cấp: đóng mini-app an toàn, giữ agent sống, " +
            "chờ cooldown ngắn rồi kiểm tra lại kho ICON."
        );
        return {
          agentActive: true,
          retryInventoryCheck: true,
          inventoryCheckDelayMs: up.inventoryCheckDelayMs || UPGRADE_FAILURE_BASE_BACKOFF_MS
        };
      }
      if (up.action === "no-materials" && !madeProgress) {
        const pause = noteFailure("no-materials", "không có bằng chứng đã tiêu thụ phôi");
        if (pause) return pause;
      }
      if (up.action === "no-materials") {
        logFn(
          `Phase nâng đã dùng hết phôi hợp lệ sau ${upgradedTargets} target ` +
            `(đã tiêu thụ ${consumedPhoi} phôi); kho đã có chỗ trống, quay lại Auto Mua.`
        );
      } else if (up.action === "targets-exhausted" || up.action === "no-targets") {
        resetFailures();
        logFn(
          "Hết icon dưới target trong phase nâng; quay lại kiểm tra kho " +
            "trước khi quyết định mua phôi hay chờ ICON mới."
        );
      } else if (blockedTargetIds.size > 0) {
        logFn(
          `Không còn target khả thi trong phase nâng (${blockedTargetIds.size} target bị blacklist); ` +
            "quay lại Auto Mua để mua thêm phôi."
        );
      } else {
        logFn("Phase nâng kết thúc; quay lại kiểm tra kho ICON cho chu kỳ tiếp theo.");
      }
      return { agentActive: true, retryInventoryCheck: true };
    }
    return { agentActive: true, retryInventoryCheck: true };
  }
}

module.exports = {
  settleUpgradeOutcome,
  runSingleUpgrade,
  shouldResumeBuyAfterUpgrade,
  decideMasterUpgradePhase,
  decideInventoryAction,
  MAX_CONSECUTIVE_UPGRADE_FAILURES,
  UPGRADE_FAILURE_BASE_BACKOFF_MS,
  UPGRADE_FAILURE_MAX_BACKOFF_MS,
  upgradeFailureBackoffMs,
  pivotMasterToUpgrade
};
