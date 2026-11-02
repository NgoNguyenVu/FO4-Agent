# TASK-001 — Security cleanup

## Thông tin

- **Priority:** P0
- **Risk:** High
- **Effort:** M
- **Dependency:** TASK-007
- **Status:** **Blocked — REJECTED (2026-10-31)**
- **Owner đề xuất:** Security + Platform
- **Review:** [`docs/reviews/TASK-001-review-2026-10-31.md`](../reviews/TASK-001-review-2026-10-31.md)
- **Repo 2026-11-01:** local `main` tại `a4b7a25` sau rewrite; lịch sử local không còn `debug/trade-bulk.html`/ảnh debug; remote vẫn chứa artifact cho đến `TASK-026`. Patch TASK-001 staged **7 file**.

## 1. Mục tiêu

Loại bỏ hoàn toàn artifact debug nhạy cảm khỏi repository và lịch sử git; chặn tái phát; bảo vệ endpoint nội bộ và logic token.

Phạm vi:

- `debug/trade-bulk.html`
- 10 ảnh `debug/*.png`
- Các file debug mới phát sinh trong working tree
- `.gitignore`
- CI secret scanning

Không thuộc phạm vi:

- Refactor code runtime.
- Thay đổi logic mua/nâng/ICON.
- Xóa script debug đang cần cho vận hành; chỉ di chuyển hoặc làm sạch.

## 2. Bằng chứng

- `debug/trade-bulk.html` 90.192 bytes, 1.309 dòng, đang được track.
- File chứa endpoint nội bộ (đã redacted trong tài liệu), `/api/ping`, logic `customerToken`, `initData`, `telegramId`, refresh token và `Telegram.WebApp.sendData`.
- Chưa thấy JWT/Bearer token literal, nhưng luồng auth đã bị công khai.
- 10 ảnh debug đang được track, có nguy cơ chứa thông tin tài khoản/đơn hàng.
- `.gitignore` chỉ có 8 dòng, không chặn `debug/*.png` hoặc `debug/trade-bulk.html`.

## 3. Kế hoạch thực hiện

1. **Freeze:** thông báo team dừng commit/push vào repo; tạo backup bundle hoặc mirror trước khi rewrite history.
2. **Inventory:** liệt kê toàn bộ artifact nhạy cảm đang track trong `debug/` và các file HTML/PNG phát sinh.
3. **Working tree cleanup:** xóa artifact khỏi working tree; giữ bản backup ngoài repo nếu cần điều tra.
4. **Ignore rules:** thêm `debug/*.png`, `debug/*.html`, file probe output và artifact tạm vào `.gitignore`.
5. **History rewrite:** dùng `git filter-repo` hoặc BFG để xóa artifact khỏi toàn bộ lịch sử; không chỉ xóa ở HEAD.
6. **Credential response:** nếu endpoint/token từng được dùng, thu hồi hoặc rotate credential liên quan; đánh giá lại việc dùng endpoint nội bộ công khai.
7. **Force-push:** force-push lịch sử đã làm sạch; thông báo team re-clone hoặc reset về commit mới.
8. **Secret scanning:** thêm secret scan vào CI; chặn pattern endpoint/token/artifact debug.
9. **Sanitized fixtures:** nếu test cần HTML mẫu, tạo fixture đã làm sạch trong thư mục test, không dùng file thật.
10. **Incident note:** ghi lại phạm vi ảnh hưởng, thời gian, biện pháp, người xử lý.

## 4. Test plan

| Loại | Kiểm tra | Kỳ vọng |
|---|---|---|
| History | `git log --all -- debug/trade-bulk.html` | Không còn kết quả |
| History | `git rev-list --objects --all` quét artifact | Không còn HTML/PNG nhạy cảm |
| Secret scan | Scan endpoint/token pattern | Không còn match |
| Fresh clone | Clone repo mới, kiểm tra `debug/` | Không có artifact |
| Runtime smoke | Mở agent, `/startagent`, `/startmua`, `/startnang`, `/starticon` | Không phụ thuộc file debug |
| Regression | `npm run check` | 174+ test pass |
| CI | PR chứa artifact mẫu | CI fail |

## 5. Rollback

- Giữ backup bundle trước khi rewrite.
- Nếu rewrite sai: restore bundle, force-push lại, thông báo team.
- Nếu secret scan chặn nhầm: cập nhật allowlist có review, không tắt scan.
- Nếu xóa fixture làm test fail: thay bằng fixture đã làm sạch, không khôi phục file thật.

## 6. Definition of Done

- Không còn `debug/trade-bulk.html` trong bất kỳ commit nào.
- Không còn ảnh debug nhạy cảm trong lịch sử.
- `npm run scan:history` pass **0 finding**.
- `.gitignore` chặn artifact mới.
- CI có secret scan **và history scan**; fail khi phát hiện artifact.
- Credential liên quan đã được rotate/revoke, có evidence và sign-off.
- Team đã re-clone; fresh clone không còn artifact.
- Deletion của artifact đã được stage/commit.
- `npm run check` pass.
- Tất cả blocker B1–B9 đóng; `TASK-032` hoàn tất.

## 7. Review và remediation

### 7.1 Kết quả review

- **Verdict:** **REJECTED** ngày 2026-10-31.
- **Đã đạt:** 174/174 test pass tại thời điểm review; `scan:secrets` pass; artifact đã rời working tree; docs đã redact; không phát hiện race condition/architecture violation mới.
- **Cập nhật 2026-11-01:** TASK-024 đã rewrite local — new HEAD `a4b7a25`, `scan:history` pass **0 finding**, 11 artifact đã xóa khỏi mọi commit local; `npm run check` **177/177**. Remote và fresh clone vẫn chờ TASK-026.
- **Chưa đạt:** remote còn artifact; credential chưa rotate; chưa force-push/re-clone; CI chưa scan history; thiếu test scanner; scanner chưa đọc staged blob; deletion chưa được commit/fresh-clone verify; trạng thái docs chưa đóng hoàn toàn.

### 7.2 Map blocker → remediation task

| Blocker | Mức độ | Nội dung | Task |
|---|---|---|---|
| B1 | Critical | Git history còn artifact — **local đã sạch, remote chưa** | `TASK-024` |
| B2 | Critical | Credential chưa rotate/revoke | `TASK-025` |
| B3 | High | Chưa force-push, re-clone, fresh-clone verification | `TASK-026` |
| B4 | High | Patch không cô lập; TASK-007 chưa xong — **đã cô lập, 7 file staged** | `TASK-027` |
| B5 | High | CI chưa scan history | `TASK-028` |
| B6 | High | Thiếu test cho secret scanner — **DONE**; task remediation `TASK-033` **READY_FOR_COMMIT** | `TASK-029` |
| B7 | Medium | Scanner đọc working tree thay vì staged blob | `TASK-030` |
| B8 | Medium | Deletion chưa stage — **đã vào lịch sử rewrite; chờ commit/fresh clone** | `TASK-031` |
| B9 | Low | Task/incident/backlog chưa cập nhật trạng thái | `TASK-032` |

**Thứ tự thực thi:** `TASK-027` → `TASK-024` → `TASK-025` → `TASK-026` → `TASK-028` → `TASK-029` → `TASK-033` → `TASK-030` → `TASK-031` → `TASK-032`.

**Gate:** không commit, push, merge hoặc chạy live cho đến khi tất cả blocker đóng và có security sign-off.

### 7.3 Điều kiện re-review

1. TASK-027 freeze/isolate hoàn tất.
2. TASK-024 rewrite history; `scan:history` pass 0 finding — **đạt local**; remote xác minh qua TASK-026.
3. TASK-025 credential rotation có evidence.
4. TASK-026 force-push/re-clone/fresh clone pass.
5. TASK-028 CI history gate blocking.
6. TASK-029 scanner tests pass — **DONE** (test suite hoàn thiện qua task remediation `TASK-033`, **READY_FOR_COMMIT**).
7. TASK-030 staged-blob scan pass.
8. TASK-031 deletion được stage/commit.
9. TASK-032 evidence và trạng thái cập nhật.

## 8. Cortex plan quality

- **Công cụ:** `cortex_plan_quality`
- **Iteration 1:** 7.6/10 — NEEDS IMPROVEMENT (thiếu deliverable, risk/rollback và verification cụ thể).
- **Iteration 2:** **8.8/10 — APPROVED**.
- **Điểm mạnh:** completeness 10/10, feasibility 9/10, ordering 9/10, impact clarity 9/10.
- **Điểm cần theo dõi khi thực thi:** specificity 8/10 và testability 8/10 — phải giữ đúng command kiểm tra trong mục 4, không thay bằng kiểm tra thủ công.
