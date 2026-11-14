# TASK-043 — Integration test process lock (2 process thật)

## Thông tin

- **Priority:** P1
- **Risk:** Low
- **Effort:** S
- **Dependency:** TASK-005 Stage A (`7fee795`)
- **Status:** **DONE** — Cycle v3 (2026-11-14), branch `ai/auto-cycle-v3`; Reviewer APPROVED + QA PASS; Gate A (94/100). Xem [completed/TASK-043-process-lock-integration.md](../completed/TASK-043-process-lock-integration.md).
- **Owner đề xuất:** Platform / Reliability
- **Nguồn:** Follow-up TASK-005 (backlog §TASK-043)

## 1. Mục tiêu

Stage A chỉ test process lock trong **một** process (unit). Cần bằng chứng process-level rằng:

1. Hai process thật không thể cùng giữ lock — process thứ hai nhận `AGENT_LOCKED`.
2. Lock stale (pid chết + lease hết) được tiếp quản.
3. Lock còn tươi của process sống **không** bị tiếp quản.
4. Heartbeat thực sự gia hạn lease; release mở đường cho process kế tiếp.

## 2. Phạm vi

| File | Thay đổi |
|---|---|
| `lib/__fixtures__/lock-child.js` **(mới)** | Process con giữ lock qua IPC (`heartbeat`/`release`/`exit`) |
| `lib/worker-registry.integration.test.js` **(mới)** | 4 integration test spawn process thật |

Không thay đổi runtime.

## 3. Test plan

| # | Case | Kỳ vọng |
|---|---|---|
| 1 | Hai process đua lock | đúng một `acquired`, process kia `AGENT_LOCKED` |
| 2 | Lock stale (pid 0, lease quá khứ) | process mới tiếp quản |
| 3 | Lock tươi của pid sống | process mới bị chặn |
| 4 | Heartbeat + release | lease tăng; sau release process kế tiếp vào được |

## 4. Rollback

Xóa 2 file test/fixture; không ảnh hưởng runtime.
