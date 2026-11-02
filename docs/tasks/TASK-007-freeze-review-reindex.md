# TASK-007 — Freeze, review và reindex working tree critical

## Thông tin

- **Priority:** P0
- **Risk:** Critical
- **Effort:** S
- **Dependency:** —
- **Status:** **AUTHORIZATION_REQUIRED** — runtime changes cần Owner Decision + review độc lập (2 test fresh clone fail)
- **Owner đề xuất:** Tech Lead + Reviewer độc lập

## 1. Mục tiêu

Đưa thay đổi critical đang nằm ngoài lịch sử review vào các commit nhỏ, chạy test, push, reindex Cortex và xác nhận index khớp HEAD trước khi tiếp tục bất kỳ thay đổi kiến trúc nào.

Phạm vi:

- Toàn bộ working tree hiện tại.
- Git history/commit grouping.
- Cortex index.
- CI gate tối thiểu.

Không thuộc phạm vi:

- Sửa logic trong lúc review (nếu phát hiện bug, tạo task riêng).
- Rewrite lịch sử cũ (thuộc TASK-001).

## 2. Bằng chứng

- `cortex_detect_changes` với `git diff HEAD` báo **Risk: critical** — **67 changed symbol**, **12 file**, **32 affected flow**.
- Các file mới `features/icon-session.js`, `features/icon-buy/tasks.js`, `lib/ui-lock.js` và test tương ứng chưa được Cortex index.
- `npm run check` pass **174 test**, nhưng không có CI; test chưa cover browser/Telegram integration.
- Repo mới có một commit `42d3555`; toàn bộ thay đổi lớn đang nằm ngoài lịch sử review.
- `git status` còn nhiều file modified/untracked, gồm cả ảnh debug và script debug mới.

## 3. Kế hoạch thực hiện

> **Cập nhật 2026-11-01:** local `main` đã rewrite sang `a4b7a25` (4 commit). Phần lớn thay đổi runtime đã vào lịch sử local; working tree vẫn còn TASK-001 patch (7 file staged) và `config.json`/`features/upgrade/*` unstaged. Chưa push, chưa reindex Cortex.
>
> **Cập nhật TASK-027:** phần freeze/isolate cho TASK-001 đã hoàn tất — patch 7 file staged sau rewrite, Reviewer **APPROVED**, QA **PASS**, đã commit `261e9b7`. TASK-007 hiện **AUTHORIZATION_REQUIRED** cho các thay đổi runtime còn lại và reindex Cortex.
>
> **Cập nhật TASK-024:** local `main` đã rewrite sang `a4b7a25`; lịch sử local không còn `debug/trade-bulk.html` hoặc 10 ảnh debug. Remote vẫn chứa artifact cho đến `TASK-026`. Chưa push, chưa reindex Cortex.

### 3.1. Freeze

1. Thông báo freeze feature work; chỉ cho phép sửa lỗi review.
2. Không merge PR khác trong thời gian freeze.
3. Tạo snapshot:
   - `git diff > backup/working-tree.patch`
   - `git bundle create backup/repo.bundle --all`
   - Lưu `git status --short`.
4. Ghi lại baseline test: `npm run check` → 177 pass (2026-11-01).

### 3.2. Phân nhóm thay đổi

| Nhóm | File | Nội dung review |
|---|---|---|
| A | `features/icon-session.js`, `features/icon-session.test.js`, `lib/ui-lock.js`, `lib/ui-lock.test.js` | Background ICON one-shot + UI lock |
| B | `features/icon-buy/tasks.js`, `features/icon-buy/tasks.test.js` | `/stop` baseline, task cleanup |
| C | `features/controller.js` | Tích hợp ICON session, command flow |
| D | `features/icon-buy/runner.js`, `order.js`, `patterns.js`, test | Purchase flow, cancellation |
| E | `features/upgrade/loop.js`, `runner.js` | Upgrade outcome/recovery |
| F | `features/buy/cycle.js`, `outcome.js` | Buy completion |
| G | `config.json`, `features/config.js`, `README.md`, `agent.test.js` | Config/docs/test |

### 3.3. Review từng nhóm

Với mỗi nhóm:

1. Đọc diff đầy đủ; đối chiếu behavior cũ/mới.
2. Kiểm tra:
   - Race condition (ICON nền vs buy/upgrade).
   - Thứ tự release/acquire UI lock.
   - Error path có log và không nuốt lỗi.
   - Không đổi timeout/regex ngoài ý muốn.
3. Chạy test liên quan.
4. Commit nhỏ, message rõ:
   - `feat(icon): add background one-shot session`
   - `feat(ui): add FIFO Telegram UI lock`
   - `feat(icon): baseline /stop tasks before purchase`
   - `refactor(controller): wire icon session and task cleanup`
   - `fix(icon): harden order wait/cancel`
   - `fix(upgrade): settle outcome after frame loss`
   - `fix(buy): handle completion edge cases`
   - `chore(config): document new icon task slots`
5. Sau mỗi commit: `npm run check`.

### 3.4. PR và review độc lập

- Push branch `release/working-tree-review`.
- Mở PR; yêu cầu reviewer không phải tác giả.
- PR description: risk, test, rollback, ảnh hưởng flow.
- Không merge nếu thiếu review hoặc test fail.
- Human merge (theo workflow).

### 3.5. Reindex Cortex

1. Sau khi merge, chạy `cortex_code_reindex` cho repo `f04-agent`.
2. Chờ index xong; kiểm tra commit hash = HEAD.
3. Chạy lại `cortex_detect_changes` trên working tree sạch → không còn thay đổi.
4. Kiểm tra các symbol mới (`createIconSession`, `createUiLock`, `readStopMenu`) có trong graph.
5. Cập nhật `docs/backlog.md`, `docs/roadmap.md`, `docs/tasks/README.md` trạng thái.

### 3.6. CI tối thiểu

- Trong lúc chờ TASK-014, thêm workflow tạm:
  - `npm ci`
  - `npm run check`
  - secret scan cơ bản
- Branch protection: require PR + pass check.

## 4. Test plan

| Loại | Kiểm tra | Kỳ vọng |
|---|---|---|
| Baseline | `npm run check` trước freeze | 174 pass |
| Per-commit | `npm run check` sau mỗi commit | 174 pass |
| Full | `npm run check` trên HEAD | 174+ pass |
| Git | `git status --short` | Sạch |
| Git | `git log --oneline` | Các commit nhỏ, message rõ |
| Cortex | Reindex | Commit hash = HEAD |
| Cortex | `cortex_detect_changes` | Không còn critical |
| Graph | Symbol mới xuất hiện | Có trong index |
| Smoke | 6 lệnh: `/startagent`, `/startmua`, `/startnang`, `/starticon`, `/stopagent`, `/resetagent` | Không regression |
| Security | Không có artifact debug mới | Pass |

## 5. Rollback

- Giữ branch và bundle backup.
- Nếu grouping sai: `git reset --soft <snapshot>` và chia lại; không rewrite history đã push.
- Nếu một commit gây regression: revert commit đó, không revert cả PR.
- Nếu reindex sai: chạy lại reindex; không sửa graph thủ công.

## 6. Definition of Done

- `git status` sạch.
- PR được review độc lập và human merge.
- 174+ test pass trên HEAD.
- Cortex index khớp HEAD; symbol mới có trong graph.
- `cortex_detect_changes` không còn critical.
- Backlog/roadmap/task board cập nhật trạng thái.
- CI tối thiểu chạy trên PR.

## 7. Trạng thái 2026-11-02 — AUTHORIZATION_REQUIRED

- TASK-001 patch đã commit/push (`261e9b7`, `f22cf96`); freeze TASK-001 không còn giữ working tree.
- Runtime còn unstaged: `config.json`, `features/upgrade/loop.js`, `features/upgrade/runner.js`.
- Fresh clone `f22cf96` chạy `npm run check` = **188/190**; 2 test fail:
  - `features/upgrade/runner.js must consume /starticon ...`
  - `pivotMasterToUpgrade` thiếu tham số `ui`.
- Đây là **Critical risk** (67 symbol, 12 file, 32 flow theo Cortex) → cần Owner Decision + review độc lập trước khi commit.
- **Quyết định cần owner:** cho phép commit/push runtime fixes (không gồm secret) để CI xanh trở lại.
