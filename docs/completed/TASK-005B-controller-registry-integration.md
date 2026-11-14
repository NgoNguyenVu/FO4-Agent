# TASK-005B — Controller dùng worker registry làm source of truth — COMPLETED 2026-11-13

- **Priority:** P0 — Concurrency / Data integrity
- **Branch:** `ai/auto-cycle-v2`
- **Trạng thái:** **DONE** — Reviewer APPROVED, QA PASS, Quality Gate **B (82/100)**
- **Task gốc:** [TASK-005](TASK-005-worker-state-lock.md) · [TASK-005B](TASK-005B-controller-registry-integration.md)
- **Review:** [TASK-005B-review-2026-11-13.md](../reviews/TASK-005B-review-2026-11-13.md)
- **QA:** [TASK-005B-qa-2026-11-13.md](../reviews/TASK-005B-qa-2026-11-13.md)

## 1. Vấn đề

Stage A tạo registry nhưng controller vẫn suy luận worker từ chat text. Registry chỉ là nơi ghi state, không tham gia quyết định → không đóng được lỗ hổng double-start/restart.

## 2. Thay đổi

| File | Nội dung |
|---|---|
| `lib/worker-registry.js` | `concurrencyGroup` (`exclusive`/`background`); `beginStart` tính cả worker `starting`; `workersConflict`; `resolveUnknown`; `getWorkerRegistry`/`resetSharedWorkerRegistryForTests` |
| `lib/worker-session.js` **(mới)** | Adapter session: `tryBegin` (trả `null` khi bị chặn), `markRunning`, `markUnknown`, `stop`, `reconcileOnStartup`, `listActive`, `activeWorkerIds`, `blockedReason` |
| `lib/worker-registry.test.js` | +7 test: concurrency group, unknown chặn background, resolveUnknown, singleton |
| `lib/worker-session.test.js` **(mới)** | 10 test: vòng đời, idempotent, song song, block, reconcile/adopt/stale |
| `agent.js` | Dùng `getWorkerRegistry()` (singleton) thay vì tạo instance riêng |
| `features/controller.js` | Reconcile lúc khởi động/khôi phục/`/startagent`; đăng ký worker quanh buy–upgrade–icon; heartbeat có `activeWorkerId`; lỗi không xác định → `unknown`; shutdown nhả worker |

## 3. Bằng chứng

- `npm test` → **284/284 pass** (267 + 17 test mới), 0 fail, 0 cancelled.
- `node --check` 4 file runtime → pass.
- `cortex_detect_changes` (repo `f04-agent`): risk **high**, 6 file, 11 symbol, 6 flow; thay đổi additive, không đổi quyết định mua/nâng.

## 4. Quality Gate — B (82/100)

| Tiêu chí | Điểm |
|---|---|
| Test & bằng chứng | 21/25 (thiếu integration Playwright) |
| Phạm vi & regression | 18/20 |
| Bảo mật & an toàn dữ liệu | 19/20 (fail-closed, unknown chặn) |
| Tài liệu & vận hành | 11/15 (runbook ở TASK-004B) |
| Rollback | 8/10 |
| Kiểm soát blast radius | 5/10 (controller không có integration test) |

## 5. Rollback

- Revert 6 file của task; xóa `<LOCALAPPDATA>/FO4PurchaseAgent/state/workers.json` nếu state mới gây `unknown`.
- Không migration; không đổi dữ liệu giao dịch.

## 6. Follow-up

1. CLI `scripts/resolve-worker.js` để resolve `unknown` không cần sửa file tay.
2. Integration test Playwright cho vòng buy (begin → click → running → stopped).
3. Runbook README (đang làm trong TASK-004B).
