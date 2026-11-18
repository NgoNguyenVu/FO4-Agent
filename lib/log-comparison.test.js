// Test đối chiếu telegram-chat.log với agent.log.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  parseAgentLog,
  matchControlCommand,
  compareLogs,
  compareLogFiles
} = require("./log-comparison");
const { parseChatLog } = require("./telegram-chat-log");
const { parseArgs, formatMs } = require("../scripts/compare-telegram-log");

function chatEntry(timestamp, direction, content) {
  return {
    at: Date.parse(timestamp),
    timestamp,
    direction,
    content
  };
}

test("parseAgentLog đọc timestamp ISO và nội dung", () => {
  const entries = parseAgentLog(
    [
      "rác không timestamp",
      "[2026-11-18T07:00:00.000Z] Nhận /startagent; bắt đầu chạy.",
      "[2026-11-18T07:00:03.000Z] Agent READY"
    ].join("\n")
  );
  assert.deepEqual(
    entries.map((entry) => entry.message),
    ["Nhận /startagent; bắt đầu chạy.", "Agent READY"]
  );
  assert.equal(entries[0].at, Date.parse("2026-11-18T07:00:00.000Z"));
});

test("matchControlCommand chỉ nhận lệnh điều khiển, bỏ qua /tn và chat thường", () => {
  assert.equal(matchControlCommand("/startagent"), "startagent");
  assert.equal(matchControlCommand("/StopAgent@Nguyenanh_fo4_bot"), "stopagent");
  assert.equal(matchControlCommand("  /resetagent  "), "resetagent");
  assert.equal(matchControlCommand("/tn"), null);
  assert.equal(matchControlCommand("/stopauto"), null);
  assert.equal(matchControlCommand("Bot: đã mua"), null);
});

test("compareLogs đo độ trễ nhận lệnh và xác nhận action khớp", () => {
  const chatEntries = [
    chatEntry("2026-11-18T07:00:00.000Z", "IN", "/startagent"),
    chatEntry("2026-11-18T07:00:00.500Z", "OUT", "Bot: ok"),
    chatEntry("2026-11-18T07:01:00.000Z", "IN", "/stopagent")
  ];
  const agentEntries = parseAgentLog(
    [
      "[2026-11-18T07:00:01.500Z] Nhận /startagent; giữ tối đa 3 task ICON.",
      "[2026-11-18T07:01:02.000Z] Nhận /stopagent trước khi bắt đầu chu kỳ."
    ].join("\n")
  );

  const report = compareLogs({ chatEntries, agentEntries });

  assert.equal(report.commands.length, 2);
  assert.deepEqual(report.commands[0], {
    command: "startagent",
    content: "/startagent",
    sentAt: "2026-11-18T07:00:00.000Z",
    sentAtMs: Date.parse("2026-11-18T07:00:00.000Z"),
    ackAt: "2026-11-18T07:00:01.500Z",
    ackMessage: "Nhận /startagent; giữ tối đa 3 task ICON.",
    latencyMs: 1_500,
    actionAt: "2026-11-18T07:00:01.500Z",
    actionMessage: "Nhận /startagent; giữ tối đa 3 task ICON.",
    actionLatencyMs: 1_500,
    matched: true,
    reason: "ok"
  });
  assert.equal(report.commands[1].latencyMs, 2_000);
  assert.deepEqual(report.summary, {
    total: 2,
    matched: 2,
    unmatched: 0,
    averageLatencyMs: 1_750,
    maxLatencyMs: 2_000
  });
});

test("compareLogs báo chưa nhận khi agent.log không có dòng ack", () => {
  const chatEntries = [
    chatEntry("2026-11-18T07:00:00.000Z", "IN", "/stopagent")
  ];
  const agentEntries = parseAgentLog(
    "[2026-11-18T07:10:00.000Z] Vẫn chờ lệnh điều khiển."
  );
  const report = compareLogs({ chatEntries, agentEntries });

  assert.equal(report.commands[0].reason, "no-ack");
  assert.equal(report.commands[0].matched, false);
  assert.equal(report.commands[0].latencyMs, null);
  assert.equal(report.summary.unmatched, 1);
});

test("compareLogs phân biệt đã nhận nhưng không action (startagent cũ bị bỏ)", () => {
  const chatEntries = [
    chatEntry("2026-11-18T07:00:00.000Z", "IN", "/startagent")
  ];
  const agentEntries = parseAgentLog(
    "[2026-11-18T07:00:05.000Z] Bỏ /startagent cũ còn đọng từ lúc agent đang chạy; chờ lệnh mới."
  );
  const report = compareLogs({ chatEntries, agentEntries });

  assert.equal(report.commands[0].reason, "no-action");
  assert.equal(report.commands[0].latencyMs, 5_000);
  assert.equal(report.commands[0].actionAt, null);
  assert.equal(report.commands[0].matched, false);
});

test("compareLogs không ghép ack của lệnh sau vào lệnh trước", () => {
  const chatEntries = [
    chatEntry("2026-11-18T07:00:00.000Z", "IN", "/startagent"),
    chatEntry("2026-11-18T07:00:10.000Z", "IN", "/stopagent")
  ];
  const agentEntries = parseAgentLog(
    "[2026-11-18T07:00:12.000Z] Nhận /stopagent trước khi bắt đầu chu kỳ."
  );
  const report = compareLogs({ chatEntries, agentEntries });

  assert.equal(report.commands[0].reason, "no-ack");
  assert.equal(report.commands[1].reason, "ok");
  assert.equal(report.commands[1].latencyMs, 2_000);
});

test("compareLogs vẫn tìm ack khi agent.log có timestamp hỏng ở tương lai", () => {
  const chatEntries = [
    chatEntry("2026-11-18T07:00:00.000Z", "IN", "/startagent")
  ];
  const agentEntries = parseAgentLog(
    [
      "[+017259-12-31T17:00:00.000Z] Dòng timestamp hỏng từ log cũ",
      "[2026-11-18T07:00:01.000Z] Nhận /startagent; bắt đầu chạy."
    ].join("\n")
  );
  const report = compareLogs({ chatEntries, agentEntries });

  assert.equal(report.commands[0].matched, true);
  assert.equal(report.commands[0].latencyMs, 1_000);
});

test("parser chấp nhận file có BOM ở dòng đầu", () => {
  const chatEntries = parseChatLog(
    "\uFEFF[2026-11-18T07:00:00.000Z] [Direction: IN] /startagent\n"
  );
  assert.equal(chatEntries.length, 1);
  assert.equal(chatEntries[0].content, "/startagent");
});

test("compareLogs bỏ qua tin OUT và tin IN không phải lệnh điều khiển", () => {  const chatEntries = [
    chatEntry("2026-11-18T07:00:00.000Z", "IN", "/tn"),
    chatEntry("2026-11-18T07:00:01.000Z", "OUT", "Bot: menu"),
    chatEntry("2026-11-18T07:00:02.000Z", "IN", "/stopauto"),
    chatEntry("2026-11-18T07:00:03.000Z", "IN", "/resetagent")
  ];
  const agentEntries = parseAgentLog(
    "[2026-11-18T07:00:04.000Z] Nhận /resetagent; agent về idle ngay."
  );
  const report = compareLogs({ chatEntries, agentEntries });

  assert.deepEqual(report.commands.map((item) => item.command), ["resetagent"]);
  assert.equal(report.commands[0].matched, true);
});

test("compareLogFiles báo lỗi rõ khi thiếu log", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fo4-log-compare-"));
  const missing = path.join(tmpDir, "missing.log");
  assert.throws(
    () => compareLogFiles({ chatLogPath: missing, agentLogPath: missing }),
    (error) => error.code === "CHAT_LOG_MISSING"
  );

  const chatPath = path.join(tmpDir, "telegram-chat.log");
  fs.writeFileSync(
    chatPath,
    "[2026-11-18T07:00:00.000Z] [Direction: IN] /startagent\n",
    "utf8"
  );
  assert.throws(
    () => compareLogFiles({ chatLogPath: chatPath, agentLogPath: missing }),
    (error) => error.code === "AGENT_LOG_MISSING"
  );
});

test("CLI parse args và format độ trễ", () => {
  const options = parseArgs(["--json", "--agent", "a.log", "--chat", "c.log"]);
  assert.equal(options.json, true);
  assert.equal(options.agentLogPath, "a.log");
  assert.equal(options.chatLogPath, "c.log");
  assert.equal(formatMs(null), "-");
  assert.equal(formatMs(450), "450ms");
  assert.equal(formatMs(1_500), "1.50s");
  assert.equal(formatMs(65_000), "65.0s");
});
