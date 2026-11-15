// Mock adapter Telegram cho integration test (TASK-045).
//
// Ghép mock page (mock-playwright.js) với chat tracker thật
// (lib/chat-observer qua lib/chat-runtime) để mô phỏng hội thoại bot:
//
//   const { page } = createMockPage();
//   const tg = createMockTelegram({ page, initialText: "history" });
//   tg.replyTo("/stop", "E003: Hiện không có lệnh nào đang chạy.");
//   // Khi code gọi composer.press("Enter"), adapter tự publish reply.
//
// Nhờ vậy test đi qua đúng chatTextReaders/waitForChatChange thật, không mock
// parser hay state machine.
"use strict";

const { createChatTextTracker } = require("../chat-runtime");
const { chatTextReaders } = require("../chat-state");

function createMockTelegram({ page, initialText = "" } = {}) {
  if (!page || !page.__state) {
    throw new TypeError("createMockTelegram cần page từ createMockPage().");
  }
  const tracker = createChatTextTracker(initialText);
  chatTextReaders.set(page, tracker);
  page.__setBodyText(initialText);

  const sent = [];
  const replies = new Map();

  function text() {
    return tracker.snapshot().text;
  }

  function publish(nextText) {
    tracker.publish(String(nextText));
    page.__setBodyText(tracker.snapshot().text);
  }

  function append(line) {
    const current = text();
    publish(current ? `${current}\n${line}` : String(line));
  }

  page.__setSubmitHandler((value) => {
    const command = String(value || "").trim();
    sent.push(command);
    const reply = replies.get(command);
    if (reply === undefined) return;
    const resolved = typeof reply === "function" ? reply({ command, text: text() }) : reply;
    if (resolved === null || resolved === undefined) return;
    append(resolved);
  });

  return {
    tracker,
    sent,
    text,
    publish,
    append,
    // Trả lời cố định cho một lệnh (gửi qua composer rồi Enter).
    replyTo(command, reply) {
      replies.set(String(command).trim(), reply);
    },
    clearReplies() {
      replies.clear();
    }
  };
}

module.exports = { createMockTelegram };
