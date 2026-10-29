// Kiểm tra chỉ-đọc tab "Gỡ cầu thủ TTCN" trên profile Edge được copy.
// Không bấm Hủy, không mua, không gửi /stop. Chỉ mở mini-app, đọc danh sách
// đơn hàng và chụp ảnh màn hình để đối chiếu selector.
const path = require("node:path");
const readline = require("node:readline");
const { stdin, stdout } = require("node:process");
const { chatTextReaders, observeChatText, waitForTextToSettle } = require("../lib/chat-runtime");
const { ensureMessageComposer } = require("../features/composer");
const { openTelegramPage } = require("../features/telegram-io");
const { launchTelegramContext } = require("../lib/browser-session");
const { closeMiniApp } = require("../features/telegram-io");
const { openTtcnList, readTtcnOrders } = require("../features/icon-buy/ttcn");

const profileDir =
  process.argv[2] ||
  path.join(process.env.LOCALAPPDATA || process.env.USERPROFILE, "FO4PurchaseAgent", "telegram-profile-verify");

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  let context = null;
  try {
    console.log(`Mở profile copy: ${profileDir}`);
    context = await launchTelegramContext(profileDir);
    context.on("close", () => console.log("[diag] context closed"));
    context.browser()?.on("disconnected", () => console.log("[diag] browser disconnected"));
    console.log("[diag] launched");
    const { page } = await openTelegramPage(context, null);
    page.on("close", () => console.log("[diag] page closed"));
    page.on("crash", () => console.log("[diag] page crashed"));
    console.log("[diag] page opened");
    await observeChatText(page, () => {});
    console.log("[diag] observer attached");
    await ensureMessageComposer(page, rl);
    console.log("[diag] composer ready");
    const reader = chatTextReaders.get(page);
    reader.arm();
    await waitForTextToSettle(reader, 1_500, 30_000, page);
    console.log("Telegram đã sẵn sàng; mở Auto Mua Phôi -> Gỡ cầu thủ TTCN (chỉ đọc).");

    const frame = await openTtcnList(page, rl);
    const orders = await readTtcnOrders(frame);
    const withId = orders.filter((order) => order.orderId);
    console.log(`TTCN: ${orders.length} card, ${withId.length} card có orderId.`);
    for (const order of orders.slice(0, 8)) {
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
    const errorText = await frame
      .locator("#error-cancel-message")
      .innerText()
      .catch(() => "");
    if (errorText.trim()) console.log(`TTCN error: ${errorText.trim()}`);
    const shot = path.join(__dirname, "ttcn-live-verify.png");
    await page.screenshot({ path: shot, fullPage: false });
    console.log(`Ảnh màn hình: ${shot}`);
    await closeMiniApp(page, "mini-app Auto Mua").catch(() => {});
    console.log("Đóng mini-app; không thực hiện hủy đơn.");
  } finally {
    if (context) await context.close().catch(() => {});
    rl.close();
  }
}

main().catch((error) => {
  console.error(`Kiểm tra TTCN thất bại: ${error.stack || error.message}`);
  process.exitCode = 1;
});
