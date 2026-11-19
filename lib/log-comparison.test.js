// Test đối chiếu telegram-chat.log với agent.log.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  parseAgentLog,
  matchControlCommand,
  parseTimeValue,
  latestSessionStartMs,
  aggregateIconStats,
  compareLogs,
  compareLogFiles
} = require("./log-comparison");
const { parseChatLog } = require("./telegram-chat-log");
const {
  parseArgs,
  formatMs,
  formatIconStats
} = require("../scripts/compare-telegram-log");

function chatEntry(timestamp, direction, content) {
  return {
    at: Date.parse(timestamp),
    timestamp,
    direction,
    content
  };
}

function agentEntry(timestamp, message) {
  return {
    at: Date.parse(timestamp),
    timestamp,
    message
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

test("aggregateIconStats đếm đặt mua ICON thành công, gộp bản trùng và cộng số thẻ", () => {
  const successOne =
    "Đã đặt mua thành công 101214101 | 1 | 28,600,000 | 1/1 lúc 2026-11-18 12:07:21.692. " +
    "Không lấy được vị trí mua (E004) 12:07";
  const successTwo =
    "Đã đặt mua thành công 101004000 | 2 | 13,600,000 | 2/2 lúc 2026-11-18 14:17:21.551. " +
    "Vị trí mua: 14 14:17";
  const chatEntries = [
    chatEntry("2026-11-18T06:00:00.000Z", "OUT", successOne),
    chatEntry("2026-11-18T06:00:01.200Z", "OUT", successOne),
    chatEntry("2026-11-18T06:05:00.000Z", "OUT", successTwo),
    chatEntry(
      "2026-11-18T05:59:58.000Z",
      "OUT",
      "Đã lưu DB và chạy lệnh mua cho: 101214101 | 1 | 1"
    ),
    chatEntry(
      "2026-11-18T06:04:58.000Z",
      "OUT",
      "Đã lưu DB và chạy lệnh mua cho: 101004000 | 2 | 1"
    )
  ];

  const stats = aggregateIconStats({ chatEntries, agentEntries: [] });

  assert.equal(stats.purchase.orders, 2);
  assert.equal(stats.purchase.cards, 3);
  assert.equal(stats.purchase.uniquePlayers, 2);
  assert.equal(stats.purchase.requests, 2);
  assert.equal(stats.purchase.requestCards, 3);
  assert.deepEqual(
    stats.purchase.players.map((player) => [player.code, player.events, player.cards]),
    [
      ["101214101", 1, 1],
      ["101004000", 1, 2]
    ]
  );
});

test("aggregateIconStats đếm hủy ICON thành công và bỏ bản ghi trùng sát giờ", () => {
  const agentEntries = [
    agentEntry(
      "2026-11-18T07:00:00.000Z",
      "Đang hủy đơn TTCN 101007512 (orderId abc, grade 1, giá 10.8 M Hủy, vị trí 17)."
    ),
    agentEntry(
      "2026-11-18T07:00:01.000Z",
      "Đã hủy đơn 101007512 (đơn đã biến mất khỏi TTCN)."
    ),
    agentEntry(
      "2026-11-18T07:00:01.500Z",
      "Đã hủy đơn 101007512 (đơn đã biến mất khỏi TTCN)."
    ),
    agentEntry("2026-11-18T07:00:20.000Z", "Đã hủy đơn 101007512 (Hủy thành công)."),
    agentEntry("2026-11-18T07:01:00.000Z", "Đã hủy đơn 101013743 (Hủy thành công).")
  ];

  const stats = aggregateIconStats({ chatEntries: [], agentEntries });

  assert.equal(stats.cancel.orders, 3);
  assert.equal(stats.cancel.cards, 3);
  assert.equal(stats.cancel.uniquePlayers, 2);
});

test("aggregateIconStats tách lượt nâng cấp và số ca đạt +7", () => {
  const agentEntries = [
    agentEntry("2026-11-18T07:00:00.000Z", "Đã bắt đầu nâng cấp Davor Shuker lên +7."),
    agentEntry("2026-11-18T07:01:00.000Z", "Đã bắt đầu nâng cấp Rivaldo lên +7."),
    agentEntry(
      "2026-11-18T08:00:00.000Z",
      "Nâng cấp xong Rivaldo (+3 -> +7): thành công 1/1 (grade cuối 7), lý do: đạt mục tiêu."
    ),
    agentEntry(
      "2026-11-18T08:10:00.000Z",
      "Nâng cấp xong Jamie Carragher (+2 -> +6): thành công 1/1 (grade cuối 6), lý do: đạt mục tiêu."
    )
  ];

  const stats = aggregateIconStats({ chatEntries: [], agentEntries });

  assert.equal(stats.upgrade.attempts, 2);
  assert.equal(stats.upgrade.successes, 1);
  assert.equal(stats.upgrade.uniquePlayers, 1);
  assert.equal(stats.upgrade.players[0].name, "Rivaldo");
});

test("aggregateIconStats lấy lần kiểm tra kho ICON gần nhất kèm chi tiết", () => {
  const agentEntries = [
    agentEntry(
      "2026-11-18T07:00:00.000Z",
      "Kiểm tra kho trước khi chạy: 5 icon (5 còn nâng được, 0 khóa, 0 đã đạt +7)."
    ),
    agentEntry(
      "2026-11-18T08:00:00.000Z",
      "Kiểm tra kho trước khi chạy: 8 icon (7 còn nâng được, 1 khóa, 2 đã đạt +7)."
    )
  ];

  const stats = aggregateIconStats({ chatEntries: [], agentEntries });

  assert.equal(stats.inventory.found, true);
  assert.equal(stats.inventory.at, "2026-11-18T08:00:00.000Z");
  assert.equal(stats.inventory.total, 8);
  assert.equal(stats.inventory.upgradable, 7);
  assert.equal(stats.inventory.locked, 1);
  assert.equal(stats.inventory.reached7, 2);
});

test("aggregateIconStats đọc được dòng kiểm tra kho cũ chỉ có tổng số icon", () => {
  const stats = aggregateIconStats({
    chatEntries: [],
    agentEntries: [
      agentEntry("2026-11-05T01:19:38.107Z", "Kiểm tra kho trước khi chạy: còn 3 icon.")
    ]
  });

  assert.equal(stats.inventory.found, true);
  assert.equal(stats.inventory.total, 3);
  assert.equal(stats.inventory.upgradable, null);
});

test("formatIconStats hiển thị 0 (chưa có) khi chưa ca nào đạt +7", () => {
  const report = {
    range: {},
    iconStats: aggregateIconStats({
      chatEntries: [],
      agentEntries: [
        agentEntry("2026-11-18T07:00:00.000Z", "Đã bắt đầu nâng cấp Davor Shuker lên +7.")
      ]
    })
  };

  const text = formatIconStats(report).join("\n");

  assert.match(text, /Nâng cấp \+7 : 0 \(chưa có\); 1 lượt thử/);
  assert.match(text, /Kho ICON\s+: chưa có dữ liệu kiểm tra kho/);
});

test("formatIconStats in đủ các chỉ số ICON trong bảng text", () => {
  const report = {
    range: {
      since: "2026-11-18T06:00:00.000Z",
      until: null,
      session: false,
      sessionStart: null,
      filtered: true
    },
    iconStats: aggregateIconStats({
      chatEntries: [
        chatEntry(
          "2026-11-18T06:01:00.000Z",
          "OUT",
          "Đã đặt mua thành công 101004000 | 2 | 13,600,000 | 2/2 lúc 2026-11-18 06:01:00.000. Vị trí mua: 1"
        ),
        chatEntry(
          "2026-11-18T06:00:59.000Z",
          "OUT",
          "Đã lưu DB và chạy lệnh mua cho: 101004000 | 2 | 1"
        )
      ],
      agentEntries: [
        agentEntry("2026-11-18T06:30:00.000Z", "Đã hủy đơn 101000001 (Hủy thành công)."),
        agentEntry("2026-11-18T08:00:00.000Z", "Đã bắt đầu nâng cấp Rivaldo lên +7."),
        agentEntry(
          "2026-11-18T08:30:00.000Z",
          "Nâng cấp xong Rivaldo (+3 -> +7): thành công 1/1 (grade cuối 7), lý do: đạt mục tiêu."
        ),
        agentEntry(
          "2026-11-18T08:31:00.000Z",
          "Kiểm tra kho trước khi chạy: 8 icon (7 còn nâng được, 1 khóa, 2 đã đạt +7)."
        )
      ]
    })
  };

  const text = formatIconStats(report).join("\n");

  assert.match(
    text,
    /Đặt mua ICON: 1 lượt thành công \/ 2 thẻ \(1 cầu thủ\); 1 lệnh yêu cầu \/ 2 thẻ/
  );
  assert.match(text, /Hủy ICON\s+: 1 đơn \/ 1 thẻ \(1 cầu thủ\)/);
  assert.match(text, /Nâng cấp \+7 : 1 lượt thành công \/ 1 cầu thủ; 1 lượt thử/);
  assert.match(
    text,
    /Kho ICON\s+: 8 icon tại 2026-11-18 08:31:00 UTC \(7 còn nâng được, 1 khóa, 2 đã đạt \+7\)/
  );
  assert.match(text, /Phạm vi\s+: từ 2026-11-18 06:00:00 UTC đến cuối log/);
});

test("compareLogs lọc thống kê theo phiên /startagent gần nhất", () => {
  const purchase = (code, clock) =>
    `Đã đặt mua thành công ${code} | 1 | 10,000,000 | 1/1 lúc 2026-11-18 ${clock}. ` +
    "Vị trí mua: 1";
  const chatEntries = [
    chatEntry("2026-11-18T06:00:00.000Z", "IN", "/startagent"),
    chatEntry("2026-11-18T06:01:00.000Z", "OUT", purchase("101214101", "06:01:00.000")),
    chatEntry("2026-11-18T08:00:00.000Z", "IN", "/startagent"),
    chatEntry("2026-11-18T08:01:00.000Z", "OUT", purchase("101004000", "08:01:00.000"))
  ];

  const report = compareLogs({ chatEntries, agentEntries: [], session: true });

  assert.equal(latestSessionStartMs(chatEntries), Date.parse("2026-11-18T08:00:00.000Z"));
  assert.equal(report.range.session, true);
  assert.equal(report.range.sessionStart, "2026-11-18T08:00:00.000Z");
  assert.equal(report.range.since, "2026-11-18T08:00:00.000Z");
  assert.equal(report.iconStats.purchase.orders, 1);
  assert.equal(report.iconStats.purchase.players[0].code, "101004000");
});

test("compareLogs lọc thống kê theo khoảng sinceMs/untilMs", () => {
  const agentEntries = [
    agentEntry("2026-11-18T06:30:00.000Z", "Đã hủy đơn 101000001 (Hủy thành công)."),
    agentEntry("2026-11-18T07:30:00.000Z", "Đã hủy đơn 101000002 (Hủy thành công)."),
    agentEntry("2026-11-18T09:00:00.000Z", "Đã hủy đơn 101000003 (Hủy thành công).")
  ];

  const report = compareLogs({
    chatEntries: [],
    agentEntries,
    sinceMs: Date.parse("2026-11-18T07:00:00.000Z"),
    untilMs: Date.parse("2026-11-18T08:00:00.000Z")
  });

  assert.equal(report.range.since, "2026-11-18T07:00:00.000Z");
  assert.equal(report.range.until, "2026-11-18T08:00:00.000Z");
  assert.equal(report.iconStats.cancel.orders, 1);
  assert.equal(report.iconStats.cancel.players[0].code, "101000002");
});

test("compareLogFiles trả iconStats và lọc theo phiên", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fo4-log-compare-stats-"));
  const chatPath = path.join(tmpDir, "telegram-chat.log");
  const agentPath = path.join(tmpDir, "agent.log");
  fs.writeFileSync(
    chatPath,
    [
      "[2026-11-18T06:00:00.000Z] [Direction: IN] /startagent",
      "[2026-11-18T06:01:00.000Z] [Direction: OUT] Đã đặt mua thành công 101214101 | 1 | 10,000,000 | 1/1 lúc 2026-11-18 06:01:00.000. Vị trí mua: 1",
      "[2026-11-18T08:00:00.000Z] [Direction: IN] /startagent",
      "[2026-11-18T08:01:00.000Z] [Direction: OUT] Đã đặt mua thành công 101004000 | 2 | 10,000,000 | 2/2 lúc 2026-11-18 08:01:00.000. Vị trí mua: 2"
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    agentPath,
    [
      "[2026-11-18T06:30:00.000Z] Đã hủy đơn 101000001 (Hủy thành công).",
      "[2026-11-18T08:30:00.000Z] Nâng cấp xong Rivaldo (+3 -> +7): thành công 1/1 (grade cuối 7), lý do: đạt mục tiêu.",
      "[2026-11-18T08:31:00.000Z] Kiểm tra kho trước khi chạy: 6 icon (6 còn nâng được, 0 khóa, 0 đã đạt +7)."
    ].join("\n"),
    "utf8"
  );

  const report = compareLogFiles({
    chatLogPath: chatPath,
    agentLogPath: agentPath,
    session: true
  });

  assert.equal(report.iconStats.purchase.orders, 1);
  assert.equal(report.iconStats.purchase.cards, 2);
  assert.equal(report.iconStats.cancel.orders, 0);
  assert.equal(report.iconStats.upgrade.successes, 1);
  assert.equal(report.iconStats.inventory.total, 6);
});

test("CLI parse --session/--since/--until và parse thời gian", () => {
  const options = parseArgs([
    "--session",
    "--since",
    "2026-11-18 00:00:00",
    "--until",
    "2026-11-19"
  ]);

  assert.equal(options.session, true);
  assert.equal(options.sinceMs, new Date(2026, 10, 18, 0, 0, 0).getTime());
  assert.equal(options.untilMs, new Date(2026, 10, 19).getTime());
  assert.equal(parseTimeValue("2026-11-19"), new Date(2026, 10, 19).getTime());
  assert.throws(() => parseTimeValue("không-phải-ngày"), /Không đọc được thời gian/);
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
