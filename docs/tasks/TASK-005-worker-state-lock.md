# TASK-005 — Worker state machine, lock và lease

## Thông tin

- **Priority:** P0
- **Risk:** High
- **Effort:** L
- **Dependency:** TASK-002, TASK-007
- **Related:** TASK-017
- **Status:** Todo
- **Owner đề xuất:** Platform / Concurrency

## 1. Mục tiêu

Thay việc suy luận worker từ chat text bằng state machine + lock/lease bền vững, để hai instance hoặc restart giữa chu kỳ không tạo worker thứ hai và không mua trùng.

Phạm vi:

- `features/controller.js`
- `features/buy/cycle.js`
- `features/upgrade/runner.js`
- `features/icon-session.js`
- `lib/ui-lock.js` (tích hợp, không thay thế TASK-017)
- Module mới `lib/worker-registry.js`

Không thuộc phạm vi:

- Hard cap chi tiêu (TASK-003).
- Refactor controller thành module nhỏ (TASK-008).
- Timeout/ownership của UI lock (TASK-017).

## 2. Bằng chứng

- Buy worker được suy ra từ chat text qua `checkAutoBuyRunning`, `confirmSuspectedWorker`, `verifyTailOrphan`, `pendingBuyCompletion`, `getLatestAutoBuyStatus`.
- `checkAutoBuyRunning()` gửi `/stop` và parse reply — tức là dùng hành động có side effect để đọc state.
- `pendingBuyCompletion` chỉ nằm trong memory; restart mất.
- `features/icon-session.js` đã chặn hai phiên ICON song song, nhưng chỉ trong một process.
- `lib/ui-lock.js` tuần tự hóa UI nhưng không có owner/timeout; không phải worker lock.
- Không có process lock; chạy hai instance có thể cùng thao tác một account.

## 3. Thiết kế đề xuất

### 3.1. Worker registry

`lib/worker-registry.js` + `state/workers.json` (hoặc dùng chung journal):

```json
{
  "version": 1,
  "process": {
    "pid": 12345,
    "startedAt": "...",
    "heartbeatAt": "...",
    "leaseUntil": "..."
  },
  "workers": [
    {
      "workerId": "...",
      "feature": "buy|upgrade|icon",
      "cycleId": "...",
      "state": "starting|running|stopping|stopped|unknown",
      "startedAt": "...",
      "heartbeatAt": "...",
      "leaseUntil": "...",
      "owned": true
    }
  ]
}
```

- Single-writer process lock `state/agent.lock`.
- Lease mặc định 60s; heartbeat gia hạn mỗi 20s.
- Process chết → lease hết hạn → startup coi là stale.

### 3.2. State machine

```text
idle ──► starting ──► running ──► stopping ──► stopped
  │          │            │
  │          └──► failed  └──► unknown
  └──► blocked (stale/unknown cần human)
```

- Chỉ registry được đổi state.
- Chat text chỉ là **evidence** để reconcile, không phải source of truth.
- `starting` ghi trước khi bấm start; nếu crash ở đây → `unknown`, không auto-retry.

### 3.3. Start flow

1. `acquireProcessLock()` — nếu lock còn sống, từ chối chạy.
2. `reconcile()` — đọc registry + journal + chat evidence.
3. Nếu có worker `running`/`unknown` không thuộc process này → chặn start, yêu cầu human.
4. `beginStart(workerId, feature, cycleId)` → state `starting`.
5. Gửi lệnh start; xác nhận worker.
6. `markRunning(workerId)`.
7. Heartbeat gia hạn lease.

### 3.4. Stop flow

1. `beginStop(workerId)` → `stopping`.
2. Gọi stop function tương ứng; chỉ dừng worker do agent sở hữu.
3. Xác nhận đã dừng; `markStopped(workerId)`.
4. Nếu không xác nhận: `unknown`, chặn start mới, log rõ.

### 3.5. Reconcile khi startup

| Registry | Chat evidence | Hành động |
|---|---|---|
| running | có worker | Adopt nếu cùng process/cycle; nếu không, chặn |
| running | không có | Mark `unknown`, chặn |
| idle | có worker | Không adopt; log; yêu cầu human |
| unknown | bất kỳ | Chặn đến khi human resolve |
| stopped | không có | Sạch |

### 3.6. Tích hợp ICON

- `features/icon-session.js` đăng ký worker `icon` trong registry.
- One-shot vẫn giữ; registry đảm bảo cross-process.
- Task baseline `/stop` vẫn dùng để chỉ dừng task do phiên tạo ra.

## 4. Patch plan (không sửa code trong phase này)

1. Thêm `lib/worker-registry.js` + test.
2. Thêm config `worker.leaseSeconds`, `worker.heartbeatSeconds`, `worker.statePath`.
3. `agent.js`: acquire/release process lock trong lifecycle.
4. `features/controller.js`: reconcile trước command loop; dùng registry thay `checkAutoBuyRunning` làm source of truth.
5. `features/buy/cycle.js`: beginStart/markRunning/beginStop/markStopped.
6. `features/upgrade/runner.js`: tích hợp tương tự.
7. `features/icon-session.js`: đăng ký worker icon.
8. `lib/ui-lock.js`: nhận `workerId` để log/owner (chi tiết ở TASK-017).
9. README: state model, lock file, recovery.

## 5. Test plan

| Loại | Case | Kỳ vọng |
|---|---|---|
| Unit | Begin/mark/stop | State đúng thứ tự |
| Unit | Transition sai | Throw, không ghi |
| Unit | Lease hết hạn | Mark stale |
| Unit | Heartbeat gia hạn | Lease mới |
| Integration | Hai process cùng start | Process thứ hai bị từ chối |
| Integration | Restart khi worker running | Không start worker mới |
| Integration | Restart khi worker unknown | Chặn, yêu cầu human |
| Integration | Chat có worker nhưng registry idle | Không adopt; log |
| Integration | Registry running nhưng chat mất | Mark unknown; chặn |
| Integration | Concurrent icon + buy | Chỉ một worker UI tại một thời điểm |
| Failure | Stop không xác nhận | `unknown`, chặn |
| Regression | `npm run check` | 174+ test pass |

## 6. Rollback

- Chạy registry ở **shadow mode**: chỉ ghi và so sánh với hành vi cũ, không chặn.
- Khi log ổn định ≥ 1 tuần, bật enforcement.
- Rollback = tắt enforcement, giữ file registry để điều tra.
- Không xóa `state/workers.json` khi đang có worker `unknown`.

## 7. Definition of Done

- Có process lock và worker lease.
- Chat text không còn là nguồn state duy nhất.
- Restart/hai instance không tạo worker thứ hai.
- Có test double-start/restart/unknown.
- README mô tả state machine và quy trình resolve `unknown`.
