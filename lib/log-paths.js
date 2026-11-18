// Đường dẫn log dùng chung cho agent và Telegram chat.
// Tách khỏi features/ để lib/ không phải require ngược lên feature.
const os = require("node:os");
const path = require("node:path");

const dataDir = path.join(
  process.env.LOCALAPPDATA || os.homedir(),
  "FO4PurchaseAgent"
);

// Khi chạy `node --test`, ghi sang file riêng để log vận hành không bị lẫn
// các dòng mô phỏng của test.
const testSuffix = process.env.NODE_TEST_CONTEXT ? ".test" : "";

const logPath = path.join(dataDir, `agent${testSuffix}.log`);
const telegramChatLogPath = path.join(
  dataDir,
  `telegram-chat${testSuffix}.log`
);

module.exports = { dataDir, logPath, telegramChatLogPath };
