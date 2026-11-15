# TASK-045 — Integration test vòng buy (worker lifecycle) — COMPLETED 2026-11-14

- **Priority:** P1 — Reliability / Testing
- **Branch:** `ai/auto-cycle-v4`
- **Trạng thái:** **DONE** — Reviewer APPROVED, QA PASS, Quality Gate **A (95/100)**
- **Task gốc:** [TASK-045](TASK-045-buy-integration-test.md) · Follow-up của [TASK-005B](TASK-005B-controller-registry-integration.md) và TASK-039
- **Review:** [TASK-045-review-2026-11-14.md](../reviews/TASK-045-review-2026-11-14.md)
- **QA:** [TASK-045-qa-2026-11-14.md](../reviews/TASK-045-qa-2026-11-14.md)

## 1. Vấn đề

TASK-045 bị chặn từ Cycle v3 vì repo không có harness Playwright, kịch bản buy/ICON phụ thuộc Telegram thật, và controller là god module khó inject. Hệ quả: vòng đời worker buy và các nhánh fail-closed (`START_ACK_TIMEOUT`, `START_ACK_UNVERIFIED`, reconcile sau restart) chỉ được bảo vệ bằng unit test rời rạc, không có test tích hợp end-to-end.

## 2. Cách gỡ block

Thay vì refactor controller (blast radius CRITICAL), dựng mock adapter tối thiểu:

| File | Nội dung |
|---|---|
| `lib/__fixtures__/mock-playwright.js` **(mới)** | Page giả với locator/composer/evaluate/goto/reload; chỉ phủ đúng selector và hành vi mà buy/ICON gọi |
| `lib/__fixtures__/mock-telegram.js` **(mới)** | Đăng ký **chat tracker thật** vào `chatTextReaders`; test bơm câu trả lời bot qua `replyTo`/`append` |
| `lib/buy-worker-lifecycle.integration.test.js` **(mới)** | 13 test tích hợp: ACK/adopt/timeout/unverified, checkAutoBuyRunning, worker lifecycle, restart reconcile, chọn task ICON, baseline retry, soft watchdog |
| `features/buy/cycle.js` | `waitForStartAcknowledgement` nhận `timeoutMs` optional (test-only) |
| `features/icon-buy/runner.js` | Export `captureStopBaselineWithRetry` cho test (không phải API runtime) |

## 3. Hành vi được khóa

- ACK hợp lệ → tiếp tục; thiếu ACK nhưng `/stop` xác nhận worker chạy → **adopt**, không bấm lại.
- Thiếu ACK + `/stop` xác nhận rảnh → `START_ACK_TIMEOUT`; `/stop` lỗi E006 → `START_ACK_UNVERIFIED`.
- `unknown` luôn chặn lần chạy sau (`WORKER_ACTIVE`); restart có bằng chứng → adopt, không có → block + `unknown`.
- ICON chỉ monitor task MUA đúng grade/quantity; baseline `/stop` retry 3 lần rồi bỏ cuộc, reload tối đa 1 lần.
- `purchaseTimeoutSeconds = 0` + soft watchdog trả quyền nhanh, không treo vòng chờ.

## 4. Bằng chứng

- `node --test lib/buy-worker-lifecycle.integration.test.js` → **13/13 pass** (~1.8s).
- `npm test` → **319/319 pass**, 0 fail, 0 cancelled.
- `npm run scan:secrets` + `npm run scan:history` → pass.
- `cortex_detect_changes` (repo `f04-agent`): risk **medium** — `waitForStartAcknowledgement` (2 file, 1 flow), đã có test hồi quy trực tiếp.

## 5. Quality Gate — A (95/100)

| Tiêu chí | Điểm |
|---|---|
| Test & bằng chứng | 25/25 (13 integration test phủ boundary/failure/recovery + full suite xanh) |
| Phạm vi & regression | 18/20 (2 thay đổi runtime additive đã giải thích) |
| Bảo mật & an toàn dữ liệu | 20/20 (giữ fail-closed, không đụng config/giá) |
| Tài liệu & vận hành | 12/15 (task/review/QA/completed; không cần đổi runbook) |
| Rollback | 10/10 (xóa file mới + revert 2 thay đổi nhỏ) |
| Kiểm soát blast radius | 10/10 (detect_changes + test cho flow bị ảnh hưởng) |

## 6. Rollback

Xóa `lib/__fixtures__/`, `lib/buy-worker-lifecycle.integration.test.js`; revert 2 thay đổi nhỏ trong `features/buy/cycle.js` và `features/icon-buy/runner.js`. Không migration, không ảnh hưởng runtime.

## 7. Follow-up

1. Tái dùng fixture cho integration test icon-buy/upgrade (đặc biệt iframe mini-app).
2. Kiểm thử thật định kỳ trước khi chạy tiền thật vì mock có thể lệch DOM Telegram.
