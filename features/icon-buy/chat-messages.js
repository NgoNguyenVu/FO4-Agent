// Đọc tin nhắn mới theo DOM của Telegram Web.
// Lý do: chat dài có thể bị Telegram cắt phần đầu (trim) làm mốc text cũ biến
// mất. Khi đó getFreshSince() không tìm được anchor và trả null, dù bot đã gửi
// kết quả tra cứu/log đặt mua mới. Message id (data-mid) không bị đổi khi trim,
// nên chỉ cần so với tập id đã thấy trước đó.
const { withTimeout } = require("../../lib/playwright-utils");

const MESSAGE_SELECTOR = '.bubble[role="article"][data-mid]';
const MESSAGE_TIMEOUT_MS = 15_000;

function filterNewMessages(messages, baselineIds) {
  if (!baselineIds) return [];
  return (messages || []).filter(
    (message) => message && message.id && !baselineIds.has(String(message.id))
  );
}

function messagesToText(messages) {
  return (messages || [])
    .map((message) => message.text || "")
    .filter(Boolean)
    .join("\n");
}

async function readChatMessages(page) {
  const messages = await withTimeout(
    page.evaluate((selector) => {
      return [...document.querySelectorAll(selector)].map((element) => ({
        id: element.getAttribute("data-mid"),
        text: element.querySelector(".message")?.innerText || ""
      }));
    }, MESSAGE_SELECTOR),
    MESSAGE_TIMEOUT_MS,
    "đọc danh sách tin nhắn Telegram"
  );
  return messages.filter((message) => message.id);
}

// Trả về null nếu DOM không có bubble nào (Telegram đổi cấu trúc): caller sẽ
// quay lại cách đọc text cũ thay vì coi toàn bộ lịch sử là tin mới.
async function getVisibleMessageIds(page) {
  const messages = await readChatMessages(page);
  if (!messages.length) return null;
  return new Set(messages.map((message) => String(message.id)));
}

async function readNewChatMessages(page, baselineIds) {
  if (!baselineIds) return [];
  const messages = await readChatMessages(page);
  return filterNewMessages(messages, baselineIds);
}

module.exports = {
  MESSAGE_SELECTOR,
  filterNewMessages,
  messagesToText,
  readChatMessages,
  getVisibleMessageIds,
  readNewChatMessages
};
