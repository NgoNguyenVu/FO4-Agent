const test = require("node:test");
const assert = require("node:assert/strict");
const {
  hasIconMenuSignature,
  isIconSeason,
  parseFavoriteIconPlayers,
  buildPurchaseLines,
  selectRandomIconPlayers,
  parsePurchaseSuccesses,
  mergePurchaseSuccesses,
  getLatestBotError,
  isOrderLimitError,
  parseRetryAfterSeconds,
  parseCompactBp,
  parseTtcnCardText,
  selectOrderToCancel,
  getPositionAction,
  shouldCancelIconOrder
} = require("./patterns");
const { filterNewMessages, messagesToText } = require("./chat-messages");

const FAVORITES_TEXT = [
  "Danh sách cầu thủ yêu thích:",
  "101001201 - Gianfranco Zola - ICON - Grade: +1 - OVR: 108 - 44,300,000",
  "101001201 - Gianfranco Zola - ICON - Grade: +1 - OVR: 108 - 44,300,000",
  "101042331 - Rivaldo - ICONTM - Grade: +1 - OVR: 111 - 23,400,000",
  "102000001 - Không phải ICON - 26TOTS - Grade: +5 - OVR: 115 - 10,000,000",
  "103000001 - TKI Player - TKI - Grade: +1 - OVR: 100 - 5,000,000"
].join("\n");

test("icon favorites parser keeps ICON seasons and dedupes player codes", () => {
  const players = parseFavoriteIconPlayers(FAVORITES_TEXT);
  assert.deepEqual(
    players.map((player) => [player.code, player.name, player.season]),
    [
      ["101001201", "Gianfranco Zola", "ICON"],
      ["101042331", "Rivaldo", "ICONTM"],
      ["103000001", "TKI Player", "TKI"]
    ]
  );
  assert.equal(players[0].listedGrade, 1);
  assert.equal(players[0].ovr, 108);
  assert.equal(players[0].listedPrice, "44,300,000");
});

test("only ICON/TKI seasons count as icon favorites", () => {
  assert.equal(isIconSeason("ICON"), true);
  assert.equal(isIconSeason("ICONTM"), true);
  assert.equal(isIconSeason("ICONS MATCH"), true);
  assert.equal(isIconSeason("TKI"), true);
  assert.equal(isIconSeason("26TOTS"), false);
  assert.equal(isIconSeason("ICONIC"), true); // chứa ICON, chấp nhận để không bỏ sót mùa mới
});

test("purchase lines always use +1 and quantity 1", () => {
  assert.equal(
    buildPurchaseLines([{ code: "101001201" }, { code: "101042331" }], 1, 1),
    "101001201 1 1\n101042331 1 1"
  );
});

test("random icon selection is unique, excludes used codes and respects limit", () => {
  const players = [
    { code: "101001201" },
    { code: "101042331" },
    { code: "103000001" },
    { code: "104000001" },
    { code: "bad-code" }
  ];
  const selected = selectRandomIconPlayers(players, 3, {
    exclude: new Set(["103000001"]),
    rng: () => 0.5
  });
  assert.equal(selected.length, 3);
  assert.equal(new Set(selected.map((p) => p.code)).size, 3);
  assert.ok(!selected.some((p) => p.code === "103000001" || p.code === "bad-code"));
  assert.equal(players.length, 5, "selection must not mutate the source list");
  assert.deepEqual(
    selectRandomIconPlayers(players, 3, { exclude: new Set(players.map((p) => p.code)) }),
    []
  );
});

test("purchase log parser reads position and E004", () => {
  const text =
    "Đã đặt mua thành công 101214649 | 1 | 26,900,000 | 1/1 lúc 2026-10-26 19:18:02.120. Vị trí mua: 13\n" +
    "Đã đặt mua thành công 101001201 | 1 | 44,300,000 | 1/1 lúc 2026-10-26 19:18:03.500. Không lấy được vị trí mua (E004)";
  const successes = parsePurchaseSuccesses(text);
  assert.equal(successes.length, 2);
  assert.equal(successes[0].code, "101214649");
  assert.equal(successes[0].price, "26,900,000");
  assert.equal(successes[0].position, 13);
  assert.equal(successes[0].positionError, null);
  assert.equal(successes[1].position, null);
  assert.equal(successes[1].positionError, "E004");
  assert.match(successes[1].time, /^2026-10-26 19:18:03\.500/);
});

test("later purchase log for the same code replaces the older one but keeps a known position", () => {
  assert.deepEqual(
    mergePurchaseSuccesses(
      [{ code: "101001201", position: 13 }],
      [{ code: "101001201", position: 2 }]
    ),
    [{ code: "101001201", position: 2 }]
  );
  assert.deepEqual(
    mergePurchaseSuccesses(
      [{ code: "101001201", position: 13 }],
      [{ code: "101001201", position: null, positionError: null }]
    ),
    [{ code: "101001201", position: 13, positionError: null }]
  );
  // E004 ở log sau không được xóa vị trí đã biết của cùng đơn.
  assert.deepEqual(
    mergePurchaseSuccesses(
      [{ code: "101001201", position: 13, positionError: null }],
      [{ code: "101001201", position: null, positionError: "E004" }]
    ),
    [{ code: "101001201", position: 13, positionError: "E004" }]
  );
  assert.deepEqual(
    mergePurchaseSuccesses(
      [{ code: "101001201", position: null, positionError: "E004" }],
      [{ code: "101001201", position: null, positionError: null }]
    ),
    [{ code: "101001201", position: null, positionError: "E004" }]
  );
});

test("bot error and rate-limit helpers read the latest values", () => {
  assert.match(getLatestBotError("E002: Token không hợp lệ\nE006: hệ thống bận"), /^E006/);
  assert.equal(getLatestBotError("không có mã lỗi"), null);
  assert.equal(parseRetryAfterSeconds("Vui lòng chờ 4s rồi thử lại."), 4);
  assert.equal(parseRetryAfterSeconds("không nói thời gian"), 5);
});

test("order-limit errors are recognized with and without the E007 code", () => {
  assert.equal(
    isOrderLimitError(
      "E007: Bạn đã đạt giới hạn tối đa 3 lệnh đang chạy. Vui lòng chờ lệnh hiện tại hoàn thành."
    ),
    true
  );
  assert.equal(
    isOrderLimitError("Bạn đã đạt giới hạn tối đa 3 lệnh đang chạy, vui lòng chờ."),
    true
  );
  assert.equal(isOrderLimitError("Đã đặt mua thành công 101214649 | 1"), false);
  assert.equal(isOrderLimitError(""), false);
});

test("compact TTCN prices are converted to BP", () => {
  assert.equal(parseCompactBp("26.9M"), 26_900_000);
  assert.equal(parseCompactBp("1.2B"), 1_200_000_000);
  assert.equal(parseCompactBp("573,000"), 573_000);
  assert.equal(parseCompactBp("không rõ"), null);
});

test("TTCN card text is split into player fields", () => {
  const card = parseTtcnCardText("Rivaldo | ICONTM | 111 | 1 | 26.9M");
  assert.deepEqual(card, {
    name: "Rivaldo",
    season: "ICONTM",
    ovr: 111,
    grade: 1,
    priceText: "26.9M",
    price: 26_900_000
  });
  assert.equal(parseTtcnCardText("thiếu dữ liệu"), null);
});

test("TTCN order selection skips baseline, sell and receive orders", () => {
  const success = { code: "101001201", grade: 1 };
  const orders = [
    { spid: "101001201", orderType: 1, orderId: "old", action: "Hủy", grade: 1 },
    { spid: "101001201", orderType: 1, orderId: "new", action: "Hủy", grade: 1 },
    { spid: "101001201", orderType: 0, orderId: "sell", action: "Hủy", grade: 1 },
    { spid: "101001201", orderType: 1, orderId: "receive", action: "Nhận", grade: 1 },
    { spid: "101001201", orderType: 1, orderId: "wrong-grade", action: "Hủy", grade: 2 },
    { spid: "101001201", orderType: 1, orderId: null, action: "Hủy", grade: 1 }
  ];
  assert.equal(selectOrderToCancel(orders, success, new Set(["old"])).orderId, "new");
  assert.equal(selectOrderToCancel(orders, success).orderId, "new");
  assert.equal(selectOrderToCancel(orders, success, new Set(["old", "new"])), null);
});

test("position threshold decides keep, cancel, or unknown", () => {
  assert.equal(getPositionAction({ position: 6 }, 5), "cancel");
  assert.equal(getPositionAction({ position: 5 }, 5), "keep");
  assert.equal(getPositionAction({ position: 1 }, 5), "keep");
  assert.equal(getPositionAction({ position: null, positionError: "E004" }, 5), "unknown");
  assert.equal(getPositionAction(null, 5), "unknown");
});

test("icon session cancels bad and unknown positions, keeps only confirmed <= threshold", () => {
  assert.equal(shouldCancelIconOrder({ position: 6 }, 5), true);
  assert.equal(shouldCancelIconOrder({ position: 5 }, 5), false);
  assert.equal(shouldCancelIconOrder({ position: 1 }, 5), false);
  assert.equal(shouldCancelIconOrder({ position: null, positionError: "E004" }, 5), true);
  assert.equal(shouldCancelIconOrder({ position: null }, 5), true);
  assert.equal(shouldCancelIconOrder({ position: "không rõ" }, 5), true);
  assert.equal(shouldCancelIconOrder(null, 5), false);
});

test("icon menu signature needs both the member menu and Auto Mua entry", () => {
  assert.equal(
    hasIconMenuSignature("Chèn Member Thường\nAuto Mua Phôi"),
    true
  );
  assert.equal(hasIconMenuSignature("Chèn Member Thường"), false);
  assert.equal(hasIconMenuSignature("Auto Mua Phôi"), false);
});

test("new chat messages are selected by data-mid, not by chat text anchors", () => {
  const baseline = new Set(["100", "101"]);
  const messages = [
    { id: "100", text: "tin cũ" },
    { id: "102", text: "kết quả tra cứu mới" },
    { id: "103", text: "log đặt mua mới" },
    { id: null, text: "bỏ qua" }
  ];
  const fresh = filterNewMessages(messages, baseline);
  assert.deepEqual(fresh.map((message) => message.id), ["102", "103"]);
  assert.equal(messagesToText(fresh), "kết quả tra cứu mới\nlog đặt mua mới");
  assert.deepEqual(filterNewMessages(messages, null), []);
});
