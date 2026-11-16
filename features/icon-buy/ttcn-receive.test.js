// Behavior/unit test cho luồng ICON trên TTCN:
//   (a) đơn trước bị xóa khỏi TTCN thì vẫn xử lý tiếp đơn kế tiếp, không lệch index
//   (b) quét toàn bộ danh sách, chỉ nhận ICON "Nhận", bỏ qua PHÔI "Nhận"
//   (c) nhận ICON xong tự động chuyển sang mua phôi + nâng cấp
//   (d) Cycle v7: hủy "Hủy" + nhận "Nhận" trên CÙNG một lần mở TTCN
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  planTtcnCancellations,
  mergeTtcnOrderPages,
  selectIconOrdersToReceive,
  isReceiveAction
} = require("./patterns");
const { receiveFromPlan } = require("./receive");
const { runTtcnMaintenance } = require("./ttcn");
const { iconReceivePivotPlan } = require("../upgrade/receive-pivot");

function order(overrides) {
  return {
    text: "",
    spid: "101000000",
    code: "101000000",
    orderType: 1,
    orderId: null,
    action: "Hủy",
    name: "Test",
    season: "ICON",
    ovr: 110,
    grade: 1,
    price: 1_000_000,
    priceText: "1M",
    ...overrides
  };
}

test("(a) xóa đơn 27 khỏi TTCN xong vẫn xử lý tiếp đơn 4, không lệch index", () => {
  const targets = [
    { code: "101000027", grade: 1, position: 27, orderId: "id-27" },
    { code: "101000004", grade: 1, position: 4, orderId: "id-4" }
  ];
  const before = [
    order({ orderId: "id-27", spid: "101000027", code: "101000027" }),
    order({ orderId: "id-4", spid: "101000004", code: "101000004" })
  ];

  const first = planTtcnCancellations(before, targets, new Set());
  assert.deepEqual(
    first.map((entry) => entry.order.orderId),
    ["id-27", "id-4"]
  );

  // Sau khi hủy đơn 27, danh sách chỉ còn đơn 4. Quét lại từ đầu (không dùng
  // chỉ số cũ) vẫn phải trả đúng đơn 4.
  const after = before.filter((item) => item.orderId !== "id-27");
  const second = planTtcnCancellations(after, targets, new Set(["id-27"]));
  assert.deepEqual(
    second.map((entry) => entry.order.orderId),
    ["id-4"]
  );

  // Cả hai đơn đều biến mất: không sinh card ảo, không kẹt vòng lặp.
  assert.deepEqual(planTtcnCancellations([], targets, new Set(["id-27"])), []);
});

test("(a) orderId cũ đã xóa thì fallback sang card Hủy mới cùng mã/grade", () => {
  const targets = [
    { code: "101000027", grade: 1, position: 27, orderId: "id-27-gone" }
  ];
  const orders = [order({ orderId: "id-27-new", spid: "101000027" })];
  // Card mới trùng orderId baseline vẫn phải hủy được: target đến từ log đặt
  // mua của chính phiên này, baseline không được loại trừ nó.
  const plan = planTtcnCancellations(orders, targets, new Set(["id-27-new"]));
  assert.deepEqual(
    plan.map((entry) => entry.order.orderId),
    ["id-27-new"]
  );
});

test("(a) hai target cùng mã không ánh xạ vào cùng một card", () => {
  const targets = [
    { code: "101000027", grade: 1, position: 27 },
    { code: "101000027", grade: 1, position: 4 }
  ];
  const orders = [
    order({ orderId: "id-27", spid: "101000027" }),
    order({ orderId: "id-4", spid: "101000027" })
  ];
  const plan = planTtcnCancellations(orders, targets, new Set());
  assert.deepEqual(
    plan.map((entry) => entry.order.orderId),
    ["id-27", "id-4"]
  );
});

test("(b) quét toàn bộ TTCN: chỉ nhận ICON 'Nhận', bỏ qua PHÔI 'Nhận'", () => {
  const orders = [
    // Hàng 1-2: PHÔI và ICONTM cũng có nút Nhận nhưng không được bấm.
    order({ orderId: "phoi-1", spid: "102000001", season: "26TOTS", action: "Nhận" }),
    order({ orderId: "icontm-2", spid: "101042331", season: "ICONTM", action: "Nhận" }),
    // Hàng 3: ICON đang chờ mua (Hủy) -> không nhận.
    order({ orderId: "pending-3", spid: "101000003", season: "ICON", action: "Hủy" }),
    // Hàng 4-6: ICON đã mua xong nằm sâu trong danh sách -> phải nhận.
    order({ orderId: "phoi-4", spid: "102000004", season: "TKI", action: "Nhận" }),
    order({ orderId: "icon-5", spid: "101000005", season: "ICON", action: "Nhận", ovr: 111 }),
    order({ orderId: "icon-6", spid: "101000006", season: "ICON", action: "Nhận", ovr: 108 }),
    // Đơn BÁN / thiếu orderId không được coi là đơn mua đã khớp.
    order({ orderId: "sell-7", spid: "101000007", season: "ICON", action: "Nhận", orderType: 0 }),
    order({ orderId: null, spid: "101000008", season: "ICON", action: "Nhận" })
  ];

  const picked = selectIconOrdersToReceive(orders);
  assert.deepEqual(
    picked.map((item) => item.orderId),
    ["icon-5", "icon-6"]
  );
  assert.equal(picked.every((item) => item.season === "ICON"), true);
  assert.equal(isReceiveAction("Nhận"), true);
  assert.equal(isReceiveAction("Hủy"), false);

  // Lọc thêm theo mã phiên và grade khi cần.
  assert.deepEqual(
    selectIconOrdersToReceive(orders, {
      players: ["101000005"],
      grade: 1
    }).map((item) => item.orderId),
    ["icon-5"]
  );
  assert.deepEqual(
    selectIconOrdersToReceive(orders, { grade: 2 }),
    []
  );
});

test("(b) gộp nhiều trang cuộn không trùng, giữ nguyên dòng dưới hàng 3", () => {
  const page1 = [
    order({ orderId: "o1" }),
    order({ orderId: "o2" }),
    order({ orderId: "o3" })
  ];
  // Sau khi cuộn, mini-app render lại từ hàng 3 trở xuống (có overlap).
  const page2 = [
    order({ orderId: "o3" }),
    order({ orderId: "o4" }),
    order({ orderId: "o5" }),
    order({ orderId: "o6" })
  ];
  const merged = mergeTtcnOrderPages([page1, page2]);
  assert.deepEqual(
    merged.map((item) => item.orderId),
    ["o1", "o2", "o3", "o4", "o5", "o6"]
  );
});

test("(c) nhận ICON xong gọi callback để chuyển sang mua phôi + nâng cấp", async () => {
  let rows = [
    order({ orderId: "phoi-1", spid: "102000001", season: "26TOTS", action: "Nhận" }),
    order({ orderId: "icon-2", spid: "101000002", action: "Nhận" }),
    order({ orderId: "icon-5", spid: "101000005", action: "Nhận" })
  ];
  const clicked = [];
  const notified = [];
  const result = await receiveFromPlan({
    readOrders: async () => rows,
    clickReceive: async (item) => {
      clicked.push(item.orderId);
      rows = rows.filter((row) => row.orderId !== item.orderId);
      return { ok: true, message: "Nhận thành công" };
    },
    onReceived: async (item) => notified.push(item.spid)
  });

  assert.deepEqual(clicked, ["icon-2", "icon-5"]);
  assert.deepEqual(notified, ["101000002", "101000005"]);
  assert.equal(result.received.length, 2);
  assert.equal(result.failed.length, 0);

  // Callback của controller biến kết quả nhận thành kế hoạch pivot: bỏ cờ kho
  // sẵn có và ép kiểm tra kho ngay (thay vì chờ 30 phút).
  assert.deepEqual(iconReceivePivotPlan(result.received), {
    inventoryKnownAvailable: false,
    nextInventoryCheckAt: 0,
    codes: ["101000002", "101000005"]
  });
  assert.equal(iconReceivePivotPlan([]), null);
  assert.equal(iconReceivePivotPlan(null), null);
});

test("(c) nhận thất bại thì không báo pivot và không lặp card lỗi", async () => {
  const rows = [order({ orderId: "icon-2", spid: "101000002", action: "Nhận" })];
  let clicks = 0;
  let notified = 0;
  const result = await receiveFromPlan({
    readOrders: async () => rows,
    clickReceive: async () => {
      clicks += 1;
      return { ok: false, message: "Nhận thất bại" };
    },
    onReceived: async () => {
      notified += 1;
    }
  });
  assert.equal(clicks, 1);
  assert.equal(notified, 0);
  assert.equal(result.received.length, 0);
  assert.equal(result.failed.length, 1);
  assert.equal(iconReceivePivotPlan(result.received), null);
});

test("(d) một lần mở TTCN vừa hủy đơn xấu vừa nhận ICON 'Nhận'", async () => {
  let rows = [
    order({ orderId: "bad-1", spid: "101000001", code: "101000001", action: "Hủy" }),
    order({
      orderId: "phoi-2",
      spid: "102000002",
      code: "102000002",
      season: "26TOTS",
      action: "Nhận"
    }),
    order({ orderId: "icon-3", spid: "101000003", code: "101000003", action: "Nhận" })
  ];
  const events = [];
  const result = await runTtcnMaintenance({
    targets: [{ code: "101000001", grade: 1, position: 9 }],
    baselineIds: new Set(["old-1"]),
    receive: { grade: 1 },
    readOrders: async () => rows,
    cancelOrder: async (item) => {
      events.push(`cancel:${item.orderId}`);
      rows = rows.filter((row) => row.orderId !== item.orderId);
      return { ok: true, message: "Hủy thành công" };
    },
    clickReceive: async (item) => {
      events.push(`receive:${item.orderId}`);
      rows = rows.filter((row) => row.orderId !== item.orderId);
      return { ok: true, message: "Nhận thành công" };
    },
    wait: async () => {},
    onAfterCancel: async () => {},
    apiWaitRounds: 0
  });

  // Hủy trước, nhận sau, trên cùng một danh sách (một lần mở TTCN).
  assert.deepEqual(events, ["cancel:bad-1", "receive:icon-3"]);
  assert.deepEqual(result.canceled.map((item) => item.orderId), ["bad-1"]);
  assert.deepEqual(result.received.map((item) => item.orderId), ["icon-3"]);
  assert.deepEqual(result.receiveFailed, []);
  assert.deepEqual(result.notFound, []);
});

test("(d) hủy lỗi không chặn nhận ICON trong cùng lần mở", async () => {
  const rows = [
    order({ orderId: "bad-1", spid: "101000001", code: "101000001", action: "Hủy" }),
    order({ orderId: "icon-3", spid: "101000003", code: "101000003", action: "Nhận" })
  ];
  const received = [];
  const result = await runTtcnMaintenance({
    targets: [{ code: "101000001", grade: 1, position: 9 }],
    receive: { grade: 1 },
    readOrders: async () => rows,
    cancelOrder: async () => ({ ok: false, message: "Hủy thất bại" }),
    clickReceive: async (item) => {
      received.push(item.orderId);
      return { ok: true, message: "Nhận thành công" };
    },
    wait: async () => {},
    apiWaitRounds: 0
  });

  assert.equal(result.failed.length, 1);
  assert.deepEqual(received, ["icon-3"]);
  assert.deepEqual(result.received.map((item) => item.orderId), ["icon-3"]);
});

test("(d) đơn xấu đã biến mất khỏi TTCN vẫn quét nhận ICON", async () => {
  const rows = [
    order({ orderId: "icon-3", spid: "101000003", code: "101000003", action: "Nhận" })
  ];
  const result = await runTtcnMaintenance({
    targets: [{ code: "101000099", grade: 1, position: 9 }],
    receive: { grade: 1 },
    readOrders: async () => rows,
    cancelOrder: async () => ({ ok: true, message: "Hủy thành công" }),
    clickReceive: async () => ({ ok: true, message: "Nhận thành công" }),
    wait: async () => {},
    apiWaitRounds: 0
  });

  assert.deepEqual(result.notFound.map((item) => item.code), ["101000099"]);
  assert.deepEqual(result.received.map((item) => item.orderId), ["icon-3"]);
});

test("(d) không có target lẫn receive thì không đọc danh sách TTCN", async () => {
  let reads = 0;
  const result = await runTtcnMaintenance({
    targets: [],
    receive: null,
    readOrders: async () => {
      reads += 1;
      return [];
    }
  });
  assert.equal(reads, 0);
  assert.deepEqual(result, {
    canceled: [],
    failed: [],
    notFound: [],
    received: [],
    receiveFailed: []
  });
});

test("TTCN đọc toàn bộ danh sách và hủy/nhận trong một lần mở, theo orderId", () => {
  const ttcnSrc = fs.readFileSync(path.join(__dirname, "ttcn.js"), "utf8");
  assert.match(ttcnSrc, /scrollTop = list\.scrollHeight/);
  assert.match(ttcnSrc, /mergeTtcnOrderPages/);
  assert.match(ttcnSrc, /planTtcnCancellations/);
  assert.match(ttcnSrc, /receiveFromPlan/);
  assert.match(ttcnSrc, /async function readTtcnOrders\(frame, \{ scroll = true/);
  // Một lần mở TTCN: mở frame -> hủy + nhận trên cùng readOrders -> đóng.
  assert.match(ttcnSrc, /async function runTtcnMaintenance\(/);
  assert.match(ttcnSrc, /async function maintainTtcnOrders\(/);
  assert.match(ttcnSrc, /readOrders: \(\) => readTtcnOrders\(frame\)/);

  const runnerSrc = fs.readFileSync(path.join(__dirname, "runner.js"), "utf8");
  assert.match(runnerSrc, /onIconReceived/);
  assert.match(runnerSrc, /maintainTtcnOrders/);
  assert.match(runnerSrc, /maxWaitMs: configuredMonitorMs/);
  // Không còn nhịp mở TTCN riêng chỉ để nhận ICON.
  assert.doesNotMatch(runnerSrc, /RECEIVE_SCAN_INTERVAL_MS/);
  assert.doesNotMatch(runnerSrc, /scanReceivedIcons/);
  assert.doesNotMatch(runnerSrc, /nextReceiveScanAt/);

  const controllerSrc = fs.readFileSync(
    path.join(__dirname, "..", "controller.js"),
    "utf8"
  );
  assert.match(controllerSrc, /onIconReceived/);
  assert.match(controllerSrc, /iconReceivePivotPlan/);
});
