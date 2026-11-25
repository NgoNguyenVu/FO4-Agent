// Quản lý lỗi E006 ("Không thể làm mới token") theo từng luồng.
//
// Trước đây E006 thường làm cả agent về idle hoặc đẩy worker vào `unknown`,
// khiến registry chặn mọi lần mua mới cho tới khi con người resolve. Module này
// tách lỗi theo đúng feature đang chạy (icon-buy / phoi-buy / upgrade), giữ
// feature đó trong cooldown 10 phút rồi tự động mở lại. Các feature khác vẫn
// chạy bình thường.
//
// Module thuần (không import features/, Playwright hay Telegram) để test được
// bằng clock/timer giả và để controller/runner dùng chung một nguồn sự thật.
const fs = require("node:fs");
const path = require("node:path");
const { dataDir } = require("./log-paths");
const { writeJsonAtomic } = require("./atomic-file");

const E006_COOLDOWN_MS = 10 * 60 * 1000;
const TEST_SUFFIX = process.env.NODE_TEST_CONTEXT ? ".test" : "";
const DEFAULT_COOLDOWN_PATH = path.join(
  dataDir,
  "state",
  `e006-cooldown${TEST_SUFFIX}.json`
);

const E006_FLOWS = Object.freeze({
  ICON_BUY: "icon-buy",
  PHOI_BUY: "phoi-buy",
  UPGRADE: "upgrade",
  UNKNOWN: "unknown"
});

const FLOW_ALIASES = new Map([
  ["icon", E006_FLOWS.ICON_BUY],
  ["icon-buy", E006_FLOWS.ICON_BUY],
  ["icon_buy", E006_FLOWS.ICON_BUY],
  ["buy", E006_FLOWS.PHOI_BUY],
  ["phoi", E006_FLOWS.PHOI_BUY],
  ["phoi-buy", E006_FLOWS.PHOI_BUY],
  ["phoi_buy", E006_FLOWS.PHOI_BUY],
  ["upgrade", E006_FLOWS.UPGRADE],
  ["nang", E006_FLOWS.UPGRADE],
  ["nang-cap", E006_FLOWS.UPGRADE]
]);

function normalizeFlow(flow) {
  if (!flow) return null;
  const key = String(flow).trim().toLowerCase();
  return FLOW_ALIASES.get(key) || null;
}

// E006 có thể đến dưới dạng Error(code BOT_SYSTEM_ERROR), message thô từ bot,
// hoặc outcome { status: "system-error" }. Nhận cả ba để không bỏ sót.
function isE006Error(error) {
  if (!error) return false;
  if (error.code === "BOT_SYSTEM_ERROR") return true;
  if (error.code === "E006") return true;
  if (error.e006 === true) return true;
  // Chỉ xét message: stack có thể chứa tên module "e006-cooldown" và làm
  // nhận nhầm mọi lỗi thành E006.
  const text = String(error.message || "");
  return /E006|không thể làm mới token|khong the lam moi token/i.test(text);
}

// Ưu tiên flow do caller chỉ định (chính xác nhất), sau đó tới flow gắn trên
// error, cuối cùng mới suy ra từ message/stack. Nhờ vậy log không còn chung
// chung "Bot trả E006" mà luôn nói rõ luồng nào đang bị hoãn.
function identifyE006Flow({ flow = null, error = null, source = "" } = {}) {
  const explicit =
    normalizeFlow(flow) ||
    normalizeFlow(error?.flow) ||
    normalizeFlow(error?.feature);
  if (explicit) return explicit;

  const text = [error?.message, error?.stack, source]
    .filter(Boolean)
    .join(" ");

  if (/features[\\/]icon-buy|icon-buy|icon_buy|TTCN|Chèn Member|Mua cầu thủ/i.test(text)) {
    return E006_FLOWS.ICON_BUY;
  }
  if (/features[\\/]upgrade|upgrade|Auto Nâng|Nâng cấp|\/stopnc|\/tn\b/i.test(text)) {
    return E006_FLOWS.UPGRADE;
  }
  if (/features[\\/]buy|phoi-buy|phoi_buy|Auto Mua Phôi|Mua phôi|mua phôi/i.test(text)) {
    return E006_FLOWS.PHOI_BUY;
  }
  return E006_FLOWS.UNKNOWN;
}

function createE006Cooldown({
  cooldownMs = E006_COOLDOWN_MS,
  now = Date.now,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  log = () => {},
  logError = () => {},
  statePath = DEFAULT_COOLDOWN_PATH,
  fsImpl = fs
} = {}) {
  if (!Number.isFinite(cooldownMs) || cooldownMs <= 0) {
    throw new TypeError("E006 cooldown phải là số dương.");
  }

  const states = new Map(); // flow -> state
  const timers = new Map(); // flow -> timer id
  const callbacks = new Map(); // flow -> Set<fn>

  function toPersisted(state) {
    return {
      flow: state.flow,
      code: state.code,
      message: state.message,
      source: state.source,
      failedAt: state.failedAt,
      retryAt: state.retryAt,
      cooldownMs: state.cooldownMs,
      attempts: state.attempts
    };
  }

  function persist() {
    if (!statePath) return;
    try {
      writeJsonAtomic(
        statePath,
        [...states.values()].map(toPersisted),
        { fsImpl }
      );
    } catch (error) {
      logError(`Không lưu được E006 cooldown ${statePath}: ${error.message}`);
    }
  }

  function hydrate() {
    if (!statePath || !fsImpl.existsSync(statePath)) return;
    let saved = null;
    try {
      saved = JSON.parse(fsImpl.readFileSync(statePath, "utf8"));
    } catch (error) {
      logError(`Không đọc được E006 cooldown ${statePath}: ${error.message}`);
      return;
    }
    if (!Array.isArray(saved)) return;
    for (const item of saved) {
      const flow = normalizeFlow(item?.flow) || item?.flow;
      if (!flow || !Number.isFinite(item?.retryAt)) continue;
      if (item.retryAt <= now()) continue; // đã hết hạn trong lúc agent tắt
      const state = {
        flow,
        code: item.code || "E006",
        message: item.message || "E006 (khôi phục từ state).",
        source: item.source || "hydrate",
        failedAt: Number.isFinite(item.failedAt)
          ? item.failedAt
          : item.retryAt - cooldownMs,
        retryAt: item.retryAt,
        cooldownMs: Number.isFinite(item.cooldownMs) ? item.cooldownMs : cooldownMs,
        attempts: Number.isFinite(item.attempts) ? item.attempts : 1
      };
      states.set(flow, state);
      schedule(flow, state);
    }
  }

  function clearTimer(flow) {
    if (!timers.has(flow)) return;
    const timer = timers.get(flow);
    timers.delete(flow);
    try {
      clearTimeoutFn(timer);
    } catch {
      // Timer đã chạy hoặc fake timer không hỗ trợ clear: bỏ qua.
    }
  }

  function schedule(flow, state) {
    const delay = Math.max(0, state.retryAt - now());
    const timer = setTimeoutFn(() => {
      timers.delete(flow);
      const current = states.get(flow);
      // Một lần defer mới hơn đã thay thế timer cũ.
      if (!current || current.retryAt > now()) return;
      states.delete(flow);
      persist();
      log(
        `E006 [${flow}] hết cooldown ${Math.round(cooldownMs / 60_000)} phút; ` +
          "tự động reset trạng thái lỗi và chạy lại tính năng."
      );
      for (const callback of callbacks.get(flow) || []) {
        try {
          callback({ ...current });
        } catch (error) {
          logError(
            `Không chạy lại được ${flow} sau cooldown E006: ${error.message}`
          );
        }
      }
    }, delay);
    if (timer && typeof timer.unref === "function") timer.unref();
    timers.set(flow, timer);
  }

  // defer(flow, error, options) hoặc defer(error, options).
  function defer(flowOrError, errorOrOptions = null, maybeOptions = {}) {
    let flow = null;
    let error = null;
    let options = maybeOptions || {};

    if (typeof flowOrError === "string" || flowOrError == null) {
      flow = flowOrError;
      const looksLikeOptions =
        errorOrOptions &&
        typeof errorOrOptions === "object" &&
        !("message" in errorOrOptions) &&
        !("stack" in errorOrOptions);
      if (looksLikeOptions) {
        options = { ...errorOrOptions, ...maybeOptions };
      } else {
        error = errorOrOptions;
      }
    } else {
      error = flowOrError;
      options = errorOrOptions || {};
    }

    const identified = identifyE006Flow({
      flow,
      error,
      source: options.source || ""
    });
    const previous = states.get(identified);
    const failedAt = now();
    const state = {
      flow: identified,
      code: error?.code || "E006",
      message: String(
        options.message || error?.message || "Bot trả E006 (không thể làm mới token)."
      ),
      source: options.source || error?.source || "unknown",
      failedAt,
      retryAt: failedAt + cooldownMs,
      cooldownMs,
      attempts: (previous?.attempts || 0) + 1
    };

    states.set(identified, state);
    clearTimer(identified);
    schedule(identified, state);
    persist();
    log(
      `E006 [${identified}] ${state.message} ` +
        `→ tạm hoãn ${Math.round(cooldownMs / 60_000)} phút ` +
        `(retry sau ${new Date(state.retryAt).toISOString()}).`
    );
    return { ...state, remainingMs: cooldownMs };
  }

  function isDeferred(flow) {
    const state = states.get(normalizeFlow(flow) || flow);
    if (!state) return false;
    return now() < state.retryAt;
  }

  function remainingMs(flow) {
    const state = states.get(normalizeFlow(flow) || flow);
    if (!state) return 0;
    return Math.max(0, state.retryAt - now());
  }

  function onExpire(flow, callback) {
    const key = normalizeFlow(flow) || flow;
    if (!callbacks.has(key)) callbacks.set(key, new Set());
    callbacks.get(key).add(callback);
    return () => callbacks.get(key)?.delete(callback);
  }

  function reset(flow, reason = "reset") {
    const key = normalizeFlow(flow) || flow;
    clearTimer(key);
    const existed = states.delete(key);
    if (existed) {
      persist();
      log(`E006 [${key}] đã reset cooldown (${reason}).`);
    }
    return existed;
  }

  function snapshot() {
    const at = now();
    return [...states.values()]
      .filter((state) => at < state.retryAt)
      .map((state) => ({
        ...state,
        remainingMs: Math.max(0, state.retryAt - at)
      }));
  }

  function clearAll() {
    for (const flow of [...timers.keys()]) clearTimer(flow);
    states.clear();
    callbacks.clear();
    persist();
  }

  hydrate();

  return {
    cooldownMs,
    defer,
    isDeferred,
    remainingMs,
    onExpire,
    reset,
    snapshot,
    clearAll
  };
}

module.exports = {
  E006_COOLDOWN_MS,
  E006_FLOWS,
  isE006Error,
  identifyE006Flow,
  createE006Cooldown
};
