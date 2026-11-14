# TASK-043 — Integration test process lock — COMPLETED 2026-11-14

- **Priority:** P1 — Reliability
- **Branch:** `ai/auto-cycle-v3`
- **Trạng thái:** **DONE** — Reviewer APPROVED, QA PASS, Quality Gate **A (94/100)**
- **Task gốc:** [TASK-043](TASK-043-process-lock-integration.md) · Follow-up của [TASK-005](TASK-005-worker-state-lock.md)
- **Review:** [TASK-043-review-2026-11-14.md](../reviews/TASK-043-review-2026-11-14.md)
- **QA:** [TASK-043-qa-2026-11-14.md](../reviews/TASK-043-qa-2026-11-14.md)

## 1. Vấn đề

Process lock Stage A mới được test trong một process. Chưa có bằng chứng rằng hai **process thật** không thể cùng giữ lock, rằng lock stale được tiếp quản, và heartbeat thực sự gia hạn lease.

## 2. Thay đổi

| File | Nội dung |
|---|---|
| `lib/__fixtures__/lock-child.js` **(mới)** | Process con giữ lock, nhận IPC `heartbeat`/`release`/`exit`, báo kết quả về parent |
| `lib/worker-registry.integration.test.js` **(mới)** | 4 test: đua lock, stale takeover, live lock chặn, heartbeat + release |

Không thay đổi runtime.

## 3. Bằng chứng

| # | Case | Kết quả |
|---|---|---|
| 1 | Hai process đua lock | đúng một `acquired`, process kia `AGENT_LOCKED` |
| 2 | Lock stale (pid 0, lease quá khứ) | tiếp quản thành công |
| 3 | Lock tươi của pid sống | bị chặn `AGENT_LOCKED` |
| 4 | Heartbeat + release | `leaseUntil` tăng; sau release process kế tiếp acquire được |

- `node --test lib/worker-registry.integration.test.js` → **4/4 pass**, chạy 3 lần liên tiếp không flaky.
- `npm test` → **306/306 pass**.
- `npm run scan:secrets` → pass.

## 4. Quality Gate — A (94/100)

| Tiêu chí | Điểm |
|---|---|
| Test & bằng chứng | 25/25 |
| Phạm vi & regression | 20/20 (không đổi runtime) |
| Bảo mật & an toàn dữ liệu | 19/20 |
| Tài liệu & vận hành | 12/15 |
| Rollback | 10/10 |
| Kiểm soát blast radius | 8/10 (test-only) |

## 5. Rollback

Xóa 2 file test/fixture; không ảnh hưởng runtime.

## 6. Follow-up

- Có thể bổ sung case SIGKILL thật giữa lúc giữ lock khi có môi trường CI phù hợp.
