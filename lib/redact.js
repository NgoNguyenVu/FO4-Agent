// Dọn dữ liệu nhận dạng trước khi ghi log: chatId của tài khoản và đường dẫn
// home chứa tên user Windows. Dùng chung cho agent.log và telegram-chat.log.
const os = require("node:os");

function redactSensitive(text) {
  let out = String(text ?? "");
  try {
    const home = os.homedir();
    if (home) out = out.split(home).join("%USERPROFILE%");
  } catch { /* homedir không lấy được thì bỏ qua */ }
  return out.replace(/(chatId\s*[:=]?\s*)\d+/gi, "$1***");
}

module.exports = { redactSensitive };
