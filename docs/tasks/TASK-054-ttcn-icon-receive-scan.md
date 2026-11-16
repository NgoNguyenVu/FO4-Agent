# TASK-054 — TTCN: quét toàn bộ danh sách, nhận ICON "Nhận" và bỏ qua PHÔI

## Thông tin

- **Priority:** P0
- **Risk:** Medium (bấm "Nhận" trên mini-app)
- **Effort:** M
- **Dependency:** TASK-053 (đọc toàn bộ danh sách), TASK-045 (harness test)
- **Status:** **DONE** — Cycle v6 (2026-11-16), branch `ai/auto-cycle-v6`.
- **Nguồn:** Log live 2026-11-16 + audit `features/icon-buy/ttcn.js`, `patterns.js`, `order.js`.

## 1. Hiện tượng thực tế

- TTCN có 2 loại dòng: **đang đặt mua** (nút "Hủy") và **đã mua thành công** (nút "Nhận", không có thông báo chat).
- Bot cũ **không có xử lý "Nhận"** ở bất kỳ đâu — chỉ lọc `/Hủy/`.
- Danh sách có thể dài; các đơn nằm từ hàng thứ 3 trở xuống bị bỏ sót nếu chỉ đọc phần render sẵn.
- Dòng **PHÔI** cũng có nút "Nhận"; nếu không lọc theo mùa sẽ nhận nhầm.

## 2. Sửa lỗi

| File | Nội dung |
|---|---|
| `features/icon-buy/patterns.js` | `selectIconOrdersToReceive`: chỉ chọn `orderType 1`, action "Nhận", `isIconSeason(season)` (loại ICONTM/TKI/26TOTS), có `orderId`; lọc thêm `players`/`grade` khi cần. `isReceiveAction`. |
| `features/icon-buy/ttcn.js` | `readTtcnOrders` cuộn/gộp toàn bộ danh sách; `receiveIconOrders` mở TTCN, gọi `receiveFromPlan`; `clickReceiveOrder` + `waitForReceiveResult` bấm đúng card theo `orderId` và xác nhận kết quả. |
| `features/icon-buy/receive.js` **(mới)** | Vòng đọc → chọn → bấm → đọc lại; chống bấm lặp cùng `orderId`; callback `onReceived` sau mỗi lần thành công. |

## 3. Vì sao an toàn

- Bộ lọc mùa ICON thuần loại bỏ hoàn toàn dòng PHÔI có "Nhận".
- Chỉ bấm nút "Nhận" của đúng card `input[data-orderid=...]`, không bấm theo index.
- Không mở mini-app quá dày: runner giới hạn nhịp quét (`RECEIVE_SCAN_INTERVAL_MS`).
- Không đổi `config.json`.

## 4. Test plan

| # | Case | Kỳ vọng |
|---|---|---|
| 1 | 8 dòng gồm PHÔI/ICONTM/TKI "Nhận", ICON "Hủy", ICON "Nhận" ở hàng 5-6 | Chỉ chọn 2 ICON "Nhận" |
| 2 | Dòng BÁN và dòng thiếu orderId | Bị loại |
| 3 | Lọc theo mã phiên + grade | Đúng 1 dòng |
| 4 | Gộp 2 trang cuộn có overlap | Đủ 6 dòng, không trùng |
| 5 | Nhận thất bại | Không lặp card lỗi, trả `failed` |

## 5. Definition of Done

- Reviewer APPROVED + QA PASS; `npm test` 100%, `scan:secrets` + `scan:history` pass.
- Không push/merge `main`.
