# TASK-048 — `worker:resolve --dry-run` + lỗi một phần — COMPLETED 2026-11-14

- **Priority:** P2 — Reliability / Operations
- **Branch:** `ai/auto-cycle-v4`
- **Trạng thái:** **DONE** — Reviewer APPROVED, QA PASS, Quality Gate **A (97/100)**
- **Task gốc:** [TASK-048](TASK-048-resolve-dry-run.md) · Follow-up của [TASK-044](TASK-044-resolve-worker-cli.md)
- **Review:** [TASK-048-review-2026-11-14.md](../reviews/TASK-048-review-2026-11-14.md)
- **QA:** [TASK-048-qa-2026-11-14.md](../reviews/TASK-048-qa-2026-11-14.md)

## 1. Vấn đề

- Không có cách xem trước `--resolve-all` sẽ đụng worker nào.
- `--resolve-all` dừng ở lỗi đầu tiên, bỏ dở các worker còn lại.
- Khi lỗi giữa vòng, block `process` trong `workers.json` bị ghi pid của CLI và không được khôi phục.

## 2. Thay đổi

| File | Nội dung |
|---|---|
| `scripts/resolve-worker.js` | `--dry-run`; `resolveWorkers()` xử lý từng worker độc lập; `restoreProcessBlock()` luôn chạy sau khi ghi; JSON có `failed`/`wouldResolve`; exit 1 khi lỗi một phần |
| `scripts/resolve-worker.test.js` | +6 test (dry-run resolve/resolve-all/refuse/JSON, partial failure, restore process block) |
| `README.md` | Ghi `--dry-run` + hành vi lỗi một phần |

### Hành vi

- `--dry-run`: không ghi state; in `Sẽ resolve ...`; worker sai state → exit 1.
- `--resolve-all`: lỗi một worker không chặn worker khác; summary `Đã resolve X/Y`; exit 1 nếu có lỗi.
- Block `process` cũ luôn được khôi phục (hoặc xóa nếu trước đó không có).

## 3. Bằng chứng

- `node --test scripts/resolve-worker.test.js` → **20/20 pass**.
- `npm test` → **337/337 pass**, 0 fail.
- `npm run scan:secrets` + `scan:history` → pass.
- `cortex_detect_changes`: risk **medium** — 4 symbol, 3 flow, chỉ CLI.

## 4. Quality Gate — A (97/100)

| Tiêu chí | Điểm |
|---|---|
| Test & bằng chứng | 25/25 (6 test mới, gồm unit partial failure + full suite) |
| Phạm vi & regression | 20/20 (chỉ CLI, không đụng runtime) |
| Bảo mật & an toàn dữ liệu | 20/20 (dry-run không ghi; process block luôn đúng) |
| Tài liệu & vận hành | 14/15 (README + usage + exit code) |
| Rollback | 10/10 (revert 2 file + README) |
| Kiểm soát blast radius | 8/10 (detect_changes medium, test CLI đầy đủ) |

## 5. Rollback

Revert `scripts/resolve-worker.js`, `scripts/resolve-worker.test.js`, mục README. Không migration, không ảnh hưởng runtime.

## 6. Follow-up

1. `--quarantine` dọn state hỏng có kiểm soát (liên quan TASK-047).
2. Audit log ai resolve/lúc nào (vẫn là follow-up từ TASK-044).
