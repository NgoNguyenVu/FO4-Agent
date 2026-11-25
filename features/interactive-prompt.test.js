// Test hành vi prompt chặn terminal (TASK-052, scan v5).
//
// features/interactive-prompt.js cho phép /resetagent đánh thức prompt đang chờ
// đăng nhập/khôi phục mà không cần Enter tại PC. Trước đây module không có test;
// các nhánh wake/no-op/reject rất dễ hồi quy nên khoá lại ở đây.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  promptWakeable,
  wakePendingPrompt,
  wakeAllPendingPrompts,
  pendingPromptCount,
  setWaitingForLoginPrompt,
  setWaitingForRecoveryPrompt,
  isWaitingForPrompt
} = require("./interactive-prompt");

test("promptWakeable trả câu trả lời đã trim", async () => {
  const rl = {
    question(message, callback) {
      assert.equal(message, "Nhập: ");
      callback("  hello  ");
    }
  };

  assert.equal(await promptWakeable(rl, "Nhập: "), "hello");
});

test("promptWakeable coi callback rỗng là chuỗi rỗng", async () => {
  const rl = { question: (message, callback) => callback(undefined) };
  assert.equal(await promptWakeable(rl, "?"), "");
});

test("wakePendingPrompt đánh thức prompt đang chờ bằng chuỗi rỗng", async () => {
  let answer = null;
  const rl = { question: (message, callback) => { answer = callback; } };
  const pending = promptWakeable(rl, "?");

  wakePendingPrompt();
  assert.equal(await pending, "");

  // Callback đến muộn sau khi đã wake không được làm treo/đổi kết quả.
  answer("late");
});

test("promptWakeable dùng hàng đợi: composer và controller không ghi đè nhau", async () => {
  const callbacks = [];
  const rl = { question: (message, callback) => { callbacks.push(callback); } };
  assert.equal(pendingPromptCount(), 0);

  const first = promptWakeable(rl, "đăng nhập?");
  const second = promptWakeable(rl, "khôi phục?");
  assert.equal(pendingPromptCount(), 2);

  wakePendingPrompt();
  assert.equal(await first, "");
  assert.equal(pendingPromptCount(), 1);

  callbacks[1]("   xong   ");
  assert.equal(await second, "xong");
  assert.equal(pendingPromptCount(), 0);
});

test("wakeAllPendingPrompts giải phóng cả prompt đăng nhập lẫn recovery", async () => {
  const rl = { question: () => {} };
  const login = promptWakeable(rl, "login?");
  const recovery = promptWakeable(rl, "recovery?");
  assert.equal(pendingPromptCount(), 2);
  assert.equal(wakeAllPendingPrompts(), 2);
  assert.equal(await login, "");
  assert.equal(await recovery, "");
  assert.equal(pendingPromptCount(), 0);
});

test("wakePendingPrompt không lỗi khi không có prompt nào chờ", () => {
  assert.doesNotThrow(() => wakePendingPrompt());
});

test("promptWakeable reject khi rl.question ném lỗi đồng bộ", async () => {
  const rl = {
    question() {
      throw new Error("terminal đã đóng");
    }
  };

  await assert.rejects(() => promptWakeable(rl, "?"), /terminal đã đóng/);
  // Sau lỗi, wake không được resolve nhầm promise cũ.
  assert.doesNotThrow(() => wakePendingPrompt());
});

test("isWaitingForPrompt theo dõi cờ login/recovery độc lập", () => {
  setWaitingForLoginPrompt(false);
  setWaitingForRecoveryPrompt(false);
  assert.equal(isWaitingForPrompt(), false);

  setWaitingForLoginPrompt(true);
  assert.equal(isWaitingForPrompt(), true);

  setWaitingForLoginPrompt(false);
  setWaitingForRecoveryPrompt(true);
  assert.equal(isWaitingForPrompt(), true);

  setWaitingForRecoveryPrompt(false);
  assert.equal(isWaitingForPrompt(), false);

  // Giá trị truthy/falsy được chuẩn hoá về boolean.
  setWaitingForLoginPrompt("yes");
  assert.equal(isWaitingForPrompt(), true);
  setWaitingForLoginPrompt(0);
  assert.equal(isWaitingForPrompt(), false);
});
