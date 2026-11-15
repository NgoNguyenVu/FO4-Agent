# TASK-050 — Fail-closed khi `agent.lock` hỏng — COMPLETED 2026-11-15

- **Priority:** P1 — Reliability / Data Integrity
- **Branch:** `ai/auto-cycle-v5`
- **Trạng thái:** **DONE** — Reviewer APPROVED, QA PASS, Quality Gate **A (93/100)**
- **Task gốc:** [TASK-050](../tasks/TASK-050-agent-lock-corruption.md)
- **Review:** [TASK-050-review-2026-11-15.md](../reviews/TASK-050-review-2026-11-15.md)
- **QA:** [TASK-050-qa-2026-11-15.md](../reviews/TASK-050-qa-2026-11-15.md)

## 1. Vấn đề

`agent.lock` đi qua `readJson()` dùng chung với `workers.json`; lock rỗng/JSON hỏng trả `null` nên `acquireProcessLock()` coi như "chưa có lock" và ghi đè — fail-open, hai instance có thể cùng chạy. `heartbeat`/`release` cũng có thể phá lock hỏng; CLI `worker:resolve` coi lock hỏng là "agent không chạy".

## 2. Thay đổi

| File | Nội dung |
|---|---|
| `lib/worker-registry.js` | `readLockFile()` fail-closed; `isLockRecord()`; quarantine `agent.lock.corrupt-<ISO>`; `AGENT_LOCK_CORRUPT`; heartbeat/release không ghi đè; `isProcessLockHeld` fail-closed |
| `scripts/resolve-worker.js` | `agentIsRunning()` coi lock rỗng/hỏng/sai shape là đang chạy |
| `lib/worker-lock-corruption.test.js` **(mới)** | 9 test phủ ENOENT, rỗng, JSON hỏng, 8 shape sai, heartbeat/release, quarantine, hồi quy, CLI |
| `README.md` | Runbook "Process lock hong (`AGENT_LOCK_CORRUPT`)" |

### Hành vi

- Thiếu lock = chưa có instance (hợp lệ).
- Lock rỗng / JSON hỏng / shape sai = `AGENT_LOCK_CORRUPT`; agent không khởi động.
- Heartbeat/release trả `false`, không ghi/xóa file; `lockHeld = true`.
- Bản sao `.corrupt-*` tạo một lần/instance; file gốc giữ nguyên.

## 3. Bằng chứng

- `node --test lib/worker-lock-corruption.test.js` → **9/9 pass**.
- `npm test` → **374/374 pass**, 0 fail.
- `npm run scan:secrets` + `scan:history` → pass.
- `cortex_detect_changes`: risk **high** — 9 symbol, 7 flow; có test hồi quy trực tiếp.

## 4. Quality Gate — A (93/100)

| Tiêu chí | Điểm |
|---|---|
| Test & bằng chứng | 25/25 (9 test chuyên biệt + full suite) |
| Phạm vi & regression | 18/20 (đổi lock path, không đổi schema/state machine) |
| Bảo mật & an toàn dữ liệu | 20/20 (fail-closed, không ghi đè lock hỏng) |
| Tài liệu & vận hành | 15/15 (README runbook + lỗi có mã/đường dẫn) |
| Rollback | 10/10 (revert 2 file + xóa test) |
| Kiểm soát blast radius | 5/10 (detect_changes high; chưa có integration multi-process với lock hỏng) |

## 5. Rollback

Revert `lib/worker-registry.js`, `scripts/resolve-worker.js`, xóa test mới và mục README. Không migration.

## 6. Follow-up

1. `worker:resolve --quarantine` dọn lock/state hỏng có kiểm soát (TASK-048-F1).
2. Integration multi-process với lock hỏng.
