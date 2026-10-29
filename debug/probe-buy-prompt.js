// Soi bước Chèn Member Thường -> Mua cầu thủ. Không gửi mã, không đặt mua.
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
  readChatMessages,
  readNewChatMessages
} = require("../features/icon-buy/chat-messages");
const {
  findButtonByText,
  waitForButtonByText
} = require("../features/icon-buy/menu");

const profileDir = path.join(
  process.env.LOCALAPPDATA || process.env.USERPROFILE,
  "FO4PurchaseAgent",
  "telegram-profile-verify"
);

function dump(messages, tag) {
  console.log(`--- ${tag}: ${messages.length} tin ---`);
  for (const message of messages) {
    console.log(
      JSON.stringify({
        id: message.id,
        text: String(message.text || "").replace(/\s+/g, " ").slice(0, 500)
      })
    );
  }
}

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  let context = null;
  try {
    context = await launchTelegramContext(profileDir);
    const { page } = await openTelegramPage(context, null);
    await observeChatText(page, () => {});
    await ensureMessageComposer(page, rl);
    const reader = chatTextReaders.get(page);
    reader.arm();
    await waitForTextToSettle(reader, 1_500, 30_000, page);

    const before = await readChatMessages(page);
    dump(before.slice(-8), "trước");
    const baselineIds = new Set(before.map((message) => message.id));

    const member = await findButtonByText(page, "Chèn Member Thường");
    console.log(`Nút Chèn Member Thường: ${member ? "có" : "không"}`);
    if (!member) throw new Error("Không thấy nút Chèn Member Thường.");
    await member.click();
    await page.waitForTimeout(3_000);
    dump(await readNewChatMessages(page, baselineIds), "sau khi bấm Chèn Member Thường");

    const buyBaseline = new Set(
      (await readChatMessages(page)).map((message) => message.id)
    );
    const buy = await waitForButtonByText(page, "Mua cầu thủ", 10_000);
    console.log(`Nút Mua cầu thủ: ${buy ? "có" : "không"}`);
    if (!buy) {
      await page.screenshot({
        path: path.join(__dirname, "buy-prompt-probe.png"),
        fullPage: false
      });
      throw new Error("Không thấy nút Mua cầu thủ.");
    }
    await buy.click();
    for (const waitMs of [3_000, 5_000, 7_000]) {
      await page.waitForTimeout(waitMs);
      console.log(`sau +${waitMs}ms:`);
      dump(await readNewChatMessages(page, buyBaseline), "tin mới");
    }
    const shot = path.join(__dirname, "buy-prompt-probe.png");
    await page.screenshot({ path: shot, fullPage: false });
    console.log(`Ảnh: ${shot}`);
    await closeMiniApp(page, "mini-app").catch(() => {});
  } finally {
    if (context) await context.close().catch(() => {});
    rl.close();
  }
}

main().catch((error) => {
  console.error(`Probe thất bại: ${error.stack || error.message}`);
  process.exitCode = 1;
});
