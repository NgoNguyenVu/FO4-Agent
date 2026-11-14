# TASK-004B — Integration test signal process-level + runbook vận hành — COMPLETED 2026-11-13

- **Priority:** P1 — Reliability / Operations
- **Branch:** `ai/auto-cycle-v2`
- **Trạng thái:** **DONE** — Reviewer APPROVED, QA PASS, Quality Gate **A (93/100)**
- **Task gốc:** [TASK-004](TASK-004-graceful-shutdown.md) · [TASK-004B](TASK-004B-signal-integration-runbook.md)
- **Review:** [TASK-004B-review-2026-11-13.md](../reviews/TASK-004B-review-2026-11-13.md)
- **QA:** [TASK-004B-qa-2026-11-13.md](../reviews/TASK-004B-qa-2026-11-13.md)

## 1. Vấn đề

Stage A (`3b864e7`) đã có state machine shutdown + heartbeat, nhưng bằng chứng chỉ ở mức unit test với `EventEmitter` giả. Không có test nào chứng minh **process thật** thoát đúng mã khi nhận signal, và người vận hành chưa có runbook cho heartbeat/worker `unknown`/process lock.

## 2. Thay đổi

| File | Nội dung |
|---|---|
| `lib/__fixtures__/lifecycle-child.js` **(mới)** | Process con dùng `lib/lifecycle.js` thật: cài signal handler, heartbeat, cleanup handler; nhận IPC để `process.emit(signal)` hoặc emit `uncaughtException` |
| `lib/lifecycle.integration.test.js` **(mới)** | 4 integration test: SIGINT→130, SIGTERM→143, Ctrl+C lần hai thoát ngay, `uncaughtException`→1 |
| `README.md` | Mục "Vận hành & shutdown": bảng signal → exit code, vị trí state file, quy trình resolve worker `unknown`, xử lý process lock |

Không thay đổi file runtime nào → blast radius bằng 0 với giao dịch.

## 3. Bằng chứng

- `node --test lib/lifecycle.integration.test.js` → **4/4 pass** (~0.6s).
- `npm test` → **288/288 pass** (284 + 4), 0 fail, 0 cancelled.
- `cortex_detect_changes` (repo `f04-agent`): risk **low** — 3 file, 0 affected flow, chỉ README + 2 file mới.

| Case | Kỳ vọng | Thực tế |
|---|---|---|
| SIGINT | cleanup + exit **130** | pass, `CLEANUP_OK` đúng 1 lần |
| SIGTERM | cleanup + exit **143** | pass |
| Ctrl+C lần hai (cleanup treo 5s) | thoát ngay, code 130 | pass, < 4.5s |
| Heartbeat | JSON có `pid`/`state`/`lastHeartbeatAt` | pass |
| `uncaughtException` | cleanup + exit **1** | pass |

### Giới hạn đã ghi rõ

Windows không cho process khác gửi `SIGINT` thật → fixture nhận IPC rồi tự `process.emit(signal)`. Đây vẫn là process thật, signal handler thật, exit code thật, nhưng **không phải** signal mức OS. Trên POSIX test dùng `child.kill(signal)` (signal thật). Giới hạn này được nêu trong review, QA và comment đầu file test — không tuyên bố quá mức.

## 4. Quality Gate — A (93/100)

| Tiêu chí | Điểm |
|---|---|
| Test & bằng chứng | 24/25 (thiếu SIGBREAK trên CI) |
| Phạm vi & regression | 20/20 (không đổi runtime) |
| Bảo mật & an toàn dữ liệu | 19/20 |
| Tài liệu & vận hành | 15/15 (runbook đầy đủ, khớp code) |
| Rollback | 10/10 (xóa 2 file + 1 mục README) |
| Kiểm soát blast radius | 5/10 (Windows dùng IPC thay signal OS) |

## 5. Rollback

Xóa `lib/lifecycle.integration.test.js`, `lib/__fixtures__/lifecycle-child.js` và mục "Vận hành & shutdown" trong `README.md`. Không ảnh hưởng runtime, không migration.

## 6. Follow-up

1. Thêm case SIGBREAK khi có CI Windows console thật.
2. Integration test cleanup có tương tác Telegram (cần tài khoản bot).
3. CLI `scripts/resolve-worker.js` (đề xuất từ TASK-005B) để resolve `unknown` không cần sửa file tay.
