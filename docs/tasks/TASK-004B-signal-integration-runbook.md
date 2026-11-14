# TASK-004B — Integration test signal thật + runbook vận hành

## Thông tin

- **Priority:** P1
- **Risk:** Medium
- **Effort:** S
- **Dependency:** TASK-004 Stage A (`3b864e7`)
- **Status:** **DONE** — Cycle v2 (2026-11-13), branch `ai/auto-cycle-v2`; Reviewer APPROVED + QA PASS; Gate A (93/100). Xem [completed/TASK-004B-signal-integration-runbook.md](../completed/TASK-004B-signal-integration-runbook.md).
- **Owner đề xuất:** Platform / Reliability
- **Task gốc:** [TASK-004](TASK-004-graceful-shutdown.md)

## 1. Mục tiêu

Bổ sung bằng chứng ở mức **process thật** cho cơ chế shutdown Stage A, và viết runbook để người vận hành biết:

- Ctrl+C / SIGTERM / SIGBREAK thoát với mã nào.
- Heartbeat và state file nằm ở đâu.
- Cách xử lý khi worker ở trạng thái `unknown`.
- Cách xử lý khi process lock còn sót.

## 2. Phạm vi

- `lib/__fixtures__/lifecycle-child.js` **(mới)**: process con dùng `lib/lifecycle.js`.
- `lib/lifecycle.integration.test.js` **(mới)**: spawn process con, gửi signal, assert exit code + cleanup + heartbeat.
- `README.md`: mục "Vận hành & shutdown".

Không thay đổi hành vi runtime.

## 3. Test plan

| # | Case | Kỳ vọng |
|---|---|---|
| 1 | SIGINT khi đang chạy | cleanup chạy, exit code **130** |
| 2 | SIGTERM khi đang chạy | cleanup chạy, exit code **143** |
| 3 | Ctrl+C lần hai khi cleanup treo | thoát ngay, code **130**, không chờ cleanup |
| 4 | Heartbeat | file JSON tồn tại, có `pid`/`lastHeartbeatAt`/`state` |
| 5 | Cleanup idempotent | `CLEANUP_OK` chỉ in một lần |

Windows không cho process khác gửi `SIGINT` thật; test dùng IPC để process con tự `process.emit(signal)` (vẫn là process thật + exit code thật). Trên POSIX test gửi signal thật bằng `child.kill(signal)`.

## 4. Rollback

Xóa 2 file test/fixture và mục README; không ảnh hưởng runtime.