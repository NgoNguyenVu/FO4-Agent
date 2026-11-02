# TASK-006 — Config single source of truth

## Thông tin

- **Priority:** P0
- **Risk:** High
- **Effort:** M
- **Dependency:** TASK-007
- **Status:** Todo
- **Owner đề xuất:** Platform / QA

## 1. Mục tiêu

Đưa cấu hình về một nguồn sự thật duy nhất, có schema/range validation, fail-fast khi sai và kiểm tra tự động README khớp với `config.json`.

Phạm vi:

- `config.json`
- `features/config.js`
- `README.md`
- Test config
- Script/docs parity

Không thuộc phạm vi:

- Thay đổi hành vi mua/nâng ngoài việc làm rõ cấu hình.
- Bí mật/credential (không đưa vào config).

## 2. Bằng chứng

| Hạng mục | README | `config.json` | `features/config.js` default |
|---|---|---|---|
| OVR | 115–120 | 118–123 | — |
| Giá tối đa | 666.666 BP | 888888 | — |
| Quantity mỗi attempt | 5 | 3 | — |
| ICON mã/lượt | 1 | `maxPlayersPerBatch: 3` | 3 |
| Upgrade target grade | để mini-app chọn | 7 | 6 |
| Upgrade min ratio | — | 74 | 100 |

- `features/config.js` có default `targetGrade: 6`, `minRatio: 100` trước khi spread `rawConfig.upgrade`; nếu `config.json` thiếu key, hành vi khác README.
- `config.json` là JSON thuần, không schema; validation nằm rải rác trong `features/config.js`.
- Không có test nào kiểm tra README và config khớp nhau.
- `validateIconBuyConfig` chỉ kiểm tra một phần `iconBuy`.

## 3. Thiết kế đề xuất

### 3.1. Một nguồn sự thật

- `config.json` là nguồn duy nhất cho giá trị runtime.
- `features/config.js` **không** chứa default hành vi; chỉ:
  1. Load `config.json`.
  2. Validate theo schema.
  3. Freeze object.
  4. Export typed accessor.
- Default (nếu cần) nằm trong schema hoặc `config.defaults.json`, không nằm trong code.

### 3.2. Schema

`config.schema.json` (JSON Schema draft 2020-12) hoặc `lib/config-schema.js`:

- `ovrMin`, `ovrMax`: integer 1–200; `ovrMin <= ovrMax`.
- `maxPriceBP`: integer ≥ 0.
- `quantityPerAttempt`: integer 1–20; `<= maxPerCycle`.
- `maxPerCycle`: integer 1–100.
- Timeout: integer > 0; giới hạn hợp lý (ví dụ ≤ 24h).
- `upgrade.targetGrade`: integer 1–10 hoặc `null` (auto).
- `upgrade.minRatio`: number 0–100.
- `iconBuy.maxPlayersPerBatch`: integer 1–10.
- `iconBuy.maxTaskSlots`: integer 1–10.
- `spendLimits`, `liveTrading` (từ TASK-003).
- Unknown key: warning (hoặc error ở strict mode).

### 3.3. Fail-fast

- `loadConfig()` throw `ConfigError` với đường dẫn key và giá trị.
- `agent.js` không retry `ConfigError`; exit code 2.
- Log rõ: “Config invalid: upgrade.targetGrade must be 1–10, got 11”.
- Không clamp im lặng; không fallback default.

### 3.4. README parity

- Sinh bảng “Current config” từ `config.json` bằng script `npm run docs:config`.
- Test `config-docs.test.js`:
  - Parse bảng trong README.
  - So sánh với config đã resolve.
  - Fail nếu lệch.
- README ghi rõ key nào là “operator-tunable”, key nào là “derived”.

### 3.5. Quyết định giá trị đúng

Trước khi sửa, cần human/product owner xác nhận:

- OVR mong muốn: 115–120 hay 118–123?
- Giá tối đa: 666.666 hay 888.888?
- Quantity: 5 hay 3?
- ICON: 1 mã/lượt hay 3?
- Upgrade target: auto hay 7?
- `minRatio`: 74 hay 100?

Task này **không tự đổi** giá trị; nó làm cho lệch nhau không thể tồn tại mà không bị phát hiện.

## 4. Patch plan (không sửa code trong phase này)

1. Thêm `config.schema.json` + validator.
2. Refactor `features/config.js`: bỏ default hành vi, validate, freeze.
3. Thêm `ConfigError` và map exit code 2 trong `agent.js`.
4. Thêm script `npm run docs:config`.
5. Cập nhật README theo giá trị đã được duyệt.
6. Thêm test schema/parity/boundary.
7. Ghi ADR cho các giá trị được chọn.

## 5. Test plan

| Loại | Case | Kỳ vọng |
|---|---|---|
| Schema | Thiếu key bắt buộc | Throw `ConfigError` |
| Schema | Sai type | Throw |
| Schema | `ovrMin > ovrMax` | Throw |
| Schema | `quantityPerAttempt > maxPerCycle` | Throw |
| Schema | Timeout = 0 | Throw |
| Schema | `targetGrade = 11` | Throw |
| Schema | Unknown key (strict) | Throw/warn theo mode |
| Boundary | Giá trị min/max hợp lệ | Pass |
| Parity | README khớp config | Pass |
| Parity | Sửa config không sửa README | Test fail |
| Runtime | Config sai khi start | Exit 2, không retry |
| Runtime | Config hợp lệ | Freeze, không mutate |
| Regression | `npm run check` | 174+ test pass |

## 6. Rollback

- Chạy validator ở `warn` mode một release nếu cần; nhưng không tắt parity test.
- Revert schema/validator theo commit.
- Không tự động sửa `config.json` khi rollback; giữ nguyên giá trị đã duyệt.

## 7. Definition of Done

- `config.json` là nguồn duy nhất; không còn default hành vi trong code.
- Config sai bị từ chối khi start với thông báo rõ.
- README và config khớp; có test tự động.
- Có ADR ghi giá trị đã chọn.
- Không còn drift `targetGrade`, `minRatio`, `maxPlayersPerBatch`, OVR/price/quantity.
