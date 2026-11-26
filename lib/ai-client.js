// AI client với auto-rotation model free. Credential chỉ nằm trong object model
// (đọc từ .env/auth.json) và KHÔNG BAO GIỜ bị log.
"use strict";

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

function hasCredential(model, env) {
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
  const { fetchImpl, env, timeoutMs } = options;
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
            const json = await callModel(model, prompt, { fetchImpl, env, timeoutMs });
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
  hasCredential,
  endpointFor,
  createAiClient
};
