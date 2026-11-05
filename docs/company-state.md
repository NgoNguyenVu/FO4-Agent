# Company State

- **Cập nhật:** 2026-11-05
- **Người cập nhật:** Manager Agent (Engineering Director)
- **Current Sprint:** Security Remediation — TASK-001
- **Company Delivery Status:** **IN_PROGRESS — TASK-001** (B1–B9 đã đóng; **TASK-007 DONE**; **TASK-035 DONE**; còn TASK-039 + TASK-001 re-review + QA)
- **Active Cycle Status:** **TASK-007 DONE** — Reviewer v2 APPROVED, QA PASS 198/198, commit `9542347` đã push
- **Current Task:** `TASK-039` — ICON refactor (**TODO**, đã đủ điều kiện mở); song song TASK-001 re-review + QA (SCHEDULED).
- **Task Status:** **TODO**
- **Reviewer:** **APPROVED** — TASK-027 (2026-11-01), TASK-033 (2026-11-01), TASK-030 (2026-11-04), **TASK-007 v2** (2026-11-05)
- **QA:** **PASS** — TASK-027 (2026-11-01), TASK-033 (13/13), TASK-030 (21/21, 2026-11-04), **TASK-007 (198/198, 2026-11-05)**
- **Parallel Security Task:** TASK-025 — **ACCEPTED RISK APPROVED** (no active production credential; no rotation required)
- **Blocked Task:** _(không còn)_ — TASK-001 đã đủ điều kiện re-review
- **Authorization Required:** _(không còn)_ — `TASK-007` đã đóng bằng `9542347`
- **TASK-007 Review Verdict:** **APPROVED** (vòng 2, 2026-11-05) — vòng 1 REJECTED `IN_SCOPE_FIX` vì config regression trong `7f9291b`; xem `docs/reviews/TASK-007-review-2026-11-05.md`; QA **PASS** 198/198 (`TASK-007-qa-2026-11-05.md`).
- **TASK-001 Review Verdict:** REJECTED (2026-10-31) — chưa re-review
- **Commit Allowed:** Chỉ khi task = `COMMIT_AUTHORIZED` (không còn freeze chung)
- **Push Allowed:** Chỉ trong phạm vi task đã được authorization
- **Merge Allowed:** NO
- **Live Run Allowed:** NO
- **Security Risk Acceptance:** TASK-025 — **APPROVED** (Accepted Risk); TASK-026 — **APPROVED** (Force push authorized và đã thực thi).

## 1. Kết quả thực thi — 2026-11-02

### 1.1. Commit gate đã mở và thực thi

- **TASK-027:** Reviewer **APPROVED** + QA **PASS**; là Standard Task (không thuộc High-Risk Gates) → `READY_FOR_COMMIT → COMMIT_AUTHORIZED → DONE`.
  - Commit `261e9b7` — `chore(security): add secret scanning and document TASK-001 remediation`.
  - Đúng 7 file: `.github/workflows/security.yml`, `.gitignore`, `docs/backlog.md`, `docs/incident-2026-10-31.md`, `docs/tasks/TASK-001-security-cleanup.md`, `package.json`, `scripts/check-secrets.js`.
- **TASK-033:** Reviewer **APPROVED** + QA **PASS** (13/13) → `COMMIT_AUTHORIZED → DONE`.
  - Commit `f22cf96` — `test(security): cover remaining secret scanner rules and history assertion`.
  - 1 file: `scripts/check-secrets.test.js` (171 dòng).

### 1.2. TASK-026 — force-push và fresh clone

- **Authorization:** `docs/authorizations/authorization-2026-11-02.md` — **APPROVED** (force push authorized; backup verified; rollback available).
- **Pre-push:** remote `main` = `42d3555...`; backup bundle tồn tại; `scan:secrets` pass; `scan:history` pass; `npm run check` **190/190**.
- **Force-push:** `git push --force-with-lease=main:42d3555... origin main` → `42d3555...f22cf96` (forced update).
- **Fresh clone:** `C:\Users\Admin\AppData\Local\Temp\opencode\fo4-task-026-fresh-2026-11-02`, HEAD `f22cf96`.
- **Fresh clone verification:** `scan:secrets` pass; `scan:history` pass; `git log --all -- debug/trade-bulk.html` rỗng; `git rev-list --objects --all` không còn artifact.
- **Residual:** `npm run check` trên fresh clone **188/190** — 2 test fail do runtime fixes của TASK-007 chưa commit. Không phải artifact/secret leak.

### 1.3. TASK-025 — Accepted Risk Approved

- **Authorization:** `docs/authorizations/authorization-2026-11-02.md` — **APPROVED**.
- **Kết luận:** Không tồn tại credential production đang hoạt động; **không yêu cầu rotation**.
- **Hình thức:** Accepted Risk Approved (personal repo, single owner, no production secrets, no active exposed credential).
- **B2 đóng** bằng quyết định rủi ro của owner.

### 1.4. TASK-031 — deletion verification

- 11 artifact đã bị loại khỏi mọi commit từ TASK-024.
- `git log --all -- debug/trade-bulk.html` rỗng; `git ls-files -- 'debug/*.html' 'debug/*.png'` → 0.
- Fresh clone `f22cf96` không còn `debug/trade-bulk.html` hoặc `debug/*.png`.
- **B8 đóng.**

### 1.5. TASK-030 — staged-index secret scan (2026-11-04)

- **Executor plan:** `docs/reviews/TASK-030-executor-plan-2026-11-03.md` — xác định còn thiếu README + T7/T8.
- **Coder:** bổ sung README `## Secret scanning`, T6/T7/T8, comment CI; entry point `npm run scan:staged`; step CI giữa `scan:secrets` và `scan:history`.
- **Reviewer:** **APPROVED**, REJECTION_TYPE `NONE` — `docs/reviews/TASK-030-review-2026-11-04.md`.
- **QA:** **PASS**, FAILURE_TYPE `NONE` — `docs/reviews/TASK-030-qa-2026-11-04.md`.
  - `node --test scripts/check-secrets.test.js` → **21/21**.
  - `npm run check` → **198/198** local (có fix TASK-007 chưa commit).
  - Fresh clone: `--staged` + `--history` pass.
- **Commit:** `4d16d41` — `feat(security): add staged-index secret scan mode` (4 file, +79/−1). Phần lõi `scanStaged()` + T1–T5 nằm trong commit local `7f9291b`.
- **B7 đóng.**

## 2. Blocked By — remediation tasks

TASK-001 chỉ được đóng khi **B1–B9** đóng và có security sign-off.

| Blocker | Task | Status | Ghi chú |
|---|---|---|---|
| B1 — History còn artifact | `TASK-024` | **DONE** | History sạch; đã force-push; fresh clone 0 finding |
| B2 — Credential chưa rotate | `TASK-025` | **DONE** | Accepted Risk Approved — no active credential |
| B3 — Chưa force-push/re-clone | `TASK-026` | **DONE** | Remote `f22cf96`; fresh clone scan pass |
| B4 — Patch không cô lập | `TASK-027` | **DONE** | Commit `261e9b7`, đúng 7 file |
| B5 — CI chưa scan history | `TASK-028` | **DONE** | Commit `26a9d46`; `fetch-depth: 0` + `scan:history` blocking |
| B6 — Thiếu test scanner | `TASK-029` | **DONE** | Hoàn thiện qua `TASK-033`; 13/13 test |
| B7 — Scanner đọc working tree | `TASK-030` | **DONE** | Commit `4d16d41`; 21/21 test; Reviewer + QA pass |
| B8 — Deletion chưa stage | `TASK-031` | **DONE** | Verified trong history + fresh clone |
| B9 — Thiếu cập nhật trạng thái | `TASK-032` | **DONE** | Commit `c93649e`; evidence/sign-off; Review APPROVED + QA PASS |

**Thứ tự còn lại:** `TASK-039` Review + QA → `TASK-001` re-review + QA. (`TASK-007` và `TASK-035` đã DONE.)

## 3. Gate để mở block TASK-001

- [x] `npm run scan:history` pass **0 finding** trên remote và fresh clone (local fail do ref `refs/agents/*` — F1 ngoài scope).
- [x] Credential cũ bị vô hiệu hóa hoặc **Accepted Risk Approved** (owner decision: no active credential).
- [x] Remote sạch; fresh clone pass `scan:secrets`, `scan:history`.
- [x] Scanner có test; staged secret bị phát hiện (21/21).
- [x] Deletion của artifact đã được commit và xác minh trên fresh clone.
- [x] CI có history scan blocking và negative test (`TASK-028`).
- [x] Scanner đọc staged blob/index (`TASK-030`, `4d16d41`).
- [x] Evidence/status + security sign-off (`TASK-032`).
- [x] F1/F2 (`TASK-035` DONE, `cc605f9`) — mở khóa TASK-001 Reviewer re-review + QA pass.
- [x] `npm run check` tại `9542347` = **198/198** (QA TASK-007 vòng 2 trên worktree sạch).

## 4. Trạng thái công ty

| Mảng | Trạng thái | Ghi chú |
|---|---|---|
| Engineering | **Remediation tiếp tục** | Patch TASK-001 đã commit/push; không merge/release/live |
| Security | **Đang xử lý** | History sạch; staged-blob scan đã đóng; còn evidence/sign-off |
| Release | **Blocked** | Không chạy live, không merge thay đổi lớn |
| Task board | **2 task mở + 12 completed** | Mở: TASK-001 (re-review), TASK-039 (Review/QA); completed: 007, 024, 025, 026, 027, 028, 029, 030, 031, 032, 033, 034, 035 |
| Bàn giao tiếp theo | `TASK-039` — ICON refactor (TODO) | Reviewer → QA trên diff ICON; sau đó `TASK-001` re-review + QA |

## 5. Quyết định của Manager — 2026-11-04

- **TASK-030 commit gate:** Reviewer **APPROVED** + QA **PASS**; Standard Task (không force-push/credential/history rewrite) → `READY_FOR_COMMIT → COMMIT_AUTHORIZED → DONE`.
- **Commit `4d16d41`** chỉ gồm 4 file TASK-030: `package.json`, `.github/workflows/security.yml`, `scripts/check-secrets.test.js`, `README.md`. Phần lõi `scanStaged()` + T1–T5 đã nằm trong commit local `7f9291b`; **không rewrite history** vì chưa có Owner Decision.
- **TASK-032:** **DONE** — Review APPROVED + QA PASS, evidence + security sign-off recorded 2026-11-04.
- **F1 (HIGH):** local ref `refs/agents/*` chứa Bearer token khiến `scan:history` local fail — **TASK-035 (READY)** đóng (xóa stale ref; không cần Owner Decision vì local-only).
- **F2 (HIGH):** `.mcp.json` untracked chứa Bearer key và chưa được ignore; `git add -A` sẽ commit key — **TASK-035 (READY)** đóng (`.gitignore` + local config).
- **TASK-007:** **DONE** (2026-11-05) — Reviewer vòng 1 REJECTED `IN_SCOPE_FIX` (config regression trong `7f9291b`); Coder fix bằng commit `9542347` (`ovrMin=118`, `maxPriceBP=888888`, `minRatio=74`, `purchaseTimeoutSeconds=3600`); Reviewer vòng 2 **APPROVED**, QA **PASS** 198/198; push `c93649e..9542347`.
- **TASK-035:** **DONE** — `cc605f9`; F1/F2 đóng.

## 6. Next Action

1. `TASK-039` — **Review + QA** trên diff ICON (14 file runtime + 4 test + README) trong working tree; nếu APPROVED + PASS → `READY_FOR_COMMIT` (chưa commit nếu chưa có authorization).
2. `TASK-001` — Reviewer re-review + QA pass; chỉ đóng khi B1–B9 + TASK-035 DONE và `npm run check` xanh (`9542347` đã 198/198).
3. Owner Decision — xác nhận tham số tài chính `maxPriceBP 888888` (worst-case ~12.4M BP/vòng) và `purchaseTimeoutSeconds 0` (chờ vô hạn) theo TASK-003.

**STOP CONDITION: NO** — `TASK-039` chưa Review/QA, `TASK-001` chưa re-review, còn quyết định tài chính chờ Owner.
