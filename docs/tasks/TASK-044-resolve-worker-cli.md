# TASK-044 — CLI resolve worker `unknown`

## Thông tin

- **Priority:** P1
- **Risk:** Low
- **Effort:** S
- **Dependency:** TASK-005B (`d976b6d`) — worker registry + `resolveUnknown`
- **Status:** **DONE** — Cycle v3 (2026-11-14), branch `ai/auto-cycle-v3`; Reviewer APPROVED + QA PASS; Gate A (96/100). Xem [completed/TASK-044-resolve-worker-cli.md](../completed/TASK-044-resolve-worker-cli.md).
- **Owner đề xuất:** Platform / Reliability
- **Nguồn:** Follow-up của TASK-005B (review §7.1, completed §6.1)

## 1. Mục tiêu

Worker ở trạng thái `unknown` chặn **mọi** lần bắt đầu mới (fail-closed, chống mua chồng). Hiện tại muốn resolve phải sửa `workers.json` bằng tay hoặc chạy một đoạn `node -e` dài trong README — dễ sai và dễ xóa nhầm cả file.

Task này thêm CLI an toàn:

- Liệt kê worker đang `unknown`/`running`/`starting` kèm lý do và heartbeat.
- Resolve một worker cụ thể hoặc toàn bộ worker `unknown`.
- **Từ chối chạy khi agent còn sống** (process lock còn lease + pid còn tồn tại) để không vô tình mở khóa khi bot thật vẫn đang chạy.
- Không đụng tới logic mua/nâng/giá.

## 2. Phạm vi

| File | Thay đổi |
|---|---|
| `scripts/resolve-worker.js` **(mới)** | CLI: `--list` (mặc định), `--resolve <workerId>`, `--resolve-all`, `--note`, `--state-dir`, `--json`, `--help` |
| `scripts/resolve-worker.test.js` **(mới)** | Test CLI bằng process thật (`spawnSync`) trên state tạm |
| `README.md` | Thay đoạn `node -e` bằng lệnh CLI |
| `package.json` | Script `worker:resolve` |

Không thay đổi runtime, không đổi state schema.

## 3. Thiết kế

### 3.1. An toàn

- Đọc `agent.lock`; nếu `leaseUntil > now` **và** pid còn sống → exit **1**, không sửa state.
- `--resolve` chỉ chấp nhận worker đang `unknown` (dùng `registry.resolveUnknown`, vốn đã chặn state khác).
- CLI **không** tự tạo process lock, không gọi `beginStart`.
- Giữ nguyên block `process` cũ trong `workers.json` (CLI không phải agent, không được nhận là chủ state).

### 3.2. Mã thoát

| Code | Ý nghĩa |
|---|---|
| 0 | Thành công (kể cả khi không có worker `unknown`) |
| 1 | Lỗi nghiệp vụ: agent đang chạy, không tìm thấy worker, sai state |
| 2 | Sai tham số |

## 4. Test plan

| # | Case | Kỳ vọng |
|---|---|---|
| 1 | `--list` khi chưa có state | exit 0, thông báo chưa có worker |
| 2 | `--list` có worker `unknown` | exit 0, hiện worker + gợi ý resolve |
| 3 | `--resolve <id>` | worker → `stopped`, exit 0 |
| 4 | `--resolve <id>` khi worker `running` | exit 1, state không đổi |
| 5 | `--resolve-all` | resolve hết `unknown`, giữ nguyên `running` |
| 6 | Agent còn sống (lock fresh) | exit 1, state không đổi |
| 7 | `--json --list` | JSON hợp lệ, đúng field |
| 8 | Tham số sai | exit 2 + usage |
| 9 | `--help` | exit 0 |

## 5. Rollback

Xóa `scripts/resolve-worker.js`, `scripts/resolve-worker.test.js`, script `worker:resolve`, và khôi phục đoạn `node -e` trong README. Không ảnh hưởng runtime.

## 6. Definition of Done

- Reviewer APPROVED + QA PASS.
- `npm test` 100%, `npm run scan:secrets` pass.
- README hướng dẫn khớp hành vi CLI thật.
