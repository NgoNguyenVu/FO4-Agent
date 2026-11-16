# TASK-056 — DONE (Cycle v7)

- **Ngày:** 2026-11-16
- **Branch:** `ai/auto-cycle-v7` (tách từ `main` `258e4af`)
- **Gate:** A (89/100)
- **Review:** [TASK-056-review-2026-11-16](../reviews/TASK-056-review-2026-11-16.md)
- **QA:** [TASK-056-qa-2026-11-16](../reviews/TASK-056-qa-2026-11-16.md)

## Deliverable

- `features/icon-buy/ttcn.js`:
  - `runTtcnMaintenance({ targets, baselineIds, receive, readOrders, cancelOrder, clickReceive, ... })`
    điều phối trên **một** danh sách đã mở: hủy đơn vị trí xấu theo `orderId`
    (đọc lại sau mỗi hủy) → quét/nhận ICON "Nhận" → trả
    `{ canceled, failed, notFound, received, receiveFailed }`.
  - `maintainTtcnOrders(page, rl, ...)` mở TTCN đúng **một lần**
    (`refreshMenu: false`, `attempts: 1`) và đóng trong `finally`.
  - `cancelIconOrders` / `receiveIconOrders` thành wrapper mỏng của cùng một lần mở.
- `features/icon-buy/runner.js`:
  - Xóa `RECEIVE_SCAN_INTERVAL_MS`, `nextReceiveScanAt`, `scanReceivedIcons()` và
    lời gọi quét nhận đầu vòng.
  - Bỏ cắt nhịp monitor; `monitorWaitSeconds = 900` được dùng nguyên.
  - `monitorExistingOrders` nhận option `receive`; gom target hủy (tồn từ trước
    khi chờ + mới xác nhận trong lúc chờ) rồi gọi `maintainTtcnOrders` một lần.
  - `handleReceivedIcons` cộng số ICON đã nhận và gọi `onIconReceived` → pivot.
- `features/icon-buy/ttcn-receive.test.js`: 12 test (7 cũ + 4 hành vi gộp một
  lần mở + 1 source-contract mới).
- `agent.test.js`: cập nhật source-contract TTCN (`refreshMenu: false, attempts: 1`,
  `maintainTtcnOrders`).

## Bằng chứng

- Test `(d)`: một phiên ghi nhận đúng thứ tự `cancel:bad-1` → `receive:icon-3`,
  PHÔI "Nhận" không bị bấm; hủy lỗi/không tìm thấy đơn vẫn nhận ICON; không
  target + không receive thì không đọc danh sách.
- `npm test` **386/386**; `scan:secrets` + `scan:history` pass.
- `config.json` không đổi; `main` không bị đụng.
