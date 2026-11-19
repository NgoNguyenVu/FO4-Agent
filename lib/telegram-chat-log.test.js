// Test ghi log hội thoại Telegram độc lập (telegram-chat.log).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fo4-telegram-chat-"));
process.env.FO4_TELEGRAM_CHAT_LOG = path.join(tmpDir, "telegram-chat.log");

const {
  CHAT_MESSAGE_SELECTOR,
  formatChatLine,
  normalizeContent,
  normalizeDirection,
  appendChatLine,
  logTelegramMessage,
  directionForMessage,
  parseChatLog,
  readChatLog
} = require("./telegram-chat-log");
const {
  createChatTextTracker,
  chatTextReaders,
  reattachChatObserver
} = require("./chat-runtime");

function freshLogPath(name) {
  const filePath = path.join(tmpDir, `${name}-${Date.now()}-${Math.random()}.log`);
  process.env.FO4_TELEGRAM_CHAT_LOG = filePath;
  return filePath;
}

test("formatChatLine dùng đúng [Timestamp] [Direction: IN/OUT] Nội dung", () => {
  assert.equal(
    formatChatLine({
      timestamp: "2026-11-18T07:00:00.000Z",
      direction: "in",
      content: "  /startagent  "
    }),
    "[2026-11-18T07:00:00.000Z] [Direction: IN] /startagent"
  );
  assert.equal(
    formatChatLine({
      timestamp: new Date("2026-11-18T07:00:00.000Z"),
      direction: "OUT",
      content: "Bot: đã mua 1 cầu thủ"
    }),
    "[2026-11-18T07:00:00.000Z] [Direction: OUT] Bot: đã mua 1 cầu thủ"
  );
});

test("normalizeDirection chỉ nhận IN/OUT", () => {
  assert.equal(normalizeDirection("in"), "IN");
  assert.equal(normalizeDirection(" out "), "OUT");
  assert.throws(() => normalizeDirection("BOTH"), /không hợp lệ/);
});

test("normalizeContent gộp xuống dòng và khoảng trắng để mỗi tin là một dòng", () => {
  assert.equal(normalizeContent("Tin  1\nTin\t2\r\nTin 3"), "Tin 1 Tin 2 Tin 3");
  assert.equal(normalizeContent(null), "");
});

test("normalizeContent bỏ icon font và giờ gửi cuối bubble Telegram", () => {
  assert.equal(normalizeContent("/tn \uE9E1 13:05"), "/tn");
  assert.equal(
    normalizeContent("Hệ thống đã tiếp nhận yêu cầu của bạn! 13:05"),
    "Hệ thống đã tiếp nhận yêu cầu của bạn!"
  );
  assert.equal(normalizeContent("13:05"), "13:05");
});

test("appendChatLine ghi file, tạo thư mục và bỏ qua nội dung rỗng", () => {
  const filePath = freshLogPath("append");
  assert.equal(appendChatLine({ direction: "IN", content: "   " }), null);
  assert.equal(fs.existsSync(filePath), false);

  const line = appendChatLine(
    {
      timestamp: "2026-11-18T07:00:00.000Z",
      direction: "OUT",
      content: "Bot\nđã mua"
    },
    { filePath }
  );
  assert.equal(line, "[2026-11-18T07:00:00.000Z] [Direction: OUT] Bot đã mua");
  assert.equal(
    fs.readFileSync(filePath, "utf8"),
    `${line}\n`
  );
});

test("logTelegramMessage + readChatLog đọc lại đúng hướng và nội dung", () => {
  const filePath = freshLogPath("read");
  logTelegramMessage("IN", "/stopagent", { filePath });
  logTelegramMessage("OUT", "Đã dừng worker", { filePath });

  const entries = readChatLog(filePath);
  assert.deepEqual(
    entries.map((entry) => [entry.direction, entry.content]),
    [
      ["IN", "/stopagent"],
      ["OUT", "Đã dừng worker"]
    ]
  );
  assert.equal(entries[0].timestamp, entries[0].at ? new Date(entries[0].at).toISOString() : "");
});

test("parseChatLog bỏ qua dòng sai định dạng và timestamp hỏng", () => {
  const entries = parseChatLog(
    [
      "rác",
      "[không-phải-thời-gian] [Direction: IN] /startagent",
      "[2026-11-18T07:00:00.000Z] [Direction: OUT] Bot trả lời",
      "[2026-11-18T07:00:01.000Z] thiếu direction"
    ].join("\n")
  );
  assert.deepEqual(entries.map((entry) => entry.content), ["Bot trả lời"]);
});

test("logTelegramMessage không ném lỗi khi không ghi được file", () => {
  const directoryPath = fs.mkdtempSync(path.join(tmpDir, "la-thu-muc-"));
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(
      logTelegramMessage("IN", "/startagent", { filePath: directoryPath }),
      null
    );
  } finally {
    console.error = originalError;
  }
});

test("directionForMessage: tin outgoing của tài khoản là IN, tin bot là OUT", () => {
  assert.equal(directionForMessage({ out: true }), "IN");
  assert.equal(directionForMessage({ out: false }), "OUT");
  assert.equal(directionForMessage(null), "OUT");
});

test("tracker ghi tin mới IN/OUT, bỏ qua lịch sử lúc khởi tạo", () => {
  freshLogPath("tracker");
  const tracker = createChatTextTracker("Lịch sử cũ");
  const history = [{ id: "1", text: "Tin cũ", out: false }];

  tracker.publish("Lịch sử cũ", history);
  assert.equal(readChatLog().length, 0, "lần publish đầu chỉ lấy baseline");

  tracker.publish(
    "Lịch sử cũ\n/startagent\nBot: đã bắt đầu",
    [
      ...history,
      { id: "2", text: "/startagent", out: true },
      { id: "3", text: "Bot: đã bắt đầu", out: false }
    ]
  );

  assert.deepEqual(
    readChatLog().map((entry) => [entry.direction, entry.content]),
    [
      ["IN", "/startagent"],
      ["OUT", "Bot: đã bắt đầu"]
    ]
  );

  // Publish lại cùng bubble không được ghi trùng.
  tracker.publish(
    "Lịch sử cũ\n/startagent\nBot: đã bắt đầu",
    [
      ...history,
      { id: "2", text: "/startagent", out: true },
      { id: "3", text: "Bot: đã bắt đầu", out: false }
    ]
  );
  assert.equal(readChatLog().length, 2);
});

test("tracker với baseline id vẫn ghi lệnh mới trong batch đầu tiên", () => {
  freshLogPath("baseline-ids");
  const tracker = createChatTextTracker("Lịch sử cũ", ["1"]);
  tracker.publish(
    "Lịch sử cũ\n/startagent",
    [
      { id: "1", text: "Tin cũ", out: false },
      { id: "2", text: "/startagent", out: true }
    ]
  );

  assert.deepEqual(
    readChatLog().map((entry) => [entry.direction, entry.content]),
    [["IN", "/startagent"]]
  );
});

test("tracker chống trùng tin IN tạm thời nhưng giữ tin OUT", () => {
  freshLogPath("dedupe");
  const tracker = createChatTextTracker("Lịch sử cũ");
  tracker.publish("Lịch sử cũ", [{ id: "1", text: "Tin cũ", out: false }]);

  tracker.publish("Lịch sử cũ\n/stop", [
    { id: "1", text: "Tin cũ", out: false },
    { id: "2", text: "/stop", out: true }
  ]);
  tracker.publish("Lịch sử cũ\n/stop\n/stop", [
    { id: "1", text: "Tin cũ", out: false },
    { id: "2", text: "/stop", out: true },
    { id: "3", text: "/stop", out: true }
  ]);
  tracker.publish("Lịch sử cũ\n/stop\n/stop\nBot: ok\nBot: ok", [
    { id: "1", text: "Tin cũ", out: false },
    { id: "2", text: "/stop", out: true },
    { id: "3", text: "/stop", out: true },
    { id: "4", text: "Bot: ok", out: false },
    { id: "5", text: "Bot: ok", out: false }
  ]);

  assert.deepEqual(
    readChatLog().map((entry) => [entry.direction, entry.content]),
    [
      ["IN", "/stop"],
      ["OUT", "Bot: ok"],
      ["OUT", "Bot: ok"]
    ]
  );
});

test("tracker fallback: vẫn ghi lệnh khi DOM không trả bubble", () => {
  freshLogPath("fallback");
  const tracker = createChatTextTracker("Lịch sử cũ");
  tracker.arm();
  tracker.publish("Lịch sử cũ\n/stopagent");

  assert.deepEqual(
    readChatLog().map((entry) => [entry.direction, entry.content]),
    [["IN", "/stopagent"]]
  );
});

test("tracker vẫn ghi lệnh khi messages có bubble khác nhưng thiếu bubble lệnh", () => {
  // Telegram Web K có lúc cập nhật body text trước khi bubble lệnh kịp có
  // data-mid/nội dung. "Có messages" không được làm mất dòng IN của lệnh.
  freshLogPath("missing-command-bubble");
  const tracker = createChatTextTracker("Lịch sử cũ");
  tracker.arm();
  tracker.publish("Lịch sử cũ", [{ id: "1", text: "Tin cũ", out: false }]);
  assert.equal(readChatLog().length, 0);

  tracker.publish("Lịch sử cũ\n/startagent", [
    { id: "1", text: "Tin cũ", out: false },
    { id: "2", text: "Bot: đã nhận", out: false }
  ]);

  assert.deepEqual(
    readChatLog().map((entry) => [entry.direction, entry.content]),
    [
      ["OUT", "Bot: đã nhận"],
      ["IN", "/startagent"]
    ]
  );
  assert.deepEqual(tracker.takeCommands(), ["startagent"]);
});

test("tracker không ghi trùng lệnh đã có bubble trong messages", () => {
  freshLogPath("command-bubble-no-dup");
  const tracker = createChatTextTracker("Lịch sử cũ");
  tracker.arm();
  tracker.publish("Lịch sử cũ", [{ id: "1", text: "Tin cũ", out: false }]);

  tracker.publish("Lịch sử cũ\n/startagent", [
    { id: "1", text: "Tin cũ", out: false },
    { id: "2", text: "/startagent 08:57", out: true }
  ]);

  assert.deepEqual(
    readChatLog().map((entry) => [entry.direction, entry.content]),
    [["IN", "/startagent"]]
  );
  assert.deepEqual(tracker.takeCommands(), ["startagent"]);
});

test("tracker không ghi trùng khi bubble lệnh xuất hiện ở publish sau fallback", () => {
  // Lần đầu body text đã có lệnh nhưng bubble chưa render -> fallback ghi.
  // Lần sau bubble xuất hiện với data-mid mới -> không được ghi thêm dòng nữa.
  freshLogPath("command-late-bubble");
  const tracker = createChatTextTracker("Lịch sử cũ");
  tracker.arm();
  tracker.publish("Lịch sử cũ", [{ id: "1", text: "Tin cũ", out: false }]);

  tracker.publish("Lịch sử cũ\n/startagent", [
    { id: "1", text: "Tin cũ", out: false }
  ]);
  tracker.publish("Lịch sử cũ\n/startagent", [
    { id: "1", text: "Tin cũ", out: false },
    { id: "2", text: "/startagent 08:57", out: true }
  ]);

  assert.deepEqual(
    readChatLog().map((entry) => [entry.direction, entry.content]),
    [["IN", "/startagent"]]
  );
  assert.deepEqual(tracker.takeCommands(), ["startagent"]);
});

test("re-attach ghi /startagent xuất hiện trong lúc mất observer", async () => {
  freshLogPath("reattach-command");
  const tracker = createChatTextTracker("Lịch sử cũ", ["1"]);
  tracker.binding = "__fo4ChatTextChangedReattachCommand";
  tracker.arm();
  tracker.publish("Lịch sử cũ", [{ id: "1", text: "Tin cũ", out: false }]);
  assert.equal(readChatLog().length, 0);

  const page = {
    evaluate: async (_fn, arg) => {
      if (arg && typeof arg.name === "string") return true; // installObserver
      if (arg && typeof arg.messageSelector === "string") {
        return [
          { id: "1", text: "Tin cũ", out: false },
          { id: "2", text: "/startagent 08:57", out: true }
        ];
      }
      return true; // scrollChatToBottom
    },
    locator: () => ({
      innerText: async () => "Lịch sử cũ\n/startagent 08:57"
    })
  };
  chatTextReaders.set(page, tracker);

  assert.equal(await reattachChatObserver(page), true);
  assert.equal(chatTextReaders.get(page), tracker);
  assert.deepEqual(
    readChatLog().map((entry) => [entry.direction, entry.content]),
    [["IN", "/startagent"]]
  );
});

test("reset không nuốt lệnh nối thêm sau một publish không đổi text", () => {
  freshLogPath("reset-append");
  const tracker = createChatTextTracker("Chat cũ");
  tracker.arm();
  tracker.reset("Chat cũ");
  tracker.publish("Chat cũ"); // text không đổi: không được giữ cờ bỏ quét mãi
  tracker.publish("Chat cũ\n/startagent");

  assert.deepEqual(tracker.takeCommands(), ["startagent"]);
  assert.deepEqual(
    readChatLog().map((entry) => [entry.direction, entry.content]),
    [["IN", "/startagent"]]
  );
});

test("reset bỏ qua lệnh lịch sử khi snapshot thay hẳn nhưng vẫn nhận lệnh mới", () => {
  freshLogPath("reset-snapshot");
  const tracker = createChatTextTracker("Chat cũ");
  tracker.arm();
  tracker.reset("Chats");
  tracker.publish("Lịch sử đầy đủ\n/stopagent");

  assert.deepEqual(tracker.takeCommands(), []);
  assert.equal(readChatLog().length, 0);

  tracker.publish("Lịch sử đầy đủ\n/stopagent\n/startagent");
  assert.deepEqual(tracker.takeCommands(), ["startagent"]);
  assert.deepEqual(
    readChatLog().map((entry) => [entry.direction, entry.content]),
    [["IN", "/startagent"]]
  );
});

test("selector bubble dùng chung với luồng đọc tin nhắn hiện tại", () => {
  assert.equal(CHAT_MESSAGE_SELECTOR, '.bubble[role="article"][data-mid]');
});
