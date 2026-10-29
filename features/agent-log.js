// Ghi log dùng chung cho toàn agent (console + file nhật ký).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDir = path.join(
  process.env.LOCALAPPDATA || os.homedir(),
  "FO4PurchaseAgent"
);
const logPath = path.join(dataDir, "agent.log");

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
