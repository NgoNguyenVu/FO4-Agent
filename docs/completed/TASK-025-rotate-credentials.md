# TASK-025 — Rotate/revoke exposed credentials

## Thông tin

- **Priority:** P0
- **Risk:** Critical
- **Effort:** S–M
- **Dependency:** TASK-001 evidence; có thể chạy song song TASK-024
- **Blocks:** TASK-032
- **Status:** **DONE** — Accepted Risk Approved (authorization-2026-11-02: no active production credential; no rotation required)
- **Owner đề xuất:** Security Owner

## 1. Mục tiêu

Thu hồi hoặc rotate mọi credential, token, session hoặc customer token có thể đã bị lộ qua artifact debug; xác nhận credential cũ không còn hiệu lực.

## 2. Bằng chứng

- `docs/incident-2026-10-31.md` vẫn để trống mục rotate/revoke.
- Chưa có evidence credential cũ bị vô hiệu hóa.
- Artifact chứa luồng refresh token và gửi token qua Telegram WebApp.
- **2026-11-01:** chưa có authorization hoặc quyền truy cập secret store; task được giữ **BLOCKED**, không tự tạo/đoán credential.

## 3. Phạm vi

- Credential dùng bởi endpoint nội bộ.
- Token/session/customer token liên quan.
- Secret store và cấu hình môi trường.
- Incident note.

Không thuộc phạm vi:

- Xóa artifact khỏi git history (TASK-024).
- Force-push (TASK-026).

## 4. Kế hoạch thực hiện

1. Inventory mọi credential có thể bị ảnh hưởng.
2. Xác định credential nào đã từng được dùng với endpoint đó.
3. Revoke credential cũ trước khi phát hành credential mới.
4. Cập nhật secret store, không ghi secret vào repo.
5. Kiểm tra credential cũ bị từ chối.
6. Kiểm tra credential mới hoạt động trong môi trường được kiểm soát.
7. Ghi evidence: thời gian, người thực hiện, phạm vi, kết quả.
8. Security owner sign-off.

## 5. Test plan

| Kiểm tra | Kỳ vọng |
|---|---|
| Dùng credential cũ | Bị từ chối/401 |
| Dùng credential mới | Hoạt động |
| `git grep` secret pattern | 0 match |
| Audit log rotation | Có evidence |
| Incident checklist | Mục rotate/revoke đã tick |

## 6. Rollback

- Không khôi phục credential đã lộ.
- Nếu credential mới gây lỗi: phát hành credential mới khác, giữ credential cũ đã revoke.
- Mọi thay đổi phải được ghi vào incident note.

## 7. Definition of Done

- Credential cũ bị revoke/rotate.
- Credential mới hoạt động.
- Evidence được lưu ngoài repo.
- Security owner sign-off.
- Không có secret mới trong repo.

## 8. Runbook thực thi — soạn 2026-11-01, chưa chạy

> Không ghi secret, token, cookie hoặc giá trị credential vào repo, ticket, chat hay commit message. Chỉ ghi loại credential, thời gian, người thực hiện và kết quả.

### 8.1. Preconditions

1. Security Owner được chỉ định và có quyền truy cập secret store/credential provider.
2. Có authorization bằng văn bản cho việc revoke/rotate.
3. Đã xác định môi trường bị ảnh hưởng: production/staging/local.
4. Có kênh liên lạc với người vận hành endpoint nội bộ.
5. Đã đọc `docs/incident-2026-10-31.md` và biết phạm vi artifact.

### 8.2. Inventory (không ghi giá trị)

| Loại | Nơi lưu | Đã dùng bởi luồng bị lộ? | Ghi chú |
|---|---|---|---|
| Internal API credential/key | Secret store | Cần xác nhận | Không ghi giá trị |
| Customer refresh token | Session store/DB | Cần xác nhận | Có thể là token per-customer |
| Telegram WebApp session | Runtime/session | Cần xác nhận | Không log `initData` |
| Bot/service token | Secret store | Cần xác nhận | Rotate nếu từng xuất hiện |

### 8.3. Revoke → rotate → verify

1. **Revoke trước:** vô hiệu hóa credential cũ; không giữ song song.
2. **Rotate:** phát hành credential mới trong secret store; không đưa vào repo.
3. **Deploy:** cập nhật môi trường chạy bằng cơ chế secret injection; không sửa file tracked.
4. **Verify old:** gọi endpoint kiểm soát bằng credential cũ → phải bị từ chối (401/403).
5. **Verify new:** gọi endpoint kiểm soát bằng credential mới → phải thành công.
6. **Revoke session/token phụ:** invalidate customer token/session liên quan nếu xác định được.
7. **Audit:** kiểm tra log truy cập bất thường trong cửa sổ từ lúc artifact bị đưa lên đến khi revoke.

### 8.4. Evidence template (lưu ngoài repo)

```text
Incident: 2026-10-31 debug artifact
Task: TASK-025
Thời gian bắt đầu/kết thúc:
Người thực hiện:
Credential loại (không ghi giá trị):
  - Loại:
  - Phạm vi:
  - Revoke lúc:
  - Rotate lúc:
  - Verify old: 401/403
  - Verify new: OK
Session/token phụ đã invalidate:
Audit log đã kiểm tra:
Security Owner sign-off:
```

### 8.5. Điều kiện dừng

- Không có quyền revoke/rotate → dừng, báo Manager, giữ task BLOCKED.
- Không xác định được credential nào đã dùng → coi toàn bộ credential của luồng là đã lộ và rotate.
- Credential mới không hoạt động → phát hành credential mới khác; không khôi phục credential cũ.
- Phát hiện truy cập bất thường → mở incident riêng, không đóng TASK-025.

## 9. Kết quả — 2026-11-02

- **Owner Decision:** `docs/authorizations/authorization-2026-11-02.md` — **APPROVED**.
- **Kết luận:** Không tồn tại credential production đang hoạt động; **không yêu cầu rotation**.
- **Hình thức:** Accepted Risk Approved (personal repo, single owner, no production secrets, no active exposed credential).
- **Đóng task:** DONE — B2 đóng bằng quyết định rủi ro của owner, không có hành động rotate/revoke.
- **Điều kiện mở lại:** Nếu sau này phát hiện credential còn hiệu lực, mở lại task và rotate theo runbook mục 8.
