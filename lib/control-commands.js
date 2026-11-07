// Danh sách lệnh điều khiển dùng chung cho chat tracker, controller và test.
// Tách khỏi features/ để lib/ không phải require ngược lên feature.
const CONTROL_START_COMMANDS = ["startagent"];

const CONTROL_COMMAND_NAMES = [
  ...CONTROL_START_COMMANDS,
  "stopagent",
  "resetagent"
];

const CONTROL_MODE_BY_COMMAND = {
  startagent: "master"
};

module.exports = {
  CONTROL_START_COMMANDS,
  CONTROL_COMMAND_NAMES,
  CONTROL_MODE_BY_COMMAND
};
