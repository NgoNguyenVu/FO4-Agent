const test = require("node:test");
const assert = require("node:assert/strict");
const {
  LAUNCH_MODES,
  getLaunchModes,
  getDefaultLaunchMode,
  getLaunchMode,
  parseModeSelection,
  parseModeArgument,
  formatLaunchMenu
} = require("./launch-modes");

test("registry contains exactly two independent launch modes", () => {
  assert.equal(LAUNCH_MODES.length, 2);
  assert.deepEqual(
    LAUNCH_MODES.map((mode) => [mode.id, mode.key]),
    [
      [1, "icon-combo"],
      [2, "icon-only"]
    ]
  );
  assert.deepEqual(
    LAUNCH_MODES.map((mode) => mode.label),
    ["Săn ICON + Mua phôi & Nâng +7", "Chỉ săn đặt mua ICON"]
  );
  assert.deepEqual(LAUNCH_MODES[0].features, ["icon-buy", "buy-upgrade"]);
  assert.deepEqual(LAUNCH_MODES[1].features, ["icon-buy"]);
  assert.equal(LAUNCH_MODES[0].default, true);
  assert.equal(LAUNCH_MODES[1].default, false);
  assert.equal(Object.isFrozen(LAUNCH_MODES), true);
  assert.equal(getLaunchModes(), LAUNCH_MODES);
  // Không có mode "master" chạy tất cả mọi thứ.
  assert.equal(
    LAUNCH_MODES.some((mode) => mode.key === "master"),
    false
  );
});

test("mode lookup works by id or key, case-insensitive", () => {
  assert.equal(getDefaultLaunchMode().key, "icon-combo");
  assert.equal(getLaunchMode("1").key, "icon-combo");
  assert.equal(getLaunchMode("ICON-ONLY").key, "icon-only");
  assert.equal(getLaunchMode("2"), LAUNCH_MODES[1]);
  assert.equal(getLaunchMode("unknown"), null);
  assert.equal(getLaunchMode(""), null);
  assert.equal(parseModeSelection("").key, "icon-combo");
  assert.equal(parseModeSelection("icon-only").key, "icon-only");
  assert.equal(parseModeSelection("9"), null);
});

test("parseModeArgument supports --mode key and --mode=key", () => {
  assert.equal(parseModeArgument([]), null);
  assert.equal(parseModeArgument(["--mode", "icon-only"]), "icon-only");
  assert.equal(parseModeArgument(["--mode=icon-combo"]), "icon-combo");
  assert.equal(parseModeArgument(["--mode"]), "");
  assert.equal(parseModeArgument(["--mode", "--json"]), "");
});

test("formatLaunchMenu lists both-numbered options and the Enter hint", () => {
  const menu = formatLaunchMenu();
  assert.match(menu, /\[1\].*Săn ICON \+ Mua phôi & Nâng \+7/);
  assert.match(menu, /\[2\].*Chỉ săn đặt mua ICON/);
  assert.match(menu, /Enter/);
});
