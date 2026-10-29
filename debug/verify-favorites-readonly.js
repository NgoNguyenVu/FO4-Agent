// Kiểm tra chỉ-đọc "Tra cứu mã cầu thủ offline": không mua, không hủy.
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
const { lookupFavoriteIconPlayers } = require("../features/icon-buy/favorites");

const profileDir =
  process.argv[2] ||
  path.join(
    process.env.LOCALAPPDATA || process.env.USERPROFILE,
    "FO4PurchaseAgent",
    "telegram-profile-verify"
  );

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

    const players = await lookupFavoriteIconPlayers(page, rl);
    console.log(`ICON yêu thích đọc được: ${players.length}`);
    for (const player of players) {
      console.log(
        JSON.stringify({
          code: player.code,
          name: player.name,
          season: player.season,
          listedGrade: player.listedGrade,
          ovr: player.ovr,
          listedPrice: player.listedPrice
        })
      );
    }
    const shot = path.join(__dirname, "favorites-live-verify.png");
    await page.screenshot({ path: shot, fullPage: false });
    console.log(`Ảnh màn hình: ${shot}`);
    await closeMiniApp(page, "mini-app").catch(() => {});
  } finally {
    if (context) await context.close().catch(() => {});
    rl.close();
  }
}

main().catch((error) => {
  console.error(`Kiểm tra favorites thất bại: ${error.stack || error.message}`);
  process.exitCode = 1;
});
