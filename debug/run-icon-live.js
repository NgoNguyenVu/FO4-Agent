// TEST THẬT có kiểm soát: đặt mua 1 cầu thủ ICON, +1/1, tối đa 1 batch.
// Có thể tiêu BP thật nếu vị trí mua <= ngưỡng (đơn được giữ lại).
// Chỉ chạy khi đã xác nhận: đặt FO4_CONFIRM_LIVE_ICON=YES.
const path = require("node:path");
const readline = require("node:readline");
const { stdin, stdout } = require("node:process");

if (process.env.FO4_CONFIRM_LIVE_ICON !== "YES") {
  console.error(
    "Chưa xác nhận test thật. Đặt FO4_CONFIRM_LIVE_ICON=YES nếu muốn đặt mua thật."
  );
  process.exit(2);
}

// Ghi log của agent ra console để theo dõi trực tiếp.
const agentLog = require("../features/agent-log");
const originalLog = agentLog.log;
agentLog.log = (message) => {
  originalLog(message);
  console.log(`[agent] ${message}`);
};

const {
  chatTextReaders,
  observeChatText,
  waitForTextToSettle
} = require("../lib/chat-runtime");
const { ensureMessageComposer } = require("../features/composer");
const { openTelegramPage, closeMiniApp } = require("../features/telegram-io");
const { launchTelegramContext } = require("../lib/browser-session");
const { config } = require("../features/config");
const { runIconBuy } = require("../features/icon-buy/runner");
const { openTtcnList, readTtcnOrders } = require("../features/icon-buy/ttcn");
const { parseCompactBp } = require("../features/icon-buy/patterns");

// Giới hạn tối thiểu cho lần test thật.
config.iconBuy.maxPlayersPerBatch = 1;
config.iconBuy.continuous = false;
config.iconBuy.maxBatchesPerRun = 1;
config.iconBuy.purchaseTimeoutSeconds =
  Number(process.env.FO4_ICON_TIMEOUT_SECONDS) > 0
    ? Number(process.env.FO4_ICON_TIMEOUT_SECONDS)
    : 300;

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
  let page = null;
  try {
    console.log(`TEST THẬT: profile copy ${profileDir}`);
    console.log("Cấu hình test: 1 cầu thủ, 1 batch, grade +1, quantity 1.");
    context = await launchTelegramContext(profileDir);
    ({ page } = await openTelegramPage(context, null));
    await observeChatText(page, () => {});
    await ensureMessageComposer(page, rl);
    const reader = chatTextReaders.get(page);
    reader.arm();
    await waitForTextToSettle(reader, 1_500, 30_000, page);

    console.log("Chờ 15s để tránh giới hạn thao tác của bot...");
    await page.waitForTimeout(15_000);

    // Test có kiểm soát: chọn cầu thủ rẻ nhất trong danh sách yêu thích để
    // chắc chắn đủ BP và thực sự đi được tới bước đặt đơn/hủy đơn. Production
    // vẫn random hoàn toàn khi controller gọi runIconBuy(page, rl).
    // Có thể ép một mã cụ thể bằng FO4_ICON_TEST_CODE để thử thanh khoản khác.
    const preferredCode = process.env.FO4_ICON_TEST_CODE || null;
    const result = await runIconBuy(page, rl, {
      pickPlayers: (favorites) => {
        const pool = preferredCode
          ? favorites.filter((player) => player.code === preferredCode)
          : favorites;
        return [...pool]
          .sort(
            (a, b) =>
              (parseCompactBp(a.listedPrice) ?? Number.POSITIVE_INFINITY) -
              (parseCompactBp(b.listedPrice) ?? Number.POSITIVE_INFINITY)
          )
          .slice(0, 1);
      }
    });
    console.log(`Kết quả phiên ICON: ${JSON.stringify(result)}`);

    const shot = path.join(__dirname, "icon-live-run.png");
    await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
    console.log(`Ảnh màn hình: ${shot}`);

    try {
      console.log("Đọc lại TTCN để đối chiếu (chỉ đọc, không hủy).");
      const frame = await openTtcnList(page, rl);
      const orders = await readTtcnOrders(frame);
      const buys = orders.filter((order) => Number(order.orderType) === 1);
      console.log(`TTCN sau test: ${orders.length} card, ${buys.length} card mua.`);
      for (const order of buys.slice(-5)) {
        console.log(
          JSON.stringify({
            spid: order.spid,
            orderId: order.orderId,
            grade: order.grade,
            priceText: order.priceText,
            action: String(order.action || "").trim()
          })
        );
      }
    } catch (error) {
      console.log(`Không đọc lại được TTCN: ${error.message}`);
    }
  } finally {
    if (page) {
      await closeMiniApp(page, "mini-app Auto Mua").catch(() => {});
    }
    if (context) await context.close().catch(() => {});
    rl.close();
  }
}

main().catch((error) => {
  console.error(`Test thật thất bại: ${error.stack || error.message}`);
  process.exitCode = 1;
});
