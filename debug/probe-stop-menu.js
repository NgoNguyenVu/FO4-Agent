// Mở menu /stop để xem các luồng đang chạy. KHÔNG bấm nút dừng nào.
const path = require("node:path");
const readline = require("node:readline");
const { stdin, stdout } = require("node:process");
const {
  chatTextReaders,
  observeChatText,
  waitForTextToSettle
} = require("../lib/chat-runtime");
const { ensureMessageComposer } = require("../features/composer");
const { openTelegramPage, closeMiniApp } = require("../features/telegram-io");
const { launchTelegramContext } = require("../lib/browser-session");
const {
  getVisibleMessageIds,
  readNewChatMessages
} = require("../features/icon-buy/chat-messages");
const { sendSingleLineMessage } = require("../features/icon-buy/menu");

const profileDir = path.join(
  process.env.LOCALAPPDATA || process.env.USERPROFILE,
  "FO4PurchaseAgent",
  "telegram-profile-verify"
);

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  let context = null;
  let page = null;
  try {
    context = await launchTelegramContext(profileDir);
    ({ page } = await openTelegramPage(context, null));
    await observeChatText(page, () => {});
    await ensureMessageComposer(page, rl);
    const reader = chatTextReaders.get(page);
    reader.arm();
    await waitForTextToSettle(reader, 1_500, 30_000, page);
    await page.waitForTimeout(5_000);

    const baselineIds = await getVisibleMessageIds(page);
    await sendSingleLineMessage(page, rl, "/stop");
    console.log("Đã gửi /stop; chỉ đọc menu, không bấm nút.");
    await page.waitForTimeout(8_000);

    const messages = await readNewChatMessages(page, baselineIds);
    for (const message of messages) {
      console.log(
        JSON.stringify({
          id: message.id,
          text: String(message.text || "").replace(/\s+/g, " ").slice(0, 1200)
        })
      );
    }

    const buttons = await page.evaluate(() => {
      return [...document.querySelectorAll(".reply-markup-button")]
        .filter((button) => button.offsetWidth || button.offsetHeight)
        .slice(-15)
        .map((button) => ({
          text: String(button.innerText || "").replace(/\s+/g, " ").trim()
        }));
    });
    console.log(`Nút hiển thị (${buttons.length}):`);
    for (const button of buttons) console.log(JSON.stringify(button));

    const shot = path.join(__dirname, "stop-menu-probe.png");
    await page.screenshot({ path: shot, fullPage: false });
    console.log(`Ảnh: ${shot}`);
    console.log("Không bấm nút nào.");
  } finally {
    if (page) await closeMiniApp(page, "mini-app").catch(() => {});
    if (context) await context.close().catch(() => {});
    rl.close();
  }
}

main().catch((error) => {
  console.error(`Probe thất bại: ${error.stack || error.message}`);
  process.exitCode = 1;
});
