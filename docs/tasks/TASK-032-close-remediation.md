# TASK-032 — Close TASK-001 remediation and record evidence

## Thông tin

- **Priority:** P2
- **Risk:** Low
- **Effort:** S
- **Dependency:** TASK-024 → TASK-031
- **Blocks:** —
- **Status:** **BLOCKED** — còn TASK-028 và TASK-030
- **Owner đề xuất:** Engineering Manager + Security

## 1. Mục tiêu

Cập nhật trạng thái TASK-001, incident note, backlog, roadmap và task board sau khi tất cả blocker được đóng; lưu evidence để audit.

## 2. Bằng chứng

- TASK-001 đang REJECTED.
- Incident checklist còn mục chưa tick.
- Backlog/roadmap/task board chưa phản ánh remediation.
- Reviewer yêu cầu cập nhật trạng thái.

## 3. Phạm vi

- `docs/tasks/TASK-001-security-cleanup.md`
- `docs/tasks/README.md`
- `docs/backlog.md`
- `docs/roadmap.md`
- `docs/incident-2026-10-31.md`
- `docs/reviews/TASK-001-review-2026-10-31.md`

## 4. Kế hoạch thực hiện

1. Xác nhận TASK-024 → TASK-031 pass.
2. Chạy lại `scan:secrets`, `scan:history`, `npm run check`.
3. Cập nhật checklist incident.
4. Ghi commit hash, thời gian, người thực hiện, evidence rotation.
5. Đổi TASK-001 status sang Done chỉ khi tất cả blocker đóng.
6. Cập nhật backlog P0-01 và roadmap Phase 0.1.
7. Đóng remediation, tạo task follow-up nếu còn risk.

## 5. Test plan

| Kiểm tra | Kỳ vọng |
|---|---|
| `npm run scan:secrets` | Pass |
| `npm run scan:history` | 0 finding |
| `npm run check` | 174+ test pass |
| Fresh clone | Sạch |
| Docs links | Không broken |
| Checklist incident | 100% |

## 6. Rollback

- Nếu evidence thiếu: giữ TASK-001 ở trạng thái Blocked, không đóng.
- Revert docs nếu cập nhật sai.

## 7. Definition of Done

- Tất cả blocker đóng.
- TASK-001 Done.
- Backlog/roadmap/task board/incident nhất quán.
- Security sign-off.
