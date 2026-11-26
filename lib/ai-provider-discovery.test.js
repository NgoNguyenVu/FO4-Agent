const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  authPaths,
  loadEnvFile,
  extractCredentials,
  isFreeModel,
  isTextModel,
  parseCliModels,
  isCliFreeTextModel,
  sortModels,
  PREFERRED_MODEL_ORDER,
  normalizeOpenRouter,
  normalizeOpenCodeInference,
  discoverLocalServer,
  discoverFreeModels,
  formatModelMenu,
  parseModelArgument,
  selectModel
} = require("./ai-provider-discovery");

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fo4-ai-discovery-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test(".env is loaded without overriding existing environment", (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(
    path.join(dir, ".env"),
    "# comment\nGEMINI_API_KEY=file-key-123\nKEEP=existing\nQUOTED=\"abc\"\n",
    "utf8"
  );
  const env = loadEnvFile({ cwd: dir, env: { KEEP: "process", PATH: "x" } });
  assert.equal(env.GEMINI_API_KEY, "file-key-123");
  assert.equal(env.KEEP, "process");
  assert.equal(env.QUOTED, "abc");
  assert.equal(env.PATH, "x");
});

test("auth paths include OpenCode config/local-appdata locations", () => {
  // Dùng path.join để test chạy được cả trên Windows lẫn Ubuntu CI.
  const homeDir = path.join(path.sep, "home", "tester");
  const localAppData = path.join(homeDir, "AppData", "Local");
  const paths = authPaths({ env: { LOCALAPPDATA: localAppData }, homeDir });
  assert.ok(paths.includes(path.join(homeDir, ".config", "opencode", "auth.json")));
  assert.ok(paths.includes(path.join(homeDir, ".local", "share", "opencode", "auth.json")));
  assert.ok(paths.includes(path.join(localAppData, "opencode", "auth.json")));
});

test("extractCredentials reads keys without exposing them in logs", () => {
  const found = extractCredentials({
    openrouter: { key: "sk-or-1234567890" },
    google: { apiKey: "AIza1234567890" }
  });
  assert.deepEqual(
    found.map((c) => c.provider).sort(),
    ["google", "openrouter"]
  );
  assert.ok(found.every((c) => c.value.length >= 12));
});

test("OpenRouter free filter and menu helpers", () => {
  assert.equal(isFreeModel({ id: "x/y:free", pricing: { prompt: "1" } }), true);
  assert.equal(isFreeModel({ id: "x/y", pricing: { prompt: "0", completion: "0" } }), true);
  assert.equal(isFreeModel({ id: "x/y", pricing: { prompt: "0.01" } }), false);
  const rows = normalizeOpenRouter({
    data: [
      { id: "a/paid", pricing: { prompt: "1" } },
      { id: "a/flash:free", pricing: {} }
    ]
  });
  assert.deepEqual(rows.map((r) => r.id), ["openrouter/a/flash:free"]);
  const models = [{ id: "openrouter/a" }, { id: "opencode/hy4-flash-free" }];
  assert.equal(parseModelArgument(["--ai-model", "opencode/hy4-flash-free"]), "opencode/hy4-flash-free");
  assert.equal(selectModel(models, "2").id, "opencode/hy4-flash-free");
  assert.match(formatModelMenu(models), /\[1\] openrouter\/a/);
});

test("OpenCode free model filter keeps zero-cost models and marks CLI transport", () => {
  const rows = normalizeOpenCodeInference({
    data: [
      { id: "hy4-flash-free", name: "Hy4", cost: { text: { input: { price: 0 }, output: { price: 0 } } } },
      { id: "paid-model", cost: { text: { input: { price: 1 }, output: { price: 2 } } } }
    ]
  });
  assert.deepEqual(rows.map((r) => r.id), ["opencode/hy4-flash-free"]);
  assert.equal(rows[0].transport, "cli");
  assert.equal(rows[0].credential, "public");
});

test("non-text models are removed from every catalog", () => {
  for (const id of [
    "google/lyria", "xai/grok-imagine", "openai/gpt-live", "openai/whisper",
    "x/tts-1", "x/text-embedding-3", "x/image", "x/video", "x/audio"
  ]) {
    assert.equal(isTextModel(id), false, id);
  }
  assert.equal(isTextModel("opencode/hy4-flash-free"), true);
  const rows = normalizeOpenRouter({
    data: [
      { id: "a/lyria:free", pricing: {} },
      { id: "a/tts:free", pricing: {} },
      { id: "a/flash:free", pricing: {} }
    ]
  });
  assert.deepEqual(rows.map((r) => r.id), ["openrouter/a/flash:free"]);
  const zero = { text: { input: { price: 0 }, output: { price: 0 } } };
  const opencode = normalizeOpenCodeInference({
    data: [{ id: "whisper-free", cost: zero }, { id: "hy4-flash-free", cost: zero }]
  });
  assert.deepEqual(opencode.map((r) => r.id), ["opencode/hy4-flash-free"]);
});

test("opencode models output is parsed and filtered to free text models", () => {
  const ids = parseCliModels([
    "opencode/hy4-flash-free",
    "openrouter/inclusionai/ling-3.2-flash:free",
    "  openrouter/openai/gpt-audio  ",
    "not-an-id"
  ].join("\r\n"));
  assert.deepEqual(ids, [
    "opencode/hy4-flash-free",
    "openrouter/inclusionai/ling-3.2-flash:free",
    "openrouter/openai/gpt-audio"
  ]);
  assert.deepEqual(ids.filter(isCliFreeTextModel), [
    "opencode/hy4-flash-free",
    "openrouter/inclusionai/ling-3.2-flash:free"
  ]);
});

test("CLI availability marks models cli-ready and drops unavailable opencode models", async (t) => {
  const dir = tempDir(t);
  const cliOutput = [
    "opencode/hy4-flash-free",
    "opencode/deepseek-v4.1-flash-free",
    "openrouter/inclusionai/ling-3.2-flash:free",
    "openrouter/baidu/ernie-5.5-flash-preview:free",
    "openrouter/nvidia/nemotron-3.5-lightning:free",
    "openrouter/openai/gpt-audio"
  ].join("\n");
  const zero = { text: { input: { price: 0 }, output: { price: 0 } } };
  const fetchImpl = async (url) => {
    if (url.includes("openrouter.ai")) {
      return {
        ok: true,
        json: async () => ({ data: [{ id: "inclusionai/ling-3.2-flash:free", pricing: {} }] })
      };
    }
    if (url.includes("opencode.ai")) {
      return {
        ok: true,
        json: async () => ({
          data: [
            { id: "hy4-flash-free", cost: zero },
            { id: "tidepool-alpha-free", cost: zero }
          ]
        })
      };
    }
    return { ok: false, status: 404 };
  };
  const models = await discoverFreeModels({
    cwd: dir,
    env: {},
    fsImpl: fs,
    fetchImpl,
    cliModels: async () => cliOutput,
    timeoutMs: 50
  });
  const ids = models.map((m) => m.id);
  assert.ok(!ids.includes("opencode/tidepool-alpha-free"), "CLI không liệt kê thì bỏ");
  assert.ok(ids.includes("opencode/deepseek-v4.1-flash-free"));
  assert.ok(ids.includes("openrouter/baidu/ernie-5.5-flash-preview:free"));
  assert.ok(ids.includes("openrouter/nvidia/nemotron-3.5-lightning:free"));
  assert.ok(!ids.some((id) => /audio/i.test(id)));
  assert.ok(models.every((m) => m.transport === "cli"), "mọi model từ CLI đều cli-ready");
  assert.deepEqual(ids.slice(0, 2), [
    "opencode/deepseek-v4.1-flash-free",
    "opencode/hy4-flash-free"
  ]);
});

test("priority order: authenticated fast models first, heavy models last", () => {
  const ids = [
    "opencode/iceman-free",
    "openrouter/a/flash:free",
    "opencode/hy4-flash-free",
    "opencode/nemotron-3.5-super-vl-free",
    "opencode/big-pickle",
    "opencode/deepseek-v4.1-flash-free",
    "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
    "opencode/mimo-v2.6-flash-free",
    "opencode/nemotron-3.5-lightning-free",
    "opencode/flint-40b-free",
    "opencode/seaglass-alpha-free",
    "openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free"
  ];
  const models = ids.map((id) => ({
    id,
    provider: id.split("/")[0],
    transport: id === "openrouter/a/flash:free" ? null : "cli",
    credential: id.startsWith("opencode/") ? "public" : null
  }));
  const sorted = sortModels(models).map((m) => m.id);
  assert.deepEqual(sorted.slice(0, PREFERRED_MODEL_ORDER.length), PREFERRED_MODEL_ORDER);
  assert.equal(sorted.at(-1), "openrouter/a/flash:free");
  const heavy = sorted.filter((id) => /reasoning|ultra|550b|super-vl/i.test(id));
  assert.equal(heavy.length, 3);
  assert.ok(heavy.every((id) => sorted.indexOf(id) > PREFERRED_MODEL_ORDER.length - 1));
});

test("discoverFreeModels uses live OpenCode catalog without duplicating fallback", async (t) => {
  const dir = tempDir(t);
  const fetchImpl = async (url) => {
    if (url.includes("openrouter.ai")) {
      return { ok: true, json: async () => ({ data: [{ id: "a/flash:free", pricing: {} }] }) };
    }
    if (url.includes("opencode.ai")) {
      return {
        ok: true,
        json: async () => ({
          data: [{
            id: "hy4-flash-free",
            cost: { text: { input: { price: 0 }, output: { price: 0 } } }
          }]
        })
      };
    }
    return { ok: false, status: 404 };
  };
  const models = await discoverFreeModels({
    cwd: dir,
    env: {},
    fsImpl: fs,
    fetchImpl,
    cliModels: async () => [],
    timeoutMs: 50
  });
  assert.equal(models.filter((m) => m.id === "opencode/hy4-flash-free").length, 1);
  assert.ok(models.some((m) => m.id === "opencode/hy4-flash-free" && m.transport === "cli"));
  assert.equal(new Set(models.map((m) => m.id)).size, models.length);
});

test("discoverLocalServer probes configured port first", async () => {
  const seen = [];
  const hit = await discoverLocalServer({
    env: { FO4_OPENCODE_PORT: "45555" },
    fetchImpl: async (url) => {
      seen.push(url);
      return { ok: false, status: 401 };
    },
    timeoutMs: 50
  });
  assert.equal(hit.baseUrl, "http://127.0.0.1:45555");
  assert.match(seen[0], /45555/);
});

test("discoverFreeModels merges sources and attaches credentials", async (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, ".env"), "GEMINI_API_KEY=file-gemini-key\n", "utf8");
  const fetchImpl = async (url) => {
    if (url.includes("openrouter.ai")) {
      return { ok: true, json: async () => ({ data: [{ id: "a/flash:free", pricing: {} }] }) };
    }
    return { ok: false, status: 404 };
  };
  const models = await discoverFreeModels({
    cwd: dir,
    env: {},
    fsImpl: fs,
    fetchImpl,
    cliModels: async () => [],
    timeoutMs: 50
  });
  assert.ok(models.some((m) => m.id.startsWith("opencode/") && m.baseUrl === null));
  assert.ok(models.some((m) => m.provider === "gemini" && m.credential === "file-gemini-key"));
  assert.ok(models.some((m) => m.id === "openrouter/a/flash:free"));
  assert.equal(new Set(models.map((m) => m.id)).size, models.length);
});
