# TASK-051 — Hợp nhất `validateOvrSpec` + `parseOvrList` — COMPLETED 2026-11-15

- **Priority:** P2 — Architecture
- **Branch:** `ai/auto-cycle-v5`
- **Trạng thái:** **DONE** — Reviewer APPROVED, QA PASS, Quality Gate **A (91/100)**
- **Task gốc:** [TASK-051](../tasks/TASK-051-unify-ovr-spec.md)
- **Review:** [TASK-051-review-2026-11-15.md](../reviews/TASK-051-review-2026-11-15.md)
- **QA:** [TASK-051-qa-2026-11-15.md](../reviews/TASK-051-qa-2026-11-15.md)

## 1. Vấn đề

`features/config.js` (`validateOvrSpec`) và `features/upgrade/patterns.js` (`parseOvrList`) là hai bản luật gần giống nhưng lệch: parser runtime chấp nhận `0`/số âm, validator config thì không. Sửa một bên dễ quên bên kia; thông báo lỗi khác nhau giữa validate và runtime.

## 2. Thay đổi

| File | Nội dung |
|---|---|
| `lib/ovr-spec.js` **(mới)** | `parseOvrSpec(raw)` — nguồn chuẩn; strict số nguyên dương, dải `1 <= a <= b`, span ≤ 50, sorted unique |
| `features/config.js` | `validateOvrSpec()` delegate + bọc ngữ cảnh `upgrade.ovrPhoi` |
| `features/upgrade/patterns.js` | `parseOvrList()` delegate `parseOvrSpec()` |
| `lib/ovr-spec.test.js` **(mới)** | 6 test: valid, invalid, dải/biên, runtime delegate, config-runtime cùng tập, message config |

### Hành vi

- Runtime giữ message cũ `/OVR không hợp lệ/`, `/Dải OVR không hợp lệ/`.
- Config thêm ngữ cảnh `upgrade.ovrPhoi` nhưng vẫn chứa message runtime.
- `0`, số âm, thập phân, `1e3` bị từ chối ở cả hai đường.

## 3. Bằng chứng

- `node --test lib/ovr-spec.test.js features/config.test.js features/autonangcap.test.js` → **58/58 pass**.
- `npm test` → **374/374 pass**, 0 fail.
- `npm run scan:secrets` + `scan:history` → pass.
- `cortex_detect_changes`: risk **medium** — 2 symbol, 2 flow; có test hồi quy config/runtime.

## 4. Quality Gate — A (91/100)

| Tiêu chí | Điểm |
|---|---|
| Test & bằng chứng | 25/25 (6 test chuyên biệt + 2 suite cũ) |
| Phạm vi & regression | 18/20 (thắt chặt runtime có chủ đích) |
| Bảo mật & an toàn dữ liệu | 20/20 (không đổi config, chặn sớm giá trị vô nghĩa) |
| Tài liệu & vận hành | 14/15 (task doc ghi rõ thay đổi hành vi) |
| Rollback | 10/10 (revert 3 file + xóa test) |
| Kiểm soát blast radius | 4/10 (detect_changes medium; parser nằm trên đường config + nâng cấp) |

## 5. Rollback

Revert `lib/ovr-spec.js`, `features/config.js`, `features/upgrade/patterns.js`, xóa test mới. Không migration.

## 6. Follow-up

1. Giữ `lib/ovr-spec.js` là nơi duy nhất sửa luật OVR.
2. Nếu cần cho phép OVR 0, đổi điều kiện + test cùng lúc.
