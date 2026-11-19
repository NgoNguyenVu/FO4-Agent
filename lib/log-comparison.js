// Đối chiếu telegram-chat.log với agent.log để trả lời:
//   - User gửi lệnh Telegram lúc nào?
//   - Agent nhận ra lệnh sau bao lâu (dòng "Nhận /..." trong agent.log)?
//   - Hành động tương ứng có thật sự xảy ra không?
//
// Chỉ ghép các tin IN là lệnh điều khiển (/startagent, /stopagent,
// /resetagent). Tin IN khác (agent tự gửi /tn, /stopauto...) và mọi tin OUT
// (bot trả lời) được giữ trong log nhưng không tham gia đối chiếu.
const fs = require("node:fs");
const { CONTROL_COMMAND_NAMES } = require("./control-commands");
const { logPath } = require("./log-paths");
const { resolveChatLogPath, readChatLog } = require("./telegram-chat-log");
const DEFAULT_MATCH_WINDOW_MS = 10 * 60 * 1000;

// Chat observer có thể ghi trùng một bubble (đặc biệt sau khi re-attach) nên
// các dòng xác nhận mua được gộp theo nội dung trong một cửa sổ đủ rộng.
const PURCHASE_DEDUPE_WINDOW_MS = 5 * 60 * 1000;
// agent.log gần như không bị ghi trùng; cửa sổ ngắn chỉ để chống nhiễu.
const SHORT_EVENT_DEDUPE_WINDOW_MS = 2 * 1000;

const AGENT_LINE_RE = /^\[([^\]]+)\]\s?(.*)$/;

const PURCHASE_SUCCESS_RE = /^Đã đặt mua thành công\s+(\d+)\s*\|\s*(\d+)\s*\|/u;
const PURCHASE_REQUEST_RE = /^Đã lưu DB và chạy lệnh mua cho:\s*(\d+)\s*\|\s*(\d+)/u;
const CANCEL_SUCCESS_RE = /^Đã hủy đơn\s+(\d+)\s*\(/u;
const UPGRADE_ATTEMPT_RE = /^Đã bắt đầu nâng cấp\s+(.+?)\s+lên\s+\+7\b/u;
const UPGRADE_RESULT_RE = /^Nâng cấp xong\s+(.+?)\s+\(\+\d+\s*->\s*\+7\):\s*(.*)$/u;
const UPGRADE_REACHED_RE = /\bgrade cuối\s+7\b/u;
const INVENTORY_DETAILED_RE =
  /^Kiểm tra kho trước khi chạy:\s*(\d+)\s+icon\s*\((\d+)\s+còn nâng được,\s*(\d+)\s+khóa,\s*(\d+)\s+đã đạt \+7\)/iu;
const INVENTORY_SIMPLE_RE = /^Kiểm tra kho trước khi chạy:\s*còn\s+(\d+)\s+icon/iu;

const COMMAND_RULES = Object.freeze({
  startagent: {
    ack: [/Nhận \/startagent\b/i, /Bỏ \/startagent\b/i],
    action: [/Nhận \/startagent\b/i]
  },
  stopagent: {
    ack: [
      /Nhận \/stopagent\b/i,
      /gửi lệnh dừng theo \/stopagent\b/i,
      /Đã dừng worker Mua phôi\b/i,
      /Worker mua đã dừng\b/i,
      /Không có worker Mua phôi do agent quản lý\b/i,
      /Agent đã dừng theo \/stopagent\b/i,
      /Đã dừng nâng cấp theo \/stopagent\b/i
    ],
    action: [
      /Nhận \/stopagent\b/i,
      /Đã dừng worker Mua phôi\b/i,
      /Worker mua đã dừng\b/i,
      /Không có worker Mua phôi do agent quản lý\b/i,
      /Agent đã dừng theo \/stopagent\b/i,
      /Đã dừng nâng cấp theo \/stopagent\b/i
    ]
  },
  resetagent: {
    ack: [/Nhận \/resetagent\b/i],
    action: [
      /Nhận \/resetagent\b/i,
      /agent về idle ngay\b/i,
      /Đã mở lại Telegram Web\b/i
    ]
  }
});

const CONTROL_COMMAND_RE = new RegExp(
  `(?:^|\\s)\\/(${CONTROL_COMMAND_NAMES.join("|")})(?:@\\w+)?(?![a-z0-9_])`,
  "i"
);

function parseAgentLog(text) {
  const entries = [];
  for (const line of String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = AGENT_LINE_RE.exec(line);
    if (!match) continue;
    const at = Date.parse(match[1]);
    if (Number.isNaN(at)) continue;
    entries.push({
      at,
      timestamp: new Date(at).toISOString(),
      message: match[2].trim()
    });
  }
  return entries;
}

function readAgentLog(filePath = logPath) {
  if (!fs.existsSync(filePath)) return [];
  return parseAgentLog(fs.readFileSync(filePath, "utf8"));
}

function matchControlCommand(content) {
  const match = CONTROL_COMMAND_RE.exec(String(content || ""));
  return match ? match[1].toLowerCase() : null;
}

// Nhận mốc thời gian từ CLI. Chuỗi chỉ có ngày (YYYY-MM-DD) được hiểu là
// 00:00 giờ máy; chuỗi không kèm múi giờ cũng hiểu theo giờ máy.
function parseTimeValue(value, label = "thời gian") {
  if (value instanceof Date) {
    const at = value.getTime();
    if (Number.isNaN(at)) throw new Error(`Giá trị ${label} không hợp lệ.`);
    return at;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Giá trị ${label} không hợp lệ.`);
    return value;
  }
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Giá trị ${label} rỗng.`);
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text);
  if (dateOnly) {
    return new Date(
      Number(dateOnly[1]),
      Number(dateOnly[2]) - 1,
      Number(dateOnly[3])
    ).getTime();
  }
  const at = Date.parse(text);
  if (Number.isNaN(at)) {
    throw new Error(
      `Không đọc được ${label}: ${value}. Dùng ISO hoặc "YYYY-MM-DD HH:mm:ss".`
    );
  }
  return at;
}

function latestSessionStartMs(chatEntries) {
  let latest = null;
  for (const entry of chatEntries) {
    if (entry.direction !== "IN") continue;
    if (matchControlCommand(entry.content) !== "startagent") continue;
    if (latest === null || entry.at > latest) latest = entry.at;
  }
  return latest;
}

// `--session` lấy mốc /startagent gần nhất; nếu đồng thời có --since thì dùng
// mốc muộn hơn để không vô tình mở rộng phạm vi.
function resolveRange(chatEntries, { sinceMs = null, untilMs = null, session = false } = {}) {
  const sessionStartMs = session ? latestSessionStartMs(chatEntries) : null;
  let start = sinceMs ?? null;
  if (sessionStartMs !== null && (start === null || sessionStartMs > start)) {
    start = sessionStartMs;
  }
  return {
    sinceMs: start,
    untilMs: untilMs ?? null,
    session: Boolean(session),
    sessionStartMs
  };
}

function isWithinRange(at, sinceMs, untilMs) {
  if (sinceMs !== null && at < sinceMs) return false;
  if (untilMs !== null && at > untilMs) return false;
  return true;
}

function normalizeEventKey(content) {
  return String(content ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+\d{1,2}:\d{2}$/u, "")
    .trim();
}

function dedupeEvents(events, windowMs) {
  const result = [];
  const lastAtByKey = new Map();
  for (const event of events) {
    const previous = lastAtByKey.get(event.key);
    if (previous !== undefined && event.at - previous <= windowMs) continue;
    lastAtByKey.set(event.key, event.at);
    result.push(event);
  }
  return result;
}

function sumCards(events) {
  return events.reduce((sum, event) => sum + event.cards, 0);
}

function groupByPlayer(events, keyField) {
  const groups = new Map();
  for (const event of events) {
    const key = event[keyField];
    const current = groups.get(key) || {
      [keyField]: key,
      events: 0,
      cards: 0,
      firstAt: event.timestamp,
      lastAt: event.timestamp
    };
    current.events += 1;
    current.cards += event.cards || 0;
    current.lastAt = event.timestamp;
    groups.set(key, current);
  }
  return [...groups.values()];
}

// Tổng hợp hiệu suất ICON & nâng cấp từ hai log. Nhận vào entries đã parse để
// dễ test và để compareLogs/compareLogFiles dùng chung.
function aggregateIconStats({
  chatEntries = [],
  agentEntries = [],
  sinceMs = null,
  untilMs = null
} = {}) {
  const chat = chatEntries
    .filter((entry) => isWithinRange(entry.at, sinceMs, untilMs))
    .sort((a, b) => a.at - b.at);
  const agent = agentEntries
    .filter((entry) => isWithinRange(entry.at, sinceMs, untilMs))
    .sort((a, b) => a.at - b.at);

  const purchaseEvents = [];
  const requestEvents = [];
  for (const entry of chat) {
    const purchase = PURCHASE_SUCCESS_RE.exec(entry.content);
    if (purchase) {
      purchaseEvents.push({
        at: entry.at,
        timestamp: entry.timestamp,
        code: purchase[1],
        cards: Number(purchase[2]),
        key: normalizeEventKey(entry.content)
      });
      continue;
    }
    const request = PURCHASE_REQUEST_RE.exec(entry.content);
    if (request) {
      requestEvents.push({
        at: entry.at,
        timestamp: entry.timestamp,
        code: request[1],
        cards: Number(request[2]),
        key: normalizeEventKey(entry.content)
      });
    }
  }

  const cancelEvents = [];
  const attemptEvents = [];
  const successEvents = [];
  let inventory = null;
  for (const entry of agent) {
    const cancel = CANCEL_SUCCESS_RE.exec(entry.message);
    if (cancel) {
      cancelEvents.push({
        at: entry.at,
        timestamp: entry.timestamp,
        code: cancel[1],
        cards: 1,
        key: normalizeEventKey(entry.message)
      });
      continue;
    }
    const attempt = UPGRADE_ATTEMPT_RE.exec(entry.message);
    if (attempt) {
      attemptEvents.push({
        at: entry.at,
        timestamp: entry.timestamp,
        name: attempt[1].trim(),
        key: normalizeEventKey(entry.message)
      });
      continue;
    }
    const result = UPGRADE_RESULT_RE.exec(entry.message);
    if (result) {
      if (!UPGRADE_REACHED_RE.test(entry.message)) continue;
      successEvents.push({
        at: entry.at,
        timestamp: entry.timestamp,
        name: result[1].trim(),
        key: normalizeEventKey(entry.message)
      });
      continue;
    }
    const detailed = INVENTORY_DETAILED_RE.exec(entry.message);
    if (detailed) {
      inventory = {
        found: true,
        at: entry.timestamp,
        atMs: entry.at,
        total: Number(detailed[1]),
        upgradable: Number(detailed[2]),
        locked: Number(detailed[3]),
        reached7: Number(detailed[4]),
        message: entry.message
      };
      continue;
    }
    const simple = INVENTORY_SIMPLE_RE.exec(entry.message);
    if (simple) {
      inventory = {
        found: true,
        at: entry.timestamp,
        atMs: entry.at,
        total: Number(simple[1]),
        upgradable: null,
        locked: null,
        reached7: null,
        message: entry.message
      };
    }
  }

  const purchases = dedupeEvents(purchaseEvents, PURCHASE_DEDUPE_WINDOW_MS);
  const requests = dedupeEvents(requestEvents, SHORT_EVENT_DEDUPE_WINDOW_MS);
  const cancels = dedupeEvents(cancelEvents, SHORT_EVENT_DEDUPE_WINDOW_MS);
  const attempts = dedupeEvents(attemptEvents, SHORT_EVENT_DEDUPE_WINDOW_MS);
  const successes = dedupeEvents(successEvents, SHORT_EVENT_DEDUPE_WINDOW_MS);

  const purchasePlayers = groupByPlayer(purchases, "code");
  const cancelPlayers = groupByPlayer(cancels, "code");
  const upgradePlayers = groupByPlayer(successes, "name");

  return {
    purchase: {
      orders: purchases.length,
      cards: sumCards(purchases),
      uniquePlayers: purchasePlayers.length,
      requests: requests.length,
      requestCards: sumCards(requests),
      players: purchasePlayers
    },
    cancel: {
      orders: cancels.length,
      cards: cancels.length,
      uniquePlayers: cancelPlayers.length,
      players: cancelPlayers
    },
    upgrade: {
      attempts: attempts.length,
      successes: successes.length,
      uniquePlayers: upgradePlayers.length,
      players: upgradePlayers
    },
    inventory: inventory || {
      found: false,
      at: null,
      atMs: null,
      total: null,
      upgradable: null,
      locked: null,
      reached7: null,
      message: null
    }
  };
}

function findFirst(entries, fromMs, untilMs, patterns) {
  for (const entry of entries) {
    if (entry.at < fromMs) continue;
    if (entry.at > untilMs) break;
    if (patterns.some((pattern) => pattern.test(entry.message))) return entry;
  }
  return null;
}

function average(values) {
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

// Gộp toàn bộ log thành báo cáo đối chiếu. `untilMs` của mỗi lệnh bị chặn bởi
// lệnh điều khiển kế tiếp để một lệnh không "ăn" nhầm phản hồi của lệnh sau.
function compareLogs({
  chatEntries,
  agentEntries,
  matchWindowMs = DEFAULT_MATCH_WINDOW_MS,
  sinceMs = null,
  untilMs = null,
  session = false
}) {
  const range = resolveRange(chatEntries, { sinceMs, untilMs, session });
  const rangedChatEntries = chatEntries.filter((entry) =>
    isWithinRange(entry.at, range.sinceMs, range.untilMs)
  );
  const rangedAgentEntries = agentEntries.filter((entry) =>
    isWithinRange(entry.at, range.sinceMs, range.untilMs)
  );
  const commands = rangedChatEntries
    .filter((entry) => entry.direction === "IN")
    .map((entry) => ({ entry, command: matchControlCommand(entry.content) }))
    .filter((item) => item.command)
    .sort((a, b) => a.entry.at - b.entry.at);
  // agent.log có thể chứa vài dòng timestamp hỏng (ví dụ "+017259-...") do
  // lỗi đồng hồ cũ. Sắp xếp lại theo thời gian để findFirst dừng đúng chỗ,
  // không bỏ sót ack nằm sau một dòng có timestamp ở tương lai.
  const sortedAgentEntries = [...rangedAgentEntries].sort((a, b) => a.at - b.at);

  const report = commands.map(({ entry, command }, index) => {
    const nextAt = commands[index + 1]?.entry.at;
    const untilMsForCommand = Math.min(
      entry.at + matchWindowMs,
      nextAt === undefined ? Number.POSITIVE_INFINITY : nextAt
    );
    const rule = COMMAND_RULES[command] || { ack: [], action: [] };
    const ack = findFirst(sortedAgentEntries, entry.at, untilMsForCommand, rule.ack);
    const action = findFirst(
      sortedAgentEntries,
      ack ? ack.at : entry.at,
      untilMsForCommand,
      rule.action
    );
    return {
      command,
      content: entry.content,
      sentAt: entry.timestamp,
      sentAtMs: entry.at,
      ackAt: ack ? ack.timestamp : null,
      ackMessage: ack ? ack.message : null,
      latencyMs: ack ? ack.at - entry.at : null,
      actionAt: action ? action.timestamp : null,
      actionMessage: action ? action.message : null,
      actionLatencyMs: action ? action.at - entry.at : null,
      matched: Boolean(ack && action),
      reason: !ack ? "no-ack" : !action ? "no-action" : "ok"
    };
  });

  const latencies = report
    .map((item) => item.latencyMs)
    .filter((value) => value !== null);
  return {
    commands: report,
    summary: {
      total: report.length,
      matched: report.filter((item) => item.matched).length,
      unmatched: report.filter((item) => !item.matched).length,
      averageLatencyMs: average(latencies),
      maxLatencyMs: latencies.length ? Math.max(...latencies) : null
    },
    range: {
      since: range.sinceMs === null ? null : new Date(range.sinceMs).toISOString(),
      until: range.untilMs === null ? null : new Date(range.untilMs).toISOString(),
      session: range.session,
      sessionStart:
        range.sessionStartMs === null ? null : new Date(range.sessionStartMs).toISOString(),
      filtered: range.sinceMs !== null || range.untilMs !== null
    },
    iconStats: aggregateIconStats({
      chatEntries,
      agentEntries,
      sinceMs: range.sinceMs,
      untilMs: range.untilMs
    })
  };
}

function compareLogFiles({
  agentLogPath = logPath,
  chatLogPath = resolveChatLogPath(),
  matchWindowMs = DEFAULT_MATCH_WINDOW_MS,
  sinceMs = null,
  untilMs = null,
  session = false
} = {}) {
  if (!fs.existsSync(chatLogPath)) {
    const error = new Error(
      `Không tìm thấy telegram-chat.log tại ${chatLogPath}. ` +
        "Chạy agent ít nhất một lần để bắt đầu ghi log hội thoại."
    );
    error.code = "CHAT_LOG_MISSING";
    throw error;
  }
  if (!fs.existsSync(agentLogPath)) {
    const error = new Error(`Không tìm thấy agent.log tại ${agentLogPath}.`);
    error.code = "AGENT_LOG_MISSING";
    throw error;
  }
  return {
    agentLogPath,
    chatLogPath,
    ...compareLogs({
      chatEntries: readChatLog(chatLogPath),
      agentEntries: readAgentLog(agentLogPath),
      matchWindowMs,
      sinceMs,
      untilMs,
      session
    })
  };
}

module.exports = {
  DEFAULT_MATCH_WINDOW_MS,
  PURCHASE_DEDUPE_WINDOW_MS,
  SHORT_EVENT_DEDUPE_WINDOW_MS,
  COMMAND_RULES,
  parseAgentLog,
  readAgentLog,
  matchControlCommand,
  parseTimeValue,
  latestSessionStartMs,
  resolveRange,
  aggregateIconStats,
  compareLogs,
  compareLogFiles
};
