# TASK-005B — Controller dùng worker registry làm source of truth

## Thông tin

- **Priority:** P0
- **Risk:** High
- **Effort:** M
- **Dependency:** TASK-005 Stage A (`7fee795`)
- **Status:** **DONE** — Cycle v2 (2026-11-13), branch `ai/auto-cycle-v2`; Reviewer APPROVED + QA PASS; Gate B (82/100). Xem [completed/TASK-005B-controller-registry-integration.md](../completed/TASK-005B-controller-registry-integration.md).
- **Owner đề xuất:** Platform / Concurrency
- **Task gốc:** [TASK-005](TASK-005-worker-state-lock.md)

## 1. Mục tiêu

Chuyển controller từ chỗ chỉ *ghi* state worker sang **dùng registry làm nguồn sự thật**:

- Khởi động/khôi phục phiên: gọi `registry.reconcile()` thay vì tin hoàn toàn vào chat text.
- Đăng ký worker thật cho 3 luồng: `buy`, `upgrade`, `icon` (`beginStart` → `markRunning` → `beginStop` → `markStopped`).
- Khi không xác định được worker còn chạy hay không: `markUnknown` (fail-closed, chặn mua mới) cho tới khi con người xử lý.
- Cho phép worker nền (`icon`) chạy song song với worker độc quyền (`buy`/`upgrade`) nhưng không cho hai worker độc quyền chạy cùng lúc.

## 2. Phạm vi

- `lib/worker-registry.js`: thêm `concurrencyGroup`, shared singleton, `resolveUnknown`.
- `lib/worker-session.js` **(mới)**: lớp adapter mỏng, testable không cần Playwright.
- `lib/worker-session.test.js` **(mới)**.
- `agent.js`: dùng `getWorkerRegistry()`.
- `features/controller.js`: reconcile khi khởi động, đăng ký/dừng worker quanh buy/upgrade/icon, cập nhật heartbeat `activeWorkerId`.
- `docs/README` / runbook: cách xử lý worker `unknown`.

Không thuộc phạm vi:

- Thay đổi logic chọn cầu thủ, giá, hay tham số tài chính.
- Bật hard cap chi tiêu (TASK-003 Stage B — cần Owner Decision).

## 3. Thiết kế

### 3.1. Registry

| Thành phần | Ý nghĩa |
|---|---|
| `concurrencyGroup: "exclusive"` (mặc định) | Buy/upgrade. Không được có worker exclusive khác đang chạy. |
| `concurrencyGroup: "background"` | Icon. Được chạy cùng worker exclusive; không được trùng feature. |
| `state: unknown` | Chặn **mọi** `beginStart` cho tới khi resolve. |
| `getWorkerRegistry(options)` | Singleton dùng chung giữa `agent.js` và `controller.js`. |
| `resolveUnknown(workerId, note)` | Chuyển `unknown → stopped` sau khi con người đã kiểm tra bot. |

### 3.2. Adapter `lib/worker-session.js`

- `tryBegin(feature, { cycleId, concurrencyGroup })` → trả về worker hoặc `null` nếu bị chặn (`WORKER_ACTIVE`).
- `markRunning(feature)`, `stop(feature, { reason, unknown })`.
- `reconcileOnStartup({ hasWorkerEvidence })`:
  1. Worker nền (`icon`) còn `running` sau restart ⇒ `stopped` (process cũ đã chết, không thể adopt).
  2. Gọi `registry.reconcile()`; `adopt` thì nạp lại vào map phiên.
- `blockedReason()` / `listActive()` cho log + heartbeat.

### 3.3. Điểm tích hợp controller

| Luồng | Đăng ký | Kết thúc |
|---|---|---|
| Buy | Trước khi bấm "Bắt đầu Auto Mua" | Sau khi có outcome, hoặc `unknown` nếu lỗi không xác định |
| Upgrade | Trước `runSingleUpgrade` / `pivotMasterToUpgrade` | `stopped` với lý do `up.action` |
| Icon | Trước `runIconBuy` | `stopped` khi promise kết thúc |

## 4. Test plan (Executors)

| # | Case | Loại |
|---|---|---|
| 1 | `beginStart` exclusive thứ hai bị chặn | Unit |
| 2 | Background + exclusive chạy song song được | Unit |
| 3 | Hai background cùng feature bị chặn | Unit |
| 4 | `unknown` chặn mọi `beginStart` | Unit |
| 5 | `resolveUnknown` mở lại đường chạy | Unit |
| 6 | `reconcileOnStartup` dọn icon stale, adopt buy có evidence | Unit |
| 7 | `reconcileOnStartup` block khi registry active mà chat không có evidence | Unit |
| 8 | `tryBegin` idempotent trong cùng phiên | Unit |
| 9 | Singleton registry dùng chung | Unit |
| 10 | Toàn bộ suite cũ vẫn xanh | Regression |

## 5. Rollback

- Revert `lib/worker-session.js`, `lib/worker-session.test.js`, và các hunk trong `worker-registry.js`/`agent.js`/`controller.js`.
- Xóa `<LOCALAPPDATA>/FO4PurchaseAgent/state/workers.json` nếu state ghi bởi bản mới gây `unknown`.
- Không migration dữ liệu; không đổi giao dịch.