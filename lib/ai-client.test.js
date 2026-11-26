const test = require("node:test");
const assert = require("node:assert/strict");
const {
  localStatisticalHeuristic,
  parseJsonResponse,
  parseCliJson,
  opencodeBin,
  hasCredential,
  endpointFor,
  createAiClient
} = require("./ai-client");

const schema = { type: "object" };
const models = [
  { id: "openrouter/a/flash:free", provider: "openrouter", credential: "sk-or-test-123456" },
  { id: "opencode/hy4-flash-free", provider: "opencode", baseUrl: "http://127.0.0.1:28894/v1" },
  { id: "gemini/gemini-2.5-flash", provider: "gemini", credential: "AIza-test-123456" }
];

test("JSON parser and credential detection", () => {
  assert.deepEqual(parseJsonResponse('ok {"decision":"BAIT"}'), { decision: "BAIT" });
  assert.throws(() => parseJsonResponse("nothing"), /AI_JSON_INVALID/);
  assert.equal(hasCredential(models[0], {}), true);
  assert.equal(hasCredential(models[1], {}), false);
  assert.equal(hasCredential(models[1], { FO4_AI_API_KEY: "x" }), true);
  assert.match(endpointFor(models[0], {}).url, /openrouter/);
  assert.match(endpointFor(models[2], {}).url, /generativelanguage/);
  assert.match(
    endpointFor({ ...models[1], baseUrl: null }, { FO4_AI_BASE_URL: "http://local/v1" }).url,
    /^http:\/\/local\/v1\/chat\/completions$/
  );
});

test("askJson rotates on 429 then succeeds", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(url);
    if (url.includes("openrouter")) return { ok: false, status: 429 };
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: '{"decision":"BAIT","randomPrediction":100,"confidence":0.7,"reason":"x","phoiToAdd":{"bait":1,"main":0},"useSoiCau":false}'
          }
        }]
      })
    };
  };
  const client = createAiClient({ models, fetchImpl, env: { FO4_AI_API_KEY: "x" } });
  const result = await client.askJson({ ui: { history: [] } }, schema);
  assert.equal(result.decision, "BAIT");
  assert.equal(result._model, "opencode/hy4-flash-free");
  assert.equal(calls.length, 2);
});

test("askJson falls back to local heuristic without any credential", async () => {
  const client = createAiClient({
    models: [{ id: "opencode/hy4-flash-free", provider: "opencode" }],
    env: {},
    fetchImpl: async () => { throw new Error("should not call"); }
  });
  assert.equal(client.usingFallback, true);
  const result = await client.askJson({ ui: { history: [], threshold: 500 } }, schema);
  assert.equal(result._model, "local-heuristic");
  assert.ok(["BAIT", "MAIN"].includes(result.decision));
  assert.match(result.riskFlags[0], /no-ai-credential/);
});

test("persistent 429 across all models returns HOLD, never heuristic MAIN", async () => {
  const client = createAiClient({
    models,
    env: {},
    maxRetries: 0,
    log: () => {},
    fetchImpl: async () => ({ ok: false, status: 429 })
  });
  const result = await client.askJson({ ui: { threshold: 500, history: [] } }, schema);
  assert.equal(result.decision, "HOLD");
  assert.equal(result.reason, "ai-rate-limited");
  assert.deepEqual(result.phoiToAdd, { bait: 0, main: 0 });
  assert.equal(result._model, "rate-limit-guard");
});

test("opencode binary honors explicit override", () => {
  assert.equal(
    opencodeBin({ FO4_OPENCODE_BIN: "C:/custom/opencode.exe" }),
    "C:/custom/opencode.exe"
  );
});

test("opencode binary resolves shim to real exe on Windows", { skip: process.platform !== "win32" }, () => {
  const resolved = opencodeBin({});
  assert.match(resolved, /opencode\.exe$/i);
  assert.ok(require("node:fs").existsSync(resolved), "resolved CLI executable must exist");
});

test("CLI transport needs no key and parses opencode run JSONL", () => {
  const cliModel = { id: "opencode/hy4-flash-free", provider: "opencode", transport: "cli" };
  assert.equal(hasCredential(cliModel, {}), true);
  const jsonl = [
    JSON.stringify({ type: "step_start", part: { type: "step-start" } }),
    JSON.stringify({ type: "text", part: { type: "text", text: '{"decision":"BAIT"}' } }),
    JSON.stringify({ type: "step_finish", part: { type: "step-finish" } })
  ].join("\n");
  assert.deepEqual(parseCliJson(jsonl), { decision: "BAIT" });
  assert.deepEqual(parseCliJson('{"decision":"MAIN"}'), { decision: "MAIN" });
});

test("askJson uses CLI runner for opencode/* models", async () => {
  const seen = [];
  const cliModel = { id: "opencode/iceman-free", provider: "opencode", transport: "cli" };
  const client = createAiClient({
    models: [cliModel],
    env: {},
    fetchImpl: async () => { throw new Error("HTTP must not be used"); },
    opencodeCliRunner: async (model, prompt, options) => {
      seen.push({ id: model.id, prompt, options });
      return { decision: "BAIT", _fromCli: true };
    }
  });
  assert.equal(client.usingFallback, false);
  const result = await client.askJson({ ui: { history: [] } }, schema);
  assert.equal(result.decision, "BAIT");
  assert.equal(result._model, cliModel.id);
  assert.equal(seen.length, 1);
  assert.match(seen[0].prompt, /SCHEMA/);
});

test("CLI rate-limit failure falls back to HOLD, never heuristic MAIN", async () => {
  const client = createAiClient({
    models: [{ id: "opencode/iceman-free", provider: "opencode", transport: "cli" }],
    env: {},
    maxRetries: 0,
    fetchImpl: async () => { throw new Error("HTTP must not be used"); },
    opencodeCliRunner: async () => {
      const error = new Error("Free usage limit reached");
      error.status = 429;
      throw error;
    }
  });
  const result = await client.askJson({ ui: { threshold: 500, history: [] } }, schema);
  assert.equal(result.decision, "HOLD");
  assert.equal(result.reason, "ai-rate-limited");
});

test("local heuristic uses recent random history", () => {
  const result = localStatisticalHeuristic({
    ui: { threshold: 500, history: [{ random: 100 }, { random: 200 }, { random: 150 }] }
  });
  assert.equal(result.decision, "MAIN");
  assert.equal(result.randomPrediction, 150);
});
