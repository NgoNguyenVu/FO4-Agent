const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getUpgradeSpec,
  validateUpgradeConfig,
  shouldProtectBp,
  parseMarketPrice,
  countUpgradeStarts,
  parseUpgradeProgress,
  latestUpgradeProgress,
  parseUpgradeSummary,
  getUpgradeTerminalKey,
  hasNewUpgradeTerminal,
  getUpgradeCycleBaseline,
  getExistingUpgradeRun,
  hasNewUpgradeStart,
  getUpgradeOutcomeFromFresh,
  getUpgradeRunOutcome,
  getOrphanUpgradeOutcome,
  parseUpgradeTargetCards,
  summarizeUpgradeTargetCards,
  countInventoryIcons,
  isUpgradeTargetListExhausted,
  inspectUpgradeTargetAvailability,
  readUpgradeTargetCards,
  parseOvrList,
  parseSelectedPhoiOvrs,
  parseUpgradeShortage,
  countUpgradeTerminals,
  verifyUpgradeFinalUi,
  waitForUpgradeStartAck,
  hasUpgradeTargetCards,
  hasUpgradeForm,
  isUpgradeFrameReady,
  UG_AUTO_FORM_HEADING,
  isUpgradeModeOptionText,
  isManualUpgradeModeText,
  expandUpgradeAdvanced,
  findNcMenuButton,
  hasRecentUpgradeMenu,
  hasFreshUpgradeMenu
} = require("./upgrade");
const {
  chatTextReaders,
  createChatTextTracker
} = require("../lib/chat-runtime");
const { config } = require("./config");

test("parses market prices with K/M/B suffixes and separators", () => {
  assert.equal(parseMarketPrice("54.3M"), 54300000);
  assert.equal(parseMarketPrice("66M"), 66000000);
  assert.equal(parseMarketPrice("2B"), 2000000000);
  assert.equal(parseMarketPrice("625,000"), 625000);
  assert.equal(parseMarketPrice("1,600"), 1600);
  assert.equal(parseMarketPrice("50000000"), 50000000);
  assert.equal(parseMarketPrice("6.5M"), 6500000);
  assert.throws(() => parseMarketPrice("并无"), /Không đọc được giá/);
});

test("enables BP protection only from grade +8", () => {
  assert.equal(shouldProtectBp(6, 8), false);
  assert.equal(shouldProtectBp(7, 8), false);
  assert.equal(shouldProtectBp(8, 8), true);
  assert.equal(shouldProtectBp(9, 8), true);
});

test("upgrade spec comes from config with sane defaults", () => {
  const spec = getUpgradeSpec();
  assert.equal(spec.targetGrade, config.upgrade.targetGrade);
  assert.equal(spec.minRatio, config.upgrade.minRatio);
  assert.equal(spec.waitMs, config.upgrade.waitMs);
  assert.doesNotThrow(validateUpgradeConfig);
});

test("recognizes manual upgrade mode card with old and new separators", () => {
  assert.equal(isUpgradeModeOptionText("1Tự chọn phôiTự chọn cầu thủ"), true);
  assert.equal(isUpgradeModeOptionText("1 Tự chọn phôi"), true);
  assert.equal(isUpgradeModeOptionText("1. Tự chọn phôi"), true);
  assert.equal(isUpgradeModeOptionText("2 Tự chọn phôi"), false);
  assert.equal(isManualUpgradeModeText("mode: manual\nBước 2"), true);
  assert.equal(isManualUpgradeModeText("mode: auto_buy_upgrade"), false);
});

test("advanced settings stay open when expanded repeatedly", async () => {
  const details = [
    { open: false, summary: "Cài đặt nâng cao: kiểu chạy" },
    { open: true, summary: "Cài đặt nâng cao về tỉ lệ" },
    { open: false, summary: "Cài đặt nâng cao về phôi" }
  ].map((item) => ({
    ...item,
    querySelector: () => ({
      innerText: item.summary,
      textContent: item.summary
    })
  }));
  let clickCount = 0;
  const frame = {
    locator: (selector) => {
      assert.equal(selector, "body");
      return {
        evaluate: async (fn) =>
          fn({ ownerDocument: { querySelectorAll: () => details } })
      };
    },
    getByText: () => {
      clickCount += 1;
      return { count: async () => 0 };
    }
  };
  const page = { waitForTimeout: async () => {} };

  await expandUpgradeAdvanced(frame, page);
  assert.deepEqual(details.map((item) => item.open), [true, true, true]);
  await expandUpgradeAdvanced(frame, page);
  assert.deepEqual(details.map((item) => item.open), [true, true, true]);
  // <details> path không được rơi xuống fallback click (click lần hai = đóng).
  assert.equal(clickCount, 0);
});

test("clicks the newest Auto Nâng Cấp menu instead of an expired one", async () => {
  const oldButton = {
    innerText: async () => "Auto Nâng Cấp 2.0",
    isVisible: async () => true
  };
  const freshButton = {
    innerText: async () => "Auto Nâng Cấp 2.0",
    isVisible: async () => true
  };
  const page = {
    locator: () => ({
      count: async () => 2,
      nth: (index) => [oldButton, freshButton][index]
    }),
    getByText: () => ({ count: async () => 0 })
  };
  assert.equal(await findNcMenuButton(page), freshButton);
});

test("does not treat plain message text as an upgrade menu button", async () => {
  const textNode = {
    isVisible: async () => true,
    evaluate: async () => false
  };
  const page = {
    locator: () => ({
      count: async () => 0,
      nth: () => null
    }),
    getByText: () => ({
      count: async () => 1,
      nth: () => textNode
    })
  };
  assert.equal(await findNcMenuButton(page), null);
});

test("recognizes the current upgrade menu even without the old prompt", () => {
  const menu =
    "online Tra cứu giờ Reset Online Nâng Cấp Cầu Thủ Auto Mua Phôi " +
    "Auto GLXH Auto Nâng Cấp 2.0 Auto Nâng Cấp 1.0 BẮN TỈA CT 2,0 " +
    "Chèn Vip Member Chèn Chuyển Hàng";

  assert.equal(hasRecentUpgradeMenu(menu), true);
  assert.equal(hasFreshUpgradeMenu("Lịch sử cũ", `Lịch sử cũ\n${menu}`), true);
  assert.equal(hasRecentUpgradeMenu("Auto Nâng Cấp 2.0 đang chạy"), false);
});

test("recognizes a loaded upgrade mini-app even when the target list is empty", () => {
  const card = "H. Crespo _id: abc123 • +2 • reserve OVR 116 Giá 66.2M";
  assert.equal(hasUpgradeTargetCards(card), true);
  assert.equal(isUpgradeFrameReady(card), true);

  const emptyForm = "Lọc phôi từ kho\nKiểm tra & Bắt đầu";
  assert.equal(hasUpgradeTargetCards(emptyForm), false);
  assert.equal(hasUpgradeForm(emptyForm), true);
  assert.equal(isUpgradeFrameReady(emptyForm), true);

  // App mở lại ở mode auto: panel "Lọc phôi từ kho" bị ẩn, chỉ còn panel auto.
  const emptyAutoForm = `${UG_AUTO_FORM_HEADING}\nKiểm tra & Bắt đầu`;
  assert.equal(hasUpgradeForm(emptyAutoForm), true);
  assert.equal(isUpgradeFrameReady(emptyAutoForm), true);

  // "Đang tải" thì isUpgradeFrameReady vẫn false, nhưng form đã render đủ để
  // waitForUpgradeFrameReady kết luận danh sách rỗng sau grace period.
  const stuckLoading = "Đang tải...\nLọc phôi từ kho\nKiểm tra & Bắt đầu";
  assert.equal(hasUpgradeForm(stuckLoading), true);
  assert.equal(isUpgradeFrameReady(stuckLoading), false);
  assert.equal(isUpgradeFrameReady("Lọc phôi từ kho"), false);
  assert.equal(isUpgradeFrameReady(""), false);

  // Telegram Web có thể render nbsp trong nhãn.
  assert.equal(
    isUpgradeFrameReady("Lọc\u00a0phôi từ kho\nKiểm tra\u00a0&\u00a0Bắt đầu"),
    true
  );
});

test("counts upgrade start acknowledgements", () => {
  assert.equal(countUpgradeStarts("Đã khởi động Auto Nâng Cấp (thủ công)."), 1);
  assert.equal(
    countUpgradeStarts("Đã khởi động Auto Nâng Cấp (thủ công).\nĐã khởi động Auto Nâng Cấp (thủ công)."),
    2
  );
});

test("upgrade start acknowledgement stops immediately on a fresh E006", async () => {
  const oldText = "Lịch sử cũ";
  const reader = createChatTextTracker(
    `${oldText}\nE006: Lỗi hệ thống, vui lòng thử lại sau hoặc liên hệ hỗ trợ.`
  );
  const page = {};
  chatTextReaders.set(page, reader);

  await assert.rejects(
    waitForUpgradeStartAck(page, {
      starts: 0,
      terminals: 0,
      progress: 0,
      systemErrors: 0,
      text: oldText
    }),
    (error) => {
      assert.equal(error.code, "BOT_SYSTEM_ERROR");
      return true;
    }
  );
});

test("parses grade climb progress and materials left", () => {
  const chat =
    "- ID Cầu thủ abc: Nâng thành công lên Mức thẻ 2 (Số lượng nguyên liệu còn: 7)\n" +
    "- ID Cầu thủ abc: Nâng thành công lên Mức thẻ 4 (Số lượng nguyên liệu còn: 4)";
  assert.deepEqual(parseUpgradeProgress(chat), [
    { grade: 2, materials: 7 },
    { grade: 4, materials: 4 }
  ]);
  assert.deepEqual(latestUpgradeProgress(chat), { grade: 4, materials: 4 });
  assert.equal(latestUpgradeProgress("no progress"), null);
});

test("parses the terminal upgrade summary with final grade and reason", () => {
  const chat =
    "Kết quả nâng cấp:\n" +
    "- Nâng thành công 0/1 target.\n" +
    "Cầu thủ ID abc: Mức thẻ cuối 2\n" +
    "Dừng do hết nguyên liệu.";
  assert.deepEqual(parseUpgradeSummary(chat), {
    success: 0,
    total: 1,
    finalGrade: 2,
    reason: "hết nguyên liệu",
    outOfMaterial: true,
    reachedTarget: false
  });
  assert.equal(parseUpgradeSummary("still running"), null);
});

test("a reached-target summary carries its reason for the loop", () => {
  const chat =
    "Nếu gặp lỗi gõ /stopnc để dừng nâng cấp.\n" +
    "Kết quả nâng cấp:\n" +
    "- Nâng thành công 1/1 target.\n" +
    "Cầu thủ ID 6a990a4ff856924d1111c801: Mức thẻ cuối 6\n" +
    "Dừng do đạt mục tiêu.";
  assert.deepEqual(parseUpgradeSummary(chat), {
    success: 1,
    total: 1,
    finalGrade: 6,
    reason: "đạt mục tiêu",
    outOfMaterial: false,
    reachedTarget: true
  });
});

test("a no-valid-materials stop counts as materials exhaustion", () => {
  const chat =
    "Kết quả nâng cấp:\n" +
    "- Nâng thành công 0/1 target.\n" +
    "Cầu thủ ID abc: Mức thẻ cuối 5\n" +
    "Dừng do không có nguyên liệu hợp lệ.";
  assert.deepEqual(parseUpgradeSummary(chat), {
    success: 0,
    total: 1,
    finalGrade: 5,
    reason: "không có nguyên liệu hợp lệ",
    outOfMaterial: true,
    reachedTarget: false
  });
  assert.equal(countUpgradeTerminals(chat), 1);
});

test("detects a running upgrade vs a finished one from history", () => {
  const running = "Đã khởi động Auto Nâng Cấp (thủ công).\nMua phôi...";
  const cycle = getExistingUpgradeRun(running);
  assert.equal(cycle?.status, "running");
  assert.deepEqual(cycle.baseline, getUpgradeCycleBaseline(running));
  assert.equal(
    getExistingUpgradeRun(`${running}\nNâng thành công 1/1 target.`),
    null
  );
  assert.equal(
    getExistingUpgradeRun(
      `${running}\nCầu thủ ID abc: Mức thẻ cuối 5\nDừng do hết nguyên liệu.`
    ),
    null,
    "a summary-less terminal also ends the adopted run"
  );
  assert.equal(getExistingUpgradeRun("Lịch sử cũ"), null);
});

test("a fresh start ack is recognized by count or fresh text", () => {
  const baseline = getUpgradeCycleBaseline("Lịch sử cũ");
  const started = "Lịch sử cũ\nĐã khởi động Auto Nâng Cấp (thủ công).";
  assert.equal(hasNewUpgradeStart(started, baseline), true);
  assert.equal(hasNewUpgradeStart(started, baseline, "Lịch sử cũ"), true);
  assert.equal(hasNewUpgradeStart("Lịch sử cũ", baseline), false);
});

test("fresh upgrade outcome reports system errors and summaries only", () => {
  assert.deepEqual(
    getUpgradeOutcomeFromFresh(
      "E006: Lỗi hệ thống, vui lòng thử lại sau hoặc liên hệ hỗ trợ.",
      "old\nE006: Lỗi hệ thống, vui lòng thử lại sau hoặc liên hệ hỗ trợ."
    ),
    { status: "system-error" }
  );
  assert.deepEqual(
    getUpgradeOutcomeFromFresh(
      "Nâng thành công 1/1 target.",
      "Đã khởi động Auto Nâng Cấp (thủ công).\nNâng thành công 1/1 target."
    ),
    { status: "completed", success: 1, total: 1, finalGrade: null, reason: "", outOfMaterial: false, reachedTarget: false }
  );
  assert.equal(getUpgradeOutcomeFromFresh("Mua thành công! SPID: 1", "Mua thành công! SPID: 1"), null);
  assert.equal(getUpgradeOutcomeFromFresh(null, "anything"), null);
});

test("a new terminal is detected from the full snapshot when fresh text is unavailable", () => {
  const baselineText =
    "Đã khởi động Auto Nâng Cấp (thủ công).\n" +
    "Nâng thành công 0/1 target.\nMức thẻ cuối 5\nDừng do hết nguyên liệu.";
  const currentText =
    `${baselineText}\nĐã khởi động Auto Nâng Cấp (thủ công).\n` +
    "Nâng thành công 1/1 target.\nMức thẻ cuối 6\nDừng do đạt mục tiêu.";
  const baseline = getUpgradeCycleBaseline(baselineText);
  assert.equal(countUpgradeTerminals(currentText) > baseline.terminals, true);
  assert.deepEqual(parseUpgradeSummary(currentText), {
    success: 1,
    total: 1,
    finalGrade: 6,
    reason: "đạt mục tiêu",
    outOfMaterial: false,
    reachedTarget: true
  });

  test("counts successive upgrade summaries even when bot start notices are absent", () => {
    const oldResult =
      "Kết quả nâng cấp:\n-Nâng thành công 0/1 target.\n" +
      "Cầu thủ ID old: Mức thẻ cuối 5\nDừng do hết nguyên liệu.";
    const newResult =
      "Kết quả nâng cấp:\n-Nâng thành công 1/1 target.\n" +
      "Cầu thủ ID new: Mức thẻ cuối 6\nDừng do đạt mục tiêu.";
    assert.equal(countUpgradeTerminals(oldResult), 1);
    assert.equal(countUpgradeTerminals(`${oldResult}\n${newResult}`), 2);
  });

  test("does not treat an old orphan terminal as the current upgrade result", () => {
    const oldResult =
      "Kết quả nâng cấp:\n-Nâng thành công 1/1 target.\n" +
      "Cầu thủ ID old: Mức thẻ cuối 6\nDừng do đạt mục tiêu.";
    assert.equal(getOrphanUpgradeOutcome(oldResult, true, 1), null);
    assert.deepEqual(getOrphanUpgradeOutcome(oldResult, true), {
      status: "completed",
      success: 1,
      total: 1,
      finalGrade: 6,
      reason: "đạt mục tiêu",
      outOfMaterial: false,
      reachedTarget: true
    });
  });
});

test("orphan upgrade summary ends the run when the start line was trimmed", () => {
  const window = "Mua thành công! SPID: 1\nNâng thành công 0/1 target.\nDừng do hết nguyên liệu.";
  assert.deepEqual(getOrphanUpgradeOutcome(window, true), {
    status: "completed",
    success: 0,
    total: 1,
    finalGrade: null,
    reason: "hết nguyên liệu",
    outOfMaterial: true,
    reachedTarget: false
  });
  assert.equal(getOrphanUpgradeOutcome(window, false), null);
  assert.equal(
    getOrphanUpgradeOutcome(`Đã khởi động Auto Nâng Cấp (thủ công).\n${window}`, true),
    null
  );
});

test("picks icon targets below target grade, cheapest lowest-grade first", () => {
  const cards = [
    { text: "A _id: aaa111 • +2 • reserve OVR 112 Mức thẻ +2 Giá 93.5M", disabled: false, imgSrcs: ["https://x/season/ICON.png"] },
    { text: "B _id: bbb222 • +6 • reserve OVR 116 Mức thẻ +6 Giá 2B", disabled: false, imgSrcs: ["https://x/season/ICON.png"] },
    { text: "C _id: ccc333 • +1 • reserve OVR 107 Mức thẻ +1 Giá 38.2M", disabled: false, imgSrcs: ["https://x/season/ICON.png"] },
    { text: "D _id: ddd444 • +2 • reserve OVR 121 Mức thẻ +2 Giá 4.29M", disabled: false, imgSrcs: ["https://x/season/26TOTS.png"] },
    { text: "E _id: eee555 • +1 • reserve • KHÓA CHỌN: ĐANG BỊ KHÓA OVR 116 Mức thẻ +1 Giá 625,000", disabled: true, imgSrcs: ["https://x/season/ICON.png"] },
    { text: "C _id: ccc333 • +1 • reserve OVR 107 Mức thẻ +1 Giá 38.2M", disabled: false, imgSrcs: ["https://x/season/ICON.png"] }
  ];
  const picked = parseUpgradeTargetCards(cards, 6);
  assert.deepEqual(
    picked.map((c) => c.id),
    ["ccc333", "aaa111"]
  );
  assert.equal(picked[0].priceBp, 38200000);
  assert.deepEqual(parseUpgradeTargetCards(cards.slice(1, 2), 6), []);
});

test("recognizes all ICON season badge variants", () => {
  const badges = [
    "https://ssl.nexon.com/s2/game/fc/online/obt/externalAssets/new/season/icon.png",
    "https://ssl.nexon.com/s2/game/fc/online/obt/externalAssets/new/season/icontm.png",
    "https://ssl.nexon.com/s2/game/fc/online/obt/externalAssets/new/season/icontm_b.png",
    "https://ssl.nexon.com/s2/game/fc/online/obt/externalAssets/new/season/filter/icon_m.png",
    "https://ssl.nexon.com/s2/game/fc/online/obt/externalAssets/new/season/mcicon.png",
    "https://ssl.nexon.com/s2/game/fc/online/obt/externalAssets/new/season/tki.png",
    "https://cdn.vn.garenanow.com/web/fo4/events/data-center/season-icon/100.png",
    "https://cdn.vn.garenanow.com/web/fo4/events/data-center/season-icon/101.png",
    "https://cdn.vn.garenanow.com/web/fo4/events/data-center/season-icon/110.png",
    "https://cdn.vn.garenanow.com/web/fo4/events/data-center/season-icon/111.png",
    "https://cdn.vn.garenanow.com/web/fo4/events/data-center/season-icon/202.png",
    "https://cdn.vn.garenanow.com/web/fo4/events/data-center/season-icon/213.png",
    "icon.png"
  ];
  const cards = badges.map((src, index) => ({
    text: `P${index} _id: abc00${index} • +1 • reserve Giá 10M`,
    disabled: false,
    imgSrcs: [src]
  }));
  cards.push({
    text: "Normal _id: def999 • +1 • reserve Giá 10M",
    disabled: false,
    imgSrcs: ["https://ssl.nexon.com/s2/game/fc/online/obt/externalAssets/new/season/tots.png"]
  });
  cards.push({
    text: "UCL _id: fed888 • +1 • reserve Giá 10M",
    disabled: false,
    imgSrcs: ["https://cdn.vn.garenanow.com/web/fo4/events/data-center/season-icon/242.png"]
  });

  const picked = parseUpgradeTargetCards(cards, 7);
  assert.equal(picked.length, badges.length);
  assert.equal(picked.some((card) => card.id === "def999"), false);
  assert.equal(picked.some((card) => card.id === "fed888"), false);
});

test("counts distinct ICON cards in inventory, including cards at target grade", () => {
  const icon = "https://x/season/ICON.png";
  assert.equal(
    countInventoryIcons([
      { text: "A _id: aaa111 • +1", imgSrcs: [icon] },
      { text: "A _id: aaa111 • +1", imgSrcs: [icon] },
      { text: "B _id: bbb222 • +8", imgSrcs: [icon] },
      { text: "C _id: ccc333 • +1", imgSrcs: ["https://x/season/TOTS.png"] }
    ]),
    2
  );
});

test("reads target cards only from #targetsList, not the material list", async () => {
  const makeButton = (id, src) => ({
    innerText: `P _id: ${id} • +1 • reserve Giá 10M`,
    disabled: false,
    querySelectorAll: (selector) =>
      selector === "img" ? [{ src }] : []
  });
  const targetRoot = {
    querySelectorAll: () => [makeButton("aaa111", "https://x/season/icon.png")]
  };
  const materialRoot = {
    querySelectorAll: () => [makeButton("bbb222", "https://x/season/tots.png")]
  };
  const body = {
    ownerDocument: {
      body: materialRoot,
      querySelector: (selector) => (selector === "#targetsList" ? targetRoot : null)
    }
  };
  const frame = {
    locator: () => ({ evaluate: async (fn) => fn(body) })
  };

  const cards = await readUpgradeTargetCards(frame);
  assert.equal(cards.length, 1);
  assert.match(cards[0].text, /aaa111/);
});

test("explains why a card list has no upgrade target", () => {
  const icon = "https://x/season/ICON.png";
  const cards = [
    { text: "A _id: aaa111 • +2 • Giá 10M", disabled: false, imgSrcs: [icon] },
    { text: "A _id: aaa111 • +2 • Giá 10M", disabled: false, imgSrcs: [icon] },
    { text: "B _id: bbb222 • +6 • Giá 10M", disabled: false, imgSrcs: [icon] },
    { text: "C _id: ccc333 • +1 • Giá 10M", disabled: false, imgSrcs: ["https://x/season/TOTS.png"] },
    { text: "D _id: ddd444 • +1 • KHÓA CHỌN • Giá 10M", disabled: true, imgSrcs: [icon] },
    { text: "E _id: eee555 • +1 • Giá 10M", disabled: false, imgSrcs: [icon] },
    { text: "không có id", disabled: false, imgSrcs: [icon] }
  ];
  assert.deepEqual(summarizeUpgradeTargetCards(cards, 6), {
    total: 7,
    invalid: 1,
    duplicate: 1,
    notIcon: 1,
    locked: 1,
    reachedTarget: 1,
    eligible: 2
  });
});

test("decides the target list is exhausted only when no valid icon remains", () => {
  const icon = "https://x/season/ICON.png";
  const card = (id, grade, extra = {}) => ({
    text: `${id} _id:${id} • +${grade} • reserve OVR 116 Giá 10M${
      extra.text || ""
    }`,
    disabled: Boolean(extra.disabled),
    imgSrcs: extra.icon === false ? ["https://x/season/TOTS.png"] : [icon]
  });

  // Còn icon dưới target -> chưa hết.
  assert.equal(isUpgradeTargetListExhausted([card("aaa111", 5)], 6), false);
  // Chỉ còn icon đã đạt target -> hết.
  assert.equal(isUpgradeTargetListExhausted([card("aaa111", 6)], 6), true);
  // Không còn thẻ ICON -> hết (theo đúng yêu cầu "hết icon target").
  assert.equal(
    isUpgradeTargetListExhausted([card("bbb222", 5, { icon: false })], 6),
    true
  );
  // Thẻ đang khóa/training có thể là target đang chạy -> KHÔNG kết luận.
  assert.equal(
    isUpgradeTargetListExhausted(
      [card("ccc333", 5, { disabled: true, text: " • KHÓA CHỌN" })],
      6
    ),
    false
  );
  // Danh sách rỗng sau khi tải lại kho cũng là đã hết.
  assert.equal(isUpgradeTargetListExhausted([], 6), true);
});

function createUpgradeAvailabilityFrame(cards, options = {}) {
  // App mở lại từ menu sẽ tự về mode auto_buy_upgrade và target +5; kiểm tra
  // target không được phụ thuộc hai giá trị mặc định này.
  const bodyText =
    options.bodyText ||
    `mode: auto_buy_upgrade\n${UG_AUTO_FORM_HEADING}\nKiểm tra & Bắt đầu\nBước 1: Chọn cầu thủ chính`;
  let loading = false;
  const body = {
    innerText: async () => bodyText,
    evaluate: async () => cards
  };
  const page = {
    waitForTimeout: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  };
  const frame = {
    locator(selector) {
      if (selector === "body") return body;
      if (selector === "#loader") {
        return { isVisible: async () => loading };
      }
      if (selector === "#searchText") {
        return { inputValue: async () => options.searchValue || "" };
      }
      if (selector === "#errorBanner") {
        return { isVisible: async () => !!options.errorVisible };
      }
      if (selector === "#reloadPlayersBtn") {
        return {
          count: async () => 1,
          isVisible: async () => true,
          isEnabled: async () => true,
          click: async () => {
            loading = true;
            setTimeout(() => { loading = false; }, 300);
          }
        };
      }
      throw new Error(`unexpected selector ${selector}`);
    }
  };
  return { frame, page };
}

test("reloads the upgrade inventory before concluding targets are exhausted", async () => {
  const icon = "https://x/season/ICON.png";
  const { frame, page } = createUpgradeAvailabilityFrame([
    { text: "A _id: aaa111 • +6 • reserve Giá 10M", disabled: false, imgSrcs: [icon] }
  ]);
  const result = await inspectUpgradeTargetAvailability(frame, page, { targetGrade: 6 });
  assert.equal(result.status, "exhausted");
  assert.equal(result.summary.eligible, 0);
  assert.equal(result.summary.reachedTarget, 1);
});

test("keeps waiting when the reloaded inventory still has an icon target", async () => {
  const icon = "https://x/season/ICON.png";
  const { frame, page } = createUpgradeAvailabilityFrame([
    { text: "A _id: aaa111 • +5 • reserve Giá 10M", disabled: false, imgSrcs: [icon] }
  ]);
  const result = await inspectUpgradeTargetAvailability(frame, page, { targetGrade: 6 });
  assert.equal(result.status, "has-targets");
  assert.equal(result.summary.eligible, 1);
});

test("checks target availability after reopening in the app's default auto mode/+5", async () => {
  const icon = "https://x/season/ICON.png";
  const { frame, page } = createUpgradeAvailabilityFrame(
    [{ text: "A _id: aaa111 • +6 • reserve Giá 10M", disabled: false, imgSrcs: [icon] }],
    {
      bodyText:
        `mode: auto_buy_upgrade\n${UG_AUTO_FORM_HEADING}\nKiểm tra & Bắt đầu\n` +
        "Muốn nâng lên mức thẻ +5\nBước 1: Chọn cầu thủ chính"
    }
  );
  const result = await inspectUpgradeTargetAvailability(frame, page, { targetGrade: 6 });
  assert.equal(result.status, "exhausted");
  assert.equal(result.summary.reachedTarget, 1);
});

test("does not conclude targets are exhausted when the reload failed", async () => {
  const { frame, page } = createUpgradeAvailabilityFrame([], { errorVisible: true });
  const result = await inspectUpgradeTargetAvailability(frame, page, { targetGrade: 6 });
  assert.deepEqual(result, { status: "unknown", reason: "reload-error" });
});

test("final check UI must match the configured spec", () => {
  const spec = { targetGrade: 6, minRatio: 100, bpProtectFromGrade: 8 };
  const good =
    "Mode\nTự chọn phôi\nSố target: 1\nSố phôi đã chọn: 8\nMục tiêu: +6\n" +
    "Tỉ lệ tối thiểu: 100%\nBảo vệ BP: KHÔNG KHẢ DỤNG";
  assert.doesNotThrow(() => verifyUpgradeFinalUi(good, spec, 8));
  assert.throws(() => verifyUpgradeFinalUi(good.replace("+6", "+5"), spec, 8), /mục tiêu/);
  assert.throws(() => verifyUpgradeFinalUi(good, spec, 7), /số phôi/);
  assert.throws(
    () => verifyUpgradeFinalUi(good.replace("KHÔNG KHẢ DỤNG", "BẬT"), spec, 8),
    /bảo vệ BP/
  );
});

test("final check UI accepts Telegram mini-app spacing variants", () => {
  const spec = { targetGrade: 7, minRatio: 74, bpProtectFromGrade: 8 };
  const text =
    "Số lượng target :\n1\nSố phôi đã chọn : 1\nMục tiêu : +7\n" +
    "Tỉ lệ tối thiểu : 74%\nBảo vệ BP : KHÔNG KHẢ DỤNG";
  assert.doesNotThrow(() => verifyUpgradeFinalUi(text, spec, 1));
});

test("parses OVR lists in comma and range forms", () => {
  assert.deepEqual(parseOvrList("114,115,116,117"), [114, 115, 116, 117]);
  assert.deepEqual(parseOvrList("112-118"), [112, 113, 114, 115, 116, 117, 118]);
  assert.deepEqual(parseOvrList("114, 116-117"), [114, 116, 117]);
  assert.throws(() => parseOvrList("abc"), /OVR không hợp lệ/);
  assert.throws(() => parseOvrList("118-112"), /Dải OVR không hợp lệ/);
});

test("reads OVRs of selected phôi cards for spec verification", () => {
  const cards = [
    "E. Petit _id: f1538d • +1 • reserve • ĐÃ CHỌN OVR 116 Mức thẻ +1 Giá 625,000",
    "Robin Hark _id: 1b01e6 • +1 • reserve OVR 113 Mức thẻ +1 Giá 1.24M",
    "J. Litmanen _id: 11c801 • +6 • reserve • ĐÃ CHỌN OVR 121 Mức thẻ +6 Giá 2B"
  ];
  assert.deepEqual(parseSelectedPhoiOvrs(cards), [116, 121]);
  assert.deepEqual(parseSelectedPhoiOvrs(["no badge here"]), []);
});

test("parses compact progress lines alongside verbose ones", () => {
  const chat =
    "- ID Cầu thủ abc: 4→5 | m=5 | 115:5 |\n" +
    "raw=100.0%\n" +
    "- ID Cầu thủ abc: Nâng thành công lên Mức thẻ 5 (Số lượng nguyên liệu còn: 60)";
  assert.deepEqual(parseUpgradeProgress(chat), [
    { grade: 5, materials: 5 },
    { grade: 5, materials: 60 }
  ]);
  assert.deepEqual(latestUpgradeProgress(chat), { grade: 5, materials: 60 });
});

test("parses the insufficient-materials warning for the loop", () => {
  const chat =
    "- ID Cầu thủ abc: Không đủ nguyên liệu (tối đa 5 phôi) để đạt 100%, bestPossible=55.33%";
  assert.deepEqual(parseUpgradeShortage(chat), { maxPhoi: 5, needRatio: 100, best: 55.33 });
  assert.equal(parseUpgradeShortage("Mua thành công! SPID: 1"), null);
});

test("carries possible percentage into a terminal shortage result", () => {
  const chat =
    "Kết quả nâng cấp:\n" +
    "- Nâng thành công 0/1 target.\n" +
    "- ID abc: Không đủ nguyên liệu (tối đa 11 phôi) để đạt 100%, bestPossible=72.5%\n" +
    "Cầu thủ ID abc: Mức thẻ cuối 5\n" +
    "Dừng do không đủ nguyên liệu để phù hợp.";
  assert.deepEqual(parseUpgradeSummary(chat), {
    success: 0,
    total: 1,
    finalGrade: 5,
    reason: "không đủ nguyên liệu để phù hợp",
    bestPossible: 72.5,
    possibleRequired: 100,
    materialsAvailable: 11,
    outOfMaterial: true,
    reachedTarget: false
  });

  test("marks zero remaining materials as phase exhaustion", () => {
    const chat =
      "Kết quả nâng cấp:\n" +
      "- Nâng thành công 0/1 target.\n" +
      "- ID abc: Nâng thành công lên Mức thẻ 3 (Số lượng nguyên liệu còn: 0)\n" +
      "Cầu thủ ID abc: Mức thẻ cuối 3\n" +
      "Dừng do hết nguyên liệu.";
    assert.deepEqual(parseUpgradeSummary(chat), {
      success: 0,
      total: 1,
      finalGrade: 3,
      reason: "hết nguyên liệu",
      materialsRemaining: 0,
      outOfMaterial: true,
      reachedTarget: false
    });
  });
});

test("a terminal without summary line still ends the run", () => {
  const chat =
    "Nếu gặp lỗi gõ /stopnc để dừng nâng cấp.\n" +
    "Kết quả nâng cấp:\n" +
    "- ID Cầu thủ 6acab803188e038e9886078: Không đủ nguyên liệu\n" +
    "để nâng cấp lên grade 0/1 (Số lượng nguyên liệu còn: 60)\n" +
    "Cầu thủ ID 6acab803188e038e9886078: Mức thẻ cuối 5\n" +
    "Dừng do không đủ nguyên liệu để phù hợp.";
  assert.deepEqual(parseUpgradeSummary(chat), {
    success: null,
    total: null,
    finalGrade: 5,
    reason: "không đủ nguyên liệu để phù hợp",
    outOfMaterial: true,
    reachedTarget: false
  });
  assert.equal(countUpgradeTerminals(chat), 1);
  assert.deepEqual(
    getUpgradeOutcomeFromFresh(chat, `Đã khởi động Auto Nâng Cấp (thủ công).\n${chat}`),
    {
      status: "completed",
      success: null,
      total: null,
      finalGrade: 5,
      reason: "không đủ nguyên liệu để phù hợp",
      outOfMaterial: true,
      reachedTarget: false
    }
  );
});

test("terminal counting separates finished runs from shared history", () => {
  const run1 =
    "Đã khởi động Auto Nâng Cấp (thủ công).\n" +
    "Nâng thành công 1/1 target.\nMức thẻ cuối 6\nDừng do đạt mục tiêu.";
  const run2 =
    "Đã khởi động Auto Nâng Cấp (thủ công).\n" +
    "Cầu thủ ID abc: Mức thẻ cuối 5\nDừng do hết nguyên liệu.";
  assert.equal(countUpgradeTerminals(run1), 1);
  assert.equal(countUpgradeTerminals(`${run1}\n${run2}`), 2);
  const baseline = getUpgradeCycleBaseline(run1);
  assert.equal(countUpgradeTerminals(`${run1}\n${run2}`) > baseline.terminals, true);
  assert.equal(countUpgradeTerminals(run1) > baseline.terminals, false);
});

// Hồi quy bug 2026-10-19: sau khi bấm bắt đầu nâng, Telegram thay toàn bộ
// snapshot (getFreshSince trả null). Lúc đó completion "Nâng thành công 1/1
// target" phải vẫn được nhận qua fallback đếm terminal, dù dòng "Đã khởi
// động..." còn trong cửa sổ (orphan bị chặn) — nếu không agent treo 180 phút.
test("workout outcome falls back to terminal counting when Telegram replaces the snapshot", () => {
  const ackText = "Đã khởi động Auto Nâng Cấp (thủ công).";
  const baseline = getUpgradeCycleBaseline(ackText);

  // Snapshot bị thay hẳn: baseline không còn trong text mới, nhưng terminal
  // mới đã đến và dòng start vẫn còn trong cửa sổ (orphan không phá được).
  const replacedSnapshot =
    "Đã khởi động Auto Nâng Cấp (thủ công).\n" +
    "- ID Cầu thủ 6ac049: 4→5 | m=2 | 115:2 | raw=130.1%\n" +
    "- ID Cầu thủ 6ac049: 5→6 | m=3 | 115:3 | raw=108.3%\n" +
    "Kết quả nâng cấp:\n" +
    "- Nâng thành công 1/1 target.\n" +
    "- Cầu thủ ID 6ac049: Mức thẻ cuối 6\n" +
    "Dừng do đạt mục tiêu.";
  const viaCount = getUpgradeRunOutcome(replacedSnapshot, baseline, null);
  assert.equal(viaCount.fresh, null);
  assert.deepEqual(viaCount.outcome, {
    status: "completed",
    success: 1,
    total: 1,
    finalGrade: 6,
    reason: "đạt mục tiêu",
    outOfMaterial: false,
    reachedTarget: true
  });

  // fresh còn hoạt động: ưu tiên outcome từ fresh, không suy đoán thêm.
  const appended = `${ackText}\nNâng thành công 0/1 target.\nMức thẻ cuối 5\nDừng do hết nguyên liệu.`;
  const viaFresh = getUpgradeRunOutcome(appended, baseline, ackText);
  assert.notEqual(viaFresh.fresh, null);
  assert.equal(viaFresh.outcome.status, "completed");
  assert.equal(viaFresh.outcome.reachedTarget, false);

  // Terminal cũ đã nằm trong baseline: không báo completion lần thứ hai.
  const oldTerminal = `${ackText}\nNâng thành công 1/1 target.\nMức thẻ cuối 6\nDừng do đạt mục tiêu.`;
  const oldBaseline = getUpgradeCycleBaseline(oldTerminal);
  const stuck = getUpgradeRunOutcome(oldTerminal, oldBaseline, oldTerminal);
  assert.equal(stuck.outcome, null);
});

// Hồi quy bug 2026-10-19 #2: bot kết thúc run thiếu phôi bằng
// "Nâng THẤT BẠI 0/1 target" (không phải "thành công"). Khi Telegram
// trim/re-render mất dòng "Đã khởi động...", tin này phải vẫn được đếm
// là terminal mới để fallback đếm nhận được outcome; nếu không agent
// treo lặng lẽ tới timeout 180 phút.
test("counts the nox nguyen-lieu failure summary as a run terminal", () => {
  // Dạng kết thúc: "Nâng thất bại 0/1 target."
  const failureTerminal =
    "Kết quả nâng cấp:\n" +
    "- Nâng thất bại 0/1 target.\n" +
    "- Cầu thủ ID ace56d: Mức thẻ cuối 5\n" +
    "Dừng do không đủ nguyên liệu hợp lệ.";
  assert.deepEqual(parseUpgradeSummary(failureTerminal), {
    success: 0,
    total: 1,
    finalGrade: 5,
    reason: "không đủ nguyên liệu hợp lệ",
    outOfMaterial: true,
    reachedTarget: false
  });
  assert.equal(countUpgradeTerminals(failureTerminal), 1);

  // Dòng checkpoint giữa run không đếm nhầm là terminal:
  // "Nâng thất bại 3 target lên grade 5" (không có dạng X/Y target).
  const checkpoint =
    "Kết quả nâng cấp:\n" +
    "- Nâng thất bại 3 target lên grade 5\n" +
    "- ID Cầu thủ ace56d: 4→5 | m=5 | 115:5 |\n" +
    "Nâng thành công lên Mức thẻ 5 (Số lượng nguyên liệu còn: 51)";
  assert.equal(countUpgradeTerminals(checkpoint), 0);
  // "Nâng thành công lên Mức thẻ 5" là progress thật (không phải terminal).
  assert.deepEqual(latestUpgradeProgress(checkpoint), { grade: 5, materials: 51 });

  // Chuỗi thật trong bug: Telegram trim mất dòng start, tin "thành công 1/1"
  // cũ vẫn còn trong cửa sổ và terminal "thất bại 0/1" của run mới đến sau.
  // Trước fix: count mới = 1 = baseline (tin cũ) -> fallback im lặng.
  const oldSuccess =
    "Nâng thành công 1/1 target.\n" +
    "Cầu thủ ID old5d: Mức thẻ cuối 6\n" +
    "Dừng do đạt mục tiêu.";
  const baselineText = `Đã khởi động Auto Nâng Cấp (thủ công).\n${oldSuccess}`;
  const baseline = getUpgradeCycleBaseline(baselineText);
  assert.equal(baseline.terminals, 1);
  // Cửa sổ replaces: mất dòng start, có tiến trình run mới + terminal sạch.
  const trimmedMergedWindow =
    `${oldSuccess}\n` +
    "- ID Cầu thủ ace56d: 4→5 | m=5 | 115:5 | raw=100.0%\n" +
    "Nâng thành công lên Mức thẻ 5 (Số lượng nguyên liệu còn: 51)\n" +
    `${failureTerminal}`;
  const detected = getUpgradeRunOutcome(trimmedMergedWindow, baseline, null);
  assert.equal(detected.fresh, null);
  assert.deepEqual(detected.outcome, {
    status: "completed",
    success: 0,
    total: 1,
    finalGrade: 5,
    reason: "không đủ nguyên liệu hợp lệ",
    outOfMaterial: true,
    reachedTarget: false
  });
});

// Hồi quy bug 2026-10-26: Telegram trim mất terminal cũ và thêm terminal mới
// trong cùng một lần cập nhật, nên count terminal vẫn là 1. Nếu chỉ so count,
// agent tưởng chưa xong và treo dù bot đã báo "Nâng thành công 0/1 target".
test("detects a new terminal when trimming swaps old and new terminals with the same count", () => {
  const oldTerminal =
    "Nâng thành công 0/1 target.\n" +
    "Cầu thủ ID old123456: Mức thẻ cuối 2\n" +
    "Dừng do không có nguyên liệu hợp lệ.\n" +
    "20:35";
  const baselineText = `Đã khởi động Auto Nâng Cấp (thủ công).\n${oldTerminal}`;
  const baseline = getUpgradeCycleBaseline(baselineText);
  assert.equal(baseline.terminals, 1);

  const newTerminal =
    "Nâng thành công 0/1 target.\n" +
    "Cầu thủ ID 6adefd43e78ab44b0c5c1413: Mức thẻ cuối 2\n" +
    "Dừng do Không có nguyên liệu hợp lệ.\n" +
    "20:41";
  const trimmedSnapshot =
    "- ID Cầu thủ 6adefd43e78ab44b0c5c1413: 4→5 | m=2 | 118:2 | raw=97.3%\n" +
    "- ID Cầu thủ 6adefd43e78ab44b0c5c1413: Nâng thành công lên Mức thẻ 5 " +
    "(Số lượng nguyên liệu còn: 9)\n" +
    newTerminal;
  assert.equal(countUpgradeTerminals(trimmedSnapshot), 1);
  assert.notEqual(getUpgradeTerminalKey(trimmedSnapshot), baseline.terminalKey);
  assert.equal(hasNewUpgradeTerminal(trimmedSnapshot, baseline), true);

  const detected = getUpgradeRunOutcome(trimmedSnapshot, baseline, null);
  assert.equal(detected.fresh, null);
  assert.deepEqual(detected.outcome, {
    status: "completed",
    success: 0,
    total: 1,
    finalGrade: 2,
    reason: "không có nguyên liệu hợp lệ",
    outOfMaterial: true,
    reachedTarget: false
  });

  // Cùng terminal cũ, không có gì mới: không được báo completion lần nữa.
  assert.equal(hasNewUpgradeTerminal(baselineText, baseline), false);
  assert.equal(getUpgradeRunOutcome(baselineText, baseline, baselineText).outcome, null);
  // DOM đang re-render làm mất mốc giờ nhưng nội dung y hệt: chưa đủ chắc chắn.
  assert.equal(hasNewUpgradeTerminal(baselineText.replace("\n20:35", ""), baseline), false);

  // Chat cuộn ngược làm terminal cũ (giờ sớm hơn) lộ ra: bỏ qua, không coi là mới.
  const newerBaseline = getUpgradeCycleBaseline(
    "Đã khởi động Auto Nâng Cấp (thủ công).\n" +
      "Nâng thành công 1/1 target.\n" +
      "Cầu thủ ID newer123456: Mức thẻ cuối 6\n" +
      "Dừng do đạt mục tiêu.\n" +
      "20:41"
  );
  assert.equal(hasNewUpgradeTerminal(
    "Nâng thành công 0/1 target.\n" +
      "Cầu thủ ID old123456: Mức thẻ cuối 2\n" +
      "Dừng do không có nguyên liệu hợp lệ.\n" +
      "20:35",
    newerBaseline
  ), false);
});
