// Backward-compatible entry point.
// Logic Auto Mua nằm trong features/buy/, controller nằm trong features/controller.js.
const buy = require("./buy");
const { runAgent, runAgentCli } = require("./controller");

module.exports = {
  ...buy,
  runAutoBuy: runAgent,
  runAutoBuyCli: runAgentCli
};

if (require.main === module) {
  runAgentCli();
}
