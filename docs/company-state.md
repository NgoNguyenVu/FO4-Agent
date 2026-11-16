# Company State

- **Cập nhật:** 2026-11-16 (Cycle v7 — gộp nhận ICON vào lần mở TTCN của monitor)
- **Người cập nhật:** Manager Agent (Engineering Director)
- **Current Sprint:** Cycle v7 — tối ưu chống spam TTCN
- **Branch:** `ai/auto-cycle-v7` (tách từ `main` `258e4af`; push nhánh phụ để tạo PR, không đụng `main`)
- **Company Delivery Status:** **1 task DONE (cycle v7)** — TASK-056 (một lần mở TTCN vừa hủy "Hủy" vừa quét/nhận ICON "Nhận", bỏ nhịp mở riêng 2 phút/10 phút). Reviewer APPROVED + QA PASS; Gate A (89/100).
- **Active Cycle Status:** **CYCLE v7 COMPLETE** — `npm test` **386/386**; `scan:secrets` + `scan:history` pass.
- **Current Task:** _(không có)_ — cycle v7 đã đóng
- **Task Status:** **DONE (cycle v7)**
- **Reviewer:** **APPROVED** — TASK-056 — 2026-11-16
- **QA:** **PASS** — TASK-056 (386/386) — 2026-11-16
- **Parallel Security Task:** TASK-025 — **ACCEPTED RISK APPROVED** (không có credential production)
- **Blocked Task:** _(không có)_
- **Authorization Required:** _(không có)_
- **WONT_DO (Owner 2026-11-15):** `TASK-003 Stage B` (hard cap/live gate) và `TASK-039` (`purchaseTimeoutSeconds`) — Owner xác nhận không có nhu cầu triển khai; **không nhắc lại ở các cycle sau**.
- **Commit Allowed:** Chỉ khi task = `COMMIT_AUTHORIZED` (trên nhánh `ai/auto-cycle-v7`)
- **Push Allowed:** Chỉ nhánh `ai/*` (phục vụ PR); **không push `main`**
- **Merge Allowed:** NO
- **Live Run Allowed:** NO
- **Security Risk Acceptance:** TASK-025 — **APPROVED**; TASK-026 — **APPROVED** (force push lịch sử cũ).

## 0. Cycle 2026-11-16 v7 — Gộp nhận ICON vào lần mở TTCN của monitor

| Task | Deliverable | Trạng thái | Gate |
|---|---|---|---|
| `TASK-056` | `runTtcnMaintenance` + `maintainTtcnOrders`: một lần mở TTCN vừa hủy đơn vị trí xấu vừa quét/nhận ICON "Nhận"; xóa `RECEIVE_SCAN_INTERVAL_MS`/`scanReceivedIcons`; giữ pivot `iconReceivePivotPlan` + 4 test hành vi mới | **DONE** | A (89) |

Chi tiết: [`docs/completed/CYCLE-2026-11-16-v7.md`](completed/CYCLE-2026-11-16-v7.md).

## 0y. Cycle 2026-11-16 v6 — ICON/TTCN live bug fix

| Task | Deliverable | Trạng thái | Gate |
|---|---|---|---|
| `TASK-053` | Hủy TTCN theo `orderId`; đọc lại toàn bộ danh sách sau mỗi lần hủy; xóa đơn 27 không bỏ sót đơn 4 + 5 test | **DONE** | A (88) |
| `TASK-054` | Quét toàn bộ TTCN (cuộn + gộp trang); nhận ICON "Nhận"; loại PHÔI "Nhận" + 3 test | **DONE** | A (88) |
| `TASK-055` | `onIconReceived` → `iconReceivePivotPlan` → kiểm tra kho → mua phôi + nâng cấp + 2 test | **DONE** | A (88) |

Chi tiết: [`docs/completed/CYCLE-2026-11-16-v6.md`](completed/CYCLE-2026-11-16-v6.md).

## 0z. Cycle 2026-11-15 v5 — Reliability + Architecture + Integration tests

| Task | Deliverable | Trạng thái | Gate |
|---|---|---|---|
| `TASK-050` | `agent.lock` hỏng → quarantine `.corrupt-<ISO>` + `AGENT_LOCK_CORRUPT` + 9 test + runbook | **DONE** | A (93) |
| `TASK-051` | `lib/ovr-spec.js` dùng chung cho config + runtime parser + 6 test | **DONE** | A (91) |
| `TASK-052` | Integration test hành vi cho nhánh thiếu (scan v5) + 16 test | **DONE** | A (94) |

Chi tiết: [`docs/completed/CYCLE-2026-11-15-v5.md`](completed/CYCLE-2026-11-15-v5.md).

## 0a. Cycle 2026-11-14 v4 — Company Cycle scan

| Task | Deliverable | Trạng thái | Gate |
|---|---|---|---|
| `TASK-045` | `lib/__fixtures__/mock-playwright.js`, `mock-telegram.js`, `lib/buy-worker-lifecycle.integration.test.js` (13 test) | **DONE** | A (95) |
| `TASK-046` | Validate `monitorExistingOrders`, `ovrPhoi`, `maxPriceEach` + 6 test | **DONE** | A (94) |
| `TASK-047` | `WORKER_STATE_CORRUPT` + quarantine `.corrupt-<ISO>` + 6 test | **DONE** | A (95) |
| `TASK-048` | `--dry-run`, `resolveWorkers()`, `restoreProcessBlock()` + 6 test | **DONE** | A (97) |
| `TASK-049` | `lib/config-validators.js` + 6 test; config/spend-guard dùng chung | **DONE** | A (93) |

Chi tiết: [`docs/completed/CYCLE-2026-11-14-v4.md`](completed/CYCLE-2026-11-14-v4.md).

## 0b. Cycle 2026-11-14 v3 — Security closure + Operations

| Task | Deliverable | Trạng thái | Gate |
|---|---|---|---|
| `TASK-044` | `scripts/resolve-worker.js` + 14 test; chặn resolve khi agent còn sống | **DONE** (`fbc3a43`) | A (96) |
| `TASK-043` | Integration test process lock với 2 process thật | **DONE** | A (94) |
| `TASK-032` | Đóng remediation TASK-001 + evidence | **DONE** | — |
| `TASK-001` | Security cleanup re-review + QA | **DONE** | A (92) |
| `TASK-039` | Retro review/QA ICON; chờ Owner `purchaseTimeoutSeconds` | **AUTHORIZATION_REQUIRED** | C |
| `TASK-045` | Integration test vòng buy + nhánh ICON rủi ro cao | **BLOCKED** | — |

Chi tiết: [`docs/completed/CYCLE-2026-11-14-v3.md`](completed/CYCLE-2026-11-14-v3.md).

## 0c. Cycle 2026-11-13 v2 — Stage B

| Task | Deliverable | Trạng thái | Commit | Gate |
|---|---|---|---|---|
| `TASK-005B` | Shared registry + `lib/worker-session.js`; controller reconcile/đăng ký worker buy–upgrade–icon | **DONE** | `d976b6d` | B (82) |
| `TASK-004B` | Integration test process-level SIGINT/SIGTERM + README runbook | **DONE** | `65c0426` | A (93) |

Chi tiết: [`docs/completed/CYCLE-2026-11-13-v2.md`](completed/CYCLE-2026-11-13-v2.md).

## 0d. Cycle 2026-11-13 v1 — tóm tắt

| Task | Deliverable | Commit | Gate |
|---|---|---|---|
| `TASK-004` | `lib/lifecycle.js` + wire `agent.js`/`controller.js`; heartbeat; signal + cleanup idempotent | `3b864e7` | B (83) |
| `TASK-005` | `lib/worker-registry.js` + process lock/heartbeat; config `worker` | `7fee795` | B (84) |
| `TASK-003` | `lib/spend-guard.js` + config `spendLimits`/`liveTrading` (chưa enforcement) | `767323f` | A (90) |

Chi tiết: [`docs/completed/CYCLE-2026-11-13.md`](completed/CYCLE-2026-11-13.md).

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
| Engineering | **Ổn định, đã hardening thêm** | Cycle v6 sửa 3 lỗi live ICON/TTCN; không merge/release/live |
| Security | **Đã đóng remediation** | TASK-001 DONE; history sạch; scan:secrets/staged/history pass |
| Release | **Blocked** | Không chạy live, không merge thay đổi lớn |
| Task board | **Cycle v6 COMPLETE — 3 task DONE** | TASK-053 (hủy TTCN), TASK-054 (nhận ICON), TASK-055 (pivot phôi + nâng). WONT_DO: TASK-003 Stage B, TASK-039. |
| Bàn giao tiếp theo | Mock frame cho `checkInventoryIcons` (TASK-052-F1) | Không chặn |

## 4b. Quyết định của Owner — 2026-11-15

- `TASK-003 Stage B` → **WONT_DO**: Owner xác nhận không có nhu cầu bật hard cap/live gate.
- `TASK-039` → **WONT_DO**: Owner chấp nhận `purchaseTimeoutSeconds = 0`; không đổi tham số.
- Hai hạng mục trên **không nhắc lại ở các cycle sau**.

## 5. Quyết định của Manager — 2026-11-04

- **TASK-030 commit gate:** Reviewer **APPROVED** + QA **PASS**; Standard Task (không force-push/credential/history rewrite) → `READY_FOR_COMMIT → COMMIT_AUTHORIZED → DONE`.
- **Commit `4d16d41`** chỉ gồm 4 file TASK-030: `package.json`, `.github/workflows/security.yml`, `scripts/check-secrets.test.js`, `README.md`. Phần lõi `scanStaged()` + T1–T5 đã nằm trong commit local `7f9291b`; **không rewrite history** vì chưa có Owner Decision.
- **TASK-032:** **DONE** — Review APPROVED + QA PASS, evidence + security sign-off recorded 2026-11-04.
- **F1 (HIGH):** local ref `refs/agents/*` chứa Bearer token khiến `scan:history` local fail — **TASK-035 (READY)** đóng (xóa stale ref; không cần Owner Decision vì local-only).
- **F2 (HIGH):** `.mcp.json` untracked chứa Bearer key và chưa được ignore; `git add -A` sẽ commit key — **TASK-035 (READY)** đóng (`.gitignore` + local config).
- **TASK-007:** **DONE** (2026-11-05) — Reviewer vòng 1 REJECTED `IN_SCOPE_FIX` (config regression trong `7f9291b`); Coder fix bằng commit `9542347` (`ovrMin=118`, `maxPriceBP=888888`, `minRatio=74`, `purchaseTimeoutSeconds=3600`); Reviewer vòng 2 **APPROVED**, QA **PASS** 198/198; push `c93649e..9542347`.
- **TASK-035:** **DONE** — `cc605f9`; F1/F2 đóng.

## 6. Next Action

1. **Theo dõi PR** của `ai/auto-cycle-v6` (không merge vào `main` khi chưa có quyết định).
2. **Follow-up không chặn:** mock frame cho `checkInventoryIcons` (TASK-052-F1); nếu mini-app virtualize DOM thì cuộn tới card trước khi click.
3. **Không nhắc lại:** TASK-003 Stage B và TASK-039 (WONT_DO từ 2026-11-15).

**STOP CONDITION: YES** — cycle v6 đóng 3 task (Gate A, 382/382 test, scan pass). Chỉ còn follow-up không chặn.
