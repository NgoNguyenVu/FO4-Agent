# TASK-046 — Vá lỗ hổng validate cấu hình — COMPLETED 2026-11-14

- **Priority:** P1 — Security / Configuration
- **Branch:** `ai/auto-cycle-v4`
- **Trạng thái:** **DONE** — Reviewer APPROVED, QA PASS, Quality Gate **A (94/100)**
- **Task gốc:** [TASK-046](TASK-046-config-validation-gaps.md)
- **Review:** [TASK-046-review-2026-11-14.md](../reviews/TASK-046-review-2026-11-14.md)
- **QA:** [TASK-046-qa-2026-11-14.md](../reviews/TASK-046-qa-2026-11-14.md)

## 1. Vấn đề

Company Cycle scan v4 chỉ ra `validateConfig` (impact HIGH, 10 symbol) còn ba khoảng trống khiến giá trị sai lọt vào runtime:

1. `iconBuy.monitorExistingOrders` không được validate; code dùng `!== false` nên `"false"`, `0`, `null` đều bị hiểu là **bật**.
2. `upgrade.ovrPhoi` chỉ kiểm tra khác rỗng — chuỗi rác/dải ngược chỉ nổ giữa phiên nâng cấp.
3. `upgrade.maxPriceEach` chỉ kiểm tra khác rỗng — giá rác được gõ vào mini-app.

## 2. Thay đổi

| File | Nội dung |
|---|---|
| `features/config.js` | Thêm `requireBoolean`, `requireNonEmptyString`, `validateOvrSpec`, `validatePriceSpec`; gọi trong validator upgrade/icon |
| `features/config.test.js` **(mới)** | 6 test phủ boolean, OVR, giá; mutate singleton + restore |

### Luật mới

- `monitorExistingOrders`: bắt buộc boolean.
- `ovrPhoi`: danh sách số nguyên dương hoặc dải `a-b` (`a <= b`, chênh tối đa 50) — khớp parser runtime, chặn thêm số âm/0/ký hiệu khoa học.
- `maxPriceEach`: số nguyên/thập phân + hậu tố `K/M/B` tuỳ chọn (`2M`, `500K`, `1,5M`, `2000000`).

## 3. Bằng chứng

- `node --test features/config.test.js` → **6/6 pass**.
- `npm test` → **325/325 pass**, 0 fail.
- `npm run scan:secrets` + `scan:history` → pass.
- `cortex_detect_changes`: risk **high** (startup path), 3 symbol, 6 flow — có test hồi quy trực tiếp.

## 4. Quality Gate — A (94/100)

| Tiêu chí | Điểm |
|---|---|
| Test & bằng chứng | 25/25 (6 test, phủ boundary + full suite) |
| Phạm vi & regression | 19/20 (chỉ thêm validate, config hiện tại pass) |
| Bảo mật & an toàn dữ liệu | 20/20 (fail-fast, chặn giá trị sai kiểu) |
| Tài liệu & vận hành | 12/15 (task/review/QA/completed) |
| Rollback | 10/10 (revert 1 file + xóa test) |
| Kiểm soát blast radius | 8/10 (detect_changes high, có test nhưng chưa có integration toàn startup) |

## 5. Rollback

Revert `features/config.js`, xóa `features/config.test.js`. Không migration, không ảnh hưởng state.

## 6. Follow-up

1. TASK-049: gom validator dùng chung vào `lib/config-validators.js` để tránh lệch với `parseOvrList`.
2. Kiểm thử thật định dạng giá bot chấp nhận trước khi đổi `maxPriceEach`.
