# TASK-026 — Force-push cleaned history and verify fresh clone

## Thông tin

- **Priority:** P0
- **Risk:** High
- **Effort:** M
- **Dependency:** TASK-024, TASK-027
- **Blocks:** TASK-028, TASK-032
- **Status:** **DONE** — force-push `f22cf96`; remote sạch; fresh clone scan pass; residual TASK-007 (2 test)
- **Owner đề xuất:** Tech Lead + Platform
- **Authorization:** Cần user/owner cho phép push rõ ràng trước khi thực thi

## 1. Mục tiêu

Đưa lịch sử đã làm sạch lên remote, thông báo team re-clone và xác minh fresh clone không còn artifact.

## 2. Bằng chứng

- Remote/default branch vẫn chứa artifact.
- Chưa có fresh clone verification.
- Chưa có xác nhận team re-clone.
- TASK-001 review kết luận REJECTED vì blocker này.
- **2026-11-01:** TASK-024 đã hoàn tất local — new HEAD `a4b7a25`, `scan:history` pass 0 finding, 11 artifact đã xóa khỏi mọi commit local.
- `origin/main` tracking ref đã bị xóa local; remote thật vẫn ở lịch sử cũ cho đến khi force-push.

## 3. Phạm vi

- Remote branch `main` của `https://github.com/NgoNguyenVu/FO4-Agent.git`.
- Fresh clone verification.
- Thông báo/re-clone cho team.
- Incident note.

Không thuộc phạm vi:

- Rewrite lại lịch sử (TASK-024 đã xong).
- Credential rotation (TASK-025).
- Commit patch TASK-001 (TASK-027/031).

## 4. Điều kiện tiên quyết

1. TASK-024 pass local history scan — **đạt**.
2. Backup bundle còn nguyên và đọc được:
   `C:\Users\Admin\AppData\Local\Temp\opencode\fo4-task-027-backup-2026-11-01\repo-all.bundle`.
3. Staged patch TASK-001 vẫn đúng allowlist 7 file; không có thay đổi runtime bị stage.
4. Có authorization push bằng văn bản từ user/owner.
5. Team đã được thông báo cửa sổ freeze và sẽ re-clone/reset sau khi push.
6. Không ai đang push trong cửa sổ thực thi.

## 5. Kế hoạch thực hiện (chưa chạy)

1. Xác nhận lại `git rev-parse HEAD` = `a4b7a25c5dc6f52d67ef5812d23580c440e8747c`.
2. Xác nhận `git status` chỉ còn staged patch 7 file + 3 file runtime unstaged đã biết.
3. Chạy lại `node scripts/check-secrets.js --history`, `node scripts/check-secrets.js`, `npm run check`.
4. Ghi lại `git ls-remote origin main` trước khi push để có old remote hash.
5. Force-push an toàn:
   `git push --force-with-lease=main:42d3555360dc3885c94f9a9ad5722ff12e722f6c origin main`
   - Nếu lease fail: **dừng**, không dùng `--force` trần; điều tra remote đã đổi.
6. Xác nhận `git ls-remote origin main` = `a4b7a25...`.
7. Fresh clone ra thư mục tạm; chạy `npm ci`, `npm run scan:secrets`, `npm run scan:history`, `npm run check`.
8. Kiểm tra `git log --all -- debug/trade-bulk.html` và `git rev-list --objects --all` trên fresh clone.
9. Thông báo team re-clone hoặc `git reset --hard origin/main`; ghi xác nhận từng thành viên.
10. Cập nhật incident note với old/new remote hash, thời gian, người thực hiện, kết quả fresh clone.

## 6. Thông báo team (mẫu)

> **Security remediation — bắt buộc re-clone**
>
> Remote `main` đã được rewrite để xóa debug artifact khỏi lịch sử. Old HEAD: `42d3555`; new HEAD: `a4b7a25`.
>
> Nếu bạn có commit local chưa push, hãy backup trước. Sau đó:
> `git fetch origin && git reset --hard origin/main`
> hoặc clone mới. Không merge/rebase lịch sử cũ vào nhánh mới.
>
> Xác nhận lại trong incident note sau khi hoàn tất.

## 7. Test plan

| Kiểm tra | Kỳ vọng |
|---|---|
| `git ls-remote origin main` sau push | `a4b7a25...` |
| Fresh clone `git log --all -- debug/trade-bulk.html` | Không có output |
| Fresh clone `git rev-list --objects --all` | Không còn artifact |
| Fresh clone `npm run scan:history` | 0 finding |
| Fresh clone `npm run scan:secrets` | Pass |
| Fresh clone `npm run check` | 190/190 pass (thực tế 188/190 — TASK-007) |
| Team re-clone | Có xác nhận |

## 8. Rollback

- Nếu force-push sai: restore bundle, force-push lại lịch sử cũ, thông báo team.
- Giữ backup bundle đến khi TASK-032 đóng.
- Không rewrite lần hai khi chưa có backup mới.
- Không xóa backup/quarantine cho đến khi incident đóng.

## 9. Definition of Done

- Remote không còn artifact trong history.
- Fresh clone sạch.
- Team đã re-clone.
- Incident note có evidence.
- Không có commit/push nào ngoài phạm vi force-push `main`.

## 10. Kết quả thực thi — 2026-11-02

- **Authorization:** `docs/authorizations/authorization-2026-11-02.md` — Force push APPROVED (backup verified, rollback available).
- **Pre-push:** remote `main` = `42d3555...`; backup bundle tồn tại; `scan:secrets` pass; `scan:history` pass; `npm run check` **190/190**.
- **Commit gate:** TASK-027 `261e9b7`, TASK-033 `f22cf96`.
- **Force-push:** `git push --force-with-lease=main:42d3555... origin main` → `42d3555...f22cf96` (forced update).
- **Fresh clone:** `C:\Users\Admin\AppData\Local\Temp\opencode\fo4-task-026-fresh-2026-11-02`, HEAD `f22cf96`.
- **Fresh clone verification:** `scan:secrets` pass; `scan:history` pass; `git log --all -- debug/trade-bulk.html` rỗng; `git rev-list --objects --all` không còn artifact.
- **Residual:** `npm run check` trên fresh clone **188/190** — 2 test fail vì `features/upgrade/loop.js`/`runner.js` runtime fixes chưa commit (TASK-007). Không phải artifact/secret leak; TASK-007 đã chuyển **AUTHORIZATION_REQUIRED**.
- **Kết luận:** B3 đóng phạm vi security (remote sạch, fresh clone không còn artifact). Test-suite xanh trên CI phụ thuộc TASK-007.
