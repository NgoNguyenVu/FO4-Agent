// Chạy đúng openMemberBuyPrompt() nhưng KHÔNG gửi mã: chỉ kiểm tra mở được
// Chèn Member Thường -> Mua cầu thủ và nhận prompt. Không đặt mua.
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
const { openMemberBuyPrompt } = require("../features/icon-buy/order");

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

    await openMemberBuyPrompt(page, rl);
    console.log("THÀNH CÔNG: đã mở được prompt MãCầuThủ/MứcThẻ/SốLượng.");
    console.log("Không gửi mã nào, không đặt mua.");
    const shot = path.join(__dirname, "open-buy-prompt-probe.png");
    await page.screenshot({ path: shot, fullPage: false });
    console.log(`Ảnh: ${shot}`);
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
