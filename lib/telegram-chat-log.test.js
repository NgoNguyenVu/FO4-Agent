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
const { createChatTextTracker } = require("./chat-runtime");

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

test("selector bubble dùng chung với luồng đọc tin nhắn hiện tại", () => {
  assert.equal(CHAT_MESSAGE_SELECTOR, '.bubble[role="article"][data-mid]');
});
