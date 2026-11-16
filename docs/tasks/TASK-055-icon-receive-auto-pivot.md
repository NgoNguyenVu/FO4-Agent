# TASK-055 — Nhận ICON xong tự động chuyển sang mua phôi + nâng cấp

## Thông tin

- **Priority:** P0
- **Risk:** Low–Medium (chỉ reset cờ inventory + gọi callback)
- **Effort:** S
- **Dependency:** TASK-054 (`onReceived` từ TTCN)
- **Status:** **DONE** — Cycle v6 (2026-11-16), branch `ai/auto-cycle-v6`.
- **Nguồn:** Yêu cầu live-ops: "mua ICON → nhận → mua phôi → nâng" phải khép kín.

## 1. Vấn đề

- ICON đã mua thành công chỉ được nhận khi có người/bot bấm "Nhận". Sau khi nhận, master loop vẫn chờ hết `inventoryCheckIntervalSeconds` (30 phút) mới kiểm tra kho, nên ICON mới không được nâng ngay.
- `INVENTORY_RECEIVED_RE` chỉ khớp receipt "Auto Mua Phôi" (`Đã nhận N cầu thủ trong kho mua … Tiếp tục mua`), **không** khớp thao tác nhận ICON trên TTCN.

## 2. Sửa lỗi

| File | Nội dung |
|---|---|
| `features/upgrade/receive-pivot.js` **(mới)** | `iconReceivePivotPlan(received)`: trả `{ inventoryKnownAvailable:false, nextInventoryCheckAt:0, codes }` khi có ICON vừa nhận, `null` khi rỗng. Hàm thuần để test. |
| `features/icon-buy/runner.js` | Thêm option `onIconReceived`; `scanReceivedIcons()` quét TTCN theo nhịp (2 phút khi đã mua, 10 phút khi chưa), nhận xong gọi callback; chia nhịp `monitorExistingOrders` để vòng chính quay lại quét "Nhận" thay vì chờ 15 phút. |
| `features/controller.js` | Truyền `onIconReceived`: áp `iconReceivePivotPlan` để bỏ `inventoryKnownAvailable` và ép `nextInventoryCheckAt = 0`, master loop kiểm tra kho → mua phôi → nâng cấp. |

## 3. Luồng sau sửa

```text
ICON worker: quét TTCN → thấy ICON "Nhận" → bấm Nhận → onIconReceived
   → controller: inventoryKnownAvailable=false, nextInventoryCheckAt=0
   → master loop: checkMasterInventory() → có ICON eligible
   → Auto Mua Phôi → Auto Nâng Cấp
```

## 4. Test plan

| # | Case | Kỳ vọng |
|---|---|---|
| 1 | Nhận 2 ICON | Callback nhận đúng 2 mã; pivot plan reset cờ |
| 2 | Không có ICON "Nhận" | `iconReceivePivotPlan` trả `null`, không pivot |
| 3 | Nhận thất bại | Không gọi callback, không pivot |
| 4 | Source contract | `runner.js` có `onIconReceived`/`scanReceivedIcons`; `controller.js` dùng `iconReceivePivotPlan` |

## 5. Definition of Done

- Reviewer APPROVED + QA PASS; `npm test` 100%, `scan:secrets` + `scan:history` pass.
- Không đổi `config.json`; không push/merge `main`.
