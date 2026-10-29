// Danh sách lệnh điều khiển dùng chung cho chat tracker, controller và test.
// Tách khỏi features/ để lib/ không phải require ngược lên feature.
const CONTROL_START_COMMANDS = ["startagent", "startmua", "startnang", "starticon"];

const CONTROL_COMMAND_NAMES = [
  ...CONTROL_START_COMMANDS,
  "stopagent",
  "resetagent"
];

// Lệnh start tương ứng chế độ nào, để khi nhận start trong lúc đang dừng worker
// thì khởi động lại đúng chế độ người dùng yêu cầu (thay vì luôn "master").
const CONTROL_MODE_BY_COMMAND = {
  startagent: "master",
  startmua: "buy",
  startnang: "nang",
  starticon: "icon"
};

module.exports = {
  CONTROL_START_COMMANDS,
  CONTROL_COMMAND_NAMES,
  CONTROL_MODE_BY_COMMAND
};
