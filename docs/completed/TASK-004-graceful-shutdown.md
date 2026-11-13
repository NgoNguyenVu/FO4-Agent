# TASK-004 — Graceful shutdown (Stage A) — COMPLETED 2026-11-13

- **Priority:** P0 — Reliability
- **Branch:** `ai/auto-cycle-v1` (không đụng `main`)
- **Trạng thái:** **DONE (Stage A)** — Reviewer APPROVED, QA PASS, Quality Gate **B (83/100)**
- **Task gốc:** [docs/tasks/TASK-004-graceful-shutdown.md](../tasks/TASK-004-graceful-shutdown.md)
- **Review:** [TASK-004-review-2026-11-13.md](../reviews/TASK-004-review-2026-11-13.md)
- **QA:** [TASK-004-qa-2026-11-13.md](../reviews/TASK-004-qa-2026-11-13.md)

## 1. Vấn đề

Agent không bắt `SIGINT`/`SIGTERM`; Ctrl+C hoặc crash để lại Chromium và worker (buy/upgrade/ICON) treo. Không có heartbeat để biết process còn sống.

## 2. Thay đổi

| File | Nội dung |
|---|---|
| `lib/lifecycle.js` **(mới)** | State machine `idle→running→stopping→stopped`; `register({ onShutdown })`; `shutdown()` idempotent, chạy handler ngược thứ tự, timeout 20s/handler + timeout tổng; `installSignalHandlers()` cho SIGINT/SIGTERM/SIGBREAK + `uncaughtException`/`unhandledRejection`; Ctrl+C lần hai exit ngay; heartbeat JSON atomic (`tmp` + rename) mỗi 30s; `requestExit()` đảm bảo exit một lần |
| `lib/lifecycle.test.js` **(mới)** | 8 test: idempotency, thứ tự ngược, handler throw/treo, heartbeat, unregister, mã exit, signal lần 2, uncaughtException |
| `agent.js` | Khởi tạo lifecycle + heartbeat (`<dataDir>/state/heartbeat.json`), cài signal handler; không restart khi đang shutdown |
| `features/controller.js` | Đăng ký cleanup: dừng ICON monitor, gửi `/stopauto`/`/stopnc` khi `agentActive`, đóng mini-app, đóng context, đóng readline; kiểm tra `isStopping()` đầu vòng lặp; cập nhật heartbeat `{mode, agentActive}` |

## 3. Bằng chứng

- `npm test` → **244/244 pass** (baseline 236 + 8 test mới), 0 fail.
- `node --check` cho 3 file runtime → pass.
- `cortex_detect_changes` (repo `f04-agent`): risk **high**, 4 file, 6 symbol, 11 flow bị ảnh hưởng; tất cả thay đổi là additive, không đổi quyết định mua/nâng.

## 4. Quality Gate — B (83/100)

| Tiêu chí | Điểm |
|---|---|
| Test & bằng chứng | 20/25 (thiếu integration signal thật) |
| Phạm vi & regression | 18/20 |
| Bảo mật & an toàn dữ liệu | 18/20 |
| Tài liệu & vận hành | 12/15 |
| Rollback | 9/10 |
| Kiểm soát blast radius | 6/10 |

## 5. Rollback

Revert 4 file của task (xem commit bên dưới). Không có migration/state cần xử lý; heartbeat nằm ngoài repo nên không ảnh hưởng git.

## 6. Follow-up (Stage B / backlog)

1. Integration smoke: spawn process, gửi SIGINT/SIGTERM, kiểm tra exit code 130/143 và browser đã đóng.
2. Ownership registry để chỉ dừng worker do agent sở hữu (TASK-005 Stage B).
3. Runbook vận hành Ctrl+C/exit code/heartbeat trong README.

## 7. Commit

`COMMIT_AUTHORIZED` (Standard Task, không high-risk gate) — commit riêng trên `ai/auto-cycle-v1`: **`1205124`** — `feat(reliability): add lifecycle and graceful shutdown (TASK-004)` (9 file, +689/−2).
