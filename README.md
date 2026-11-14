# FO4 Agent

Agent Playwright dieu khien Telegram Web cho mot chu trinh duy nhat:

1. Duy tri toi da 3 task mua ICON (3/3).
2. Theo doi don trong TTCN cho toi khi don duoc nhan vao kho.
3. Khi kho co ICON, mua phoi va nang cap trong khi van theo doi/mua bu cac task ICON.
   So luong ICON trong kho duoc cache trong cung phase, khong mo mini-app kho
   sau moi chu ky mua phoi; chi kiem tra lai sau khi phase nang ket thuc.
4. Lap lai cho toi khi dung agent.

Khi nang cap, agent van loc phoi theo OVR/gia cau hinh va bam "Kiểm tra & bắt
đầu", nhung khong doi chieu lai text cua man hinh xac nhan cuoi. Mini-app co
the tu danh dau hoac khoa cac the sau khi loc, lam so phoi hien thi thay doi;
agent chi dung neu khong tim thay nut kiem tra hoac nut bat dau.

## Chay

```powershell
npm.cmd install
npm.cmd start
```

Dang nhap Telegram Web thu cong o lan chay dau tien. Profile duoc luu tai:

`%LOCALAPPDATA%\FO4PurchaseAgent\telegram-profile`

Lenh dieu khien trong chat bot:

- `/startagent`: bat theo doi ICON lien tuc va tu dong chay mua phoi/nang khi kho co ICON.
- `/stopagent`: dung sau buoc dang chay an toan.
- `/resetagent`: mo lai Telegram Web va dua agent ve trang thai cho.

Thoi gian cho mua ICON la khong gioi han (`purchaseTimeoutSeconds: 0`) vi don co
the mat 2-3 gio. Khi doc TTCN, agent chi hủy don moi co vi tri mua lon hon 3;
neu khong doc duoc vi tri thi giu don de tranh huy nham. Cac gioi han gia, OVR,
cap nang va thoi gian cho duoc dat trong [config.json](./config.json).

## Van hanh & shutdown

Agent bat SIGINT/SIGTERM/SIGBREAK va loi khong phuc hoi, don dep truoc khi thoat:

| Su kien | Hanh vi | Exit code |
|---|---|---|
| Ctrl+C lan 1 | Dung luong ICON, gui `/stopauto`/`/stopnc` cho worker agent so huu, dong mini-app + trinh duyet, dong readline | 130 |
| Ctrl+C lan 2 | Thoat ngay, bo qua cleanup dang treo | 130 |
| SIGTERM | Cleanup nhu Ctrl+C lan 1 | 143 |
| SIGBREAK (Windows) | Cleanup nhu Ctrl+C lan 1 | 130 |
| `uncaughtException` / `unhandledRejection` | Cleanup roi thoat | 1 |

Cleanup co timeout 20 giay cho moi handler va timeout tong; handler loi khong chan
handler khac. Cleanup chi chay mot lan du nhan nhieu signal.

### File trang thai (ngoai repo)

Tat ca nam trong `%LOCALAPPDATA%\FO4PurchaseAgent\state\`:

- `heartbeat.json`: `pid`, `lastHeartbeatAt`, `state`, `mode`, `activeWorkerId`.
  Ghi atomic (`.tmp` + rename) moi 30 giay.
- `workers.json`: worker registry `starting|running|stopping|stopped|unknown`.
- `agent.lock`: process lock (lease 60 giay, heartbeat 20 giay).

### Worker `unknown`

`unknown` la trang thai fail-closed: agent **khong** mua/na ng moi cho toi khi
con nguoi xac nhan. Xay ra khi agent crash/restart ma registry con worker
`running` nhung chat khong con bang chung.

1. Dung agent (Ctrl+C) va mo Telegram kiem tra bang `/stop`: chac chan khong con
   worker nao dang chay.
2. Xoa state worker (giu lai file de doi chieu neu can):
   ```powershell
   Remove-Item "$env:LOCALAPPDATA\FO4PurchaseAgent\state\workers.json"
   ```
   Hoac resolve dung worker qua API registry:
   ```powershell
   node -e "const path=require('node:path');const {getWorkerRegistry}=require('./lib/worker-registry');const dir=path.join(process.env.LOCALAPPDATA,'FO4PurchaseAgent','state');const r=getWorkerRegistry({statePath:path.join(dir,'workers.json'),lockPath:path.join(dir,'agent.lock')});for(const w of r.getSnapshot().workers)if(w.state==='unknown')console.log(r.resolveUnknown(w.workerId,'operator-verified-stopped'));"
   ```
3. Khoi dong lai agent va gui `/startagent`.

### Process lock

Instance thu hai bi tu choi (`AGENT_LOCKED`, exit code 1) khi instance dau con
song. Neu agent da tat ma van bi chan, cho het lease (60 giay) hoac xoa
`agent.lock` sau khi chac chan khong con process `node agent.js` nao chay.

## Kiem tra

```powershell
npm.cmd test
npm.cmd run check
```
