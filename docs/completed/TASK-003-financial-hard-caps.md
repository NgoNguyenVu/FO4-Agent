# TASK-003 — Financial hard caps (Stage A: spend guard) — COMPLETED 2026-11-13

- **Priority:** P0 — Financial integrity
- **Branch:** `ai/auto-cycle-v1` (không đụng `main`)
- **Trạng thái:** **DONE (Stage A)** — Reviewer APPROVED, QA PASS, Quality Gate **A (90/100)**
- **Task gốc:** [docs/tasks/TASK-003-financial-hard-caps.md](../tasks/TASK-003-financial-hard-caps.md)
- **Review:** [TASK-003-review-2026-11-13.md](../reviews/TASK-003-review-2026-11-13.md)
- **QA:** [TASK-003-qa-2026-11-13.md](../reviews/TASK-003-qa-2026-11-13.md)

## 1. Vấn đề

Agent không có hard cap tổng BP theo run/ngày/tuần; một vòng lặp lỗi hoặc script debug có thể tiêu BP ngoài kiểm soát. Không có reservation/unknown handling, không có live gate nhiều lớp, không có kill switch.

## 2. Thay đổi

| File | Nội dung |
|---|---|
| `lib/spend-guard.js` **(mới)** | `assertCanSpend()` (run/day/week/feature, cap 0 = fail closed), `reserve/commit/release`, `markUnknown` (giữ in-flight + chặn giao dịch mới), `halt/reset`, `getSnapshot`; idempotency key; khóa đồng bộ chống race trong process; `checkLiveGate()` (enabled + env + flag + profile + confirmation); `validateSpendLimits()`; khóa ngày/ISO week theo UTC |
| `lib/spend-guard.test.js` **(mới)** | 13 test: boundary đúng/vượt cap, cap 0, cross-feature daily, cap feature, release/commit, unknown, race sát cap, halt/reset, idempotency, snapshot, live gate, ISO week |
| `features/config.js` | Block `spendLimits` (mặc định `enabled:false`, mọi cap 0) và `liveTrading` (`enabled:false`, `dryRunDefault:true`, allowlist rỗng); validate cả hai; `liveTrading.dryRunDefault` bắt buộc `true` |

## 3. Bằng chứng

- `npm test` → **267/267 pass** (254 + 13 test mới), 0 fail.
- `validateConfig()` pass với config hiện tại; guard mặc định **không enforcement** → không đổi hành vi giao dịch.
- `cortex_detect_changes` (repo `f04-agent`): risk **low**, 3 file, **0 flow** bị ảnh hưởng.

## 4. Quality Gate — A (90/100)

| Tiêu chí | Điểm |
|---|---|
| Test & bằng chứng | 24/25 |
| Phạm vi & regression | 20/20 |
| Bảo mật & an toàn dữ liệu | 20/20 |
| Tài liệu & vận hành | 12/15 |
| Rollback | 8/10 |
| Kiểm soát blast radius | 6/10 (chưa nối runtime nên blast thấp, nhưng chưa có integration test) |

## 5. Rollback

- Revert 3 file; xóa 2 field `spendLimits`/`liveTrading` khỏi config là đủ về hành vi cũ.
- Không có migration dữ liệu; guard chưa ghi state.

## 6. Follow-up (Stage B — cần Owner Decision)

1. Owner đặt cap thật (`perRunBP`, `perDayBP`, `perWeekBP`, `perFeatureBP`) và duyệt bật `enabled`.
2. Nối `assertCanSpend` trước cycle/batch; `reserve` trước mỗi đơn; `commit`/`release` theo outcome; `markUnknown` khi timeout.
3. Reservation bền vững qua restart bằng journal TASK-002; reconcile trước khi mở lại quyền mua.
4. Log snapshot chi tiêu mỗi chu kỳ; runbook khi `halt`.
5. Bật live gate `--live` + env + profile + confirmation cho script debug (`debug/run-icon-live.js`).

## 7. Commit

`COMMIT_AUTHORIZED` (Standard Task, không đổi hành vi live) — commit riêng trên `ai/auto-cycle-v1`; hash ghi trong `docs/completed/CYCLE-2026-11-13.md`.
