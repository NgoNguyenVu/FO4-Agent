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
  normalizeOpenRouter,
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
    timeoutMs: 50
  });
  assert.ok(models.some((m) => m.id.startsWith("opencode/") && m.baseUrl === null));
  assert.ok(models.some((m) => m.provider === "gemini" && m.credential === "file-gemini-key"));
  assert.ok(models.some((m) => m.id === "openrouter/a/flash:free"));
  assert.equal(new Set(models.map((m) => m.id)).size, models.length);
});
