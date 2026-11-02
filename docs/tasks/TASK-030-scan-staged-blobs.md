# TASK-030 — Scan staged blobs/index for secrets

## Thông tin

- **Priority:** P1
- **Risk:** Medium
- **Effort:** S–M
- **Dependency:** TASK-029
- **Blocks:** TASK-032
- **Status:** **READY** — dependency TASK-029/TASK-033 đã DONE
- **Owner đề xuất:** Platform

## 1. Mục tiêu

Đảm bảo scanner kiểm tra nội dung đã stage/index, không chỉ working tree, để chặn trường hợp secret được stage rồi bị xóa/sửa khỏi working tree trước khi commit.

## 2. Bằng chứng

- `listTrackedFiles()` lấy danh sách từ index bằng `git ls-files`.
- Nội dung đọc bằng `fs.readFileSync()` từ working tree.
- Reviewer kết luận có khoảng trống staged-blob.

## 3. Phạm vi

- `scripts/check-secrets.js`
- `scripts/check-secrets.test.js`
- CI/pre-commit nếu có

## 4. Kế hoạch thực hiện

1. Thêm mode đọc nội dung từ index: `git show :path`.
2. Xử lý file binary và file bị xóa.
3. Giữ mode working tree cho local scan nhanh.
4. Thêm test: stage secret, xóa working tree, scanner vẫn fail.
5. Cập nhật README/CI mô tả mode.

## 5. Test plan

| Case | Kỳ vọng |
|---|---|
| Secret chỉ ở index | Fail |
| Secret ở working tree | Fail |
| File sạch | Pass |
| File binary | Skip |
| File bị xóa khỏi index | Bỏ qua |

## 6. Rollback

- Giữ mode working tree nếu index mode gây lỗi.
- Ghi rõ giới hạn và bổ sung pre-commit hook sau.

## 7. Definition of Done

- Scanner đọc được staged blob.
- Có test cho staged secret.
- CI/local scan không regression.
