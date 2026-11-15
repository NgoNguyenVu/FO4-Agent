# TASK-048 — `worker:resolve --dry-run` + xử lý lỗi một phần (Reliability)

## Thông tin

- **Priority:** P2
- **Risk:** Low (CLI vận hành, không nằm trên đường chạy runtime)
- **Effort:** S
- **Dependency:** TASK-044 (CLI resolve worker)
- **Status:** **DONE** — Cycle v4 (2026-11-14), branch `ai/auto-cycle-v4`; Reviewer APPROVED + QA PASS; Gate **A (97/100)**. Xem [completed/TASK-048-resolve-dry-run.md](../completed/TASK-048-resolve-dry-run.md).
- **Owner đề xuất:** Reliability / Operations
- **Nguồn:** Company Cycle scan v4 (follow-up TASK-044 §7.1) + rà soát `--resolve-all`

## 1. Vấn đề

1. **Không xem trước được:** muốn biết `--resolve-all` sẽ đụng worker nào phải chạy thật rồi kiểm tra state.
2. **Lỗi một phần không được xử lý:** vòng `--resolve-all` dừng ngay ở worker lỗi đầu tiên; các worker còn lại bị bỏ dở.
3. **Rò rỉ process block:** khi lỗi giữa vòng, `registry.saveState` đã ghi pid của CLI vào `workers.json` nhưng bước khôi phục block `process` cũ bị bỏ qua → state ghi sai chủ sở hữu.

## 2. Thay đổi

| File | Nội dung |
|---|---|
| `scripts/resolve-worker.js` | Thêm `--dry-run`; tách `resolveWorkers()` xử lý từng worker độc lập; luôn khôi phục block `process` cũ sau khi ghi; JSON có `failed`/`wouldResolve`; exit 1 khi lỗi một phần |
| `scripts/resolve-worker.test.js` | +6 test: dry-run resolve/resolve-all/refuse/JSON, partial failure, restore process block |
| `README.md` | Ghi `--dry-run` và hành vi lỗi một phần |

### 2.1. Hành vi mới

- `--dry-run`:
  - Không ghi state, không tạo registry, không đổi `workers.json`.
  - In danh sách `Sẽ resolve ...`; worker không còn `unknown` bị báo lỗi và exit 1.
  - `--json` trả `{ dryRun: true, wouldResolve: [...], failed: [...] }`.
- `--resolve-all`:
  - Resolve từng worker; một worker lỗi **không** chặn worker còn lại.
  - In summary `Đã resolve X/Y worker; Z lỗi.` và exit 1 nếu có lỗi.
  - Luôn khôi phục block `process` cũ dù thành công hay lỗi một phần.
- `--resolve <id>`: giữ nguyên hành vi cũ (exit 1 nếu không tồn tại/không phải unknown).

## 3. Test plan

| # | Case | Kỳ vọng |
|---|---|---|
| 1 | `--dry-run --resolve <unknown>` | exit 0, in "Sẽ resolve", state không đổi |
| 2 | `--dry-run --resolve-all` (2 unknown) | exit 0, in cả 2, state không đổi |
| 3 | `--dry-run --resolve <running>` | exit 1, báo "chỉ resolve được worker unknown", state không đổi |
| 4 | `--dry-run --json` | `dryRun: true`, `wouldResolve` đúng, `failed: []` |
| 5 | `resolveWorkers` với registry lỗi giữa chừng | worker lỗi vào `failed`, worker sau vẫn được resolve |
| 6 | `restoreProcessBlock` | khôi phục đúng block cũ; xóa block nếu trước đó không có |

## 4. Rollback

Revert `scripts/resolve-worker.js`, `scripts/resolve-worker.test.js`, mục README. Không ảnh hưởng runtime/state schema.

## 5. Definition of Done

- Reviewer APPROVED + QA PASS.
- `npm test` 100%, `scan:secrets` + `scan:history` pass.
- `cortex_detect_changes` ghi nhận risk **medium** (chỉ CLI), có test hồi quy.
