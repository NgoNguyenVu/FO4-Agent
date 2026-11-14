# Roadmap — FO4-Agent

- **Cập nhật:** 2026-11-14 (cycle v3 — đóng TASK-001/TASK-032/TASK-043/TASK-044; xem `docs/completed/CYCLE-2026-11-14-v3.md`)
- **Người lập:** Architect Agent; cập nhật bởi Manager Agent
- **Nguồn dữ liệu:** `docs/backlog.md` + Cortex MCP (`cortex_code_search`, `cortex_code_context`, `cortex_detect_changes`, `cortex_code_impact`).
- **Trạng thái:** Roadmap đề xuất, chưa cam kết ngày cứng. Thời lượng là ước tính cho một team nhỏ.

## 0. Cập nhật cycle 2026-11-14

### 0.1. Cycle v3 — Security closure + Operations (2026-11-14)

- **Đã xong:** TASK-044 (CLI resolve worker, `fbc3a43`, Gate A), TASK-043 (integration test process lock với 2 process thật, Gate A), TASK-032 (đóng remediation), TASK-001 (security cleanup re-review + QA, Gate A). `npm test` **306/306**.
- **Chờ Owner:** TASK-003 Stage B (hard cap/live gate); TASK-039 `purchaseTimeoutSeconds = 0`.
- **Blocked:** TASK-045 — cần harness Playwright/Telegram test và quyết định timeout.
- **Điều kiện:** không merge/push `main`; cycle v3 chỉ push `ai/auto-cycle-v3` để tạo PR.

### 0.2. Cycle v2 — Stage B (2026-11-13 → 2026-11-14)

- **Đã xong:** TASK-005 Stage B (controller dùng registry, `d976b6d`, Gate B) và TASK-004 Stage B (integration test process-level + runbook, `65c0426`, Gate A). `npm test` **288/288**.
- **Điều kiện:** không merge/push `main`; cycle v2 chỉ push `ai/auto-cycle-v2` để tạo PR.

### 0.3. Cycle v1 — Stage A (2026-11-13)

- **Đã xong:** TASK-004 (lifecycle/shutdown/heartbeat), TASK-005 (process lock + worker registry), TASK-003 (spend guard + config, chưa enforcement).

## 1. Architecture snapshot

### 1.1. Runtime flow hiện tại

```text
Telegram Web
   │
   ▼
lib/chat-observer + lib/chat-runtime
   │  command queue / chat text
   ▼
features/controller.js
   ├── features/buy       (Auto Mua Phôi)
   ├── features/upgrade   (Auto Nâng Cấp)
   └── features/icon-buy  (Mua ICON yêu thích)
          ▲
          │ background one-shot
   features/icon-session.js
          │
          ▼
lib/ui-lock (tuần tự hóa thao tác UI)
```

### 1.2. Dữ liệu Cortex

- Repo index: **`F04-Agent`**, 1.727 symbol, 380 function, 97 flow.
- `features/controller.js`: **14 import**, `main()` có **40 call edge**, tham gia **5 execution flow**.
- Blast radius của `controller.js`: **LOW**, 2 dependent (`agent.js`, `features/autobuy.js`); `autobuy.js` là shim không còn importer thực tế.
- **Không có import cycle** trực tiếp.
- 92 import nội bộ giữa các feature; feature tree không require chéo nhau, controller là hub.
- Working tree hiện có **67 changed symbol / 12 file / 32 affected flow**, Cortex xếp risk **critical**.
- Test hiện tại: **6 file, 174 test pass**; chưa có browser/Telegram integration test.

### 1.3. Bottleneck kiến trúc

| # | Bottleneck | Bằng chứng | Hệ quả |
|---|---|---|---|
| 1 | God controller | `controller.js` 687 dòng; `main()` ~520 dòng; 40 call edge | Mọi thay đổi chạm vòng lặp trung tâm |
| 2 | Buy/Upgrade trùng lặp | `mini-app.js` 330 vs 848 dòng; `patterns.js` 501 vs 585 dòng | Bug iframe/blank-frame phải sửa hai lần |
| 3 | DOM/bot text coupling | Selector nằm trong 14 file; bot identity hard-code | Telegram/bot đổi UI là hỏng nhiều flow |
| 4 | Error string protocol | 68 dòng error code; reason mới thêm tự phát | Recovery matrix khó test, dễ rơi generic path |
| 5 | Global state | `chatTextReaders` WeakMap; 23 file import `chat-runtime` | Khó test, state leak giữa session |
| 6 | Concurrency mới | Background ICON session + UI lock chưa có timeout/owner | Nguy cơ deadlock hoặc thao tác UI chồng |
| 7 | Thiếu financial state | Không có purchase journal/idempotency | Crash/restart có thể mua trùng |
| 8 | Thiếu CI/integration test | Không có workflow; test chủ yếu unit/source-regex | Regression và artifact nhạy cảm dễ lọt |

## 2. Nguyên tắc roadmap

1. **Stop-the-line P0 trước:** không chạy live, không merge thay đổi lớn khi P0 còn mở.
2. **Không đổi behavior khi refactor:** mỗi phase phải giữ public API, log message, timeout và regex.
3. **Mỗi phase có exit criteria đo được:** test, scan, review, Cortex risk.
4. **Ưu tiên giảm rủi ro tài chính trước tối ưu code:** state/idempotency/hard cap trước khi tách module.
5. **Không tạo big-bang rewrite:** chia nhỏ theo task, mỗi task có rollback.
6. **Cortex phải được cập nhật sau mỗi phase:** commit → push → reindex → kiểm tra lại blast radius.

## 3. Roadmap theo phase

### Phase 0 — Stop the line (Sprint 0, tuần 1)

**Mục tiêu:** chặn rò rỉ dữ liệu, chặn tiêu BP ngoài kiểm soát, đảm bảo tắt an toàn, đưa thay đổi critical vào review.

**Task:**
- `TASK-001` — Security cleanup: xóa debug artifact khỏi git history, rotate credential nếu cần, thêm ignore/secret scan. **REMEDIATION_COMPLETE (B1–B9 closed 2026-11-04); chưa Done — chờ re-review + QA; CI xanh phụ thuộc TASK-007.**
- `TASK-003` — Financial hard caps, **Stage A**: cap khẩn cấp theo run/ngày, dry-run mặc định, live gate; chưa phụ thuộc journal.
- `TASK-004` — Graceful shutdown: SIGINT/SIGTERM, đóng browser, dừng worker, flush log.
- `TASK-007` — Freeze/review/reindex working tree critical. **AUTHORIZATION_REQUIRED:** TASK-001 patch đã commit/push (`261e9b7`, `f22cf96`); `7f9291b` chứa runtime fixes chưa được authorize/push; fresh clone `npm run check` 188/190; là external blocker duy nhất cho CI xanh; cần Owner Decision + review.

**Exit criteria:**
- Có hard cap BP theo run/ngày; live script không thể chạy nhầm production.
- Ctrl+C không để lại Chromium/worker treo.
- Working tree sạch, Cortex index khớp HEAD, 174+ test pass.
- Không còn P0-03, P0-04, P0-07.
- TASK-001 được bàn giao nguyên trạng blocker sang Phase 0.1, không đóng ở Phase 0.

**Rủi ro chính:** rewrite git history ảnh hưởng team; hard cap có thể chặn nhầm giao dịch hợp lệ; shutdown handler có thể che lỗi thật nếu không log đủ.

---

### Phase 0.1 — TASK-001 remediation (bắt buộc, trước Phase 1)

**Mục tiêu:** đóng toàn bộ 9 blocker của TASK-001 sau kết luận **REJECTED** ngày 2026-10-31; đưa repository về trạng thái không còn artifact nhạy cảm trong lịch sử và có gate chặn tái phát.

**Điều kiện vào phase:** TASK-001 đã bị REJECTED; patch mitigation một phần đã có nhưng chưa được commit/push/merge.

**Trạng thái 2026-11-04:** B1–B9 đã đóng. `TASK-024`–`TASK-031`, `TASK-033`, `TASK-034` **DONE**; `TASK-028` `26a9d46`; `TASK-030` `4d16d41` (core `7f9291b`); `TASK-032` evidence recorded 2026-11-04 (review/QA pending). `TASK-001` **REMEDIATION_COMPLETE — pending re-review + QA**, chưa Done. `TASK-007` **AUTHORIZATION_REQUIRED** — runtime fixes chưa được authorize/push; CI/fresh clone 188/190. **STOP CONDITION: NO**.

**Task:**

| Thứ tự | Task | Blocker | Nội dung |
|---:|---|---|---|
| 1 | `TASK-027` | B4 | **DONE** (`261e9b7`). Freeze repo, backup bundle, cô lập patch TASK-001 khỏi thay đổi runtime pre-existing |
| 2 | `TASK-024` | B1 | **DONE (pushed).** Rewrite git history xóa `debug/trade-bulk.html` và 10 ảnh debug khỏi mọi commit; new HEAD `a4b7a25` → `f22cf96` |
| 3 | `TASK-025` | B2 | **DONE** — Accepted Risk Approved (no active production credential; no rotation required) |
| 4 | `TASK-026` | B3 | **DONE** — force-push `42d3555...f22cf96`; fresh clone sạch artifact; scan pass |
| 5 | `TASK-028` | B5 | **DONE** (`26a9d46`). CI checkout `fetch-depth: 0` và chạy `npm run scan:history` như blocking gate |
| 6 | `TASK-029` | B6 | **DONE** — Unit + negative test cho secret scanner (remediation `TASK-033` **DONE**, `f22cf96`) |
| 7 | `TASK-030` | B7 | **DONE** (`4d16d41`; core `7f9291b`; review/QA 2026-11-04). Scanner đọc staged blob/index thay vì chỉ working tree |
| 8 | `TASK-031` | B8 | **DONE** — deletion verified trong history + fresh clone |
| 9 | `TASK-032` | B9 | **DONE (evidence 2026-11-04; review/QA pending).** Đóng evidence, cập nhật TASK-001/incident/backlog/roadmap, security sign-off |
| 10 | TASK-001 re-review + QA | — | **PENDING.** Reviewer verdict mới + QA PASS; chỉ đóng TASK-001 sau đó và sau khi CI xanh (`TASK-007`) |

**Exit criteria:**

- `npm run scan:history` pass **0 finding**.
- `git log --all -- debug/trade-bulk.html` không còn kết quả; `git rev-list --objects --all` không còn artifact.
- Credential cũ bị từ chối; credential mới hoạt động; có evidence và sign-off.
- Remote sạch; fresh clone pass `scan:secrets`, `scan:history` (đạt tại `f22cf96`); local `npm run check` **198/198**; remote/fresh clone **188/190** — phụ thuộc `TASK-007`.
- CI có history scan blocking và có negative test.
- Scanner có test cho endpoint/token/private key/binary/history; staged secret bị phát hiện.
- Deletion của artifact được stage/commit; index không còn `debug/*.html` hoặc `debug/*.png`.
- TASK-001 chỉ chuyển **Done** sau khi tất cả điều trên đóng **và** có Reviewer verdict mới + QA PASS + CI xanh (`TASK-007`). Hiện tại: **REMEDIATION_COMPLETE**, không Done.

**Phụ thuộc:**

```text
TASK-027 ──► TASK-024 ──► TASK-026 ──► TASK-028 ──► TASK-032
                │              ▲
                └──► TASK-025 ─┘
TASK-029 ──► TASK-033 ──► TASK-030 ──► TASK-032
TASK-024 ──► TASK-031 ──► TASK-032
```

**Rủi ro chính:** rewrite history có thể làm mất commit nếu backup sai; force-push ảnh hưởng clone của team; rotation có thể làm gián đoạn endpoint đang dùng; patch có thể cuốn thay đổi runtime nếu không isolate.

---

### Phase 1 — Financial integrity (Sprint 1–2, tuần 2–3)

**Mục tiêu:** biến trạng thái mua thành dữ liệu bền vững, chống double-start, làm config đáng tin.

**Task:**
- `TASK-002` — Persistent purchase journal + idempotency + reconcile khi startup.
- `TASK-003` — Financial hard caps, **Stage B**: ledger-backed cap theo run/ngày/tuần, reservation và reconcile.
- `TASK-005` — Worker state machine/lock/lease; chat text chỉ là evidence.
- `TASK-006` — Config single source of truth + schema + README parity.
- `TASK-017` — Harden UI lock: timeout, ownership, cancellation, test abort/reload.

**Exit criteria:**
- Kill giữa chu kỳ rồi restart không tạo đơn trùng.
- Chạy 2 instance/restart giữa lúc worker đang chạy không tạo worker thứ hai.
- README và `config.json` khớp; config sai bị từ chối khi start.
- UI lock có timeout và test deadlock/abort.

**Phụ thuộc:** `TASK-002` trước `TASK-003`; `TASK-005` và `TASK-017` có thể song song sau `TASK-002`.

---

### Phase 2 — Architecture (Sprint 3–5, tuần 4–6)

**Mục tiêu:** giảm nợ kiến trúc trước khi mở rộng feature.

**Task:**
- `TASK-008` — Tách `controller.js` thành session/command-wait/idle/upgrade/buy; `main()` còn dispatcher.
- `TASK-009` — Shared `MiniAppSession`/`FeatureMenu`/`BotMessageParser` cho Buy và Upgrade.
- `TASK-010` — Central selector + versioned bot-message contract.
- `TASK-011` — Error taxonomy + recovery matrix.
- `TASK-012` — Inject `ChatSession`/`AgentContext`, bỏ global singleton.

**Exit criteria:**
- `controller.js` dưới 250 dòng; `main()` dưới 150 dòng.
- Sửa iframe lifecycle chỉ một nơi; contract test chạy cho cả Buy/Upgrade.
- Đổi selector chỉ sửa một file; parser test 3 phiên bản text.
- Mỗi error code có `retryable`/`scope`/`userMessage`; recovery matrix có test.
- Feature module không đọc global trực tiếp; test 2 session độc lập.

**Rủi ro chính:** tách controller có thể đổi thứ tự side effect; shared layer có thể làm lộ logic đặc thù. Bắt buộc smoke test 6 lệnh + 5 recovery sau mỗi task.

---

### Phase 3 — Quality gates (Sprint 6–7, tuần 7–8)

**Mục tiêu:** khóa regression và giảm rủi ro vận hành.

**Task:**
- `TASK-013` — Fake `Page`/`ChatSession` harness + integration test controller/session/recovery.
- `TASK-014` — CI: check + lint + test + secret scan + dependency audit; branch protection.
- `TASK-015` — Catch/log hygiene; không nuốt lỗi unexpected.
- `TASK-016` — PII-safe logging, retention, redaction.

**Exit criteria:**
- PR không merge nếu CI fail.
- Các flow chính có integration test, không còn source-regex test cho behavior.
- Log không chứa chat thô/PII; có retention policy.
- Lỗi unexpected có log/alert.

---

### Phase 4 — Continuous improvement (Sprint 8+)

**Mục tiêu:** giảm ma sát bảo trì, tăng khả năng quan sát.

**Task:**
- `TASK-018` — Dead code/compat shim/zero-caller helper cleanup.
- `TASK-019` — File lớn/barrel export/type contract.
- `TASK-020` — Debug script/artifact hygiene.
- `TASK-021` — Observability + runbook + ADR.
- `TASK-022` — Dependency audit + lint/format.
- `TASK-023` — Timeout/config centralization.

**Exit criteria:**
- Không còn module compat zero-importer.
- Không file nào vượt 500 dòng mà không có owner rõ ràng.
- Có runbook recovery và ADR cho P0/P1.
- Lint/format/dependency audit chạy định kỳ.

## 4. Dependency graph

```text
TASK-027 ──► TASK-024 ──► TASK-026 ──► TASK-028
                │              │
                ├──► TASK-025 ─┘
                └──► TASK-031
TASK-029 ──► TASK-033 ──► TASK-030
TASK-024 ──► TASK-032
TASK-025 ──► TASK-032
TASK-026 ──► TASK-032
TASK-028 ──► TASK-032
TASK-030 ──► TASK-032
TASK-031 ──► TASK-032
TASK-001 ──► TASK-014
TASK-007 ──► TASK-008 ──► TASK-009 ──► TASK-010
TASK-007 ──► TASK-013
TASK-002 ──► TASK-003
TASK-002 ──► TASK-005 ──► TASK-017
TASK-005 ──► TASK-008
TASK-008 ──► TASK-011
TASK-008 ──► TASK-012 ──► TASK-013
TASK-006 ──► TASK-023
TASK-014 ──► TASK-016
TASK-018 ──► TASK-019
```

> `TASK-024`, `TASK-025`, `TASK-026`, `TASK-027`, `TASK-028`, `TASK-030`, `TASK-031`, `TASK-033`, `TASK-034` đã DONE. `TASK-032` evidence recorded 2026-11-04 (review/QA pending). Remote/fresh clone xác minh tại `f22cf96`; local HEAD `3b048b9`.

**Đường găng:** `TASK-007 → TASK-001 re-review → QA` (CI xanh + đóng TASK-001), sau đó `TASK-002 → TASK-005 → TASK-008 → TASK-012 → TASK-013`. `TASK-032` đã hoàn tất phần evidence.

## 5. Timeline ước tính

| Phase | Thời lượng | Task chính | Kết quả bàn giao |
|---|---:|---|---|
| Phase 0 | 1 tuần | TASK-003, 004, 007; TASK-001 → Phase 0.1 | Có hard cap, tắt an toàn, working tree sạch; TASK-001 chuyển remediation |
| Phase 0.1 | 2–3 ngày | TASK-024–032 | Remediation evidence hoàn tất 2026-11-04; còn TASK-001 re-review/QA và TASK-007 để CI xanh |
| Phase 1 | 2 tuần | TASK-002, 005, 006, 017 | Purchase journal, worker lock/lease, config đáng tin, UI lock cứng |
| Phase 2 | 3 tuần | TASK-008–012 | Controller mỏng, shared mini-app, selector/error/context |
| Phase 3 | 2 tuần | TASK-013–016 | Integration test, CI, log an toàn |
| Phase 4 | Liên tục | TASK-018–023 | Dead code sạch, observability, runbook, lint |

## 6. KPI/exit criteria toàn roadmap

- **0 P0 mở** trước khi chạy live trở lại.
- **0 critical risk** từ `cortex_detect_changes` khi merge.
- **Tất cả PR** pass CI: check + test + lint + secret scan + history scan.
- **174+ test**, có ít nhất 10 integration test cho controller/session/recovery.
- **0 file > 500 dòng** không có owner/refactor plan.
- **100% error code** có metadata `retryable`/`scope`/`userMessage`.
- **0 artifact debug** trong git history; `npm run scan:history` pass 0 finding.
- **1 runbook** recovery + **ADR** cho các quyết định P0/P1.

## 7. Rủi ro roadmap

| Rủi ro | Xác suất | Tác động | Giảm thiểu |
|---|---|---|---|
| Rewrite git history làm gián đoạn team | Trung bình | Cao | Freeze, backup bundle, thông báo, re-clone |
| Hard cap chặn giao dịch hợp lệ | Trung bình | Trung bình | Dry-run trước, cap mềm + alert, cấu hình rõ |
| Tách controller đổi behavior | Trung bình | Cao | Refactor cơ học, smoke test 6 lệnh + 5 recovery |
| Shared layer làm lộ logic đặc thù | Thấp | Trung bình | Contract test, giữ selector/parser trong feature |
| UI lock deadlock | Trung bình | Cao | Timeout/ownership, test abort/reload |
| CI chậm làm giảm tốc độ | Thấp | Thấp | Cache dependency, chạy song song |

## 8. Liên kết

- Backlog: [`docs/backlog.md`](backlog.md)
- Task board: [`docs/tasks/README.md`](tasks/README.md)
- Review TASK-001: [`docs/reviews/TASK-001-review-2026-10-31.md`](reviews/TASK-001-review-2026-10-31.md)
- Task đang review: [`docs/tasks/TASK-032-close-remediation.md`](tasks/TASK-032-close-remediation.md)
- Review TASK-027: [`docs/reviews/TASK-027-review-2026-11-01.md`](reviews/TASK-027-review-2026-11-01.md)
- QA TASK-027: [`docs/reviews/TASK-027-qa-2026-11-01.md`](reviews/TASK-027-qa-2026-11-01.md)
- Task gốc: [`docs/tasks/TASK-001-security-cleanup.md`](tasks/TASK-001-security-cleanup.md)
- Incident: [`docs/incident-2026-10-31.md`](incident-2026-10-31.md)
