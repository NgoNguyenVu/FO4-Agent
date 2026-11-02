# TASK-002 — Persistent purchase journal

## Thông tin

- **Priority:** P0
- **Risk:** High
- **Effort:** L
- **Dependency:** TASK-007
- **Blocks:** TASK-003 (Stage B), TASK-005
- **Status:** Todo
- **Owner đề xuất:** Platform + Financial integrity

## 1. Mục tiêu

Tạo journal bền vững cho mọi giao dịch BP, có idempotency key và reconcile khi startup, để crash/restart không tạo đơn trùng và mọi khoản chi đều đối soát được.

Phạm vi:

- Ghi intent trước khi đặt đơn, ghi kết quả sau khi bot xác nhận.
- Ghi cho cả Buy, Upgrade và ICON.
- Reconcile khi agent khởi động.
- API truy vấn tổng chi theo run/ngày/tuần cho TASK-003.
- Audit trail theo cycle và theo ngày.

Không thuộc phạm vi:

- Hard cap chi tiêu (TASK-003).
- Worker state machine (TASK-005).
- Thay đổi selector hoặc luồng UI.

## 2. Bằng chứng

- README dòng 253: “The agent does not write purchase state or cycle totals to disk.”
- Trong toàn bộ runtime, chỉ `features/agent-log.js` ghi disk; không có journal giao dịch.
- `pendingBuyCompletion` chỉ tồn tại trong memory của `features/controller.js`.
- Không có `cycleId`, `orderId`, `idempotencyKey` hoặc ledger BP.
- `features/icon-buy/order.js` và `features/upgrade/runner.js` chỉ giữ kết quả trong object trả về.
- Crash giữa `placeIconOrders()` và `waitForPurchaseResults()` để lại trạng thái “không biết đã đặt hay chưa”.

## 3. Thiết kế đề xuất

### 3.1. Module mới

`lib/purchase-journal.js` — append-only JSONL, một writer duy nhất:

```text
state/
  purchase-journal-2026-10-31.jsonl
  purchase-journal.lock
  purchase-journal.meta.json
```

- Mỗi dòng là một event JSON độc lập.
- Ghi bằng `appendFileSync` + `fsyncSync` cho event quan trọng (`intent`, `placed`, `confirmed`, `canceled`, `failed`).
- Dòng cuối bị hỏng khi crash: bỏ qua, log warning, không làm hỏng cả file.
- Lock file chứa `pid`, `startedAt`, `heartbeatAt`; process thứ hai không được ghi.
- Rotate theo ngày; retention mặc định 30 ngày, cấu hình được.

### 3.2. Event schema

```json
{
  "version": 1,
  "eventId": "uuid",
  "eventType": "intent|submitted|placed|confirmed|failed|canceled|unknown|reconciled",
  "at": "2026-10-31T03:00:00.000Z",
  "runId": "run-...",
  "cycleId": "cycle-...",
  "feature": "buy|upgrade|icon",
  "workerId": "...",
  "orderId": "...",
  "playerCode": "123456789",
  "grade": 1,
  "quantity": 1,
  "unitPriceBP": 666666,
  "totalBP": 666666,
  "idempotencyKey": "sha256:...",
  "source": "agent|manual|debug",
  "note": "..."
}
```

### 3.3. Idempotency

`idempotencyKey = sha256(runId + cycleId + feature + playerCode + grade + quantity + attempt)`.

- Trước khi gửi lệnh mua, kiểm tra key đã có event `intent`/`placed`/`confirmed` chưa.
- Nếu đã có và chưa terminal: không gửi lại; chuyển sang reconcile.
- Nếu đã `confirmed`: bỏ qua, log duplicate.
- Nếu `failed`/`canceled`: cho phép attempt mới với `attempt + 1`.

### 3.4. State machine

```text
intent ──► submitted ──► placed ──► confirmed
   │            │           │
   │            │           ├──► failed
   │            │           └──► canceled
   │            └──► unknown (timeout, mất chat, crash)
   └──► canceled (chưa gửi)
```

`unknown` không được tự retry. Agent phải:

1. Đọc lại chat/bot evidence.
2. Nếu xác định đã đặt: chuyển `placed` và tiếp tục theo dõi.
3. Nếu xác định chưa đặt: chuyển `canceled`, giải phóng reservation.
4. Nếu không xác định: dừng mua, yêu cầu human xác nhận.

### 3.5. Reconcile khi startup

- Đọc journal của hôm nay và N ngày gần nhất.
- Tìm event không terminal: `intent`, `submitted`, `placed`, `unknown`.
- Với mỗi event:
  - Kiểm tra worker/order còn tồn tại qua chat evidence.
  - Nếu còn: đánh dấu `reconciled`, giữ trạng thái, không start cycle mới.
  - Nếu mất: đánh dấu `unknown`, chặn giao dịch mới đến khi human xử lý.
- Trả về `reconcileReport` cho controller; log rõ số event và hành động.

### 3.6. API

- `recordIntent(input) -> event`
- `recordPlaced(eventId, patch)`
- `recordTerminal(eventId, status, patch)`
- `getOpenEvents()`
- `getSpendSince(isoDate)`
- `getSpendByCycle(cycleId)`
- `reconcile({ readEvidence })`

## 4. Patch plan (không sửa code trong phase này)

1. Thêm `lib/purchase-journal.js` và test unit.
2. Thêm config `journal.enabled`, `journal.dir`, `journal.retentionDays`, `journal.fsync`.
3. Instrument `features/buy/cycle.js`: intent trước khi start worker; placed khi có order/worker; terminal khi cycle kết thúc.
4. Instrument `features/icon-buy/order.js`: intent trước `placeIconOrders()`; placed sau khi gửi; terminal sau `waitForPurchaseResults()`.
5. Instrument `features/upgrade/runner.js`: intent trước khi bấm nâng; terminal sau `settleUpgradeOutcome()`.
6. `features/controller.js`: gọi `reconcile()` trước khi nhận lệnh đầu tiên; log report; chặn start nếu còn `unknown`.
7. Thêm `state/` vào `.gitignore`.
8. Cập nhật README mục “State and recovery”.

## 5. Test plan

| Loại | Case | Kỳ vọng |
|---|---|---|
| Unit | Append event, đọc lại | Round-trip đúng schema |
| Unit | Dòng cuối bị cắt | Bỏ qua, không throw, log warning |
| Unit | Cùng idempotency key ghi 2 lần | Lần 2 bị từ chối hoặc trả event cũ |
| Unit | `getSpendSince` nhiều ngày | Tổng đúng, không tính event failed/canceled |
| Crash | Kill giữa `intent` và `placed` | Restart thấy `unknown`, chặn mua mới |
| Crash | Kill sau `placed`, trước `confirmed` | Restart reconcile, không đặt lại |
| Crash | Kill sau `confirmed` | Restart không tạo đơn mới |
| Concurrency | Hai process cùng mở journal | Process thứ hai bị từ chối lock |
| Reconcile | Journal có event cũ đã terminal | Không chặn |
| Reconcile | Journal có `unknown` | Chặn start, log rõ |
| Retention | Rotate qua ngày | File mới, file cũ giữ theo retention |
| Regression | `npm run check` | 174+ test pass |

## 6. Rollback

- Feature flag `journal.enabled=false`: journal chỉ ghi shadow, không chặn giao dịch.
- Giữ nguyên file journal; không xóa dữ liệu khi rollback.
- Revert theo commit của task; không rewrite history.
- Nếu reconcile chặn nhầm: cho phép human đánh dấu `reconciled` thủ công qua CLI có audit.

## 7. Definition of Done

- Mọi giao dịch Buy/Upgrade/ICON đều có intent + terminal event.
- Kill giữa chu kỳ rồi restart không tạo đơn trùng.
- Có report đối soát BP theo cycle/ngày.
- Có test crash/restart và concurrency.
- `state/` không bị track.
- README mô tả journal, retention và quy trình reconcile.
