# TASK-030 — Scan staged blobs/index for secrets

## Thông tin

- **Priority:** P1
- **Risk:** Medium
- **Effort:** S–M
- **Dependency:** TASK-029/TASK-033 — DONE
- **Blocks:** TASK-032
- **Status:** **DONE** — commit `4d16d41` (+ phần lõi trong `7f9291b`); Reviewer APPROVED + QA PASS (21/21)
- **retry_count:** 0
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

## 8. Kết quả thực thi — 2026-11-04

### 8.1. Patch

| File | Thay đổi |
|---|---|
| `scripts/check-secrets.js` | `scanStaged()` đọc blob index bằng `git show :<path>`, skip binary NUL, skip file xóa khỏi index, flag `debug/*.png|html` (phần lõi nằm trong commit local `7f9291b`) |
| `scripts/check-secrets.test.js` | T1–T8: staged secret bị xóa/ghi đè, file sạch, binary, file xóa khỏi index, remediation scenario, staged-ignores-working-tree-only, staged debug artifact |
| `package.json` | thêm `"scan:staged": "node scripts/check-secrets.js --staged"` |
| `.github/workflows/security.yml` | thêm step `scan:staged` giữa `scan:secrets` và `scan:history` |
| `README.md` | section `## Secret scanning`: 3 mode, exit code, scope, skip, known limitations |

### 8.2. Commit

- **Commit:** `4d16d41` — `feat(security): add staged-index secret scan mode` (4 file, +79/−1).
- **Phần lõi:** `scripts/check-secrets.js` + T1–T5 nằm trong commit local `7f9291b` (chưa push).

### 8.3. Review & QA

- **Reviewer:** **APPROVED**, REJECTION_TYPE `NONE` — [`TASK-030-review-2026-11-04`](../reviews/TASK-030-review-2026-11-04.md).
- **QA:** **PASS**, FAILURE_TYPE `NONE` — [`TASK-030-qa-2026-11-04`](../reviews/TASK-030-qa-2026-11-04.md).
  - `node --test scripts/check-secrets.test.js` → **21/21 pass**.
  - `npm run check` → **198/198 pass** (local, có fix TASK-007 chưa commit).
  - `--staged` / `--history` pass trên fresh clone.
  - Mutation test: T7 fail khi `scanStaged()` đọc working tree; T8 fail khi bỏ `ARTIFACT_RE`.

### 8.4. Ghi chú

- **B7 đóng.**
- Finding ngoài scope còn mở: **F1** — local ref `refs/agents/*` chứa Bearer token khiến `scan:history` local fail (fresh clone pass); **F2** — `.mcp.json` untracked chứa key, chưa được ignore.
- Rủi ro traceability: commit `7f9291b` chứa cả runtime fixes của TASK-007 và nhiều docs ngoài phạm vi; không rewrite history nếu chưa có Owner Decision.
- Giới hạn đã document: `git add -N` false negative; `--history` thắng `--staged`; lỗi `git show` bị skip im lặng.
