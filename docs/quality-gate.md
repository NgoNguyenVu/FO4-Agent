# Quality Gate — thang điểm A–F

Áp dụng cho mọi task của chu kỳ Autonomous Project Audit & Continuous Improvement.
Một task chỉ được chuyển `READY_FOR_COMMIT` khi đạt **tối thiểu B (≥ 70/100)**.

| Tiêu chí | Điểm tối đa | Cách chấm |
|---|---|---|
| Test & bằng chứng chạy | 25 | 25 = test mới phủ boundary/failure/recovery + toàn bộ suite xanh; 18 = có unit test nhưng thiếu integration; 10 = chỉ chạy suite có sẵn; 0 = fail |
| Phạm vi & regression | 20 | 20 = đúng file allowlist, không đổi behavior ngoài phạm vi; 14 = có thay đổi phụ đã giải thích; 7 = diff lan rộng; 0 = regression |
| Bảo mật & an toàn dữ liệu | 20 | 20 = fail-closed, không lộ secret/PII, không tăng quyền; 12 = có ghi chú rủi ro; 0 = có lỗ hổng |
| Tài liệu & khả năng vận hành | 15 | 15 = README/runbook + log/heartbeat/snapshot; 10 = chỉ doc task; 5 = không doc |
| Rollback | 10 | 10 = rollback rõ, đã thử/không cần migration; 5 = rollback lý thuyết; 0 = không có |
| Kiểm soát blast radius | 10 | 10 = có `cortex_detect_changes`, regression test cho luồng bị ảnh hưởng; 6 = có detect_changes nhưng thiếu test luồng; 0 = bỏ qua |

Xếp loại: **A ≥ 85**, **B 70–84**, **C 55–69**, **D 40–54**, **F < 40**.
Điểm dưới B ⇒ trả về `IN_PROGRESS` (retry < 2) hoặc `BLOCKED` (retry ≥ 2).
