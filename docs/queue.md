# Current Queue

- **Cập nhật:** 2026-11-16 (Cycle v7 — gộp nhận ICON vào lần mở TTCN của monitor)
- **Branch làm việc:** `ai/auto-cycle-v7` — **không đụng `main`**
- **Sprint:** Cycle v7 — tối ưu chống spam TTCN (bỏ nhịp mở mini-app riêng chỉ để nhận ICON)
- **Company Status:** **CYCLE v7 COMPLETE** — 1 task DONE (TASK-056); Reviewer APPROVED + QA PASS; Gate A (89/100)
- **Active Task:** _(không có — cycle v7 đã đóng)_
- **Current Focus:** Theo dõi PR của `ai/auto-cycle-v7`; follow-up không chặn: mock frame cho `checkInventoryIcons`, cuộn tới card nếu mini-app virtualize DOM
- **Repo:** branch `ai/auto-cycle-v7` tách từ `main` `258e4af`; push nhánh phụ để tạo PR, **không push `main`**
- **Freeze:** Không merge/release/live. Commit chỉ trên nhánh cycle.
- **Security Risk Acceptance:** TASK-025 — **ACCEPTED RISK APPROVED**; TASK-026 — **APPROVED** (force push executed, lịch sử cũ).
- **Residual risk:** `npm test` **386/386** trên nhánh cycle. TTCN chỉ mở một lần mỗi kỳ monitor (hủy + nhận chung); ICON khớp được nhận trong kỳ kế tiếp (tối đa 15 phút) thay vì 2 phút.
- **Owner Decision (2026-11-15):** `TASK-003 Stage B` và `TASK-039` → **WONT_DO** — Owner xác nhận không có nhu cầu triển khai; **không nhắc lại ở các cycle sau**.

## 0. Cycle 2026-11-16 v7 — Gộp nhận ICON vào lần mở TTCN của monitor (COMPLETE)

| Task | Nội dung | Trạng thái | Gate | Record |
|---|---|---|---|---|
| `TASK-056` | Một lần mở TTCN vừa hủy đơn "Hủy" vừa quét/nhận ICON "Nhận"; bỏ nhịp 2 phút/10 phút | **DONE** | A (89/100) | [completed](completed/TASK-056-merge-receive-into-monitor-ttcn.md) |

Tổng kết cycle: [`docs/completed/CYCLE-2026-11-16-v7.md`](completed/CYCLE-2026-11-16-v7.md).

## 0y. Cycle 2026-11-16 v6 — ICON/TTCN live bug fix (COMPLETE)

| Task | Nội dung | Trạng thái | Gate | Record |
|---|---|---|---|---|
| `TASK-053` | Hủy TTCN theo `orderId`; xóa đơn 27 không làm lệch/bỏ sót đơn 4 | **DONE** | A (88/100) | [completed](completed/TASK-053-ttcn-pending-order-rescan.md) |
| `TASK-054` | Quét toàn bộ TTCN; nhận ICON "Nhận"; loại PHÔI "Nhận" | **DONE** | A (88/100) | [completed](completed/TASK-054-ttcn-icon-receive-scan.md) |
| `TASK-055` | Nhận ICON xong tự chuyển mua phôi + nâng cấp | **DONE** | A (88/100) | [completed](completed/TASK-055-icon-receive-auto-pivot.md) |

Tổng kết cycle: [`docs/completed/CYCLE-2026-11-16-v6.md`](completed/CYCLE-2026-11-16-v6.md).

## 0z. Cycle 2026-11-15 v5 — Reliability + Architecture + Integration tests (COMPLETE)

| Task | Nội dung | Trạng thái | Gate | Record |
|---|---|---|---|---|
| `TASK-050` | Fail-closed khi `agent.lock` hỏng + quarantine `.corrupt-<ISO>` + runbook | **DONE** | A (93/100) | [completed](completed/TASK-050-agent-lock-corruption.md) |
| `TASK-051` | Hợp nhất `validateOvrSpec` + `parseOvrList` về `lib/ovr-spec.js` | **DONE** | A (91/100) | [completed](completed/TASK-051-unify-ovr-spec.md) |
| `TASK-052` | Integration test hành vi cho nhánh thiếu (Company Cycle scan v5) | **DONE** | A (94/100) | [completed](completed/TASK-052-scan-integration-tests.md) |

Tổng kết cycle: [`docs/completed/CYCLE-2026-11-15-v5.md`](completed/CYCLE-2026-11-15-v5.md).

## 0a. Cycle 2026-11-14 v4 — Company Cycle scan (COMPLETE)

| Task | Nội dung | Trạng thái | Gate | Record |
|---|---|---|---|---|
| `TASK-045` | Mock Playwright/Telegram + integration test vòng buy & nhánh ICON rủi ro cao | **DONE** | A (95/100) | [completed](completed/TASK-045-buy-integration-test.md) |
| `TASK-046` | Vá lỗ hổng validate config (`monitorExistingOrders`, `ovrPhoi`, `maxPriceEach`) | **DONE** | A (94/100) | [completed](completed/TASK-046-config-validation-gaps.md) |
| `TASK-047` | Fail-closed khi `workers.json` hỏng + quarantine | **DONE** | A (95/100) | [completed](completed/TASK-047-corrupt-worker-state.md) |
| `TASK-048` | `worker:resolve --dry-run` + xử lý lỗi một phần | **DONE** | A (97/100) | [completed](completed/TASK-048-resolve-dry-run.md) |
| `TASK-049` | Gom validator dùng chung `lib/config-validators.js` | **DONE** | A (93/100) | [completed](completed/TASK-049-shared-config-validators.md) |

Tổng kết cycle: [`docs/completed/CYCLE-2026-11-14-v4.md`](completed/CYCLE-2026-11-14-v4.md).

## 0b. Cycle 2026-11-14 v3 — Security closure + Operations (COMPLETE)

| Task | Nội dung | Trạng thái | Gate | Record |
|---|---|---|---|---|
| `TASK-044` | CLI `resolve-worker` cho worker `unknown`, chặn khi agent còn sống | **DONE** (`fbc3a43`) | A (96/100) | [completed](completed/TASK-044-resolve-worker-cli.md) |
| `TASK-043` | Integration test process lock với 2 process thật | **DONE** | A (94/100) | [completed](completed/TASK-043-process-lock-integration.md) |
| `TASK-032` | Đóng remediation TASK-001 + evidence (review/QA đã có từ 2026-11-04) | **DONE** | — | [completed](completed/TASK-032-close-remediation.md) |
| `TASK-001` | Security cleanup — re-review + QA, đóng P0 | **DONE** | A (92/100) | [completed](completed/TASK-001-security-cleanup.md) |
| `TASK-039` | ICON refactor — retro review/QA; `purchaseTimeoutSeconds = 0` | **WONT_DO** (Owner 2026-11-15) | — | [request](authorizations/authorization-request-2026-11-14-task-039.md) |
| `TASK-045` | Integration test vòng buy + nhánh ICON rủi ro cao | **BLOCKED** ở v3 → **DONE** ở v4 | A (95/100) | [completed](completed/TASK-045-buy-integration-test.md) |

Tổng kết cycle: [`docs/completed/CYCLE-2026-11-14-v3.md`](completed/CYCLE-2026-11-14-v3.md).

## 0c. Cycle 2026-11-13 v2 — Stage B (COMPLETE)

| Task | Nội dung | Trạng thái | Gate | Record |
|---|---|---|---|---|
| `TASK-005B` | Controller dùng `registry.reconcile()` làm source of truth; đăng ký worker buy/upgrade/icon | **DONE** (`d976b6d`) | B (82/100) | [completed](completed/TASK-005B-controller-registry-integration.md) |
| `TASK-004B` | Integration test SIGINT/SIGTERM process thật + README runbook | **DONE** (`65c0426`) | A (93/100) | [completed](completed/TASK-004B-signal-integration-runbook.md) |

Tổng kết cycle: [`docs/completed/CYCLE-2026-11-13-v2.md`](completed/CYCLE-2026-11-13-v2.md).

## 1. WONT_DO — Owner xác nhận 2026-11-15

| Task | Nội dung | Quyết định |
|---|---|---|
| `TASK-003 Stage B` | Nối spend-guard vào buy/icon/upgrade + đặt cap thật + live gate | **WONT_DO** — Owner không có nhu cầu triển khai; không nhắc lại ở các cycle sau |
| `TASK-039` | `purchaseTimeoutSeconds = 0` (chờ vô hạn) lệch baseline TASK-007 `3600` | **WONT_DO** — Owner chấp nhận hành vi hiện tại; không đổi tham số, không nhắc lại |

## 2. Authorization required

_(không còn — toàn bộ hạng mục từng chờ Owner đã chuyển WONT_DO ngày 2026-11-15)_

## 3. Follow-up — sau cycle v5

| Task | Nội dung | Nguồn | Trạng thái |
|---|---|---|---|
| `TASK-050` | Fail-closed khi `agent.lock` hỏng + quarantine `.corrupt-<ISO>` | TASK-047 §6.1 | **DONE** (v5) |
| `TASK-051` | Hợp nhất `parseOvrList` + `validateOvrSpec` về một nguồn chuẩn | TASK-049 §6.1 | **DONE** (v5) |
| `TASK-052` | Integration test hành vi cho nhánh thiếu do scan v5 phát hiện | Company Cycle scan v5 | **DONE** (v5) |
| `TASK-048-F1` | `worker:resolve --quarantine` dọn state/lock hỏng có kiểm soát | TASK-047 §6.2 / TASK-048 §6.1 / TASK-050 §6 | Chưa làm (không chặn) |
| `TASK-052-F1` | Mock frame/mini-app cho `checkInventoryIcons` retry + `INVENTORY_READ_UNCONFIRMED` | TASK-052 §6 | Chưa làm (không chặn) |

## 4. Done — 2026-11-13 (cycle v1)

| Task | Kết quả | Record |
|---|---|---|
| `TASK-004` — Graceful shutdown (Stage A) | **DONE** — commit `3b864e7`; 8 test lifecycle; QA PASS; Gate B | [`completed/TASK-004`](completed/TASK-004-graceful-shutdown.md) |
| `TASK-005` — Process lock + worker registry (Stage A) | **DONE** — commit `7fee795`; 10 test registry; QA PASS; Gate B | [`completed/TASK-005`](completed/TASK-005-worker-state-lock.md) |
| `TASK-003` — Spend guard (Stage A) | **DONE** — commit `767323f`; 13 test guard; QA PASS; Gate A | [`completed/TASK-003`](completed/TASK-003-financial-hard-caps.md) |

## 4b. Done — 2026-11-04 (trước cycle)

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

**STOP CONDITION: YES** — cycle v4 đã đóng 5 task sinh từ Company Cycle scan, toàn bộ Quality Gate A, `npm test` 343/343 và `scan:secrets`/`scan:history` pass.

Lý do dừng:

- **Đã đóng hết việc khả thi không cần Owner:** TASK-045 (unblock), TASK-046, TASK-047, TASK-048, TASK-049.
- **Chỉ còn chờ Owner Decision:** TASK-003 Stage B (bật hard cap/live gate) và TASK-039 (`purchaseTimeoutSeconds`). **Không tự đổi tham số tài chính.**
- **Follow-up không chặn:** `agent.lock` fail-closed, `--quarantine`, gom `parseOvrList`/`validateOvrSpec` — đã ghi §3 để cycle sau.
- Không merge/push `main`; toàn bộ thay đổi nằm trên `ai/auto-cycle-v4` và chỉ push nhánh này để tạo PR.
