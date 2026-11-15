# TASK-050 — Fail-closed khi `agent.lock` hỏng (Reliability)

## Thông tin

- **Priority:** P1
- **Risk:** High (process lock là cổng chống chạy hai instance — blast radius theo Cortex: 9 symbol, 7 flow)
- **Effort:** M
- **Dependency:** TASK-047 (fail-closed `workers.json`)
- **Status:** **DONE** — Cycle v5 (2026-11-15), branch `ai/auto-cycle-v5`; Reviewer APPROVED + QA PASS; Gate **A (93/100)**. Xem [completed/TASK-050-agent-lock-corruption.md](../completed/TASK-050-agent-lock-corruption.md).
- **Owner đề xuất:** Reliability / Data Integrity
- **Nguồn:** Follow-up TASK-047 §6.1 — `agent.lock` hỏng vẫn bị coi là "không có lock" (fail-open)

## 1. Vấn đề

`lib/worker-registry.js` dùng chung `readJson()` cho cả `workers.json` và `agent.lock`. TASK-047 đã làm `loadState()` fail-closed nhưng lock vẫn đi qua `readJson()`:

- Lock rỗng / JSON hỏng → `readJson()` trả `null`.
- `acquireProcessLock()` coi `null` là "chưa có lock" và **ghi đè**.
- Hai instance có thể cùng chạy → mua trùng, double-spend.
- `heartbeat`/`release` cũng có thể ghi đè hoặc xóa lock hỏng, mất bằng chứng điều tra.
- `scripts/resolve-worker.js` `agentIsRunning()` trả `false` cho lock hỏng → CLI cho phép sửa state trong khi agent khác có thể vẫn đang mua.

## 2. Thay đổi

| File | Nội dung |
|---|---|
| `lib/worker-registry.js` | Thêm `readLockFile()` fail-closed; `isLockRecord()`; quarantine `agent.lock.corrupt-<ISO>`; ném `AGENT_LOCK_CORRUPT`; heartbeat/release không ghi đè; `isProcessLockHeld()` coi lock hỏng là đang giữ |
| `scripts/resolve-worker.js` | `agentIsRunning()` đọc lock trực tiếp; lock rỗng/hỏng/sai shape → `true` (chặn resolve) |
| `lib/worker-lock-corruption.test.js` **(mới)** | 9 test: ENOENT, rỗng, JSON hỏng, 8 shape sai, heartbeat/release, isProcessLockHeld, quarantine một lần, hồi quy, CLI fail-closed |
| `README.md` | Runbook "Process lock hong (`AGENT_LOCK_CORRUPT`)" |

### 2.1. Hành vi mới

- Lock **thiếu** (ENOENT) = chưa có instance nào giữ lock (hợp lệ).
- Lock **rỗng / JSON hỏng / sai cấu trúc** = `AGENT_LOCK_CORRUPT`.
  - `acquireProcessLock()` ném lỗi → agent không khởi động.
  - `heartbeatProcessLock()` / `releaseProcessLock()` trả `false`, **không** ghi/xóa file.
  - `isProcessLockHeld()` trả `true` → `getSnapshot().process.lockHeld = true`.
  - Bản sao `agent.lock.corrupt-<ISO>` tạo một lần/instance; file gốc giữ nguyên.
- Lock hợp lệ vẫn hoạt động y như cũ (lease, stale takeover, token mismatch).

### 2.2. Cấu trúc lock hợp lệ

`isLockRecord()` yêu cầu object không phải mảng, `token` chuỗi không rỗng, `pid` số nguyên, `leaseUntil` hữu hạn. Các trường khác (`version`, `startedAt`, `heartbeatAt`) vẫn được giữ khi ghi.

## 3. Vì sao an toàn

- Không đổi schema lock/state, không đổi state machine worker, không đổi luật conflict.
- Lock hợp lệ đi qua đúng logic cũ; chỉ nhánh "hỏng" đổi từ fail-open sang fail-closed.
- `AGENT_LOCK_CORRUPT` là lỗi khởi động rõ ràng, có `lockPath` + `quarantinePath` để vận hành xử lý.
- CLI `worker:resolve` thà chặn còn hơn sửa state khi chưa chắc agent đã dừng.

## 4. Test plan

| # | Case | Kỳ vọng |
|---|---|---|
| 1 | Không có lock | `acquireProcessLock()` thành công |
| 2 | Lock rỗng | `AGENT_LOCK_CORRUPT`, có `.corrupt-*`, file gốc giữ nguyên |
| 3 | JSON hỏng | `AGENT_LOCK_CORRUPT`, không ghi đè |
| 4 | `null` / `[]` / chuỗi / `{}` / thiếu `token` / `pid` sai / thiếu `leaseUntil` | Đều `AGENT_LOCK_CORRUPT` |
| 5 | Heartbeat/release trên lock hỏng | Trả `false`, file không đổi |
| 6 | `isProcessLockHeld` trên lock hỏng | `true` (fail-closed) |
| 7 | Đọc lỗi nhiều lần | Chỉ 1 bản quarantine/instance |
| 8 | Lock hợp lệ | Acquire/heartbeat/release vẫn đúng |
| 9 | `agentIsRunning` với lock rỗng/hỏng | `true`; ENOENT `false`; stale hợp lệ `false` |

## 5. Rollback

Revert `lib/worker-registry.js`, `scripts/resolve-worker.js`, xóa `lib/worker-lock-corruption.test.js` và mục README. Không migration; lock cũ đọc lại bình thường.

## 6. Definition of Done

- Reviewer APPROVED + QA PASS.
- `npm test` 100%, `scan:secrets` + `scan:history` pass.
- `cortex_detect_changes` ghi nhận risk **high** (9 symbol, 7 flow) và có test hồi quy trực tiếp.
