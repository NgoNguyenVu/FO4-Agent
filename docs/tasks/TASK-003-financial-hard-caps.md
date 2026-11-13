# TASK-003 — Financial hard caps

## Thông tin

- **Priority:** P0
- **Risk:** High
- **Effort:** M
- **Dependency:** TASK-007; Stage B phụ thuộc TASK-002
- **Status:** **DONE (Stage A)** — 2026-11-13, branch `ai/auto-cycle-v1`; Reviewer APPROVED + QA PASS; Quality Gate A (90/100). Xem [completed/TASK-003-financial-hard-caps.md](../completed/TASK-003-financial-hard-caps.md). Stage B (nối runtime + bật cap) cần Owner Decision.
- **Owner đề xuất:** Financial integrity + Platform

## 1. Mục tiêu

Đặt giới hạn chi tiêu cứng theo run/ngày/tuần, mặc định dry-run và bắt buộc confirmation gate cho giao dịch thật, để một lỗi vòng lặp hoặc script debug không thể tiêu BP ngoài kiểm soát.

Phạm vi:

- Hard cap theo run, ngày, tuần.
- Reservation trước khi đặt đơn; commit khi xác nhận; release khi thất bại/hủy.
- Dry-run mặc định.
- Live gate: env + flag + profile allowlist.
- Kill switch khi chạm cap.

Không thuộc phạm vi:

- Journal bền vững đầy đủ (TASK-002).
- Worker state machine (TASK-005).
- Thay đổi logic chọn cầu thủ.

## 2. Bằng chứng

- README dòng 40–42: agent **không áp đặt lifetime BP budget**; bot/account balance quyết định.
- `config.json` chỉ có `maxPriceBP` (giá mỗi cầu thủ) và `maxPerCycle` (số cầu thủ), không có tổng BP theo run/ngày.
- `debug/run-icon-live.js` có thể đặt đơn thật khi đặt `FO4_CONFIRM_LIVE_ICON=YES`; không có dry-run mặc định.
- `features/icon-session.js` chỉ giới hạn concurrency/one-shot, không giới hạn tổng BP.
- `features/buy/cycle.js` và `features/upgrade/runner.js` không kiểm tra tổng chi trước khi bắt đầu.
- Không có kill switch toàn cục khi chi tiêu bất thường.

## 3. Thiết kế đề xuất

### 3.1. Config mới

```json
{
  "spendLimits": {
    "perRunBP": 5000000,
    "perDayBP": 15000000,
    "perWeekBP": 50000000,
    "perFeatureBP": {
      "buy": 8000000,
      "upgrade": 10000000,
      "icon": 3000000
    }
  },
  "liveTrading": {
    "enabled": false,
    "requireConfirmation": true,
    "allowedProfiles": ["fo4-live"],
    "dryRunDefault": true
  }
}
```

- `0` hoặc thiếu = fail closed (không cho chi).
- Cap là config, không phải env; đổi cap phải sửa config + restart + log.
- Env chỉ có thể **giảm** cap, không thể tăng hoặc bypass.

### 3.2. Module mới

`lib/spend-guard.js`:

- `reserve({ feature, amountBP, idempotencyKey, context })`
- `commit(reservationId, { orderId })`
- `release(reservationId, reason)`
- `assertCanSpend({ feature, amountBP })`
- `getSnapshot()` — tổng đã chi, đang giữ, còn lại.
- `halt(reason)` — kill switch toàn cục.

Luồng:

```text
assertCanSpend
   │
   ▼
reserve (in-flight)
   │
   ├── gửi lệnh thất bại ──► release
   ├── bot xác nhận ──────► commit
   └── timeout/unknown ───► giữ reservation, chặn mua mới
```

### 3.3. Stage A — Emergency cap (Phase 0)

Không phụ thuộc journal:

- Cap theo run/ngày tính từ bộ đếm trong memory + config.
- Dry-run mặc định cho mọi script debug.
- Live gate:
  - `liveTrading.enabled === true`
  - env `FO4_LIVE_TRADING=YES`
  - CLI flag `--live`
  - profile hiện tại nằm trong `allowedProfiles`
  - confirmation tương tác nếu `requireConfirmation`
- Thiếu bất kỳ điều kiện nào → fail closed, log lý do, không gửi lệnh.

### 3.4. Stage B — Ledger-backed cap (sau TASK-002)

- Tổng chi lấy từ purchase journal, không từ memory.
- Reservation được journal ghi để restart vẫn giữ.
- Reconcile xong mới mở lại quyền mua.
- Cap tuần tính theo ISO week; cap ngày theo timezone cấu hình.

### 3.5. Kill switch

- Chạm cap → `halt("daily-cap")`, dừng worker hiện tại, không nhận lệnh mua mới.
- `/stopagent` cũng gọi `halt`.
- Chỉ human reset bằng restart + sửa config hoặc lệnh CLI có audit.
- Không auto-reset theo ngày nếu còn reservation `unknown`.

## 4. Patch plan (không sửa code trong phase này)

1. Thêm schema config `spendLimits`, `liveTrading`.
2. Thêm `lib/spend-guard.js` + test.
3. Instrument `features/buy/cycle.js`: assert trước cycle, reserve trước start, commit/release theo outcome.
4. Instrument `features/icon-buy/runner.js` và `order.js`: assert trước batch, reserve theo từng order.
5. Instrument `features/upgrade/runner.js`: assert trước upgrade, reserve theo target.
6. `debug/run-icon-live.js`: dry-run mặc định; chỉ live khi đủ 4 điều kiện.
7. `features/controller.js`: hiển thị snapshot chi tiêu; halt khi guard báo.
8. README: bảng cap, dry-run, live gate, reset procedure.

## 5. Test plan

| Loại | Case | Kỳ vọng |
|---|---|---|
| Boundary | Chi đúng bằng cap | Cho phép |
| Boundary | Chi vượt cap 1 BP | Chặn, halt |
| Boundary | Nhiều feature cộng lại vượt cap ngày | Chặn |
| Boundary | Cap = 0 | Fail closed |
| Reservation | Reserve rồi release | Không bị tính vào tổng chi |
| Reservation | Reserve rồi commit | Tính đúng một lần |
| Reservation | Reserve rồi timeout | Giữ in-flight, chặn mua mới |
| Race | Hai order reserve đồng thời sát cap | Chỉ một order được phép |
| Restart | Stage B: restart giữ reservation | Không double-spend |
| Dry-run | Chạy không có live gate | Không gửi lệnh, có log planned |
| Live gate | Thiếu env | Từ chối |
| Live gate | Thiếu flag | Từ chối |
| Live gate | Sai profile | Từ chối |
| Live gate | Env tự tăng cap | Không có tác dụng |
| Kill switch | Chạm cap | Worker dừng, không nhận lệnh mới |
| Regression | `npm run check` | 174+ test pass |

## 6. Rollback

- Đặt `liveTrading.enabled=false` và `spendLimits` về giá trị an toàn; agent vẫn chạy dry-run.
- Revert module/guard theo commit; giữ journal/reservation để đối soát.
- Không xóa log halt.
- Nếu cap chặn nhầm: human nâng cap có audit, không tắt guard.

## 7. Definition of Done

- Có hard cap run/ngày/tuần; vượt cap dừng cứng.
- Dry-run là mặc định; live cần đủ env + flag + profile + confirmation.
- Không có đường tắt bằng env để tăng cap.
- Có test boundary/race/restart.
- Có snapshot chi tiêu trong log và README.
