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

const AGENT_LINE_RE = /^\[([^\]]+)\]\s?(.*)$/;

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
  matchWindowMs = DEFAULT_MATCH_WINDOW_MS
}) {
  const commands = chatEntries
    .filter((entry) => entry.direction === "IN")
    .map((entry) => ({ entry, command: matchControlCommand(entry.content) }))
    .filter((item) => item.command)
    .sort((a, b) => a.entry.at - b.entry.at);
  // agent.log có thể chứa vài dòng timestamp hỏng (ví dụ "+017259-...") do
  // lỗi đồng hồ cũ. Sắp xếp lại theo thời gian để findFirst dừng đúng chỗ,
  // không bỏ sót ack nằm sau một dòng có timestamp ở tương lai.
  const sortedAgentEntries = [...agentEntries].sort((a, b) => a.at - b.at);

  const report = commands.map(({ entry, command }, index) => {
    const nextAt = commands[index + 1]?.entry.at;
    const untilMs = Math.min(
      entry.at + matchWindowMs,
      nextAt === undefined ? Number.POSITIVE_INFINITY : nextAt
    );
    const rule = COMMAND_RULES[command] || { ack: [], action: [] };
    const ack = findFirst(sortedAgentEntries, entry.at, untilMs, rule.ack);
    const action = findFirst(
      sortedAgentEntries,
      ack ? ack.at : entry.at,
      untilMs,
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
    }
  };
}

function compareLogFiles({
  agentLogPath = logPath,
  chatLogPath = resolveChatLogPath(),
  matchWindowMs = DEFAULT_MATCH_WINDOW_MS
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
      matchWindowMs
    })
  };
}

module.exports = {
  DEFAULT_MATCH_WINDOW_MS,
  COMMAND_RULES,
  parseAgentLog,
  readAgentLog,
  matchControlCommand,
  compareLogs,
  compareLogFiles
};
