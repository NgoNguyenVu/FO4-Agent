# TASK-039 — ICON continuous-buy + inventory gate refactor

## Thông tin

- **Status:** **AUTHORIZATION_REQUIRED** — Reviewer APPROVED (code) + QA PASS (2026-11-14, retro-review); chờ Owner quyết định `purchaseTimeoutSeconds = 0`. Xem [authorization request](../authorizations/authorization-request-2026-11-14-task-039.md), [review](../reviews/TASK-039-review-2026-11-14.md), [qa](../reviews/TASK-039-qa-2026-11-14.md).
- **Authorization:** Owner APPROVED cho Review/QA; cần quyết định tài chính chính thức trước khi commit.
- **Priority:** P0
- **Risk:** High
- **Effort:** M
- **Dependency:** TASK-007 — **DONE** (`9542347`), baseline `config.json` đã chốt
- **Owner đề xuất:** ICON flow + Financial integrity
- **Nguồn:** Owner directive 2026-11-05 (code do AI bên ngoài viết)

## 1. Mục tiêu

Đưa khối logic ICON mới (mua bù liên tục, theo dõi đơn có sẵn, chỉ hủy khi vị trí xác nhận, gate kho trước khi nâng) vào phạm vi quản trị task, review và QA độc lập trước khi commit.

## 2. Phạm vi file (working tree)

### Runtime

| File | Thay đổi chính |
|---|---|
| `config.json` | `maxPriceBP 888888`, `ovrMin 118`, `minRatio 74`, `cancelPositionAbove 3`, `purchaseTimeoutSeconds 0`, `monitorExistingOrders true` |
| `features/config.js` | Default + validate `purchaseTimeoutSeconds` không âm |
| `features/controller.js` | `checkMasterInventory()` gate trước khi pivot sang nâng |
| `features/icon-buy/runner.js` | `cancelBadPositions`, `monitorExistingOrders`, `captureStopBaselineWithRetry`; `/stop` không bấm nút dừng |
| `features/icon-buy/tasks.js` | `getTaskIdentity`, `readButtonsInMessages`, baseline theo task-key |
| `features/icon-buy/order.js` | Deadline vô hạn khi timeout = 0, heartbeat 60s |
| `features/icon-buy/patterns.js` | `getPositionAction` trả `unknown`, không hủy khi thiếu vị trí |
| `features/icon-buy/ttcn.js` | Chỉ hủy đơn có vị trí xác nhận vượt ngưỡng |
| `features/icon-buy/menu.js`, `favorites.js` | Chỉnh nhỏ |
| `features/upgrade/runner.js` | `checkInventoryIcons()` + lỗi `INVENTORY_READ_UNCONFIRMED` |
| `features/upgrade/patterns.js` | `countInventoryIcons()` |
| `README.md` | Cập nhật hành vi ICON |

### Test

`agent.test.js`, `features/autonangcap.test.js`, `features/icon-buy/patterns.test.js`, `features/icon-buy/tasks.test.js`.

## 3. Rủi ro đã biết (từ REPOSITORY AUDIT 2026-11-05)

1. Tăng hạn mức: `maxPriceBP` 888.888 BP; `minRatio` 74; không có hard cap tổng BP (`TASK-003` còn Todo).
2. `purchaseTimeoutSeconds = 0` → chờ vô hạn, giữ task vô thời hạn.
3. Không hủy đơn khi không đọc được vị trí → giữ đơn ở vị trí xấu.
4. `monitorExistingOrders` có thể bám nhầm task MUA thủ công cùng grade/quantity.
5. `checkInventoryIcons` thêm nhánh chờ tới 8 phút trong vòng lặp chính.
6. Thiếu test hành vi cho `monitorExistingOrders`, `captureStopBaselineWithRetry`, nhánh `INVENTORY_READ_UNCONFIRMED`, chờ vô hạn.

## 4. Điều kiện vào Review

- ~~TASK-007 đã đóng hoặc đã chốt baseline `config.json`.~~ → **Đã thỏa:** TASK-007 DONE tại `9542347`.
- Không còn staging lẫn với thay đổi governance `.ai/`, `docs/` ngoài phạm vi task.

## 5. Definition of Done

- Reviewer **APPROVED** + QA **PASS** trên đúng diff TASK-039.
- Không đụng file ngoài allowlist.
- Có authorization cho thay đổi tham số tài chính (nếu vượt giá trị đã duyệt).
- Commit riêng, không gộp TASK-007.
