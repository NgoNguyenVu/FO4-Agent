# TASK-052 — Integration test hành vi cho nhánh thiếu (Company Cycle scan v5)

## Thông tin

- **Priority:** P1
- **Risk:** Low (chỉ thêm test; Cortex: 0 symbol thay đổi)
- **Effort:** M
- **Dependency:** TASK-045 (mock Playwright/Telegram), TASK-047/050 (worker state/lock)
- **Status:** **DONE** — Cycle v5 (2026-11-15), branch `ai/auto-cycle-v5`; Reviewer APPROVED + QA PASS; Gate **A (94/100)**. Xem [completed/TASK-052-scan-integration-tests.md](../completed/TASK-052-scan-integration-tests.md).
- **Owner đề xuất:** QA / Reliability
- **Nguồn:** Company Cycle scan v5 qua Cortex (`cortex_code_search`, slug `f04-agent`)

## 1. Kết quả scan

Truy vấn scan v5 tập trung vào nhánh lỗi/terminal chưa có test hành vi. Các vùng thiếu test:

| Vùng | Nhánh | Quyết định |
|---|---|---|
| `features/buy/cycle.js` → `waitForCycleCompletion` | completed / purchase-stopped / system-error / worker-token-stop / stop-requested / E006 ignorable / timeout | **Bổ sung test** |
| `features/interactive-prompt.js` | `promptWakeable`, `wakePendingPrompt`, cờ login/recovery | **Bổ sung test** |
| `lib/chat-runtime.js` → `verifyTailOrphan` | đưa chat về đuôi + fail-open | **Bổ sung test** |
| `features/upgrade/runner.js` → `checkInventoryIcons` retry | cần mở mini-app/frame thật | Follow-up (mock hiện chưa phủ frame) |
| `features/controller.js` → `INVENTORY_READ_UNCONFIRMED` | phụ thuộc `checkInventoryIcons` | Follow-up cùng mục trên |
| `features/icon-buy/order.js` | đã có integration test TASK-045 (`waitForPurchaseResults`, soft watchdog) | Không lặp lại |

## 2. Thay đổi

| File | Nội dung |
|---|---|
| `features/buy/cycle.integration.test.js` **(mới)** | 7 test chạy `waitForCycleCompletion` thật với mock page + mock Telegram + chat tracker thật |
| `features/interactive-prompt.test.js` **(mới)** | 6 test cho prompt wakeable/wake/no-op/reject và cờ chờ |
| `lib/chat-runtime.test.js` **(mới)** | 3 test cho `verifyTailOrphan`: đọc lại đuôi, fail-open khi bấm End lỗi, fail-open khi đọc body lỗi |

### 2.1. Vì sao dùng mock harness TASK-045

- Không cần Telegram/Playwright thật trong CI.
- Test đi qua đúng `chatTextReaders`/`waitForChatChange`/parser bot thật, không mock parser.
- `waitForCycleCompletion` được kiểm tra ở hợp đồng trả về (`status`, `playersBought`, `reason`) thay vì assert source code.

## 3. Vì sao an toàn

- Chỉ thêm file test; không sửa production code.
- Không thay đổi `config.json`, không đổi luồng chạy.
- Test dùng thư mục/đối tượng in-memory, không ghi state thật.

## 4. Test plan

| # | Case | Kỳ vọng |
|---|---|---|
| 1 | Completion mới sau activity | `completed`, `playersBought = 5` |
| 2 | `Đã dừng treo auto mua...` | `purchase-stopped` |
| 3 | E006 mới | `system-error` |
| 4 | Worker token stop | `system-error`, `reason = worker-token-stop` |
| 5 | `/stopagent` trong lúc chờ | `stop-requested` |
| 6 | E006 + completion, `isIgnorableSystemError` | `completed`, giữ baseline system errors |
| 7 | Quá `maxCycleWaitMinutes` | Ném lỗi `Quá thời gian chờ` |
| 8 | Prompt trả lời có khoảng trắng | Trim đúng |
| 9 | `wakePendingPrompt` | Resolve `""`, không lỗi khi không có prompt |
| 10 | `rl.question` ném lỗi | Promise reject |
| 11 | Cờ login/recovery | `isWaitingForPrompt()` đúng |
| 12 | `verifyTailOrphan` | Bấm `End`, publish text mới, version tăng |
| 13 | `verifyTailOrphan` lỗi | Giữ snapshot cũ (fail-open) |

## 5. Rollback

Xóa 3 file test mới. Không ảnh hưởng production.

## 6. Follow-up

1. Bổ sung mock frame/mini-app để test `checkInventoryIcons` retry và `INVENTORY_READ_UNCONFIRMED`.
2. Cân nhắc integration test agent-level cho `waitForCycleCompletion` với chat bị trim (orphan).

## 7. Definition of Done

- Reviewer APPROVED + QA PASS.
- `npm test` 100%, `scan:secrets` + `scan:history` pass.
- `cortex_detect_changes` ghi nhận risk **low** (chỉ thêm file test).
