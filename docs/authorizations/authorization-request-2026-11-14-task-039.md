# Authorization Request — TASK-039 (`purchaseTimeoutSeconds`)

- **Ngày:** 2026-11-14
- **Người đề nghị:** Manager Agent (Engineering Director)
- **Task:** TASK-039 — ICON continuous-buy + inventory gate refactor
- **Trạng thái:** **AUTHORIZATION_REQUIRED**

## 1. Vấn đề cần Owner quyết định

`config.json` hiện tại có:

```json
"iconBuy": {
  "purchaseTimeoutSeconds": 0,
  "purchaseSoftTimeoutSeconds": 1800
}
```

Baseline đã được duyệt tại TASK-007 (`9542347`) là `purchaseTimeoutSeconds: 3600` (1 giờ).

- `0` = **không có deadline cứng**: đơn ICON không bị coi là hết hạn và không bị hủy vì timeout.
- `purchaseSoftTimeoutSeconds: 1800` chỉ là watchdog mềm: hết 30 phút thì trả quyền về runner để đọc `/stop` và chuyển sang theo dõi task, **không hủy task**.
- `authorization-TASK-039.md` (2026-11-05) đã ghi rõ `purchaseTimeoutSeconds: 0` cần Owner xác nhận chính thức trước khi commit.

## 2. Vì sao cần Owner Decision

Đây là thay đổi **hành vi tài chính/vận hành** (giữ task vô thời hạn, chiếm slot ICON), không phải refactor thuần túy. Không thể tự quyết theo governance hiện hành.

## 3. Phát hiện thêm (process)

Code ICON đã nằm trong `main` từ các commit `dfbf854` / `8c1b38b` / `75bea29`, tức **trước** khi có authorization tài chính. Review/QA 2026-11-14 là retro-review. Không có thay đổi code nào được thực hiện trong cycle v3 cho TASK-039.

## 4. Lựa chọn đề xuất

| Phương án | Hệ quả |
|---|---|
| **A. Giữ `0`** (Owner chấp nhận) | Đơn ICON chờ tới khi bot trả kết quả; cần theo dõi thủ công nếu bot im lặng. Giữ nguyên hành vi đang chạy. |
| **B. Trả về `3600`** (baseline TASK-007) | Có deadline cứng 1 giờ; giảm rủi ro treo slot, nhưng có thể hủy theo dõi đơn chạy lâu. |
| **C. Giá trị khác** | Owner chỉ định; cần cập nhật config + test + docs. |

Khuyến nghị của Engineering: **A** nếu vận hành đã quen theo dõi thủ công và soft watchdog 1800s đủ; **B** nếu ưu tiên giới hạn thời gian chiếm slot.

## 5. Điều kiện để đóng TASK-039

1. Owner chọn phương án và ghi `APPROVED`/`AUTHORIZED` vào file này (hoặc file authorization mới).
2. Nếu chọn B/C: cập nhật `config.json`, thêm test cho deadline, cập nhật README.
3. Nếu chọn A: chỉ cần sign-off; task chuyển `DONE` (docs), không cần commit code.
4. Bổ sung test hành vi cho `monitorExistingOrders`, `captureStopBaselineWithRetry`, deadline (đề xuất trong TASK-045).
