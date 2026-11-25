// Phần tương tác của Launcher: ưu tiên --mode, nếu không có thì hỏi số trên CMD.
// Tách riêng để unit test được bằng `ask` injected mà không cần mở agent.
"use strict";

const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const {
  formatLaunchMenu,
  getLaunchMode,
  getLaunchModes,
  parseModeArgument,
  parseModeSelection
} = require("./launch-modes");

const MAX_MENU_ATTEMPTS = 3;

async function resolveLaunchMode({
  argv = process.argv.slice(2),
  input = stdin,
  output = stdout,
  log = (message) => console.log(message),
  maxAttempts = MAX_MENU_ATTEMPTS,
  // Test có thể inject câu trả lời; runtime dùng readline/promises thật.
  ask = null
} = {}) {
  const arg = parseModeArgument(argv);
  if (arg !== null) {
    const mode = getLaunchMode(arg);
    if (!mode) {
      const error = new Error(
        `Chế độ --mode "${arg}" không hợp lệ. Chọn: ${getLaunchModes()
          .map((item) => item.key)
          .join(", ")}.`
      );
      error.code = "INVALID_LAUNCH_MODE";
      throw error;
    }
    return mode;
  }

  const rl = ask ? null : readline.createInterface({ input, output });
  const askQuestion = ask || ((prompt) => rl.question(prompt));
  try {
    log(formatLaunchMenu());
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const answer = await askQuestion("Chọn [1/2] (Enter = mặc định): ");
      const mode = parseModeSelection(answer);
      if (mode) return mode;
      log("Lựa chọn không hợp lệ. Nhập 1, 2 hoặc tên mode (ví dụ icon-only).");
    }
    const error = new Error(`Không chọn được chế độ sau ${maxAttempts} lần thử.`);
    error.code = "LAUNCH_MODE_NOT_SELECTED";
    throw error;
  } finally {
    if (rl) rl.close();
  }
}

module.exports = { resolveLaunchMode, MAX_MENU_ATTEMPTS };
