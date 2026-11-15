// Integration test vòng buy + worker lifecycle với mock Playwright/Telegram
// (TASK-045). Mục tiêu: khoá hành vi thật của state machine (worker registry,
// chat observer, parser bot) thay vì assert source code.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createMockPage } = require("./__fixtures__/mock-playwright");
const { createMockTelegram } = require("./__fixtures__/mock-telegram");
const { createWorkerRegistry } = require("./worker-registry");
const { createWorkerSession } = require("./worker-session");
const {
  waitForStartAcknowledgement,
  checkAutoBuyRunning
} = require("../features/buy");
const { waitForPurchaseResults } = require("../features/icon-buy/order");
const { selectMonitoredIconTasks } = require("../features/icon-buy/patterns");
const { captureStopBaselineWithRetry } = require("../features/icon-buy/runner");

function tempState(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fo4-buy-int-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return {
    dir,
    statePath: path.join(dir, "workers.json"),
    lockPath: path.join(dir, "agent.lock")
  };
}

function startBaseline(text) {
  return { text, started: 0, marker: null, systemErrors: 0 };
}

function newHarness(t, { initialText = "Lịch sử chat cũ" } = {}) {
  const { page, state } = createMockPage();
  const telegram = createMockTelegram({ page, initialText });
  return { page, state, telegram };
}

test("buy: bot ACK sau khi bấm Bắt đầu thì waitForStartAcknowledgement trả về", async (t) => {
  const { page, telegram } = newHarness(t);
  const baseline = startBaseline(telegram.text());
  telegram.append("Bắt đầu treo auto mua (worker buy-1)");

  const result = await waitForStartAcknowledgement(page, baseline, null, {
    timeoutMs: 500
  });
  assert.equal(result, undefined);
});

test("buy: thiếu ACK nhưng /stop xác nhận worker đang chạy thì adopt, không bấm lại", async (t) => {
  const { page, telegram } = newHarness(t);
  const baseline = startBaseline(telegram.text());
  telegram.replyTo(
    "/stop",
    "Đang treo mua cho chatId 1917864682. Chat /stopauto để dừng."
  );

  const result = await waitForStartAcknowledgement(page, baseline, null, {
    timeoutMs: 50
  });
  assert.equal(result.adopted, true);
  assert.match(result.baselineText, /Đang treo mua cho chatId/);
});

test("buy: thiếu ACK và /stop xác nhận không có worker thì báo START_ACK_TIMEOUT", async (t) => {
  const { page, telegram } = newHarness(t);
  const baseline = startBaseline(telegram.text());
  telegram.replyTo("/stop", "E003: Hiện không có lệnh nào đang chạy.");

  await assert.rejects(
    () => waitForStartAcknowledgement(page, baseline, null, { timeoutMs: 50 }),
    (error) => {
      assert.equal(error.code, "START_ACK_TIMEOUT");
      return true;
    }
  );
});

test("buy: không đọc được /stop (E006) thì báo START_ACK_UNVERIFIED, không bấm mù", async (t) => {
  const { page, telegram } = newHarness(t);
  const baseline = startBaseline(telegram.text());
  telegram.replyTo(
    "/stop",
    "E006: Lỗi hệ thống, vui lòng thử lại sau hoặc liên hệ hỗ trợ"
  );

  await assert.rejects(
    () => waitForStartAcknowledgement(page, baseline, null, { timeoutMs: 50 }),
    (error) => {
      assert.equal(error.code, "START_ACK_UNVERIFIED");
      return true;
    }
  );
});

test("buy: checkAutoBuyRunning phân biệt đang chạy và rảnh từ reply /stop", async (t) => {
  const running = newHarness(t);
  running.telegram.replyTo("/stop", "Đang treo mua cho chatId 123. Chat /stopauto.");
  assert.equal((await checkAutoBuyRunning(running.page, null)).running, true);

  const idle = newHarness(t);
  idle.telegram.replyTo("/stop", "E003: Hiện không có lệnh nào đang chạy.");
  assert.equal((await checkAutoBuyRunning(idle.page, null)).running, false);
});

test("worker lifecycle: begin -> running -> stopped mở lại được slot", (t) => {
  const paths = tempState(t);
  const registry = createWorkerRegistry({ ...paths, pid: 4242, log: () => {}, logError: () => {} });
  const session = createWorkerSession({ registry });

  const begun = session.tryBegin("buy");
  assert.equal(begun.state, "starting");
  assert.equal(session.markRunning("buy").state, "running");
  session.stop("buy", { reason: "completed" });

  const worker = registry.getSnapshot().workers[0];
  assert.equal(worker.state, "stopped");
  // `reason` của session.stop chỉ để ghi log; registry chỉ giữ state + nhả
  // lease. Assert đúng hợp đồng đó thay vì bịa thêm field.
  assert.ok(worker.leaseUntil <= Date.now(), "stopped phải nhả lease");
  // Slot mở lại: lần bắt đầu kế tiếp không bị chặn.
  assert.equal(session.tryBegin("buy").reused, false);
});

test("worker lifecycle: START_ACK_UNVERIFIED -> unknown chặn lần chạy sau (fail-closed)", (t) => {
  const paths = tempState(t);
  const registry = createWorkerRegistry({ ...paths, pid: 4242, log: () => {}, logError: () => {} });
  const session = createWorkerSession({ registry });

  session.tryBegin("buy");
  session.markRunning("buy");
  const record = session.markUnknown("buy", "START_ACK_UNVERIFIED");
  assert.equal(record.state, "unknown");

  assert.equal(session.tryBegin("buy"), null);
  assert.equal(session.blockedReason().reason, "WORKER_ACTIVE");
  assert.equal(registry.getSnapshot().workers[0].state, "unknown");
});

test("worker lifecycle: restart có bằng chứng chat thì adopt worker đang chạy", (t) => {
  const paths = tempState(t);
  const first = createWorkerRegistry({ ...paths, pid: 4242, log: () => {}, logError: () => {} });
  const firstSession = createWorkerSession({ registry: first });
  const workerId = firstSession.tryBegin("buy").workerId;
  firstSession.markRunning("buy");

  // Process mới (pid khác) khôi phục phiên: chat còn bằng chứng worker chạy.
  const restarted = createWorkerRegistry({ ...paths, pid: 4343, log: () => {}, logError: () => {} });
  const restartedSession = createWorkerSession({ registry: restarted });
  const outcome = restartedSession.reconcileOnStartup({ hasWorkerEvidence: true });

  assert.equal(outcome.action, "adopt");
  assert.deepEqual(restartedSession.activeWorkerIds(), [workerId]);
});

test("worker lifecycle: restart không có bằng chứng chat thì unknown và chặn", (t) => {
  const paths = tempState(t);
  const first = createWorkerRegistry({ ...paths, pid: 4242, log: () => {}, logError: () => {} });
  const firstSession = createWorkerSession({ registry: first });
  firstSession.tryBegin("buy");
  firstSession.markRunning("buy");

  const restarted = createWorkerRegistry({ ...paths, pid: 4343, log: () => {}, logError: () => {} });
  const restartedSession = createWorkerSession({ registry: restarted });
  const outcome = restartedSession.reconcileOnStartup({ hasWorkerEvidence: false });

  assert.equal(outcome.action, "block");
  assert.equal(outcome.reason, "registry-active-without-evidence");
  assert.equal(restarted.getSnapshot().workers[0].state, "unknown");
  assert.equal(restartedSession.tryBegin("buy"), null);
});

test("ICON: monitorExistingOrders chỉ chọn task MUA đúng grade/quantity, bỏ task thủ công", () => {
  const tasks = [
    { code: "111", kind: "MUA", grade: 2, quantity: 1, taskId: "a" },
    { code: "222", kind: "MUA", grade: 1, quantity: 1, taskId: "b" },
    { code: "333", kind: "BÁN", grade: 1, quantity: 1, taskId: "c" },
    { code: "444", kind: "MUA", grade: 1, quantity: 3, taskId: "d" }
  ];
  const selected = selectMonitoredIconTasks(tasks, { grade: 1, quantity: 1 });
  assert.deepEqual(
    selected.map((task) => task.code),
    ["222"]
  );
});

test("ICON: captureStopBaselineWithRetry đọc được /stop rỗng (E003) ngay lần đầu", async (t) => {
  const { page, telegram } = newHarness(t);
  page.__setMessages([{ id: "1", text: "Lịch sử cũ" }]);
  telegram.replyTo("/stop", () => {
    page.__setMessages([
      { id: "1", text: "Lịch sử cũ" },
      { id: "2", text: "E003: Hiện không có lệnh nào đang chạy." }
    ]);
    return "E003: Hiện không có lệnh nào đang chạy.";
  });

  const baseline = await captureStopBaselineWithRetry(
    page,
    null,
    () => false,
    null
  );
  assert.equal(baseline.empty, true);
  assert.deepEqual(baseline.tasks, []);
});

test("ICON: captureStopBaselineWithRetry retry rồi mới bỏ cuộc, chỉ reload một lần", async (t) => {
  const { page } = newHarness(t);
  // Không có bubble nào => không đọc được baseline, không gửi /stop.
  page.__setMessages([]);

  const baseline = await captureStopBaselineWithRetry(page, null, () => false, null);
  assert.equal(baseline, null);
  assert.equal(page.__state.reloadCount, 1);
});

test("ICON: purchaseTimeoutSeconds = 0 không treo vòng chờ, soft watchdog trả quyền", async (t) => {
  const { page, telegram } = newHarness(t);
  const startedAt = Date.now();

  const result = await waitForPurchaseResults(
    page,
    telegram.tracker,
    telegram.text(),
    [{ code: "123" }],
    null,
    { maxWaitMs: 50 }
  );

  assert.equal(result.timedOut, true);
  assert.deepEqual(result.successes, []);
  assert.ok(
    Date.now() - startedAt < 10_000,
    "soft watchdog phải trả về nhanh thay vì chờ vô hạn"
  );
});
