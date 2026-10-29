// Dừng riêng task mua ICON do lần test tạo ra (mặc định 100003647).
// Không bấm "Dừng tất cả", không đụng task Auto Mua/GLXH khác.
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
const code = process.argv[2] || "100003647";

function dump(messages) {
  for (const message of messages) {
    console.log(
      JSON.stringify({
        id: message.id,
        text: String(message.text || "").replace(/\s+/g, " ").slice(0, 800)
      })
    );
  }
}

async function showMenu(page, rl, tag) {
  const baselineIds = await getVisibleMessageIds(page);
  await sendSingleLineMessage(page, rl, "/stop");
  await page.waitForTimeout(6_000);
  const messages = await readNewChatMessages(page, baselineIds);
  console.log(`--- ${tag} ---`);
  dump(messages);
  const buttons = await page.evaluate(() =>
    [...document.querySelectorAll(".reply-markup-button")]
      .filter((button) => button.offsetWidth || button.offsetHeight)
      .map((button) => String(button.innerText || "").replace(/\s+/g, " ").trim())
  );
  console.log(`Nút: ${JSON.stringify(buttons)}`);
}

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

    await showMenu(page, rl, "menu trước");
    const target = page
      .locator(".reply-markup-button")
      .filter({ hasText: code })
      .filter({ hasText: /MUA/i })
      .last();
    const count = await target.count();
    if (!count) throw new Error(`Không thấy nút dừng cho task ${code}.`);
    console.log(`Bấm nút: ${(await target.innerText()).replace(/\s+/g, " ").trim()}`);

    const baselineIds = await getVisibleMessageIds(page);
    await target.click();
    await page.waitForTimeout(6_000);
    console.log("--- sau khi bấm ---");
    dump(await readNewChatMessages(page, baselineIds));

    await showMenu(page, rl, "menu sau");
    console.log(`Đã dừng riêng task ${code}; không bấm Dừng tất cả.`);
  } finally {
    if (page) await closeMiniApp(page, "mini-app").catch(() => {});
    if (context) await context.close().catch(() => {});
    rl.close();
  }
}

main().catch((error) => {
  console.error(`Dừng task thất bại: ${error.stack || error.message}`);
  process.exitCode = 1;
});
