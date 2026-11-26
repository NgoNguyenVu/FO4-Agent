// Dynamic discovery của model AI MIỄN PHÍ: OpenRouter, OpenCode (local server +
// auth file), Gemini. Không hardcode một model duy nhất cho runtime.
// Không bao giờ log giá trị credential.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENCODE_FREE_CATALOG = Object.freeze([
  "hy4-flash-free",
  "deepseek-v4.1-flash-free",
  "tidepool-alpha-free",
  "iceman-free",
  "flint-40b-free",
  "nemotron-3.5-super-vl-free",
  "beam-free",
  "mimo-v2.6-flash-free",
  "nemotron-3.5-lightning-free"
]);

// Đường dẫn auth thực tế trên Windows máy người dùng.
function authPaths({ env = process.env, homeDir = os.homedir() } = {}) {
  const localAppData = env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
  return [
    path.join(homeDir, ".config", "opencode", "auth.json"),
    path.join(homeDir, ".local", "share", "opencode", "auth.json"),
    path.join(localAppData, "opencode", "auth.json")
  ];
}

function envFilePath({ cwd = process.cwd() } = {}) {
  return path.join(cwd, ".env");
}

// Nạp .env vào một bản sao env; biến đã có trong process/env được giữ nguyên.
function loadEnvFile({
  cwd = process.cwd(),
  env = process.env,
  fsImpl = fs,
  filePath = envFilePath({ cwd })
} = {}) {
  const merged = { ...env };
  let text = "";
  try {
    text = fsImpl.readFileSync(filePath, "utf8");
  } catch {
    return merged;
  }
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim().replace(/^export\s+/, "");
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && merged[key] === undefined) merged[key] = value;
  }
  return merged;
}

function readJson(file, fsImpl = fs) {
  try {
    if (!fsImpl.existsSync(file)) return null;
    return JSON.parse(fsImpl.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// Trích credential từ auth.json mà không trả về nội dung thô cho log.
function extractCredentials(authJson) {
  const found = [];
  const visit = (node, providerHint = "") => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      const hint = providerHint || key;
      if (typeof value === "string") {
        if (/^(?:key|token|api[_-]?key|apikey|secret|auth)$/i.test(key) && value.length >= 12) {
          found.push({ provider: String(hint).toLowerCase(), value });
        }
      } else if (value && typeof value === "object") {
        visit(value, hint);
      }
    }
  };
  visit(authJson);
  return found;
}

function readOpenCodeAuth({ env, fsImpl = fs, homeDir = os.homedir() }) {
  const credentials = [];
  for (const file of authPaths({ env, homeDir })) {
    const json = readJson(file, fsImpl);
    if (!json) continue;
    for (const item of extractCredentials(json)) {
      if (!credentials.some((c) => c.value === item.value)) credentials.push(item);
    }
  }
  return credentials;
}

function isFreeModel(item) {
  const pricing = item?.pricing || {};
  const zero = (value) => value == null || Number(value) === 0;
  return (
    String(item?.id || "").endsWith(":free") ||
    (zero(pricing.prompt) && zero(pricing.completion))
  );
}

function speedScore(id) {
  const text = String(id).toLowerCase();
  for (const [needle, score] of [
    ["flash", 6],
    ["lite", 5],
    ["mini", 5],
    ["nano", 5],
    ["fast", 4],
    ["free", 1]
  ]) {
    if (text.includes(needle)) return score;
  }
  return 0;
}

function normalizeOpenRouter(data) {
  const rows = Array.isArray(data?.data) ? data.data : [];
  return rows
    .filter(isFreeModel)
    .map((item) => ({
      id: `openrouter/${item.id}`,
      provider: "openrouter",
      label: item.name || item.id,
      speed: speedScore(item.id)
    }))
    .sort((a, b) => b.speed - a.speed || a.id.localeCompare(b.id));
}

function credentialFor(credentials, providers) {
  return (
    credentials.find((c) => providers.includes(c.provider))?.value ||
    credentials.find((c) => providers.includes(c.provider.split("/")[0]))?.value ||
    null
  );
}

function googleModel(key) {
  return {
    id: "gemini/gemini-2.5-flash",
    provider: "gemini",
    label: "Gemini 2.5 Flash (free tier)",
    speed: speedScore("gemini-2.5-flash"),
    credential: key
  };
}

async function probeOpenCodeServer({
  fetchImpl,
  env,
  port,
  timeoutMs = 1_500
} = {}) {
  const base = `http://127.0.0.1:${port}`;
  for (const pathname of ["/api/model", "/v1/models", "/api/agent"]) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(`${base}${pathname}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" }
        });
      } finally {
        clearTimeout(timer);
      }
      if (response?.ok || response?.status === 401) {
        return { baseUrl: base, reachable: true, authenticated: response.ok };
      }
    } catch { /* thử endpoint/path/port khác */ }
  }
  return null;
}

async function discoverLocalServer({ fetchImpl, env, timeoutMs = 1_500 } = {}) {
  const ports = new Set([
    Number(env.FO4_OPENCODE_PORT),
    Number(env.OPENCODE_PORT),
    Number(env.FO4_AI_PORT),
    28894,
    3000,
    8080,
    1234
  ]);
  for (const port of ports) {
    if (!Number.isInteger(port) || port <= 0 || port > 65535) continue;
    const hit = await probeOpenCodeServer({ fetchImpl, env, port, timeoutMs });
    if (hit) return hit;
  }
  return null;
}

async function discoverFreeModels({
  fetchImpl = globalThis.fetch,
  env: envInput = process.env,
  cwd = process.cwd(),
  fsImpl = fs,
  openRouterUrl = OPENROUTER_MODELS_URL,
  timeoutMs = 8_000,
  onError = () => {}
} = {}) {
  // .env được nạp TRƯỚC khi đọc bất kỳ biến môi trường nào.
  const env = loadEnvFile({ cwd, env: envInput, fsImpl });
  const credentials = readOpenCodeAuth({ env, fsImpl });
  const models = [];

  if (typeof fetchImpl === "function") {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(openRouterUrl, {
          signal: controller.signal,
          headers: { Accept: "application/json" }
        });
      } finally {
        clearTimeout(timer);
      }
      if (response?.ok) models.push(...normalizeOpenRouter(await response.json()));
    } catch (error) {
      onError(`OpenRouter discovery: ${error.message}`);
    }
  }

  const localServer = typeof fetchImpl === "function"
    ? await discoverLocalServer({ fetchImpl, env, timeoutMs })
    : null;
  const opencodeKey =
    env.OPENCODE_API_KEY ||
    env.FO4_OPENCODE_API_KEY ||
    credentialFor(credentials, ["opencode", "opencode.ai"]);

  for (const id of OPENCODE_FREE_CATALOG) {
    models.push({
      id: `opencode/${id}`,
      provider: "opencode",
      label: id,
      speed: speedScore(id),
      credential: opencodeKey,
      baseUrl: localServer?.baseUrl || null
    });
  }

  const geminiKey =
    env.GEMINI_API_KEY ||
    env.GOOGLE_API_KEY ||
    credentialFor(credentials, ["google", "gemini", "generativelanguage"]);
  if (geminiKey) models.push(googleModel(geminiKey));

  const seen = new Set();
  return models.filter((model) => {
    if (!model?.id || seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

function formatModelMenu(models) {
  const lines = ["Chọn model AI miễn phí (để trống = model đầu tiên):"];
  models.slice(0, 12).forEach((model, index) => {
    lines.push(`  [${index + 1}] ${model.id}${index === 0 ? " (mặc định)" : ""}`);
  });
  if (!models.length) lines.push("  (không có model; dùng bộ thống kê cục bộ)");
  return lines.join("\n");
}

function parseModelArgument(argv = []) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--ai-model") return argv[index + 1] || "";
    if (arg.startsWith("--ai-model=")) return arg.slice("--ai-model=".length);
  }
  return null;
}

function selectModel(models, raw) {
  const text = String(raw ?? "").trim();
  if (!text) return models[0] || null;
  const index = Number(text);
  if (Number.isInteger(index) && index >= 1 && index <= models.length) {
    return models[index - 1];
  }
  return (
    models.find((model) => model.id.toLowerCase() === text.toLowerCase()) ||
    models.find((model) => model.id.endsWith(`/${text}`)) ||
    null
  );
}

module.exports = {
  OPENROUTER_MODELS_URL,
  OPENCODE_FREE_CATALOG,
  authPaths,
  envFilePath,
  loadEnvFile,
  extractCredentials,
  isFreeModel,
  normalizeOpenRouter,
  discoverLocalServer,
  discoverFreeModels,
  formatModelMenu,
  parseModelArgument,
  selectModel
};
