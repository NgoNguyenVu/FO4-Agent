# TASK-045 — Integration test vòng buy (worker lifecycle)

## Thông tin

- **Priority:** P1
- **Risk:** Medium
- **Effort:** M
- **Dependency:** TASK-005B (`d976b6d`), TASK-039 review/QA (2026-11-14)
- **Status:** **BLOCKED** — Cycle v3 (2026-11-14), branch `ai/auto-cycle-v3`
- **Owner đề xuất:** Platform / Reliability
- **Nguồn:** Follow-up của TASK-005B (§5) và TASK-039 (risk #6)

## 1. Mục tiêu

Khóa bằng test hành vi cho vòng đời worker buy và các nhánh ICON rủi ro cao, thay vì chỉ assert source code:

1. `beginStart("buy") → click Bắt đầu → markRunning → outcome → stop` trên controller thật.
2. `START_ACK_UNVERIFIED` → worker `unknown` → lần chạy sau bị registry chặn.
3. `/resetagent` không đóng worker registry; reconcile sau đó adopt được worker đang chạy.
4. ICON: `monitorExistingOrders` không bám nhầm task thủ công.
5. ICON: `captureStopBaselineWithRetry` retry rồi mới bỏ cuộc.
6. ICON: deadline `purchaseTimeoutSeconds = 0` không làm treo vòng chờ; soft watchdog trả quyền về runner.

## 2. Vì sao BLOCKED

| Blocker | Chi tiết |
|---|---|
| Thiếu harness Playwright | Repo chưa có test harness dựng `page`/`frame` giả lập mini-app; controller hiện là god module khó inject. |
| Cần tài khoản Telegram thật | Kịch bản buy/ICON phụ thuộc DOM Telegram Web + bot thật; không thể chạy trong CI mặc định. |
| Phụ thuộc TASK-039 | Nhánh ICON cần chốt `purchaseTimeoutSeconds` (Owner Decision 2026-11-14) trước khi viết test deadline. |

## 3. Unblock condition

Task mở lại khi **đồng thời**:

1. Có harness test dựng page/frame giả lập (hoặc tách controller thành hàm nhận dependency).
2. Có môi trường Telegram test (tài khoản phụ + bot) hoặc quyết định chấp nhận test bằng stub DOM.
3. TASK-039 đã có Owner Decision cho `purchaseTimeoutSeconds`.

## 4. Phạm vi dự kiến

- `lib/worker-session` đã có test unit; phần còn thiếu là **tích hợp** với controller.
- Ưu tiên tách `runBuyCycle`/`runIconCycle` thành hàm nhận `{ page, rl, ui, registry }` để test không cần Playwright thật.
- Không thay đổi hành vi runtime trong task này.

## 5. Rollback

Xóa test/harness mới; không ảnh hưởng runtime.
