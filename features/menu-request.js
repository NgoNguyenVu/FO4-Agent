// Yêu cầu menu chức năng bằng /tn, dùng chung cho Auto Mua và Auto Nâng Cấp.
// Chỉ gửi /tn khi caller đã xác nhận không còn nút menu dùng được. Mọi lần gửi
// đều qua sendTnCommand() để giữ cooldown, tránh spam bot.
const { config } = require("./config");
const { chatTextReaders } = require("../lib/chat-runtime");
const { ensureMessageComposer } = require("./composer");
const { sendTnCommand } = require("./telegram-io");
const { log } = require("./agent-log");

async function requestMenuWithTn(page, rl, { label, waitForMenu, buildBaseline }) {
  const reader = chatTextReaders.get(page);
  if (!reader) throw new Error("Chưa khởi tạo theo dõi nội dung Telegram.");

  const deadline = Date.now() + config.menuResponseTimeoutSeconds * 1_000;
  let response = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (Date.now() >= deadline) break;
    const composer = await ensureMessageComposer(page, rl);
    if (Date.now() >= deadline) break;

    const snapshotText = reader.snapshot().text;
    const baseline = buildBaseline(snapshotText);
    if (attempt > 0) {
      log(`Gửi lại /tn cho ${label} (lần ${attempt + 1}/3).`);
    }
    await sendTnCommand(page, composer);
    response = await waitForMenu(
      page,
      Math.max(1, deadline - Date.now()),
      baseline
    );
    if (!response || response.status !== "rate-limited") break;
    if (response.delay >= deadline - Date.now() || attempt >= 2) break;
    log(
      `Bot từ chối /tn do gửi quá nhanh; chờ ` +
        `${Math.ceil(response.delay / 1_000)} giây rồi gửi lại.`
    );
    await page.waitForTimeout(response.delay);
  }
  return response;
}

module.exports = {
  requestMenuWithTn
};
