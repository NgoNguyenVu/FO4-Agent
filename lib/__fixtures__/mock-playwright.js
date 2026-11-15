// Mock adapter Playwright cho integration test (TASK-045).
//
// Không mô phỏng toàn bộ DOM/Chromium: chỉ cung cấp đúng bề mặt API mà các
// module buy/icon-buy thực sự gọi (locator, evaluate, keyboard, waitForTimeout,
// goto/reload). Nhờ vậy test chạy được state machine thật (worker registry,
// chat observer, parser bot) mà không cần Telegram/Playwright thật trong CI.
//
// Quy ước: mọi hành vi "DOM" do test điều khiển qua `state`; adapter không tự
// bịa nội dung chat. Nội dung chat do mock-telegram.js bơm vào.
"use strict";

const DEFAULT_URL = "https://web.telegram.org/k/#@Nguyenanh_fo4_bot";
const MESSAGE_SELECTOR = '.bubble[role="article"][data-mid]';
const COMPOSER_SELECTORS = new Set([
  '[contenteditable="true"][data-placeholder="Message"]',
  '[contenteditable="true"][aria-label*="Message" i]',
  "#editable-message-text",
  ".input-message-input[contenteditable=true]",
  '[role="textbox"][contenteditable="true"]',
  'textarea[placeholder*="Message" i]',
  'input[placeholder*="Message" i]',
  '[contenteditable="true"]'
]);

function matchesText(text, matcher) {
  if (!matcher) return true;
  if (matcher instanceof RegExp) return matcher.test(text);
  return String(text).includes(String(matcher));
}

// Telegram dùng cả selector đơn và selector gộp (nhiều dấu phẩy). Kiểm tra
// từng phần để isComposerVisible() thấy đúng ô nhập.
function isComposerSelector(selector) {
  if (COMPOSER_SELECTORS.has(selector)) return true;
  return String(selector)
    .split(",")
    .map((part) => part.trim())
    .some((part) => COMPOSER_SELECTORS.has(part));
}

function element({
  text = "",
  visible = true,
  value = "",
  onClick = null,
  children = null,
  onSubmit = null
} = {}) {
  return { text, visible, value, onClick, children, onSubmit };
}

function createMockLocator(resolve) {
  const locator = {
    count: async () => resolve().length,
    nth(index) {
      return createMockLocator(() => {
        const items = resolve();
        return index < 0 ? items.slice(index, index + 1) : items.slice(index, index + 1);
      });
    },
    first() {
      return createMockLocator(() => resolve().slice(0, 1));
    },
    last() {
      return createMockLocator(() => {
        const items = resolve();
        return items.slice(-1);
      });
    },
    async isVisible() {
      return resolve().some((item) => item.visible !== false);
    },
    async innerText() {
      return resolve()
        .map((item) => item.text || "")
        .join("\n");
    },
    async fill(value) {
      const item = resolve()[0];
      if (!item) throw new Error("mock locator: không có phần tử để fill.");
      item.value = value;
      return undefined;
    },
    async press(key) {
      const item = resolve()[0];
      if (!item) throw new Error("mock locator: không có phần tử để press.");
      if (key === "Enter" && typeof item.onSubmit === "function") {
        await item.onSubmit(item.value || "");
      }
      return undefined;
    },
    async click() {
      const item = resolve()[0];
      if (!item) throw new Error("mock locator: không có phần tử để click.");
      if (typeof item.onClick === "function") item.onClick();
      return undefined;
    },
    filter({ hasText } = {}) {
      return createMockLocator(() => resolve().filter((item) => matchesText(item.text, hasText)));
    },
    locator(selector) {
      return createMockLocator(() => {
        const items = resolve();
        if (selector === ".reply-markup-button") {
          return items.flatMap((item) => (item.children ? item.children() : []));
        }
        return [];
      });
    },
    async evaluateAll(fn) {
      const items = resolve();
      // Test chỉ cần text của button; không chạy DOM thật.
      return items.map((item) => String(item.text || ""));
    },
    async evaluate(fn) {
      const items = resolve();
      return items.map((item) => String(item.text || ""));
    },
    contentFrame() {
      return createMockLocator(() => []);
    },
    async all() {
      return resolve();
    }
  };
  return locator;
}

function createMockPage({
  url = DEFAULT_URL,
  bodyText = "",
  messages = [],
  composerVisible = true,
  botTitle = "BOT-TTCN-FO4"
} = {}) {
  const state = {
    url,
    bodyText,
    messages,
    composerVisible,
    botTitle,
    tipsVisible: true,
    submitHandler: null,
    reloadCount: 0,
    gotoCalls: []
  };

  // Composer phải là một phần tử ổn định: code thật fill() rồi press("Enter")
  // trên cùng locator, nếu mỗi lần resolve tạo object mới thì value bị mất.
  const composerElement = element({
    text: "",
    value: "",
    onSubmit: (value) =>
      typeof state.submitHandler === "function"
        ? state.submitHandler(value)
        : undefined
  });

  const page = {
    __state: state,
    __setBodyText(text) {
      state.bodyText = String(text);
    },
    __setMessages(list) {
      state.messages = Array.isArray(list) ? list : [];
    },
    __setComposerVisible(visible) {
      state.composerVisible = Boolean(visible);
    },
    __setSubmitHandler(handler) {
      state.submitHandler = handler;
    },
    url() {
      return state.url;
    },
    async goto(target) {
      state.gotoCalls.push(target);
      state.url = target;
      return null;
    },
    async reload() {
      state.reloadCount += 1;
      return null;
    },
    async waitForTimeout() {
      // Test không cần thời gian thật; trả quyền ngay để suite chạy nhanh.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    keyboard: {
      async press() {
        return undefined;
      },
      async type() {
        return undefined;
      }
    },
    async exposeFunction() {
      return undefined;
    },
    async evaluate(fn, arg) {
      // readChatMessages: page.evaluate(selector => ..., MESSAGE_SELECTOR)
      if (arg === MESSAGE_SELECTOR) {
        return state.messages.map((message) => ({
          id: String(message.id),
          text: String(message.text || "")
        }));
      }
      // scrollChatToBottom và các evaluate không tham số: coi như không có vùng
      // cuộn (test không mô phỏng layout).
      return false;
    },
    locator(selector) {
      if (selector === "body") {
        return createMockLocator(() => [element({ text: state.bodyText })]);
      }
      if (isComposerSelector(selector)) {
        return createMockLocator(() =>
          state.composerVisible ? [composerElement] : []
        );
      }
      if (/peer-title/.test(selector)) {
        return createMockLocator(() => [element({ text: state.botTitle })]);
      }
      if (/chatlist/.test(selector)) {
        return createMockLocator(() => []);
      }
      const bubbleMatch = selector.match(/\.bubble\[data-mid="([^"]+)"\]/);
      if (bubbleMatch) {
        const id = bubbleMatch[1];
        return createMockLocator(() => {
          const message = state.messages.find((item) => String(item.id) === id);
          if (!message) return [];
          return [
            element({
              text: message.text,
              children: () =>
                (message.buttons || []).map((text) => element({ text }))
            })
          ];
        });
      }
      return createMockLocator(() => []);
    },
    getByRole(role, { name } = {}) {
      if (role === "button" && state.tipsVisible && matchesText("Next Tip", name)) {
        return createMockLocator(() => [
          element({
            text: "Next Tip",
            onClick: () => {
              state.tipsVisible = false;
            }
          })
        ]);
      }
      return createMockLocator(() => []);
    },
    on() {},
    off() {},
    removeListener() {},
    isClosed() {
      return false;
    },
    context() {
      return { newPage: async () => page };
    }
  };

  return { page, state };
}

module.exports = { createMockPage, createMockLocator, DEFAULT_URL, MESSAGE_SELECTOR };
