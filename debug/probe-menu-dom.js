// Soi cấu trúc DOM menu mới nhất. Chỉ đọc.
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
  const info = await page.evaluate(() => {
    const bubbles = [...document.querySelectorAll('.bubble[role="article"][data-mid]')];
    const withMenu = bubbles.filter((bubble) =>
      /CHÈN MEMBER THƯỜNG/i.test(bubble.innerText || "")
    );
    const latest = withMenu.at(-1);
    const buttons = latest
      ? [...latest.querySelectorAll("button")].map((button) => ({
          text: String(button.innerText || "").replace(/\s+/g, " ").trim(),
          className: String(button.className || ""),
          visible: Boolean(button.offsetWidth || button.offsetHeight)
        }))
      : [];
    const allButtons = [...document.querySelectorAll("button")].map((button) => ({
      text: String(button.innerText || "").replace(/\s+/g, " ").trim().slice(0, 60),
      className: String(button.className || "").slice(0, 100),
      visible: Boolean(button.offsetWidth || button.offsetHeight)
    }));
    return {
      totalBubbles: bubbles.length,
      menuBubbles: withMenu.length,
      latestMid: latest?.getAttribute("data-mid") || null,
      latestHtml: latest ? latest.outerHTML.slice(0, 4000) : null,
      buttons,
      visibleButtons: allButtons.filter((button) => button.visible).slice(-15)
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await context.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
