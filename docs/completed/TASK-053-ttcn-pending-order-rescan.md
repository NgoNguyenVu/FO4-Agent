# TASK-053 — DONE (Cycle v6)

- **Ngày:** 2026-11-16
- **Branch:** `ai/auto-cycle-v6`
- **Gate:** A (88/100)
- **Review:** [TASK-053-055-review-2026-11-16](../reviews/TASK-053-055-review-2026-11-16.md)
- **QA:** [TASK-053-055-qa-2026-11-16](../reviews/TASK-053-055-qa-2026-11-16.md)

## Deliverable

- `features/icon-buy/patterns.js`: `ttcnOrderKey`, `mergeTtcnOrderPages`, `planTtcnCancellations`.
- `features/icon-buy/ttcn.js`: `readTtcnOrders` đọc toàn bộ danh sách (cuộn + gộp); `cancelIconOrders` hủy theo `orderId`, đọc lại danh sách sau mỗi lần, không lệch index.
- `features/icon-buy/ttcn-receive.test.js`: 3 test cho kịch bản xóa đơn 27 → đơn 4.

## Bằng chứng

- `npm test` 382/382; `scan:secrets` + `scan:history` pass.
- Không đổi `config.json`, không push `main`.
