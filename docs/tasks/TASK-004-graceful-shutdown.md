# TASK-004 — Graceful shutdown

## Thông tin

- **Priority:** P0
- **Risk:** High
- **Effort:** M
- **Dependency:** TASK-007
- **Status:** **DONE (Stage A + Stage B)** — Stage A 2026-11-13 (`3b864e7`); Stage B 2026-11-13 trên `ai/auto-cycle-v2` — integration test process-level SIGINT/SIGTERM + README runbook. Reviewer APPROVED + QA PASS; Gate B (83/100 Stage A), A (93/100 Stage B). Xem [completed/TASK-004-graceful-shutdown.md](../completed/TASK-004-graceful-shutdown.md) và [completed/TASK-004B-signal-integration-runbook.md](../completed/TASK-004B-signal-integration-runbook.md).
- **Owner đề xuất:** Platform / Reliability

## 1. Mục tiêu

Bắt SIGINT/SIGTERM/uncaught exception, dừng worker do agent sở hữu, đóng Playwright context và flush log trước khi thoát, để Ctrl+C hoặc crash không để lại Chromium/worker treo.

Phạm vi:

- `agent.js`
- `features/controller.js`
- `lib/browser-session.js`
- `features/icon-session.js`
- `features/buy/cycle.js`, `features/upgrade/runner.js` (gọi stop functions)
- `features/agent-log.js`

Không thuộc phạm vi:

- Worker registry/lease (TASK-005).
- Thay đổi logic mua/nâng.

## 2. Bằng chứng

- Cortex grep `SIGINT|SIGTERM|process.on(` **không có kết quả**.
- `agent.js` chỉ set `process.exitCode = 1`; không đóng context, không dừng worker, không flush log.
- Không có health check hoặc heartbeat định kỳ.
- Chỉ `features/agent-log.js` ghi disk; `appendFileSync` nên rủi ro mất log thấp, nhưng không có dấu hiệu shutdown.
- `features/icon-session.js` có `stopAndWait()` nhưng không được gọi khi process nhận signal.
- `features/buy/cycle.js` có `stopPurchaseWorker()`, `features/upgrade/runner.js` có `stopUpgradeWorker()` nhưng không có lifecycle hook.

## 3. Thiết kế đề xuất

### 3.1. Module mới

`lib/lifecycle.js`:

```text
starting ──► running ──► stopping ──► stopped
                  │
                  └──► failed
```

- `register({ onShutdown })` — đăng ký handler một lần.
- `shutdown(reason, exitCode)` — idempotent; chỉ chạy một lần.
- `heartbeat()` — ghi `state/heartbeat.json` mỗi 30s (pid, startedAt, lastCommand, mode).
- `isStopping()` — để vòng lặp controller thoát sạch.

### 3.2. Thứ tự shutdown

1. Set state `stopping`; ngừng nhận lệnh mới.
2. Abort icon session: `iconSession.stopAndWait("shutdown", 10_000)`.
3. Dừng worker do agent sở hữu:
   - Buy: `stopPurchaseWorker()`.
   - Upgrade: `stopUpgradeWorker()`.
   - ICON: `tasks.stopTask()` theo baseline.
4. Đóng mini-app nếu đang mở.
5. Đóng page/context/browser.
6. Flush/close log; ghi event `shutdown`.
7. Release journal/worker lock (nếu có).
8. Exit với code:
   - `0` — shutdown chủ động.
   - `130` — SIGINT.
   - `143` — SIGTERM.
   - `1` — lỗi không phục hồi.

Không dừng worker không thuộc sở hữu agent (task thủ công trong baseline).

### 3.3. Signal handling

- `SIGINT`, `SIGTERM`, `SIGBREAK` (Windows).
- `uncaughtException`, `unhandledRejection`: log stack, cố gắng cleanup, exit non-zero.
- Handler chỉ gọi `void shutdown(...)`; không await trực tiếp trong signal handler.
- Timeout cứng 20s: nếu cleanup chưa xong, log và `process.exit(exitCode)`.
- Bấm Ctrl+C lần hai: bỏ qua cleanup, exit ngay với code 130.

### 3.4. Tích hợp controller

- Vòng `while (true)` kiểm tra `lifecycle.isStopping()` ở đầu mỗi iteration.
- Trong các wait dài, dùng abort signal hoặc kiểm tra cờ sau mỗi bước an toàn.
- `runAgent()` trả về khi stopping; `agent.js` không retry nếu reason là shutdown.

### 3.5. Health heartbeat

- Ghi `state/heartbeat.json` mỗi 30s.
- Nội dung: `pid`, `startedAt`, `lastHeartbeatAt`, `mode`, `activeWorkerId`, `version`.
- Dùng cho runbook/ops; không chứa PII.

## 4. Patch plan (không sửa code trong phase này)

1. Thêm `lib/lifecycle.js` + test.
2. `agent.js`: đăng ký handler trước `runAgent()`; map exit code.
3. `features/controller.js`: truyền `lifecycle`; kiểm tra stopping; gọi cleanup.
4. `features/icon-session.js`: expose `stopAndWait` đã có; đảm bảo idempotent.
5. `features/buy/cycle.js`, `features/upgrade/runner.js`: đảm bảo stop function idempotent và có timeout.
6. `lib/browser-session.js`: expose `closeBrowser()` idempotent.
7. `features/agent-log.js`: thêm `flush()`/`close()` (dù appendFileSync).
8. README: runbook Ctrl+C, exit code, heartbeat.

## 5. Test plan

| Loại | Case | Kỳ vọng |
|---|---|---|
| Unit | `shutdown()` gọi hai lần | Chỉ cleanup một lần |
| Unit | Cleanup lâu quá timeout | Force exit đúng code |
| Unit | `isStopping()` sau shutdown | `true` |
| Integration | Gửi SIGINT khi idle | Đóng browser, exit 130 |
| Integration | Gửi SIGINT khi ICON đang chạy | Icon session abort, task dừng, exit 130 |
| Integration | Gửi SIGTERM khi buy worker chạy | Stop worker, đóng browser, exit 143 |
| Integration | Ctrl+C lần hai | Exit ngay, không treo |
| Failure | `uncaughtException` | Log stack, cleanup, exit 1 |
| Failure | Browser đã chết | Cleanup vẫn hoàn tất, không throw |
| Ownership | Có task thủ công trong baseline | Không dừng task đó |
| Regression | `npm run check` | 174+ test pass |

## 6. Rollback

- Revert `lib/lifecycle.js` và các hook; quay lại hành vi cũ.
- Giữ runbook “kill process + đóng Chromium thủ công” trong lúc rollback.
- Không để handler cũ đăng ký trùng; nếu cần, dùng feature flag `lifecycle.enabled=false`.

## 7. Definition of Done

- Ctrl+C không còn Chromium/worker treo.
- Log có event `shutdown` và lý do.
- Worker do agent sở hữu dừng trước khi exit.
- Exit code đúng cho SIGINT/SIGTERM/lỗi.
- Có heartbeat file và runbook.
- Có test signal/cleanup/timeout.
