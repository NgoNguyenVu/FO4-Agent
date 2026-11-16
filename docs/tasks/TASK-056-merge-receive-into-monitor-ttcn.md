# TASK-056 — Gộp quét/nhận ICON vào lần mở TTCN của chu kỳ monitor

## Thông tin

- **Priority:** P0
- **Risk:** Medium (đổi nhịp mở TTCN và vị trí nhận ICON trong luồng live)
- **Effort:** M
- **Dependency:** TASK-053, TASK-054, TASK-055 (Cycle v6, đã merge vào `main` `258e4af`)
- **Status:** **DONE** — Cycle v7 (2026-11-16), branch `ai/auto-cycle-v7`.
- **Nguồn:** Yêu cầu Owner: "tối ưu chống spam TTCN" — bỏ nhịp mở mini-app riêng chỉ để nhận ICON.

## 1. Vấn đề

Cycle v6 thêm `scanReceivedIcons()` chạy ở đầu mỗi vòng `runIconBuy` theo nhịp
`RECEIVE_SCAN_INTERVAL_MS = 120_000` (2 phút khi đã mua ICON, 10 phút khi chưa).
Mỗi lần quét là một lần mở mini-app Auto Mua → tab TTCN → đọc danh sách → đóng,
**chỉ để tìm nút "Nhận"**. Hệ quả:

- Mini-app/TTCN bị mở dày đặc, tăng nguy cơ E006 (token) và spam `/tn`.
- Cùng một chu kỳ `monitorExistingOrders` đã phải mở TTCN để kiểm tra/hủy đơn có
  nút "Hủy", nên việc mở thêm một lần nữa chỉ để nhận là trùng lặp.
- Để vòng chính quay lại quét "Nhận" thường xuyên, v6 còn cắt nhịp monitor
  (`monitorSliceMs = min(monitorWaitSeconds, 2 phút)`), làm mất nhịp theo dõi 15
  phút vốn có.

## 2. Sửa lỗi

| File | Nội dung |
|---|---|
| `features/icon-buy/ttcn.js` | Thêm `runTtcnMaintenance` (điều phối trên MỘT danh sách đã mở: hủy đơn vị trí xấu → quét/nhận ICON "Nhận" → trả kết quả) và `maintainTtcnOrders` (mở TTCN đúng **một lần**, `attempts: 1`, `refreshMenu: false`, đóng trong `finally`). `cancelIconOrders` / `receiveIconOrders` trở thành wrapper mỏng của cùng một lần mở. |
| `features/icon-buy/runner.js` | Xóa `RECEIVE_SCAN_INTERVAL_MS`, `nextReceiveScanAt`, `scanReceivedIcons()` và lời gọi đầu vòng. Bỏ cắt nhịp `monitorSliceMs` (dùng lại `monitorWaitSeconds`). `monitorExistingOrders` nhận option `receive`, gom target hủy (tồn từ trước khi chờ + mới xác nhận trong lúc chờ) rồi gọi `maintainTtcnOrders` **một lần**: hủy + nhận trên cùng danh sách, sau đó mới đóng. Nhận xong gọi `onIconReceived` để pivot. |
| `features/icon-buy/ttcn-receive.test.js` | Giữ 7 test cũ; thêm 4 test hành vi cho kiến trúc gộp một lần mở + 1 test source-contract mới. |
| `agent.test.js` | Cập nhật source-contract: TTCN mở `refreshMenu: false, attempts: 1` và có `maintainTtcnOrders` (thay vì `refreshMenu: true` của luồng hủy riêng cũ). |

## 3. Luồng sau sửa

```text
runIconBuy: đọc /stop -> đủ 3 slot MUA
  -> monitorExistingOrders (chờ tối đa monitorWaitSeconds = 900s)
       - quét chat: vị trí xấu mới -> onBadPositions hủy ngay (như cũ)
       - hết kỳ: MỞ TTCN 1 LẦN
           1. hủy các đơn "Hủy" vị trí > 3 (orderId-based, đọc lại sau mỗi hủy)
           2. quét toàn bộ danh sách, chỉ nhận ICON thuần "Nhận" (bỏ PHÔI/ICONTM/TKI)
           3. đóng TTCN
  -> có ICON nhận được: onIconReceived -> iconReceivePivotPlan
       -> inventoryKnownAvailable=false, nextInventoryCheckAt=0
       -> master loop kiểm tra kho -> mua phôi -> nâng cấp
```

## 4. Test plan

| # | Case | Kỳ vọng |
|---|---|---|
| 1 | Có đơn xấu + ICON "Nhận" | Một phiên: hủy trước, nhận sau, cùng `readOrders`; PHÔI "Nhận" bị bỏ qua |
| 2 | Hủy thất bại | Vẫn nhận ICON trong cùng lần mở; target lỗi được ghi `failed` để thử lại |
| 3 | Đơn xấu đã biến mất | Ghi `notFound`, vẫn quét nhận ICON |
| 4 | Không target, không receive | Không đọc danh sách TTCN (không mở mini-app) |
| 5 | Source contract | `runner.js` không còn `RECEIVE_SCAN_INTERVAL_MS`/`scanReceivedIcons`/`nextReceiveScanAt`; dùng `maintainTtcnOrders` + `maxWaitMs: configuredMonitorMs`; controller giữ `onIconReceived`/`iconReceivePivotPlan` |
| 6 | Hồi quy | 7 test cũ của v6 (orderId, gộp trang, lọc ICON, pivot) vẫn pass |

## 5. Definition of Done

- Reviewer APPROVED + QA PASS; `npm test` 100% (386/386), `scan:secrets` + `scan:history` pass.
- Không đổi `config.json`; không push/merge `main`.
- `TASK-003 Stage B` và `TASK-039` vẫn **WONT_DO** — không nhắc lại.
