# TASK-047 — Fail-closed khi `workers.json` hỏng — COMPLETED 2026-11-14

- **Priority:** P0 — Data Integrity / Reliability
- **Branch:** `ai/auto-cycle-v4`
- **Trạng thái:** **DONE** — Reviewer APPROVED, QA PASS, Quality Gate **A (95/100)**
- **Task gốc:** [TASK-047](TASK-047-corrupt-worker-state.md)
- **Review:** [TASK-047-review-2026-11-14.md](../reviews/TASK-047-review-2026-11-14.md)
- **QA:** [TASK-047-qa-2026-11-14.md](../reviews/TASK-047-qa-2026-11-14.md)

## 1. Vấn đề

`readJson()` trả `null` cho JSON hỏng, `loadState()` biến thành `emptyState()`. Registry hỏng bị coi là **rỗng**, khiến `reconcile()` trả `clear` và `beginStart()` mở khóa mua mới dù worker cũ có thể vẫn chạy — fail-open, nguy cơ mua chồng/double-spend. State đúng JSON nhưng sai cấu trúc cũng bị âm thầm coi là rỗng.

## 2. Thay đổi

| File | Nội dung |
|---|---|
| `lib/worker-registry.js` | `loadState()` fail-closed; quarantine `.corrupt-<ISO>`; ném `WORKER_STATE_CORRUPT`; validate `workers[]` |
| `lib/worker-session.js` | `reconcileOnStartup` → `block/registry-corrupt`; `tryBegin` → `null` + reason |
| `lib/worker-state-corruption.test.js` **(mới)** | 6 test phủ ENOENT, JSON hỏng, shape sai, quarantine, hồi quy |
| `README.md` | Runbook "Worker state hong" |

### Hành vi

- Thiếu file = registry rỗng (hợp lệ).
- File rỗng / JSON hỏng / shape sai = `WORKER_STATE_CORRUPT`, agent chặn worker mới.
- Bản sao `.corrupt-*` được tạo một lần/instance; file gốc giữ nguyên để điều tra.

## 3. Bằng chứng

- `node --test lib/worker-state-corruption.test.js` → **6/6 pass**.
- `npm test` → **331/331 pass**, 0 fail.
- `npm run scan:secrets` + `scan:history` → pass.
- `cortex_detect_changes`: risk **high** — 6 symbol, 13 flow; có test hồi quy trực tiếp.

## 4. Quality Gate — A (95/100)

| Tiêu chí | Điểm |
|---|---|
| Test & bằng chứng | 25/25 (6 test chuyên biệt + full suite) |
| Phạm vi & regression | 18/20 (đổi registry, không đổi schema/state machine) |
| Bảo mật & an toàn dữ liệu | 20/20 (fail-closed, không ghi đè state hỏng) |
| Tài liệu & vận hành | 14/15 (README runbook + lỗi có mã/đường dẫn) |
| Rollback | 10/10 (revert 2 file + xóa test) |
| Kiểm soát blast radius | 8/10 (detect_changes high, test trực tiếp, chưa có integration agent-level) |

## 5. Rollback

Revert `lib/worker-registry.js`, `lib/worker-session.js`, xóa test mới và mục README. Không migration; state cũ đọc lại bình thường.

## 6. Follow-up

1. Fail-closed cho `agent.lock` hỏng (hiện vẫn coi như không có lock).
2. CLI dọn/quarantine state hỏng có kiểm soát (`worker:resolve --quarantine`).
3. Cân nhắc integration test agent-level cho startup với state hỏng.
