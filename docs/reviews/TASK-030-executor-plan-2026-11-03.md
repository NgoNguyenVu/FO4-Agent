# Executor Plan — TASK-030 — 2026-11-03

- **Task:** TASK-030 — Scan staged blobs/index for secrets (P1, Risk Medium, Effort S–M)
- **Role:** Company Executor (Delivery Manager)
- **Ngày lập plan:** 2026-11-03
- **retry_count:** 0 (lần chạy đầu)
- **Task status khi nhận:** `IN_PROGRESS` — implementation đã có trong working tree + một phần đã nằm trong commit local
- **Phạm vi plan:** chỉ `docs/reviews/` (file này). Không sửa source, test, CI, package.json, docs trạng thái.
- **Kết luận nhanh:** Implementation **đã đúng hướng và gần đủ DoD**. Còn **2 việc bắt buộc** (document mode + 2 boundary test) và **3 việc khuyến nghị**. Ngoài ra phát hiện **1 finding bảo mật ngoài phạm vi TASK-030** cần Manager quyết định (mục RISKS, R1).

---

## 1. CURRENT TASK

`TASK-030` — Scan staged blobs/index for secrets.
- File task: `docs/tasks/TASK-030-scan-staged-blobs.md`
- Blocks: `TASK-032` (Close remediation). Không mở TASK-032 cho tới khi TASK-030 `DONE`.
- Vị trí luồng: `TASK-030` → `TASK-032` → TASK-001 re-review + QA.

## 2. TASK STATUS

| Hạng mục | Trạng thái |
|---|---|
| Task state | `IN_PROGRESS` (theo `docs/queue.md` §1 và header task file) |
| retry_count | `0` |
| Code `--staged` | **ĐÃ CÓ** trong `scripts/check-secrets.js` (đã nằm trong commit local `7f9291b`) |
| Entry point `npm run scan:staged` | **ĐÃ CÓ** (working tree, `package.json` modified) |
| CI step | **ĐÃ CÓ** (working tree, `.github/workflows/security.yml`) |
| Test staged mode | **ĐÃ CÓ 6 case** (5 cũ + 1 remediation mới trong working tree) |
| Tài liệu mode | **THIẾU** — README không có mục nào mô tả `scan:secrets` / `scan:history` / `scan:staged` |
| Test boundary còn thiếu | **THIẾU 2 case** (staged mode bỏ qua secret chỉ có ở working tree; staged artifact bị flag) |
| Review/QA record | **CHƯA CÓ** — `docs/reviews/` chỉ có TASK-001, TASK-027 (review + QA), không có record TASK-030 |
| Blocker nội bộ | Không |
| Blocker ngoài phạm vi | **Có 1** (R1 — secret trong local ref + `.mcp.json`), không chặn code TASK-030 nhưng chặn tuyên bố "local scan:history xanh" |

**Đánh giá:** code đã đạt phần lõi của DoD (§7 task file: "Scanner đọc được staged blob", "Có test cho staged secret"). Thiếu phần "Cập nhật README/CI mô tả mode" (§4 bước 5) và một số test biên để Reviewer/QA không phải suy luận.

## 3. DEPENDENCY & BLOCKER CHECK

### 3.1. Dependency

| Dependency | Trạng thái | Bằng chứng |
|---|---|---|
| TASK-029 — Secret scanner tests | **DONE** | `docs/queue.md` §4; hoàn thiện qua TASK-033 |
| TASK-033 — Complete scanner coverage | **DONE** | commit `f22cf96`; 13/13 test tại thời điểm đó |
| TASK-027 — Isolate patch (scanner gốc) | **DONE** | commit `261e9b7` |
| TASK-028 — CI history scan | **DONE** | commit `26a9d46`, `fetch-depth: 0` + `scan:history` blocking |
| TASK-031 — Deletion verification | **DONE** | không liên quan trực tiếp, không chặn |

Không có dependency nào ở trạng thái `READY`/`IN_PROGRESS`/`BLOCKED` ảnh hưởng TASK-030.

### 3.2. Prerequisite kỹ thuật

| Prerequisite | Kết quả |
|---|---|
| `git` khả dụng trong CI runner | Có (`ubuntu-latest`, `actions/checkout@v4`) |
| `git ls-files -z` trả index | Có — 109 file tracked tại HEAD |
| `git show :path` hoạt động với repo không có commit | Có — test "remediation scenario" chạy trên repo chưa có commit nào |
| Node 20 (CI) hỗ trợ API dùng trong scanner | Có (`node:child_process`, `node:fs`, `Buffer.includes`) |
| Không có pre-commit hook infra (husky/lefthook) | Đúng — task chỉ yêu cầu "CI/pre-commit nếu có" ⇒ **không thêm hook trong task này** |

### 3.3. Blocker

| ID | Loại | Nội dung | Xử lý |
|---|---|---|---|
| — | — | Không có blocker chặn implement TASK-030 | Tiếp tục |
| F1 | Finding ngoài scope (HIGH, security) | Local ref `refs/agents/605c6f75-.../checkpoints/turn/0` (commit `4360293`, **không** thuộc `main`/`origin/main`) chứa `opencode.json` với Bearer key `sk_ctx_****` (Cortex API key). Hệ quả: `node scripts/check-secrets.js --history` **fail 1 finding** trên máy local, trong khi fresh clone **pass**. | **Không sửa trong TASK-030.** Báo Manager quyết định (xóa local checkpoint ref? rotate key? thêm `.mcp.json` vào `.gitignore`?). |
| F2 | Finding ngoài scope (MED) | `.mcp.json` (untracked) chứa Bearer `sk_ctx_****` khác, **không** nằm trong `.gitignore` ⇒ `git add -A` sẽ commit key vào repo. | Đề xuất task riêng (`.gitignore` + hướng dẫn local config). Không sửa trong TASK-030. |

**Gate đánh giá:** TASK-030 là **Standard Task** — không force-push, không rewrite history, không rotate credential, không đổi cơ chế auth, không breaking change ⇒ **không cần Owner Decision** cho bản thân TASK-030. (Nếu Manager quyết định xử lý F1 bằng cách xóa ref chứa credential thì đó là quyết định **credential decision** ⇒ cần Owner Decision riêng.)

## 4. BẰNG CHỨNG HIỆN TRẠNG (đã kiểm tra thực tế)

### 4.1. Diff working tree (chưa commit)

| File | Thay đổi |
|---|---|
| `package.json` | +`"scan:staged": "node scripts/check-secrets.js --staged"` (sau `scan:history`) |
| `.github/workflows/security.yml` | +step `Scan staged index for secrets` → `npm run scan:staged`, đặt **giữa** `scan:secrets` và `scan:history` |
| `scripts/check-secrets.test.js` | +1 test "staged secret then deleted working tree (remediation scenario)" (AWS key, repo chưa có commit) |

### 4.2. Code `--staged` (đã ở HEAD, không nằm trong diff working tree)

`scripts/check-secrets.js`:
- `const STAGED = process.argv.includes("--staged")` (dòng 11).
- `scanStaged()` (dòng 97–121): lặp `listTrackedFiles()` = `git ls-files -z`; bỏ qua `SELF`; flag `ARTIFACT_RE` trước khi đọc; đọc nội dung bằng `git show :<path>` với `maxBuffer 64MB`; `catch { continue }` cho file không còn trong index; bỏ qua binary bằng `buffer.includes(0)`; `scanText()` chung bộ 8 rule.
- Dispatch (dòng 123–127): `--history` **ưu tiên trước** `--staged`; message pass in `(staged index)`.

**Lưu ý traceability:** code `--staged` + 5 test staged nằm trong commit local `7f9291b` ("Add multiple documentation files...") — commit này **chưa push** và có message không phản ánh nội dung code. Reviewer cần review range `26a9d46..HEAD` cho `scripts/check-secrets.js`, không chỉ `git diff`.

### 4.3. Hành vi thực tế (probe, không sửa repo)

| # | Kịch bản | Kết quả thực tế | Kỳ vọng DoD | Đạt |
|---|---|---|---|---|
| P1 | Secret staged, xóa khỏi working tree | `--staged` fail `internal FO4 endpoint`; default mode pass | Fail | ✅ |
| P2 | Secret staged rồi overwrite bằng nội dung sạch | `--staged` fail `AWS access key` | Fail | ✅ |
| P3 | File staged sạch | `--staged` pass `(staged index)` | Pass | ✅ |
| P4 | File staged là binary (NUL) | `--staged` pass (skip) | Skip | ✅ |
| P5 | `git rm` file khỏi index | `--staged` pass (skip) | Bỏ qua | ✅ |
| P6 | Secret **chỉ** ở working tree, index sạch | `--staged` **pass**, default mode fail | Pass (đúng ngữ nghĩa) | ✅ nhưng **chưa có test** |
| P7 | Staged `debug/x.png` | `--staged` fail `tracked debug artifact` | Fail | ✅ nhưng **chưa có test** |
| P8 | `git add -N` (intent-to-add) file chứa AWS key | `--staged` **pass** (false negative — index entry rỗng) | Không quy định | ⚠️ giới hạn đã biết |
| P9 | `--staged --history` cùng lúc | Chạy history mode, bỏ qua staged | Không quy định | ⚠️ chưa document |
| P10 | Repo thật (109 file) `node scripts/check-secrets.js --staged` | pass `(staged index)` | Pass | ✅ |

### 4.4. Test suite hiện tại

- `node --test scripts/check-secrets.test.js` → **19/19 pass** (≈19s).
- `npm run check` (local, working tree có cả fix TASK-007) → **196/196 pass**.
- `node scripts/check-secrets.js --staged` trên repo → pass.
- `node scripts/check-secrets.js --history` trên repo → **FAIL 1 finding** (do F1, xem §3.3).
- `git clone` repo ra temp + `--history`/`--staged` → **pass** (chứng minh F1 chỉ do local ref).

## 5. IMPLEMENTATION PLAN

> Nguyên tắc: **không mở rộng scope**. Không đụng `docs/company-state.md`, `docs/queue.md`, `docs/tasks/TASK-032*`, `config.json`, `features/upgrade/*`, `.mcp.json`, không xóa `refs/agents/*`, không commit/push.

### Bước 0 — Xác nhận baseline (Coder, không sửa gì)

Chạy và ghi lại output vào PR/notes để Reviewer đối chiếu:
```text
node --test scripts/check-secrets.test.js     # 19/19
node scripts/check-secrets.js --staged        # pass (staged index)
node scripts/check-secrets.js                 # pass (working tree)
```

### Bước 1 — [BẮT BUỘC] Tài liệu hóa 3 mode trong `README.md`

- File: `README.md`.
- Vị trí: thêm section mới `## Secret scanning` **sau** block `## Run` (kết thúc trước `## Vùng /startagent`, khoảng dòng 296).
- Nội dung tối thiểu:
  1. Bảng 3 mode: `npm run scan:secrets` (working tree, mặc định), `npm run scan:history` (`git log -p --all`), `npm run scan:staged` (`git show :<path>` trên index).
  2. Exit code: `0` = pass, `1` = có finding; output liệt kê `path: rule`.
  3. Phạm vi: chỉ file **tracked/index**; file untracked **không** được quét (kể cả `.env` mới tạo) — nêu rõ để tránh hiểu nhầm.
  4. Bỏ qua có chủ đích: file binary (có NUL byte), file đã xóa khỏi index, `scripts/check-secrets.js` (SELF), và `debug/*.png|html` bị flag riêng là "tracked debug artifact".
  5. Giới hạn đã biết: (a) `git add -N` (intent-to-add) không bị quét; (b) khi truyền cả `--staged` và `--history`, history mode thắng; (c) nếu `git show :path` lỗi (ví dụ file > 64MB), file bị **bỏ qua im lặng**.
  6. Khuyến nghị workflow: trước khi commit chạy `npm run scan:staged`; trước khi push chạy `npm run scan:history`.
- Không thêm secret/endpoint thật vào README (dùng ví dụ giả `AKIA` + chuỗi giả hoặc mô tả bằng lời).

### Bước 2 — [BẮT BUỘC] Bổ sung 2 boundary test

File: `scripts/check-secrets.test.js` (dùng lại helper `createTempRepo`, `writeFile`, `git`, `commitAll`, `runScanner`, `expectClean`, `expectFinding` — **không** thêm helper mới nếu không cần).

**T7 — staged mode bỏ qua secret chỉ có ở working tree (không staged):**
- Setup: commit file sạch `src/app.js` (`console.log('clean');`) → sửa working tree thành `const k = "AKIA"+"ABCDEFGHIJKLMNOP"` → **không** `git add`.
- Assert: `expectClean(runScanner(dir, ["--staged"]))` + stdout chứa `(staged index)`; và `expectFinding(runScanner(dir, []), "AWS access key")` để khẳng định default mode vẫn bắt.
- Mục đích: khóa ngữ nghĩa "staged mode chỉ đọc index" — đây là lý do CI phải chạy **cả** `scan:secrets` và `scan:staged`.

**T8 — staged mode flag debug artifact đã stage:**
- Setup: `git add debug/screenshot.png` (nội dung bất kỳ), **không** commit.
- Assert: `expectFinding(runScanner(dir, ["--staged"]), "tracked debug artifact")`.
- Mục đích: khóa parity của rule artifact giữa 2 mode (nhánh `ARTIFACT_RE` trong `scanStaged` hiện chưa có test nào chạm tới).

### Bước 3 — [BẮT BUỘC, 1 dòng] Làm rõ ý nghĩa CI step

File: `.github/workflows/security.yml`.
- Thêm comment ngay trên step mới, ví dụ:
  `# Smoke test for --staged mode; on a clean checkout index == HEAD, so this duplicates scan:secrets by design.`
- Giữ nguyên thứ tự: `scan:secrets` → `scan:staged` → `scan:history`.
- Không đổi `fetch-depth`, không đổi `npm ci`, không thêm step khác.

### Bước 4 — [KHUYẾN NGHỊ, không blocking] Thu hẹp `catch` trong `scanStaged()`

- Vấn đề: `try { git show :path } catch { continue }` bỏ qua **mọi** lỗi (file > 64MB, gitlink/submodule, lỗi quyền) ⇒ có thể bỏ sót nội dung sẽ commit mà không ai biết.
- Đề xuất tối thiểu, không refactor rộng:
  - Lấy mode từ index: `git ls-files -s -z`; nếu mode `160000` (submodule) → skip tường minh.
  - Nếu `git show :path` lỗi với file **có** index entry và không phải gitlink → in `Secret scan error: <path>` và `process.exitCode = 2` thay vì skip.
- Nếu Coder chọn làm: bắt buộc thêm test **T11** (mô phỏng lỗi đọc index bằng cách mock `execFileSync`? **Không** khuyến khích mock — nếu không test được sạch thì **bỏ bước 4**, chỉ document ở Bước 1 mục 5c). Quyết định cuối: Reviewer + Coder; mặc định **không làm** để giữ diff nhỏ.

### Bước 5 — Không thay đổi

- Không sửa `RULES`, `ARTIFACT_RE`, `scanWorkingTree()`, `scanHistory()`.
- Không đổi hành vi `--history` ưu tiên hơn `--staged` (chỉ document ở Bước 1).
- Không thêm pre-commit hook, không thêm dependency, không đổi `check` script.

### Bước 6 — Chuẩn bị evidence cho Reviewer/QA (không commit)

Ghi vào mô tả bàn giao (không phải file trạng thái):
- Danh sách file thay đổi thuộc TASK-030: `package.json`, `.github/workflows/security.yml`, `scripts/check-secrets.test.js`, `README.md` (+ `scripts/check-secrets.js` nằm trong `7f9291b`).
- Output các lệnh ở §6.
- Danh sách file **không** thuộc TASK-030 đang dirty: `docs/company-state.md`, `docs/queue.md`, `docs/tasks/TASK-030*`, `docs/tasks/TASK-032*`, `config.json`, `features/upgrade/loop.js`, `features/upgrade/runner.js`, `.mcp.json` ⇒ **không** đưa vào commit của TASK-030.

## 6. ROLLBACK PLAN

| Mức | Khi nào | Cách làm | Ảnh hưởng |
|---|---|---|---|
| R0 — Tắt gate, giữ code | CI `scan:staged` fail do môi trường, cần mở CI gấp | Xóa step `Scan staged index for secrets` khỏi `.github/workflows/security.yml` (1 hunk), giữ `npm run scan:staged` cho local | Không mất code; local vẫn dùng được |
| R1 — Hoàn nguyên working tree | Patch TASK-030 gây regression | `git restore -- package.json .github/workflows/security.yml scripts/check-secrets.test.js README.md` | Về đúng HEAD; mất test mới + doc |
| R2 — Vô hiệu hóa mode staged | `--staged` cho kết quả sai trên repo thật | Giữ code nhưng bỏ `"scan:staged"` khỏi `package.json` + bỏ step CI; hoặc `git checkout 26a9d46 -- scripts/check-secrets.js` (chỉ working tree, **không** rewrite history) rồi xóa 5 test staged + T7/T8 | Trở về hành vi trước TASK-030; B7 vẫn mở |
| R3 — Khôi phục commit local | Cần bỏ `7f9291b`/`412a8f0` | **Không tự làm.** Cần Manager + Owner Decision (rewrite history local, unpushed) | Ngoài quyền Executor/Coder |

Nguyên tắc rollback:
- Không `git reset --hard`, không `git clean`, không `push --force` trong phạm vi task này.
- Backup trước khi rollback: `git diff > docs/reviews/` **không** được ghi vào repo; dùng patch tạm ngoài repo (`%TEMP%`).
- Mọi rollback phải giữ nguyên các thay đổi TASK-007 đang dirty (không `git restore .`).

## 7. VALIDATION PLAN

Chạy tại repo root, thứ tự cố định, ghi lại output:

| # | Lệnh | Kỳ vọng | Ghi chú |
|---|---|---|---|
| V1 | `node --test scripts/check-secrets.test.js` | **21/21 pass** (19 + T7 + T8) | Nếu làm Bước 4 thì +T11 |
| V2 | `node scripts/check-secrets.js --staged` | `pass (staged index)`, exit 0 | Trên repo sạch index |
| V3 | `node scripts/check-secrets.js` | `pass (working tree)`, exit 0 | |
| V4 | `npm run check` | **198/198 pass** (196 + 2 test mới) | Local có fix TASK-007; **không** dùng số này để tuyên bố CI xanh |
| V5 | `git clone <repo> $env:TEMP\fo4-t030-<rand>` → trong clone: `node scripts/check-secrets.js --history` | `pass (history)`, exit 0 | **Bắt buộc** thay cho scan local, vì local fail do F1 |
| V6 | Trong clone: `node scripts/check-secrets.js --staged` | `pass (staged index)` | Chứng minh mode chạy được trên checkout sạch (điều kiện tương đương CI) |
| V7 | `git status --short` | Chỉ các file thuộc TASK-030 (theo §5 Bước 6) + file dirty ngoài scope đã biết | Không có file lạ mới |
| V8 | Kiểm tra YAML: `node -e "require('fs').readFileSync('.github/workflows/security.yml','utf8')"` hoặc xem diff | Step mới nằm giữa `scan:secrets` và `scan:history`, indent 6 spaces khớp step khác | Tránh lỗi YAML |
| V9 | `git diff --stat -- package.json .github/workflows/security.yml scripts/check-secrets.test.js README.md` | ≤ ~4 file, mỗi file thay đổi nhỏ (README là file lớn nhất) | Bằng chứng diff cô lập |

**Không** dùng `npm run scan:history` trên máy local làm điều kiện pass/fail của TASK-030 cho tới khi F1 được xử lý. Nếu QA bắt buộc chạy, ghi rõ finding đó là F1 (ref `refs/agents/*`), không phải regression của TASK-030.

## 8. TEST PLAN (danh sách test Coder phải implement)

Quy ước: file `scripts/check-secrets.test.js`, dùng `spawnSync` qua `runScanner`, temp repo cô lập, dọn bằng `t.after`.

| ID | Tên test | Setup | Kỳ vọng | Trạng thái |
|---|---|---|---|---|
| T1 | staged secret deleted from working tree | stage file chứa endpoint ngrok giả, xóa file khỏi đĩa | `--staged` fail `internal FO4 endpoint`; default mode pass | ✅ có sẵn |
| T2 | staged AWS key overwritten in working tree | commit bản sạch → stage bản có `AKIA...` → ghi đè bản sạch | `--staged` fail `AWS access key` | ✅ có sẵn |
| T3 | clean staged file | stage file sạch | pass + stdout `(staged index)` | ✅ có sẵn |
| T4 | staged binary (NUL) | stage file chứa `0x00` | pass (skip) | ✅ có sẵn |
| T5 | file deleted from index | commit rồi `git rm` | pass | ✅ có sẵn |
| T6 | remediation scenario (staged secret, no HEAD, working tree deleted) | stage `src/config.json` chứa `AKIA...`, xóa file, **chưa từng commit** | `--staged` fail `AWS access key` | ✅ **mới thêm trong working tree** (giữ lại) |
| **T7** | **staged mode ignores working-tree-only secret** | commit file sạch → sửa working tree thành có `AKIA...` → không `git add` | `--staged` **pass** `(staged index)`; default mode **fail** `AWS access key` | ❌ **phải thêm** |
| **T8** | **staged mode flags a staged debug artifact** | `git add debug/screenshot.png`, không commit | `--staged` fail `tracked debug artifact` | ❌ **phải thêm** |
| T9 | (khuyến nghị) `--staged --history` precedence | repo có secret trong history + index sạch | hiện tại: fail ở `git history` (history thắng) — test để khóa hành vi đã document | ⚪ tùy chọn |
| T10 | (khuyến nghị) `git rm --cached` giữ file trên đĩa | file chứa secret, `git rm --cached` (file vẫn còn) | `--staged` pass (không có gì để commit) | ⚪ tùy chọn |
| T11 | (chỉ nếu làm Bước 4) lỗi đọc index không bị nuốt | mô phỏng lỗi `git show` | exit code 2 + message `Secret scan error` | ⚪ tùy chọn |

Yêu cầu chất lượng test:
- **Không** hard-code secret thật; dùng ghép chuỗi như test hiện có (`"AKIA" + "..."`) để file test không tự kích hoạt scanner.
- Mỗi test mới phải **fail nếu revert logic tương ứng** (kiểm tra nhanh: T7 fail nếu `scanStaged` đọc working tree; T8 fail nếu bỏ nhánh `ARTIFACT_RE`).
- Không tăng thời gian chạy quá ~3s/test (mỗi test tạo temp repo + gọi git).

## 9. RISKS

| ID | Mức | Rủi ro | Ảnh hưởng | Đề xuất |
|---|---|---|---|---|
| R1 | **HIGH (ngoài scope)** | Bearer key `sk_ctx_****` tồn tại trong local ref `refs/agents/605c6f75-.../checkpoints/turn/0` (commit `4360293`, không thuộc `main`/`origin/main`) và trong `.mcp.json` (untracked, **không** bị ignore) | `scan:history` local fail; `git add -A`/`push --mirror` có thể làm lộ key | Manager quyết định: xóa local checkpoint ref (cần Owner Decision vì là credential/history), thêm `.mcp.json` vào `.gitignore`, cân nhắc rotate key. **Không** làm trong TASK-030 |
| R2 | MED | Code `--staged` + 5 test staged nằm trong commit `7f9291b` mang message "docs...", chưa push | Reviewer diff working tree sẽ **không thấy** phần lõi; khó trace commit→task | Reviewer review `26a9d46..HEAD`; Manager quyết định cách gộp khi commit TASK-030 |
| R3 | MED | `catch { continue }` trong `scanStaged()` nuốt mọi lỗi đọc index | Secret trong file rất lớn (>64MB) hoặc lỗi quyền bị bỏ qua im lặng | Bước 4 (khuyến nghị) hoặc document giới hạn (Bước 1 mục 5c) |
| R4 | LOW | `git add -N` (intent-to-add) cho false negative | Secret trong file i-t-a không bị chặn | Document; không fix trong task S–M |
| R5 | LOW | CI `scan:staged` trên checkout sạch trùng nội dung `scan:secrets` | Tăng ~1s CI, giá trị chủ yếu là smoke test | Comment giải thích (Bước 3) |
| R6 | LOW | `scanStaged()` spawn 1 git process/file (109 file) | ~0.8–1.2s local, chấp nhận được; repo lớn sẽ tuyến tính | Không tối ưu trong task này; ghi chú nếu repo > ~5k file |
| R7 | LOW | `npm run check` local 196/196 phụ thuộc fix TASK-007 **chưa commit** | Số liệu local ≠ CI/fresh clone | Khi báo cáo phải nêu rõ; V5/V6 dùng clone |
| R8 | LOW | Thêm `scan:staged` vào CI có thể fail nếu runner thiếu index entry (sparse checkout) | Không áp dụng: workflow hiện không sparse checkout | Không cần xử lý |

## 10. CHECKLIST CHO CODER (Definition of Done mapping)

| DoD (task §7) | Điều kiện đóng | Trạng thái hiện tại |
|---|---|---|
| Scanner đọc được staged blob | `scanStaged()` dùng `git show :path`, skip binary/deleted | ✅ (trong `7f9291b`) |
| Có test cho staged secret | T1, T2, T6 (+T7, T8 sau khi bổ sung) | 🟡 thiếu T7, T8 |
| CI/local scan không regression | `scan:secrets` + `scan:staged` + `scan:history` pass trên clone; `npm run check` xanh local | 🟡 CI step đã có; cần V1–V6 |
| (task §4 bước 5) "Cập nhật README/CI mô tả mode" | README có `## Secret scanning` | ❌ thiếu |

**Coder chỉ cần làm:** Bước 1 (README), Bước 2 (T7, T8), Bước 3 (comment CI). Bước 4 là tùy chọn có kiểm soát. Không sửa gì khác.

## 11. GHI CHÚ CHO REVIEWER / QA

- Review theo range `26a9d46..HEAD` cho `scripts/check-secrets.js` + `git diff` cho 4 file working tree.
- Kiểm tra 3 điểm dễ sai: (a) `git show :path` **không** fallback sang `fs.readFileSync`; (b) skip binary dùng buffer NUL, không dựa vào extension; (c) file xóa khỏi index không bị flag.
- QA chạy V1–V6; **không** đánh fail TASK-030 vì `scan:history` local đỏ (F1) — dùng clone.
- QA xác nhận `git status` không có file ngoài scope bị thêm vào patch.

## 12. Phụ lục — output đã ghi nhận (2026-11-03)

```text
node --test scripts/check-secrets.test.js
  tests 19 | pass 19 | fail 0

npm run check
  tests 196 | pass 196 | fail 0

node scripts/check-secrets.js --staged
  Secret scan passed (staged index).

node scripts/check-secrets.js
  Secret scan passed (working tree).

node scripts/check-secrets.js --history          # local
  Secret scan failed: 1 finding(s)
  - git history: Bearer token                     # ← F1, refs/agents/...:opencode.json

# fresh clone
git clone <repo> <temp> && node scripts/check-secrets.js --history
  Secret scan passed (history).
node scripts/check-secrets.js --staged
  Secret scan passed (staged index).
```

Probe phụ (temp repo): staged thường pass / default fail khi secret chỉ ở working tree; staged artifact fail đúng; `git add -N` cho false negative.
