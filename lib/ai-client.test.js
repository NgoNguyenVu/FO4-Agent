const test = require("node:test");
const assert = require("node:assert/strict");
const {
  localStatisticalHeuristic,
  parseJsonResponse,
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

test("local heuristic uses recent random history", () => {
  const result = localStatisticalHeuristic({
    ui: { threshold: 500, history: [{ random: 100 }, { random: 200 }, { random: 150 }] }
  });
  assert.equal(result.decision, "MAIN");
  assert.equal(result.randomPrediction, 150);
});
