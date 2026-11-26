const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveAiModel } = require("./launch-cli");
const { LAUNCH_MODES } = require("./launch-modes");

const baitMode = LAUNCH_MODES.find((m) => m.key === "bait-upgrade");
const comboMode = LAUNCH_MODES[0];
const models = [{ id: "openrouter/a:free" }, { id: "opencode/hy4-flash-free" }];
const discover = async () => models;

test("bait mode shows AI menu and Enter picks the first model", async () => {
  const logs = [];
  const result = await resolveAiModel({
    argv: [],
    mode: baitMode,
    log: (line) => logs.push(line),
    discover,
    ask: async () => ""
  });
  assert.equal(result.model.id, models[0].id);
  assert.match(logs.join("\n"), /Chọn model AI miễn phí/);
});

test("--ai-model bypasses the AI menu", async () => {
  const logs = [];
  const result = await resolveAiModel({
    argv: ["--ai-model", "opencode/hy4-flash-free"],
    mode: baitMode,
    log: (line) => logs.push(line),
    discover,
    ask: async () => { throw new Error("should not ask"); }
  });
  assert.equal(result.model.id, "opencode/hy4-flash-free");
  assert.deepEqual(logs, []);
});

test("invalid --ai-model fails fast", async () => {
  await assert.rejects(
    () => resolveAiModel({ argv: ["--ai-model=nope"], mode: baitMode, discover }),
    (error) => error.code === "INVALID_AI_MODEL"
  );
});

test("non-bait mode does not prompt for AI", async () => {
  const result = await resolveAiModel({
    argv: [],
    mode: comboMode,
    discover,
    ask: async () => { throw new Error("should not ask"); }
  });
  assert.equal(result.model.id, models[0].id);
});
