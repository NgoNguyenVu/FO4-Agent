# TASK-027 — Isolate TASK-001 patch and complete freeze gate

## Thông tin

- **Priority:** P0
- **Risk:** High
- **Effort:** S
- **Dependency:** TASK-007 (freeze gate; TASK-027 chỉ thực hiện phần freeze/isolate cho TASK-001, không thay thế toàn bộ TASK-007)
- **Blocks:** TASK-024, TASK-026, TASK-031
- **Status:** DONE — committed `261e9b7`
- **Owner đề xuất:** Tech Lead + Reviewer độc lập

## 1. Mục tiêu

Cô lập patch TASK-001 khỏi các thay đổi critical pre-existing, hoàn tất freeze gate và tạo một patch/commit reviewable chỉ chứa file thuộc TASK-001.

## 2. Bằng chứng

- `git status` còn 27+ file thay đổi, gồm nhiều file runtime không thuộc TASK-001.
- TASK-007 đang BLOCKED, chưa hoàn tất.
- Nếu commit bằng `git add -A`, patch sẽ mang theo thay đổi ngoài phạm vi.
- Reviewer kết luận REJECTED vì patch không cô lập.

## 3. Phạm vi

- `.gitignore`
- `package.json`
- `scripts/check-secrets.js`
- `.github/workflows/security.yml`
- `docs/incident-2026-10-31.md`
- Redaction trong `docs/backlog.md`, `docs/tasks/TASK-001-security-cleanup.md`
- Deletion của `debug/trade-bulk.html` và 10 ảnh debug

Không thuộc phạm vi:

- `README.md`, `agent.test.js`, `config.json`, `features/*` và các thay đổi runtime pre-existing.

## 4. Kế hoạch thực hiện

1. Freeze repo; thông báo team.
2. Tạo backup bundle/patch.
3. Lập allowlist file TASK-001.
4. Tạo branch/worktree riêng hoặc stage đúng allowlist.
5. Kiểm tra `git diff --name-only --cached` khớp allowlist.
6. Chạy `npm run scan:secrets` và `npm run check`.
7. Tạo patch/commit reviewable; không merge.
8. Cập nhật TASK-007 status.

## 5. Test plan

| Kiểm tra | Kỳ vọng |
|---|---|
| `git diff --name-only --cached` | Chỉ file TASK-001 |
| `git status` file runtime | Không bị stage |
| `npm run scan:secrets` | Pass |
| `npm run check` | 174+ test pass |
| Reviewer xác nhận phạm vi | Pass |

## 6. Rollback

- Unstage toàn bộ nếu sai allowlist.
- Không commit/push.
- Giữ backup patch.

## 7. Definition of Done

- [x] Patch TASK-001 cô lập.
- [x] Không có file runtime ngoài phạm vi.
- **Partial:** TASK-007 freeze gate — phần freeze/isolate cho TASK-001 hoàn tất; push/reindex và thay đổi runtime còn lại.
- [x] Reviewer có thể review đúng phạm vi.

## 8. Kết quả thực thi — 2026-11-01

- **Freeze:** repo được giữ nguyên; không commit/push/merge trong chu kỳ.
- **Backup ngoài repo:** `C:\Users\Admin\AppData\Local\Temp\opencode\fo4-task-027-backup-2026-11-01\` gồm `repo-all.bundle`, `working-tree.patch`, `untracked-backup.zip`, `allowlist.txt`, `git-status-before.txt`.
- **Allowlist:** 18 file; staged đúng 18, missing 0, extra 0.
- **Deletion:** 11 artifact đã stage; `git ls-files -- 'debug/*.html' 'debug/*.png'` trả 0.
- **Ngoài phạm vi:** `config.json`, `features/upgrade/loop.js`, `features/upgrade/runner.js` vẫn unstaged.
- **Kiểm tra:** `npm run scan:secrets` pass; `npm run check` **177/177** pass; `npm run scan:history` fail 3 finding (dự kiến, TASK-024 — historical, xem mục 9).
- **Scanner hardening:** loại bỏ hostname/path cụ thể khỏi regex; pattern generic vẫn phát hiện artifact lịch sử. `git grep --cached` trả 0.
- **Cortex:** `cortex_detect_changes` báo **Risk: low**, 0 changed symbol, 0 affected flow; 5 file mới chưa index.
- **Reviewer:** **APPROVED** — [`TASK-027-review-2026-11-01.md`](../reviews/TASK-027-review-2026-11-01.md).
- **QA:** **PASS** — [`TASK-027-qa-2026-11-01.md`](../reviews/TASK-027-qa-2026-11-01.md).
- **Chưa làm:** history rewrite, credential rotation, force-push/fresh clone, CI history gate, scanner tests, staged-blob scan, commit deletion, cập nhật backlog/TASK-001/incident.
- **Next:** `TASK-026` — force-push/fresh clone, đang **BLOCKED** vì chưa có authorization; xem mục 9–10.

## 9. Addendum sau TASK-024 — 2026-11-01

TASK-024 đã hoàn tất phạm vi local sau khi TASK-027 được review. Trạng thái patch thay đổi như sau:

- **Staged patch:** còn **7 file** — `.github/workflows/security.yml`, `.gitignore`, `docs/backlog.md`, `docs/incident-2026-10-31.md`, `docs/tasks/TASK-001-security-cleanup.md`, `package.json`, `scripts/check-secrets.js`.
- **11 artifact deletion** (`debug/trade-bulk.html` + 10 PNG) đã được hấp thụ vào lịch sử rewrite, không còn trong staged diff.
- **New local HEAD:** `a4b7a25c5dc6f52d67ef5812d23580c440e8747c`.
- **Verification:** `scan:history` pass **0 finding**; `scan:secrets` pass; `npm run check` **177/177**; `git log --all -- debug/trade-bulk.html` rỗng; `git rev-list --objects --all` không còn artifact.
- **Verdict không đổi:** Reviewer vẫn **APPROVED**, QA vẫn **PASS**. Phạm vi review thu hẹp từ 18 file xuống 7 file; không có file mới ngoài allowlist.
- **Điều kiện commit vẫn giữ:** không commit/push/merge cho đến khi TASK-025 → TASK-032 đóng và có security sign-off.
- **Lưu ý:** 3 file docs trong patch (`backlog`, `incident`, `TASK-001`) đã được cập nhật thêm sau rewrite để phản ánh trạng thái mới; cần re-stage trước khi commit.

## 10. Đề xuất commit message — 2026-11-01

```text
chore(security): add secret scanning and document TASK-001 remediation

- add scripts/check-secrets.js with working-tree and history modes
- add npm scan scripts and security workflow
- ignore debug artifacts and document incident/remediation state
```

- Đã commit ngày 2026-11-02 (`261e9b7`) — xem mục 11; message giữ nguyên.
- TASK-024 đã **DONE** và được chuyển sang [`docs/completed/TASK-024-rewrite-git-history.md`](../completed/TASK-024-rewrite-git-history.md).

## 11. Kết quả commit — 2026-11-02

- **Commit:** `261e9b7` — `chore(security): add secret scanning and document TASK-001 remediation`.
- **Phạm vi:** đúng 7 file staged; không có file runtime ngoài phạm vi.
- **Trạng thái:** DONE; chuyển sang `docs/completed/`.
