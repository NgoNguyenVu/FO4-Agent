// Dynamic discovery của model AI MIỄN PHÍ: OpenRouter, OpenCode (local server +
// auth file), Gemini. Không hardcode một model duy nhất cho runtime.
// Không bao giờ log giá trị credential.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
// OpenCode free models được phục vụ qua endpoint OpenAI-compatible công khai.
// Danh sách model lấy động từ /v1/models; runtime dùng `opencode run` (CLI) nên
// không cần đọc service.json/password của server đang chạy.
const OPENCODE_INFERENCE_URL = "https://opencode.ai/inference/openai/v1";
const OPENCODE_MODELS_URL = `${OPENCODE_INFERENCE_URL}/models`;
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

// Model không phải text LLM bị loại ở MỌI nguồn (catalog API lẫn CLI).
const NON_TEXT_MODEL_PATTERN =
  /lyria|grok-imagine|gpt-live|whisper|\btts\b|embedding|image|video|audio/i;
// Thứ tự ưu tiên đã hiệu chỉnh cho tác vụ đọc cầu: nhanh + JSON ổn định trước.
const PREFERRED_MODEL_ORDER = Object.freeze([
  "opencode/deepseek-v4.1-flash-free",
  "opencode/hy4-flash-free",
  "opencode/mimo-v2.6-flash-free",
  "opencode/nemotron-3.5-lightning-free",
  "opencode/flint-40b-free",
  "opencode/big-pickle",
  "opencode/seaglass-alpha-free",
  "opencode/iceman-free"
]);
// Reasoning/ultra/siêu lớn bị đẩy xuống cuối dù có sẵn credential.
const HEAVY_MODEL_PATTERN = /reasoning|ultra|550b|super-vl/i;

// Đường dẫn auth thực tế trên Windows máy người dùng.
function authPaths({ env = process.env, homeDir = os.homedir() } = {}) {
  const localAppData = env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
  return [
    path.join(homeDir, ".config", "opencode", "auth.json"),
    path.join(homeDir, ".local", "share", "opencode", "auth.json"),
    path.join(localAppData, "opencode", "auth.json")
  ];
}

// `opencode serve --service` ghi service.json (url/pid/password) vào state dir.
function servicePaths({ env = process.env, homeDir = os.homedir() } = {}) {
  const localAppData = env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
  return [
    path.join(homeDir, ".config", "opencode", "service.json"),
    path.join(homeDir, ".local", "state", "opencode", "service.json"),
    path.join(localAppData, "opencode", "service.json")
  ];
}

function readServiceConfig({ env, fsImpl = fs, homeDir = os.homedir() }) {
  for (const file of servicePaths({ env, homeDir })) {
    const json = readJson(file, fsImpl);
    if (json?.url && json?.password) return { url: json.url, pid: json.pid || null, file };
  }
  return null;
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

function isTextModel(id) {
  return !NON_TEXT_MODEL_PATTERN.test(String(id || ""));
}

function speedScore(id) {
  const text = String(id).toLowerCase();
  for (const [needle, score] of [
    ["flash", 6],
    ["lightning", 6],
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

// `opencode models` in ra mỗi dòng một id: `provider/model`. Không log nội dung
// credential hay cấu trúc server; đây là lệnh liệt kê read-only.
function parseCliModels(output) {
  const text = Array.isArray(output) ? output.join("\n") : String(output ?? "");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[a-z0-9_.-]+\/[^\s]+$/i.test(line));
}

function isCliFreeTextModel(id) {
  const text = String(id || "");
  if (!isTextModel(text)) return false;
  // Mọi model của provider `opencode` đều là free inference; OpenRouter chỉ lấy
  // model có đuôi `:free` (đúng những gì catalog công khai báo là free).
  return text.startsWith("opencode/") || text.endsWith(":free");
}

function defaultCliModels({ env, timeoutMs = 8_000 } = {}) {
  const { spawnSync } = require("node:child_process");
  const { opencodeBin } = require("./ai-client");
  try {
    const result = spawnSync(opencodeBin(env || {}), ["models"], {
      cwd: env?.FO4_OPENCODE_CWD || process.cwd(),
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
      input: ""
    });
    if (result.error || result.status !== 0) return "";
    return String(result.stdout || "");
  } catch {
    return "";
  }
}

function modelPriority(model) {
  const id = String(model?.id || "").toLowerCase();
  const exactRank = PREFERRED_MODEL_ORDER.indexOf(id);
  return {
    // Model đã có xác thực (CLI hoặc key) luôn đứng trước model chờ credential.
    unauthenticated: model?.transport === "cli" || model?.credential ? 0 : 1,
    exactRank: exactRank === -1 ? PREFERRED_MODEL_ORDER.length : exactRank,
    heavy: HEAVY_MODEL_PATTERN.test(id) ? 1 : 0,
    speed: speedScore(id),
    id
  };
}

function sortModels(models) {
  return [...models].sort((a, b) => {
    const left = modelPriority(a);
    const right = modelPriority(b);
    return (
      left.unauthenticated - right.unauthenticated ||
      left.exactRank - right.exactRank ||
      left.heavy - right.heavy ||
      right.speed - left.speed ||
      left.id.localeCompare(right.id)
    );
  });
}

function normalizeOpenRouter(data) {
  const rows = Array.isArray(data?.data) ? data.data : [];
  return rows
    .filter((item) => isFreeModel(item) && isTextModel(item?.id))
    .map((item) => ({
      id: `openrouter/${item.id}`,
      provider: "openrouter",
      label: item.name || item.id,
      speed: speedScore(item.id)
    }))
    .sort((a, b) => b.speed - a.speed || a.id.localeCompare(b.id));
}

// `/v1/models` của OpenCode trả cost.text.{input,output}.price = 0 cho model free.
function normalizeOpenCodeInference(data) {
  const rows = Array.isArray(data?.data) ? data.data : [];
  return rows
    .filter((item) => {
      if (!isTextModel(item?.id)) return false;
      const input = Number(item?.cost?.text?.input?.price ?? 0);
      const output = Number(item?.cost?.text?.output?.price ?? 0);
      return input === 0 && output === 0;
    })
    .map((item) => ({
      id: `opencode/${item.id}`,
      provider: "opencode",
      label: item.name || item.id,
      speed: speedScore(item.id),
      credential: "public",
      baseUrl: OPENCODE_INFERENCE_URL,
      transport: "cli"
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
  opencodeModelsUrl = OPENCODE_MODELS_URL,
  cliModels = defaultCliModels,
  timeoutMs = 8_000,
  onError = () => {}
} = {}) {
  // .env được nạp TRƯỚC khi đọc bất kỳ biến môi trường nào.
  const env = loadEnvFile({ cwd, env: envInput, fsImpl });
  const credentials = readOpenCodeAuth({ env, fsImpl });
  const models = [];

  async function fetchCatalog(url, label, headers = { Accept: "application/json" }) {
    if (typeof fetchImpl !== "function") return null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(url, { signal: controller.signal, headers });
      } finally {
        clearTimeout(timer);
      }
      return response?.ok ? await response.json() : null;
    } catch (error) {
      onError(`${label} discovery: ${error.message}`);
      return null;
    }
  }

  const openRouterData = await fetchCatalog(openRouterUrl, "OpenRouter");
  if (openRouterData) models.push(...normalizeOpenRouter(openRouterData));

  // Catalog công khai của OpenCode là nguồn động; không phụ thuộc vào server
  // local đang chạy (không đọc service.json, không đụng process lock của Mode [1]).
  const opencodeData = await fetchCatalog(opencodeModelsUrl, "OpenCode", {
    Accept: "application/json",
    Authorization: "Bearer public"
  });
  if (opencodeData) models.push(...normalizeOpenCodeInference(opencodeData));

  if (!models.some((model) => model.provider === "opencode")) {
    const localServer = typeof fetchImpl === "function"
      ? await discoverLocalServer({ fetchImpl, env, timeoutMs })
      : null;
    const opencodeKey =
      env.OPENCODE_API_KEY ||
      env.FO4_OPENCODE_API_KEY ||
      credentialFor(credentials, ["opencode", "opencode.ai"]);
    for (const id of OPENCODE_FREE_CATALOG.filter(isTextModel)) {
      models.push({
        id: `opencode/${id}`,
        provider: "opencode",
        label: id,
        speed: speedScore(id),
        credential: opencodeKey || "public",
        baseUrl: localServer?.baseUrl || null,
        transport: "cli"
      });
    }
  }

  const geminiKey =
    env.GEMINI_API_KEY ||
    env.GOOGLE_API_KEY ||
    credentialFor(credentials, ["google", "gemini", "generativelanguage"]);
  if (geminiKey) models.push(googleModel(geminiKey));

  // Nguồn quyết định availability là `opencode models` trên chính máy chạy agent.
  // Lệnh này read-only, không đụng service.json hay process lock của Mode [1].
  let cliIds = [];
  try {
    const output = await cliModels({ env, timeoutMs });
    cliIds = parseCliModels(output).filter(isCliFreeTextModel);
  } catch (error) {
    onError(`OpenCode CLI models: ${error.message}`);
  }
  if (cliIds.length) {
    const byId = new Map(models.map((model) => [model.id, model]));
    const hasApiOpenCode = models.some((model) => model.provider === "opencode");
    if (hasApiOpenCode) {
      // CLI không liệt kê -> model đó không gọi được qua `opencode run`.
      for (const [id, model] of [...byId]) {
        if (model.provider === "opencode" && !cliIds.includes(id)) byId.delete(id);
      }
    }
    for (const id of cliIds) {
      const existing = byId.get(id);
      if (existing) {
        byId.set(id, { ...existing, transport: "cli" });
        continue;
      }
      const provider = id.split("/")[0];
      byId.set(id, {
        id,
        provider,
        label: id,
        speed: speedScore(id),
        credential: provider === "opencode" ? "public" : null,
        baseUrl: provider === "opencode" ? OPENCODE_INFERENCE_URL : null,
        transport: "cli"
      });
    }
    models.splice(0, models.length, ...byId.values());
  }

  const seen = new Set();
  const filtered = models.filter((model) => {
    if (!model?.id || !isTextModel(model.id) || seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
  return sortModels(filtered);
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
  OPENCODE_INFERENCE_URL,
  OPENCODE_MODELS_URL,
  OPENCODE_FREE_CATALOG,
  authPaths,
  servicePaths,
  readServiceConfig,
  envFilePath,
  loadEnvFile,
  extractCredentials,
  isFreeModel,
  isTextModel,
  NON_TEXT_MODEL_PATTERN,
  PREFERRED_MODEL_ORDER,
  parseCliModels,
  isCliFreeTextModel,
  defaultCliModels,
  sortModels,
  normalizeOpenRouter,
  normalizeOpenCodeInference,
  discoverLocalServer,
  discoverFreeModels,
  formatModelMenu,
  parseModelArgument,
  selectModel
};
