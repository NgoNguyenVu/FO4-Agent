# TASK-034 — Authorization Request (Security Remediation)

## Thông tin

- **Priority:** P0
- **Risk:** Critical (TASK-025) / High (TASK-026)
- **Effort:** S
- **Dependency:** TASK-025, TASK-026
- **Blocks:** TASK-032
- **Status:** **DONE** — Authorization Decision APPROVED (TASK-025 Accepted Risk; TASK_026 Force push authorized; authorization-2026-11-02).
- **Owner đề xuất:** Security Owner; Tech Lead + Platform; User/owner

## 1. Mục tiêu

Xin authorization bằng văn bản từ các bên con người cần thiết để thực thi các bước còn dang dở của remediation TASK-001.

## 2. Phân tích blocker

| Task | Blocker hiện tại | Loại blocker | Thực thi tự động được? |
|---|---|---|---|
| `TASK-025` — Rotate/revoke credentials | Cần Security Owner + quyền truy cập credential/secret store + authorization bằng văn bản | **Chỉ yêu cầu quyền con người** | Không |
| `TASK-026` — Force-push cleaned history + fresh clone | Cần authorization push từ user/owner + thông báo team re-clone | **Chỉ yêu cầu quyền con người** | Không |

## 3. Nội dung Authorization Request

### 3.1. Đối với TASK-025 — Rotate/revoke credentials

- Yêu cầu: Security Owner xác nhận quyền truy cập secret store/credential provider.
- Yêu cầu: User/owner ký duyệt revoke/rotate credential cho luồng đã bị lộ qua debug artifact (2026-10-31).
- Sau khi có authorization: Security Owner thực thi theo runbook TASK-025 (revoke → rotate → verify → evidence → sign-off).

### 3.2. Đối với TASK-026 — Force-push cleaned history + fresh clone

- Yêu cầu: User/owner cho phép force-push `main` từ old HEAD `42d3555360dc3885c94f9a9ad5722ff12e722f6c` → new HEAD `a4b7a25c5dc6f52d67ef5812d23580c440e8747c` bằng `--force-with-lease`.
- Yêu cầu: Thông báo team re-clone/reset sau push; xác nhận từng thành viên đã re-clone.
- Sau khi có authorization: thực thi theo kế hoạch TASK-026 (force-push → fresh clone → incident update).

## 4. Risk acceptance status

- Force-push TASK-026: rủi ro High (Data Integrity/Release) — backup bundle và rollback plan đã có; vẫn cần human approval.
- Credential rotation TASK-025: rủi ro Critical — không thể tự động.

## 5. Definition of Done của TASK-034

- Có authorization tương ứng cho TASK-025 và/hoặc TASK-026.
- TASK-025 / TASK-026 chuyển từ `BLOCKED` → `READY` (theo từng task) hoặc thực thi ngay khi được mở.

## 6. Rollback

- Không áp dụng (Authorization Request chỉ là cơ sở pháp lý/ủy quyền).

## 7. Ghi chú

- TASK-034 là task mở (P0) để đảm bảo các bước human-critical không bị bỏ sót.
- Khi authorization về, thứ tự khôi phục tiến trình: `TASK-025` → `TASK-026` → `TASK-028` → `TASK-030` → `TASK-031` → `TASK-032`.
