// In các tin nhắn gần nhất để đối chiếu lỗi mở mini-app. Chỉ đọc.
const path = require("node:path");
const { chromium } = require("playwright");

const profileDir = path.join(
  process.env.LOCALAPPDATA || process.env.USERPROFILE,
  "FO4PurchaseAgent",
  "telegram-profile-verify"
);

(async () => {
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    viewport: { width: 1360, height: 900 }
  });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto("https://web.telegram.org/k/#@Nguyenanh_fo4_bot", {
    waitUntil: "domcontentloaded"
  });
  await page.waitForTimeout(5_000);
  const messages = await page.evaluate(() => {
    return [...document.querySelectorAll('.bubble[role="article"][data-mid]')].map(
      (bubble) => ({
        id: bubble.getAttribute("data-mid"),
        time: bubble.getAttribute("data-timestamp"),
        text: String(bubble.innerText || "").replace(/\s+/g, " ").slice(0, 400)
      })
    );
  });
  console.log(`Tổng ${messages.length} tin; 25 tin cuối:`);
  for (const message of messages.slice(-25)) {
    console.log(JSON.stringify(message));
  }
  await context.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
