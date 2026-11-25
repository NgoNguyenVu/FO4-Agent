// Ghi log dùng chung cho toàn agent (console + file nhật ký, có xoay vòng).
const {
  dataDir,
  logPath
} = require("../lib/log-paths");
const { appendRotating } = require("../lib/rotating-log");
const { redactSensitive } = require("../lib/redact");

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    appendRotating(logPath, `${redactSensitive(line)}\n`);
  } catch (error) {
    console.error(`Không ghi được nhật ký ${logPath}: ${error.message}`);
  }
}

// Ghi lỗi ra stderr + file nhật ký (dùng chung cho main và runAutoBuy).
function logError(message) {
  console.error(message);
  try {
    appendRotating(
      logPath,
      `${redactSensitive(`[${new Date().toISOString()}] ${message}`)}\n`
    );
  } catch (logError_) {
    console.error(`Không ghi được nhật ký ${logPath}: ${logError_.message}`);
  }
}

module.exports = { dataDir, logPath, log, logError };
