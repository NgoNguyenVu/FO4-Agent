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
        "dừng chờ bot và về trạng thái chờ lệnh."
    );
    return { action: "targets-exhausted", outcome, target };
  }
  if (outcome.status === "system-error") {
    log("Bot nâng cấp trả E006; dừng và chờ lệnh mới.");
    return { action: "idle" };
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
    return { action: "no-materials", outcome, target };
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
      // Chờ bot là thao tác chỉ đọc: nhả khóa UI để phiên ICON nền có thể chạy.
      if (ui) ui.release();
      let outcome;
      try {
        outcome = await waitForUpgradeCompletion(page, adopted.baseline, null, null, ui);
      } finally {
        if (ui) await ui.acquire();
      }
      const settled = await settleUpgradeOutcome(outcome, null, spec, page, rl);
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
        log("Không còn phôi phù hợp để nâng cấp; dừng Auto Nâng và chờ lệnh mới.");
        return { action: "no-materials" };
      }
      // Lỗi khác (spec sai, renderer treo, browser đóng...): đóng mini-app best-effort
      // để lần khôi phục sau không bị iframe cũ che mất UI Telegram.
      await closeMiniApp(page).catch(() => {});
      throw error;
    }
    const settled = await settleUpgradeOutcome(result.outcome, result.target, spec, page, rl);
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
function shouldResumeBuyAfterUpgrade(outcome, startGrade) {
  const o = outcome || {};
  if (o.reachedTarget) return true;
  if ((o.success ?? 0) > 0) return true;
  if (o.finalGrade != null && startGrade != null && o.finalGrade > startGrade) return true;
  return false;
}

// Quyết định của phase nâng trong chế độ tổng:
// - "continue": thử target khác trong cùng phase.
// - "buy": quay lại Auto Mua (hết phôi hoặc hết target khả thi).
// - "idle": dừng, chờ can thiệp.
function decideMasterUpgradePhase(action) {
  if (action === "continue" || action === "blocked-target") return "continue";
  if (action === "no-materials" || action === "no-targets") return "buy";
  return "idle";
}

// Kho đầy ở vòng master: chạy phase nâng liên tục.
// - Còn target: nâng tiếp (target thiếu phôi "possible" -> blacklist, thử con khác).
// - Hết phôi: quay lại mua.
// - Hết target khả thi (kể cả đã blacklist): quay lại mua để lấy thêm phôi;
//   blacklist chỉ có hiệu lực trong 1 phase nên phase sau thử lại từ đầu.
// - Không tiến triển/không đổi kho: dừng để tránh vòng lặp vô ích.
async function pivotMasterToUpgrade(page, rl, runUpgrade = runSingleUpgrade, logFn = log, ui = null) {
  logFn("Kho/TTCN đầy; vòng tổng chuyển sang phase nâng liên tục cho tới khi hết phôi.");
  let upgradedTargets = 0;
  const blockedTargetIds = new Set();
  while (true) {
    const up = await runUpgrade(page, rl, blockedTargetIds, ui);
    if (up.action === "continue") {
      if (up.mode && up.mode !== "master") {
        logFn(`Đã nhận lệnh chuyển sang chế độ ${up.mode} trong lúc dừng nâng cấp.`);
        return { agentActive: true, mode: up.mode };
      }
      const startGrade = up.target ? up.target.grade : null;
      if (shouldResumeBuyAfterUpgrade(up.outcome, startGrade)) {
        upgradedTargets += 1;
        logFn(`Đã xử lý ${upgradedTargets} target trong phase nâng; tiếp tục target kế tiếp.`);
        continue;
      }
      logFn("Nâng cấp xong mà kho không thay đổi gì (vẫn đầy, không tiến triển); dừng vòng lặp chờ can thiệp.");
      return { agentActive: false };
    }

    const decision = decideMasterUpgradePhase(up.action);
    if (decision === "continue") continue;
    if (decision === "buy") {
      if (up.action === "no-materials") {
        logFn(
          `Phase nâng đã dùng hết phôi hợp lệ sau ${upgradedTargets} target; ` +
            "kho đã có chỗ trống, quay lại Auto Mua."
        );
      } else if (blockedTargetIds.size > 0) {
        logFn(
          `Không còn target khả thi trong phase nâng (${blockedTargetIds.size} target bị blacklist); ` +
            "quay lại Auto Mua để mua thêm phôi."
        );
      } else {
        logFn("Hết icon dưới target trong phase nâng; quay lại Auto Mua để mua phôi tiếp.");
      }
      return { agentActive: true };
    }
    return { agentActive: false };
  }
}

module.exports = {
  settleUpgradeOutcome,
  runSingleUpgrade,
  shouldResumeBuyAfterUpgrade,
  decideMasterUpgradePhase,
  pivotMasterToUpgrade
};
