# TASK-053 — TTCN: xử lý đơn kế tiếp khi đơn trước bị xóa (không lệch index)

## Thông tin

- **Priority:** P0
- **Risk:** Medium (thay đổi cách chọn card TTCN để hủy)
- **Effort:** M
- **Dependency:** TASK-045 (mock harness), TASK-039 (WONT_DO — không đụng `purchaseTimeoutSeconds`)
- **Status:** **DONE** — Cycle v6 (2026-11-16), branch `ai/auto-cycle-v6`.
- **Owner đề xuất:** Reliability / Live-ops
- **Nguồn:** Log live `%LOCALAPPDATA%\FO4PurchaseAgent\agent.log` (2026-11-16 03:10–03:37) + audit `features/icon-buy/ttcn.js`, `patterns.js`.

## 1. Hiện tượng thực tế

- 03:10:21 bot phát hiện đơn vị trí xấu `101007512` (vị trí 27) và hủy thành công qua TTCN lúc 03:10:34.
- Đơn kế tiếp ở vị trí 4 vẫn còn trên TTCN nhưng bot không xử lý gì.
- TTCN **không hiển thị vị trí**; vị trí chỉ có trong log "Đã đặt mua thành công … Vị trí mua: N".
- `selectOrderToCancel` cũ chọn `matches.at(-1)` sau khi loại trừ baseline; nếu orderId đã ghi nhớ bị xóa khỏi TTCN thì trả `null` vĩnh viễn (`notFound`), và vòng lặp chỉ đi theo danh sách `successes` — đơn không có trong danh sách bị bỏ sót.

## 2. Sửa lỗi

| File | Nội dung |
|---|---|
| `features/icon-buy/patterns.js` | Thêm `planTtcnCancellations`: ánh xạ target → card theo `orderId`, fallback theo `mã + grade` khi orderId đã biến mất; chống trùng card; sắp theo thứ tự dòng TTCN. |
| `features/icon-buy/ttcn.js` | `cancelIconOrders` giữ target theo khóa (không theo index), đọc lại **toàn bộ** danh sách sau mỗi lần hủy, lặp tới khi hết target; target không còn card → `notFound` và log vị trí. |
| `features/icon-buy/ttcn.js` | `readTtcnOrders` đọc nhiều trang + cuộn `#cancelList` tới cuối, gộp theo `orderId` (dùng `mergeTtcnOrderPages`). |

## 3. Vì sao an toàn

- Không đổi `config.json`, không đổi ngưỡng `cancelPositionAbove = 3`.
- Chỉ hủy target đã có vị trí xác nhận > ngưỡng (giữ nguyên `decideCancelTargets`).
- Fallback chỉ dùng card cùng `mã + grade + orderType 1 + nút Hủy`; card của phiên khác vẫn bị loại nếu còn card mới.

## 4. Test plan

| # | Case | Kỳ vọng |
|---|---|---|
| 1 | Danh sách có đơn 27 + đơn 4 | Plan trả `[27, 4]` |
| 2 | Xóa đơn 27, quét lại | Plan trả `[4]`, không lệch index |
| 3 | Xóa cả hai | Plan rỗng, không sinh card ảo |
| 4 | orderId cũ đã xóa, còn card mới cùng mã | Fallback đúng card mới (kể cả trùng baseline) |
| 5 | Hai target cùng mã | Không ánh xạ vào cùng một card |

## 5. Definition of Done

- Reviewer APPROVED + QA PASS; `npm test` 100%, `scan:secrets` + `scan:history` pass.
- Không push/merge `main`; chỉ push `ai/auto-cycle-v6`.
