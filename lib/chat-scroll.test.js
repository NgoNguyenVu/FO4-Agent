const test = require("node:test");
const assert = require("node:assert/strict");
const { scrollChatToBottom, clearScrollCache } = require("./chat-scroll");

test("scrollChatToBottom caches the result within a short tick", async () => {
  clearScrollCache();
  let calls = 0;
  const page = {
    evaluate: async () => {
      calls += 1;
      return true;
    }
  };
  assert.equal(await scrollChatToBottom(page), true);
  assert.equal(await scrollChatToBottom(page), true);
  assert.equal(calls, 1, "hai lần gọi trong cùng tick chỉ evaluate một lần");
});
