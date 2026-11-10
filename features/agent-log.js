// Ghi log dùng chung cho toàn agent (console + file nhật ký).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDir = path.join(
  process.env.LOCALAPPDATA || os.homedir(),
  "FO4PurchaseAgent"
);
// Khi chạy `node --test`, ghi sang file riêng để log vận hành không bị lẫn
// các dòng mô phỏng của test (trước đây test từng ghi "sau 0 phút" vào log live).
const logPath = path.join(
  dataDir,
  process.env.NODE_TEST_CONTEXT ? "agent.test.log" : "agent.log"
);

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.appendFileSync(logPath, `${line}\n`, "utf8");
}

// Ghi lỗi ra stderr + file nhật ký (dùng chung cho main và runAutoBuy).
function logError(message) {
  console.error(message);
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`, "utf8");
  } catch (logError_) {
    console.error(`Không ghi được nhật ký ${logPath}: ${logError_.message}`);
  }
}

module.exports = { dataDir, logPath, log, logError };
