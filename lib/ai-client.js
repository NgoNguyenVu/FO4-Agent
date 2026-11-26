// AI client với auto-rotation model free. Credential chỉ nằm trong object model
// (đọc từ .env/auth.json) và KHÔNG BAO GIỜ bị log.
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function localStatisticalHeuristic(payload) {
  const ui = payload?.ui || {};
  const history = Array.isArray(ui.history) ? ui.history : [];
  const threshold = Number(ui.threshold) || 0;
  const recent = history.slice(-5);
  const below = recent.filter((row) => Number(row.random) < threshold).length;
  const decision = threshold > 0 && below >= Math.ceil(recent.length / 2) ? "MAIN" : "BAIT";
  return {
    decision,
    randomPrediction: recent.length
      ? Math.round(recent.reduce((sum, row) => sum + Number(row.random || 0), 0) / recent.length)
      : Math.round(threshold * 0.8),
    confidence: recent.length ? Math.min(0.6, recent.length / 10) : 0.2,
    reason: "local-statistical-heuristic",
    phoiToAdd: { bait: decision === "BAIT" ? 1 : 0, main: decision === "MAIN" ? 5 : 0 },
    useSoiCau: false,
    riskFlags: ["no-ai-credential"]
  };
}

function systemPrompt() {
  return [
    "Bạn là trợ lý phân tích nhịp random của mini-app nâng cấp FO4.",
    "Quy tắc: Chỉ số Random < Mốc Random là thành công.",
    "Chỉ trả về JSON đúng schema, không markdown, không giải thích thêm.",
    "Không trả dữ liệu nhạy cảm (chatId, token, đường dẫn)."
  ].join(" ");
}

function parseJsonResponse(text) {
  const raw = String(text ?? "").trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI_JSON_INVALID");
  return JSON.parse(match[0]);
}

// `opencode run --format json` phát từng dòng JSON (JSONL). Chỉ lấy các event
// text; bỏ step_start/step_finish để không bao giờ trả nhầm metadata làm JSON.
function parseCliJson(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) throw new Error("OPENCODE_CLI_EMPTY");
  if (!text.includes("\n") && text.startsWith("{")) return parseJsonResponse(text);
  const chunks = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event?.type === "text" && typeof event?.part?.text === "string") {
      chunks.push(event.part.text);
    }
  }
  return parseJsonResponse(chunks.join("\n"));
}

// Windows exposes `opencode` as a .cmd/.ps1 shim which child_process.spawn
// cannot run directly. Follow the shim to the real .exe so no shell is needed.
function opencodeBin(env = {}) {
  const explicit = env.FO4_OPENCODE_BIN || env.OPENCODE_BIN;
  if (explicit) return explicit;
  if (process.platform !== "win32") return "opencode";

  const directories = String(env.PATH || process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean);
  for (const dir of directories) {
    for (const name of ["opencode.exe", "opencode.cmd", "opencode.ps1", "opencode"]) {
      const file = path.join(dir, name);
      if (!fs.existsSync(file)) continue;
      if (name === "opencode.exe") return file;
      let text = "";
      try {
        text = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const match = text.match(/(?:node_modules[\\/])@opencode[\\/]cli[\\/]bin[\\/]opencode\.exe/i);
      if (!match) continue;
      const target = path.join(dir, match[0].replace(/[\\/]/g, path.sep));
      if (fs.existsSync(target)) return target;
    }
  }

  const appData = env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  const globalExe = path.join(
    appData, "npm", "node_modules", "@opencode", "cli", "bin", "opencode.exe"
  );
  return fs.existsSync(globalExe) ? globalExe : "opencode";
}

function classifyCliError(error, stderr = "") {
  const detail = `${stderr || ""} ${error?.message || ""}`;
  if (/rate.?limit|429|FreeUsageLimitError/i.test(detail)) {
    const rateError = new Error("HTTP_429");
    rateError.status = 429;
    return rateError;
  }
  if (error?.code === "ENOENT") return new Error("OPENCODE_CLI_MISSING");
  if (error?.timedOut) {
    const timeoutError = new Error("OPENCODE_CLI_TIMEOUT");
    timeoutError.name = "AbortError";
    return timeoutError;
  }
  return new Error(`OPENCODE_CLI_${error?.code || error?.message || "ERROR"}`.slice(0, 120));
}

function defaultOpencodeCliRunner(model, prompt, { env, timeoutMs = 15_000 } = {}) {
  const args = [
    "run",
    "--format",
    "json",
    "--archived",
    "--title",
    "FO4-agent AI",
    "--model",
    model.id,
    prompt
  ];
  return new Promise((resolve, reject) => {
    // stdin phải bị đóng ngay: CLI có thể chờ EOF trước khi gửi prompt.
    const child = spawn(opencodeBin(env || {}), args, {
      cwd: env?.FO4_OPENCODE_CWD || process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        if (timedOut) error.timedOut = true;
        return reject(classifyCliError(error, stderr));
      }
      try {
        resolve(parseCliJson(stdout));
      } catch (parseError) {
        reject(parseError);
      }
    };

    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      finish(code === 0 ? null : new Error(`CLI_EXIT_${code}`));
    });
  });
}

// Model opencode/* chạy qua `opencode run`: dùng phiên đăng nhập có sẵn của CLI,
// không cần API key và không đụng vào service.json hay process lock của agent.
function hasCredential(model, env) {
  if (model?.transport === "cli") return true;
  if (model?.credential) return true;
  const provider = model?.provider;
  if (provider === "openrouter") return Boolean(env.OPENROUTER_API_KEY);
  if (provider === "gemini") return Boolean(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
  return Boolean(
    env.FO4_AI_API_KEY ||
      env.OPENCODE_API_KEY ||
      env.FO4_OPENCODE_API_KEY ||
      env.FO4_AI_BASE_URL
  );
}

function endpointFor(model, env) {
  const key = model.credential ||
    (model.provider === "openrouter"
      ? env.OPENROUTER_API_KEY
      : model.provider === "gemini"
        ? env.GEMINI_API_KEY || env.GOOGLE_API_KEY
        : env.FO4_AI_API_KEY || env.OPENCODE_API_KEY || env.FO4_OPENCODE_API_KEY);

  if (model.provider === "openrouter") {
    return {
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }
    };
  }
  if (model.provider === "gemini") {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`,
      headers: { "Content-Type": "application/json" }
    };
  }
  const base = model.baseUrl || env.FO4_AI_BASE_URL || "http://127.0.0.1:28894/v1";
  return {
    url: `${base.replace(/\/$/, "")}/chat/completions`,
    headers: { Authorization: `Bearer ${key || ""}`, "Content-Type": "application/json" }
  };
}

async function callModel(model, prompt, options) {
  const { fetchImpl, env, timeoutMs, cliRunner } = options;
  if (model.transport === "cli") {
    return cliRunner(model, prompt, { env, timeoutMs });
  }
  const endpoint = endpointFor(model, env);
  const body =
    model.provider === "gemini"
      ? {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" }
        }
      : {
          model: model.id.replace(/^opencode\//, ""),
          messages: [
            { role: "system", content: systemPrompt() },
            { role: "user", content: prompt }
          ],
          temperature: 0.2,
          max_tokens: 400
        };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint.url, {
      method: "POST",
      headers: endpoint.headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) {
      const error = new Error(`HTTP_${response.status}`);
      error.status = response.status;
      throw error;
    }
    const data = await response.json();
    const text =
      model.provider === "gemini"
        ? data?.candidates?.[0]?.content?.parts?.[0]?.text
        : data?.choices?.[0]?.message?.content;
    return parseJsonResponse(text);
  } finally {
    clearTimeout(timer);
  }
}

function createAiClient({
  models = [],
  selectedId = null,
  fetchImpl = globalThis.fetch,
  env: envInput = process.env,
  env = envInput,
  timeoutMs = 15_000,
  maxRetries = 2,
  opencodeCliRunner = defaultOpencodeCliRunner,
  log = () => {}
} = {}) {
  const available = Array.isArray(models) ? models.filter((m) => m && m.id) : [];
  const start = Math.max(0, available.findIndex((m) => m.id === selectedId));
  const ordered = [...available.slice(start), ...available.slice(0, start)];

  return {
    models: available,
    selectedId: selectedId || available[0]?.id || null,
    usingFallback: !ordered.some((model) => hasCredential(model, env)),

    async askJson(payload, schema) {
      const prompt = `${systemPrompt()}\nSCHEMA: ${JSON.stringify(schema)}\nINPUT: ${JSON.stringify(payload)}`;
      const attempts = [];
      let rateLimited = false;
      for (const model of ordered) {
        if (!hasCredential(model, env)) {
          attempts.push({ model: model.id, error: "no-credential" });
          continue;
        }
        for (let retry = 0; retry <= maxRetries; retry += 1) {
          try {
            const json = await callModel(model, prompt, {
              fetchImpl,
              env,
              timeoutMs,
              cliRunner: opencodeCliRunner
            });
            return { ...json, _model: model.id, _attempts: attempts.length + 1 };
          } catch (error) {
            attempts.push({ model: model.id, error: error.message });
            log(`AI ${model.id} lỗi (${error.message}); xoay model kế tiếp.`);
            if (error.status === 429) rateLimited = true;
            if (error.status === 429 || error.name === "AbortError") break;
            if (!/JSON/.test(error.message)) break;
          }
        }
      }
      // Rate-limit liên tiếp KHÔNG được rơi xuống heuristic rồi đốt thẻ chính.
      if (rateLimited) {
        return {
          decision: "HOLD",
          randomPrediction: 0,
          confidence: 0,
          reason: "ai-rate-limited",
          phoiToAdd: { bait: 0, main: 0 },
          useSoiCau: false,
          riskFlags: ["ai-rate-limited"],
          _model: "rate-limit-guard",
          _attempts: attempts.length
        };
      }
      return {
        ...localStatisticalHeuristic(payload),
        _model: "local-heuristic",
        _attempts: attempts.length
      };
    }
  };
}

module.exports = {
  localStatisticalHeuristic,
  systemPrompt,
  parseJsonResponse,
  parseCliJson,
  opencodeBin,
  hasCredential,
  endpointFor,
  defaultOpencodeCliRunner,
  createAiClient
};
