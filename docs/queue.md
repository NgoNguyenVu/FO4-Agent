# Current Queue

- **Cập nhật:** 2026-11-05
- **Sprint:** Security Remediation — TASK-001
- **Company Status:** **IN_PROGRESS — TASK-001** (B1–B9 đã đóng; **TASK-007 DONE**; **TASK-035 DONE**; còn TASK-039 + TASK-001 re-review + QA)
- **Active Task:** `TASK-039` — **TODO**, đã đủ điều kiện mở sau khi `TASK-007` DONE (`9542347`)
- **Current Focus:** TASK-039 Review + QA trên diff ICON mới; song song TASK-001 re-review + QA.
- **Repo:** local `main` = `9542347`; remote `main` = `9542347` (đã đồng bộ `0 0`); history sạch artifact; CI đã có history gate blocking.
- **Freeze:** Không còn freeze chung. Commit chỉ khi task = `COMMIT_AUTHORIZED`; **không merge, release hoặc chạy live**.
- **Security Risk Acceptance:** TASK-025 — **ACCEPTED RISK APPROVED**; TASK-026 — **APPROVED** (force push executed).
- **Residual risk:** `npm run check` tại `9542347` = **198/198**. TASK-007 **DONE** (config regression đã sửa bằng `9542347`). F1/F2 → **TASK-035 DONE**. Còn mở: Review/QA TASK-039 và TASK-001 re-review, cùng quyết định tài chính `maxPriceBP 888888` / `purchaseTimeoutSeconds 0` (TASK-003).

## 1. Ready — executable

| Task | Priority | Bước kế tiếp |
|---|---|---|
| `TASK-039` — ICON continuous-buy + inventory gate | P0 | **Review + QA** trên diff ICON trong working tree (14 file runtime + 4 test + README). TASK-007 đã chốt baseline `config.json` (`9542347`). |
| `TASK-001` — Security cleanup | P0 | **Reviewer re-review + QA pass**; đóng khi `npm run check` xanh trên `9542347` (đã 198/198). |

## 2. Authorization required

_(không có task nào chờ Owner Decision)_

## 3. Blocked

_(không có task bị block)_

## 4. Done — 2026-11-04

| Task | Kết quả | Record |
|---|---|---|
| `TASK-028` — CI history scan | **DONE** — commit `26a9d46`; `fetch-depth: 0` + `scan:history` blocking | [`completed/TASK-028`](completed/TASK-028-ci-history-scan.md) |
| `TASK-025` — Rotate/revoke credentials | **ACCEPTED RISK APPROVED** — no active production credential; no rotation required | [`completed/TASK-025`](completed/TASK-025-rotate-credentials.md) |
| `TASK-026` — Force-push + fresh clone | **DONE** — `42d3555...f22cf96`; remote sạch; fresh clone scan pass; residual TASK-007 | [`completed/TASK-026`](completed/TASK-026-force-push-fresh-clone.md) |
| `TASK-027` — Isolate patch/freeze | **DONE** — commit `261e9b7`, đúng 7 file | [`completed/TASK-027`](completed/TASK-027-isolate-patch-freeze.md) |
| `TASK-031` — Stage artifact deletions | **DONE** — deletion verified trong history + fresh clone | [`completed/TASK-031`](completed/TASK-031-stage-artifact-deletions.md) |
| `TASK-033` — Complete secret scanner coverage | **DONE** — commit `f22cf96`; 13/13 test; `npm run check` 190/190 local | [`completed/TASK-033`](completed/TASK-033-complete-secret-scanner-coverage.md) |
| `TASK-024` — Rewrite git history | **DONE (pushed)** — new history `a4b7a25` → `26a9d46` | [`completed/TASK-024`](completed/TASK-024-rewrite-git-history.md) |
| `TASK-029` — Secret scanner tests | **DONE** — hoàn thiện qua `TASK-033` | [`completed/TASK-029`](completed/TASK-029-secret-scanner-tests.md) |
| `TASK-034` — Authorization request | **DONE** — authorization-2026-11-02 APPROVED | [`completed/TASK-034`](completed/TASK-034-authorization-request-security-remediation.md) |
| `TASK-030` — Scan staged blobs/index | **DONE** — commit `4d16d41`; 21/21 test; Reviewer APPROVED + QA PASS | [`completed/TASK-030`](completed/TASK-030-scan-staged-blobs.md) |
| `TASK-032` — Close remediation + evidence | **DONE** — evidence recorded 2026-11-04; Review APPROVED + QA PASS | [`completed/TASK-032`](completed/TASK-032-close-remediation.md) |
| `TASK-035` — Local secret hygiene (F1/F2) | **DONE** — commit `cc605f9`; Review APPROVED + QA PASS; F1/F2 đóng | [`completed/TASK-035`](completed/TASK-035-local-secret-hygiene.md) |
| `TASK-007` — Freeze/review/reindex working tree critical | **DONE** — Reviewer v1 REJECTED (`IN_SCOPE_FIX`), Coder fix `9542347`, Reviewer v2 APPROVED, QA PASS 198/198; push `c93649e..9542347` | [`completed/TASK-007`](completed/TASK-007-freeze-review-reindex.md) · [`review`](reviews/TASK-007-review-2026-11-05.md) · [`qa`](reviews/TASK-007-qa-2026-11-05.md) |

## 5. Commit / push evidence

- `261e9b7` — `chore(security): add secret scanning and document TASK-001 remediation` (7 file).
- `f22cf96` — `test(security): cover remaining secret scanner rules and history assertion` (1 file).
- `26a9d46` — `ci(security): scan full git history for secrets` (1 file, +5 dòng).
- `4d16d41` — `feat(security): add staged-index secret scan mode` (4 file, +79/−1).
- `c93649e` — `docs(security): record TASK-001 remediation evidence and close B9 (TASK-032)`.
- `cc605f9` — `chore(security): ignore .mcp.json and remove stale local agents ref (TASK-035)` (3 file, +8/−1).
- `9542347` — `fix(config): restore documented TASK-007 runtime values` (1 file, +4/−4: `ovrMin=118`, `maxPriceBP=888888`, `minRatio=74`, `purchaseTimeoutSeconds=3600`).
- `7f9291b` — đã trên `origin/main`; chứa phần lõi `scanStaged()` + T1–T5 (và runtime fixes TASK-007 ngoài phạm vi).
- Remote `main` = local `main` = `9542347` (`git rev-list --left-right --count` → `0 0`).
- QA TASK-007 vòng 2: worktree tại `cc605f9` + blob config `9542347` → **198/198**, `scan:secrets`/`scan:staged` pass.

## 6. Gate để đóng TASK-001

- [x] `scan:history` pass **0 finding** trên remote và fresh clone (local fail do ref `refs/agents/*` — F1 ngoài scope).
- [x] Remote sạch; fresh clone không còn `debug/trade-bulk.html` hoặc `debug/*.png`.
- [x] Patch TASK-001 đã commit (`261e9b7`) và push.
- [x] Deletion của artifact đã được xác minh trên fresh clone.
- [x] Scanner có test (21/21) và history-leak assertion.
- [x] CI có history scan blocking (`TASK-028`, `26a9d46`).
- [x] Scanner đọc staged blob/index (`TASK-030`, `4d16d41`).
- [x] Evidence/status + security sign-off (`TASK-032`).
- [x] F1/F2 (`TASK-035` DONE, `cc605f9`) — mở khóa TASK-001 Reviewer re-review + QA pass.
- [x] `npm run check` tại `9542347` = **198/198** (QA TASK-007 vòng 2, worktree sạch).

## 7. STOP CONDITION

**STOP CONDITION: NO** — `TASK-007` đã DONE và remote đồng bộ, nhưng `TASK-039` chưa Review/QA và `TASK-001` chưa re-review.

- `TASK-039` đã đủ điều kiện mở; cần Reviewer + QA trên diff ICON trước khi `READY_FOR_COMMIT`.
- `TASK-001` cần Reviewer re-review + QA pass trước khi DONE.
- Quyết định tài chính `maxPriceBP 888888` / `purchaseTimeoutSeconds 0` vẫn chờ Owner (TASK-003).
