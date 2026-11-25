// Prompt chặn ở terminal (chờ đăng nhập / chờ khôi phục) và cách đánh thức nó
// từ xa bằng /resetagent mà không cần Enter tại PC.
//
// Hàng đợi resolver: composer có thể đang chờ đăng nhập trong lúc controller
// cũng rơi vào recovery prompt. Biến đơn từng bị ghi đè làm treo promise trước.

const pendingPrompts = [];
let waitingForLoginPrompt = false;
let waitingForRecoveryPrompt = false;

function removePending(entry) {
  const index = pendingPrompts.indexOf(entry);
  if (index >= 0) pendingPrompts.splice(index, 1);
}

// Đánh thức prompt cũ nhất còn chờ (thường là prompt đăng nhập).
function wakePendingPrompt() {
  const entry = pendingPrompts.shift();
  if (!entry) return false;
  entry.resolve("");
  return true;
}

// /resetagent phải giải phóng MỌI prompt đang chờ (đăng nhập + recovery),
// không chỉ prompt cũ nhất nếu không controller có thể kẹt ở recovery prompt.
function wakeAllPendingPrompts() {
  const pending = pendingPrompts.splice(0);
  for (const entry of pending) entry.resolve("");
  return pending.length;
}

function pendingPromptCount() {
  return pendingPrompts.length;
}

async function promptWakeable(rl, message) {
  return new Promise((resolve, reject) => {
    const entry = { resolve, reject };
    pendingPrompts.push(entry);
    try {
      rl.question(message, (answer) => {
        removePending(entry);
        resolve((answer || "").trim());
      });
    } catch (error) {
      removePending(entry);
      reject(error);
    }
  });
}

function setWaitingForLoginPrompt(value) {
  waitingForLoginPrompt = Boolean(value);
}

function setWaitingForRecoveryPrompt(value) {
  waitingForRecoveryPrompt = Boolean(value);
}

function isWaitingForPrompt() {
  return waitingForLoginPrompt || waitingForRecoveryPrompt;
}

module.exports = {
  promptWakeable,
  wakePendingPrompt,
  wakeAllPendingPrompts,
  pendingPromptCount,
  setWaitingForLoginPrompt,
  setWaitingForRecoveryPrompt,
  isWaitingForPrompt
};
