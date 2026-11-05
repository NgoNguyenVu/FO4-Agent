# Authorization: TASK-039 (ICON continuous-buy + inventory gate refactor)

- **Date:** 2026-11-05
- **Owner Decision:** APPROVED (tạm thời cho Review/QA; cần quyết định tài chính chính thức cho giá trị vượt giới hạn)
- **Scope:** Phê duyệt Review + QA cho code ICON mới (trong working tree, chưa commit). Code chứa các tham số tài chính mới:
  - `maxPriceBP`: 888.888 (vượt giới hạn TASK-007)
  - `purchaseTimeoutSeconds`: 0 (vô hạn)
- **Chú ý:** Owner cần xác nhận chấp nhận rủi ro trước khi commit. Nếu vượt giới hạn, cần TASK-003 chính thức.
- **Sign-off:** Ngô Nguyên Vũ (Owner / CEO)