// Public API của module bait-upgrade (Mode [3]).
"use strict";

const patterns = require("./patterns");
const miniApp = require("./mini-app");
const runner = require("./runner");

module.exports = { ...patterns, ...miniApp, ...runner };
