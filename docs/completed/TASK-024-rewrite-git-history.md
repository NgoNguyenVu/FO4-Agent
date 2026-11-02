# TASK-024 — Rewrite git history to remove debug artifacts

## Thông tin

- **Priority:** P0
- **Risk:** Critical
- **Effort:** M
- **Dependency:** TASK-007, TASK-027
- **Blocks:** TASK-026, TASK-028, TASK-031
- **Status:** DONE
- **Owner đề xuất:** Tech Lead + Security

## 1. Mục tiêu

Loại bỏ `debug/trade-bulk.html` và 10 ảnh `debug/*.png` khỏi toàn bộ lịch sử git, không chỉ HEAD, để bất kỳ clone nào cũng không thể khôi phục artifact.

> **Cập nhật 2026-11-01:** TASK-027 đã hoàn tất isolation/freeze; TASK-024 đã được thực thi trên clean clone từ backup bundle và áp dụng ref update vào repo chính. New HEAD `a4b7a25`; xem mục 8 để biết kết quả và verification. Không chạy `git filter-repo` trên main worktree đang dirty.

## 2. Bằng chứng

- `npm run scan:history` fail 3 finding (trước rewrite):
  - internal FO4 endpoint
  - customer token refresh endpoint
  - Telegram WebApp token send
- Cortex MCP vẫn thấy endpoint nội bộ trong `debug/trade-bulk.html` trên default branch.
- Artifact nằm trong commit `42d3555`.

## 3. Phạm vi

- Git history của repo.
- `debug/trade-bulk.html`.
- 10 ảnh `debug/*.png`.
- Backup bundle và manifest ngoài repo.

Không thuộc phạm vi:

- Force-push (TASK-026).
- Credential rotation (TASK-025).
- Thay đổi code runtime.

## 4. Kế hoạch thực hiện

1. Xác nhận TASK-027 đã freeze repo và tạo backup bundle/patch.
2. Inventory artifact cần xóa; đối chiếu với manifest quarantine.
3. Chạy `git filter-repo` hoặc BFG để xóa path/glob khỏi mọi commit.
4. Kiểm tra không còn object artifact trong `git rev-list --objects --all`.
5. Chạy `git fsck --full`.
6. Chạy `npm run scan:history`; phải pass 0 finding.
7. Ghi lại commit hash trước/sau rewrite vào incident note.
8. Không force-push trong task này; bàn giao TASK-026.

## 5. Test plan

| Kiểm tra | Kỳ vọng |
|---|---|
| `git log --all --oneline -- debug/trade-bulk.html` | Không có output |
| `git rev-list --objects --all` quét HTML/PNG debug | Không còn artifact |
| `npm run scan:history` | 0 finding |
| `git fsck --full` | Không lỗi |
| `npm run check` | 174+ test pass |

## 6. Rollback

- Restore `repo.bundle` đã tạo trước rewrite.
- Không xóa backup cho đến khi TASK-026 và TASK-032 hoàn tất.
- Nếu rewrite sai: dừng, restore, thông báo Tech Lead.

## 7. Definition of Done

- [x] Local git history sạch artifact.
- [x] `scan:history` pass.
- [x] Backup bundle còn nguyên.
- [x] Incident note ghi commit hash trước/sau.
- [x] Bàn giao TASK-026 để force-push.

## 8. Kết quả thực thi — 2026-11-01

- **Old local HEAD:** `3e25db2e176108ca823baa6208daf29a9dd01477`
- **Old remote HEAD:** `42d3555360dc3885c94f9a9ad5722ff12e722f6c`
- **New local HEAD:** `a4b7a25c5dc6f52d67ef5812d23580c440e8747c`
- **Rewritten commits:** `1c19df2` (initial), `0c36389`, `eed8031`, `a4b7a25`
- **Method:** `git filter-repo --path debug/trade-bulk.html --path-glob 'debug/*.png' --invert-paths` trong clean clone từ backup bundle; sau đó `git update-ref refs/heads/main` trong repo chính để giữ nguyên staged patch và working tree.
- **Clean clone:** `C:\Users\Admin\AppData\Local\Temp\opencode\fo4-task-024-2026-11-01\clean`
- **Backup bundle:** `C:\Users\Admin\AppData\Local\Temp\opencode\fo4-task-027-backup-2026-11-01\repo-all.bundle`
- **Staged patch sau rewrite:** 7 file; 11 artifact deletion đã nằm trong history, không còn trong staged diff.
- **Verification:** `scan:history` pass **0**; `scan:secrets` pass; `npm run check` **177/177**; `git log --all -- debug/trade-bulk.html` rỗng; `git rev-list --objects --all` không còn artifact; `git fsck --full` không lỗi (chỉ còn dangling object cũ).
- **Remote:** `origin/main` tracking ref đã xóa local; remote thật vẫn chứa artifact cho đến `TASK-026`.
- **Lưu ý:** Không chạy `git gc --prune=now` khi staged patch chưa commit; có thể prune blob chỉ được index tham chiếu. `git fetch` trước `TASK-026` sẽ khôi phục ref cũ và finding.
