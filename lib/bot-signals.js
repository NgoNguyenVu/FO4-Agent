// Tín hiệu chung của bot (E006, rate-limit) dùng cho cả Auto Mua và Auto Nâng.
// Đặt ở lib/ để module nâng không phải require ngược lên module mua.
const {
  BOT_RATE_LIMIT_RE,
  BOT_SYSTEM_ERROR_RE
} = require("./bot-patterns");
const { countMatches } = require("./text-utils");

function countBotSystemErrors(text) {
  return countMatches(text, BOT_SYSTEM_ERROR_RE);
}

function hasNewBotSystemError(text, previousErrorCount) {
  return countBotSystemErrors(text) > previousErrorCount;
}

function countBotRateLimitNotices(text) {
  return countMatches(text, BOT_RATE_LIMIT_RE);
}

function getNewBotRateLimitDelay(text, previousCount) {
  const notices = [...text.matchAll(BOT_RATE_LIMIT_RE)];
  if (notices.length <= previousCount) return null;
  return Number(notices.at(-1)[1]) * 1_000;
}

function getFreshRateLimitDelay(freshText) {
  if (!freshText) return null;
  const notices = [...freshText.matchAll(BOT_RATE_LIMIT_RE)];
  if (!notices.length) return null;
  return Number(notices.at(-1)[1]) * 1_000;
}

function throwBotSystemError(context) {
  const error = new Error(`Bot trả E006 ${context}; agent tự dừng và chờ /startagent.`);
  error.code = "BOT_SYSTEM_ERROR";
  throw error;
}

module.exports = {
  countBotSystemErrors,
  hasNewBotSystemError,
  countBotRateLimitNotices,
  getNewBotRateLimitDelay,
  getFreshRateLimitDelay,
  throwBotSystemError
};
