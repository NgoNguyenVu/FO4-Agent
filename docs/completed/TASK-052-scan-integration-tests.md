# TASK-052 — Integration test hành vi cho nhánh thiếu — COMPLETED 2026-11-15

- **Priority:** P1 — QA / Reliability
- **Branch:** `ai/auto-cycle-v5`
- **Trạng thái:** **DONE** — Reviewer APPROVED, QA PASS, Quality Gate **A (94/100)**
- **Task gốc:** [TASK-052](../tasks/TASK-052-scan-integration-tests.md)
- **Review:** [TASK-052-review-2026-11-15.md](../reviews/TASK-052-review-2026-11-15.md)
- **QA:** [TASK-052-qa-2026-11-15.md](../reviews/TASK-052-qa-2026-11-15.md)

## 1. Nguồn

Company Cycle scan v5 qua Cortex (`cortex_code_search`, slug `f04-agent`) tìm các nhánh lỗi/terminal chưa có test hành vi.

## 2. Thay đổi

| File | Nội dung |
|---|---|
| `features/buy/cycle.integration.test.js` **(mới)** | 7 test `waitForCycleCompletion`: completed, purchase-stopped, E006, worker-token-stop, stop-requested, E006 ignorable, timeout |
| `features/interactive-prompt.test.js` **(mới)** | 6 test prompt wakeable/trim/wake/no-op/reject/flags |
| `lib/chat-runtime.test.js` **(mới)** | 3 test `verifyTailOrphan`: đọc lại đuôi, fail-open keyboard, fail-open body |

### Phạm vi

- Dùng mock Playwright/Telegram + chat tracker thật từ TASK-045; không mock parser.
- Chỉ thêm test, không sửa production code.

## 3. Bằng chứng

- `node --test` 3 file mới → **16/16 pass**.
- `npm test` → **374/374 pass**, 0 fail.
- `npm run scan:secrets` + `scan:history` → pass.
- `cortex_detect_changes`: risk **low** — chỉ thêm file test, 0 symbol thay đổi.

## 4. Quality Gate — A (94/100)

| Tiêu chí | Điểm |
|---|---|
| Test & bằng chứng | 25/25 (16 test mới, chạy hàm thật) |
| Phạm vi & regression | 19/20 (test-only, không đổi runtime) |
| Bảo mật & an toàn dữ liệu | 20/20 (không ghi state thật) |
| Tài liệu & vận hành | 15/15 (task doc ghi rõ vùng phủ + follow-up) |
| Rollback | 10/10 (xóa 3 file test) |
| Kiểm soát blast radius | 5/10 (detect_changes low; còn `checkInventoryIcons` chưa phủ) |

## 5. Rollback

Xóa 3 file test mới. Không ảnh hưởng production.

## 6. Follow-up

1. Mock frame/mini-app để phủ `checkInventoryIcons` retry + `INVENTORY_READ_UNCONFIRMED`.
2. Orphan completion với chat bị trim ở mức agent-level.
