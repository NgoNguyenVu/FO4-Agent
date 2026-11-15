# TASK-047 — Fail-closed khi `workers.json` hỏng (Data Integrity)

## Thông tin

- **Priority:** P0
- **Risk:** Medium (thay đổi registry — blast radius CRITICAL theo Cortex impact)
- **Effort:** M
- **Dependency:** TASK-005B
- **Status:** **DONE** — Cycle v4 (2026-11-14/15), branch `ai/auto-cycle-v4`; Reviewer APPROVED + QA PASS; Gate **A (95/100)**. Xem [completed/TASK-047-corrupt-worker-state.md](../completed/TASK-047-corrupt-worker-state.md).
- **Owner đề xuất:** Data Integrity / Reliability
- **Nguồn:** Company Cycle scan v4 (`createWorkerRegistry` impact CRITICAL, 23 symbol)

## 1. Vấn đề

`lib/worker-registry.js` đọc `workers.json` qua `readJson()`; JSON hỏng trả `null`, `loadState()` biến thành `emptyState()`. Hệ quả **fail-open**:

- `reconcile()` trả `clear` dù worker cũ có thể vẫn đang chạy.
- `beginStart()` mở khóa mua mới → nguy cơ **mua chồng / double-spend**.
- Không có dấu vết file hỏng để điều tra.

Cùng lỗi với state đúng JSON nhưng sai cấu trúc (`workers` không phải mảng, worker thiếu `feature`/`state` lạ) — trước đây bị âm thầm coi là rỗng.

## 2. Thay đổi

| File | Nội dung |
|---|---|
| `lib/worker-registry.js` | `loadState()` đọc trực tiếp, **không** fallback rỗng khi lỗi; quarantine bản sao `.corrupt-<timestamp>`; ném `WORKER_STATE_CORRUPT`; validate cấu trúc `workers[]` |
| `lib/worker-session.js` | `reconcileOnStartup()` trả `block/registry-corrupt`; `tryBegin()` trả `null` + `blockedReason().reason = WORKER_STATE_CORRUPT` |
| `lib/worker-state-corruption.test.js` **(mới)** | 6 test: ENOENT hợp lệ, JSON hỏng, cấu trúc sai, quarantine một lần, state hợp lệ không hồi quy |
| `README.md` | Runbook "Worker state hong": xem `.corrupt-*`, xác minh `/stop`, sửa/di chuyển file |

### 2.1. Hành vi mới

- File **thiếu** (ENOENT) = registry rỗng hợp lệ (khởi đầu bình thường).
- File **rỗng, JSON hỏng, hoặc cấu trúc sai** = `WORKER_STATE_CORRUPT`.
- Lần đọc lỗi đầu tiên của mỗi instance copy file sang `workers.json.corrupt-<ISO>`; file gốc **giữ nguyên** nên các lần khởi động sau vẫn fail-closed cho tới khi con người xử lý.
- `workers[]` phải là mảng các object có `workerId`, `feature` không rỗng và `state` thuộc `WORKER_STATES`.

## 3. Vì sao an toàn

- Không đổi schema, không đổi state machine, không đổi luật conflict.
- State hợp lệ đọc/ghi y như cũ (test hồi quy + 331 test toàn suite).
- Fail-closed ở đúng chỗ: agent vẫn chạy, vẫn nhận `/stopagent`, nhưng không bấm mua/nâng khi registry không đáng tin.
- `scripts/resolve-worker.js` vốn đã từ chối state hỏng (exit 1), không bị ảnh hưởng.

## 4. Test plan

| # | Case | Kỳ vọng |
|---|---|---|
| 1 | Không có file state | Registry rỗng, `beginStart` được |
| 2 | JSON hỏng | `getSnapshot()` ném `WORKER_STATE_CORRUPT`; có 1 file `.corrupt-*`; file gốc giữ nguyên |
| 3 | JSON hỏng + startup | `reconcileOnStartup` → `block/registry-corrupt`; `tryBegin` → `null` |
| 4 | File rỗng / `null` / `[]` / `workers` không phải mảng / worker state lạ / thiếu field | Đều `WORKER_STATE_CORRUPT` |
| 5 | Đọc lỗi nhiều lần | Chỉ tạo 1 bản quarantine mỗi instance |
| 6 | State hợp lệ sau restart | Đọc đúng worker `running`, không quarantine |

## 5. Rollback

Revert `lib/worker-registry.js`, `lib/worker-session.js`, xóa test mới và mục README. Không migration; state cũ đọc lại bình thường.

## 6. Definition of Done

- Reviewer APPROVED + QA PASS.
- `npm test` 100%, `scan:secrets` + `scan:history` pass.
- `cortex_detect_changes` ghi nhận risk **high** (6 symbol, 13 flow) và có test hồi quy trực tiếp.
