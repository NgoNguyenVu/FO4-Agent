const test = require("node:test");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { redactSensitive } = require("./redact");
const { appendChatLine } = require("./telegram-chat-log");

test("redactSensitive hides chatId and the user home directory", () => {
  const home = os.homedir();
  const sample =
    `Đang treo mua cho chatId 1917864682. ` +
    `Stack at ${path.join(home, "Desktop", "FO4-agent", "agent.js")}:12`;
  const redacted = redactSensitive(sample);
  assert.match(redacted, /chatId \*\*\*/);
  assert.doesNotMatch(redacted, /1917864682/);
  assert.match(redacted, /%USERPROFILE%/);
  assert.doesNotMatch(redacted, new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("appendChatLine writes the redacted form to disk", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fo4-redact-log-"));
  const file = path.join(dir, "telegram-chat.log");
  appendChatLine(
    { direction: "OUT", content: "Bot: Đang treo mua cho chatId 123456789" },
    { filePath: file }
  );
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /chatId \*\*\*/);
  assert.doesNotMatch(text, /123456789/);
});
