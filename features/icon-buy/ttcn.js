// Hủy các đơn mua vừa đặt bằng tab "Gỡ cầu thủ TTCN" của Auto Mua Phôi.
// Chỉ bấm nút Hủy trên đúng card mới; không dùng /stop và không đụng worker
// mua/nâng đang chạy.
const { withTimeout } = require("../../lib/playwright-utils");
const { config } = require("../config");
const { log } = require("../agent-log");
const {
  closeMiniApp,
  getPaymentFrameLocator,
  inspectPaymentFrames
} = require("../telegram-io");
const {
  ensureFeatureButton,
  clickFeatureButton,
  makeFlowError
} = require("./menu");
const {
  mergeTtcnOrderPages,
  parseTtcnCardText,
  planTtcnCancellations
} = require("./patterns");
const { receiveFromPlan } = require("./receive");

const TTCN_TAB_LABEL = "Gỡ cầu thủ TTCN";
const AUTO_BUY_LABEL = "Auto Mua Phôi";
const LOADING_SELECTOR = "#loading-cancel-message";
const ERROR_SELECTOR = "#error-cancel-message";
const LIST_SELECTOR = "#cancelList";

function shorten(text, max = 400) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cssAttr(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function waitForAutoBuyFrame(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastInfo = "";
  while (Date.now() < deadline) {
    const { count, visible, info } = await inspectPaymentFrames(page);
    lastInfo = info;
    if (count > 0 && visible) {
      const frame = getPaymentFrameLocator(page);
      const body = await withTimeout(
        frame.locator("body").innerText().catch(() => ""),
        10_000,
        "đọc nội dung mini-app Auto Mua"
      );
      if (/Mua Phôi/i.test(body) && /Gỡ cầu thủ TTCN/i.test(body)) {
        return { frame, lastInfo };
      }
    }
    await page.waitForTimeout(500);
  }
  return { frame: null, lastInfo };
}

// `refreshMenu` giữ để tương thích chỗ gọi cũ; từ nay lần mở đầu tiên luôn
// ưu tiên nút menu sẵn có, chỉ lần mở lại mới buộc xin /tn.
async function openAutoBuyFrame(
  page,
  rl,
  { refreshMenu = false, attempts = 2, allowTn = true } = {}
) {
  const { count: existingCount, visible: existingVisible } =
    await inspectPaymentFrames(page);
  if (existingCount > 0 && existingVisible) {
    const existing = getPaymentFrameLocator(page);
    try {
      const existingBody = await withTimeout(
        existing.locator("body").innerText(),
        5_000,
        "đọc mini-app đang mở"
      );
      if (/Mua Phôi/i.test(existingBody) && /Gỡ cầu thủ TTCN/i.test(existingBody)) {
        return existing;
      }
    } catch {
      // Chưa có iframe hoặc iframe đã bị Telegram gỡ.
    }
  }

  const perAttemptMs = Math.max(
    15_000,
    Math.floor((config.iconBuy.ttcnTimeoutSeconds * 1_000) / 2)
  );
  const maxAttempts = Math.max(1, Number(attempts) || 1);
  let lastInfo = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await closeMiniApp(page, "mini-app Auto Mua").catch(() => {});
    try {
      // Ưu tiên nút "Auto Mua Phôi" cũ còn hiển thị. Trước đây `refreshMenu`
      // làm lần mở đầu tiên luôn gửi /tn dù nút cũ vẫn bấm được, nên mỗi lượt
      // dò TTCN/hủy đơn lại spam một tin /tn (log 05:34, 05:36, 05:47).
      // Chỉ gửi /tn khi: chưa có nút, lần mở trước ra iframe trắng (attempt 2),
      // hoặc nút cũ hết token E002 — clickFeatureButton tự refresh một lần khi
      // gặp E002.
      const button = await ensureFeatureButton(page, rl, AUTO_BUY_LABEL, {
        refresh: attempt > 1,
        allowTn
      });
      // Truyền đúng locator vừa tìm được: clickFeatureButton không gọi lại
      // ensureFeatureButton (nguồn gửi /tn lần hai ngoài ý muốn).
      await clickFeatureButton(page, rl, AUTO_BUY_LABEL, {
        button,
        retries: 1,
        allowTn
      });
    } catch (error) {
      lastInfo = error.message;
      if (attempt >= maxAttempts) break;
      log(
        `Không mở được menu "${AUTO_BUY_LABEL}" (${error.message}); ` +
          `thử lại lần ${attempt + 1}/${maxAttempts}.`
      );
      continue;
    }

    const { frame, lastInfo: frameInfo } = await waitForAutoBuyFrame(
      page,
      perAttemptMs
    );
    lastInfo = frameInfo;
    if (frame) return frame;
    log(
      `Mini-app Auto Mua mở nhưng chưa có nội dung (${frameInfo || "iframe trắng"}); ` +
        `đóng và mở lại (${attempt + 1}/${maxAttempts}).`
    );
  }
  throw makeFlowError(
    `Không mở được mini-app Auto Mua để hủy TTCN (${lastInfo || "không có iframe"}).`,
    "MINI_APP_NOT_OPENED"
  );
}

async function waitForTtcnTab(frame) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const tab = frame.getByRole("button", { name: TTCN_TAB_LABEL, exact: false }).last();
    const count = await withTimeout(tab.count().catch(() => 0), 10_000, "đếm tab TTCN");
    if (count) {
      const visible = await withTimeout(
        tab.isVisible().catch(() => false),
        10_000,
        "kiểm tra tab TTCN"
      );
      if (visible) return tab;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw makeFlowError("Không thấy tab Gỡ cầu thủ TTCN trong mini-app.", "ICON_UI_NOT_READY");
}

async function waitForTtcnList(frame, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastLoading = true;
  while (Date.now() < deadline) {
    const loading = await withTimeout(
      frame.locator(LOADING_SELECTOR).isVisible().catch(() => false),
      10_000,
      "kiểm tra loading TTCN"
    );
    lastLoading = loading;
    const cards = await withTimeout(
      frame.locator(`${LIST_SELECTOR} > div`).count().catch(() => 0),
      10_000,
      "đếm đơn TTCN"
    );
    const error = await withTimeout(
      frame.locator(ERROR_SELECTOR).innerText().catch(() => ""),
      10_000,
      "đọc lỗi TTCN"
    );
    if (!loading) {
      if (cards > 0) return;
      if (error.trim()) {
        if (/Không có đơn hàng nào|Không có dữ liệu rao bán\/mua/i.test(error)) return;
        throw makeFlowError(`TTCN báo lỗi: ${shorten(error)}`, "ICON_TTCN_FAILED");
      }
      // Một số bản mini-app không hiện loading nhưng vẫn đang chờ API.
      if (!lastLoading && cards === 0) await new Promise((r) => setTimeout(r, 500));
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw makeFlowError(
    `TTCN chưa tải xong danh sách sau ${Math.round(timeoutMs / 1_000)}s.`,
    "ICON_TTCN_TIMEOUT"
  );
}

async function readVisibleTtcnOrders(frame) {
  const raw = await withTimeout(
    frame.locator(`${LIST_SELECTOR} > div`).evaluateAll((cards) =>
      cards.map((card) => {
        const checkbox = card.querySelector("input.select-order");
        const action = card.querySelector("button.action-btn");
        return {
          text: card.innerText || "",
          spid: card.getAttribute("data-spid"),
          orderType: card.getAttribute("data-ordertype"),
          orderId: checkbox ? checkbox.getAttribute("data-orderid") : null,
          action: action ? action.innerText : ""
        };
      })
    ),
    30_000,
    "đọc danh sách TTCN"
  );
  return raw.map((item) => {
    const parsed = parseTtcnCardText(item.text);
    return {
      ...item,
      code: item.spid ? String(item.spid) : null,
      orderType: Number(item.orderType),
      orderId: item.orderId || null,
      name: parsed?.name || null,
      season: parsed?.season || null,
      ovr: parsed?.ovr || null,
      grade: parsed?.grade || null,
      price: parsed?.price || null,
      priceText: parsed?.priceText || null
    };
  });
}

// Cuộn #cancelList xuống cuối. Mini-app chỉ render các dòng đang nhìn thấy nên
// nếu không cuộn sẽ bỏ sót các đơn từ hàng thứ 3 trở xuống.
async function scrollTtcnListToEnd(frame) {
  return withTimeout(
    frame
      .locator(LIST_SELECTOR)
      .evaluate((list) => {
        const before = list.scrollTop;
        list.scrollTop = list.scrollHeight;
        const atEnd =
          list.scrollTop + list.clientHeight >= list.scrollHeight - 4;
        return {
          before,
          atEnd,
          scrollTop: list.scrollTop,
          scrollHeight: list.scrollHeight,
          clientHeight: list.clientHeight
        };
      })
      .catch(() => ({
        before: 0,
        atEnd: true,
        scrollTop: 0,
        scrollHeight: 0,
        clientHeight: 0
      })),
    10_000,
    "cuộn danh sách TTCN"
  );
}

// Đọc TOÀN BỘ danh sách TTCN: lặp đọc trang đang render -> cuộn xuống cuối ->
// gộp theo orderId cho tới khi không còn dòng mới. Nhờ vậy quyết định hủy/nhận
// không phụ thuộc số dòng render sẵn hay chỉ số dòng.
async function readTtcnOrders(frame, { scroll = true, maxRounds = 8 } = {}) {
  const pages = [];
  let previousSignature = "";
  const rounds = Math.max(1, Number(maxRounds) || 1);
  for (let round = 0; round < rounds; round += 1) {
    const page = await readVisibleTtcnOrders(frame);
    pages.push(page);
    const merged = mergeTtcnOrderPages(pages);
    const signature = merged
      .map((order) => order.orderId || `${order.spid}:${order.action}`)
      .join("|");
    if (!scroll) break;
    const state = await scrollTtcnListToEnd(frame);
    if (state.atEnd && signature === previousSignature) break;
    previousSignature = signature;
    if (state.atEnd && round > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return mergeTtcnOrderPages(pages);
}

async function openTtcnList(
  page,
  rl,
  { refreshMenu = false, attempts = 2, allowTn = true } = {}
) {
  const frame = await openAutoBuyFrame(page, rl, { refreshMenu, attempts, allowTn });
  const tab = await waitForTtcnTab(frame);
  await withTimeout(tab.click(), 30_000, "mở tab Gỡ cầu thủ TTCN");
  await waitForTtcnList(frame, config.iconBuy.ttcnTimeoutSeconds * 1_000);
  return frame;
}

async function captureTtcnBaseline(page, rl) {
  let frame = null;
  try {
    // Chỉ 1 lần mở menu: thất bại thì trả null để vòng mua tự quyết định,
    // không gửi /tn lặp trong cùng một lần đọc.
    frame = await openTtcnList(page, rl, { attempts: 1 });
    const orders = await readTtcnOrders(frame);
    const errorText = await withTimeout(
      frame.locator(ERROR_SELECTOR).innerText().catch(() => ""),
      10_000,
      "đọc lỗi TTCN baseline"
    );
    if (
      orders.length === 0 &&
      /Không có dữ liệu rao bán\/mua/i.test(errorText)
    ) {
      // Mini-app không nhận được resources đơn hàng. Không được coi đây là
      // baseline rỗng: nếu API chỉ lỗi tạm thời, danh sách cũ có thể xuất hiện
      // lại và việc hủy sẽ không còn mốc orderId để đối chiếu.
      log(
        "TTCN không trả resources đơn hàng; baseline coi như không đọc được, " +
          "sẽ dùng card mới nhất khi cần hủy."
      );
      return null;
    }
    const ids = new Set(orders.map((order) => order.orderId).filter(Boolean));
    log(`TTCN baseline: ${orders.length} đơn hàng, ${ids.size} orderId đã biết.`);
    return ids;
  } catch (error) {
    if (error.code === "BOT_SYSTEM_ERROR") throw error;
    log(`Không đọc được TTCN baseline: ${error.message}`);
    return null;
  } finally {
    if (frame) await closeMiniApp(page, "mini-app Auto Mua").catch(() => {});
  }
}

async function waitForCancelResult(frame, orderId, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  const idSelector = `input[data-orderid=${cssAttr(orderId)}]`;
  while (Date.now() < deadline) {
    const exists = await withTimeout(
      frame.locator(idSelector).count().catch(() => 0),
      15_000,
      "kiểm tra đơn TTCN sau hủy"
    );
    if (!exists) return { ok: true, message: "đơn đã biến mất khỏi TTCN" };
    const card = frame.locator(`${LIST_SELECTOR} > div`).filter({
      has: frame.locator(idSelector)
    }).first();
    const message = await withTimeout(
      card.locator(".action-message").innerText().catch(() => ""),
      15_000,
      "đọc kết quả hủy TTCN"
    );
    if (/Hủy thành công/i.test(message)) return { ok: true, message: "Hủy thành công" };
    if (/Hủy thất bại/i.test(message)) return { ok: false, message: "Hủy thất bại" };
    const error = await withTimeout(
      frame.locator(ERROR_SELECTOR).innerText().catch(() => ""),
      15_000,
      "đọc lỗi hủy TTCN"
    );
    if (/Hủy thất bại|Lỗi:/i.test(error)) return { ok: false, message: error.trim() };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { ok: false, message: "không xác nhận được kết quả hủy" };
}

async function cancelOneOrder(frame, order) {
  const selector = `input[data-orderid=${cssAttr(order.orderId)}]`;
  const card = frame.locator(`${LIST_SELECTOR} > div`).filter({
    has: frame.locator(selector)
  }).first();
  const button = card.locator("button.action-btn").filter({ hasText: "Hủy" }).first();
  const count = await withTimeout(
    button.count().catch(() => 0),
    15_000,
    "đếm nút Hủy TTCN"
  );
  if (!count) {
    return { ok: false, message: "card không còn nút Hủy" };
  }
  await withTimeout(button.click(), 30_000, "bấm Hủy TTCN");
  return waitForCancelResult(frame, order.orderId);
}

async function waitForReceiveResult(frame, orderId, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  const idSelector = `input[data-orderid=${cssAttr(orderId)}]`;
  while (Date.now() < deadline) {
    const exists = await withTimeout(
      frame.locator(idSelector).count().catch(() => 0),
      15_000,
      "kiểm tra đơn TTCN sau nhận"
    );
    if (!exists) return { ok: true, message: "đơn đã biến mất khỏi TTCN" };
    const card = frame.locator(`${LIST_SELECTOR} > div`).filter({
      has: frame.locator(idSelector)
    }).first();
    const message = await withTimeout(
      card.locator(".action-message").innerText().catch(() => ""),
      15_000,
      "đọc kết quả nhận TTCN"
    );
    if (/Nhận thành công|Đã nhận/i.test(message)) {
      return { ok: true, message: "Nhận thành công" };
    }
    if (/thất bại|Lỗi:/i.test(message)) {
      return { ok: false, message: message.trim() };
    }
    const error = await withTimeout(
      frame.locator(ERROR_SELECTOR).innerText().catch(() => ""),
      15_000,
      "đọc lỗi nhận TTCN"
    );
    if (/thất bại|Lỗi:/i.test(error)) return { ok: false, message: error.trim() };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { ok: false, message: "không xác nhận được kết quả nhận" };
}

async function clickReceiveOrder(frame, order) {
  const selector = `input[data-orderid=${cssAttr(order.orderId)}]`;
  const card = frame.locator(`${LIST_SELECTOR} > div`).filter({
    has: frame.locator(selector)
  }).first();
  const button = card
    .locator("button.action-btn")
    .filter({ hasText: "Nhận" })
    .first();
  const count = await withTimeout(
    button.count().catch(() => 0),
    15_000,
    "đếm nút Nhận TTCN"
  );
  if (!count) {
    return { ok: false, message: "card không còn nút Nhận" };
  }
  await withTimeout(button.click(), 30_000, "bấm Nhận TTCN");
  return waitForReceiveResult(frame, order.orderId);
}

// Mở TTCN, quét toàn bộ danh sách và bấm "Nhận" cho đúng các thẻ ICON đã mua
// xong. Dòng PHÔI có "Nhận" bị lọc bỏ trong selectIconOrdersToReceive.
async function receiveIconOrders(
  page,
  rl,
  { players = null, grade = null, quantity = null, onReceived = null } = {}
) {
  let frame = null;
  try {
    frame = await openTtcnList(page, rl, {
      refreshMenu: false,
      attempts: 1,
      allowTn: false
    });
    return await receiveFromPlan({
      players,
      grade,
      quantity,
      onReceived,
      readOrders: () => readTtcnOrders(frame),
      clickReceive: (order) => clickReceiveOrder(frame, order)
    });
  } finally {
    if (frame) await closeMiniApp(page, "mini-app Auto Mua").catch(() => {});
  }
}


// Hủy các success đã lọc vị trí > ngưỡng. baselineIds là ảnh chụp TTCN trước
// khi đặt mua; nếu null thì vẫn chọn card khớp mã/grade và log cảnh báo.
//
// Danh sách được đọc lại TOÀN BỘ sau mỗi lần hủy và target được ánh xạ theo
// orderId (không theo chỉ số). Vì vậy khi đơn trước (ví dụ đơn 27) biến mất
// khỏi TTCN, đơn kế tiếp (đơn 4) vẫn được xử lý thay vì bị bỏ sót/lệch index.
async function cancelIconOrders(page, rl, successes, baselineIds = null) {
  const results = { canceled: [], failed: [], notFound: [] };
  const cancelable = (successes || []).filter((success) => {
    const position = Number(success?.position);
    return Number.isFinite(position) &&
      position > Number(config.iconBuy.cancelPositionAbove);
  });
  for (const success of (successes || []).filter((item) => !cancelable.includes(item))) {
    log(
      `Bỏ qua hủy TTCN ${success?.code || "không rõ"}: ` +
        "chưa xác nhận vị trí xấu; không hủy trong bước kiểm tra /stop."
    );
  }
  if (!cancelable.length) return results;
  let frame = null;
  try {
    frame = await openTtcnList(page, rl, { refreshMenu: true, attempts: 1 });
    const knownIds = baselineIds ? new Set(baselineIds) : null;
    // Giữ target theo khóa riêng thay vì chỉ số mảng để việc xóa đơn trước
    // không làm lệch các đơn còn lại.
    const remaining = new Map(
      cancelable.map((item, index) => [`${item.code}:${index}`, item])
    );
    let orders = await readTtcnOrders(frame);
    let waitedForApi = false;

    while (remaining.size) {
      let plan = planTtcnCancellations(
        orders,
        [...remaining.values()],
        knownIds
      );
      if (!plan.length && !waitedForApi) {
        // API TTCN có thể cập nhật chậm sau khi bot báo đặt mua thành công.
        waitedForApi = true;
        const orderDeadline = Date.now() + 10_000;
        while (!plan.length && Date.now() < orderDeadline) {
          await page.waitForTimeout(1_500);
          orders = await readTtcnOrders(frame);
          plan = planTtcnCancellations(
            orders,
            [...remaining.values()],
            knownIds
          );
        }
      }
      if (!plan.length) break;

      const { target, order } = plan[0];
      const targetKey = [...remaining.entries()].find(
        ([, item]) => item === target
      )?.[0];
      if (targetKey) remaining.delete(targetKey);
      target.orderId = order.orderId;
      const cancelPositionText =
        target.position == null
          ? target.positionError || "không rõ"
          : String(target.position);
      log(
        `Đang hủy đơn TTCN ${target.code} (orderId ${order.orderId}, ` +
          `grade ${order.grade}, giá ${order.priceText}, vị trí ${cancelPositionText}).`
      );
      const result = await cancelOneOrder(frame, order);
      if (result.ok) {
        results.canceled.push({
          ...target,
          orderId: order.orderId,
          message: result.message
        });
        if (knownIds) knownIds.add(order.orderId);
        log(`Đã hủy đơn ${target.code} (${result.message}).`);
      } else {
        results.failed.push({
          ...target,
          orderId: order.orderId,
          message: result.message
        });
        log(`Hủy đơn ${target.code} thất bại: ${result.message}.`);
      }
      await page.waitForTimeout(800);
      // cancelOrder() gọi checkCancel() làm trống rồi tải lại #cancelList.
      // Chờ loading kết thúc trước khi đọc lại toàn bộ danh sách cho đơn tiếp.
      await waitForTtcnList(frame, config.iconBuy.ttcnTimeoutSeconds * 1_000).catch(
        () => {}
      );
      orders = await readTtcnOrders(frame);
      waitedForApi = false;
    }

    for (const item of remaining.values()) {
      results.notFound.push(item);
      const positionText =
        item.position == null
          ? item.positionError || "không rõ"
          : item.position;
      log(
        `Không thấy đơn TTCN mới để hủy cho ${item.code} (vị trí ${positionText}); ` +
          "có thể đơn đã khớp hoặc đã được nhận."
      );
    }
  } finally {
    if (frame) await closeMiniApp(page, "mini-app Auto Mua").catch(() => {});
  }
  return results;
}

module.exports = {
  openAutoBuyFrame,
  openTtcnList,
  readTtcnOrders,
  captureTtcnBaseline,
  cancelIconOrders,
  receiveIconOrders
};
