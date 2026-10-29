// Public API của feature Auto Mua Phôi.
// Controller chỉ cần require module này; module nâng cấp không require vào đây.
// Helper dùng chung (chat/playwright/text/control) nằm ở lib/ và được import
// trực tiếp bởi nơi cần, không re-export qua feature để giữ ranh giới rõ ràng.
const patterns = require("./patterns");
const cycle = require("./cycle");
const miniApp = require("./mini-app");
const outcome = require("./outcome");
const menu = require("./menu");

module.exports = {
  ...patterns,
  ...cycle,
  ...miniApp,
  ...outcome,
  buyMenu: menu
};
