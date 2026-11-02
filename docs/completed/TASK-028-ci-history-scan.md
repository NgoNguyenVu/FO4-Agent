# TASK-028 — Add history secret scan to CI

## Thông tin

- **Priority:** P0
- **Risk:** High
- **Effort:** S
- **Dependency:** TASK-024, TASK-026
- **Blocks:** TASK-032
- **Status:** **DONE** — commit `26a9d46`; Reviewer APPROVED + QA PASS
- **Owner đề xuất:** Platform + Security

## 1. Mục tiêu

Thêm CI gate quét toàn bộ git history để chặn artifact/token đã từng bị commit, không chỉ working tree.

## 2. Bằng chứng

- `.github/workflows/security.yml` chỉ chạy `npm run scan:secrets`.
- Không có `fetch-depth: 0`.
- Không chạy `npm run scan:history`.
- Reviewer kết luận CI chưa chặn history leak.

## 3. Phạm vi

- `.github/workflows/security.yml`
- `package.json`
- `scripts/check-secrets.js`
- Branch protection (nếu có quyền)

## 4. Kế hoạch thực hiện

1. Thêm `fetch-depth: 0` cho checkout.
2. Thêm step `npm run scan:history`.
3. Đặt step là blocking, không `continue-on-error`.
4. Test trên repo sạch: pass.
5. Test trên branch tạm có artifact: fail.
6. Ghi kết quả vào incident note.

## 5. Test plan

| Kiểm tra | Kỳ vọng |
|---|---|
| Repo sạch | `scan:history` pass |
| Branch tạm có artifact | CI fail |
| PR sạch | CI pass |
| `npm run check` | 174+ test pass |

## 6. Rollback

- Nếu history chưa sạch, giữ job ở chế độ cảnh báo tạm thời và ghi rõ ngày bật blocking.
- Không tắt secret scan vĩnh viễn.

## 7. Definition of Done

- CI checkout full history.
- `scan:history` là blocking gate.
- Có negative test.
- Incident note cập nhật.

## 8. Trạng thái 2026-11-02

- Dependency TASK-024 và TASK-026 đã **DONE**; remote `main` = `f22cf96`, history sạch artifact.
- Task chuyển **READY**; cần Coder thêm `fetch-depth: 0` + step `npm run scan:history` (blocking).
- **Lưu ý:** CI `npm run check` sẽ còn đỏ cho đến khi TASK-007 runtime fixes được commit (fresh clone 188/190).

## 9. Kết quả thực thi — 2026-11-02

- **Commit:** `26a9d46` — `ci(security): scan full git history for secrets`.
- **Phạm vi:** `.github/workflows/security.yml` (+5 dòng).
- **Thay đổi:** `actions/checkout` với `fetch-depth: 0`; step `npm run scan:history` blocking sau `scan:secrets`.
- **Reviewer:** **APPROVED** — đúng phạm vi, YAML hợp lệ, không `continue-on-error`.
- **QA:** **PASS** — `scan:history` pass; `scan:secrets` pass; `npm run check` 190/190 local; negative test temp repo exit 1.
- **Push:** `f22cf96..26a9d46` lên `origin/main`.
- **Trạng thái:** DONE; chuyển sang `docs/completed/`.
