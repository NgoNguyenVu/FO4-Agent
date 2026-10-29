// Prompt chặn ở terminal (chờ đăng nhập / chờ khôi phục) và cách đánh thức nó
// từ xa bằng /resetagent mà không cần Enter tại PC.

let pendingPromptResolve = null;
let waitingForLoginPrompt = false;
let waitingForRecoveryPrompt = false;

function wakePendingPrompt() {
  if (pendingPromptResolve) {
    const resolve = pendingPromptResolve;
    pendingPromptResolve = null;
    resolve("");
  }
}

async function promptWakeable(rl, message) {
  return new Promise((resolve, reject) => {
    pendingPromptResolve = (value) => {
      pendingPromptResolve = null;
      resolve(value);
    };
    try {
      rl.question(message, (answer) => {
        pendingPromptResolve = null;
        resolve((answer || "").trim());
      });
    } catch (error) {
      pendingPromptResolve = null;
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
  setWaitingForLoginPrompt,
  setWaitingForRecoveryPrompt,
  isWaitingForPrompt
};
