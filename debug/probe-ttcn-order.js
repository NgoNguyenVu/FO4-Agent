// Đọc TTCN chỉ-đọc và lọc theo mã cầu thủ (mặc định 101214101) để kiểm tra
// xem lần test trước có để lại đơn mua nào không. Không bấm Hủy.
const path = require("node:path");
const readline = require("node:readline");
const { stdin, stdout } = require("node:process");
const { chatTextReaders, observeChatText, waitForTextToSettle } = require("../lib/chat-runtime");
const { ensureMessageComposer } = require("../features/composer");
const { openTelegramPage, closeMiniApp } = require("../features/telegram-io");
const { launchTelegramContext } = require("../lib/browser-session");
const { openTtcnList, readTtcnOrders } = require("../features/icon-buy/ttcn");

const profileDir = path.join(
  process.env.LOCALAPPDATA || process.env.USERPROFILE,
  "FO4PurchaseAgent",
  "telegram-profile-verify"
);
const code = process.argv[2] || "101214101";

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

    const frame = await openTtcnList(page, rl);
    const orders = await readTtcnOrders(frame);
    const matches = orders.filter((order) => String(order.spid) === code);
    console.log(`TTCN: ${orders.length} card; khớp ${code}: ${matches.length}.`);
    for (const order of matches) {
      console.log(
        JSON.stringify({
          spid: order.spid,
          orderId: order.orderId,
          orderType: order.orderType,
          name: order.name,
          season: order.season,
          grade: order.grade,
          priceText: order.priceText,
          action: String(order.action || "").trim()
        })
      );
    }
    const buys = orders.filter((order) => Number(order.orderType) === 1);
    console.log(`Đơn mua đang có trong TTCN: ${buys.length} card.`);
    await closeMiniApp(page, "mini-app Auto Mua").catch(() => {});
  } finally {
    if (context) await context.close().catch(() => {});
    rl.close();
  }
}

main().catch((error) => {
  console.error(`Đọc TTCN thất bại: ${error.stack || error.message}`);
  process.exitCode = 1;
});
