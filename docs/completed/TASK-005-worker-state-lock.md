# TASK-005 — Worker state machine, lock và lease (Stage A) — COMPLETED 2026-11-13

- **Priority:** P0 — Concurrency / Data integrity
- **Branch:** `ai/auto-cycle-v1` (không đụng `main`)
- **Trạng thái:** **DONE (Stage A)** — Reviewer APPROVED, QA PASS, Quality Gate **B (84/100)**
- **Task gốc:** [docs/tasks/TASK-005-worker-state-lock.md](../tasks/TASK-005-worker-state-lock.md)
- **Review:** [TASK-005-review-2026-11-13.md](../reviews/TASK-005-review-2026-11-13.md)
- **QA:** [TASK-005-qa-2026-11-13.md](../reviews/TASK-005-qa-2026-11-13.md)

## 1. Vấn đề

Hai instance agent (hoặc restart giữa chu kỳ) có thể cùng thao tác một account vì không có process lock và không có state worker bền vững. Hậu quả trực tiếp: double-start worker → mua trùng, tiêu BP ngoài kiểm soát.

## 2. Thay đổi

| File | Nội dung |
|---|---|
| `lib/worker-registry.js` **(mới)** | `acquireProcessLock()` độc quyền bằng file + `token`; stale takeover khi lease hết hạn hoặc pid chết; `heartbeatProcessLock()` gia hạn lease; `releaseProcessLock()` chỉ xóa lock của mình. Worker state machine `starting→running→stopping→stopped` + `unknown`; `beginStart/markRunning/beginStop/markStopped/markUnknown`; `reconcile()` (unknown → block, running+evidence → adopt, running−evidence → unknown+block, evidence without registry → block); `getSnapshot()` |
| `lib/worker-registry.test.js` **(mới)** | 10 test: độc quyền lock, stale/dead-pid takeover, heartbeat, token mismatch, state machine, transition sai, chặn worker active, reconcile matrix |
| `features/config.js` | Block `worker` (`leaseSeconds: 60`, `heartbeatSeconds: 20`) + `validateWorkerConfig()` (heartbeat < lease) |
| `agent.js` | Acquire process lock trước khi chạy; heartbeat lock mỗi 20s (`unref`); đăng ký release lock trong lifecycle shutdown; instance thứ hai log lỗi và exit code 1 |

## 3. Bằng chứng

- `npm test` → **254/254 pass** (244 + 10 test mới), 0 fail.
- `validateConfig()` pass với config hiện tại.
- `cortex_detect_changes` (repo `f04-agent`): risk **medium**, 4 file, 3 flow qua `validateConfig`; không đổi logic mua/nâng.

## 4. Quality Gate — B (84/100)

| Tiêu chí | Điểm |
|---|---|
| Test & bằng chứng | 22/25 (thiếu test spawn 2 process thật) |
| Phạm vi & regression | 18/20 |
| Bảo mật & an toàn dữ liệu | 20/20 (fail-closed, token ownership) |
| Tài liệu & vận hành | 10/15 |
| Rollback | 8/10 |
| Kiểm soát blast radius | 6/10 (controller chưa dùng registry) |

## 5. Rollback

- Xóa `state/agent.lock` (ngoài repo) và revert 4 file. Không migration.
- Nếu cần tắt nhanh: dừng agent, xóa lock; registry không ảnh hưởng dữ liệu giao dịch.

## 6. Follow-up (Stage B / backlog)

1. Controller dùng `registry.reconcile()` làm source of truth thay `checkAutoBuyRunning`; `beginStart` trước khi gửi lệnh start, `markRunning` sau ACK.
2. Buy/upgrade/icon-session đăng ký worker tương ứng.
3. Test spawn 2 process thật + test race acquire/heartbeat.
4. Resolve `unknown` bằng runbook (hiện chỉ log/block).

## 7. Commit

`COMMIT_AUTHORIZED` (Standard Task) — commit riêng trên `ai/auto-cycle-v1`; hash ghi trong `docs/completed/CYCLE-2026-11-13.md`.
