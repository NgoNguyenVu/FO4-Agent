# TASK-049 — Gom validator dùng chung `lib/config-validators.js` (Architecture)

## Thông tin

- **Priority:** P3
- **Risk:** Low (refactor thuần, hành vi validate không đổi)
- **Effort:** S
- **Dependency:** TASK-046 (validator config), TASK-003 Stage A (`spend-guard`)
- **Status:** **DONE** — Cycle v4 (2026-11-14), branch `ai/auto-cycle-v4`; Reviewer APPROVED + QA PASS; Gate **A (93/100)**. Xem [completed/TASK-049-shared-config-validators.md](../completed/TASK-049-shared-config-validators.md).
- **Owner đề xuất:** Architecture / Platform
- **Nguồn:** Company Cycle scan v4 (validator trùng lặp giữa `features/config.js` và `lib/spend-guard.js`)

## 1. Vấn đề

Hai module tự định nghĩa cùng luật validate:

- `features/config.js`: `requirePositiveInteger`, `requireNonNegativeInteger`, `requireBoolean`, `requireNonEmptyString`.
- `lib/spend-guard.js`: `requireNonNegativeInteger` (bản sao, message khác prefix).

Sửa một bên dễ quên bên kia; TASK-046 còn thêm `validateOvrSpec`/`validatePriceSpec` làm bề mặt validate ngày càng rộng.

## 2. Thay đổi

| File | Nội dung |
|---|---|
| `lib/config-validators.js` **(mới)** | 4 validator nguyên thuỷ + `createValidators(prefix)` để giữ label/ngữ cảnh lỗi |
| `features/config.js` | Bỏ 4 hàm local; dùng `createValidators("Cấu hình ")` |
| `lib/spend-guard.js` | Bỏ hàm local; dùng `requireNonNegativeInteger` chung với label `spendLimits.*` |
| `lib/config-validators.test.js` **(mới)** | 6 test: từng validator + prefix + label nguyên văn |

### 2.1. Hợp đồng

- Validator nhận `label` đầy đủ và ném `${label} phải là ...`.
- `createValidators(prefix)` trả bộ hàm chữ ký cũ `(value, name)` → không phải sửa call site trong `features/config.js`.
- Thông báo lỗi giữ nguyên 100%:
  - `Cấu hình ovrMin phải là số nguyên dương.`
  - `spendLimits.perRunBP phải là số nguyên >= 0.`

## 3. Vì sao an toàn

- Không đổi luật validate, không đổi config, không đổi runtime path.
- `validateSpendLimits` vẫn ở `lib/spend-guard.js` (đặc thù spend); chỉ dùng primitive chung.
- `validateOvrSpec`/`validatePriceSpec` vẫn ở `features/config.js` (đặc thù config) — có thể chuyển sang `lib/` ở task sau nếu cần.

## 4. Test plan

| # | Case | Kỳ vọng |
|---|---|---|
| 1 | `requirePositiveInteger` | Nhận 1/42/MAX_SAFE_INTEGER; từ chối 0, âm, thập phân, chuỗi, NaN, Infinity, null |
| 2 | `requireNonNegativeInteger` | Nhận 0; từ chối âm/thập phân/chuỗi |
| 3 | `requireBoolean` | Chỉ nhận `true`/`false` thật |
| 4 | `requireNonEmptyString` | Từ chối rỗng/khoảng trắng/kiểu khác |
| 5 | `createValidators("Cấu hình ")` | Message có prefix đúng |
| 6 | Validator không prefix | Label nguyên văn (`spendLimits.perRunBP`) |
| 7 | Toàn suite | `config.test.js` + `spend-guard.test.js` vẫn xanh |

## 5. Rollback

Xóa `lib/config-validators.js` + test; khôi phục hàm local ở hai module. Không migration.

## 6. Definition of Done

- Reviewer APPROVED + QA PASS.
- `npm test` 100%, `scan:secrets` + `scan:history` pass.
- `cortex_detect_changes` ghi nhận risk **high** (config startup path, cộng dồn TASK-046) và có test hồi quy.
