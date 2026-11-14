# TASK-044 — CLI resolve worker `unknown` — COMPLETED 2026-11-14

- **Priority:** P1 — Reliability / Operations
- **Branch:** `ai/auto-cycle-v3`
- **Trạng thái:** **DONE** — Reviewer APPROVED, QA PASS, Quality Gate **A (96/100)**
- **Task gốc:** [TASK-044](TASK-044-resolve-worker-cli.md) · Follow-up của [TASK-005B](TASK-005B-controller-registry-integration.md)
- **Review:** [TASK-044-review-2026-11-14.md](../reviews/TASK-044-review-2026-11-14.md)
- **QA:** [TASK-044-qa-2026-11-14.md](../reviews/TASK-044-qa-2026-11-14.md)

## 1. Vấn đề

Sau TASK-005B, worker `unknown` chặn mọi lần bắt đầu mới (fail-closed, chống mua chồng). Nhưng cách mở khóa duy nhất là sửa tay `workers.json` hoặc chạy một đoạn `node -e` dài trong README — dễ sai, dễ xóa nhầm, và **không kiểm tra agent còn sống**, nên có thể resolve trong lúc bot thật vẫn chạy.

## 2. Thay đổi

| File | Nội dung |
|---|---|
| `scripts/resolve-worker.js` **(mới)** | CLI: `--list` (mặc định), `--resolve <id>`, `--resolve-all`, `--note`, `--state-dir`, `--json`, `--help` |
| `scripts/resolve-worker.test.js` **(mới)** | 14 test chạy CLI bằng process thật (`spawnSync`) trên state tạm |
| `README.md` | Runbook dùng `npm run worker:resolve` thay đoạn `node -e` |
| `package.json` | Script `worker:resolve` |

## 3. An toàn

- **Từ chối resolve khi agent còn sống:** đọc `agent.lock`, yêu cầu lease còn hạn **và** pid còn tồn tại. Lock stale (pid chết) không chặn nhầm.
- Chỉ resolve worker `unknown` (qua `registry.resolveUnknown`).
- Không tạo process lock, không gọi `beginStart`.
- Giữ nguyên block `process` trong `workers.json` — CLI không nhận mình là agent.
- State hỏng → dừng với exit 1, không ghi đè.

## 4. Bằng chứng

- `node --test scripts/resolve-worker.test.js` → **14/14 pass**.
- `npm test` → **302/302 pass**, 0 fail, 0 cancelled.
- `npm run scan:secrets` → pass.
- `cortex_detect_changes` (repo `f04-agent`): risk **low** — 4 file, 0 affected flow.

## 5. Quality Gate — A (96/100)

| Tiêu chí | Điểm |
|---|---|
| Test & bằng chứng | 24/25 |
| Phạm vi & regression | 20/20 (không đổi runtime) |
| Bảo mật & an toàn dữ liệu | 20/20 (chặn resolve khi agent sống) |
| Tài liệu & vận hành | 14/15 |
| Rollback | 10/10 |
| Kiểm soát blast radius | 8/10 (công cụ mới, thao tác state ngắn) |

## 6. Rollback

Xóa `scripts/resolve-worker.js`, `scripts/resolve-worker.test.js`, script `worker:resolve`, và khôi phục đoạn `node -e` trong README. Không ảnh hưởng runtime, không migration.

## 7. Follow-up

1. `--dry-run` để xem trước khi resolve.
2. Ghi audit log (ai resolve, lúc nào) vào `agent.log` thay vì chỉ `reason` của worker.
