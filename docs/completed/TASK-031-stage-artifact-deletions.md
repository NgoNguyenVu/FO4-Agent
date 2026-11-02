# TASK-031 — Stage artifact deletions atomically

## Thông tin

- **Priority:** P1
- **Risk:** Medium
- **Effort:** S
- **Dependency:** TASK-024, TASK-027
- **Blocks:** TASK-032
- **Status:** **DONE** — deletion verified trong rewritten history + fresh clone `f22cf96`
- **Owner đề xuất:** Tech Lead

## 1. Mục tiêu

Đảm bảo deletion của `debug/trade-bulk.html` và 10 ảnh debug được stage/commit cùng patch TASK-001, không bị bỏ sót bởi commit chọn lọc.

## 2. Bằng chứng

- **Trước TASK-024:** `git status` hiển thị deletion ở working tree; index vẫn track artifact; Reviewer kết luận deletion chưa stage.
- **Sau TASK-024 (2026-11-01):** 11 artifact đã bị xóa khỏi toàn bộ lịch sử local; `git ls-files -- 'debug/*.html' 'debug/*.png'` trả **0**; staged patch chỉ còn 7 file docs/config/scanner.
- **Còn lại:** commit thực tế của patch TASK-001 và xác minh trên fresh clone sau `TASK-026` chưa thực hiện.

## 3. Phạm vi

- `debug/trade-bulk.html`
- 10 ảnh `debug/*.png`
- Index/commit TASK-001
- Fresh-clone verification

## 4. Kế hoạch thực hiện

1. [x] Xác nhận artifact đã được quarantine ngoài repo.
2. [x] Xóa artifact khỏi lịch sử bằng TASK-024 (rewrite).
3. [x] Kiểm tra `git ls-files -- 'debug/*.html' 'debug/*.png'` rỗng.
4. [x] Kiểm tra `git rev-list --objects --all` không còn artifact.
5. [ ] Commit patch TASK-001 sau khi được authorization.
6. [ ] Xác nhận fresh clone sau `TASK-026` không có artifact.
7. [ ] Ghi commit hash và kết quả fresh clone vào incident note.

## 5. Test plan

| Kiểm tra | Kỳ vọng | Trạng thái |
|---|---|---|
| `git ls-files debug/*.html debug/*.png` | Rỗng | **PASS** |
| `git log --all -- debug/trade-bulk.html` | Rỗng | **PASS** |
| `git rev-list --objects --all` | Không còn artifact | **PASS** |
| Commit chứa deletion | Có | **PENDING** — chờ commit |
| Fresh clone | Không có artifact | **PENDING** — chờ TASK-026 |

## 6. Rollback

- Nếu cần khôi phục để điều tra: lấy từ quarantine, không lấy từ git history.
- Không stage lại artifact vào repo.

## 7. Definition of Done

- [x] Deletion được xóa khỏi lịch sử local.
- [x] Không còn artifact trong index.
- [ ] Deletion nằm trong commit cuối.
- [ ] Fresh clone sạch sau force-push.

## 8. Kết quả xác minh — 2026-11-02

- **Commit chứa patch TASK-001:** `261e9b7`.
- **Deletion trong history:** 11 artifact đã bị loại khỏi mọi commit từ TASK-024; `git log --all -- debug/trade-bulk.html` rỗng.
- **Index:** `git ls-files -- 'debug/*.html' 'debug/*.png'` → 0.
- **Fresh clone:** HEAD `f22cf96`; `git rev-list --objects --all` không còn `debug/trade-bulk.html` hoặc `debug/*.png`.
- **Kết luận:** B8 đóng; deletion không bị bỏ sót bởi commit chọn lọc.
