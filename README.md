# FO4 Agent

Agent Playwright dieu khien Telegram Web cho mot chu trinh duy nhat:

1. Duy tri toi da 3 task mua ICON (3/3).
2. Theo doi don trong TTCN cho toi khi don duoc nhan vao kho.
3. Khi kho co ICON, mua phoi va nang cap trong khi van theo doi/mua bu cac task ICON.
   So luong ICON trong kho duoc cache trong cung phase, khong mo mini-app kho
   sau moi chu ky mua phoi; chi kiem tra lai sau khi phase nang ket thuc.
4. Lap lai cho toi khi dung agent.

Khi nang cap, agent loc phoi theo OVR/gia cau hinh, bam "Kiểm tra & bắt đầu" roi
**doi chieu lai UI cuoi** voi config (target, ti le, so phoi, bao ve BP). UI sai
thi KHONG bam start va se backoff/de co an toan; nut start thieu cung duoc tach
rieng khoi truong hop "het phoi that".

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
cap nang va thoi gian cho duoc dat trong [config.json](./config.json). De bat dau
tu dau, copy `config.example.json` -> `config.json` roi chinh cac gia tri OVR/gia
cho tai khoan cua ban (agent khong tu y mở rộng dải phôi).

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
  Ghi atomic (temp + fsync + rename); bo qua cac nhip ma noi dung khong doi, toi
  da 5 phut/lan.
- `workers.json`: worker registry `starting|running|stopping|stopped|unknown`.
- `agent.lock`: process lock (lease 60 giay, heartbeat 20 giay).

### Worker `unknown`

`unknown` la trang thai fail-closed: agent **khong** mua/na ng moi cho toi khi
con nguoi xac nhan. Xay ra khi agent crash/restart ma registry con worker
`running` nhung chat khong con bang chung.

1. Dung agent (Ctrl+C) va mo Telegram kiem tra bang `/stop`: chac chan khong con
   worker nao dang chay.
2. Liet ke worker va resolve (CLI se tu choi neu agent con song):
   ```powershell
   npm.cmd run worker:resolve
   npm.cmd run worker:resolve -- --resolve <workerId>
   # hoac resolve tat ca worker unknown:
   npm.cmd run worker:resolve -- --resolve-all
   ```
   Them `--note "..."` de luu ly do, `--dry-run` de xem truoc, `--json` de lay
   ket qua cho script. Neu `--resolve-all` loi mot phan, CLI van resolve cac
   worker con lai, in summary va exit 1 de lan chay sau xu ly tiep.
   Neu muon xoa han state worker (giu lai file de doi chieu neu can):
   ```powershell
   Remove-Item "$env:LOCALAPPDATA\FO4PurchaseAgent\state\workers.json"
   ```
3. Khoi dong lai agent va gui `/startagent`.

### Worker state hong

Neu `workers.json` khong parse duoc hoac sai cau truc (vi du `workers` khong
phai mang), agent **khong** coi do la registry rong — lam vay se mo khoa mua
chong. Agent dung voi ma loi `WORKER_STATE_CORRUPT` va tao ban sao
`workers.json.corrupt-<thoi-gian>` trong cung thu muc.

1. Dung agent, mo file `.corrupt-*` de doi chieu worker dang co.
2. Kiem tra bot/Telegram bang `/stop`: chac chan khong con worker nao chay.
3. Sua `workers.json` cho hop le, hoac di chuyen file hong ra ngoai:
   ```powershell
   Move-Item "$env:LOCALAPPDATA\FO4PurchaseAgent\state\workers.json" `
     "$env:LOCALAPPDATA\FO4PurchaseAgent\state\workers.json.bak"
   ```
4. Khoi dong lai agent va gui `/startagent`.

### Process lock

Instance thu hai bi tu choi (`AGENT_LOCKED`, exit code 1) khi instance dau con
song. Neu agent da tat ma van bi chan, cho het lease (60 giay) hoac xoa
`agent.lock` sau khi chac chan khong con process `node agent.js` nao chay.

### Process lock hong (`AGENT_LOCK_CORRUPT`)

Neu `agent.lock` rong, khong parse duoc hoac sai cau truc (thieu `token`, `pid`
khong phai so nguyen, `leaseUntil` khong hop le), agent **khong** coi do la
"khong co lock" — lam vay se mo duong cho hai instance cung mua. Agent dung voi
ma loi `AGENT_LOCK_CORRUPT` va tao ban sao `agent.lock.corrupt-<thoi-gian>`.
`heartbeat`/`release` cung khong ghi de file hong; CLI `worker:resolve` coi lock
hong la "agent dang chay" va tu choi sua state.

1. Dung agent va chac chan khong con process `node agent.js` nao chay:
   ```powershell
   Get-Process node -ErrorAction SilentlyContinue
   ```
2. Mo file `agent.lock.corrupt-*` de doi chieu `pid`/`token` voi process that.
3. Neu chac chan khong con agent, di chuyen lock hong ra ngoai (giu lai de doi
   chieu):
   ```powershell
   Move-Item "$env:LOCALAPPDATA\FO4PurchaseAgent\state\agent.lock" `
     "$env:LOCALAPPDATA\FO4PurchaseAgent\state\agent.lock.bak"
   ```
4. Khoi dong lai agent va gui `/startagent`.

### Log hoi thoai Telegram

Ngoai `agent.log`, agent ghi moi tin nhan trong chat bot vao
`%LOCALAPPDATA%\FO4PurchaseAgent\telegram-chat.log` (cung thu muc voi
`agent.log`). Moi tin la mot dong:

```text
[2026-11-18T07:00:00.000Z] [Direction: IN] /startagent
[2026-11-18T07:00:01.000Z] [Direction: OUT] Bot: da bat dau treo auto mua
```

- `IN`: tin tu tai khoan Telegram dang dang nhap gui toi bot (lenh nguoi dung,
  ke ca cac lenh agent tu gui nhu `/tn`, `/stopauto`).
- `OUT`: tin bot tra ve (menu, thong bao mua/nang, loi E006...).
- Lich su chat co san luc khoi dong chi duoc lay lam moc, khong ghi lai.
- Dat `FO4_TELEGRAM_CHAT_LOG=<duong-dan>` de ghi sang file khac.

Doi chieu voi `agent.log` de biet agent nhan lenh sau bao lau va action co
khop khong:

```powershell
npm.cmd run log:compare
npm.cmd run log:compare -- --json
npm.cmd run log:compare -- --agent <agent.log> --chat <telegram-chat.log>
```

Lenh chi doi chieu `/startagent`, `/stopagent`, `/resetagent`. Tin `IN` khac va
tin `OUT` van nam trong log nhung khong tham gia ghep cap.

## Kiem tra

```powershell
npm.cmd test
npm.cmd run check
```
