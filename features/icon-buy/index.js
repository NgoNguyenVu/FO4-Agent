// Public API của luồng mua ICON yêu thích.
// Controller chỉ cần require module này; Auto Mua/Auto Nâng không require ngược.
const patterns = require("./patterns");
const runner = require("./runner");

module.exports = {
  ...patterns,
  ...runner
};
