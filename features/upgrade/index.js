// Public API của feature Auto Nâng Cấp.
const patterns = require("./patterns");
const miniApp = require("./mini-app");
const runner = require("./runner");
const loop = require("./loop");
const {
  getUpgradeSpec,
  validateUpgradeConfig
} = require("../config");

module.exports = {
  ...patterns,
  ...miniApp,
  ...runner,
  ...loop,
  getUpgradeSpec,
  validateUpgradeConfig
};
