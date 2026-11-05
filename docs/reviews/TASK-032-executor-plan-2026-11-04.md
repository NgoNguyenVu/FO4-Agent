# TASK-032 — Executor Plan (2026-11-04)

> **Vai trò:** Company Executor (Delivery Manager). Đây là plan, không phải implementation.
> **Phạm vi:** docs-only. Không sửa source/test/CI/`package.json`; không sửa `docs/queue.md` hoặc `docs/company-state.md`; không push/merge/release/live.
> **Output của Coder:** một commit docs (khi có `COMMIT_AUTHORIZED`) + cập nhật trạng thái task; không tạo task file mới trong TASK-032.

---

## CURRENT TASK

**`TASK-032` — Close TASK-001 remediation and record evidence**
File: [`docs/tasks/TASK-032-close-remediation.md`](../tasks/TASK-032-close-remediation.md)
Priority P2 · Risk Low · Effort S · `retry_count` 0 · Dependency `TASK-024 → TASK-031`.

---

## TASK STATUS

| Mốc | Trạng thái |
|---|---|
| Hiện tại | `READY` |
| Sau khi Coder hoàn tất docs + evidence | `REVIEW` — **không tự đánh dấu `DONE`** |
| Sau Reviewer APPROVED + QA PASS + security sign-off | `DONE` (Manager cập nhật 1 dòng, archive sau) |
| `TASK-001` sau TASK-032 | `REMEDIATION_COMPLETE — pending re-review + QA` — **không phải `Done`** |

**Lý do không đánh dấu `TASK-032` là `DONE` ngay trong commit docs:** commit `412a8f0` đã từng tick TASK-032 khi task chưa chạy; lặp lại lỗi này sẽ làm hỏng audit trail. Docs ghi `TASK-032 — evidence recorded 2026-11-04 (in review)`; chỉ Manager flip sang `DONE` sau review/QA.

---

## DEPENDENCY & BLOCKER CHECK

### 1. Dependency bắt buộc

| Task | Trạng thái | Bằng chứng | Đủ điều kiện? |
|---|---|---|---|
| `TASK-024` | DONE | rewrite `a4b7a25`; remote sạch tại `26a9d46` | Có |
| `TASK-025` | DONE — Accepted Risk | `docs/authorizations/authorization-2026-11-02.md`; `docs/risk-acceptance-2026-11-02-security-remediation.md` | Có |
| `TASK-026` | DONE | force-push `42d3555...f22cf96`; fresh clone sạch | Có |
| `TASK-027` | DONE | `261e9b7`, 7 file | Có |
| `TASK-028` | DONE | `26a9d46`; `.github/workflows/security.yml` có `fetch-depth: 0` + `scan:history` blocking | Có |
| `TASK-029` / `TASK-033` | DONE | `f22cf96`; scanner test 13/13, sau đó 21/21 cùng TASK-030 | Có |
| `TASK-030` | DONE | `4d16d41` (+ core `7f9291b`); Reviewer APPROVED + QA PASS 2026-11-04 | Có |
| `TASK-031` | DONE | deletion verified trong history + fresh clone | Có |
| `TASK-034` | DONE | authorization-2026-11-02 APPROVED | Có |

Kết luận: **B1–B8 đã đóng; B9 là TASK-032.** Không có dependency nào chặn TASK-032.

### 2. Repo snapshot phải dùng xuyên suốt (không được bịa số khác)

| Hạng mục | Giá trị 2026-11-04 |
|---|---|
| Local `main` | `3b048b96fd13bd205447fa2baea2bdc1aeedac8b` |
| Remote `main` | `26a9d46424aa121c0a65cef15e87d27e7cfe402f` |
| Commit local chưa push | `7f9291b`, `412a8f0`, `4d16d41`, `3b048b9` (4 commit) |
| `npm run check` local | **198/198 pass** |
| `npm run scan:secrets` | pass |
| `npm run scan:staged` | pass |
| `npm run scan:history` local | **fail 1 finding `Bearer token`** do ref local `refs/agents/*` (**F1**) |
| Fresh clone từ local HEAD | `--history` / `--staged` / `--secrets` đều pass |
| Remote/fresh clone `f22cf96` | `npm run check` **188/190** — 2 fail do runtime fixes TASK-007 |
| Artifact trong history | `git log --all -- debug/trade-bulk.html` rỗng; `git ls-files 'debug/*.html' 'debug/*.png'` rỗng |

### 3. Blocker / risk ngoài scope

| ID | Mô tả | Ảnh hưởng TASK-032 | Xử lý |
|---|---|---|---|
| `TASK-007` | `AUTHORIZATION_REQUIRED`; `7f9291b` đã chứa runtime fixes (`config.json`, `features/upgrade/loop.js`, `features/upgrade/runner.js`) nhưng **chưa có Owner Decision** | Không chặn docs; chặn CI/fresh-clone xanh và TASK-001 `Done` | Giữ nguyên trạng thái; ghi là **external blocker duy nhất cho CI xanh** |
| F1 | Local ref `refs/agents/*` chứa Bearer token | Không chặn TASK-032; làm `scan:history` local fail | Ghi residual risk + đề xuất follow-up `TASK-035` |
| F2 | `.mcp.json` untracked chứa key, **chưa được ignore** | Có thể bị commit nhầm nếu dùng `git add -A` | Cấm `git add -A`; ghi residual risk + đề xuất `TASK-035` |
| Working tree bẩn | `.ai/*` modified/deleted, `config.json` modified, `docs/archive.md` untracked | Có thể cuốn vào commit docs | Chỉ stage đúng 6 file docs + file TASK-032 |

**Kết luận blocker:** TASK-032 **không bị block**. TASK-001 bị block bởi re-review/QA + TASK-007, không phải bởi TASK-032.

---

## DECISIONS (bắt buộc ghi đúng vào docs)

### 1. Có được đánh dấu `TASK-001` là `Done` trong TASK-032 không?

**Không.** TASK-032 chỉ đóng phần **remediation evidence (B9)**. `TASK-001` phải giữ:

```text
Status: REMEDIATION_COMPLETE — pending re-review + QA
```

Lý do:

1. Review verdict hiện tại vẫn là **REJECTED**; Reviewer chưa ra verdict mới. Docs không được tự đổi verdict.
2. QA chưa chạy lại TASK-001 sau remediation.
3. CI/fresh-clone `npm run check` chưa xanh trên remote vì `TASK-007` chưa được authorize/push.
4. TASK-001 DoD yêu cầu `npm run check` pass; local đạt 198/198 nhưng remote/fresh clone vẫn 188/190.

Cách diễn đạt chuẩn (dùng thống nhất ở mọi file):

> `TASK-001` — **REMEDIATION_COMPLETE (B1–B9 closed 2026-11-04)**. **Không** đánh dấu `Done`: còn Reviewer re-review + QA; CI/fresh-clone xanh phụ thuộc `TASK-007`. Không merge/release/live.

`P0-01` tương ứng: **Remediation complete — pending TASK-001 re-review + QA** (không `Closed`).
Incident: **Open — remediation complete; pending re-review + QA** (không `Closed`).

### 2. Security sign-off — ký dựa trên evidence nào, ai ký, có cần Owner Decision mới?

**Ký 2 tầng, chỉ trong phạm vi remediation evidence:**

| Tầng | Người ký | Nội dung |
|---|---|---|
| 1. Delivery attestation | **Engineering Manager (Company Executor)** | Xác nhận docs/evidence khớp repo tại `3b048b9`; không overclaim TASK-001 |
| 2. Security attestation | **Security Owner (NgoNguyenVu)** hoặc người được Owner ủy quyền **bằng văn bản** | Xác nhận risk acceptance/force-push đã được duyệt; không phê duyệt production/live |

**Căn cứ ký (bắt buộc liệt kê trong TASK-001 §9.4):**

1. `docs/authorizations/authorization-2026-11-02.md` — TASK-025 Accepted Risk Approved; TASK-026 force-push APPROVED/EXECUTED.
2. `docs/risk-acceptance-2026-11-02-security-remediation.md` — residual risk đã được Owner chấp nhận.
3. `TASK-030` Reviewer APPROVED + QA PASS (2026-11-04), scanner 21/21.
4. `TASK-033` `f22cf96` 13/13; `TASK-028` `26a9d46` CI history gate.
5. Kết quả 2026-11-04: `npm run check` 198/198; `scan:secrets`/`scan:staged` pass; fresh clone local HEAD pass 3 scan.

**Owner Decision mới:** **Không cần** cho phạm vi TASK-032, vì không thực hiện hành động rủi ro mới (không push/merge/release, không đổi credential). Các hành động rủi ro đã được Owner duyệt trong `authorization-2026-11-02`.

**Fallback:** nếu không có chữ ký Security Owner/người được ủy quyền, TASK-032 giữ `EVIDENCE_COMPLETE — pending security sign-off`; B9 **không** đóng; không flip `DONE`.

### 3. F1/F2 — tạo follow-up task hay chỉ ghi risk?

**Ghi risk + đề xuất follow-up, không tạo task file mới trong TASK-032.**

- **F2 (ưu tiên cao hơn):** `.mcp.json` untracked chứa key, chưa nằm trong `.gitignore`. Đây là lỗ hổng hygiene thật: một lệnh `git add -A` có thể commit key. TASK-032 docs-only **không được** sửa `.gitignore`, nên chỉ ghi risk và cấm `git add -A`.
- **F1:** local ref `refs/agents/*` chứa Bearer token; chỉ ảnh hưởng máy local, không nằm trong remote/fresh clone. Cần xóa ref cũ sau khi xác nhận không cần checkpoint.
- **Đề xuất:** một follow-up `TASK-035` (P1, S) — “Local secret hygiene: ignore `.mcp.json`; xóa stale `refs/agents/*`; xác minh không vào index/history”. Ghi vào backlog §4.2 và task board §2.1 dưới dạng **`TASK-035 (proposed)`**, **không** tạo file task và **không** thêm link file trong TASK-032. Manager tạo task chính thức ở chu kỳ sau.
- Không đưa F1/F2 vào TASK-001 B1–B9: chúng phát sinh sau remediation, ngoài scope review 2026-10-31.

### 4. TASK-007 — xử lý trong docs thế nào?

Giữ nguyên **`AUTHORIZATION_REQUIRED`** ở mọi file. Ghi rõ:

> `TASK-007` là **external blocker duy nhất** khiến CI/fresh-clone `npm run check` chưa xanh. Commit `7f9291b` (local, chưa push) đã chứa runtime fixes nhưng **chưa có Owner Decision**; không được push/merge hoặc hợp thức hóa commit này trong TASK-032. Remote `main` `26a9d46` không chứa các fix này.

Không đổi TASK-007 sang `DONE`, không gộp fix vào TASK-032, không tuyên bố CI xanh.

---

## IMPLEMENTATION PLAN

### 0. Quy tắc chung

1. Dùng **duy nhất** bảng “Repo snapshot” ở trên cho mọi con số/hash.
2. Không đổi verdict lịch sử trong review record; chỉ **append addendum**.
3. Không sửa `docs/queue.md`, `docs/company-state.md`.
4. Không dùng `git add -A` / `git add .`; stage đúng danh sách file.
5. Không tạo task file mới; không move/rename TASK-032 trong task này.
6. Mọi thay đổi docs phải dùng thì hiện tại **2026-11-04** và giữ tiếng Việt nhất quán với file hiện có.

### 1. `docs/tasks/TASK-001-security-cleanup.md`

**1.1. Header**

- Dòng 9, thay:
  ```text
  - **Status:** **Blocked — REJECTED (2026-10-31)**
  ```
  bằng:
  ```text
  - **Status:** **REMEDIATION_COMPLETE (2026-11-04)** — B1–B9 closed; **not Done**: pending Reviewer re-review + QA; CI/fresh-clone green blocked by `TASK-007`
  ```
- Sau dòng 12 (`Repo 2026-11-01`), thêm:
  ```text
  - **Repo 2026-11-04:** local `main` `3b048b9` (4 commit chưa push: `7f9291b`, `412a8f0`, `4d16d41`, `3b048b9`); remote `main` `26a9d46`; `npm run check` local **198/198**; `scan:secrets`/`scan:staged` pass; `scan:history` local fail 1 finding (**F1**, `refs/agents/*`), fresh clone pass.
  ```

**1.2. §7.1 Kết quả review**

- Giữ nguyên lịch sử 2026-10-31/11-01/11-02.
- Thêm bullet:
  ```text
  - **Cập nhật 2026-11-04:** B5 (`26a9d46`), B7 (`4d16d41` + core `7f9291b`) và B9 (TASK-032) đã đóng. `TASK-001` chuyển **REMEDIATION_COMPLETE — pending re-review + QA**; **không** đánh dấu Done. Local `npm run check` **198/198**; remote/fresh clone vẫn **188/190** do `TASK-007`.
  ```
- Thay bullet “Chưa đạt” bằng:
  ```text
  - **Còn lại (không thuộc B1–B9):** Reviewer re-review + QA; CI/fresh-clone xanh (blocked by `TASK-007`); residual F1/F2 (local secret hygiene).
  ```

**1.3. §7.2 Map blocker → remediation task**

- B5: `**READY**` → `**DONE** (`26a9d46`; `fetch-depth: 0` + blocking `scan:history`)`
- B7: `**READY**` → `**DONE** (`4d16d41`; core `7f9291b`; 21/21 test)`
- B9: `**BLOCKED** (B5, B7)` → `**DONE** (TASK-032, evidence 2026-11-04; TASK-032 review/QA pending)`
- Thay dòng “Thứ tự còn lại”:
  ```text
  **Thứ tự còn lại:** `TASK-001` re-review → QA → đóng `TASK-001`. `TASK-007` là external blocker duy nhất cho CI xanh.
  ```
- Giữ nguyên gate; bổ sung: “TASK-032 không merge/release/live.”

**1.4. §7.3 Điều kiện re-review**

- Mục 5: `**READY**` → `**DONE** (`26a9d46`).`
- Mục 7: `**READY**` → `**DONE** (`4d16d41`; review/QA 2026-11-04).`
- Mục 9: `**BLOCKED** (chờ B5, B7)` → `**DONE** (evidence 2026-11-04; TASK-032 review/QA pending).`
- Thêm mục 10:
  ```text
  10. CI/fresh-clone `npm run check` xanh — **BLOCKED by `TASK-007`** (remote/fresh clone `f22cf96` = 188/190; runtime fixes chưa được authorize/push).
  ```
- Thêm ghi chú ngay dưới danh sách:
  ```text
  > Điều kiện 1–9 đã đạt. **Re-review chưa được thực hiện**; verdict vẫn REJECTED cho đến khi Reviewer ra verdict mới.
  ```

**1.5. §6 Definition of Done**

- Giữ nguyên danh sách gốc (là định nghĩa, không sửa lịch sử).
- Thêm blockquote sau danh sách:
  ```text
  > **Trạng thái 2026-11-04:** mục 1–8 và 10 đạt; mục 9 đạt **local 198/198** nhưng chưa đạt trên remote/fresh clone do `TASK-007`. TASK-032 **không** đánh dấu TASK-001 là Done; TASK-001 ở `REMEDIATION_COMPLETE — pending re-review + QA`.
  ```

**1.6. Thêm §9 “Remediation evidence — 2026-11-04”**

Cấu trúc bắt buộc:

```markdown
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
- **Ký:** Engineering Manager (delivery attestation) + Security Owner (NgoNguyenVu) hoặc người được Owner ủy quyền bằng văn bản.
- **Căn cứ:** authorization-2026-11-02; risk-acceptance-2026-11-02; TASK-030 review/QA; TASK-033 test; kết quả 2026-11-04.
- **Owner Decision mới:** không cần cho phạm vi này.
- **Chưa bao gồm:** TASK-001 `Done`, merge/release/live, TASK-007, F1/F2.

### 9.5. Residual risk & follow-up
- **F1:** local `refs/agents/*` chứa Bearer token → `scan:history` local fail; không có trong remote/fresh clone.
- **F2:** `.mcp.json` untracked chứa key, chưa được ignore → cấm `git add -A`; cần ignore trước commit kế tiếp.
- **TASK-007:** `AUTHORIZATION_REQUIRED`; `7f9291b` chứa runtime fixes chưa được authorize/push; là external blocker duy nhất cho CI xanh.
- **Follow-up đề xuất:** `TASK-035 (proposed)` — local secret hygiene (F1/F2). Không tạo file task trong TASK-032.
```

### 2. `docs/tasks/README.md`

**2.1. Header (dòng 3)**

```text
- **Cập nhật:** 2026-11-04 (TASK-032 evidence recorded — B1–B9 closed; TASK-001 REMEDIATION_COMPLETE, chờ re-review + QA; TASK-007 AUTHORIZATION_REQUIRED)
```

**2.2. §2 TASK-001**

Thêm bullet sau dòng 60 (`Dependency`):

```text
- **Status 2026-11-04:** **REMEDIATION_COMPLETE** — B1–B9 closed; **không Done**: chờ Reviewer re-review + QA; CI xanh phụ thuộc `TASK-007`.
```

**2.3. §2.1 B1–B9**

- B5: `**READY**` → `**DONE** (`26a9d46`; `fetch-depth: 0` + blocking `scan:history`)`
- B7: `**READY**` → `**DONE** (`4d16d41`; core `7f9291b`; 21/21)`
- B9: `**BLOCKED** (B5, B7)` → `**DONE** (TASK-032, evidence 2026-11-04; review/QA pending)`
- Thay dòng “Thứ tự còn lại”:
  ```text
  **Thứ tự còn lại:** TASK-001 re-review → QA → đóng TASK-001. `TASK-007` là external blocker duy nhất cho CI xanh.
  ```
- Gate: thêm “cho đến khi TASK-001 re-review + QA pass và CI xanh (`TASK-007`)”.
- Thêm note dưới bảng:
  ```text
  > `TASK-032` DONE về evidence; file còn trong `docs/tasks/` chờ Manager archive sau review/QA. `TASK-035 (proposed)` — local secret hygiene F1/F2 — chưa tạo file.
  ```

**2.4. §4 Task ưu tiên hiện tại**

Thay toàn bộ block “CURRENT TASK: TASK-028 …” (dòng 158–178) bằng:

```markdown
**CURRENT TASK: không còn task READY trong sprint remediation.**

Trạng thái 2026-11-04:

- **TASK-032 REVIEW** — evidence B1–B9 đã ghi; chờ Reviewer/QA xác nhận.
- **TASK-001 REMEDIATION_COMPLETE** — B1–B9 closed; chưa Done: chờ re-review + QA.
- **TASK-007 AUTHORIZATION_REQUIRED** — `7f9291b` chứa runtime fixes chưa được authorize/push; external blocker duy nhất cho CI xanh.
- **TASK-028/030/033/034 DONE** — xem `docs/completed/`.

**Next action:** Reviewer re-review `TASK-001` → QA → đóng `TASK-001` (chỉ sau khi `TASK-007` được xử lý để CI xanh).

**STOP CONDITION: NO** — còn `TASK-007` cần Owner Decision và `TASK-001` chưa re-review/QA.
```

**2.5. Không sửa** bảng tổng hợp 34 task, trừ khi cần thêm ghi chú `TASK-035 (proposed)`; không thêm link file cho task chưa tồn tại.

### 3. `docs/backlog.md`

**3.1. Header**

- Dòng 3:
  ```text
  - **Cập nhật:** 2026-11-04 (TASK-032 evidence — B1–B9 closed; TASK-001 REMEDIATION_COMPLETE, chờ re-review + QA; TASK-007 AUTHORIZATION_REQUIRED)
  ```
- Dòng 6:
  ```text
  - **Trạng thái repo:** local `main` `3b048b9` (4 commit chưa push: `7f9291b`, `412a8f0`, `4d16d41`, `3b048b9`); remote `main` `26a9d46`; history remote/fresh clone sạch artifact. `7f9291b` chứa runtime fixes TASK-007 nhưng **chưa có Owner Decision**. Working tree còn `.ai/*`, `config.json` modified và untracked `.mcp.json`, `docs/archive.md`.
  ```
- Dòng 7:
  ```text
  - **Kiểm tra 2026-11-04:** `npm run check` **198/198** local; `scan:secrets`/`scan:staged` pass; `scan:history` local fail 1 finding do `refs/agents/*` (F1, ngoài scope); fresh clone từ local HEAD pass 3 scan; remote/fresh clone `f22cf96` vẫn 188/190 do TASK-007.
  ```

**3.2. Tóm tắt remediation (dòng 17)**

```text
**Remediation TASK-001:** B1–B9 đã đóng qua `TASK-024`–`TASK-032`; `TASK-032` evidence recorded 2026-11-04 (review/QA pending). Task board 34 task; 10 task archive trong `docs/completed/` (`TASK-032` còn trong `docs/tasks/`, chờ Manager archive). Còn mở: `TASK-007`; `TASK-001` chờ re-review + QA.
```

**3.3. Bảng “Thay đổi so với kỳ review trước” (dòng 25)**

```text
| P0-01 — Debug artifact/endpoint | **Remediation complete — pending re-review + QA** | B1–B9 đóng; remote sạch `26a9d46`; còn TASK-001 re-review/QA + CI xanh (`TASK-007`). |
```

**3.4. P0-01**

- Dòng 36 status:
  ```text
  - **Trạng thái:** **Remediation complete — pending TASK-001 re-review + QA** — B1–B9 đã đóng
  ```
- Thêm bullet vào “Đã đạt”:
  ```text
  - **2026-11-03/04:** TASK-028 `26a9d46` (CI history gate); TASK-030 `4d16d41` (+ core `7f9291b`), Reviewer APPROVED + QA PASS; TASK-032 evidence 2026-11-04.
  ```
- Thay cụm “Bằng chứng còn blocker” bằng “Residual risk”:
  ```text
  - **Residual risk:**
    - `TASK-001` chưa re-review/QA; chưa đóng P0-01.
    - CI/fresh clone `npm run check` 188/190 do `TASK-007` (`AUTHORIZATION_REQUIRED`).
    - F1: local `refs/agents/*` chứa Bearer token → `scan:history` local fail; không có trong remote/fresh clone.
    - F2: `.mcp.json` untracked chứa key, chưa được ignore; cấm `git add -A`.
  ```
- “Điều kiện hoàn thành”: thêm “TASK-001 re-review + QA pass; CI xanh sau TASK-007”.
- “Task”: giữ `TASK-001`; remediation `TASK-024` → `TASK-032`.

**3.5. §1.1 map blocker**

- B5: `**READY**` → `**DONE** (`26a9d46`)`
- B7: `**READY**` → `**DONE** (`4d16d41`; core `7f9291b`)`
- B9: `**BLOCKED** (B5, B7)` → `**DONE** (TASK-032, evidence 2026-11-04)`
- Thay dòng 71:
  ```text
  **Thứ tự còn lại:** `TASK-001` re-review → QA → đóng `TASK-001`; `TASK-007` là external blocker duy nhất cho CI xanh.
  ```
- Dòng 73: thêm “TASK-032 không merge/release/live”.

**3.6. P0-07**

- Giữ status `Partial`.
- Thay evidence dòng 153–155 bằng:
  ```text
  - Ngày 2026-11-01: local `main` rewrite sang `a4b7a25`; phần lớn runtime đã vào lịch sử local.
  - Ngày 2026-11-02/04: TASK-001 patch đã commit/push (`261e9b7`, `f22cf96`); local `main` `3b048b9`, remote `26a9d46`.
  - `7f9291b` (local, chưa push) chứa runtime fixes `config.json`, `features/upgrade/loop.js`, `features/upgrade/runner.js` nhưng **chưa có Owner Decision**.
  - Working tree còn `.ai/*`, `config.json` modified; untracked `.mcp.json`, `docs/archive.md`.
  - Cortex index chưa reindex theo HEAD `3b048b9`.
  ```
- “Điều kiện hoàn thành”: thêm “TASK-007 được Owner Decision + review độc lập + push; CI xanh”.

**3.7. §4.1 và §4.2**

- §4.1:
  - B5 → `**DONE** (`26a9d46`)`
  - B7 → `**DONE** (`4d16d41`)`
  - B9 → `**DONE** (TASK-032, evidence 2026-11-04)`
  - Thêm dòng 10: `| 10 | TASK-001 re-review + QA | — | Chỉ đóng P0-01 sau verdict mới + QA PASS + CI xanh |`
- §4.2 thêm dòng 6:
  ```text
  | 6 | F1/F2 local secret hygiene | Đề xuất `TASK-035 (proposed)`: ignore `.mcp.json`; xóa stale `refs/agents/*`; xác minh không vào index/history. Không tạo file trong TASK-032. |
  ```

**3.8. §5 Điều kiện dừng live (dòng 361)**

Sửa điều kiện 1 cho đúng:

```text
1. `npm run scan:history` còn finding hoặc artifact còn trong git history — **remote + fresh clone đã pass**; **local fail 1 finding do `refs/agents/*` (F1)**, cần xử lý trước khi tuyên bố local sạch.
```

Giữ nguyên các điều kiện 2–7; điều kiện 6 vẫn đúng vì working tree còn thay đổi.

### 4. `docs/roadmap.md`

**4.1. Header (dòng 3)**

```text
- **Cập nhật:** 2026-11-04 (TASK-032 evidence — B1–B9 closed; TASK-001 REMEDIATION_COMPLETE, chờ re-review + QA; TASK-007 AUTHORIZATION_REQUIRED)
```

**4.2. Phase 0 (dòng 70, 73)**

- TASK-001:
  ```text
  - `TASK-001` — Security cleanup: ... **REMEDIATION_COMPLETE (B1–B9 closed 2026-11-04); chưa Done — chờ re-review + QA; CI xanh phụ thuộc TASK-007.**
  ```
- TASK-007: giữ `AUTHORIZATION_REQUIRED`, bổ sung “`7f9291b` chứa runtime fixes chưa được authorize/push; external blocker duy nhất cho CI xanh”.

**4.3. Phase 0.1 status (dòng 92)**

Thay bằng:

```text
**Trạng thái 2026-11-04:** B1–B9 đã đóng. `TASK-024`–`TASK-031`, `TASK-033`, `TASK-034` **DONE**; `TASK-028` `26a9d46`; `TASK-030` `4d16d41` (core `7f9291b`); `TASK-032` evidence recorded 2026-11-04 (review/QA pending). `TASK-001` **REMEDIATION_COMPLETE — pending re-review + QA**, chưa Done. `TASK-007` **AUTHORIZATION_REQUIRED** — runtime fixes chưa được authorize/push; CI/fresh clone 188/190. **STOP CONDITION: NO**.
```

**4.4. Bảng task Phase 0.1**

- Dòng 102 (TASK-028): `**READY.**` → `**DONE** (`26a9d46`).`
- Dòng 104 (TASK-030): `**READY.**` → `**DONE** (`4d16d41`; core `7f9291b`; review/QA 2026-11-04).`
- Dòng 106 (TASK-032): `**BLOCKED** (B5, B7).` → `**DONE (evidence 2026-11-04; review/QA pending).**`
- Thêm dòng 10:
  ```text
  | 10 | TASK-001 re-review + QA | — | **PENDING.** Reviewer verdict mới + QA PASS; chỉ đóng TASK-001 sau đó và sau khi CI xanh (`TASK-007`) |
  ```

**4.5. Exit criteria (dòng 113, 117)**

- Dòng 113:
  ```text
  - Remote sạch; fresh clone pass `scan:secrets`, `scan:history` (đạt tại `f22cf96`); local `npm run check` **198/198**; remote/fresh clone **188/190** — phụ thuộc `TASK-007`.
  ```
- Dòng 117:
  ```text
  - TASK-001 chỉ chuyển **Done** sau khi tất cả điều trên đóng **và** có Reviewer verdict mới + QA PASS + CI xanh (`TASK-007`). Hiện tại: **REMEDIATION_COMPLETE**, không Done.
  ```

**4.6. Dependency graph + critical path (dòng 239–241)**

- Note dưới graph:
  ```text
  > `TASK-024`, `TASK-025`, `TASK-026`, `TASK-027`, `TASK-028`, `TASK-030`, `TASK-031`, `TASK-033`, `TASK-034` đã DONE. `TASK-032` evidence recorded 2026-11-04 (review/QA pending). Remote/fresh clone xác minh tại `f22cf96`; local HEAD `3b048b9`.
  ```
- Critical path:
  ```text
  **Đường găng:** `TASK-007 → TASK-001 re-review → QA` (CI xanh + đóng TASK-001), sau đó `TASK-002 → TASK-005 → TASK-008 → TASK-012 → TASK-013`. `TASK-032` đã hoàn tất phần evidence.
  ```

**4.7. Timeline (dòng 248)**

```text
| Phase 0.1 | 2–3 ngày | TASK-024–032 | Remediation evidence hoàn tất 2026-11-04; còn TASK-001 re-review/QA và TASK-007 để CI xanh |
```

### 5. `docs/incident-2026-10-31.md`

**5.1. Status (dòng 3)**

```text
- **Status:** **Open — remediation complete; pending TASK-001 re-review + QA.** B1–B9 closed via `TASK-024`–`TASK-032` (2026-11-04). Residual CI/check issue tracked by `TASK-007`; local `scan:history` F1 (`refs/agents/*`) documented.
```

**5.2. Header evidence (dòng 10–11)**

- Thêm sau “New local HEAD after rewrite”:
  ```text
  - **Current local HEAD (2026-11-04):** `3b048b9` (4 commit chưa push)
  ```
- “Remote status”: `cleaned — force-push ... (2026-11-02)` → `cleaned — force-push ... (2026-11-02); remote HEAD hiện tại `26a9d46``.

**5.3. Timeline**

- Thay hai dòng “Open” (52–53) bằng:
  ```text
  | 2026-11-03 | TASK-028 DONE — CI `fetch-depth: 0` + blocking `scan:history` (`26a9d46`). |
  | 2026-11-04 | TASK-030 DONE — staged-index scan `4d16d41` (+ core `7f9291b`); Reviewer APPROVED + QA PASS (21/21). |
  | 2026-11-04 | TASK-032 evidence recorded — B1–B9 closed; TASK-001 chuyển REMEDIATION_COMPLETE (chưa Done). |
  | Open | TASK-001 re-review + QA; TASK-007 runtime fixes chưa authorize/push — CI/fresh clone 188/190. |
  ```

**5.4. Checklist**

- Giữ tick TASK-028/030.
- Tách dòng 74 thành hai dòng:
  ```text
  - [x] `TASK-032` — Record status/evidence and security sign-off for remediation (2026-11-04; review/QA pending).
  - [ ] Close P0-01/TASK-001 after Reviewer re-review + QA PASS and CI green (`TASK-007`).
  ```
- Thêm note ngay dưới checklist:
  ```text
  > Correction 2026-11-04: commit `412a8f0` đã tick `TASK-032` trước khi task chạy; mục này được tách lại để không overclaim việc đóng TASK-001.
  ```

**5.5. Verification (dòng 89–114)**

- Cập nhật block “Current status”:
  ```text
  **Current status (2026-11-04):**
  - `scan:secrets` — pass (local + fresh clone).
  - `scan:staged` — pass (local + fresh clone).
  - `scan:history` — pass 0 finding trên remote/fresh clone; **local fail 1 finding** do `refs/agents/*` (F1, ngoài scope).
  - `check` local — **198/198 pass**.
  - `check` remote/fresh clone `f22cf96` — **188/190**; 2 fail thuộc TASK-007.
  - `git log --all --oneline -- debug/trade-bulk.html` — no output.
  - `git rev-list --objects --all` — no artifact.
  - `git fsck --full` — no corruption; only dangling old blobs/tree from rewrite.
  - Remote clean: `origin/main` = `26a9d46`.
  - Fresh clone từ local HEAD `3b048b9` — scan pass; không còn artifact.
  ```
- Thay “Additional checks”:
  ```text
  - Fresh clone từ cleaned remote không còn debug artifact.
  - CI secret scan fail trên PR thêm secret pattern.
  - Full-history gate (`TASK-028`) và staged-blob scan (`TASK-030`) đã DONE; CI xanh còn phụ thuộc `TASK-007`.
  ```
- Giữ nguyên “TASK-024 rewrite evidence” (lịch sử).
- Thêm mục “Residual risk 2026-11-04”: F1, F2, TASK-007; nêu rõ incident chưa đóng.

### 6. `docs/reviews/TASK-001-review-2026-10-31.md`

**Chỉ append**, không sửa verdict gốc hoặc Addendum 2026-11-01. Thêm cuối file:

```markdown
## Addendum 2026-11-04 — remediation evidence (không đổi verdict)

- **Verdict gốc vẫn là REJECTED.** Addendum này chỉ ghi evidence remediation; Reviewer phải ra verdict mới thì TASK-001 mới có thể đóng.
- **B1–B9:** đã đóng theo bảng dưới; chi tiết ở [`TASK-001-security-cleanup.md`](../tasks/TASK-001-security-cleanup.md) §9.

| Blocker | Task | Evidence | Trạng thái |
|---|---|---|---|
| B1 | TASK-024 | rewrite `a4b7a25`; remote `26a9d46`; history scan 0 finding remote/fresh clone | DONE |
| B2 | TASK-025 | authorization-2026-11-02 + risk-acceptance-2026-11-02 | DONE (accepted risk) |
| B3 | TASK-026 | `42d3555...f22cf96`; fresh clone sạch | DONE |
| B4 | TASK-027 | `261e9b7`, 7 file | DONE |
| B5 | TASK-028 | `26a9d46`; `fetch-depth: 0` + blocking `scan:history` | DONE |
| B6 | TASK-029/033 | `f22cf96`; 13/13 → 21/21 | DONE |
| B7 | TASK-030 | `4d16d41` (+ core `7f9291b`); review/QA 2026-11-04 | DONE |
| B8 | TASK-031 | deletion verified history + fresh clone | DONE |
| B9 | TASK-032 | evidence 2026-11-04 + sign-off §9.4 | DONE (evidence; review/QA pending) |

- **Điều kiện re-review 1–9:** đã đạt. **Điều kiện 10 (CI xanh):** blocked by `TASK-007` — remote/fresh clone 188/190; local 198/198.
- **Residual:** F1 local `refs/agents/*`; F2 `.mcp.json` untracked; TASK-007 `AUTHORIZATION_REQUIRED`.
- **Kết luận:** TASK-001 ở `REMEDIATION_COMPLETE — pending re-review + QA`; **không** Done, không merge/release/live. Yêu cầu Reviewer review lại docs/evidence và ra verdict mới.
```

### 7. `docs/tasks/TASK-032-close-remediation.md` (chỉ 1–2 dòng)

- Status:
  ```text
  - **Status:** **REVIEW** — evidence/docs cập nhật 2026-11-04; chờ Reviewer/QA xác nhận. Không đánh dấu TASK-001 Done.
  ```
- Thêm cuối file:
  ```text
  ## 8. Kết quả thực thi — 2026-11-04
  - Plan: [`docs/reviews/TASK-032-executor-plan-2026-11-04.md`](../reviews/TASK-032-executor-plan-2026-11-04.md)
  - Evidence: TASK-001 §9; review addendum 2026-11-04; incident verification 2026-11-04.
  - Kết quả: B1–B9 closed; TASK-001 `REMEDIATION_COMPLETE — pending re-review + QA`.
  - Commit: `<điền hash sau commit>`.
  ```

### 8. Commit / staging

- Chỉ stage:
  ```text
  docs/tasks/TASK-001-security-cleanup.md
  docs/tasks/README.md
  docs/backlog.md
  docs/roadmap.md
  docs/incident-2026-10-31.md
  docs/reviews/TASK-001-review-2026-10-31.md
  docs/tasks/TASK-032-close-remediation.md
  docs/reviews/TASK-032-executor-plan-2026-11-04.md
  ```
- **Không** stage `.mcp.json`, `.ai/*`, `config.json`, `docs/archive.md`.
- Commit message đề xuất: `docs(security): record TASK-001 remediation evidence and close B9`.
- Không push.

### 9. Việc Manager làm sau (ngoài TASK-032)

1. Reviewer/QA TASK-032; nếu pass, flip TASK-032 `DONE` + archive.
2. Cập nhật `docs/queue.md` / `docs/company-state.md` (Manager-owned).
3. Tạo `TASK-035` chính thức cho F1/F2 nếu Owner/Manager đồng ý.
4. Mở re-review TASK-001; chỉ đóng sau QA + CI xanh.

---

## ROLLBACK PLAN

Docs-only, không ảnh hưởng runtime. Thứ tự rollback:

1. **Trước commit:** `git restore -- docs/tasks/TASK-001-security-cleanup.md docs/tasks/README.md docs/backlog.md docs/roadmap.md docs/incident-2026-10-31.md docs/reviews/TASK-001-review-2026-10-31.md docs/tasks/TASK-032-close-remediation.md` (giữ plan file nếu cần audit).
2. **Sau commit, chưa push:** `git reset --soft HEAD~1` để bỏ commit nhưng giữ working tree; hoặc `git revert <hash>` nếu commit đã được tham chiếu.
3. **Nếu docs sai trạng thái:** revert commit và khôi phục TASK-001 về `Blocked — REJECTED`, B9 về `BLOCKED`; thông báo Manager.
4. **Không** dùng rollback để xóa evidence lịch sử; chỉ sửa trạng thái sai.
5. Không đụng `.git`, không rewrite history, không force-push.

---

## VALIDATION PLAN

| # | Kiểm tra | Cách chạy | Kỳ vọng |
|---:|---|---|---|
| V1 | Test suite không regression | `npm run check` | 198/198 pass |
| V2 | Working tree scan | `npm run scan:secrets` | pass |
| V3 | Staged scan | `npm run scan:staged` | pass |
| V4 | History scan local | `npm run scan:history` | **1 finding F1** (đã biết); xác nhận không có finding mới |
| V5 | History scan fresh clone | clone local HEAD → `node scripts/check-secrets.js --history` | pass |
| V6 | Artifact history | `git log --all --oneline -- debug/trade-bulk.html`; `git ls-files 'debug/*.html' 'debug/*.png'` | rỗng |
| V7 | Hash khớp | `git rev-parse HEAD`; `git rev-parse origin/main` | `3b048b9`; `26a9d46` |
| V8 | Diff scope | `git diff --stat`; `git status --short` | chỉ 7 file docs + plan; không source/CI/package.json |
| V9 | Không stage nhầm | `git diff --cached --name-only` | đúng danh sách §8 |
| V10 | Link check | script PowerShell trích `](...)` và `Test-Path` | 0 broken link nội bộ |
| V11 | Consistency grep | `rg -n "TASK-032.*(BLOCKED|READY)|B5.*READY|B7.*READY|B9.*BLOCKED|190/190|8 completed|Closed \(security scope\)" docs` | 0 match ngoài ngữ cảnh lịch sử |
| V12 | Không overclaim | `rg -n "TASK-001.*(Done|DONE)" docs/tasks docs/backlog.md docs/roadmap.md docs/incident-2026-10-31.md` | chỉ match câu “không Done/chưa Done/điều kiện Done” |
| V13 | Số liệu nhất quán | `rg -n "198/198|188/190|3b048b9|26a9d46|4d16d41|f22cf96" docs` | khớp bảng canonical |

**Link check gợi ý (PowerShell):**

```powershell
$files = @(
  'docs/tasks/TASK-001-security-cleanup.md',
  'docs/tasks/README.md',
  'docs/backlog.md',
  'docs/roadmap.md',
  'docs/incident-2026-10-31.md',
  'docs/reviews/TASK-001-review-2026-10-31.md',
  'docs/reviews/TASK-032-executor-plan-2026-11-04.md'
)
foreach ($f in $files) {
  $dir = Split-Path $f
  Select-String -Path $f -Pattern '\]\(([^)#]+)' -AllMatches |
    ForEach-Object { $_.Matches } |
    ForEach-Object { $_.Groups[1].Value } |
    Where-Object { $_ -notmatch '^(https?:|mailto:|#)' } |
    ForEach-Object {
      $p = Join-Path $dir $_
      if (-not (Test-Path $p)) { "BROKEN: $f -> $_" }
    }
}
```

---

## TEST PLAN (docs-only — không có unit test mới)

Coder **không** viết test source. “Test” là các assertion nội dung sau; mỗi case phải pass trước khi commit:

| ID | Test case | Kỳ vọng |
|---|---|---|
| TC-01 | TASK-001 status | `REMEDIATION_COMPLETE — pending re-review + QA`; không `Done` |
| TC-02 | TASK-001 §7.2 | B5/B7/B9 đều `DONE` kèm đúng commit |
| TC-03 | TASK-001 §7.3 | 1–9 đạt; 10 blocked by TASK-007; nêu rõ re-review chưa chạy |
| TC-04 | TASK-001 §9.4 | Sign-off có phạm vi, người ký, căn cứ, “không cần Owner Decision mới” |
| TC-05 | README §2.1 | B5/B7/B9 DONE; thứ tự còn lại là re-review/QA; TASK-007 external blocker |
| TC-06 | README §4 | Không còn “CURRENT TASK: TASK-028”; TASK-032 REVIEW; TASK-001 không Done |
| TC-07 | Backlog P0-01 | Status remediation complete; residual F1/F2/TASK-007; không “Closed” |
| TC-08 | Backlog §5 | Điều kiện 1 phản ánh local F1, không tuyên bố local pass |
| TC-09 | Roadmap Phase 0.1 | TASK-028/030/032 DONE; TASK-001 không Done; critical path có re-review/QA |
| TC-10 | Incident | Status Open; checklist TASK-032 tách khỏi “Close P0-01”; verification 198/198 + F1 |
| TC-11 | Review record | Verdict gốc vẫn REJECTED; chỉ có addendum mới; không sửa lịch sử |
| TC-12 | Hash/số liệu | Mọi hash/số khớp bảng canonical; không có `190/190`, `8 completed` |
| TC-13 | Diff scope | Chỉ docs; không source/test/CI/package.json; không queue/company-state |
| TC-14 | Link | 0 broken link nội bộ trong 7 file |
| TC-15 | Staging | Không có `.mcp.json`, `.ai/*`, `config.json`, `docs/archive.md` trong index |

---

## RISKS

| # | Risk | Mức | Giảm thiểu |
|---:|---|---|---|
| R1 | Overclaim TASK-001 `Done` khi chưa re-review/QA | High | Dùng đúng status `REMEDIATION_COMPLETE`; TC-01/TC-12 |
| R2 | Số liệu/hash lệch giữa 6 file | Medium | Bảng canonical duy nhất; V7/V13 |
| R3 | Vô tình commit `.mcp.json` chứa key (F2) | High | Cấm `git add -A`; stage đúng §8; V9/TC-15 |
| R4 | Cuốn `.ai/*` deletion hoặc `config.json` vào commit | Medium | Stage explicit; V8/V9 |
| R5 | Local `scan:history` fail bị hiểu là regression | Medium | Ghi rõ F1; V4/TC-10 |
| R6 | Docs hợp thức hóa `7f9291b` (runtime fixes chưa authorize) | High | Giữ TASK-007 `AUTHORIZATION_REQUIRED`; không push; R6 note ở mọi file |
| R7 | Security sign-off không có người ký | Medium | Fallback `EVIDENCE_COMPLETE — pending sign-off`; B9 không đóng |
| R8 | Reviewer reject vì TASK-001 chưa Done | Medium | Addendum giải thích rõ đây là chủ ý, không phải thiếu sót |
| R9 | Link rot nếu TASK-032 bị move | Low | Không move trong task này; Manager archive sau |
| R10 | F1/F2 bị bỏ quên sau khi đóng remediation | Medium | Ghi residual + đề xuất TASK-035; Manager tạo task chính thức |

---

## KẾT LUẬN NGẮN

- TASK-032 **đóng B9** bằng evidence + docs nhất quán; **không** đóng TASK-001.
- TASK-001 = `REMEDIATION_COMPLETE — pending re-review + QA`; `P0-01` và incident tương ứng **chưa Closed**.
- Security sign-off = Manager attestation + Security Owner (theo authorization-2026-11-02); **không cần Owner Decision mới**.
- F1/F2 = residual risk + đề xuất `TASK-035 (proposed)`; không tạo task file trong TASK-032.
- TASK-007 = `AUTHORIZATION_REQUIRED`, external blocker duy nhất cho CI xanh; không push/không hợp thức hóa `7f9291b`.
