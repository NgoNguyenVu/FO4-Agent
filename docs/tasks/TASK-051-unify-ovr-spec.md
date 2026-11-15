# TASK-051 — Hợp nhất `validateOvrSpec` + `parseOvrList` (Architecture)

## Thông tin

- **Priority:** P2
- **Risk:** Medium (đổi luật parse runtime: 0/số âm bị từ chối; Cortex: 2 symbol, 2 flow)
- **Effort:** S
- **Dependency:** TASK-046 (`validateOvrSpec`), TASK-049 (`lib/config-validators.js`)
- **Status:** **DONE** — Cycle v5 (2026-11-15), branch `ai/auto-cycle-v5`; Reviewer APPROVED + QA PASS; Gate **A (91/100)**. Xem [completed/TASK-051-unify-ovr-spec.md](../completed/TASK-051-unify-ovr-spec.md).
- **Owner đề xuất:** Architecture / Platform
- **Nguồn:** Follow-up TASK-049 §6.1 — hai bản luật OVR lệch nhau

## 1. Vấn đề

Hai nơi tự định nghĩa luật OVR:

- `features/config.js` → `validateOvrSpec()`: số nguyên dương, dải `a-b` với `a >= 1`, `a <= b`, tối đa 50.
- `features/upgrade/patterns.js` → `parseOvrList()`: **chấp nhận `0` và số âm**, không kiểm tra `from >= 1`.

Hệ quả:

- Config hợp lệ nhưng runtime có thể nhận giá trị vô nghĩa (`0`, `-118`).
- Sửa một bên dễ quên bên kia; thông báo lỗi khác nhau giữa lúc validate và lúc chạy.

## 2. Thay đổi

| File | Nội dung |
|---|---|
| `lib/ovr-spec.js` **(mới)** | `parseOvrSpec(raw)` — nguồn chuẩn duy nhất; strict: số nguyên dương, dải `1 <= a <= b`, `to - from <= 50`; trả mảng sorted unique |
| `features/config.js` | `validateOvrSpec()` gọi `parseOvrSpec()` và bọc lỗi với ngữ cảnh `upgrade.ovrPhoi` |
| `features/upgrade/patterns.js` | `parseOvrList()` delegate `parseOvrSpec()` |
| `lib/ovr-spec.test.js` **(mới)** | 6 test: danh sách/dải hợp lệ, số 0/âm/thập phân/khoa học, dải ngược/quá rộng, biên 51 giá trị, runtime delegate, config-runtime cùng tập giá trị |

### 2.1. Hợp đồng lỗi

- Runtime (`parseOvrSpec`/`parseOvrList`) giữ message cũ:
  - `OVR không hợp lệ: <phần tử>`
  - `Dải OVR không hợp lệ: <dải>`
  - `Danh sách OVR trống: <raw>`
- Config bọc thêm ngữ cảnh: `Cấu hình upgrade.ovrPhoi không hợp lệ: <message runtime>` → vẫn khớp `/ovrPhoi/` như test cũ.

### 2.2. Thắt chặt có chủ đích

`parseOvrList("0")` và `parseOvrList("-118")` trước đây được nhận, nay bị từ chối. Đây là mục tiêu của task: runtime và config dùng chung một luật. `config.json` hiện tại (`ovrPhoi = "118"`) không bị ảnh hưởng.

## 3. Vì sao an toàn

- Không đổi config, không đổi call site (`parseOvrList` vẫn cùng chữ ký).
- Mọi giá trị config từng hợp lệ vẫn hợp lệ; chỉ giá trị vô nghĩa bị chặn sớm hơn.
- Test cũ `features/config.test.js` và `features/autonangcap.test.js` vẫn xanh.
- Không có migration dữ liệu; OVR chỉ là chuỗi cấu hình.

## 4. Test plan

| # | Case | Kỳ vọng |
|---|---|---|
| 1 | `114,115,116,117` | Mảng sorted unique |
| 2 | `112-118`, `112 - 118` | Mảng đầy đủ |
| 3 | Trùng lặp / thứ tự lộn xộn | Loại trùng, sắp xếp |
| 4 | `0`, `-118`, `118.5`, `1e3`, `0x10`, `abc` | `OVR không hợp lệ` |
| 5 | `118-112`, `0-5`, `1-52` | `Dải OVR không hợp lệ` |
| 6 | Biên `1-51` | Hợp lệ, 51 phần tử |
| 7 | `parseOvrList` | Kết quả/lỗi giống `parseOvrSpec` |
| 8 | Config + runtime cùng tập valid/invalid | Cùng chấp nhận/từ chối |
| 9 | Config lỗi dải | Message có `upgrade.ovrPhoi` + `Dải OVR không hợp lệ` |

## 5. Rollback

Revert `lib/ovr-spec.js`, `features/config.js`, `features/upgrade/patterns.js`, xóa `lib/ovr-spec.test.js`. Không migration.

## 6. Definition of Done

- Reviewer APPROVED + QA PASS.
- `npm test` 100%, `scan:secrets` + `scan:history` pass.
- `cortex_detect_changes` ghi nhận risk **medium** (2 symbol, 2 flow) và test hồi quy config/runtime.
