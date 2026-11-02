# Company State

- **Cập nhật:** 2026-11-02
- **Người cập nhật:** Manager Agent (Engineering Director)
- **Current Sprint:** Security Remediation — TASK-001
- **Company Delivery Status:** **IN_PROGRESS — TASK-001** (B1–B4, B6, B8 đã đóng; còn B5, B7, B9)
- **Active Cycle Status:** **TASK-028 READY** — CI history scan (P0)
- **Current Task:** `TASK-028` — Add history secret scan to CI (**READY**); task kế tiếp: `TASK-030` — Scan staged blobs/index (**READY**).
- **Task Status:** **READY**
- **Reviewer:** **APPROVED** — TASK-027 (2026-11-01), TASK-033 (2026-11-01, record trong TASK-029 completed)
- **QA:** **PASS** — TASK-027 (2026-11-01), TASK-033 (13/13 test, 2026-11-01)
- **Parallel Security Task:** TASK-025 — **ACCEPTED RISK APPROVED** (no active production credential; no rotation required)
- **Blocked Task:** TASK-032 — chờ TASK-028/TASK-030; TASK-001 — chờ B5/B7/B9 + re-review
- **Authorization Required:** TASK-007 — runtime fixes cần Owner Decision + review độc lập
- **TASK-001 Review Verdict:** REJECTED (2026-10-31) — chưa re-review
- **Commit Allowed:** Chỉ khi task = `COMMIT_AUTHORIZED` (không còn freeze chung)
- **Push Allowed:** Chỉ trong phạm vi task đã được authorization
- **Merge Allowed:** NO
- **Live Run Allowed:** NO
- **Security Risk Acceptance:** TASK-025 — **APPROVED** (Accepted Risk); TASK-026 — **APPROVED** (Force push authorized và đã thực thi).

## 1. Kết quả thực thi — 2026-11-02

### 1.1. Commit gate đã mở và thực thi

- **TASK-027:** Reviewer **APPROVED** + QA **PASS**; là Standard Task (không thuộc High-Risk Gates) → `READY_FOR_COMMIT → COMMIT_AUTHORIZED → DONE`.
  - Commit `261e9b7` — `chore(security): add secret scanning and document TASK-001 remediation`.
  - Đúng 7 file: `.github/workflows/security.yml`, `.gitignore`, `docs/backlog.md`, `docs/incident-2026-10-31.md`, `docs/tasks/TASK-001-security-cleanup.md`, `package.json`, `scripts/check-secrets.js`.
- **TASK-033:** Reviewer **APPROVED** + QA **PASS** (13/13) → `COMMIT_AUTHORIZED → DONE`.
  - Commit `f22cf96` — `test(security): cover remaining secret scanner rules and history assertion`.
  - 1 file: `scripts/check-secrets.test.js` (171 dòng).

### 1.2. TASK-026 — force-push và fresh clone

- **Authorization:** `docs/authorizations/authorization-2026-11-02.md` — **APPROVED** (force push authorized; backup verified; rollback available).
- **Pre-push:** remote `main` = `42d3555...`; backup bundle tồn tại; `scan:secrets` pass; `scan:history` pass; `npm run check` **190/190**.
- **Force-push:** `git push --force-with-lease=main:42d3555... origin main` → `42d3555...f22cf96` (forced update).
- **Fresh clone:** `C:\Users\Admin\AppData\Local\Temp\opencode\fo4-task-026-fresh-2026-11-02`, HEAD `f22cf96`.
- **Fresh clone verification:** `scan:secrets` pass; `scan:history` pass; `git log --all -- debug/trade-bulk.html` rỗng; `git rev-list --objects --all` không còn artifact.
- **Residual:** `npm run check` trên fresh clone **188/190** — 2 test fail do runtime fixes của TASK-007 chưa commit. Không phải artifact/secret leak.

### 1.3. TASK-025 — Accepted Risk Approved

- **Authorization:** `docs/authorizations/authorization-2026-11-02.md` — **APPROVED**.
- **Kết luận:** Không tồn tại credential production đang hoạt động; **không yêu cầu rotation**.
- **Hình thức:** Accepted Risk Approved (personal repo, single owner, no production secrets, no active exposed credential).
- **B2 đóng** bằng quyết định rủi ro của owner.

### 1.4. TASK-031 — deletion verification

- 11 artifact đã bị loại khỏi mọi commit từ TASK-024.
- `git log --all -- debug/trade-bulk.html` rỗng; `git ls-files -- 'debug/*.html' 'debug/*.png'` → 0.
- Fresh clone `f22cf96` không còn `debug/trade-bulk.html` hoặc `debug/*.png`.
- **B8 đóng.**

## 2. Blocked By — remediation tasks

TASK-001 chỉ được đóng khi **B1–B9** đóng và có security sign-off.

| Blocker | Task | Status | Ghi chú |
|---|---|---|---|
| B1 — History còn artifact | `TASK-024` | **DONE** | History sạch; đã force-push; fresh clone 0 finding |
| B2 — Credential chưa rotate | `TASK-025` | **DONE** | Accepted Risk Approved — no active credential |
| B3 — Chưa force-push/re-clone | `TASK-026` | **DONE** | Remote `f22cf96`; fresh clone scan pass |
| B4 — Patch không cô lập | `TASK-027` | **DONE** | Commit `261e9b7`, đúng 7 file |
| B5 — CI chưa scan history | `TASK-028` | **READY** | Cần thêm `fetch-depth: 0` + `scan:history` blocking |
| B6 — Thiếu test scanner | `TASK-029` | **DONE** | Hoàn thiện qua `TASK-033`; 13/13 test |
| B7 — Scanner đọc working tree | `TASK-030` | **READY** | Cần mode đọc staged blob/index |
| B8 — Deletion chưa stage | `TASK-031` | **DONE** | Verified trong history + fresh clone |
| B9 — Thiếu cập nhật trạng thái | `TASK-032` | **BLOCKED** | Chờ B5, B7 |

**Thứ tự còn lại:** `TASK-028` → `TASK-030` → `TASK-032` → TASK-001 re-review + QA.

## 3. Gate để mở block TASK-001

- [x] `npm run scan:history` pass **0 finding** trên local, remote và fresh clone.
- [x] Credential cũ bị vô hiệu hóa hoặc **Accepted Risk Approved** (owner decision: no active credential).
- [x] Remote sạch; fresh clone pass `scan:secrets`, `scan:history`.
- [x] Scanner có test; staged secret bị phát hiện.
- [x] Deletion của artifact đã được commit và xác minh trên fresh clone.
- [ ] CI có history scan blocking và negative test (`TASK-028`).
- [ ] Scanner đọc staged blob/index (`TASK-030`).
- [ ] Evidence/status + security sign-off (`TASK-032`).
- [ ] TASK-001 Reviewer re-review + QA pass.
- [ ] `npm run check` trên fresh clone/CI xanh — phụ thuộc TASK-007 runtime fixes.

## 4. Trạng thái công ty

| Mảng | Trạng thái | Ghi chú |
|---|---|---|
| Engineering | **Remediation tiếp tục** | Patch TASK-001 đã commit/push; không merge/release/live |
| Security | **Đang xử lý** | History sạch; CI history gate và staged-blob scan còn mở |
| Release | **Blocked** | Không chạy live, không merge thay đổi lớn |
| Task board | **4 task mở + 8 completed** | Mở: TASK-007, 028, 030, 032; completed: 024, 025, 026, 027, 029, 031, 033, 034 |
| Bàn giao tiếp theo | `TASK-028` — CI history scan (**READY**) | Coder → Reviewer → QA |

## 5. Quyết định của Manager — 2026-11-02

- **Commit gate:** Mở theo `.ai/company.md` §4 và **Special Rule: Remediation Patch**. TASK-027/TASK-033 đủ Reviewer + QA, là Standard Task, là prerequisite của remediation chain → `COMMIT_AUTHORIZED → DONE`.
- **Freeze tự đặt trong `docs/queue.md` cũ** (không có trong `.ai/company.md`) đã được gỡ; thay bằng đúng luật: commit chỉ khi task = `COMMIT_AUTHORIZED`.
- **TASK-026:** Force push authorized và đã thực thi với `--force-with-lease`; backup + rollback còn nguyên.
- **TASK-025:** Đóng bằng Accepted Risk Approved; không rotate vì owner xác nhận không có credential production đang hoạt động.
- **TASK-031:** Đóng bằng evidence trên history + fresh clone.
- **TASK-007:** Chuyển **AUTHORIZATION_REQUIRED** — runtime fixes (`config.json`, `loop.js`, `runner.js`) là Critical risk, cần Owner Decision + review độc lập. Đây là nguyên nhân 2 test fail trên fresh clone/CI.
- **Không tạo task mới.**

## 6. Next Action

1. `TASK-028` — Coder thêm `fetch-depth: 0` và step `npm run scan:history` blocking; Reviewer + QA.
2. `TASK-030` — Coder thêm mode scan staged blob/index; test stage-secret-rồi-xóa-working-tree; Reviewer + QA.
3. `TASK-032` — cập nhật TASK-001/incident/backlog/roadmap, lưu evidence, security sign-off.
4. TASK-001 — Reviewer re-review + QA pass; chỉ đóng khi B1–B9 đóng.
5. TASK-007 — chờ Owner Decision cho runtime commit/push để CI xanh.

**STOP CONDITION: NO** — còn `TASK-028` và `TASK-030` ở trạng thái READY, cùng `TASK-007` cần Owner Decision. Chưa thỏa đồng thời 3 điều kiện STOP của `.ai/company.md`.
