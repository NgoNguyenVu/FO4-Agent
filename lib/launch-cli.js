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
const {
  discoverFreeModels,
  formatModelMenu,
  parseModelArgument,
  selectModel
} = require("./ai-provider-discovery");

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

// Chọn model AI cho Mode [3]. --ai-model được ưu tiên; nếu có `--ai-model` nhưng
// không hợp lệ thì fail fast thay vì âm thầm dùng model khác.
async function resolveAiModel({
  argv = process.argv.slice(2),
  mode = null,
  ask = null,
  log = (message) => console.log(message),
  discover = discoverFreeModels,
  maxAttempts = MAX_MENU_ATTEMPTS
} = {}) {
  const baitMode = mode && (mode.features || []).includes("bait-upgrade");
  const requested = parseModelArgument(argv);
  const models = await discover({ onError: (message) => log(message) });
  if (requested !== null) {
    const picked = selectModel(models, requested);
    if (!picked) {
      const error = new Error(`AI model "${requested}" không hợp lệ hoặc không khả dụng.`);
      error.code = "INVALID_AI_MODEL";
      throw error;
    }
    return { model: picked, models };
  }
  if (!baitMode) return { model: models[0] || null, models };
  if (!models.length) return { model: null, models };

  log(formatModelMenu(models));
  const question = ask || ((prompt) => new Promise((resolve) => process.stdin.once("data", (d) => resolve(String(d).trim()))));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const answer = await question("Chọn model AI (Enter = đầu tiên): ");
    const picked = selectModel(models, answer);
    if (picked) return { model: picked, models };
    log("Model không hợp lệ. Chọn số hoặc id trong danh sách.");
  }
  return { model: models[0], models };
}

module.exports = { resolveLaunchMode, resolveAiModel, MAX_MENU_ATTEMPTS };
