// Hủy đúng đơn ICON còn sót từ lần test trước (mặc định 101214101, +1).
// Chỉ bấm Hủy trên card khớp mã + orderId đã đọc; không đụng đơn khác.
const path = require("node:path");
const readline = require("node:readline");
const { stdin, stdout } = require("node:process");
const { chatTextReaders, observeChatText, waitForTextToSettle } = require("../lib/chat-runtime");
const { ensureMessageComposer } = require("../features/composer");
const { openTelegramPage, closeMiniApp } = require("../features/telegram-io");
const { launchTelegramContext } = require("../lib/browser-session");
const {
  openTtcnList,
  readTtcnOrders,
  cancelIconOrders
} = require("../features/icon-buy/ttcn");

const profileDir = path.join(
  process.env.LOCALAPPDATA || process.env.USERPROFILE,
  "FO4PurchaseAgent",
  "telegram-profile-verify"
);
const code = process.argv[2] || "101214101";
const expectedOrderId = process.argv[3] || "6ad9ac97ef3275f7c0d5ac33";

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
    const target = orders.find(
      (order) =>
        String(order.spid) === code &&
        order.orderId === expectedOrderId &&
        Number(order.orderType) === 1
    );
    if (!target) {
      console.log(
        `Không còn đơn mua ${code} (orderId ${expectedOrderId}) trong TTCN; ` +
          "có thể đã khớp hoặc đã hủy trước đó. Không bấm gì."
      );
      return;
    }
    console.log(
      `Tìm thấy đơn cần hủy: ${code} ${target.name} +${target.grade} ` +
        `${target.priceText} orderId ${target.orderId}.`
    );
    const knownIds = new Set(
      orders
        .map((order) => order.orderId)
        .filter((orderId) => orderId && orderId !== expectedOrderId)
    );
    const result = await cancelIconOrders(
      page,
      rl,
      [{ code, grade: target.grade, position: null, positionError: "unknown" }],
      knownIds
    );
    console.log(`Kết quả hủy: ${JSON.stringify(result, null, 2)}`);
  } finally {
    if (page) await closeMiniApp(page, "mini-app Auto Mua").catch(() => {});
    if (context) await context.close().catch(() => {});
    rl.close();
  }
}

main().catch((error) => {
  console.error(`Hủy đơn thất bại: ${error.stack || error.message}`);
  process.exitCode = 1;
});
