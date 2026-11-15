// Integration test hành vi cho waitForCycleCompletion (TASK-052).
//
// Company Cycle scan v5 phát hiện nhánh chờ kết thúc chu kỳ của Auto Mua Phôi
// chưa có test hành vi: chỉ có test parser thuần. Bộ test này chạy hàm thật với
// mock Playwright/Telegram + chat tracker thật (TASK-045) để khoá các terminal
// quan trọng: completed, purchase-stopped, system-error, worker-token-stop,
// stop-requested, E006 được bỏ qua và timeout.
const test = require("node:test");
const assert = require("node:assert/strict");

const { createMockPage } = require("../../lib/__fixtures__/mock-playwright");
const { createMockTelegram } = require("../../lib/__fixtures__/mock-telegram");
const { waitForCycleCompletion } = require("./cycle");
const { getCycleBaseline } = require("./patterns");
const { config } = require("../config");

function harness(initialText) {
  const { page, state } = createMockPage();
  const telegram = createMockTelegram({ page, initialText });
  return { page, state, telegram };
}

async function withMaxCycleWaitMinutes(value, fn) {
  const original = config.maxCycleWaitMinutes;
  config.maxCycleWaitMinutes = value;
  try {
    return await fn();
  } finally {
    config.maxCycleWaitMinutes = original;
  }
}

test("waitForCycleCompletion nhận completion mới sau activity", async () => {
  const initial = "Bắt đầu treo auto mua (worker buy-1)";
  const { page, telegram } = harness(initial);
  const baseline = getCycleBaseline(initial);
  telegram.append("Hết thời gian treo. Hoàn thành mua 5 cầu thủ.");

  const result = await waitForCycleCompletion(page, baseline, initial);

  assert.equal(result.status, "completed");
  assert.equal(result.playersBought, 5);
  assert.equal(result.inventoryReceiptBaseline, baseline.inventoryReceived);
});

test("waitForCycleCompletion nhận terminal purchase-stopped", async () => {
  const initial = "Bắt đầu treo auto mua (worker buy-1)";
  const { page, telegram } = harness(initial);
  const baseline = getCycleBaseline(initial);
  telegram.append("Đã dừng treo auto mua cho chatId 123");

  const result = await waitForCycleCompletion(page, baseline, initial);

  assert.equal(result.status, "purchase-stopped");
});

test("waitForCycleCompletion nhận system-error E006 mới", async () => {
  const initial = "Bắt đầu treo auto mua (worker buy-1)";
  const { page, telegram } = harness(initial);
  const baseline = getCycleBaseline(initial);
  telegram.append(
    "E006: Lỗi hệ thống, vui lòng thử lại sau hoặc liên hệ hỗ trợ"
  );

  const result = await waitForCycleCompletion(page, baseline, initial);

  assert.equal(result.status, "system-error");
});

test("waitForCycleCompletion nhận worker-token-stop là system-error", async () => {
  const initial = "Bắt đầu treo auto mua (worker buy-1)";
  const { page, telegram } = harness(initial);
  const baseline = getCycleBaseline(initial);
  telegram.append("Worker dừng do không thể làm mới token sau 3 lần thử");

  const result = await waitForCycleCompletion(page, baseline, initial);

  assert.equal(result.status, "system-error");
  assert.equal(result.reason, "worker-token-stop");
});

test("waitForCycleCompletion trả stop-requested khi có /stopagent", async () => {
  const initial = "Bắt đầu treo auto mua (worker buy-1)";
  const { page, telegram } = harness(initial);
  const baseline = getCycleBaseline(initial);
  telegram.tracker.arm();
  telegram.append("/stopagent");

  const result = await waitForCycleCompletion(page, baseline, initial);

  assert.equal(result.status, "stop-requested");
});

test("E006 của ICON được bỏ qua nếu cùng cửa sổ có completion", async () => {
  const initial = "Bắt đầu treo auto mua (worker buy-1)";
  const { page, telegram } = harness(initial);
  const baseline = getCycleBaseline(initial);
  telegram.append(
    "E006: Lỗi hệ thống, vui lòng thử lại sau hoặc liên hệ hỗ trợ\n" +
      "Hết thời gian treo. Hoàn thành mua 13 cầu thủ."
  );

  const result = await waitForCycleCompletion(page, baseline, initial, {
    isIgnorableSystemError: () => true
  });

  assert.equal(result.status, "completed");
  assert.equal(result.playersBought, 13);
  assert.equal(result.inventoryReceiptSystemErrors, baseline.systemErrors);
});

test("waitForCycleCompletion dừng khi quá maxCycleWaitMinutes", async () => {
  const initial = "Bắt đầu treo auto mua (worker buy-1)";
  const { page } = harness(initial);
  const baseline = getCycleBaseline(initial);

  await assert.rejects(
    () =>
      withMaxCycleWaitMinutes(0.0001, () =>
        waitForCycleCompletion(page, baseline, initial)
      ),
    /Quá thời gian chờ/
  );
});
