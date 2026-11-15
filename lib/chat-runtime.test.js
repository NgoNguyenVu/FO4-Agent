// Test hành vi verifyTailOrphan (TASK-052, scan v5).
//
// Trước đây chỉ có test parser nhận diện terminal "mồ côi"; nhánh đưa chat về
// đuôi rồi đọc lại (lib/chat-runtime.verifyTailOrphan) chưa được kiểm tra. Nếu
// hàm này fail-open sai cách, agent có thể nhận completion cũ khi user cuộn lên
// lịch sử và mở chu kỳ mới chồng worker (tốn BP thật).
const test = require("node:test");
const assert = require("node:assert/strict");

const { createMockPage } = require("./__fixtures__/mock-playwright");
const { createMockTelegram } = require("./__fixtures__/mock-telegram");
const { verifyTailOrphan } = require("./chat-runtime");

function harness(initialText) {
  const { page, state } = createMockPage();
  const telegram = createMockTelegram({ page, initialText });
  return { page, state, telegram };
}

test("verifyTailOrphan bấm End, đọc lại đuôi chat và trả snapshot mới", async () => {
  const { page, telegram } = harness("Lịch sử cũ");
  const pressed = [];
  page.keyboard.press = async (key) => {
    pressed.push(key);
  };
  page.__setBodyText("Lịch sử cũ\nHết thời gian treo. Hoàn thành mua 7 cầu thủ.");

  const snapshot = await verifyTailOrphan(page, telegram.tracker);

  assert.deepEqual(pressed, ["End"]);
  assert.equal(
    snapshot.text,
    "Lịch sử cũ\nHết thời gian treo. Hoàn thành mua 7 cầu thủ."
  );
  assert.equal(snapshot.version, 1);
});

test("verifyTailOrphan fail-open: giữ snapshot cũ khi không bấm được End", async () => {
  const { page, telegram } = harness("Lịch sử cũ");
  page.keyboard.press = async () => {
    throw new Error("Target page, context or browser has been closed");
  };
  page.__setBodyText("Nội dung mới không được đọc");

  const snapshot = await verifyTailOrphan(page, telegram.tracker);

  assert.equal(snapshot.text, "Lịch sử cũ");
  assert.equal(snapshot.version, 0);
});

test("verifyTailOrphan fail-open: giữ snapshot cũ khi đọc body lỗi", async () => {
  const { page, telegram } = harness("Lịch sử cũ");
  page.locator = () => ({
    innerText: async () => {
      throw new Error("Target page, context or browser has been closed");
    }
  });

  const snapshot = await verifyTailOrphan(page, telegram.tracker);

  assert.equal(snapshot.text, "Lịch sử cũ");
  assert.equal(snapshot.version, 0);
});
