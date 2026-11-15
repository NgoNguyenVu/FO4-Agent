# TASK-045 — Integration test vòng buy (worker lifecycle)

## Thông tin

- **Priority:** P1
- **Risk:** Medium
- **Effort:** M
- **Dependency:** TASK-005B (`d976b6d`), TASK-039 review/QA (2026-11-14)
- **Status:** **DONE** — Cycle v4 (2026-11-14), branch `ai/auto-cycle-v4`; Reviewer APPROVED + QA PASS; Gate **A (95/100)**. Xem [completed/TASK-045-buy-integration-test.md](../completed/TASK-045-buy-integration-test.md).
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

## 2. Cách gỡ block (Cycle v4)

Thay vì refactor controller thành god-module nhận dependency (rủi ro cao, blast radius CRITICAL), Cycle v4 dựng **mock adapter tối thiểu** đúng bề mặt API mà code thật gọi:

| Thành phần | Vai trò |
|---|---|
| `lib/__fixtures__/mock-playwright.js` | `page` giả: locator/composer/evaluate/goto/reload; chỉ mô phỏng đúng selector và hành vi buy/ICON dùng |
| `lib/__fixtures__/mock-telegram.js` | Ghép mock page với **chat tracker thật** (`createChatTextTracker`), nên parser + state machine chạy thật; test chỉ bơm câu trả lời bot |
| `lib/buy-worker-lifecycle.integration.test.js` | 13 test tích hợp vòng buy + worker lifecycle + nhánh ICON |

Hai thay đổi runtime nhỏ, tương thích ngược:

- `waitForStartAcknowledgement(page, baseline, rl, { timeoutMs })`: tham số test-only, mặc định giữ nguyên 90s.
- `features/icon-buy/runner.js` export thêm `captureStopBaselineWithRetry` cho integration test (không phải API runtime; controller chỉ dùng `runIconBuy`).

## 3. Phạm vi

| File | Thay đổi |
|---|---|
| `lib/__fixtures__/mock-playwright.js` **(mới)** | Mock page adapter |
| `lib/__fixtures__/mock-telegram.js` **(mới)** | Mock hội thoại bot trên tracker thật |
| `lib/buy-worker-lifecycle.integration.test.js` **(mới)** | 13 test tích hợp |
| `features/buy/cycle.js` | `timeoutMs` optional cho test |
| `features/icon-buy/runner.js` | Export thêm helper cho test |

Không đổi `config.json`, không đổi hành vi mua/nâng/giá, không đụng `purchaseTimeoutSeconds`.

## 4. Test plan

| # | Case | Kỳ vọng |
|---|---|---|
| 1 | Bot ACK sau khi bấm Bắt đầu | `waitForStartAcknowledgement` trả về, không lỗi |
| 2 | Thiếu ACK, `/stop` báo worker đang chạy | Adopt worker hiện tại, không bấm lại |
| 3 | Thiếu ACK, `/stop` báo không có lệnh | `START_ACK_TIMEOUT` |
| 4 | Thiếu ACK, `/stop` trả E006 | `START_ACK_UNVERIFIED`, không bấm mù |
| 5 | `checkAutoBuyRunning` | Phân biệt running / idle từ reply `/stop` |
| 6 | begin → running → stopped | Worker `stopped`, lease nhả, slot mở lại |
| 7 | `START_ACK_UNVERIFIED` → unknown | Lần chạy sau bị chặn (`WORKER_ACTIVE`) |
| 8 | Restart có bằng chứng chat | Adopt worker đang chạy |
| 9 | Restart không có bằng chứng | `unknown` + chặn |
| 10 | ICON chọn task monitor | Chỉ task MUA đúng grade/quantity |
| 11 | `captureStopBaselineWithRetry` đọc được ngay | Baseline rỗng, không retry |
| 12 | `captureStopBaselineWithRetry` thất bại | Retry 3 lần, reload đúng 1 lần, trả `null` |
| 13 | `purchaseTimeoutSeconds = 0` + soft watchdog | Trả quyền nhanh, không treo |

## 5. Rollback

Xóa 3 file test/fixture mới; revert 2 thay đổi nhỏ trong `features/buy/cycle.js` và `features/icon-buy/runner.js`. Không migration, không ảnh hưởng runtime.

## 6. Definition of Done

- Reviewer APPROVED + QA PASS.
- `npm test` 100% (319/319), `npm run scan:secrets` + `scan:history` pass.
- `cortex_detect_changes` có ghi nhận (risk medium do `waitForStartAcknowledgement`, đã có test hồi quy).
