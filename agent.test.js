const test = require("node:test");
const assert = require("node:assert/strict");
const {
  countStartedNotices,
  countStoppedNotices,
  countFullInventoryStops,
  getFeatureMenuAction,
  hasFreshFeatureMenu,
  getCycleBaseline,
  getExistingAutoBuyCycle,
  getCycleCompletionNotice,
  getNewCompletionNotice,
  getStopCheckBaseline,
  getStopCheckResult,
  getLatestStartedMarker,
  getLatestWorkerId,
  isStopConfirmed,
  idleOutcomeMessage,
  hasNewStartAcknowledgement,
  getLatestCompletionAfterActivity,
  getCycleOutcomeFromFresh,
  getOrphanCycleOutcome,
  classifyFreshStopReply,
  hasFreshStopConfirmation,
  hasNewStoppedNotice,
  hasNewFullInventoryStop,
  countInventoryReceivedNotices,
  getLatestInventoryReceived,
  hasRecentFeatureMenu,
  parseCompletionNotices,
  parseBp,
  isTradeFrameLoaded,
  shouldRetryMiniAppBpLoad,
  shouldRetryMiniAppOpen,
  isEarlyCompletion,
  STALE_COMPLETION_GUARD_MS,
  waitForInventoryReceipt
} = require("./features/buy");
const {
  countBotRateLimitNotices,
  countBotSystemErrors,
  hasNewBotSystemError,
  getNewBotRateLimitDelay,
  getFreshRateLimitDelay,
  throwBotSystemError
} = require("./lib/bot-signals");
const {
  chatTextReaders,
  createChatTextTracker,
  waitForChatChange,
  waitForTextToSettle,
  reattachChatObserver
} = require("./lib/chat-runtime");
const { waitForMenuReply } = require("./features/buy/menu");
const {
  countMatches,
  lastPatternIndex,
  getFreshSince,
  findNearMissControlCommand,
  findNewNearMissControlCommand
} = require("./lib/text-utils");
const {
  withTimeout,
  isPlaywrightTimeout,
  isBrowserSessionClosed,
  isNavigationError
} = require("./lib/playwright-utils");
const {
  CONTROL_START_COMMANDS,
  CONTROL_MODE_BY_COMMAND
} = require("./lib/control-commands");
const {
  isBotChatOpen,
  ensureBotChatOpen,
  hardReloadTelegram,
  sendTnCommand,
  getPaymentFrameLocator
} = require("./features/telegram-io");
const {
  PURCHASE_RE,
  BOT_COMMAND_DELAY_MS,
  TN_COMMAND_COOLDOWN_MS,
  MINI_APP_BLANK_TIMEOUT_MS,
  BUY_START_ACK_TIMEOUT_MS
} = require("./lib/bot-patterns");
const {
  shouldResumeBuyAfterUpgrade,
  decideMasterUpgradePhase,
  pivotMasterToUpgrade,
  settleUpgradeOutcome
} = require("./features/upgrade");
const { config, validateConfig } = require("./features/config");
const { waitForPurchaseResults } = require("./features/icon-buy/order");
const {
  reloadUpgradeTargetList
} = require("./features/upgrade/mini-app");

test("parse BP prices with Vietnamese thousands separators", () => {
  assert.equal(parseBp("666.666"), 666666);
  assert.equal(parseBp("1,234,567"), 1234567);
});

test("menu waits are short and validated separately from long bot waits", () => {
  assert.ok(Number.isSafeInteger(config.menuResponseTimeoutSeconds));
  assert.ok(config.menuResponseTimeoutSeconds > 0);
  assert.ok(
    config.menuResponseTimeoutSeconds < config.botResponseTimeoutMinutes * 60,
    "menu wait should be shorter than the long ack/stop wait"
  );
  assert.ok(Number.isSafeInteger(config.menuBusyRetrySeconds));
  assert.ok(config.menuBusyRetrySeconds > 0);
  assert.ok(Number.isSafeInteger(config.upgradeFrameTimeoutSeconds));
  assert.ok(config.upgradeFrameTimeoutSeconds > 0);
  assert.ok(config.upgradeFrameTimeoutSeconds <= 120);
  assert.doesNotThrow(validateConfig);
  assert.equal(config.iconBuy.maxPlayersPerBatch, 3);
  assert.equal(config.iconBuy.maxTaskSlots, 3);
  assert.equal(config.iconBuy.continuous, true);
  assert.equal(config.iconBuy.monitorExistingOrders, true);
  assert.equal(config.iconBuy.purchaseTimeoutSeconds, 0);
});

test("menu and blank-frame recoveries are bounded and spaced out", () => {
  // /tn quá sát nhau dễ bị bot rate-limit; iframe trắng phải được nhận ra
  // trước khi chờ hết timeout dài.
  assert.ok(TN_COMMAND_COOLDOWN_MS >= 10_000);
  assert.equal(MINI_APP_BLANK_TIMEOUT_MS, 15_000);
  assert.ok(MINI_APP_BLANK_TIMEOUT_MS < config.upgradeFrameTimeoutSeconds * 1_000);
});

test("start ACK wait is short enough to retry when the bot lags", () => {
  // Bot thường ACK trong vài giây. Giữ ngưỡng ngắn để agent bấm lại/mini-app
  // recovery thay vì treo cả botResponseTimeoutMinutes.
  assert.ok(Number.isSafeInteger(BUY_START_ACK_TIMEOUT_MS));
  assert.ok(BUY_START_ACK_TIMEOUT_MS > 0);
  assert.ok(
    BUY_START_ACK_TIMEOUT_MS <= config.botResponseTimeoutMinutes * 60_000,
    "ACK wait must not exceed the configured bot response timeout"
  );
  assert.ok(BUY_START_ACK_TIMEOUT_MS <= 120_000);
});

test("only suspiciously early completions are re-verified with /stop", () => {
  assert.equal(
    isEarlyCompletion({ status: "completed", playersBought: 14 }, 3_000),
    true
  );
  assert.equal(
    isEarlyCompletion(
      { status: "completed", playersBought: 14 },
      STALE_COMPLETION_GUARD_MS
    ),
    false
  );
  assert.equal(
    isEarlyCompletion({ status: "inventory-full" }, 1_000),
    false
  );
  assert.equal(isEarlyCompletion(null, 1_000), false);
});

test("sendTnCommand waits for the /tn cooldown on repeated sends", async () => {
  const waits = [];
  const page = {
    waitForTimeout: async (ms) => { waits.push(ms); }
  };
  const composer = {
    fill: async () => {},
    press: async () => {}
  };
  await sendTnCommand(page, composer);
  await sendTnCommand(page, composer);
  assert.ok(
    waits.some((ms) => ms >= TN_COMMAND_COOLDOWN_MS - 1_000),
    `expected a cooldown wait, got ${waits.join(", ")}`
  );
});

test("payment iframe helper always uses the newest iframe", () => {
  const sentinel = { newest: true };
  const page = {
    locator(selector) {
      assert.equal(selector, "iframe.payment-verification");
      return {
        last() {
          return { contentFrame: () => sentinel };
        }
      };
    }
  };
  assert.equal(getPaymentFrameLocator(page), sentinel);
});

test("buy and upgrade route /tn through the shared cooldown helper", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  for (const file of ["features/buy/mini-app.js", "features/upgrade/mini-app.js"]) {
    const src = fs.readFileSync(path.join(__dirname, file), "utf8");
    assert.doesNotMatch(
      src,
      /sendBotCommand\([^)]*["']\/tn["']/,
      `${file} must not call sendBotCommand directly with /tn`
    );
    assert.doesNotMatch(
      src,
      /refillComposer\([^)]*["']\/tn["']/,
      `${file} must not send /tn through refillComposer`
    );
  }
});

test("both mini-app flows detect a blank iframe", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  for (const file of ["features/buy/mini-app.js", "features/upgrade/mini-app.js"]) {
    const src = fs.readFileSync(path.join(__dirname, file), "utf8");
    assert.match(src, /MINI_APP_BLANK_TIMEOUT_MS/, `${file} needs the shared blank timeout`);
    assert.match(src, /"MINI_APP_BLANK"/, `${file} must mark blank iframes as retryable`);
  }
});

test("count/scan helpers accept non-global regexes without throwing", () => {
  const text = "Auto Nâng Cấp 2.0\nAuto Nâng Cấp 2.0";
  assert.equal(countMatches(text, /nâng cấp 2\.0/i), 2);
  assert.equal(lastPatternIndex(text, /nâng cấp 2\.0/i), text.lastIndexOf("Nâng Cấp 2.0"));
});

test("waits four seconds before sending commands to avoid bot rate-limit warnings", () => {
  assert.equal(BOT_COMMAND_DELAY_MS, 4_000);
});

test("parses only a fresh bot rate-limit warning and its requested retry delay", () => {
  const warning =
    "Bạn thao tác quá nhanh. Thời gian thao tác giữa các chức năng tối thiểu là 2s. " +
    "Vui lòng chờ 4s rồi thử lại.";
  const chat = `Old history\n${warning}`;

  assert.equal(countBotRateLimitNotices(chat), 1);
  assert.equal(getNewBotRateLimitDelay(chat, 0), 4_000);
  assert.equal(getNewBotRateLimitDelay(chat, 1), null);
});

test("detects fresh E006 errors without treating old chat history as new", () => {
  const error = "E006: Lỗi hệ thống, vui lòng thử lại sau hoặc liên hệ hỗ trợ.";
  const chat = `Old history\n${error}`;

  assert.equal(countBotSystemErrors(chat), 1);
  assert.equal(hasNewBotSystemError(chat, 0), true);
  assert.equal(hasNewBotSystemError(chat, 1), false);
});

test("count start acknowledgements to detect a newly accepted run", () => {
  assert.equal(
    countStartedNotices(
      "Bắt đầu treo auto mua (worker x). Bắt đầu treo auto mua (worker y)."
    ),
    2
  );
});

test("wakes a chat text waiter as soon as a DOM update is published", async () => {
  const tracker = createChatTextTracker("old chat");
  const before = tracker.snapshot();
  const updatePromise = tracker.waitForChange(before.version, 1_000);

  tracker.publish("old chat\nĐã mua đủ 1 cầu thủ");

  assert.deepEqual(await updatePromise, {
    text: "old chat\nĐã mua đủ 1 cầu thủ",
    version: before.version + 1
  });
});

test("does not lose a DOM update that arrives before the wait is registered", async () => {
  const tracker = createChatTextTracker("old chat");
  const before = tracker.snapshot();
  tracker.publish("old chat\nĐã mua đủ 1 cầu thủ");

  assert.deepEqual(await tracker.waitForChange(before.version, 1_000), {
    text: "old chat\nĐã mua đủ 1 cầu thủ",
    version: before.version + 1
  });
});

test("polls Telegram chat text and accepts a slash command with Telegram timestamp metadata", async () => {
  const oldText = "Previous chat tail";
  const newText = `${oldText}\n/startagent 08:57 ✓✓`;
  const tracker = createChatTextTracker(oldText);
  tracker.arm();
  const page = {
    locator(selector) {
      assert.equal(selector, "body");
      return { innerText: async () => newText };
    }
  };

  const update = await waitForChatChange(page, tracker, 0, 1_000);

  assert.deepEqual(update, { text: newText, version: 1 });
  assert.deepEqual(tracker.takeCommands(), ["startagent"]);
});

test("treats closed Telegram page during polling as a retriable no-update", async () => {
  const tracker = createChatTextTracker("Chat tail");
  const page = {
    locator(selector) {
      assert.equal(selector, "body");
      return {
        innerText: async () => {
          throw new Error("locator.innerText: Target page, context or browser has been closed");
        }
      };
    }
  };

  const update = await waitForChatChange(page, tracker, tracker.snapshot().version, 100);
  assert.equal(update, null);
});

test("propagates Telegram navigation during polling as a recoverable error", async () => {
  const tracker = createChatTextTracker("Chat tail");
  let scrollCalls = 0;
  const page = {
    evaluate: async () => {
      scrollCalls += 1;
      // Lần cuộn đầu thành công; lần kiểm tra lại sau backoff mới gặp navigation,
      // đúng nhánh waitForChange đã làm agent dừng ở lỗi trong ảnh.
      if (scrollCalls === 1) return true;
      throw new Error(
        "page.evaluate: Execution context was destroyed, most likely because of a navigation"
      );
    },
    locator(selector) {
      assert.equal(selector, "body");
      return { innerText: async () => "Chat tail" };
    }
  };

  await assert.rejects(
    waitForChatChange(page, tracker, tracker.snapshot().version, 100),
    (error) => {
      assert.equal(error.code, "TELEGRAM_NAVIGATED");
      assert.equal(isNavigationError(error), true);
      return true;
    }
  );
  assert.ok(scrollCalls >= 2);
});

test("ignores a historical command loaded while startup chat history settles", async () => {
  const tracker = createChatTextTracker("Chat mới mở");
  const historicalText = "Chat mới mở\n/startagent";
  const historyLoad = setTimeout(() => tracker.publish(historicalText), 10);

  await waitForTextToSettle(tracker, 30, 500);
  tracker.arm();
  clearTimeout(historyLoad);

  assert.deepEqual(tracker.takeCommands(), []);

  tracker.publish(`${historicalText}\n/startagent`);
  assert.deepEqual(tracker.takeCommands(), ["startagent"]);
});

test("does not treat a late-loaded older chat command as a fresh control command", () => {
  const initialChat = "Latest loaded message";
  const tracker = createChatTextTracker(initialChat);
  tracker.arm();

  tracker.publish(`/startagent\n${initialChat}`);

  assert.deepEqual(tracker.takeCommands(), []);

  tracker.publish(`/startagent\n${initialChat}\n/stopagent`);
  assert.deepEqual(tracker.takeCommands(), ["stopagent"]);
});

test("recognizes a fresh tail command when Telegram replaces the chat text snapshot", () => {
  const tracker = createChatTextTracker(
    `Unrelated old tail ${"old text ".repeat(40)}`
  );
  tracker.arm();

  tracker.publish(
    `Different Telegram snapshot ${"refreshed text ".repeat(30)}\n/startagent 11:32 ✓✓`
  );

  assert.deepEqual(tracker.takeCommands(), ["startagent"]);
});

test("requires slash-prefixed commands and rejects similarly named commands", () => {
  const tracker = createChatTextTracker("Latest loaded message");
  tracker.arm();

  tracker.publish(
    "Latest loaded message\nstartagent 08:56 ✓✓\n" +
      "/startagent 08:57 ✓✓\n/stopagent\n08:58 ✓✓\n/stopagentx 08:59"
  );

  assert.deepEqual(tracker.takeCommands(), ["startagent", "stopagent"]);
});

test("waits for the mini-app's displayed BP value instead of configuring while loading", () => {
  assert.equal(
    isTradeFrameLoaded("BP hiện có Đang tải..."),
    false
  );
  assert.equal(
    isTradeFrameLoaded("BP hiện có Đang tải...\nGiá hiển thị: 4.000 BP (4.000 BP)"),
    false
  );
  assert.equal(
    isTradeFrameLoaded("BP hiện có 18.000 BP\nGiá hiển thị: 4.000 BP (4.000 BP)"),
    true
  );
  assert.equal(
    isTradeFrameLoaded("BP hiện có 18.000 BP\nGiá tối đa: 4.000 BP"),
    false
  );
});

test("retries a mini-app BP loading timeout twice, then stops retrying", () => {
  assert.equal(shouldRetryMiniAppBpLoad(0), true);
  assert.equal(shouldRetryMiniAppBpLoad(1), true);
  assert.equal(shouldRetryMiniAppBpLoad(2), false);
});

test("retries transient mini-app failures twice", () => {
  for (const code of [
    "MINI_APP_UI_NOT_READY",
    "MINI_APP_NOT_OPENED",
    "MINI_APP_BLANK",
    "MINI_APP_BP_LOAD_TIMEOUT"
  ]) {
    assert.equal(shouldRetryMiniAppOpen({ code }, 0), true, code);
    assert.equal(shouldRetryMiniAppOpen({ code }, 1), true, code);
    assert.equal(shouldRetryMiniAppOpen({ code }, 2), false, code);
  }
  assert.equal(shouldRetryMiniAppOpen({ code: "TELEGRAM_LOGIN_REQUIRED" }, 0), false);
  assert.equal(shouldRetryMiniAppOpen(new Error("khác"), 0), false);
});

test("recognizes the bot chat only when its pane is actually open", async () => {
  const makePage = ({ url, titleVisible = false, title = "", composerVisible = false }) => ({
    url: () => url,
    locator: (selector) => ({
      first: () => ({
        isVisible: async () =>
          selector.includes("peer-title") ? titleVisible : composerVisible,
        innerText: async () => title
      })
    })
  });

  assert.equal(
    await isBotChatOpen(
      makePage({
        url: "https://web.telegram.org/a/#8107829917",
        titleVisible: true,
        title: "BOT-TTCN-FO4"
      })
    ),
    true
  );
  // Bot đổi tên hiển thị nhưng URL vẫn đúng bot + ô nhập mở -> coi là đang mở,
  // tránh page.goto lại trên mỗi lệnh.
  assert.equal(
    await isBotChatOpen(
      makePage({
        url: "https://web.telegram.org/k/#@Nguyenanh_fo4_bot",
        titleVisible: true,
        title: "BOT CHEN FC4",
        composerVisible: true
      })
    ),
    true
  );
  assert.equal(
    await isBotChatOpen(
      makePage({
        url: "https://web.telegram.org/a/#8107829917",
        composerVisible: true
      })
    ),
    true
  );
  // Hash còn nhưng Telegram đã đóng cột chat (trang chủ) -> phải coi là chưa mở.
  assert.equal(
    await isBotChatOpen(
      makePage({ url: "https://web.telegram.org/k/#@Nguyenanh_fo4_bot" })
    ),
    false
  );
  assert.equal(
    await isBotChatOpen(
      makePage({
        url: "https://web.telegram.org/a/#999999999",
        titleVisible: true,
        title: "Chat khác"
      })
    ),
    false
  );
});

test("reopens the bot chat from the chat list when the hash still matches", async () => {
  let open = false;
  let clicked = 0;
  let navigated = 0;
  let tipClicks = 0;
  const page = {
    url: () => "https://web.telegram.org/k/#@Nguyenanh_fo4_bot",
    locator(selector) {
      if (selector.includes("peer-title")) {
        return {
          first: () => ({
            isVisible: async () => open,
            innerText: async () => (open ? "BOT-TTCN-FO4" : "")
          })
        };
      }
      if (selector.includes("editable-message-text")) {
        return {
          first: () => ({ isVisible: async () => open })
        };
      }
      if (selector.includes("chatlist-chat")) {
        return {
          filter: () => ({
            first: () => ({
              isVisible: async () => true,
              click: async () => {
                clicked += 1;
                open = true;
              }
            })
          })
        };
      }
      throw new Error(`unexpected selector ${selector}`);
    },
    getByRole: () => ({
      count: async () => (tipClicks >= 1 ? 0 : 1),
      first: () => ({
        isVisible: async () => true,
        click: async () => { tipClicks += 1; }
      })
    }),
    waitForTimeout: async () => {},
    goto: async () => { navigated += 1; open = true; }
  };
  assert.equal(await ensureBotChatOpen(page), true);
  assert.equal(clicked, 1);
  assert.equal(navigated, 0);
  assert.equal(tipClicks, 1);
});

test("detects closed Telegram pages and disconnected browsers for recovery", () => {
  const connectedContext = {
    browser: () => ({ isConnected: () => true })
  };
  const disconnectedContext = {
    browser: () => ({ isConnected: () => false })
  };

  assert.equal(
    isBrowserSessionClosed(new Error("page closed"), { isClosed: () => true }, connectedContext),
    true
  );
  assert.equal(
    isBrowserSessionClosed(new Error("target closed"), { isClosed: () => false }, disconnectedContext),
    true
  );
  assert.equal(
    isBrowserSessionClosed(new Error("other failure"), { isClosed: () => false }, connectedContext),
    false
  );
  assert.equal(
    isBrowserSessionClosed(new Error("Target crashed"), { isClosed: () => false }, connectedContext),
    true
  );
});

test("detects Playwright closed-target errors even for persistent contexts", () => {
  const persistentContext = { browser: () => null };

  assert.equal(
    isBrowserSessionClosed(
      new Error("locator.innerText: Target page, context or browser has been closed"),
      { isClosed: () => false },
      persistentContext
    ),
    true
  );
});

test("processes queued start, stop and reset commands in the order they appeared", () => {
  const tracker = createChatTextTracker("Chat tail");
  tracker.arm();
  tracker.publish("Chat tail\n/startagent\n/stopagent\n/resetagent");

  assert.equal(tracker.takeNextCommand(), "startagent");
  assert.equal(tracker.takeNextCommand(), "stopagent");
  assert.equal(tracker.takeNextCommand(), "resetagent");
  assert.equal(tracker.takeNextCommand(), null);
});

test("handles a fresh /resetagent immediately without treating it as /startagent", () => {
  const tracker = createChatTextTracker("Chat tail");
  const receivedCommands = [];
  tracker.setCommandHandler((command) => receivedCommands.push(command));
  tracker.arm();

  tracker.publish("Chat tail\n/resetagent");

  assert.deepEqual(receivedCommands, ["resetagent"]);
  assert.equal(tracker.takeNextCommand(), "resetagent");
});

test("supports /resetagent bot suffix and ignores similarly named commands", () => {
  const tracker = createChatTextTracker("Chat tail");
  tracker.arm();
  tracker.publish(
    "Chat tail\n/resetagent@Nguyenanh_fo4_bot\n/resetagentx\nresetagent"
  );

  assert.deepEqual(tracker.takeCommands(), ["resetagent"]);
});

test("consuming /stopagent does not discard a queued /startagent", () => {
  const tracker = createChatTextTracker("Chat tail");
  tracker.arm();
  tracker.publish("Chat tail\n/stopagent\n/startagent\n/resetagent");

  assert.equal(tracker.takeCommand("stopagent"), "stopagent");
  assert.deepEqual(
    tracker.takeCommandsMatching(["stopagent", "startagent"]),
    ["startagent"]
  );
  assert.equal(tracker.takeNextCommand(), "resetagent");
});

test("accepts only fresh /startagent and /stopagent chat commands", () => {
  const oldHistory = "Older chat\n/startagent\n/stopagent";
  const tracker = createChatTextTracker(oldHistory);
  tracker.arm();

  assert.deepEqual(tracker.takeCommands(), []);

  const currentChat = `${oldHistory}\n/startagent`;
  tracker.publish(currentChat);
  assert.deepEqual(tracker.takeCommands(), ["startagent"]);

  tracker.publish(currentChat);
  assert.deepEqual(tracker.takeCommands(), []);

  tracker.publish(`${currentChat}\n/stopagent`);
  assert.deepEqual(tracker.takeCommands(), ["stopagent"]);
});

test("supports Telegram command suffixes and ignores similarly named commands", () => {
  const tracker = createChatTextTracker();
  tracker.arm();
  tracker.publish(
    "/startagent@Nguyenanh_fo4_bot\n/start\n/stopagentx\n" +
      "/stopagent@Nguyenanh_fo4_bot\n/resetagentx"
  );

  assert.deepEqual(tracker.takeCommands(), ["startagent", "stopagent"]);
});

test("recognizes a stopped Auto Mua Phôi cycle from the bot confirmation", () => {
  const activeNotice =
    "Đang treo mua cho chatId 1917864682. Chat /stopauto để dừng.";
  const stopConfirmation =
    "Đã dừng treo auto mua cho chatId 1917864682\n" +
    "Đã gửi lệnh dừng worker. Vui lòng đợi xác nhận từ hệ thống.";
  const chat = `${activeNotice}\n${stopConfirmation}`;

  assert.equal(countStoppedNotices(chat), 1);
  assert.equal(hasNewStoppedNotice(chat, 0), true);
  assert.equal(hasNewStoppedNotice(chat, 0, 0, false), true);
  assert.equal(getExistingAutoBuyCycle(chat), null);
});

test("a generic stop confirmation from another worker does not stop the Auto Mua Phoi cycle", () => {
  const baseline = getCycleBaseline(
    "Bắt đầu treo auto mua\nĐang treo mua cho chatId 1917864682"
  );
  const chat =
    "Bắt đầu treo auto mua\n" +
    "Đang treo mua cho chatId 1917864682\n" +
    "Đang dừng tất cả luồng...\n" +
    "Đã dừng 1 luồng thành công.";

  assert.equal(hasNewStoppedNotice(chat, baseline.stopped), true);
  assert.equal(
    hasNewStoppedNotice(
      chat,
      baseline.stopped,
      baseline.autoBuyStopped,
      false
    ),
    false
  );
  assert.equal(getExistingAutoBuyCycle(chat)?.status, "running");
});

test("does not reuse an old bot stop-all confirmation", () => {
  const oldConfirmation = "Đã dừng 1 luồng thành công.";
  const baseline = getCycleBaseline(oldConfirmation);

  assert.equal(hasNewStoppedNotice(oldConfirmation, baseline.stopped), false);
});

test("recognizes a fresh full-inventory stop and does not restart the purchase loop", () => {
  const activeCycle =
    "Bắt đầu treo auto mua (worker 123).\n" +
    "Đang treo mua cho chatId 1917864682.";
  const fullInventoryStop =
    "❌ /account reason=43: Toàn bộ kho và TTCN đã bị đầy. Vui lòng kiểm tra.\n" +
    "🚫 Lệnh auto mua đã bị dừng.\n" +
    "Đã nhận 76 cầu thủ nhưng không mua. Tiếp tục mua...";
  const baseline = getCycleBaseline(activeCycle);
  const chat = `${activeCycle}\n${fullInventoryStop}`;

  assert.equal(countFullInventoryStops(chat), 1);
  assert.equal(
    hasNewFullInventoryStop(chat, baseline.inventoryFullStops),
    true
  );
  assert.equal(getExistingAutoBuyCycle(chat), null);
});

test("recognizes the compact reason-43 auto-buy stop wording", () => {
  const activeCycle =
    "Đang treo mua cho chatId 1917864682.";
  const compactStop =
    "❌ /account reason=43: Kho và TTCN đầy. 🔴 Dừng auto mua.";
  const baseline = getCycleBaseline(activeCycle);
  const chat = `${activeCycle}\n${compactStop}`;

  assert.equal(countFullInventoryStops(chat), 1);
  assert.equal(hasNewFullInventoryStop(chat, baseline.inventoryFullStops), true);
  assert.deepEqual(getCycleOutcomeFromFresh(compactStop, chat), {
    status: "inventory-full"
  });
});

test("recognizes the inventory receipt acknowledgement after a full stop", () => {
  const receipt = "Đã nhận 81 cầu thủ trong kho mua. Tiếp tục mua...";
  assert.equal(countInventoryReceivedNotices(receipt), 1);
  assert.equal(getLatestInventoryReceived(receipt), 81);
  assert.equal(
    getCycleBaseline(`${receipt}\n${receipt}`).inventoryReceived,
    2
  );
});

test("does not reuse an old full-inventory stop or let it override a later run", () => {
  const oldStop =
    "❌ /account reason=43: Toàn bộ kho và TTCN đã bị đầy. Vui lòng kiểm tra.\n" +
    "🚫 Lệnh auto mua đã bị dừng.";
  const baseline = getCycleBaseline(oldStop);

  assert.equal(hasNewFullInventoryStop(oldStop, baseline.inventoryFullStops), false);
  assert.equal(
    getExistingAutoBuyCycle(`${oldStop}\nBắt đầu treo auto mua\nĐang treo mua cho chatId 1917864682`)?.status,
    "running"
  );
});

test("recognizes both bot replies that indicate there are no active orders", () => {
  for (const reply of [
    "E003: Hiện không có lệnh nào đang chạy.",
    "E003: Không có worker nào đang chạy cho tài khoản này."
  ]) {
    const baseline = getStopCheckBaseline("Older chat history");

    assert.equal(
      getStopCheckResult(`Older chat history\n${reply}`, baseline),
      "auto-buy-not-running"
    );
  }
});

test("does not mistake an old stop confirmation for a new cycle stop", () => {
  const oldStop =
    "Đã dừng treo auto mua cho chatId 1917864682\n" +
    "Đã gửi lệnh dừng worker. Vui lòng đợi xác nhận từ hệ thống.";

  assert.equal(hasNewStoppedNotice(oldStop, countStoppedNotices(oldStop)), false);
});

test("a later start or completion supersedes an earlier stop confirmation", () => {
  const oldStop = "Đã dừng treo auto mua cho chatId 1917864682";
  const startedAfterStop = `${oldStop}\nBắt đầu treo auto mua`;
  const completedAfterStop = `${oldStop}\nĐã mua đủ 3 cầu thủ`;

  assert.equal(hasNewStoppedNotice(startedAfterStop, 0), false);
  assert.equal(hasNewStoppedNotice(completedAfterStop, 0), false);
});

test("detects an active Auto Mua Phôi notice from the bot", () => {
  const botNotice =
    "Đang treo mua cho chatId `1917864682`. Chat `/stopauto` để dừng.";
  assert.equal(getExistingAutoBuyCycle(botNotice)?.status, "running");
  assert.equal(
    getExistingAutoBuyCycle(`${botNotice}\nĐã mua đủ 14 cầu thủ`),
    null,
    "a later completion means the activity notice is no longer current"
  );

  const previousChat = "No active orders";
  const baseline = getStopCheckBaseline(previousChat);

  assert.equal(
    getStopCheckResult(`${previousChat}\n${botNotice}`, baseline),
    "auto-buy-running"
  );
});

test("detects a pre-existing Auto Mua Phôi cycle from chat history", () => {
  const activity =
    "Đang treo mua cho chatId `1917864682`. Chat /stopauto để dừng.";
  const cycle = getExistingAutoBuyCycle(
    `Lịch sử cũ\n${activity}\nMua thành công!\nSPID: 123`
  );

  assert.deepEqual(cycle, {
    status: "running",
    baseline: getCycleBaseline(
      `Lịch sử cũ\n${activity}\nMua thành công!\nSPID: 123`
    )
  });
});

test("does not detect a pre-existing cycle when a completion follows its activity log", () => {
  const activity =
    "Đang treo mua cho chatId `1917864682`. Chat /stopauto để dừng.";

  assert.equal(
    getExistingAutoBuyCycle(`${activity}\nĐã mua đủ 1 cầu thủ`),
    null
  );
});

test("a purchase completion after an active notice means the worker is no longer running", () => {
  const active =
    "Đang treo mua cho chatId 1917864682. Chat /stopauto để dừng.";
  const completed = "Đã mua đủ 14 cầu thủ";
  const baseline = getStopCheckBaseline(active);
  const newStopMenu =
    "Chọn luồng cần dừng cho chatId 1917864682:\n" +
    "Mua phôi | 1791335376673-1917864682-muaphôi";

  assert.equal(
    getStopCheckResult(`${active}\n${completed}`, baseline),
    "auto-buy-not-running"
  );
  assert.equal(
    getStopCheckResult(`${active}\n${completed}\n${newStopMenu}`, baseline),
    "auto-buy-not-running",
    "a stale Mua phôi menu entry must not override a later completion"
  );
});

test("a new active notice after completion still means Auto Mua Phôi is running", () => {
  const chat =
    "Đang treo mua cho chatId 1917864682\n" +
    "Đã mua đủ 14 cầu thủ\n" +
    "Đang treo mua cho chatId 1917864682";
  const baseline = getStopCheckBaseline(
    "Đang treo mua cho chatId 1917864682\nĐã mua đủ 14 cầu thủ"
  );

  assert.equal(getStopCheckResult(chat, baseline), "auto-buy-running");
});

test("detects Auto Mua Phôi in a fresh /stop menu", () => {
  const baseline = getStopCheckBaseline("Older chat history");
  const stopMenu =
    "Chọn luồng cần dừng cho chatId 1917864682:\n" +
    "Mua phôi | 1791335376673-1917864682-muaphôi\n" +
    "Dừng tất cả |";

  assert.equal(
    getStopCheckResult(`Older chat history\n${stopMenu}`, baseline),
    "auto-buy-running"
  );
});

test("ignores unrelated worker types when a fresh /stop menu has no Mua phôi", () => {
  const baseline = getStopCheckBaseline("Older chat history");
  const stopMenu =
    "Chọn luồng cần dừng cho chatId 1917864682:\n" +
    "Chuyển hàng | 1791335376673-1917864682-transfer\n" +
    "VIP | 1791335376673-1917864682-vip\n" +
    "Thường | 1791338289811-1917864682-normal\n" +
    "🛑 Dừng tất cả       ❌ Đóng";

  assert.equal(
    getStopCheckResult(`Older chat history\n${stopMenu}`, baseline),
    "auto-buy-not-running"
  );
});

test("uses only the latest /stop menu when older menus list Auto Mua Phôi", () => {
  const previousMenu =
    "Chọn luồng cần dừng cho chatId 1917864682:\n" +
    "Mua phôi | 1791335376673-1917864682-muaphôi";
  const baseline = getStopCheckBaseline(previousMenu);
  const latestMenu =
    "Chọn luồng cần dừng cho chatId 1917864682:\n" +
    "VIP | 1791338289811-1917864682-vip";

  assert.equal(
    getStopCheckResult(`${previousMenu}\n${latestMenu}`, baseline),
    "auto-buy-not-running"
  );
});

test("recognizes a fresh /stop confirmation when there are no running orders", () => {
  const previousChat = "Older chat history";
  const baseline = getStopCheckBaseline(previousChat);
  const reply = "Hiện không có lệnh nào đang chạy.";

  assert.equal(
    getStopCheckResult(`${previousChat}\n${reply}`, baseline),
    "auto-buy-not-running"
  );
});

test("does not reuse an old no-running confirmation", () => {
  const oldReply = "Hiện không có lệnh nào đang chạy.";
  const baseline = getStopCheckBaseline(oldReply);

  assert.equal(getStopCheckResult(oldReply, baseline), null);
});

test("ignores old activity notices and stop menus instead of treating them as current", () => {
  const oldResponses =
    "Đang treo mua cho chatId 1917864682. Chat /stopauto để dừng.\n" +
    "Chọn luồng cần dừng cho chatId 1917864682:\n" +
    "Mua phôi | 1791335376673-1917864682-muaphôi";
  const baseline = getStopCheckBaseline(oldResponses);

  assert.equal(getStopCheckResult(oldResponses, baseline), null);
});

test("reuses the feature menu after a long 14-player purchase cycle", () => {
  const purchaseHistory = Array.from(
    { length: 14 },
    (_, index) =>
      `Mua thành công! SPID: ${String(index).repeat(9)} ` +
      `Grade: 4 Price: 569.000 BP. ${"Chi tiết giao dịch ".repeat(100)}`
  ).join("\n");
  const longCycleChat =
    "Bot: Bạn muốn sử dụng tính năng nào? Auto Mua Phôi\n" +
    purchaseHistory +
    "\nĐã mua đủ 14 cầu thủ";

  assert.ok(longCycleChat.length > 10_000);
  assert.equal(hasRecentFeatureMenu(longCycleChat), true);
  assert.equal(getFeatureMenuAction(longCycleChat), "select-auto-buy");
});

test("reuses a visible feature menu even when a completion message follows it", () => {
  assert.equal(
    hasRecentFeatureMenu(
      "Lịch sử cũ: Bạn muốn sử dụng tính năng nào? Auto Mua Phôi\n" +
        "x".repeat(100_500) +
        "Tin nhắn mới"
    ),
    false
  );
  assert.equal(
    hasRecentFeatureMenu(
      "Bot: Bạn muốn sử dụng tính năng nào? Auto Mua Phôi"
    ),
    true
  );
  assert.equal(
    hasRecentFeatureMenu(
      "Bot: Bạn muốn sử dụng tính năng nào? Auto Mua Phôi\n" +
        "Đã mua đủ 14 cầu thủ"
    ),
    true
  );
});

test("recognizes the current feature menu even without the old prompt", () => {
  const menu =
    "online Tra cứu giờ Reset Online Nâng Cấp Cầu Thủ Auto Mua Phôi " +
    "Auto GLXH Auto Nâng Cấp 2.0 Auto Nâng Cấp 1.0 BẮN TỈA CT 2,0 " +
    "Chèn Vip Member Chèn Chuyển Hàng";

  assert.equal(hasRecentFeatureMenu(menu), true);
  assert.equal(getFeatureMenuAction(menu), "select-auto-buy");
  assert.equal(hasFreshFeatureMenu("Lịch sử cũ", `Lịch sử cũ\n${menu}`), true);
  // Một câu thông báo đơn lẻ có tên chức năng không được coi là menu.
  assert.equal(hasRecentFeatureMenu("Auto Mua Phôi đang chạy"), false);
});

test("sends /tn only when the feature menu is outside the readable chat history", () => {
  const oldMenu =
    "Bạn muốn sử dụng tính năng nào? Auto Mua Phôi\n" +
    "x".repeat(100_500) +
    "Đã mua đủ 1 cầu thủ";

  assert.equal(hasRecentFeatureMenu(oldMenu), false);
  assert.equal(getFeatureMenuAction(oldMenu), "send-tn");
});

test("does not treat an old feature menu as the response to /tn", () => {
  const baseline = "Bạn muốn sử dụng tính năng nào? Auto Mua Phôi";
  assert.equal(
    hasFreshFeatureMenu(baseline, `${baseline}\nE003: Hiện không có lệnh nào đang chạy.`),
    false
  );
  assert.equal(
    hasFreshFeatureMenu(
      baseline,
      `${baseline}\nBạn muốn sử dụng tính năng nào? Auto Mua Phôi`
    ),
    true
  );
});

test("finds the Auto Mua button when /tn returns a fresh menu", async () => {
  const oldText = "Lịch sử cũ";
  const reader = createChatTextTracker(
    `${oldText}\nBạn muốn sử dụng tính năng nào? Auto Mua Phôi`
  );
  reader.arm();
  const button = { isVisible: async () => true };
  const page = {
    getByRole: () => ({
      count: async () => 1,
      last: () => button
    }),
    locator: () => ({ filter: () => ({}) })
  };
  chatTextReaders.set(page, reader);

  const result = await waitForMenuReply(page, 1_000, {
    systemErrors: 0,
    rateLimit: 0,
    text: oldText
  });
  assert.equal(result.status, "menu");
  assert.equal(result.button, button);
});

test("finds the Auto Mua button when Telegram replaces the snapshot with the current menu", async () => {
  const menu =
    "online Tra cứu giờ Reset Online Nâng Cấp Cầu Thủ Auto Mua Phôi " +
    "Auto GLXH Auto Nâng Cấp 2.0 Auto Nâng Cấp 1.0 BẮN TỈA CT 2,0 " +
    "Chèn Vip Member Chèn Chuyển Hàng";
  const reader = createChatTextTracker(menu);
  reader.arm();
  const button = { isVisible: async () => true };
  const page = {
    getByRole: () => ({
      count: async () => 1,
      last: () => button
    }),
    locator: () => ({ filter: () => ({}) })
  };
  chatTextReaders.set(page, reader);

  const result = await waitForMenuReply(page, 1_000, {
    systemErrors: 0,
    rateLimit: 0,
    text: "Lịch sử cũ không còn trong snapshot"
  });
  assert.equal(result.status, "menu");
  assert.equal(result.button, button);
});

test("recognizes a new purchase completion after the baseline", () => {
  const completedByTarget = "Đã mua đủ 14 cầu thủ";
  const completedByTimeout = "Hết thời gian treo. Hoàn thành mua 11 cầu thủ.";
  assert.deepEqual(parseCompletionNotices(completedByTarget), [14]);
  assert.deepEqual(parseCompletionNotices(completedByTimeout), [11]);

  const priorCompletion = "Đã mua đủ 9 cầu thủ";
  const baseline = getCycleBaseline(priorCompletion);
  assert.equal(
    getNewCompletionNotice(`${priorCompletion}\n${completedByTarget}`, baseline.completions),
    14
  );
  assert.equal(
    getNewCompletionNotice(`${priorCompletion}\n${completedByTimeout}`, baseline.completions),
    11
  );
  assert.equal(
    getNewCompletionNotice(priorCompletion, baseline.completions),
    null,
    "a completion already present before waiting is not treated as new"
  );
  assert.equal(
    getNewCompletionNotice(
      `${priorCompletion}\n${completedByTarget}\nBắt đầu treo auto mua`,
      baseline.completions
    ),
    null,
    "an active run newer than the completion is still running"
  );
});

test("detects cycle completion after Telegram trims older chat messages", () => {
  const previousHistory = Array.from(
    { length: 14 },
    (_, index) => `Đã mua đủ ${index + 1} cầu thủ`
  ).join("\n");
  const cycleActivity =
    "Bắt đầu treo auto mua (worker cycle-20261009).\n" +
    "Đang treo mua cho chatId 1917864682.";
  const baseline = getCycleBaseline(`${previousHistory}\n${cycleActivity}`);
  const trimmedChat =
    `${cycleActivity}\nMua thành công! SPID: 123456789 Grade: 4 Price: 569.000 BP\n` +
    "Đã mua đủ 14 cầu thủ";

  assert.equal(parseCompletionNotices(trimmedChat).length, 1);
  assert.ok(parseCompletionNotices(trimmedChat).length < baseline.completions);
  assert.equal(getCycleCompletionNotice(trimmedChat, baseline), 14);
});

test("detects completion when Telegram replaces the snapshot with the same count", () => {
  const baselineText =
    "Đã mua đủ 14 cầu thủ\n" +
    "Đã mua đủ 14 cầu thủ\n" +
    "Đã mua đủ 14 cầu thủ\n" +
    "Đang treo mua cho chatId 1917864682. cycle-old";
  const currentText =
    "Đã mua đủ 14 cầu thủ\n" +
    "Đã mua đủ 14 cầu thủ\n" +
    "Đang treo mua cho chatId 1917864682. cycle-new\n" +
    "Đã mua đủ 14 cầu thủ";
  const baseline = getCycleBaseline(baselineText);
  assert.equal(parseCompletionNotices(currentText).length, baseline.completions);
  assert.equal(getCycleCompletionNotice(currentText, baseline), 14);
});

test("does not reuse a completion from before the current purchase cycle", () => {
  const earlierCompletion = "Đã mua đủ 14 cầu thủ";
  const currentActivity =
    "Bắt đầu treo auto mua (worker cycle-new).\n" +
    "Đang treo mua cho chatId 1917864682.";
  const baseline = getCycleBaseline(
    `${earlierCompletion}\n${currentActivity}`
  );

  assert.equal(
    getCycleCompletionNotice(
      `${earlierCompletion}\n${currentActivity}`,
      baseline
    ),
    null
  );
  assert.equal(
    getCycleCompletionNotice(
      `${earlierCompletion}\n${currentActivity}\nĐã mua đủ 14 cầu thủ`,
      baseline
    ),
    14
  );
});

test("does not reuse an unchanged completion when the active notice is still current", () => {
  const activity = "Đang treo mua cho chatId 1917864682.";
  const history = `${activity}\nĐã mua đủ 14 cầu thủ`;
  const baseline = getCycleBaseline(history);

  assert.equal(getCycleCompletionNotice(history, baseline), null);
});

test("recognizes the one-player completion after its worker and purchase logs", () => {
  const priorChat = "Older Telegram history";
  const cycleStart =
    "Bắt đầu treo auto mua (worker 1791422710232-1917864682-muaphôi). " +
    "Tổng cần mua: 1. Mỗi lần cố gắng mua: 1 cầu thủ.";
  const active =
    "Đang treo mua cho chatId 1917864682. Chat /stopauto để dừng.";
  const purchase = "Mua thành công! SPID: 829192448 Grade: 4 Price: 569.000 BP";
  const completion = "Đã mua đủ 1 cầu thủ.";
  const baseline = getCycleBaseline(priorChat);
  const chat = [priorChat, cycleStart, active, purchase, completion].join("\n");

  assert.deepEqual(parseCompletionNotices(chat), [1]);
  assert.equal(getNewCompletionNotice(chat, baseline.completions), 1);
  assert.equal(
    hasRecentFeatureMenu(
      `${chat}\nBạn muốn sử dụng tính năng nào? Auto Mua Phôi`
    ),
    true
  );
});

test("starts a fresh cycle after a prior stopped worker finishes without reusing its completion", () => {
  const oldCycle = [
    "Đã dừng treo auto mua cho chatId 1917864682",
    "Đã gửi lệnh dừng worker. Vui lòng đợi xác nhận từ hệ thống.",
    "Bắt đầu treo auto mua (worker old-1917864682-muaphôi).",
    "Đang treo mua cho chatId 1917864682. Chat /stopauto để dừng.",
    "Mua thành công! SPID: 863260697 Grade: 3 Price: 628.000 BP",
    "Đã mua đủ 1 cầu thủ"
  ].join("\n");

  assert.equal(
    getExistingAutoBuyCycle(oldCycle),
    null,
    "a completed worker left in chat history must not be treated as still running"
  );

  const nextCycleBaseline = getCycleBaseline(oldCycle);
  assert.equal(
    getNewCompletionNotice(oldCycle, nextCycleBaseline.completions),
    null,
    "the old completion must not complete the new cycle"
  );

  const nextCycle = [
    oldCycle,
    "Bắt đầu treo auto mua (worker new-1917864682-muaphôi).",
    "Đang treo mua cho chatId 1917864682. Chat /stopauto để dừng.",
    "Mua thành công! SPID: 123456789 Grade: 3 Price: 628.000 BP",
    "Đã mua đủ 1 cầu thủ"
  ].join("\n");

  assert.equal(
    getNewCompletionNotice(nextCycle, nextCycleBaseline.completions),
    1
  );
});

test("fresh-text scan returns only appended messages and survives head trimming", () => {
  const baseline = "H1-history\nH2-history\nBắt đầu treo auto mua (w1)\nĐang treo mua cho chatId 1";
  const extended = `${baseline}\nMua thành công! SPID: 1`;
  assert.equal(getFreshSince(baseline, extended), "\nMua thành công! SPID: 1");
  assert.equal(getFreshSince(baseline, baseline), null);

  // Telegram cắt đầu chat nhưng neo 256 ký tự cuối vẫn còn: vẫn tách được tin mới.
  const longTail = `${"M".repeat(500)} end`;
  const longBaseline = `old-head-DROPPED\n${longTail}`;
  const trimmedCurrent = `${longTail}\nĐã mua đủ 1 cầu thủ`;
  assert.equal(getFreshSince(longBaseline, trimmedCurrent), "\nĐã mua đủ 1 cầu thủ");

  // Snapshot bị thay hẳn, không còn điểm chung: không suy đoán.
  assert.equal(
    getFreshSince(baseline, "Unrelated replaced snapshot without any overlap 987654321"),
    null
  );
});

test("start acknowledgement survives trimming that shrinks absolute counts", () => {
  const history = Array.from(
    { length: 5 },
    (_, index) => `Bắt đầu treo auto mua (worker-old-${index})`
  ).join("\n");
  const baseline = {
    started: 5,
    marker: getLatestStartedMarker(history)
  };
  // Telegram trim mất đầu chat, chỉ còn marker cũ: không báo ack giả.
  const trimmedOnly = "Bắt đầu treo auto mua (worker-old-4)";
  assert.equal(hasNewStartAcknowledgement(trimmedOnly, baseline), false);
  // Chu kỳ mới của agent xuất hiện marker khác: ack dù tổng số đã giảm do trim.
  const trimmedWithNewStart =
    "Bắt đầu treo auto mua (worker-old-4)\nBắt đầu treo auto mua (worker-new-abc)";
  assert.equal(hasNewStartAcknowledgement(trimmedWithNewStart, baseline), true);
});

test("cycle completion is found in fresh text despite head trim and manual GLXH noise", () => {
  const glxhNoise =
    "Thông tin rank: Kết quả trận gần nhất: W | L\n" +
    "Hoàn tất Auto GLXH, tổng cộng 7 trận\n" +
    "Bạn muốn sử dụng tính năng nào? Auto GLXH";
  const purchaseSpam = Array.from(
    { length: 10 },
    (_, index) => `Mua thành công! SPID: 10000000${index} Grade: 4 Price: 569.000 BP`
  ).join("\n");
  const sharedTail =
    "Bắt đầu treo auto mua (worker cycle-1)\n" +
    "Đang treo mua cho chatId 1\n" +
    `${purchaseSpam}`;
  const longHistory =
    Array.from({ length: 20 }, (_, index) => `Đã mua đủ ${index + 1} cầu thủ`).join("\n") +
    `\n${sharedTail}`;
  // Telegram trim đầu chat (đoạn lịch sử cũ), neo cuối baseline vẫn còn.
  const trimmedCurrent = `${sharedTail}\n${glxhNoise}\nĐã mua đủ 3 cầu thủ`;
  const fresh = getFreshSince(longHistory, trimmedCurrent);
  assert.ok(fresh && fresh.includes("Đã mua đủ 3 cầu thủ"));
  assert.ok(fresh && fresh.includes("Hoàn tất Auto GLXH"));
  assert.deepEqual(getCycleOutcomeFromFresh(fresh, trimmedCurrent), {
    status: "completed",
    playersBought: 3
  });
  // Chưa có completion: không báo hoàn tất giả dù lẫn tin GLXH.
  const withoutCompletion = `${sharedTail}\n${glxhNoise}`;
  const freshNoise = getFreshSince(longHistory, withoutCompletion);
  assert.equal(
    getCycleOutcomeFromFresh(freshNoise, withoutCompletion),
    null
  );
});

test("an old E006 in the baseline tail does not retrigger a system error", () => {
  const baseline =
    "Bắt đầu treo auto mua (w1)\nE006: Lỗi hệ thống, vui lòng thử lại sau hoặc liên hệ hỗ trợ.";
  const current = `${baseline}\nMua thành công! SPID: 1 Grade: 4 Price: 569.000 BP`;
  const fresh = getFreshSince(baseline, current);
  assert.equal(getCycleOutcomeFromFresh(fresh, current), null);

  const withNewError = `${current}\nE006: Lỗi hệ thống, vui lòng thử lại sau hoặc liên hệ hỗ trợ.`;
  const freshError = getFreshSince(baseline, withNewError);
  assert.deepEqual(getCycleOutcomeFromFresh(freshError, withNewError), {
    status: "system-error"
  });
});

test("/stop check from fresh text ignores interleaved manual GLXH traffic", () => {
  const baselineText = "Bắt đầu treo auto mua (w1)\nĐang treo mua cho chatId 1";
  const glxhNoise =
    "Thông tin rank: Kết quả trận gần nhất: W | L\nHoàn tất Auto GLXH, tổng cộng 7 trận";
  const baseline = getStopCheckBaseline(baselineText);

  const withMenu =
    `${baselineText}\n${glxhNoise}\n` +
    "Chọn luồng cần dừng cho chatId 1:\nMua phôi | worker-muaphoi";
  assert.equal(
    classifyFreshStopReply(getFreshSince(baselineText, withMenu), withMenu),
    "auto-buy-running"
  );
  assert.equal(getStopCheckResult(withMenu, baseline, baselineText), "auto-buy-running");

  const withNoRunning =
    `${baselineText}\n${glxhNoise}\nE003: Hiện không có lệnh nào đang chạy.`;
  assert.equal(
    classifyFreshStopReply(getFreshSince(baselineText, withNoRunning), withNoRunning),
    "auto-buy-not-running"
  );
  assert.equal(getStopCheckResult(withNoRunning, baseline, baselineText), "auto-buy-not-running");

  // Chỉ có tin thủ công, chưa có reply của /stop: chưa kết luận được.
  const noiseOnly = `${baselineText}\n${glxhNoise}`;
  assert.equal(
    classifyFreshStopReply(getFreshSince(baselineText, noiseOnly), noiseOnly),
    null
  );
});

test("stop confirmation from fresh text ignores generic stops of manual workers", () => {
  const baselineText = "Bắt đầu treo auto mua (w1)\nĐang treo mua cho chatId 1";
  const genericStop = `${baselineText}\nĐang dừng tất cả luồng...\nĐã dừng 1 luồng thành công.`;
  assert.equal(
    hasFreshStopConfirmation(getFreshSince(baselineText, genericStop), genericStop),
    false
  );
  const autoBuyStop = `${baselineText}\nĐã dừng treo auto mua cho chatId 1`;
  assert.equal(
    hasFreshStopConfirmation(getFreshSince(baselineText, autoBuyStop), autoBuyStop),
    true
  );
  const completedStop = `${baselineText}\nĐã mua đủ 2 cầu thủ`;
  assert.equal(
    hasFreshStopConfirmation(getFreshSince(baselineText, completedStop), completedStop),
    true
  );
  assert.equal(
    getLatestCompletionAfterActivity("Bắt đầu treo auto mua\nĐã mua đủ 2 cầu thủ"),
    2
  );
  assert.equal(
    getLatestCompletionAfterActivity("Đã mua đủ 2 cầu thủ\nBắt đầu treo auto mua"),
    null
  );
});

test("rate-limit delay is read from fresh text for timely retries", () => {
  const baselineText = "Bắt đầu treo auto mua (w1)";
  const warning =
    "Bạn thao tác quá nhanh. Thời gian thao tác giữa các chức năng tối thiểu là 2s. " +
    "Vui lòng chờ 4s rồi thử lại.";
  const current = `${baselineText}\n${warning}`;
  assert.equal(getFreshRateLimitDelay(getFreshSince(baselineText, current)), 4_000);
  assert.equal(getFreshRateLimitDelay(getFreshSince(baselineText, baselineText)), null);
});

test("typo control commands produce a hint instead of silent ignore", () => {
  assert.equal(findNearMissControlCommand("lịch sử\n/resetagemt 11:27"), "/resetagemt");
  assert.equal(findNearMissControlCommand("/stopagentx rồi"), "/stopagentx");
  assert.equal(findNearMissControlCommand("/startagent\n/stopagent"), null);
  assert.equal(findNearMissControlCommand("/stopauto để dừng"), null);
  assert.equal(findNearMissControlCommand("/resetagent@Nguyenanh_fo4_bot"), null);
  assert.equal(findNearMissControlCommand("/startmua\n/startnang"), null);
  assert.equal(findNearMissControlCommand("/starticon"), null);
  assert.equal(findNearMissControlCommand("/startmuay"), null);
  assert.equal(findNearMissControlCommand("/starticonx"), null);
  assert.equal(findNearMissControlCommand("tin thường không lệnh"), null);
});

test("latest worker id distinguishes own cycle from adopted one", () => {
  const chat =
    "Bắt đầu treo auto mua (worker 1791-old-muaphoi).\n" +
    "Đã mua đủ 14 cầu thủ\n" +
    "Bắt đầu treo auto mua (worker 1792-new-muaphoi).";
  assert.equal(getLatestWorkerId(chat), "1792-new-muaphoi");
  assert.equal(getLatestWorkerId("không có worker"), null);
});

test("only the unified control commands queue in order with suffixes", () => {
  const tracker = createChatTextTracker("Chat tail");
  tracker.arm();
  tracker.publish(
    "Chat tail\n/startagent\n/startmua\n/startnang\n/starticon\n/stopagent\n/resetagent"
  );
  assert.deepEqual(tracker.takeCommands(), [
    "startagent",
    "stopagent",
    "resetagent"
  ]);
  assert.deepEqual(CONTROL_START_COMMANDS, ["startagent"]);
});

test("stop flow consumes stop plus any start variant, keeping reset", () => {
  const tracker = createChatTextTracker("Chat tail");
  tracker.arm();
  tracker.publish("Chat tail\n/stopagent\n/startnang\n/resetagent");
  assert.deepEqual(
    tracker.takeCommandsMatching(["stopagent", ...CONTROL_START_COMMANDS]),
    ["stopagent"]
  );
  assert.equal(tracker.takeNextCommand(), "resetagent");
});

test("new start commands accept bot suffixes", () => {
  const tracker = createChatTextTracker();
  tracker.arm();
  tracker.publish(
    "/startmua@Nguyenanh_fo4_bot\n/startnang@Nguyenanh_fo4_bot\n" +
      "/starticon@Nguyenanh_fo4_bot\n/startmuax\n/starticonx"
  );
  assert.deepEqual(tracker.takeCommands(), []);
});

test("typo hints fire only for new messages, never for old history", () => {
  const history = "Lịch sử cũ\n/resetagemt 11:27";
  assert.equal(findNewNearMissControlCommand(history, history), null);
  assert.equal(
    findNewNearMissControlCommand(history, `${history}\nMua thành công!`),
    null
  );
  assert.equal(
    findNewNearMissControlCommand(history, `${history}\n/stopotent 12:00`),
    "/stopotent"
  );
  assert.equal(
    findNewNearMissControlCommand(`${history}\n/stopotent 12:00`, `${history}\n/stopotent 12:00`),
    null
  );
});

test("bot system errors throw with a recoverable code", () => {
  assert.throws(() => throwBotSystemError("lúc kiểm tra"), (error) => {
    assert.equal(error.code, "BOT_SYSTEM_ERROR");
    return true;
  });
});

test("stop confirmation merges fresh, orphan, count and no-running signals", () => {
  const baselineText = "Bắt đầu treo auto mua (w1)\nĐang treo mua cho chatId 1";
  const baseline = getCycleBaseline(baselineText);
  const stopped = `${baselineText}\nĐã dừng treo auto mua cho chatId 1`;
  assert.equal(
    isStopConfirmed(stopped, getFreshSince(baselineText, stopped), baseline),
    true
  );
  const completed = `${baselineText}\nĐã mua đủ 3 cầu thủ`;
  assert.equal(
    isStopConfirmed(completed, getFreshSince(baselineText, completed), baseline),
    true
  );
  const running = `${baselineText}\nMua thành công! SPID: 1`;
  assert.equal(
    isStopConfirmed(running, getFreshSince(baselineText, running), baseline),
    false
  );
});

test("terminal outcomes map to idle messages, completions do not", () => {
  assert.match(idleOutcomeMessage({ status: "system-error" }), /E006/);
  assert.match(idleOutcomeMessage({ status: "inventory-full" }), /đầy/);
  assert.match(idleOutcomeMessage({ status: "purchase-stopped" }), /chờ \/startagent/);
  assert.equal(idleOutcomeMessage({ status: "completed" }), null);
  assert.equal(idleOutcomeMessage({ status: "stop-requested" }), null);
});

test("buy resumes after upgrade only on evidence the inventory changed", () => {
  assert.equal(
    shouldResumeBuyAfterUpgrade({ reachedTarget: true, outOfMaterial: false }, 3),
    true
  );
  assert.equal(
    shouldResumeBuyAfterUpgrade({ success: 0, finalGrade: 5, reason: "x" }, 3),
    true,
    "grade moved 3->5 means phôi burned even without success flag"
  );
  assert.equal(
    shouldResumeBuyAfterUpgrade({ success: 1, finalGrade: 6 }, 5),
    true
  );
  assert.equal(
    shouldResumeBuyAfterUpgrade(
      { success: 0, finalGrade: 5, reason: "không có nguyên liệu hợp lệ", outOfMaterial: true },
      5
    ),
    false,
    "grade unchanged and out of materials means kho untouched"
  );
  assert.equal(
    shouldResumeBuyAfterUpgrade(
      { success: 0, finalGrade: 2, reason: "không có nguyên liệu hợp lệ", outOfMaterial: true },
      3
    ),
    false,
    "a lower final grade must not restart the buy loop"
  );
  assert.equal(shouldResumeBuyAfterUpgrade(null, 3), false);
  assert.equal(shouldResumeBuyAfterUpgrade({ status: "completed" }, null), false);
});

test("maps the unified start command to the master mode", () => {
  for (const command of CONTROL_START_COMMANDS) {
    assert.ok(
      ["master"].includes(CONTROL_MODE_BY_COMMAND[command]),
      `/${command} phải map sang một mode hợp lệ`
    );
  }
  assert.equal(CONTROL_MODE_BY_COMMAND.startagent, "master");
  assert.equal(CONTROL_MODE_BY_COMMAND.stopagent, undefined);
});

test("withTimeout passes values through and bounds hanging calls", async () => {
  assert.equal(await withTimeout(Promise.resolve(42), 1000, "ok"), 42);
  assert.equal(
    await withTimeout(Promise.reject(new Error("inner boom")), 1000, "ok").catch((e) => e.message),
    "inner boom"
  );
  const start = Date.now();
  await withTimeout(new Promise(() => {}), 50, "treo test").catch((e) => {
    assert.match(e.message, /Playwright timeout sau 50ms: treo test/);
  });
  assert.ok(Date.now() - start < 1000, "timeout fires promptly");
  assert.equal(isPlaywrightTimeout(new Error("Playwright timeout sau 50ms: treo test")), true);
  assert.equal(isPlaywrightTimeout(new Error("Target page, context or browser has been closed")), false);
});

test("purchase lines are recognized for liveness checks, completions are not", () => {
  const count = (s) => [...s.matchAll(PURCHASE_RE)].length;
  const NBSP = " ";
  assert.equal(count("Mua thành công!\nSPID: 840266866 Grade: 1"), 1);
  assert.equal(count(["Mua", "thành", "công! SPID: 1"].join(NBSP)), 1);
  assert.equal(count("Đã mua đủ 14 cầu thủ"), 0);
  assert.equal(count("Đang treo mua cho chatId 1"), 0);
  assert.equal(NBSP.charCodeAt(0), 160);
});

test("orphan terminal in a trimmed window still ends the cycle", () => {
  // Mô phỏng case thực tế: chu kỳ 14 cầu thủ chạy 49 phút, spam tin mua +
  // tin thủ công làm Telegram unload mất dòng activity, chỉ còn completion.
  const trimmedWindow = [
    "Mua thành công! SPID: 840220793 Grade: 1 Price: 523.000 BP",
    "Time: 10/12/2026, 9:12 AM",
    "Mua thành công! SPID: 840211110 Grade: 1 Price: 588.000 BP",
    "Time: 10/12/2026, 9:12 AM",
    "Đã mua đủ 14 cầu thủ"
  ].join("\n");
  assert.deepEqual(getOrphanCycleOutcome(trimmedWindow, true), {
    status: "completed",
    playersBought: 14
  });
  // Không có baseline activity (chưa từng start): không suy đoán.
  assert.equal(getOrphanCycleOutcome(trimmedWindow, false), null);
  // Còn activity trong cửa sổ: để logic thường xử lý, orphan không chen vào.
  const withActivity = `Đang treo mua cho chatId 1\n${trimmedWindow}`;
  assert.equal(getOrphanCycleOutcome(withActivity, true), null);
  // Tin dừng auto-buy mồ côi cũng kết thúc chu kỳ...
  assert.deepEqual(
    getOrphanCycleOutcome("Mua thành công! SPID: 1\nĐã dừng treo auto mua cho chatId 1", true),
    { status: "purchase-stopped" }
  );
  // ...nhưng tin dừng chung chung của worker thủ công khác thì không.
  assert.equal(
    getOrphanCycleOutcome("Hoàn tất Auto GLXH, tổng cộng 7 trận\nĐã dừng 1 luồng thành công.", true),
    null
  );
  // Cửa sổ chỉ có tin thủ công, không có terminal auto-buy: tiếp tục chờ.
  assert.equal(
    getOrphanCycleOutcome("Hoàn tất Auto GLXH, tổng cộng 7 trận", true),
    null
  );
});

test("bot patterns tolerate nbsp whitespace from Telegram Web rendering", () => {
  const nbsp = (s) => s.replace(/ /g, " ");
  assert.deepEqual(parseCompletionNotices(nbsp("Đã mua đủ 14 cầu thủ")), [14]);
  assert.deepEqual(
    parseCompletionNotices(nbsp("Hết thời gian treo. Hoàn thành mua 11 cầu thủ.")),
    [11]
  );
  assert.equal(countStartedNotices(nbsp("Bắt đầu treo auto mua (w1)")), 1);
  assert.equal(
    hasNewStoppedNotice(
      `${nbsp("Đang treo mua cho chatId 1")}\n${nbsp("Đã dừng treo auto mua cho chatId 1")}`,
      0
    ),
    true
  );
  assert.equal(
    hasRecentFeatureMenu(nbsp("Bot: Bạn muốn sử dụng tính năng nào? Auto Mua Phôi")),
    true
  );
  const tracker = createChatTextTracker(nbsp("Lịch sử cũ"));
  tracker.arm();
  tracker.publish(`${nbsp("Lịch sử cũ")}\n/startagent 08:57 ✓✓`);
  assert.deepEqual(tracker.takeCommands(), ["startagent"]);
});

test("no nested function declarations leak across scopes (ReferenceError guard)", () => {
  // Hồi quy: getDetectedUpgradeRun từng bị lồng trong pivotMasterToUpgrade
  // nhưng main() gọi trực tiếp -> ReferenceError lúc chạy mà node --check
  // không bắt được. Shared chat/menu closures now live in lib/features modules.
  const fs = require("node:fs");
  const path = require("node:path");
  const files = [
    "features/controller.js",
    "features/composer.js",
    "features/config.js",
    "features/menu-request.js",
    "features/buy/index.js",
    "features/buy/patterns.js",
    "features/buy/menu.js",
    "features/buy/cycle.js",
    "features/buy/mini-app.js",
    "features/buy/outcome.js",
    "features/upgrade/index.js",
    "features/upgrade/patterns.js",
    "features/upgrade/runner.js",
    "features/upgrade/mini-app.js",
    "features/upgrade/loop.js",
    "features/icon-buy/index.js",
    "features/icon-buy/patterns.js",
    "features/icon-buy/menu.js",
    "features/icon-buy/favorites.js",
    "features/icon-buy/order.js",
    "features/icon-buy/ttcn.js",
    "features/icon-buy/runner.js",
    "features/telegram-io.js",
    "features/agent-log.js",
    "features/interactive-prompt.js"
  ];
  for (const file of files) {
    const src = fs.readFileSync(path.join(__dirname, file), "utf8");
    const nested = [...src.matchAll(/^  (async )?function (\w+)/gm)].map((m) => m[2]);
    const allowed = [];
    assert.deepEqual(
      nested.sort(),
      allowed.sort(),
      `${file} has unexpected nested function declarations`
    );
  }
});

test("controller imports every shared telegram-io helper it calls", () => {
  // Hồi quy: main() gọi closeMiniApp() sau start-ack nhưng controller quên
  // import từ telegram-io -> ReferenceError chỉ lộ ra khi chạy thật.
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "features/controller.js"), "utf8");
  const match = src.match(
    /const\s*\{([\s\S]*?)\}\s*=\s*require\("\.\/telegram-io"\)/
  );
  assert.ok(match, "controller must destructure helpers from ./telegram-io");
  assert.match(match[1], /\bcloseMiniApp\b/);
  const telegramIo = require("./features/telegram-io");
  assert.equal(typeof telegramIo.closeMiniApp, "function");
});

test("controller runs the unified ICON-to-upgrade flow", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "features/controller.js"), "utf8");
  assert.match(src, /const\s*\{\s*createUiLock\s*\}\s*=\s*require\("\.\.\/lib\/ui-lock"\)/);
  assert.match(src, /runIconBuy\(page, rl, \{/);
  assert.match(src, /ensureIconMonitor\(\)/);
  assert.match(src, /có ICON trong kho thì chạy mua phôi và nâng/);
  assert.doesNotMatch(src, /createIconSession|startIconSession|iconSession/);
  assert.doesNotMatch(src, /mode\s*===\s*"icon"/);
  assert.doesNotMatch(src, /mode\s*=\s*"icon"/);
  assert.match(src, /runSingleUpgrade\(page, rl, upgradeBlockedTargetIds, ui\)/);
});

test("buy start ACK timeout re-verifies /stop before clicking again", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const cycleSrc = fs.readFileSync(
    path.join(__dirname, "features/buy/cycle.js"),
    "utf8"
  );
  assert.match(cycleSrc, /BUY_START_ACK_TIMEOUT_MS/);
  assert.match(cycleSrc, /error\.code = "START_ACK_TIMEOUT"/);
  assert.match(cycleSrc, /error\.code = "START_ACK_UNVERIFIED"/);
  assert.match(cycleSrc, /checkAutoBuyRunning\(page, rl\)/);

  const controllerSrc = fs.readFileSync(
    path.join(__dirname, "features/controller.js"),
    "utf8"
  );
  assert.match(controllerSrc, /error\.code === "START_ACK_TIMEOUT"/);
  assert.match(controllerSrc, /error\.code === "START_ACK_UNVERIFIED"/);
  assert.match(controllerSrc, /isEarlyCompletion\(outcome, Date\.now\(\) - cycleStartedAt\)/);
});

test("buy and upgrade stop flows accept only the unified start command", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  for (const file of ["features/buy/cycle.js", "features/upgrade/runner.js"]) {
    const src = fs.readFileSync(path.join(__dirname, file), "utf8");
    assert.doesNotMatch(src, /starticon|phiên ICON nền/);
  }
});

test("/starticon only reads /stop and never stops tasks or cancels unknown orders", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const orderSrc = fs.readFileSync(
    path.join(__dirname, "features/icon-buy/order.js"),
    "utf8"
  );
  const runnerSrc = fs.readFileSync(
    path.join(__dirname, "features/icon-buy/runner.js"),
    "utf8"
  );
  assert.match(orderSrc, /error\.purchaseSent = true/);
  assert.match(orderSrc, /isStopRequested/);
  assert.match(orderSrc, /if \(typeof isStopRequested === "function" && isStopRequested\(\)\)/);
  assert.match(runnerSrc, /captureStopTaskBaseline/);
  assert.doesNotMatch(runnerSrc, /stopNewIconTasks/);
  assert.doesNotMatch(runnerSrc, /cancelUnconfirmedOrders/);
  assert.match(runnerSrc, /if \(error\.purchaseSent\)/);
  assert.match(runnerSrc, /if \(result\.stopped\)/);
  assert.match(runnerSrc, /const usedTaskSlots = countRunningTaskSlots/);
  assert.match(runnerSrc, /getAvailableTaskSlots/);
  assert.match(runnerSrc, /reason: "task-slots-full"/);
  assert.match(runnerSrc, /giữ nguyên phiên ICON và chờ/);
  assert.match(runnerSrc, /reason: "no-purchase-success"/);
  assert.match(runnerSrc, /Không dừng phiên ICON vì/);
  assert.doesNotMatch(runnerSrc, /Dừng tất cả/);
});

test("/starticon fills the 3 MUA slots and loops after canceling a bad order", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const runnerSrc = fs.readFileSync(
    path.join(__dirname, "features/icon-buy/runner.js"),
    "utf8"
  );
  assert.match(runnerSrc, /const availableTaskSlots = getAvailableTaskSlots/);
  assert.match(runnerSrc, /config\.iconBuy\.maxPlayersPerBatch/);
  assert.match(runnerSrc, /config\.iconBuy\.continuous/);
  assert.match(runnerSrc, /slotPollSeconds/);
  assert.match(runnerSrc, /stopOrphanIconTasks\([\s\S]*?cancelTargets/);
});

test("upgrade mini-app imports the telegram-io helpers it calls", () => {
  // Hồi quy: openUpgradeFrame() gọi closeMiniApp() nhưng file quên import,
  // gây ReferenceError chỉ khi chạy thật.
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(
    path.join(__dirname, "features/upgrade/mini-app.js"),
    "utf8"
  );
  const match = src.match(
    /const\s*\{([\s\S]*?)\}\s*=\s*require\("\.\.\/telegram-io"\)/
  );
  assert.ok(match, "upgrade mini-app must import helpers from ../telegram-io");
  assert.match(match[1], /\bcloseMiniApp\b/);
  const telegramIo = require("./features/telegram-io");
  assert.equal(typeof telegramIo.closeMiniApp, "function");
});

test("upgrade run detector is reachable at module scope", () => {
  // Cùng họ bug trên: hàm main() dùng phải tồn tại ở module scope.
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (file) => fs.readFileSync(path.join(__dirname, file), "utf8");
  const upgradeSrc = read("features/upgrade/loop.js");
  assert.ok(/^async function pivotMasterToUpgrade\(page, rl, runUpgrade = runSingleUpgrade, logFn = log, ui = null\)/m.test(upgradeSrc));
  assert.ok(/^async function runSingleUpgrade\(page, rl, blockedTargetIds = new Set\(\), ui = null\)/m.test(upgradeSrc));
  const buyOutcomeSrc = read("features/buy/outcome.js");
  assert.ok(/^async function settleBuyOutcome/m.test(buyOutcomeSrc));
  const buyCycleSrc = read("features/buy/cycle.js");
  assert.ok(/^async function confirmSuspectedWorker/m.test(buyCycleSrc));
});

test("master upgrade phase returns to buying when phôi or targets run out", () => {
  // blocked-target -> blacklist + thử target khác
  assert.equal(decideMasterUpgradePhase("blocked-target"), "continue");
  // hết phôi / hết target khả thi -> quay lại mua phôi
  assert.equal(decideMasterUpgradePhase("no-materials"), "buy");
  assert.equal(decideMasterUpgradePhase("no-targets"), "buy");
  // không đổi kho -> dừng để tránh vòng lặp vô ích
  assert.equal(decideMasterUpgradePhase("no-progress"), "idle");
});

test("master upgrade phase keeps upgrading then returns to buying", async () => {
  const steps = [
    { action: "blocked-target" },
    { action: "continue", outcome: { success: 1 }, target: { grade: 4 } },
    { action: "no-targets" }
  ];
  const seen = [];
  const result = await pivotMasterToUpgrade(
    null,
    null,
    async () => {
      const step = steps.shift();
      seen.push(step.action);
      return step;
    },
    () => {}
  );
  assert.deepEqual(seen, ["blocked-target", "continue", "no-targets"]);
  assert.equal(result.agentActive, true);
});

test("master upgrade phase returns to buying when phôi runs out", async () => {
  const result = await pivotMasterToUpgrade(
    null,
    null,
    async () => ({ action: "no-materials" }),
    () => {}
  );
  assert.equal(result.agentActive, true);
});

test("target exhaustion while waiting returns to idle", async () => {
  const result = await settleUpgradeOutcome(
    { status: "targets-exhausted" },
    { name: "A. Del Piero", grade: 5 },
    { targetGrade: 6 },
    null,
    null
  );
  assert.equal(result.action, "targets-exhausted");
});

test("master upgrade phase stops when the target made no progress", async () => {
  const result = await pivotMasterToUpgrade(
    null,
    null,
    async () => ({
      action: "continue",
      outcome: { success: 0, finalGrade: 4 },
      target: { grade: 4 }
    }),
    () => {}
  );
  assert.equal(result.agentActive, false);
});

test("master upgrade phase stops when the open mini-app has no targets left", async () => {
  const result = await pivotMasterToUpgrade(
    null,
    null,
    async () => ({ action: "targets-exhausted" }),
    () => {}
  );
  assert.equal(result.agentActive, false);
});

test("master upgrade phase switches mode when a start command arrives", async () => {
  const result = await pivotMasterToUpgrade(
    null,
    null,
    async () => ({ action: "continue", mode: "buy" }),
    () => {}
  );
  assert.deepEqual(result, { agentActive: true, mode: "buy" });
});

test("/starticon keeps monitoring ICON orders on transient E006 instead of re-adding orders", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const runnerSrc = fs.readFileSync(path.join(__dirname, "features/icon-buy/runner.js"), "utf8");

  // Transient token error before any purchase log: keep polling, never re-add.
  const firstE006 = runnerSrc.indexOf('if (/E006|làm mới token/i.test(result.fatalError))');
  const firstCancelDecision = runnerSrc.indexOf('if (reason !== "order-limit")', firstE006);
  assert.ok(firstE006 >= 0, "runner must branch on transient E006 token errors");
  assert.ok(firstCancelDecision > firstE006);
  const firstE006Slice = runnerSrc.slice(firstE006, firstCancelDecision);
  assert.match(firstE006Slice, /giữ nguyên task ICON, không đặt lại/);
  assert.match(firstE006Slice, /continue;/);
  assert.doesNotMatch(firstE006Slice, /stopOrphanIconTasks/);

  // Transient token error after orders were placed: keep the tasks, do not stop.
  const secondE006 = runnerSrc.indexOf("E006 là lỗi token tạm thời sau khi đã có đơn");
  const secondCancelDecision = runnerSrc.indexOf('if (reason !== "order-limit")', secondE006);
  assert.ok(secondE006 >= 0);
  assert.ok(secondCancelDecision > secondE006);
  const secondE006Slice = runnerSrc.slice(secondE006, secondCancelDecision);
  assert.match(secondE006Slice, /giữ nguyên các task/);
  assert.match(secondE006Slice, /continue;/);
});

test("/starticon baseline capture retries the /stop menu read and falls back to polling", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const runnerSrc = fs.readFileSync(path.join(__dirname, "features/icon-buy/runner.js"), "utf8");
  assert.match(runnerSrc, /async function captureStopBaselineWithRetry\(page, rl, stopSignal, ui\)/);
  assert.match(runnerSrc, /const maxAttempts = 3;/);
  assert.match(runnerSrc, /if \(stopSignal\(\)\) return null;/);
  assert.match(runnerSrc, /Chưa đọc được menu \/stop \(lần \$\{attempt\}\/\$\{maxAttempts\}\)/);
});

test("/starticon cancel policy routes bad positions through the pure decision function", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const runnerSrc = fs.readFileSync(path.join(__dirname, "features/icon-buy/runner.js"), "utf8");
  assert.match(runnerSrc, /decideCancelTargets\(\s*result\.successes,\s*config\.iconBuy\.cancelPositionAbove\s*\)/);
  assert.match(runnerSrc, /decideCancelTargets\(\s*successes,\s*config\.iconBuy\.cancelPositionAbove\s*\)/);
  assert.match(runnerSrc, /canceled \+= monitored\.canceled;/);
});

test("checkInventoryIcons keeps waiting before concluding an unconfirmed empty reload", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const upgradeRunnerSrc = fs.readFileSync(
    path.join(__dirname, "features/upgrade/runner.js"),
    "utf8"
  );
  const reloadDeadlineIdx = upgradeRunnerSrc.indexOf("const reloadDeadline");
  const unconfirmedIdx = upgradeRunnerSrc.indexOf('{ code: "INVENTORY_READ_UNCONFIRMED" }');
  assert.ok(reloadDeadlineIdx > -1, "checkInventoryIcons must bound the unconfirmed reload wait");
  assert.ok(unconfirmedIdx > reloadDeadlineIdx);
  const keepWaitingSlice = upgradeRunnerSrc.slice(reloadDeadlineIdx, unconfirmedIdx);
  assert.match(keepWaitingSlice, /while \(!reloaded\)/);
  assert.match(keepWaitingSlice, /reloadUpgradeTargetList/);
});

test("transient inventory read failure keeps the master loop alive", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const controllerSrc = fs.readFileSync(
    path.join(__dirname, "features/controller.js"),
    "utf8"
  );
  // INVENTORY_READ_UNCONFIRMED chỉ là mini-app chưa sẵn sàng: phải retry/giữ
  // agent sống, không được ném ra làm sập vòng tổng.
  assert.match(controllerSrc, /error\.code !== "INVENTORY_READ_UNCONFIRMED"/);
  // Khi vòng tổng lỗi chí mạng, phải dừng luồng ICON nền để không còn
  // heartbeat "Đang chờ bot hoàn tất đơn ICON" chạy mãi.
  assert.match(controllerSrc, /await stopIconMonitor\("agent-error"\)/);
  const cycleSrc = fs.readFileSync(
    path.join(__dirname, "features/buy/cycle.js"),
    "utf8"
  );
  // Log phải nói rõ đây là trạng thái luồng Mua phôi, tránh hiểu nhầm là
  // "không có task nào chạy" khi menu /stop vẫn liệt kê task ICON.
  assert.match(cycleSrc, /luồng Mua phôi/);
  assert.match(cycleSrc, /task MUA khác \(ICON\)/);
});

test("inventory checks are spaced by config and open the mini-app once per check", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const controllerSrc = fs.readFileSync(
    path.join(__dirname, "features/controller.js"),
    "utf8"
  );
  // Không còn vòng thử 3 lần cách nhau 10s (mở mini-app liên tục khi kho rỗng).
  assert.doesNotMatch(controllerSrc, /lần \$\{attempt\}\/3/);
  assert.match(controllerSrc, /inventoryCheckIntervalSeconds/);
  assert.match(controllerSrc, /nextInventoryCheckAt/);
  // Bỏ qua kiểm tra kho thì không được mở mini-app và không mua phôi.
  assert.match(
    controllerSrc,
    /if \(now < nextInventoryCheckAt\) \{[\s\S]{0,800}?continue;/
  );
  // Receipt "nhận cầu thủ vào kho" mới thì kiểm tra ngay.
  assert.match(controllerSrc, /receiptCount > inventoryReceiptSeen/);
  assert.equal(config.iconBuy.inventoryCheckIntervalSeconds, 1800);
  assert.doesNotThrow(() => validateConfig());
});

test("/starticon purchase wait stops on /stopagent and resolves confirmed purchases", async () => {
  const players = [{ code: "101001201" }];
  const page = {
    evaluate: async () => true,
    waitForTimeout: async () => {},
    locator: () => ({ innerText: async () => "" })
  };
  const tracker = createChatTextTracker("");
  chatTextReaders.set(page, tracker);

  const stoppedResult = await waitForPurchaseResults(page, tracker, "", players, null, {
    isStopRequested: () => true
  });
  assert.equal(stoppedResult.stopped, true);
  assert.deepEqual(stoppedResult.successes, []);

  const purchaseText =
    "Đã đặt mua thành công 101001201 | 1 | 44,300,000 | 1/1 lúc 2026-11-05 10:00:00.000. Vị trí mua: 2";
  const pending = waitForPurchaseResults(page, tracker, "", players, null, {
    isStopRequested: () => false
  });
  tracker.publish(purchaseText);
  const result = await pending;
  assert.equal(result.stopped, undefined);
  assert.equal(result.successes.length, 1);
  assert.equal(result.successes[0].code, "101001201");
  assert.equal(result.successes[0].position, 2);
  assert.deepEqual(result.missing, []);
});

test("ICON purchase wait uses an unlimited deadline, heartbeats, and backs off TTCN checks", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const orderSrc = fs.readFileSync(path.join(__dirname, "features/icon-buy/order.js"), "utf8");
  assert.match(
    orderSrc,
    /config\.iconBuy\.purchaseTimeoutSeconds > 0\s*\?\s*Date\.now\(\) \+ config\.iconBuy\.purchaseTimeoutSeconds \* 1_000\s*:\s*Infinity/
  );
  assert.match(orderSrc, /nextHeartbeatAt = waitStartedAt \+ PURCHASE_HEARTBEAT_MS/);
  assert.match(orderSrc, /const PURCHASE_HEARTBEAT_MS = 300_000/);
  assert.match(orderSrc, /không giới hạn thời gian/);
  // TTCN chỉ là nguồn dự phòng: không mở mini-app mỗi 15-30 giây nữa.
  assert.match(orderSrc, /const TTCN_FIRST_CHECK_MS = 600_000/);
  assert.match(orderSrc, /const TTCN_MAX_INTERVAL_MS = 300_000/);
  assert.match(orderSrc, /const TTCN_ERROR_COOLDOWN_MS = 600_000/);
  assert.match(orderSrc, /const TTCN_MAX_PROBES = 1/);
  assert.match(orderSrc, /ttcnProbesLeft -= 1/);
  // Chỉ dò khi có baseline TTCN; chế độ chỉ theo dõi task không được in
  // "Đã dò TTCN 1 lần" trong khi thực ra không mở mini-app (log 06:17-07:50).
  assert.match(orderSrc, /ttcnProbesLeft = ttcnBaselineIds \? TTCN_MAX_PROBES : 0/);
  // Trong lúc chờ lượt hiện tại vẫn quét vị trí xấu của đơn các lượt trước.
  assert.match(orderSrc, /scanPlayers = null/);
  assert.match(orderSrc, /onBadPositions = null/);
  assert.match(orderSrc, /STRAY_POSITION_SCAN_MS/);
  assert.match(orderSrc, /refreshMenu: false,\s*attempts: 1,\s*allowTn: false/);
  assert.match(orderSrc, /nextTtcnCheckAt = waitStartedAt \+ ttcnCheckIntervalMs/);
  assert.match(orderSrc, /ttcnCheckIntervalMs \* 2/);
  assert.match(orderSrc, /Math\.min\([\s\S]{0,120}TTCN_MAX_INTERVAL_MS/);
  assert.match(orderSrc, /Math\.max\(ttcnCheckIntervalMs, ttcnErrorCooldownMs\)/);
  assert.doesNotMatch(orderSrc, /nextTtcnCheckAt = Date\.now\(\) \+ 30_000/);
});

test("menu requests send /tn once per attempt and TTCN probes are single-try", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const menuSrc = fs.readFileSync(
    path.join(__dirname, "features/icon-buy/menu.js"),
    "utf8"
  );
  // Không còn vòng retry lồng nhau: mỗi lượt chỉ một /tn, thất bại thì nhường
  // cho backoff bên ngoài thay vì gửi dồn 2 lần × 45s.
  assert.match(menuSrc, /Đã gửi \/tn để lấy menu cho nút/);
  assert.doesNotMatch(menuSrc, /attempts < 2/);
  assert.doesNotMatch(menuSrc, /lần \$\{attempts\}\/2/);

  const ttcnSrc = fs.readFileSync(
    path.join(__dirname, "features/icon-buy/ttcn.js"),
    "utf8"
  );
  // Cho phép caller giới hạn số lần thử; luồng theo dõi dùng đúng 1 lần.
  assert.match(ttcnSrc, /function openAutoBuyFrame\(/);
  assert.match(ttcnSrc, /attempts = 2, allowTn = true/);
  assert.match(ttcnSrc, /function openTtcnList\(/);
  assert.match(ttcnSrc, /refreshMenu = false, attempts = 2, allowTn = true/);
  assert.match(ttcnSrc, /Math\.max\(1, Number\(attempts\) \|\| 1\)/);
});

test("waitForInventoryReceipt keeps waiting and returns null when /stopagent arrives first", async () => {
  const outcome = {
    status: "inventory-full",
    inventoryReceiptBaseline: 0,
    inventoryReceiptBaselineText: "",
    inventoryReceiptSystemErrors: 0
  };
  const page = {
    evaluate: async () => true,
    waitForTimeout: async () => {},
    locator: () => ({ innerText: async () => "" })
  };
  const tracker = createChatTextTracker("");
  tracker.arm();
  chatTextReaders.set(page, tracker);
  tracker.publish("/stopagent");
  const received = await waitForInventoryReceipt(page, outcome);
  assert.equal(received, null);
});

test("buy outcome treats a missing inventory receipt as idle instead of crashing", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const buyOutcomeSrc = fs.readFileSync(path.join(__dirname, "features/buy/outcome.js"), "utf8");
  assert.match(buyOutcomeSrc, /if \(received === null\)/);
});

test("upgrade reload waits for the mini-app loader before confirming a reload", async () => {
  const state = { loaderVisible: true, clicks: [] };
  const button = {
    count: async () => 1,
    isVisible: async () => true,
    isEnabled: async () => true,
    click: async () => {
      state.clicks.push("reload");
      state.loaderVisible = true;
    }
  };
  const frame = {
    locator: (selector) => {
      if (selector === "#reloadPlayersBtn") return button;
      if (selector === "#loader") return { isVisible: async () => state.loaderVisible };
      throw new Error(`Unexpected frame locator: ${selector}`);
    }
  };
  const page = { waitForTimeout: async () => { state.loaderVisible = false; } };

  const reloaded = await reloadUpgradeTargetList(frame, page, 5_000);
  assert.equal(reloaded, true);
  assert.deepEqual(state.clicks, [], "must not click through an already-loading mini-app");
});

test("upgrade reload returns false without clicking when the reload button is hidden", async () => {
  const page = { waitForTimeout: async () => {} };
  const state = { loaderVisible: false, clicks: [] };
  const frame = {
    locator: (selector) => {
      if (selector === "#reloadPlayersBtn") {
        return {
          count: async () => 1,
          isVisible: async () => false,
          isEnabled: async () => true,
          click: async () => {
            state.clicks.push("reload");
          }
        };
      }
      if (selector === "#loader") return { isVisible: async () => state.loaderVisible };
      throw new Error(`Unexpected frame locator: ${selector}`);
    }
  };
  assert.equal(await reloadUpgradeTargetList(frame, page, 5_000), false);
  assert.deepEqual(state.clicks, []);
});

test("upgrade reload returns false when the loader never appears after clicking reload", async () => {
  const state = { loaderVisible: false, clicks: [] };
  const frame = {
    locator: (selector) => {
      if (selector === "#reloadPlayersBtn") {
        return {
          count: async () => 1,
          isVisible: async () => true,
          isEnabled: async () => true,
          click: async () => {
            state.clicks.push("reload");
            state.loaderVisible = true;
          }
        };
      }
      if (selector === "#loader") return { isVisible: async () => state.loaderVisible };
      throw new Error(`Unexpected frame locator: ${selector}`);
    }
  };
  const page = { waitForTimeout: async () => {} };
  assert.equal(await reloadUpgradeTargetList(frame, page, 30), false);
});

test("ICON purchase wait soft watchdog returns timedOut instead of hanging forever", async () => {
  const players = [{ code: "101001201" }];
  const page = {
    evaluate: async () => true,
    waitForTimeout: async () => {},
    locator: () => ({ innerText: async () => "" })
  };
  const tracker = createChatTextTracker("");
  chatTextReaders.set(page, tracker);
  const started = Date.now();
  const result = await waitForPurchaseResults(page, tracker, "", players, null, {
    isStopRequested: () => false,
    maxWaitMs: 50
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.stopped, undefined);
  assert.equal(result.successes.length, 0);
  assert.deepEqual(result.missing.map((p) => p.code), ["101001201"]);
  assert.ok(Date.now() - started < 5_000);
});

test("ICON purchase wait catches late bad position of an earlier session order", async () => {
  const current = [{ code: "101048940" }];
  const earlier =
    "Đã đặt mua thành công 101005099 | 1 | 33,000,000 | 1/1 lúc 2026-11-09 11:03:31.000. Vị trí mua: 4";
  const tracker = createChatTextTracker(earlier);
  const page = {
    evaluate: async () => true,
    waitForTimeout: async () => {},
    locator: () => ({ innerText: async () => earlier })
  };
  chatTextReaders.set(page, tracker);
  const seen = [];
  const result = await waitForPurchaseResults(page, tracker, "", current, null, {
    isStopRequested: () => false,
    maxWaitMs: 300,
    scanPlayers: [{ code: "101005099" }],
    onBadPositions: async (items) => {
      seen.push(...items);
    }
  });
  assert.equal(result.timedOut, true);
  assert.ok(
    seen.some((item) => item.code === "101005099" && item.position === 4),
    "phải phát hiện vị trí 4 của đơn cũ dù đang chờ đơn khác"
  );
});

test("ICON monitor is bounded and catches late position logs", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const runnerSrc = fs.readFileSync(
    path.join(__dirname, "features/icon-buy/runner.js"),
    "utf8"
  );
  // Theo dõi task có sẵn phải quay lại đọc /stop sau một cửa sổ giới hạn,
  // không kẹt mãi trong waitForPurchaseResults.
  assert.match(runnerSrc, /monitorWaitSeconds/);
  assert.match(runnerSrc, /maxWaitMs/);
  // Bot có thể gửi vị trí rất muộn: quét toàn bộ cửa sổ chat mỗi vòng.
  assert.match(runnerSrc, /findLatestKnownPositions\(/);
  // Mở TTCN lỗi thì chờ rồi thử lại, mỗi lần chỉ một lượt /tn.
  assert.match(runnerSrc, /CANCEL_MAX_ATTEMPTS = 2/);
  assert.match(runnerSrc, /cancelIconOrdersWithRetry/);
  // Đơn vị trí xấu chưa hủy được không được bỏ rơi: ghi nhận orderId và thử
  // hủy lại ở nhịp sau thay vì kết thúc phiên.
  assert.match(runnerSrc, /const pendingCancels = new Map\(\)/);
  assert.match(runnerSrc, /function pendingCancelKey\(item\)/);
  assert.match(runnerSrc, /CANCEL_PENDING_MAX_BACKOFF_MS = 1_800_000/);
  assert.match(runnerSrc, /pendingCancels\.set\(pendingCancelKey\(item\), item\)/);
  // Đơn treo KHÔNG được chặn việc mua bù slot (trước đây agent đứng im hàng giờ).
  assert.match(runnerSrc, /vẫn tiếp tục mua bù slot/);
  assert.match(runnerSrc, /nextPendingCancelAt/);
  assert.doesNotMatch(runnerSrc, /không đặt thêm đơn mới, thử lại sau/);
  // Theo dõi task có sẵn không được coi E006/prompt của bot là lỗi của đơn vừa gửi.
  assert.match(runnerSrc, /monitorOnly: true/);
  // Bot rate-limit thì đọc lại /stop, không gửi mua dồn.
  assert.match(runnerSrc, /result\.rateLimited/);
  // Log rõ vị trí trước khi hủy (trước đây chỉ log mã/giá, không biết vị trí mấy).
  assert.match(runnerSrc, /Hủy đơn \$\{success\.code\} vì vị trí \$\{success\.position\}/);
  assert.match(runnerSrc, /đơn vị trí xấu từ log chat/);
  // Quét đơn muộn phải dùng cả sessionPlayers, không chỉ task còn trong /stop.
  assert.match(runnerSrc, /sessionPlayers: \[\.\.\.sessionPlayers\.values\(\)\]/);
  assert.match(runnerSrc, /onBadPositions: handleStrayBadPositions/);
  assert.match(runnerSrc, /function collectLateBadPositions/);
  // Đơn đã hủy qua đường thường cũng phải được đánh dấu để vòng quét không
  // mở TTCN lại chỉ vì log vẫn còn trong cửa sổ chat.
  assert.match(runnerSrc, /tried instanceof Set/);
  // Hủy lại đơn treo phải dùng baseline đầu phiên, không dùng baseline lượt
  // (baseline lượt đã chứa chính đơn mới nên sẽ loại trừ nhầm).
  assert.match(runnerSrc, /const pendingBaseline = sessionTtcnBaselineIds \|\| knownOrderIds/);

  const ttcnSrc = fs.readFileSync(
    path.join(__dirname, "features/icon-buy/ttcn.js"),
    "utf8"
  );
  assert.match(ttcnSrc, /openTtcnList\(page, rl, \{ attempts: 1 \}\)/);
  assert.match(ttcnSrc, /refreshMenu: true, attempts: 1/);
  // Lượt mở đầu tiên phải dùng nút "Auto Mua Phôi" cũ nếu còn hiển thị; chỉ
  // lần mở lại (iframe trắng) hoặc E002 mới được gửi /tn. Trước đây mỗi lượt dò
  // TTCN/hủy đơn đều gửi /tn dù không cần (log 05:34, 05:36, 05:47).
  assert.match(ttcnSrc, /refresh: attempt > 1/);
  assert.doesNotMatch(ttcnSrc, /refresh: refreshMenu \|\| attempt > 1/);
  // Dòng "Đang hủy đơn TTCN" phải kèm vị trí mua.
  assert.match(ttcnSrc, /vị trí \$\{cancelPositionText\}/);

  const menuSrc = fs.readFileSync(
    path.join(__dirname, "features/icon-buy/menu.js"),
    "utf8"
  );
  // Không gán lại biến const (lỗi cũ khi token E002) và dùng lại locator đã
  // tìm được thay vì gọi ensureFeatureButton lần hai.
  assert.match(menuSrc, /button = null/);
  assert.match(menuSrc, /button && attempt === 0/);
  assert.doesNotMatch(menuSrc, /^\s+target = await ensureFeatureButton/m);
  // /tn im lặng thì dùng lại nút menu cũ thay vì chờ hết 45s rồi báo lỗi.
  assert.match(menuSrc, /MENU_FALLBACK_MS = 15_000/);
  assert.match(menuSrc, /dùng lại nút cũ đang hiển thị/);
  // Lượt dò TTCN phụ không được gửi /tn khi mất nút menu (log 09:58, 10:45).
  assert.match(menuSrc, /allowTn = true/);
  assert.match(menuSrc, /không gửi \/tn trong lúc chờ đơn ICON/);
  assert.match(ttcnSrc, /allowTn/);

  assert.equal(config.iconBuy.purchaseSoftTimeoutSeconds, 1800);
  assert.equal(config.iconBuy.monitorWaitSeconds, 900);
  assert.doesNotThrow(() => validateConfig());
});

test("purchase wait ignores bot prompts while only monitoring existing tasks", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const orderSrc = fs.readFileSync(
    path.join(__dirname, "features/icon-buy/order.js"),
    "utf8"
  );
  // Prompt/E006/rate-limit chỉ là lỗi của lượt vừa gửi; khi chỉ theo dõi task
  // có sẵn thì không được throw làm dừng luồng ICON.
  assert.match(orderSrc, /monitorOnly = false/);
  assert.match(orderSrc, /if \(!monitorOnly && PROMPT_RE\.test/);
  assert.match(orderSrc, /if \(!monitorOnly && RATE_LIMIT_RE\.test/);
  assert.match(orderSrc, /if \(!monitorOnly\) \{[\s\S]{0,400}?E006/);
  // Rate-limit không được vừa log "thử lại" vừa throw kết thúc phiên.
  assert.doesNotMatch(orderSrc, /chờ \$\{delay \/ 1_000\}s rồi thử lại/);
  assert.match(orderSrc, /rateLimited: true/);
});

test("reattach keeps the same chat tracker after a Telegram reload", async () => {
  // Sau reload, document mới làm mất MutationObserver. Tracker phải được giữ
  // nguyên để luồng ICON đang giữ reader cũ vẫn đọc được vị trí mua và lệnh dừng.
  const tracker = createChatTextTracker("chat cũ");
  tracker.binding = "__fo4ChatTextChangedTest";
  const page = {
    evaluate: async () => true,
    locator: () => ({
      innerText: async () => "chat cũ\nBot đã đặt mua 101000246; vị trí: 2"
    })
  };
  chatTextReaders.set(page, tracker);

  assert.equal(await reattachChatObserver(page), true);
  assert.equal(chatTextReaders.get(page), tracker);
  assert.match(tracker.snapshot().text, /vị trí: 2/);
});

test("hard reload uses page.reload instead of same-hash goto and re-arms tracking", async () => {
  // page.goto(BOT_URL) khi chỉ khác hash là same-document nên Telegram Web K vẫn
  // kẹt ở màn hình "Chats" (log 01:48-03:43). Phải reload thật.
  let reloads = 0;
  let navigations = 0;
  const page = {
    url: () => "https://web.telegram.org/k/#@Nguyenanh_fo4_bot",
    reload: async () => { reloads += 1; },
    goto: async () => { navigations += 1; },
    getByRole: () => ({ count: async () => 0 }),
    evaluate: async () => true,
    locator: () => ({ innerText: async () => "chat sau reload" })
  };
  const tracker = createChatTextTracker("chat trước reload");
  tracker.binding = "__fo4ChatTextChangedReload";
  chatTextReaders.set(page, tracker);

  await hardReloadTelegram(page);
  assert.equal(reloads, 1);
  assert.equal(navigations, 0);
  assert.equal(chatTextReaders.get(page), tracker);
  assert.equal(tracker.snapshot().text, "chat sau reload");
});

test("hard reload reopens the bot URL when Telegram dropped the chat hash", async () => {
  // Ảnh màn hình 03:xx: thanh địa chỉ chỉ còn web.telegram.org/k/ và hộp
  // "Chats" mở -> reload về trang chủ, phải goto URL bot để mở lại chat.
  let reloads = 0;
  let navigations = 0;
  const page = {
    url: () => "https://web.telegram.org/k/",
    reload: async () => { reloads += 1; },
    goto: async () => { navigations += 1; },
    getByRole: () => ({ count: async () => 0 }),
    evaluate: async () => true,
    locator: () => ({ innerText: async () => "chat bot" })
  };
  chatTextReaders.set(page, createChatTextTracker("chat cũ"));

  await hardReloadTelegram(page);
  assert.equal(reloads, 1);
  assert.equal(navigations, 1);
});

test("stop baseline reopens the bot chat before snapshotting message ids", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const tasksSrc = fs.readFileSync(
    path.join(__dirname, "features/icon-buy/tasks.js"),
    "utf8"
  );
  const ensureIdx = tasksSrc.indexOf("await ensureMessageComposer(page, rl);");
  const idsIdx = tasksSrc.indexOf("const baselineIds = await getVisibleMessageIds(page)");
  assert.ok(ensureIdx > -1, "readStopMenu must reopen the chat before reading ids");
  assert.ok(idsIdx > ensureIdx, "chat must be opened before baseline id snapshot");
  // Không còn im lặng trả null khi trang không có bubble.
  assert.match(tasksSrc, /Không đọc được nội dung chat/);

  const composerSrc = fs.readFileSync(
    path.join(__dirname, "features/composer.js"),
    "utf8"
  );
  assert.match(composerSrc, /hardReloadTelegram\(page\)/);

  const runnerSrc = fs.readFileSync(
    path.join(__dirname, "features/icon-buy/runner.js"),
    "utf8"
  );
  assert.match(runnerSrc, /reloadTelegramForRecovery/);
  assert.match(runnerSrc, /hardReloadTelegram\(page\)/);
  // Kẹt quá lâu thì báo controller mở lại phiên thay vì lặp /stop vô hạn.
  assert.match(runnerSrc, /STOP_READ_MAX_FAILURES/);
  assert.match(runnerSrc, /TELEGRAM_CHAT_UNREADABLE/);
  const controllerSrc = fs.readFileSync(
    path.join(__dirname, "features/controller.js"),
    "utf8"
  );
  assert.match(controllerSrc, /error\?\.code === "TELEGRAM_CHAT_UNREADABLE"/);
  assert.match(controllerSrc, /sessionUnavailable = true/);
});

test("reload reset does not replay an old control command from the chat tail", () => {
  const tracker = createChatTextTracker("màn hình Chats không có tin nhắn");
  tracker.arm();
  const seen = [];
  tracker.setCommandHandler((command) => seen.push(command));

  // Trang vừa render lại: đuôi chat có /stopagent cũ, không được coi là lệnh mới.
  tracker.reset("lịch sử chat\n/stopagent");
  tracker.publish("lịch sử chat\n/stopagent\nBot: đã dừng");
  assert.deepEqual(seen, []);

  // Tin nhắn mới thật sự vẫn được nhận sau đó.
  tracker.publish("lịch sử chat\n/stopagent\nBot: đã dừng\n/startagent");
  assert.deepEqual(seen, ["startagent"]);
});
