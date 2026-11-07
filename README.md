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

## Kiem tra

```powershell
npm.cmd test
npm.cmd run check
```
