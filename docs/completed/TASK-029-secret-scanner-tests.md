# TASK-029 — Add tests for secret scanner

## Thông tin

- **Priority:** P1
- **Risk:** High
- **Effort:** M
- **Dependency:** TASK-001 partial patch
- **Blocks:** TASK-030, TASK-032
- **Status:** **DONE** — test suite hoàn thiện qua task remediation [`TASK-033`](../tasks/TASK-033-complete-secret-scanner-coverage.md) (Reviewer **APPROVED** + QA **PASS**); 13/13 test pass
- **Owner đề xuất:** QA + Platform
- **Cortex task:** `task_0e4d24cba7a3444b` — status **pending** trong Cortex (không có conductor worker online)

## 1.1. Kết quả hoàn thành — 2026-11-01

- **Reviewer:** **REJECTED** (2026-11-01) — thiếu negative coverage cho Bearer token, AWS Access Key, GitHub token, Slack token, Telegram WebApp token send; history-leak assert chưa đủ.
- **Remediation:** [`TASK-033`](../tasks/TASK-033-complete-secret-scanner-coverage.md) — **APPROVED** (2026-11-01) — bổ sung 5 negative test + nâng cấp history-leak assertion.
- **QA:** **PASS** (2026-11-01) — `node --test scripts/check-secrets.test.js` **13/13 PASS**; `npm run check` **190/190 PASS**; `scan:secrets` pass; `scan:history` pass 0 finding; self-scan temp repo pass; link check 0 broken.
- **Trạng thái task:** **DONE** — secret scanner đã có unit + negative test đủ (internal endpoint, refresh-token, private key, Bearer, AWS, GitHub, Slack, Telegram WebApp, binary skip, debug artifact, history leak/clean).

## 1. Mục tiêu

Bảo vệ secret scanner bằng unit test và negative test, để pattern hoặc logic scan không bị regression âm thầm.

## 2. Bằng chứng

- Chỉ có `scripts/check-secrets.js`.
- Không có `scripts/check-secrets.test.js`.
- Không có test positive/negative cho pattern, file binary, history mode.
- Reviewer kết luận thiếu test.

## 3. Phạm vi

- `scripts/check-secrets.test.js`
- `scripts/check-secrets.js`
- `package.json`
- CI workflow

**Cập nhật 2026-11-01:** phạm vi thực thi đã thu hẹp thành **chỉ tạo `scripts/check-secrets.test.js`** — không sửa scanner, `package.json`, CI workflow, runtime hay docs. `npm run check` chạy `node --test` tự phát hiện `*.test.js`; CI đã có bước `npm run check`, nên không cần sửa workflow.

## 4. Kế hoạch thực hiện

1. Tạo temp git repo trong test.
2. Test file sạch → pass.
3. Test file chứa endpoint nội bộ → fail.
4. Test file chứa token pattern → fail.
5. Test file binary → bỏ qua.
6. Test history mode với commit chứa artifact → fail.
7. Thêm test vào `npm run check` hoặc CI step riêng.
8. Ghi coverage vào task.

## 5. Test plan

| Case | Kỳ vọng |
|---|---|
| Clean file | Pass |
| Internal endpoint | Fail |
| Token pattern | Fail |
| Private key block | Fail |
| Binary file | Skip, không throw |
| History có artifact | Fail |
| History sạch | Pass |

## 6. Trạng thái thực thi — 2026-11-01

- **Executor plan:** approved bởi Cortex (`cortex_plan_quality` iteration 2, score **8.7/10** APPROVED).
- **Coder:** subagent đang triển khai `scripts/check-secrets.test.js` (scope tối giản theo Executor plan).
- **Reviewer:** chờ Coder xong.
- **QA:** chờ Reviewer **APPROVED**.
- **Gate commit:** giữ **không commit** — TASK-027 đang **READY_FOR_COMMIT** và công ty freeze; TASK-029 chỉ tạo file mới (untracked), không động vào staged 7 file.

## 7. Rollback

- Nếu test temp repo không ổn định trên Windows: dùng fixture directory thay vì temp git repo.
- Không giảm pattern để test pass.

## 8. Definition of Done

- Có unit test cho scanner.
- Có negative test.
- CI chạy test.
- Scanner không bị regression.

## 9. Executor plan — 2026-11-01

**Phạm vi thay đổi tối thiểu:** chỉ tạo `scripts/check-secrets.test.js`; không sửa `scripts/check-secrets.js`, `package.json` hay workflow.

- `npm run check` chạy `node --test`, tự phát hiện `*.test.js`; CI hiện có bước `npm run check`, nên test mới sẽ chạy mà không cần sửa workflow.
- Test dùng temp git repo (`fs.mkdtempSync` + `git init`) và `spawnSync(process.execPath, [scanner])` với `cwd` là temp repo.
- Pattern nguy hiểm được ghép động trong test để test file không tự kích hoạt scanner khi được commit.
- Case: clean pass; internal endpoint fail; refresh-token fail; private key fail; binary skip; `debug/*.png` artifact fail; history leak fail; history clean pass.
- Cleanup temp repo bằng `t.after`.
- Validation: `node --test scripts/check-secrets.test.js`, `npm run check`, `npm run scan:secrets`, `npm run scan:history`.
- Rollback: xóa `scripts/check-secrets.test.js`; không có file tracked nào bị thay đổi.
