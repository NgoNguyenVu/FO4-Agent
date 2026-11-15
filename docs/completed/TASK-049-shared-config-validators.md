# TASK-049 — Gom validator dùng chung — COMPLETED 2026-11-14

- **Priority:** P3 — Architecture
- **Branch:** `ai/auto-cycle-v4`
- **Trạng thái:** **DONE** — Reviewer APPROVED, QA PASS, Quality Gate **A (93/100)**
- **Task gốc:** [TASK-049](TASK-049-shared-config-validators.md)
- **Review:** [TASK-049-review-2026-11-14.md](../reviews/TASK-049-review-2026-11-14.md)
- **QA:** [TASK-049-qa-2026-11-14.md](../reviews/TASK-049-qa-2026-11-14.md)

## 1. Vấn đề

`features/config.js` và `lib/spend-guard.js` mỗi nơi tự định nghĩa validator (`requireNonNegativeInteger`, và config thêm positive/boolean/string). Sửa một bên dễ quên bên kia; TASK-046 làm bề mặt validate rộng thêm.

## 2. Thay đổi

| File | Nội dung |
|---|---|
| `lib/config-validators.js` **(mới)** | 4 primitive + `createValidators(prefix)` |
| `features/config.js` | Bỏ 4 hàm local; dùng `createValidators("Cấu hình ")` |
| `lib/spend-guard.js` | Bỏ hàm local; dùng primitive chung với label `spendLimits.*` |
| `lib/config-validators.test.js` **(mới)** | 6 test primitive + prefix + label |

### Hợp đồng

- Primitive nhận `label` đầy đủ → message `${label} phải là ...`.
- `createValidators(prefix)` giữ chữ ký cũ `(value, name)`, không phải sửa call site.
- Message lỗi giữ nguyên: `Cấu hình ovrMin ...`, `spendLimits.perRunBP ...`.

## 3. Bằng chứng

- `node --test lib/config-validators.test.js features/config.test.js lib/spend-guard.test.js` → **25/25 pass**.
- `npm test` → **343/343 pass**, 0 fail.
- `npm run scan:secrets` + `scan:history` → pass.
- `cortex_detect_changes`: risk **high** — 8 symbol, 6 flow (cộng dồn config), refactor không đổi hành vi.

## 4. Quality Gate — A (93/100)

| Tiêu chí | Điểm |
|---|---|
| Test & bằng chứng | 25/25 (6 test primitive + full suite) |
| Phạm vi & regression | 18/20 (refactor chạm config/spend-guard, không đổi luật) |
| Bảo mật & an toàn dữ liệu | 20/20 (không đổi fail-closed/cap) |
| Tài liệu & vận hành | 12/15 (task/review/QA/completed) |
| Rollback | 10/10 (xóa module + khôi phục hàm local) |
| Kiểm soát blast radius | 8/10 (detect_changes high do cộng dồn; test trực tiếp) |

## 5. Rollback

Xóa `lib/config-validators.js` + test; khôi phục hàm local ở `features/config.js` và `lib/spend-guard.js`. Không migration.

## 6. Follow-up

1. Gom `parseOvrList` (runtime) + `validateOvrSpec` (config) về một helper chung trong `lib/`.
2. Giữ `lib/config-validators.js` không import `features/` để tránh vòng phụ thuộc.
