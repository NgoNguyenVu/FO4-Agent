# Backlog CTO — FO4-Agent

- **Cập nhật:** 2026-11-01 (Manager: TASK-024 DONE local — moved to completed; TASK-026 BLOCKED; TASK-033 READY — remediation TASK-029 REJECTED)
- **Người lập:** CTO Agent; cập nhật bởi Manager Agent
- **Nguồn dữ liệu:** Cortex MCP (`cortex_cypher`, `cortex_code_grep`, `cortex_code_context`, `cortex_code_impact`, `cortex_detect_changes`) và working tree.
- **Trạng thái repo:** Local `main` tại `a4b7a25` sau rewrite; remote vẫn ở lịch sử cũ cho đến `TASK-026`. Working tree còn staged patch TASK-001 (7 file) và 3 file runtime unstaged. Cortex cần reindex sau khi push.
- **Kiểm tra hiện tại:** `npm run check` pass **177/177 test**; `npm run scan:secrets` pass; `npm run scan:history` pass **0 finding** trên local; remote/fresh clone chưa xác minh. Chưa có integration test chạy browser/Telegram thật.

## 0. Tóm tắt điều hành

| Ưu tiên | Số lượng | Ý nghĩa |
|---|---:|---|
| **P0 — Critical** | 7 | Phải đóng trước khi chạy live hoặc merge thay đổi lớn. Có thể gây mất tiền, lộ dữ liệu, treo hệ thống hoặc che giấu regression. |
| **P1 — Important** | 10 | Phải đóng trong 2–4 tuần tới. Gây bug lặp, khó phát triển, khó vận hành. |
| **P2 — Improvement** | 10 | Cải thiện liên tục. Giảm ma sát, tăng khả năng bảo trì. |

**Remediation TASK-001:** task remediation mới **`TASK-033`** cho Reviewer REJECTED của `TASK-029`; task board hiện có **33 task** (task remediation mới).

**Khuyến nghị stop-the-line:** không chạy live, không merge thay đổi lớn và không tiếp tục tiêu BP cho đến khi đóng tối thiểu **P0-01, P0-03, P0-04 và P0-07**. P0-01 đang được xử lý qua `TASK-024`–`TASK-032`.

### Thay đổi so với kỳ review trước

| Hạng mục | Trạng thái mới | Ghi chú |
|---|---|---|
| P0-01 — Debug artifact/endpoint | **Blocked — REJECTED** | Mitigation một phần đã xong; 9 blocker B1–B9 được chuyển thành `TASK-024`–`TASK-032`. |
| P0-05 — Worker adoption/concurrency | **Partial** | Đã có `features/icon-session.js`, `lib/ui-lock.js`, `features/icon-buy/tasks.js`; nhưng buy worker vẫn suy luận từ chat text. |
| P1-06 — Missing tests | **Partial** | Từ 3 file test lên 6 file, 174 test pass; vẫn thiếu integration test controller/session/recovery. |
| P0-06 — Config/docs drift | **Mở rộng** | Thêm lệch `maxPlayersPerBatch` (README 1 mã/lượt, config 3) và `targetGrade` (default 6, raw config 7). |
| P0-07 — Working tree critical | **Partial** | Local `main` đã rewrite sang `a4b7a25`; working tree vẫn còn TASK-001 patch (7 file staged) và 3 file runtime unstaged. |
| P1-10 — UI lock hardening | **Mới** | Khóa UI mới chưa có timeout/ownership; có thể deadlock hoặc giữ khóa sai. |

## 1. P0 — Critical

### P0-01 — Artifact debug bị track, lộ endpoint nội bộ và logic token

- **Trạng thái:** **Blocked — REJECTED (2026-10-31)**; B1 đã đóng phạm vi local, remote chờ `TASK-026`
- **Nhóm:** Bảo mật / Vệ sinh repository
- **Review:** [`docs/reviews/TASK-001-review-2026-10-31.md`](reviews/TASK-001-review-2026-10-31.md) — kết luận **REJECTED** với 9 blocker B1–B9.
- **Đã đạt (mitigation một phần):**
  - `debug/trade-bulk.html` và 10 ảnh `debug/*.png` đã rời working tree, được quarantine ngoài repo kèm manifest SHA-256.
  - `.gitignore` đã chặn `debug/*.png`, `debug/*.html`, `debug/*.json`, `debug/*.log`.
  - Đã có `scripts/check-secrets.js`, `npm run scan:secrets`, `npm run scan:history` và workflow `.github/workflows/security.yml`.
  - Tài liệu đã redact endpoint nội bộ.
  - **2026-11-01:** TASK-024 rewrite local — new HEAD `a4b7a25`; 11 artifact bị xóa khỏi mọi commit; `scan:history` pass **0 finding**; `npm run check` **177/177**.
  - **2026-11-01:** TASK-027 cô lập patch — staged **7 file**, Reviewer **APPROVED**, QA **PASS**.
- **Bằng chứng còn blocker:**
  - Remote `origin/main` vẫn chứa artifact và endpoint nội bộ cho đến `TASK-026`.
  - Credential chưa được rotate/revoke; chưa force-push/re-clone; CI chưa quét history.
  - Chưa có test cho secret scanner; scanner đọc working tree thay vì staged blob.
  - Deletion đã vào lịch sử local nhưng chưa commit/fresh-clone verify.
- **Tác động:** Lộ bề mặt API nội bộ, quy trình làm mới token và dữ liệu vận hành. Nếu credential từng được dùng, phải coi như đã bị lộ.
- **Kết quả cần đạt:** Xóa artifact khỏi working tree và lịch sử git; thu hồi/rotate credential liên quan nếu có; thêm ignore rules; đưa fixture đã làm sạch ra khỏi repo; bật secret scanning.
- **Điều kiện hoàn thành:** Lịch sử git không còn `debug/trade-bulk.html` và ảnh debug; `npm run scan:history` pass 0 finding trên remote/fresh clone; credential cũ bị vô hiệu hóa; fresh clone sạch; CI chặn được history leak.
- **Task:** `TASK-001`; remediation `TASK-024` → `TASK-032`.

### 1.1 Remediation TASK-001 — map blocker → task

| Blocker | Mức độ | Nội dung | Task | Điều kiện đóng |
|---|---|---|---|---|
| B1 | Critical | Git history còn artifact — **local đã sạch, remote chưa** | `TASK-024` | `scan:history` pass 0 finding; `git fsck` sạch |
| B2 | Critical | Credential chưa rotate/revoke | `TASK-025` | Credential cũ bị từ chối; có evidence + sign-off |
| B3 | High | Chưa force-push, re-clone, fresh-clone verification — **BLOCKED (authorization)** | `TASK-026` | Remote sạch; fresh clone pass; team đã re-clone |
| B4 | High | Patch không cô lập; TASK-007 chưa xong — **đã cô lập, 7 file staged** | `TASK-027` | Staged diff chỉ chứa file TASK-001 |
| B5 | High | CI chưa scan history | `TASK-028` | `fetch-depth: 0` + `scan:history` blocking |
| B6 | High | Thiếu test cho secret scanner — **DONE** (test suite hoàn thiện qua task remediation `TASK-033` — **READY_FOR_COMMIT**) | `TASK-029` | Unit + negative test pass trong CI |
| B7 | Medium | Scanner đọc working tree thay vì staged blob | `TASK-030` | Staged secret bị phát hiện |
| B8 | Medium | Deletion chưa được commit/fresh-clone verify — **đã vào history local** | `TASK-031` | Index không còn artifact; deletion trong commit; fresh clone sạch |
| B9 | Low | Task/incident/backlog chưa cập nhật trạng thái | `TASK-032` | Docs + evidence nhất quán; TASK-001 đóng |

**Thứ tự bắt buộc:** `TASK-027` (freeze/isolate) → `TASK-024` (rewrite history) → `TASK-025` (rotate credential, có thể song song sau freeze) → `TASK-026` (force-push/re-clone) → `TASK-028` (CI history gate) → `TASK-029` (scanner tests, **DONE**) → `TASK-033` (remediation scanner tests, **READY_FOR_COMMIT**) → `TASK-030` (staged-blob scan) → `TASK-031` (stage deletions) → `TASK-032` (đóng evidence).

**Không cho phép:** commit, push, merge hoặc chạy live TASK-001 cho đến khi B1–B9 đóng.

### P0-02 — Không có persistent state, idempotency và audit trail cho giao dịch BP

- **Trạng thái:** Open
- **Nhóm:** Toàn vẹn dữ liệu / Tài chính
- **Bằng chứng:**
  - README dòng 253 ghi rõ: “The agent does not write purchase state or cycle totals to disk.”
  - Trong luồng agent, chỉ `features/agent-log.js` ghi disk; không có journal giao dịch.
  - `pendingBuyCompletion` chỉ tồn tại trong memory.
  - Không có order ID, cycle ID, idempotency key hoặc ledger BP.
- **Tác động:** Crash hoặc restart giữa chu kỳ khiến agent không biết đã mua hay chưa; có thể mua trùng, tiêu BP lần hai và không thể đối soát.
- **Kết quả cần đạt:** Journal nhỏ ghi cycle ID, worker ID, order ID, trạng thái, thời điểm và số BP; reconcile khi startup; idempotency key cho mỗi order; audit log theo ngày/chu kỳ.
- **Điều kiện hoàn thành:** Kill tiến trình giữa chu kỳ rồi restart không tạo đơn trùng; có báo cáo đối soát BP theo cycle và theo ngày.
- **Task:** `TASK-002`

### P0-03 — Guardrail tài chính quá mỏng, không có hard cap

- **Trạng thái:** Open
- **Nhóm:** Kiểm soát chi tiêu
- **Bằng chứng:**
  - README dòng 40–42: agent **không áp đặt lifetime BP budget**; bot/account balance quyết định.
  - `config.json` có `maxPriceBP` và `maxPerCycle`, nhưng không có cap theo run/ngày/tuần.
  - `debug/run-icon-live.js` có thể đặt đơn thật khi đặt `FO4_CONFIRM_LIVE_ICON=YES`; không có dry-run mặc định.
  - `features/icon-session.js` mới chỉ giới hạn concurrency/one-shot, không giới hạn tổng BP.
- **Tác động:** Một vòng lặp lỗi, parse sai completion hoặc debug script chạy nhầm có thể tiêu BP liên tục mà không có điểm dừng cứng.
- **Kết quả cần đạt:** Spend ledger bền vững; hard cap theo run/ngày; dry-run mặc định; confirmation gate cho live purchase; profile/account riêng cho live test.
- **Điều kiện hoàn thành:** Vượt cap thì dừng cứng, không có đường tắt qua biến môi trường; live test không thể dùng nhầm profile hoặc account production.
- **Task:** `TASK-003`

### P0-04 — Không có graceful shutdown, dễ để lại Chromium và worker treo

- **Trạng thái:** Open
- **Nhóm:** Vận hành / Lifecycle
- **Bằng chứng:**
  - Cortex grep `SIGINT|SIGTERM|process.on(` **không có kết quả**.
  - `agent.js` chỉ set `process.exitCode`; không đóng Playwright context, không dừng worker, không flush log.
  - Không có health check hoặc heartbeat định kỳ.
- **Tác động:** Ctrl+C hoặc crash có thể để lại Chromium, bot worker và log chưa ghi. Worker còn sống có thể tiếp tục tiêu BP ngoài tầm kiểm soát.
- **Kết quả cần đạt:** Shutdown handler cho `SIGINT`/`SIGTERM`/uncaught exception; đóng browser context; dừng worker do agent sở hữu; flush log; exit code rõ ràng; health heartbeat.
- **Điều kiện hoàn thành:** Ctrl+C không còn process con treo; log có dấu hiệu shutdown; worker do agent sở hữu dừng trước khi thoát.
- **Task:** `TASK-004`

### P0-05 — Worker adoption và concurrency dựa trên chat text, dễ double-start

- **Trạng thái:** **Partial**
- **Nhóm:** Đồng bộ / Concurrency
- **Bằng chứng:**
  - Đã giảm thiểu một phần: `features/icon-session.js` chặn hai phiên ICON chạy song song; `lib/ui-lock.js` tuần tự hóa thao tác UI; `features/icon-buy/tasks.js` chụp baseline `/stop` và chỉ dừng task ICON mới.
  - Phần còn hở: buy worker vẫn được suy ra từ chat text qua `checkAutoBuyRunning`, `confirmSuspectedWorker`, `verifyTailOrphan`, `pendingBuyCompletion`, `getLatestAutoBuyStatus`.
  - `checkAutoBuyRunning()` vẫn gửi `/stop` và parse reply; `waitForCycleCompletion()` xử lý orphan terminal message.
  - `lib/ui-lock.js` chưa có timeout, ownership hoặc cancellation; `features/icon-buy/order.js` thủ công release rồi acquire lại khóa.
- **Tác động:** Agent có thể adopt nhầm worker hoặc start worker thứ hai, dẫn đến mua trùng và chi tiêu ngoài ý muốn; UI lock có thể deadlock nếu một nhánh không release.
- **Kết quả cần đạt:** State machine cục bộ rõ ràng; lock/lease cho start/stop; chat text chỉ là evidence, không phải nguồn state duy nhất; reconcile khi startup; UI lock có timeout/ownership.
- **Điều kiện hoàn thành:** Chạy 2 instance hoặc restart giữa lúc worker đang chạy không tạo worker thứ hai; có test cho race condition này và test deadlock UI lock.
- **Task:** `TASK-005`, `TASK-017`

### P0-06 — Config runtime và README lệch nhau, không có single source of truth

- **Trạng thái:** Open
- **Nhóm:** Cấu hình / Kiểm soát chi tiêu
- **Bằng chứng:**
  - README ghi OVR **115–120**, giá tối đa **666.666 BP**, quantity **5**.
  - `config.json` thực tế: OVR **118–123**, `maxPriceBP` **888888**, `quantityPerAttempt` **3**.
  - README nói ICON chọn **1 mã/lượt**; `config.json` đặt `iconBuy.maxPlayersPerBatch = 3`; runner chọn tối đa 3 mã.
  - README nói upgrade-grade để mini-app tự chọn; `config.json` đặt `upgrade.targetGrade = 7`; `features/config.js` lại có default `targetGrade: 6`, `minRatio: 100` trước khi spread raw config.
  - `config.json` là JSON thuần; validation hiện chỉ nằm trong `features/config.js`, không kiểm tra README và không phát hiện default/raw drift.
- **Tác động:** Operator có thể hiểu sai hạn mức chi tiêu và phạm vi mua; thay đổi hành vi ngoài ý muốn; audit sai.
- **Kết quả cần đạt:** Một nguồn sự thật duy nhất cho cấu hình; schema validation với range/default; fail-fast khi config sai; README được generate hoặc kiểm tra tự động khớp với config.
- **Điều kiện hoàn thành:** Agent từ chối khởi động với config sai; CI phát hiện README và config lệch nhau; không còn default trong code mâu thuẫn với `config.json`.
- **Task:** `TASK-006`

### P0-07 — Working tree đang chứa thay đổi critical chưa commit/index

- **Trạng thái:** **Partial**
- **Nhóm:** Quy trình / Rủi ro release
- **Bằng chứng:**
  - `cortex_detect_changes` với `git diff HEAD` báo **Risk: critical** — **67 changed symbol** trong **12 file**, ảnh hưởng **32 execution flow** (đo trước rewrite).
  - Các file mới `features/icon-session.js`, `features/icon-buy/tasks.js`, `lib/ui-lock.js` và test tương ứng chưa được Cortex index.
  - `npm run check` pass **177 test**, nhưng không có CI; test chưa cover browser/Telegram integration.
  - Ngày 2026-11-01: local `main` đã rewrite sang `a4b7a25`; phần lớn thay đổi runtime đã vào lịch sử local.
  - Working tree vẫn còn staged patch TASK-001 (**7 file**) và 3 file runtime unstaged: `config.json`, `features/upgrade/loop.js`, `features/upgrade/runner.js`.
  - Chưa push; Cortex index chưa được reindex theo HEAD `a4b7a25`.
- **Tác động:** Review/CI bị mù trước thay đổi lớn; dễ merge regression, đặc biệt ở controller, icon runner và upgrade runner. Backlog/roadmap có thể dựa trên graph cũ.
- **Kết quả cần đạt:** Freeze feature work; review diff theo từng nhóm nhỏ; commit/push; chạy lại test; reindex Cortex; chỉ sau đó mới tiếp tục thay đổi kiến trúc.
- **Điều kiện hoàn thành:** `git status` sạch; Cortex index khớp HEAD; `cortex_detect_changes` được review; 174+ test pass; có CI gate.
- **Task:** `TASK-007`

## 2. P1 — Important

### P1-01 — `controller.js` là god module

- **Trạng thái:** Open
- **Bằng chứng:** `features/controller.js` hiện **687 dòng**; `main()` khoảng **520 dòng** (90–609), **14 import**, **40 call edge** và **5 execution flow** theo Cortex. Blast radius LOW với 2 dependent: `agent.js` và `features/autobuy.js`; `autobuy.js` là shim không còn importer thực tế.
- **Tác động:** Mọi thay đổi đều chạm vòng lặp trung tâm; recovery là chuỗi `error.code` dài trong một `try/catch`, khó test và khó review.
- **Kết quả cần đạt:** Tách `session`, `command-wait`, `idle-state`, `upgrade-mode`, `buy-mode`; `main()` chỉ còn dispatcher + recovery/finally; giữ nguyên public API và behavior.
- **Điều kiện hoàn thành:** `main()` dưới 150 dòng, `controller.js` dưới 250 dòng; smoke test đủ 6 lệnh và 5 tình huống recovery; log/timeout/regex không đổi.
- **Task:** `TASK-008`

### P1-02 — Buy và Upgrade gần như trùng lặp triển khai

- **Trạng thái:** Open
- **Bằng chứng:**
  - `features/buy/mini-app.js`: 330 dòng; `features/upgrade/mini-app.js`: 848 dòng.
  - `features/buy/patterns.js`: 501 dòng; `features/upgrade/patterns.js`: 585 dòng.
  - Các cặp logic tương ứng: `waitForTradeFrame` / `waitForUpgradeFrameReady`, `configureCycle` / `configureUpgradeFrame`, `requestBuyMenu` / `requestUpgradeMenu`, `findAutoBuyButton` / `findNcMenuButton`.
  - Trùng lặp helper `buildBaseline`, `heartbeat`.
  - `features/icon-buy/tasks.js` mới cũng đọc menu `/stop` theo cách riêng, song song với logic buy cycle.
- **Tác động:** Một bug iframe/blank-frame phải sửa hai lần; hành vi hai feature dễ drift; test phải nhân đôi.
- **Kết quả cần đạt:** Shared layer `MiniAppSession`, `FeatureMenu`, `BotMessageParser`; chỉ giữ selector và outcome parser đặc thù trong từng feature.
- **Điều kiện hoàn thành:** Sửa iframe lifecycle chỉ ở một nơi; contract test chạy cho cả Buy và Upgrade.
- **Task:** `TASK-009`

### P1-03 — Phụ thuộc cứng vào Telegram DOM và text tiếng Việt của bot

- **Trạng thái:** Open
- **Bằng chứng:** Cortex grep selector như `iframe.payment-verification`, `data-mid`, `editable-message-text`, `chatlist-chat`, `peer-title`, `reply-markup-button` thấy trong **14 file** (gồm code, test, debug). Bot identity (`BOT_USERNAME`, `BOT_USER_ID`, `BOT_CHAT_TITLE_RE`) hard-code trong `features/telegram-io.js`. `features/icon-buy/tasks.js` mới thêm selector `.bubble[data-mid]` và `.reply-markup-button`.
- **Tác động:** Telegram đổi markup hoặc bot đổi wording có thể làm hỏng nhiều flow cùng lúc; không có adapter/versioned contract.
- **Kết quả cần đạt:** Module selector tập trung; bot-message contract có version; fallback selector; contract test cho parser.
- **Điều kiện hoàn thành:** Đổi selector chỉ sửa một file; parser được test với ít nhất 3 phiên bản text.
- **Task:** `TASK-010`

### P1-04 — Error handling là string protocol tự phát

- **Trạng thái:** Open
- **Bằng chứng:** Cortex grep ghi nhận **68 dòng** tham chiếu error code như `MENU_BUSY`, `MINI_APP_BLANK`, `BOT_SYSTEM_ERROR`, `ICON_UI_STALE`, `ICON_RATE_LIMITED`, `NO_UPGRADE_TARGETS`, `NO_UPGRADE_MATERIALS`. Code được gán thủ công; có fallback bằng regex message như `/Không còn cầu thủ/`. Code mới thêm các reason `no-task-baseline`, `task-slots-full`, `icon-task-stop-failed`, `ttcn-cancel-failed`.
- **Tác động:** Lỗi mới có thể rơi vào generic recovery; không có nguồn sự thật cho `retryable`, `scope`, `userMessage`; recovery matrix khó test.
- **Kết quả cần đạt:** Error taxonomy tập trung với `retryable`, `scope`, `userMessage`; mapping lỗi → hành động recovery ở một nơi.
- **Điều kiện hoàn thành:** Mỗi lỗi mới bắt buộc khai báo; recovery matrix có test cho từng nhóm lỗi.
- **Task:** `TASK-011`

### P1-05 — Global mutable state và hidden service locator

- **Trạng thái:** Open
- **Bằng chứng:**
  - `lib/chat-state.js` giữ global `WeakMap` `chatTextReaders`.
  - **23 file** import `lib/chat-runtime.js` và gọi `chatTextReaders.get(page)` trực tiếp.
  - Module-level `let` trong `features/interactive-prompt.js` (`pendingPromptResolve`, `waitingForLoginPrompt`, `waitingForRecoveryPrompt`) và `features/telegram-io.js` (`lastTnSentAt`).
  - `lib/browser-session.js` mutate module-level `headlessMode`.
- **Tác động:** Dependency không tường minh, thứ tự khởi tạo quan trọng, state dễ leak giữa session; unit test phải thao tác global state.
- **Kết quả cần đạt:** Inject `ChatSession`/`AgentContext`; loại bỏ singleton; chỉ giữ immutable process config ở global.
- **Điều kiện hoàn thành:** Feature module không đọc global trực tiếp; test tạo được 2 session độc lập.
- **Task:** `TASK-012`

### P1-06 — Test chủ yếu là unit/static, thiếu integration

- **Trạng thái:** **Partial**
- **Bằng chứng:** Hiện có **6 file test**, **174 test pass**:
  - `agent.test.js`: 1.643 dòng, 105 test.
  - `features/autonangcap.test.js`: 860 dòng, 40 test.
  - `features/icon-buy/patterns.test.js`: 230 dòng, 16 test.
  - `features/icon-session.test.js`: 99 dòng, 4 test.
  - `features/icon-buy/tasks.test.js`: 67 dòng, 3 test.
  - `lib/ui-lock.test.js`: 60 dòng, 3 test.
- Nhiều test trong `agent.test.js` vẫn dùng `assert.match(src, /.../)` trên source thay vì kiểm tra behavior. Không có automated browser/Telegram integration test; `debug/` là script thủ công.
- **Tác động:** Các phần dễ vỡ nhất — DOM interaction, iframe lifecycle, chat observation, recovery — không được cover tự động. Source-regex test dễ vỡ và khuyến khích copy-paste.
- **Kết quả cần đạt:** Fake `Page`/`ChatSession` harness; contract test cho từng feature; integration test cho controller/session/recovery; source invariant chuyển thành lint rule; live smoke test opt-in.
- **Điều kiện hoàn thành:** Các flow chính có integration test; test behavior không còn assert source string.
- **Task:** `TASK-013`

### P1-07 — Không có CI, lint, typecheck hoặc secret scan

- **Trạng thái:** Open
- **Bằng chứng:** Không có `.github/workflows`. `package.json` chỉ có `start`, `check` (`node --check agent.js && node --test`) và `test`; không có lint, typecheck, secret scan hay dependency audit.
- **Tác động:** Regression và artifact nhạy cảm có thể merge mà không bị chặn; chất lượng phụ thuộc vào máy local.
- **Kết quả cần đạt:** CI pipeline chạy check + lint + test + secret scan + dependency audit; branch protection bắt buộc pass.
- **Điều kiện hoàn thành:** PR không merge được nếu CI fail; secret scan chặn được artifact debug.
- **Task:** `TASK-014`

### P1-08 — Catch nuốt lỗi, không log

- **Trạng thái:** Open
- **Bằng chứng:** Nhiều `catch` trong `features/telegram-io.js`, `features/upgrade/mini-app.js`, `lib/chat-runtime.js` chỉ có comment hoặc `continue`, không log. Ví dụ: `catch { continue; }`, `catch { text = ""; }`, `catch { /* bỏ qua */ }`.
- **Tác động:** Lỗi bị nuốt im lặng, state có thể sai mà không có log; rất khó chẩn đoán khi chạy thật.
- **Kết quả cần đạt:** Catch chỉ được phép im lặng khi có lý do và annotation; lỗi unexpected phải log/rethrow; thêm metric cho lỗi bị nuốt.
- **Điều kiện hoàn thành:** Không còn catch im lặng không giải thích; lỗi unexpected xuất hiện trong log/alert.
- **Task:** `TASK-015`

### P1-09 — Log chứa nội dung chat và dữ liệu nhạy cảm

- **Trạng thái:** Open
- **Bằng chứng:** `features/buy/cycle.js` log `snapshot.text.slice(-300)` và `slice(-1_000)`; `features/icon-buy/tasks.js` log `messagesToText(lastNewTexts)`; `agent.log` có thể chứa nội dung chat, mã đơn, thông tin tài khoản.
- **Tác động:** Rò rỉ PII/dữ liệu đơn hàng; log phình to; khó chia sẻ log để debug.
- **Kết quả cần đạt:** Structured logging; redact nội dung chat/PII; log level; retention policy.
- **Điều kiện hoàn thành:** Log không chứa chat thô/PII; có chính sách retention và rotation.
- **Task:** `TASK-016`

### P1-10 — UI lock mới chưa có timeout/ownership, có thể deadlock

- **Trạng thái:** Open
- **Bằng chứng:** `lib/ui-lock.js` 57 dòng, chỉ có `held` và FIFO waiters; không có timeout, owner, reentrancy hoặc cancellation. `features/icon-buy/order.js` thủ công `release()` sau khi gửi lệnh mua rồi `acquire()` lại trong `finally`. `features/icon-session.js` chạy nền song song với buy/upgrade.
- **Tác động:** Nếu một nhánh quên release, treo hoặc bị abort giữa chừng, luồng còn lại có thể chờ vô hạn; nếu release/acquire sai thứ tự, hai luồng có thể cùng thao tác UI.
- **Kết quả cần đạt:** UI lock có timeout/cancellation, ownership rõ ràng, test cho abort/reload/deadlock; giảm manual release/acquire.
- **Điều kiện hoàn thành:** Có test lock timeout và abort; không còn nhánh nào giữ khóa quá thời gian cấu hình.
- **Task:** `TASK-017`

## 3. P2 — Improvement

### P2-01 — Dead code: module re-export và shim không còn importer

- **Bằng chứng:** `features/chat-state.js` và `features/control-commands.js` là re-export 3 dòng, **zero importer**. `features/autobuy.js` và `features/autonangcap.js` là legacy shim, **zero importer**.
- **Kết quả cần đạt:** Xóa sau khi xác nhận không có consumer bên ngoài; nếu còn consumer, ghi rõ trong tài liệu.
- **Task:** `TASK-018`

### P2-02 — Helper zero-caller chưa được phân loại

- **Bằng chứng:** Cortex xác định zero caller cho: `waitForMenuReply`, `heartbeat` (nhiều bản), `buildBaseline` (nhiều bản), `getExistingAutoBuyCycle`, `hasIconMenuSignature`, `isIconSeasonBadge`, `isUpgradeFrameReady`, `getUpgradeTerminalKey`.
- **Kết quả cần đạt:** Triage từng helper: dead thật thì xóa; dùng qua dynamic/export thì thêm test hoặc annotation; không để trạng thái “không rõ còn dùng hay không”.
- **Task:** `TASK-018`

### P2-03 — File lớn và barrel export lộ internals

- **Bằng chứng:** `features/upgrade/mini-app.js` 848 dòng, `features/controller.js` 687 dòng, `features/upgrade/patterns.js` 585 dòng, `features/buy/patterns.js` 501 dòng. `features/buy/index.js` và `features/upgrade/index.js` spread toàn bộ export của submodule.
- **Kết quả cần đạt:** Tách theo trách nhiệm; barrel chỉ export public API; internal helper không bị controller gọi trực tiếp.
- **Task:** `TASK-019`

### P2-04 — Thiếu type contract

- **Bằng chứng:** Outcome, baseline, error là plain object/string; không có TypeScript hoặc JSDoc contract.
- **Kết quả cần đạt:** JSDoc typedef + `checkJs`, hoặc TypeScript; schema validation ở boundary.
- **Task:** `TASK-019`

### P2-05 — Debug script và artifact lẫn trong repo

- **Bằng chứng:** Nhiều script `debug/probe-*.js`, `debug/run-icon-live.js`, `debug/stop-icon-task.js`, `debug/verify-*.js` được track; 10 ảnh PNG và `trade-bulk.html` cũng được track. Working tree còn thêm `debug/cancel-leftover-icon.js`, `debug/probe-ttcn-order.js`.
- **Kết quả cần đạt:** Chuyển script hỗ trợ sang `tools/` có tài liệu; giữ guard env; fixture đã làm sạch; ignore toàn bộ artifact.
- **Task:** `TASK-020`

### P2-06 — Observability còn yếu

- **Bằng chứng:** Chỉ có `features/agent-log.js`; không có structured log, correlation ID, metric hay health endpoint.
- **Kết quả cần đạt:** JSON log có correlation ID; health heartbeat; metric cho cycle, spend, error rate.
- **Task:** `TASK-021`

### P2-07 — Dependency/security hygiene

- **Bằng chứng:** Có `package-lock.json` nhưng không có `npm audit`, Dependabot hoặc CI dependency check.
- **Kết quả cần đạt:** Audit định kỳ; Dependabot; pin version; review lockfile.
- **Task:** `TASK-022`

### P2-08 — Thiếu runbook và ADR

- **Bằng chứng:** README mô tả behavior nhưng không có runbook vận hành, quy trình recovery, state model hoặc ADR.
- **Kết quả cần đạt:** Runbook start/stop/recovery/incident; ADR cho các quyết định P0/P1.
- **Task:** `TASK-021`

### P2-09 — Thiếu lint/format chuẩn

- **Bằng chứng:** Không có ESLint/Prettier config; style phụ thuộc reviewer.
- **Kết quả cần đạt:** ESLint + Prettier; CI gate.
- **Task:** `TASK-022`

### P2-10 — Magic number và timeout rải rác

- **Bằng chứng:** Nhiều timeout/hằng số nằm rải rác trong flow: 15s, 30s, 45s, 60s, 120s, 180 phút; một số ở `config.json`, một số hard-code trong module. Code mới thêm `CONFIRM_TIMEOUT_MS`, `BUTTONS_TIMEOUT_MS`, `45_000` trong icon session.
- **Kết quả cần đạt:** Timeout policy tập trung; env override; tài liệu default; test config.
- **Task:** `TASK-023`

## 4. Thứ tự thực thi đề xuất

### 4.1 Remediation TASK-001 (bắt buộc trước khi merge)

| Thứ tự | Task | Blocker | Lý do |
|---|---|---|---|
| 1 | `TASK-027` | B4 | Freeze/isolate patch trước mọi thao tác rewrite; tránh cuốn thay đổi runtime vào commit — **READY_FOR_COMMIT** |
| 2 | `TASK-024` | B1 | Rewrite history để xóa artifact khỏi mọi commit — **DONE local**, new HEAD `a4b7a25` |
| 3 | `TASK-025` | B2 | Rotate/revoke credential đã lộ; có thể chạy song song sau freeze — **BLOCKED** |
| 4 | `TASK-026` | B3 | Force-push lịch sử sạch, re-clone và fresh-clone verification — **BLOCKED (authorization)** |
| 5 | `TASK-028` | B5 | Bật CI history scan với `fetch-depth: 0` |
| 6 | `TASK-029` | B6 | **DONE** — Khóa scanner bằng unit + negative test (qua task remediation `TASK-033` **READY_FOR_COMMIT**) |
| 7 | `TASK-030` | B7 | Scan staged blob/index, không chỉ working tree |
| 8 | `TASK-031` | B8 | Stage deletion của toàn bộ artifact |
| 9 | `TASK-032` | B9 | Đóng evidence, cập nhật trạng thái và sign-off |

### 4.2 Các hạng mục còn lại

| Thứ tự | Hạng mục | Lý do |
|---|---|---|
| 1 | P0-03, P0-04, P0-07 | Chặn tiêu BP ngoài kiểm soát, tắt an toàn, đưa thay đổi critical vào review |
| 2 | P0-02, P0-05, P0-06 | Có state/idempotency, chống double-start, config đáng tin |
| 3 | P1-01 → P1-05, P1-10 | Giảm nợ kiến trúc trước khi mở rộng feature |
| 4 | P1-06 → P1-09 | Tăng test/CI/observability để khóa regression |
| 5 | P2-01 → P2-10 | Dọn dead code, giảm ma sát phát triển |

## 5. Điều kiện dừng live

Không chạy live nếu một trong các điều kiện sau còn đúng:

1. `npm run scan:history` còn finding hoặc `debug/trade-bulk.html`/ảnh debug còn trong git history — **local đã pass; remote/fresh clone chưa**.
2. Credential từng dùng bởi luồng bị lộ chưa được rotate/revoke.
3. Chưa force-push lịch sử sạch và chưa có fresh-clone verification.
4. Chưa có hard cap BP theo run/ngày.
5. Chưa có shutdown handler và worker cleanup.
6. Working tree còn thay đổi critical chưa commit/index.
7. Chưa có persistent purchase journal hoặc reconcile khi restart.

## 6. Liên kết

- Roadmap: [`docs/roadmap.md`](roadmap.md)
- Task board: [`docs/tasks/README.md`](tasks/README.md)
- Company state: [`docs/company-state.md`](company-state.md)
- Queue: [`docs/queue.md`](queue.md)
- Review TASK-001: [`docs/reviews/TASK-001-review-2026-10-31.md`](reviews/TASK-001-review-2026-10-31.md)
- Task ưu tiên hiện tại: [`docs/tasks/TASK-026-force-push-fresh-clone.md`](tasks/TASK-026-force-push-fresh-clone.md)
- Task gốc: [`docs/tasks/TASK-001-security-cleanup.md`](tasks/TASK-001-security-cleanup.md)
- Incident: [`docs/incident-2026-10-31.md`](incident-2026-10-31.md)
