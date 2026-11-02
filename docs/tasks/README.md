# Task Board — FO4-Agent

- **Cập nhật:** 2026-11-02 (TASK-027/033 committed; TASK-026 force-push DONE; TASK-025 Accepted Risk; TASK-031 DONE; TASK-028/030 READY; TASK-007 AUTHORIZATION_REQUIRED)
- **Người lập:** Planner Agent; cập nhật bởi Manager Agent
- **Nguồn:** `docs/backlog.md` + `docs/roadmap.md`
- **Quy ước:**
  - `P0` = Critical, phải đóng trước khi live.
  - `P1` = Important, đóng trong 2–4 tuần.
  - `P2` = Improvement, cải thiện liên tục.
  - `Risk`: Low / Medium / High / Critical.
  - `Effort`: S (≤ 1 ngày), M (2–3 ngày), L (≥ 1 tuần).

## 1. Bảng task tổng hợp

| ID | Priority | Mục tiêu | File ảnh hưởng chính | Risk | Effort | Dependency | Test plan tóm tắt |
|---|---|---|---|---|---|---|---|
| TASK-001 | P0 | Xóa debug artifact khỏi git history, chặn lộ endpoint/token, thêm secret scan | `.gitignore`, `debug/`, git history | High | M | TASK-007 | Git history scan, secret scan, fresh clone check |
| TASK-002 | P0 | Purchase journal + idempotency + reconcile khi restart | `features/agent-log.js`, `features/controller.js`, `features/buy/cycle.js`, `features/icon-buy/order.js` | High | L | TASK-007 | Crash/restart, duplicate order, audit BP |
| TASK-003 | P0 | Hard cap BP theo run/ngày + dry-run + confirmation gate | `config.json`, `features/config.js`, `features/buy/cycle.js`, `features/icon-buy/runner.js`, `features/upgrade/runner.js` | High | M | TASK-007; TASK-002 (Stage B) | Cap exceeded, dry-run, live guard |
| TASK-004 | P0 | Graceful shutdown, đóng browser, dừng worker, flush log | `agent.js`, `features/controller.js`, `lib/browser-session.js` | High | M | TASK-007 | SIGINT/SIGTERM, child process, log flush |
| TASK-005 | P0 | Worker state machine + lock/lease + startup reconcile | `features/controller.js`, `features/buy/cycle.js`, `lib/ui-lock.js` | High | L | TASK-002, TASK-007 | Double-start, restart, concurrent icon/buy |
| TASK-006 | P0 | Config single source of truth + schema + README parity | `config.json`, `features/config.js`, `README.md` | High | M | TASK-007 | Schema validation, README/config parity |
| TASK-007 | P0 | Freeze/review/reindex working tree critical | Toàn bộ working tree | Critical | S | — | `npm run check`, `cortex_detect_changes`, reindex |
| TASK-008 | P1 | Tách `controller.js` thành module nhỏ | `features/controller.js`, `features/controller/*` | Medium | L | TASK-005, TASK-007 | Smoke 6 lệnh + 5 recovery, behavior diff |
| TASK-009 | P1 | Shared mini-app layer cho Buy/Upgrade | `features/buy/mini-app.js`, `features/upgrade/mini-app.js`, `features/menu-request.js` | Medium | L | TASK-008 | Contract test cả 2 feature |
| TASK-010 | P1 | Central selector + versioned bot-message contract | `features/telegram-io.js`, `features/icon-buy/tasks.js`, `lib/bot-patterns.js` | Medium | M | TASK-009 | Parser 3 phiên bản text, selector fallback |
| TASK-011 | P1 | Error taxonomy + recovery matrix | `lib/bot-signals.js`, `features/controller.js`, runners | Medium | M | TASK-008 | Mỗi error map đúng action/retryability |
| TASK-012 | P1 | Inject `ChatSession`/`AgentContext`, bỏ global singleton | `lib/chat-state.js`, `lib/chat-runtime.js`, feature modules | Medium | L | TASK-008 | Hai session độc lập, không leak state |
| TASK-013 | P1 | Fake Page/ChatSession harness + integration test | Test files, `lib/chat-observer.js` | Medium | L | TASK-008, TASK-012 | Controller/session/recovery integration |
| TASK-014 | P1 | CI check + lint + test + secret scan + dependency audit | `.github/workflows/`, `package.json` | Low | M | TASK-001, TASK-007 | PR gate, secret scan, audit |
| TASK-015 | P1 | Catch/log hygiene | `features/telegram-io.js`, `features/upgrade/mini-app.js`, `lib/chat-runtime.js` | Medium | M | TASK-011 | Unexpected error phải log/rethrow |
| TASK-016 | P1 | PII-safe logging + retention | `features/agent-log.js`, `features/buy/cycle.js`, `features/icon-buy/tasks.js` | High | M | TASK-014 | Redaction, retention, log rotation |
| TASK-017 | P1 | Harden UI lock: timeout/ownership/cancellation | `lib/ui-lock.js`, `features/icon-buy/order.js`, `features/controller.js` | High | M | TASK-005 | Abort, reload, deadlock, FIFO |
| TASK-018 | P2 | Dead code/compat shim/zero-caller cleanup | `features/chat-state.js`, `features/control-commands.js`, `features/autobuy.js`, `features/autonangcap.js` | Low | S | TASK-007 | Zero-importer grep, test pass |
| TASK-019 | P2 | File lớn/barrel export/type contract | `features/upgrade/mini-app.js`, `features/buy/index.js`, `features/upgrade/index.js` | Low | L | TASK-008, TASK-009 | Public API check, typecheck |
| TASK-020 | P2 | Debug script/artifact hygiene | `debug/`, `.gitignore`, `tools/` | Medium | S | TASK-001 | No tracked artifacts, live guard |
| TASK-021 | P2 | Observability + runbook + ADR | `features/agent-log.js`, `docs/runbook.md`, `docs/decisions.md` | Low | M | TASK-014 | Trace one cycle, recovery drill |
| TASK-022 | P2 | Dependency audit + lint/format | `package.json`, ESLint/Prettier config, Dependabot | Low | S | TASK-014 | Audit, lint gate |
| TASK-023 | P2 | Timeout/config centralization | `config.json`, `features/config.js`, runners | Low | M | TASK-006 | Config override, no magic timeout |
| TASK-024 | P0 | Rewrite git history xóa `debug/trade-bulk.html` và 10 ảnh debug | git history, `debug/trade-bulk.html`, `debug/*.png` | Critical | M | TASK-007, TASK-027 | `scan:history` 0 finding, `git fsck`, `rev-list` |
| TASK-025 | P0 | Rotate/revoke credential, token, session có thể đã lộ | Secret store, cấu hình môi trường, incident note | Critical | S–M | TASK-001 evidence | Credential cũ bị từ chối, credential mới hoạt động |
| TASK-026 | P0 | Force-push lịch sử sạch, re-clone, fresh-clone verification | Remote branch, fresh clone, incident note | High | M | TASK-024, TASK-027 | Fresh clone `scan:history` pass, team re-clone |
| TASK-027 | P0 | Freeze repo và cô lập patch TASK-001 khỏi thay đổi runtime | `.gitignore`, `package.json`, `scripts/`, `.github/`, docs, deletion | High | S | TASK-007 | Staged diff chỉ chứa file TASK-001 |
| TASK-028 | P0 | Thêm history secret scan vào CI | `.github/workflows/security.yml`, `package.json`, `scripts/check-secrets.js` | High | S | TASK-024, TASK-026 | `fetch-depth: 0`, `scan:history` blocking |
| TASK-029 | P1 | Unit + negative test cho secret scanner (**DONE** — hoàn thiện qua task remediation `TASK-033`) | `scripts/check-secrets.test.js`, `scripts/check-secrets.js` | High | M | TASK-001 partial patch | Endpoint/token/private key/binary/history case |
| TASK-030 | P1 | Scan staged blob/index thay vì chỉ working tree | `scripts/check-secrets.js`, test | Medium | S–M | TASK-033 | Stage secret rồi xóa working tree vẫn fail |
| TASK-031 | P1 | Stage deletion của artifact atomically | `debug/trade-bulk.html`, `debug/*.png`, index | Medium | S | TASK-024, TASK-027 | `git ls-files debug/*.html debug/*.png` rỗng |
| TASK-032 | P2 | Đóng remediation, cập nhật trạng thái và lưu evidence | `docs/tasks/`, `docs/backlog.md`, `docs/roadmap.md`, incident, review | Low | S | TASK-024 → TASK-031 | Docs nhất quán, checklist 100%, sign-off |
| TASK-033 | P1 | Complete secret scanner negative coverage (remediation TASK-029 — **DONE**, commit `f22cf96`) | `scripts/check-secrets.test.js` | Medium | S | TASK-029 | Bearer/AWS/GitHub/Slack/Telegram negative case + history assert |
| TASK-034 | P0 | Authorization request — TASK-025/TASK-026 (**DONE** — authorization-2026-11-02 APPROVED) | `docs/completed/TASK-034-authorization-request-security-remediation.md` | Critical/High | S | TASK-025/026 | Human approval gate — PASS |

## 2. Task P0 chi tiết

### TASK-001 — Security cleanup

- **Mục tiêu:** Loại bỏ `debug/trade-bulk.html` và ảnh debug khỏi working tree và git history; chặn tái phát; bảo vệ endpoint/token nội bộ.
- **File ảnh hưởng:** `.gitignore`, `debug/trade-bulk.html`, `debug/*.png`, lịch sử git, CI secret scan.
- **Risk:** High.
- **Effort:** M.
- **Dependency:** TASK-007.
- **Test plan:** Git history scan; secret scan; fresh clone; xác nhận runtime test không phụ thuộc artifact.
- **Chi tiết:** [`TASK-001-security-cleanup.md`](TASK-001-security-cleanup.md)

### TASK-002 — Persistent purchase journal

- **Mục tiêu:** Ghi state mua bền vững, có idempotency key và reconcile khi startup.
- **File ảnh hưởng:** `features/agent-log.js`, `features/controller.js`, `features/buy/cycle.js`, `features/icon-buy/order.js`, module state mới.
- **Risk:** High.
- **Effort:** L.
- **Dependency:** TASK-007.
- **Test plan:** Kill giữa chu kỳ; restart; kiểm tra không tạo đơn trùng; audit BP theo cycle/ngày.
- **Chi tiết:** [`TASK-002-persistent-purchase-journal.md`](TASK-002-persistent-purchase-journal.md)

### TASK-003 — Financial hard caps

- **Mục tiêu:** Hard cap BP theo run/ngày, dry-run mặc định, confirmation gate cho live purchase.
- **File ảnh hưởng:** `config.json`, `features/config.js`, `features/buy/cycle.js`, `features/icon-buy/runner.js`, `features/upgrade/runner.js`, `debug/run-icon-live.js`.
- **Risk:** High.
- **Effort:** M.
- **Dependency:** TASK-007; TASK-002 (Stage B).
- **Test plan:** Vượt cap dừng cứng; dry-run không gửi lệnh; live guard không dùng nhầm profile.
- **Chi tiết:** [`TASK-003-financial-hard-caps.md`](TASK-003-financial-hard-caps.md)

### TASK-004 — Graceful shutdown

- **Mục tiêu:** Bắt SIGINT/SIGTERM/uncaught, đóng Playwright context, dừng worker do agent sở hữu, flush log.
- **File ảnh hưởng:** `agent.js`, `features/controller.js`, `lib/browser-session.js`.
- **Risk:** High.
- **Effort:** M.
- **Dependency:** TASK-007.
- **Test plan:** Ctrl+C; SIGTERM; crash giả lập; kiểm tra process con, browser, log.
- **Chi tiết:** [`TASK-004-graceful-shutdown.md`](TASK-004-graceful-shutdown.md)

### TASK-005 — Worker state machine/lock/lease

- **Mục tiêu:** Thay suy luận chat text bằng state machine + lock/lease + reconcile.
- **File ảnh hưởng:** `features/controller.js`, `features/buy/cycle.js`, `lib/ui-lock.js`, module state mới.
- **Risk:** High.
- **Effort:** L.
- **Dependency:** TASK-002, TASK-007.
- **Test plan:** 2 instance; restart khi worker đang chạy; concurrent icon/buy; không double-start.
- **Chi tiết:** [`TASK-005-worker-state-lock.md`](TASK-005-worker-state-lock.md)

### TASK-006 — Config single source of truth

- **Mục tiêu:** Một nguồn cấu hình duy nhất; schema/range; README parity; fail-fast.
- **File ảnh hưởng:** `config.json`, `features/config.js`, `README.md`, test config.
- **Risk:** High.
- **Effort:** M.
- **Dependency:** TASK-007.
- **Test plan:** Config sai bị reject; README/config parity; icon batch/targetGrade đúng.
- **Chi tiết:** [`TASK-006-config-single-source.md`](TASK-006-config-single-source.md)

### TASK-007 — Freeze/review/reindex working tree critical

- **Mục tiêu:** Đưa thay đổi critical hiện tại vào review, commit theo nhóm nhỏ, reindex Cortex.
- **Status:** **AUTHORIZATION_REQUIRED** — TASK-001 patch đã commit/push (`261e9b7`, `f22cf96`); runtime fixes (`config.json`, `features/upgrade/loop.js`, `features/upgrade/runner.js`) chưa commit; fresh clone `npm run check` 188/190. Cần Owner Decision + review độc lập.
- **File ảnh hưởng:** Toàn bộ working tree.
- **Risk:** Critical.
- **Effort:** S.
- **Dependency:** —.
- **Test plan:** `npm run check`; `cortex_detect_changes`; reindex; fresh review từng nhóm.
- **Chi tiết:** [`TASK-007-freeze-review-reindex.md`](TASK-007-freeze-review-reindex.md)

## 2.1 Remediation TASK-001 — B1–B9

TASK-001 bị **REJECTED** ngày 2026-10-31 với 9 blocker. Mỗi blocker đã được chuyển thành một task riêng:

| Blocker | Task | Mục tiêu | Dependency |
|---|---|---|---|
| B1 — History còn artifact | [`TASK-024`](../completed/TASK-024-rewrite-git-history.md) | Rewrite git history, `scan:history` pass 0 finding — **DONE + pushed** | TASK-007, TASK-027 |
| B2 — Credential chưa rotate | [`TASK-025`](../completed/TASK-025-rotate-credentials.md) | **ACCEPTED RISK APPROVED** — no active production credential; no rotation required | TASK-001 evidence |
| B3 — Chưa force-push/re-clone | [`TASK-026`](../completed/TASK-026-force-push-fresh-clone.md) | Force-push lịch sử sạch, fresh-clone verification — **DONE** (`f22cf96`) | TASK-024, TASK-027 |
| B4 — Patch không cô lập | [`TASK-027`](../completed/TASK-027-isolate-patch-freeze.md) | Freeze repo, backup, cô lập patch TASK-001 — **DONE** (`261e9b7`) | TASK-007 |
| B5 — CI chưa scan history | [`TASK-028`](TASK-028-ci-history-scan.md) | `fetch-depth: 0` + `scan:history` blocking gate — **READY** | TASK-024, TASK-026 |
| B6 — Thiếu test scanner | [`TASK-029`](../completed/TASK-029-secret-scanner-tests.md) | Unit + negative test cho scanner — **DONE** (qua `TASK-033`, 13/13) | TASK-001 partial patch |
| B7 — Scanner đọc working tree | [`TASK-030`](TASK-030-scan-staged-blobs.md) | Scan staged blob/index — **READY** | TASK-029, TASK-033 |
| B8 — Deletion chưa stage | [`TASK-031`](../completed/TASK-031-stage-artifact-deletions.md) | Deletion verified trong history + fresh clone — **DONE** | TASK-024, TASK-027 |
| B9 — Thiếu cập nhật trạng thái | [`TASK-032`](TASK-032-close-remediation.md) | Đóng evidence, cập nhật docs, sign-off — **BLOCKED** (B5, B7) | TASK-024 → TASK-031 |

**Thứ tự còn lại:** `TASK-028` → `TASK-030` → `TASK-032` → TASK-001 re-review + QA.

**Gate:** commit chỉ khi task = `COMMIT_AUTHORIZED`; không merge/release/live TASK-001 cho đến khi B1–B9 đóng và có security sign-off.

## 3. Task P1/P2 — ghi chú thực thi

- P1 task nên chạy sau khi P0 đóng; không mở feature mới trong lúc P0 còn mở.
- P2 task có thể chạy song song nếu không chạm file của P0/P1 đang active.
- Mỗi task phải có:
  1. Mô tả thay đổi.
  2. File ảnh hưởng.
  3. Test plan.
  4. Rollback.
  5. Cập nhật Cortex index sau khi merge.

## 4. Task ưu tiên hiện tại

**CURRENT TASK: `TASK-028` — CI history scan (READY, P0).**

Trạng thái 2026-11-02:

- **TASK-027 DONE** — commit `261e9b7`, 7 file.
- **TASK-033 DONE** — commit `f22cf96`, 13/13 test.
- **TASK-026 DONE** — force-push `42d3555...f22cf96`; fresh clone sạch artifact; `scan:secrets`/`scan:history` pass.
- **TASK-025 DONE** — Accepted Risk Approved (no active production credential; no rotation required).
- **TASK-031 DONE** — deletion verified trong history + fresh clone.
- **TASK-024 DONE** — history sạch, đã push.
- **TASK-029 DONE** — hoàn thiện qua TASK-033.
- **TASK-034 DONE** — authorization-2026-11-02 APPROVED.
- **TASK-028 READY** — CI history scan (P0).
- **TASK-030 READY** — staged-blob scan (P1).
- **TASK-032 BLOCKED** — chờ TASK-028/TASK-030.
- **TASK-007 AUTHORIZATION_REQUIRED** — runtime fixes chưa commit; fresh clone `npm run check` 188/190; cần Owner Decision + review.
- **TASK-001** vẫn **BLOCKED** cho đến khi B1–B9 đóng + re-review.

Thứ tự: `TASK-028` → `TASK-030` → `TASK-032` → TASK-001 re-review + QA.

**STOP CONDITION: NO** — còn task READY và task cần Owner Decision.

Kế hoạch gốc và test plan chi tiết nằm trong [`TASK-001-security-cleanup.md`](TASK-001-security-cleanup.md); review record nằm trong [`docs/reviews/TASK-001-review-2026-10-31.md`](../reviews/TASK-001-review-2026-10-31.md).

- Review TASK-027: [`docs/reviews/TASK-027-review-2026-11-01.md`](../reviews/TASK-027-review-2026-11-01.md)
- QA TASK-027: [`docs/reviews/TASK-027-qa-2026-11-01.md`](../reviews/TASK-027-qa-2026-11-01.md)

**Cortex plan quality:** iteration 1 đạt 7.6/10; iteration 2 đạt **8.8/10 — APPROVED**.
