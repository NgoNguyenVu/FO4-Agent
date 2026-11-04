# Current Queue

- **Cập nhật:** 2026-11-04
- **Sprint:** Security Remediation — TASK-001
- **Company Status:** **IN_PROGRESS — TASK-001** (B1–B8 đã đóng; còn B9)
- **Active Task:** `TASK-032` — **READY** (đóng remediation + evidence, P2)
- **Current Focus:** Đóng remediation + evidence; sau đó TASK-001 re-review + QA.
- **Repo:** local `main` = `4d16d41`; remote `main` = `26a9d46` (chưa push các commit local); history sạch artifact; CI đã có history gate blocking.
- **Freeze:** Không còn freeze chung. Commit chỉ khi task = `COMMIT_AUTHORIZED`; **không merge, release hoặc chạy live**.
- **Security Risk Acceptance:** TASK-025 — **ACCEPTED RISK APPROVED**; TASK-026 — **APPROVED** (force push executed).
- **Residual risk:** fresh clone/CI `npm run check` = **188/190** do runtime fixes của TASK-007 chưa commit. TASK-007 đang **AUTHORIZATION_REQUIRED**.

## 1. Ready — executable

| Thứ tự | Task | Priority | Status | Điều kiện |
|---:|---|---|---|---|
| 1 | `TASK-032` — Close remediation + evidence | P2 | **READY** | B5/B7 đã đóng; cập nhật TASK-001/incident/backlog/roadmap + security sign-off |

## 2. Authorization required

| Task | Priority | Trạng thái | Quyết định cần owner |
|---|---|---|---|
| `TASK-007` — Freeze/review/reindex working tree critical | P0 | **AUTHORIZATION_REQUIRED** | Cho phép commit/push runtime fixes (`config.json`, `features/upgrade/loop.js`, `features/upgrade/runner.js`) sau review độc lập; 2 test fresh clone fail vì các fix này chưa vào history |

## 3. Blocked

| Task | Priority | Blocked by | Điều kiện mở |
|---|---|---|---|
| `TASK-001` — Security cleanup | P0 | B9, TASK-007 | Evidence/sign-off + Reviewer re-review + QA pass; CI xanh phụ thuộc TASK-007 |

## 4. Done — 2026-11-02

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

## 5. Commit / push evidence

- `261e9b7` — `chore(security): add secret scanning and document TASK-001 remediation` (7 file).
- `f22cf96` — `test(security): cover remaining secret scanner rules and history assertion` (1 file).
- `26a9d46` — `ci(security): scan full git history for secrets` (1 file, +5 dòng).
- `4d16d41` — `feat(security): add staged-index secret scan mode` (4 file, +79/−1).
- `7f9291b` — local, chưa push: chứa phần lõi `scanStaged()` + T1–T5 (và runtime fixes TASK-007 ngoài phạm vi).
- Remote `main`: `26a9d46424aa121c0a65cef15e87d27e7cfe402f`; local `main`: `4d16d41` (chưa push).
- Fresh clone trước đó: `f22cf96` — `scan:secrets`/`scan:history` pass; `npm run check` 188/190 (TASK-007).

## 6. Gate để đóng TASK-001

- [x] `scan:history` pass **0 finding** trên remote và fresh clone (local fail do ref `refs/agents/*` — F1 ngoài scope).
- [x] Remote sạch; fresh clone không còn `debug/trade-bulk.html` hoặc `debug/*.png`.
- [x] Patch TASK-001 đã commit (`261e9b7`) và push.
- [x] Deletion của artifact đã được xác minh trên fresh clone.
- [x] Scanner có test (21/21) và history-leak assertion.
- [x] CI có history scan blocking (`TASK-028`, `26a9d46`).
- [x] Scanner đọc staged blob/index (`TASK-030`, `4d16d41`).
- [ ] Evidence/status + security sign-off (`TASK-032`).
- [ ] TASK-001 Reviewer re-review + QA pass.
- [ ] `npm run check` trên fresh clone/CI xanh — phụ thuộc TASK-007.

## 7. STOP CONDITION

**STOP CONDITION: NO** — còn task executable (`TASK-032`) và một task cần Owner Decision (`TASK-007`). Chưa thỏa đồng thời 3 điều kiện STOP của `.ai/company.md`.

- `TASK-032` là CURRENT TASK của chu kỳ này (READY).
- `TASK-001` chỉ đóng sau `TASK-032` + re-review + QA.
