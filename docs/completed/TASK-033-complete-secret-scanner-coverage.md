# TASK-033 — Complete secret scanner negative test coverage

## Thông tin

- **Priority:** P1
- **Risk:** Medium
- **Effort:** S
- **Dependency:** TASK-029 (implementation REJECTED by Reviewer — partial negative coverage)
- **Blocks:** TASK-030, TASK-032
- **Status:** **DONE** — committed `f22cf96`; Reviewer APPROVED + QA PASS (13/13)
- **Owner đề xuất:** Coder + Reviewer

## 1. Mục tiêu

Hoàn thiện bộ test cho secret scanner theo TASK-029: bổ sung negative test cho các rule chưa được cover và tăng cường assertion của history-leak test.

## 2. Bằng chứng

- Reviewer đánh giá `TASK-029` với verdict **REJECTED** (2026-11-01):
  - Blocker 1: thiếu negative test cho Bearer token, AWS Access Key, GitHub token, Slack token, Telegram WebApp token send.
  - Blocker 2: history-leak test chưa assert đủ (chưa dùng lại `expectFinding` để check rule name).

## 3. Phạm vi

- `scripts/check-secrets.test.js` — chỉ thêm test mới / dùng lại helper, không sửa scanner, `package.json`, CI workflow, runtime, docs.

## 4. Kế hoạch remediation

1. Thêm negative test cho **Bearer token** → `expectFinding(..., "Bearer token")`.
2. Thêm negative test cho **AWS Access Key** → `expectFinding(..., "AWS access key")`.
3. Thêm negative test cho **GitHub token** → `expectFinding(..., "GitHub token")`.
4. Thêm negative test cho **Slack token** → `expectFinding(..., "Slack token")`.
5. Thêm negative test cho **Telegram WebApp token send** → `expectFinding(..., "Telegram WebApp token send")`.
6. Sửa test history-leak: dùng lại `expectFinding(runScanner(dir, ["--history"]), "<rule>")`.

## 5. Test plan

| Case | Kỳ vọng |
|---|---|
| Clean file | Pass |
| Internal endpoint | Fail |
| Refresh-token endpoint | Fail |
| Private key | Fail |
| Bearer token | Fail (mới) |
| AWS access key | Fail (mới) |
| GitHub token | Fail (mới) |
| Slack token | Fail (mới) |
| Telegram WebApp token send | Fail (mới) |
| Binary skip | Skip, không throw |
| Debug artifact | Fail |
| History leak (assert rule) | Fail |
| History clean | Pass |

## 6. Rollback

- Xóa/sửa test mới; không đổi scanner, workflow, package.

## 7. Definition of Done

- Coder bổ sung coverage → Reviewer **APPROVED** → QA **PASS`.

## 8. Ghi chú

- Remediation cho task: [`TASK-029`](../completed/TASK-029-secret-scanner-tests.md) — Secret scanner tests.
- TASK-027 đã commit ngày 2026-11-02 (`261e9b7`); TASK-033 commit `f22cf96` — xem mục 9.

## 9. Kết quả commit — 2026-11-02

- **Commit:** `f22cf96` — `test(security): cover remaining secret scanner rules and history assertion`.
- **Phạm vi:** `scripts/check-secrets.test.js` (171 dòng, 13 test).
- **Trạng thái:** DONE; chuyển sang `docs/completed/`.
