# TASK-046 — Vá lỗ hổng validate cấu hình (Security)

## Thông tin

- **Priority:** P1
- **Risk:** Low (chỉ siết validate, không đổi hành vi với config hợp lệ)
- **Effort:** S
- **Dependency:** Không
- **Status:** **DONE** — Cycle v4 (2026-11-14), branch `ai/auto-cycle-v4`; Reviewer APPROVED + QA PASS; Gate **A (94/100)**. Xem [completed/TASK-046-config-validation-gaps.md](../completed/TASK-046-config-validation-gaps.md).
- **Owner đề xuất:** Security / Platform
- **Nguồn:** Company Cycle scan v4 (`validateConfig` impact HIGH)

## 1. Vấn đề

`features/config.js` validate phần lớn tham số nhưng còn ba khoảng trống cho giá trị sai lọt vào runtime:

| Trường | Hiện trạng | Hệ quả |
|---|---|---|
| `iconBuy.monitorExistingOrders` | Không validate; code dùng `!== false` | `"false"`, `0`, `null`… đều bị hiểu là **bật** monitor — sai ý định, có thể bám nhầm task thủ công |
| `upgrade.ovrPhoi` | Chỉ kiểm tra khác rỗng | Chuỗi rác hoặc dải ngược chỉ nổ ở `parseOvrList()` **giữa phiên nâng cấp**, sau khi đã mở mini-app |
| `upgrade.maxPriceEach` | Chỉ kiểm tra khác rỗng | Giá rác được gõ nguyên văn vào ô "Giá tối đa" của bot |

## 2. Thay đổi

| File | Nội dung |
|---|---|
| `features/config.js` | Thêm `requireBoolean`, `requireNonEmptyString`, `validateOvrSpec`, `validatePriceSpec`; gọi trong `validateUpgradeConfig` / `validateIconBuyConfig` |
| `features/config.test.js` **(mới)** | 6 test: config hiện tại hợp lệ; boolean; OVR hợp lệ/không hợp lệ; giá hợp lệ/không hợp lệ |

### 2.1. Luật validate

- `iconBuy.monitorExistingOrders`: bắt buộc `true`/`false`.
- `upgrade.ovrPhoi`: danh sách phân tách dấu phẩy; mỗi phần là số nguyên dương, hoặc dải `a-b` với `1 <= a <= b`, `b - a <= 50` (khớp `parseOvrList` runtime, siết thêm số âm/0/ký hiệu khoa học).
- `upgrade.maxPriceEach`: `số nguyên hoặc thập phân` + hậu tố `K/M/B` tuỳ chọn (ví dụ `2M`, `500K`, `1,5M`, `2000000`).

## 3. Vì sao không đổi runtime

- Config hiện tại (`config.json`) vẫn pass nguyên trạng: `monitorExistingOrders: true`, `ovrPhoi: "118"`, `maxPriceEach: "2M"`.
- Không đụng `config.json`, không đụng `purchaseTimeoutSeconds`, không đổi parser runtime.
- Validator chỉ chạy lúc khởi động (`validateConfig()` trong `agent.js`), fail-fast trước khi mở browser.

## 4. Test plan

| # | Case | Kỳ vọng |
|---|---|---|
| 1 | Config hiện tại | `validateConfig()` không throw |
| 2 | `monitorExistingOrders` = `"true"`, `1`, `0`, `null`, `undefined`, `{}` | Throw, message chứa tên trường |
| 3 | `monitorExistingOrders` = `false` | Pass |
| 4 | `ovrPhoi` = `118`, `114,115,116`, `112-118`, `112 - 118`, có khoảng trắng | Pass |
| 5 | `ovrPhoi` rỗng, `abc`, `118,`, `120-110`, `1-100`, `0`, `118.5`, `118-`, `-118`, `1e3` | Throw |
| 6 | `maxPriceEach` = `2M`, `500K`, `1,5M`, `1.5M`, `2000000`, `2m` | Pass |
| 7 | `maxPriceEach` rỗng, `abc`, `2M2`, `-2M`, `M`, `2 M 2` | Throw |

## 5. Rollback

Revert `features/config.js` và xóa `features/config.test.js`. Không migration, không ảnh hưởng state.

## 6. Definition of Done

- Reviewer APPROVED + QA PASS.
- `npm test` 100%, `scan:secrets` + `scan:history` pass.
- `cortex_detect_changes` ghi nhận risk **high** (validateConfig là startup path) và có test hồi quy trực tiếp.
