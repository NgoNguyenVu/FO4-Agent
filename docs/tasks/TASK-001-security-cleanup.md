# TASK-001 — Security cleanup

## Thông tin

- **Priority:** P0
- **Risk:** High
- **Effort:** M
- **Dependency:** TASK-007
- **Status:** **DONE (2026-11-14)** — Reviewer re-review **APPROVED** + QA **PASS** (2026-11-14); B1–B9 closed; `scan:history` 0 finding (local + fresh clone); CI `main` xanh. Xem [re-review](../reviews/TASK-001-rereview-2026-11-14.md), [qa](../reviews/TASK-001-qa-2026-11-14.md), [completed](../completed/TASK-001-security-cleanup.md).
- **Owner đề xuất:** Security + Platform
- **Review:** [`docs/reviews/TASK-001-review-2026-10-31.md`](../reviews/TASK-001-review-2026-10-31.md)
- **Repo 2026-11-01:** local `main` tại `a4b7a25` sau rewrite; lịch sử local không còn `debug/trade-bulk.html`/ảnh debug; remote vẫn chứa artifact cho đến `TASK-026`. Patch TASK-001 staged **7 file**.
- **Repo 2026-11-04:** local `main` `3b048b9` (4 commit chưa push: `7f9291b`, `412a8f0`, `4d16d41`, `3b048b9`); remote `main` `26a9d46`; `npm run check` local **198/198**; `scan:secrets`/`scan:staged` pass; `scan:history` local fail 1 finding (**F1**, `refs/agents/*`), fresh clone pass.

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

> **Trạng thái 2026-11-04:** mục 1–8 và 10 đạt; mục 9 đạt **local 198/198** nhưng chưa đạt trên remote/fresh clone do `TASK-007`. TASK-032 **không** đánh dấu TASK-001 là Done; TASK-001 ở `REMEDIATION_COMPLETE — pending re-review + QA`.

## 7. Review và remediation

### 7.1 Kết quả review

- **Verdict:** **REJECTED** ngày 2026-10-31.
- **Đã đạt:** 174/174 test pass tại thời điểm review; `scan:secrets` pass; artifact đã rời working tree; docs đã redact; không phát hiện race condition/architecture violation mới.
- **Cập nhật 2026-11-01:** TASK-024 đã rewrite local — new HEAD `a4b7a25`, `scan:history` pass **0 finding**, 11 artifact đã xóa khỏi mọi commit local; `npm run check` **177/177**. **2026-11-02:** remote và fresh clone đã xác minh tại `f22cf96`; `npm run check` local **190/190**, fresh clone **188/190** (TASK-007).
- **Cập nhật 2026-11-04:** B5 (`26a9d46`), B7 (`4d16d41` + core `7f9291b`) và B9 (TASK-032) đã đóng. `TASK-001` chuyển **REMEDIATION_COMPLETE — pending re-review + QA**; **không** đánh dấu Done. Local `npm run check` **198/198**; remote/fresh clone vẫn **188/190** do `TASK-007`.
- **Còn lại (không thuộc B1–B9):** Reviewer re-review + QA; CI/fresh-clone xanh (blocked by `TASK-007`); residual F1/F2 (local secret hygiene).

### 7.2 Map blocker → remediation task

| Blocker | Mức độ | Nội dung | Task |
|---|---|---|---|
| B1 | Critical | Git history còn artifact — **DONE**, remote sạch tại `f22cf96` | `TASK-024` |
| B2 | Critical | Credential chưa rotate/revoke — **DONE**, Accepted Risk Approved (no active credential) | `TASK-025` |
| B3 | High | Chưa force-push, re-clone, fresh-clone verification — **DONE** | `TASK-026` |
| B4 | High | Patch không cô lập — **DONE** (`261e9b7`, 7 file) | `TASK-027` |
| B5 | High | CI chưa scan history — **DONE** (`26a9d46`; `fetch-depth: 0` + blocking `scan:history`) | `TASK-028` |
| B6 | High | Thiếu test cho secret scanner — **DONE** (qua `TASK-033`, `f22cf96`) | `TASK-029` |
| B7 | Medium | Scanner đọc working tree thay vì staged blob — **DONE** (`4d16d41`; core `7f9291b`; 21/21 test) | `TASK-030` |
| B8 | Medium | Deletion chưa commit/fresh-clone verify — **DONE** | `TASK-031` |
| B9 | Low | Task/incident/backlog chưa cập nhật — **DONE** (TASK-032, evidence 2026-11-04; TASK-032 review/QA pending) | `TASK-032` |

**Thứ tự còn lại:** `TASK-001` re-review → QA → đóng `TASK-001`. `TASK-007` là external blocker duy nhất cho CI xanh.

**Gate:** commit chỉ khi task = `COMMIT_AUTHORIZED`; không merge/release/live cho đến khi tất cả blocker đóng và có security sign-off. TASK-032 không merge/release/live.

### 7.3 Điều kiện re-review

1. TASK-027 freeze/isolate hoàn tất — **DONE** (`261e9b7`).
2. TASK-024 rewrite history; `scan:history` pass 0 finding — **đạt local, remote và fresh clone** tại `f22cf96`.
3. TASK-025 credential decision có evidence — **Accepted Risk Approved** (no active credential).
4. TASK-026 force-push/re-clone/fresh clone pass — **DONE** (`42d3555...f22cf96`).
5. TASK-028 CI history gate blocking — **DONE** (`26a9d46`).
6. TASK-029 scanner tests pass — **DONE** (qua `TASK-033`, `f22cf96`).
7. TASK-030 staged-blob scan pass — **DONE** (`4d16d41`; review/QA 2026-11-04).
8. TASK-031 deletion được stage/commit — **DONE**.
9. TASK-032 evidence và trạng thái cập nhật — **DONE** (evidence 2026-11-04; TASK-032 review/QA pending).
10. CI/fresh-clone `npm run check` xanh — **BLOCKED by `TASK-007`** (remote/fresh clone `f22cf96` = 188/190; runtime fixes chưa được authorize/push).

> Điều kiện 1–9 đã đạt. **Re-review chưa được thực hiện**; verdict vẫn REJECTED cho đến khi Reviewer ra verdict mới.

## 8. Cortex plan quality

- **Công cụ:** `cortex_plan_quality`
- **Iteration 1:** 7.6/10 — NEEDS IMPROVEMENT (thiếu deliverable, risk/rollback và verification cụ thể).
- **Iteration 2:** **8.8/10 — APPROVED**.
- **Điểm mạnh:** completeness 10/10, feasibility 9/10, ordering 9/10, impact clarity 9/10.
- **Điểm cần theo dõi khi thực thi:** specificity 8/10 và testability 8/10 — phải giữ đúng command kiểm tra trong mục 4, không thay bằng kiểm tra thủ công.

## 9. Remediation evidence — 2026-11-04

### 9.1. Repo snapshot

| Hạng mục | Giá trị |
|---|---|
| Local `main` | `3b048b9` |
| Remote `main` | `26a9d46` |
| Commit local chưa push | `7f9291b`, `412a8f0`, `4d16d41`, `3b048b9` |
| `npm run check` local | 198/198 |
| `scan:secrets` / `scan:staged` | pass |
| `scan:history` local | fail 1 finding (F1 — `refs/agents/*`) |
| Fresh clone từ local HEAD | 3 scan pass |

### 9.2. Blocker → evidence

| Blocker | Task | Bằng chứng | Trạng thái |
|---|---|---|---|
| B1 | TASK-024 | rewrite `a4b7a25`; remote `26a9d46`; `scan:history` 0 finding trên remote/fresh clone; `git log --all -- debug/trade-bulk.html` rỗng | DONE |
| B2 | TASK-025 | authorization-2026-11-02 + risk-acceptance-2026-11-02 (no active credential) | DONE (accepted risk) |
| B3 | TASK-026 | force-push `42d3555...f22cf96`; fresh clone sạch | DONE |
| B4 | TASK-027 | `261e9b7`, đúng 7 file | DONE |
| B5 | TASK-028 | `26a9d46`; `fetch-depth: 0` + `scan:history` blocking | DONE |
| B6 | TASK-029/TASK-033 | `f22cf96`; 13/13 → 21/21 scanner test | DONE |
| B7 | TASK-030 | `4d16d41` (+ core `7f9291b`); Reviewer APPROVED + QA PASS 2026-11-04 | DONE |
| B8 | TASK-031 | deletion verified trong history + fresh clone | DONE |
| B9 | TASK-032 | mục 9 này + sign-off 9.4 | DONE (evidence; TASK-032 review/QA pending) |

### 9.3. Verification commands

```text
npm run check                 # 198/198
npm run scan:secrets          # pass
npm run scan:staged           # pass
npm run scan:history          # local: 1 finding (F1); fresh clone: pass
git log --all -- debug/trade-bulk.html   # rỗng
git ls-files 'debug/*.html' 'debug/*.png' # rỗng
```

### 9.4. Security sign-off — remediation evidence

- **Phạm vi:** xác nhận evidence B1–B9 đầy đủ, khớp repo; **không** phải phê duyệt production/live và **không** phải verdict review.
- **Delivery attestation:** Engineering Manager (Company Executor) — evidence/docs khớp repo tại `3b048b9`; không overclaim TASK-001.
- **Security attestation:** **APPROVED** bởi Security Owner **NgoNguyenVu** ngày **2026-11-04** — xem [`docs/authorizations/security-signoff-2026-11-04-task-032.md`](../authorizations/security-signoff-2026-11-04-task-032.md).
- **Căn cứ:** [`authorization-2026-11-02`](../authorizations/authorization-2026-11-02.md) (TASK-025 Accepted Risk, TASK-026 force-push); [`risk-acceptance-2026-11-02`](../risk-acceptance-2026-11-02-security-remediation.md); TASK-030 review/QA; TASK-033 test; kết quả 2026-11-04.
- **Owner Decision mới:** không cần cho phạm vi này.
- **Chưa bao gồm:** TASK-001 `Done`, merge/release/live, TASK-007, F1/F2.

### 9.5. Residual risk & follow-up

- **F1:** local `refs/agents/*` chứa Bearer token → `scan:history` local fail; không có trong remote/fresh clone.
- **F2:** `.mcp.json` untracked chứa key, chưa được ignore → cấm `git add -A`; cần ignore trước commit kế tiếp.
- **TASK-007:** `AUTHORIZATION_REQUIRED`; `7f9291b` chứa runtime fixes chưa được authorize/push; là external blocker duy nhất cho CI xanh.
- **Follow-up đề xuất:** `TASK-035 (proposed)` — local secret hygiene (F1/F2). Không tạo file task trong TASK-032.
