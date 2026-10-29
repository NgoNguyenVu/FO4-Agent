# FO4 local purchase agent

This is a local Playwright controller for the visible Telegram Web mini-app. It
does not use Telegram Bot API tokens or read the mini-app's authentication token.
The Telegram login is performed manually in the browser window and is stored in
the local Windows profile directory:

`%LOCALAPPDATA%\FO4PurchaseAgent\telegram-profile`

The agent opens Telegram Web K at
`https://web.telegram.org/k/#@Nguyenanh_fo4_bot`, matching the saved profile.
Both the Web K `@username` hash and the Web A numeric chat ID
(`#8107829917`) are recognized as the bot chat. To use Web A explicitly, set
`FO4_TELEGRAM_URL=https://web.telegram.org/a/#8107829917` before `npm start`.

## Current `config.json` settings

- OVR: 115–120
- Maximum price: 666,666 BP per player
- Quantity per attempt: 5
- Maximum per cycle: 14
- Bot/mini-app response timeout: 5 minutes
- `/tn` menu response timeout: 45 seconds
- Minimum gap between `/tn` sends: 15 seconds
- Retry after a busy menu: 15s, then 30/60/120/300s
- Upgrade mini-app load timeout: 30 seconds (retried once)
- Target re-check after the upgrade starts: 60 seconds, then every 120 seconds
- Maximum cycle wait: 180 minutes
- ICON favorites: one random code per `/starticon`, grade +1, quantity 1; cancel
  orders placed at position > 5 or when the position is unknown (including E004)
  through `Auto Mua Phôi` -> `Gỡ cầu thủ TTCN`
- Seasons and upgrade-grade selections: left as selected in the mini-app

Each new cycle uses the configured maximum quantity. The agent does not impose
a lifetime BP budget; the bot/account balance determines whether a purchase is
accepted. The configured maximum price is entered and verified in the mini-app;
individual transaction prices are not inspected by the agent.

## Run

If Playwright Chromium crashes while opening a visible window with
`Target page, context or browser has been closed` or Windows error
`0xC0000005`, the agent first tries installed Microsoft Edge with the same
Telegram profile, then falls back to headless Chromium only if Edge cannot
start. Headless mode still controls Telegram Web and the mini-app through the
DOM, but does not show a browser window; if Telegram asks for login in
headless mode, log in once using a visible run first. To start directly in
headless mode on Windows:

```powershell
$env:FO4_HEADLESS = "true"
npm.cmd start
```

The agent checks for Telegram's QR/phone login screen before waiting for a
mini-app. If the session has expired, it logs that login is required instead
of treating the missing mini-app as a slow load.

1. Install Node.js LTS if it is not already installed.
2. Double-click `start-agent.cmd`.
3. On the first run, sign in to Telegram manually in the opened browser. Later
   runs reuse the saved local browser session unless Telegram asks you to
   authenticate again. Do not share QR codes, OTPs, passwords, or browser
   profile files.
4. The agent opens the bot chat before attaching its text observer to the
   loaded Telegram page. It confirms the message composer, waits for chat
   history to settle, then arms command detection and waits for fresh control
   commands. New messages that Telegram Web syncs from your phone are
   read as they appear in the open bot chat. Keep the PC online and Telegram Web
   connected; the agent cannot read messages that have not synced into the
   browser. Control commands in the bot chat:
   `/startagent` starts the full loop (buy until inventory-full, then upgrade
   icon targets continuously until valid materials are exhausted, then buy
   again; it stops when no icon below target remains),
   `/startmua` runs only Auto Mua Phôi, `/startnang` runs only Auto Nâng Cấp
   (icon targets one by one until none remain),
   `/starticon` buys only ICON players from the live
   `Tra cứu mã cầu thủ offline` favorites list (up to 3 unique codes per batch,
   +1/quantity 1, re-runs the lookup every batch, and cancels orders whose
   `Vị trí mua` is greater than 5 through `Auto Mua Phôi` -> `Gỡ cầu thủ TTCN`),
   `/stopagent` stops only the
   Auto Mua/Auto Nâng worker owned by this agent, `/resetagent` immediately returns the
   agent to idle, clears its phase state, reopens Telegram Web and restores
   monitoring without stopping a bot worker. `/stop` is used only
   to inspect worker status;
   the agent never selects an option from its stop menu. Worker chức năng khác
   của bot được phép chạy song song; agent không dò để chặn hoặc gửi lệnh dừng
   tới các worker đó. Auto Mua Phôi và Auto Nâng Cấp trong cùng flow agent vẫn
   chạy theo phase riêng để không tự mở chồng hai worker của agent.
   After a full-inventory response, both modes wait for the bot acknowledgement
   `Đã nhận ... cầu thủ trong kho mua. Tiếp tục mua...` before issuing the
   next action. The master mode then upgrades; buy-only mode starts the next
   purchase cycle.
   If a target cannot reach the configured grade with the currently available
   materials, it is temporarily skipped by both upgrade modes and retried in a
   later upgrade phase after more materials are purchased. It is not persisted
   as a permanent blacklist.
   The chat watcher periodically scrolls the Telegram chat container to the
   newest message before polling its text. This handles a stale viewport where
   Telegram has already received newer bot replies but the browser is still
   showing older messages.
   Each upgrade target reopens or reuses the upgrade mini-app. If Telegram has
   trimmed the chat so the upgrade menu is no longer visible, the agent sends
   `/tn`, waits for a fresh `Auto Nâng Cấp 2.0` menu, and continues with the next
   target. A stale menu button is retried the same way.
   When starting a purchase cycle, if the current chat has no actionable
   `Auto Mua Phôi` button, the agent sends `/tn` immediately instead of waiting
   for an old menu or an E003 status message to change.
   After clicking the menu, the agent requires the purchase iframe to appear
   within 20 seconds and its start button to render within 45 seconds. It
   targets the newest `iframe.payment-verification` (the last one in the DOM)
   instead of the first one, because Telegram Web can leave a closed mini-app
   iframe behind. An iframe that is still completely blank 15 seconds after it
   appears is treated as a failed render, not a slow load: it closes it and
   retries the existing menu without sending `/tn`; only an iframe that never
   opens requests one fresh `/tn`. A second failure lets the controller reload
   Telegram Web. If the Telegram Web App does not open, it reports a recoverable
   UI error instead of waiting for the full bot response timeout.
   Upgrade results are not treated as successful merely because a terminal
   message exists: the result must show a reached target, a positive success
   count, or a higher final grade. A failed/no-progress target is skipped for
   the current phase; `/startagent` can return to buying, while `/startnang`
   stops after no viable targets remain.
   Upgrade completion is detected from fresh text first. When Telegram replaces
   the whole snapshot, the agent also compares the latest terminal's content and
   Telegram timestamp. This still recognizes a new result when Telegram trims
   the old terminal and adds the new one in the same render, leaving the terminal
   count unchanged; an older terminal revealed by scrolling back is ignored.
   If an upgrade was started but no terminal message arrives, the agent checks
   the mini-app inventory after 60 seconds and then every 120 seconds. If the
   mini-app was closed after starting, it tries once to reopen it from the
   existing chat menu without sending `/tn`; when no menu is present it keeps
   waiting instead of spamming the bot. It only concludes that targets are
   exhausted when a reload was actually observed, no icon card below the
   configured grade remains, and no card is locked/training (the current target
   can be temporarily locked while the worker is running). Two consecutive
   checks are required. The agent then stops waiting and returns to idle without
   sending `/stopnc`; this is a recovery guard, not a confirmed root cause.
   If a completed upgrade reports zero materials remaining, the upgrade phase
   stops immediately and does not configure another target. If materials remain
   but every remaining target is blocked/blacklisted, the phase reports that
   state and stops; it does not start a new target.
   control messages
   in chat history are not treated as new
   commands; the agent waits for the chat text to settle before arming command
   detection and ignores history prepended before the observed chat tail. When
   waiting, it also polls chat text every 500 ms and recognizes a newly added
   command at the end if Telegram replaces the text snapshot. It must log that
   it is ready before a new command is sent. The agent process must already be running on the PC;
   Telegram cannot launch it after it has exited.
5. On `/startagent`, `/startmua`, `/startnang`, or `/starticon`, the agent sends
   `/stop` only
   to inspect Auto Mua status. It never clicks a stop-menu option or uses
   `/stop` to stop a worker. Worker chức năng khác đang chạy không làm agent
   chuyển idle hoặc gửi lệnh dừng. When `/stopagent` is sent while idle, it
   sends `/stopauto` only if Auto Mua is confirmed running; it never sends
   `/stopnc` to a worker không do agent quản lý.
6. For each purchase cycle, the agent reuses an open mini-app or checks the
   last 100,000 characters of chat history for the feature menu. A menu still
   present in that history remains reusable even when a later purchase or
   completion message follows it, so long cycles do not make the agent send
   `/tn` again just because their messages pushed the menu past the previous
   10,000-character limit. It sends `/tn` only when the menu is outside this
   readable window or the existing menu button cannot open an iframe. Blank or
   wrong-UI iframes retry the existing menu first, so a render failure does not
   turn into `/tn` spam. Every `/tn` send passes through a 15-second cooldown.
   Menu recognition uses the feature-button labels (`Auto Mua Phôi`,
   `Auto Nâng Cấp 2.0`, ...), not the old prompt sentence, so a changed/missing
   prompt does not cause a false "another function replaced the menu" error; a
   `/tn` timeout is reported as a slow or missing bot response. After opening
   the mini-app, it waits until loading finishes and a displayed BP value
   appears before filling and verifying settings. It then starts automatically,
   waits for the bot's start acknowledgement, and closes the mini-app using its
   visible close control (or Escape) and verifies it is hidden. Telegram Web and
   its chat observer stay open. Closing the mini-app does not stop the worker.
   The agent waits for completion or stop before starting the next cycle.
   An iframe that stays completely blank 15 seconds after it appears is treated
   as a failed render, not a slow load: the agent closes it and retries the
   existing menu without sending `/tn`. If the iframe never opens at all, it
   requests one fresh menu with `/tn` before retrying. If the UI is still not
   ready after that retry, it saves a screenshot under `debug/`, logs the
   iframe/body state, and automatically reloads Telegram Web (up to two times)
   instead of stopping immediately. After two failed reloads it reports the
   error and waits for recovery. Closing the mini-app closes every visible
   payment iframe so a stale iframe cannot be reopened by the next cycle.
7. Send `/stopagent` to stop the current worker (purchase via `/stopauto`,
   upgrade via `/stopnc`) and
   return the agent to its idle state. This also works if the agent is idle but
   a worker is running: it checks status, sends the matching stop command only
   when that worker type is confirmed, waits for the bot's stop confirmation, then
   remains open for a new start command. If no worker is running, it remains
   idle. If the bot stops Auto Mua Phôi, the agent returns to idle and does not
   start another purchase cycle until a start command is sent again. The Telegram
   browser and agent process stay open; Ctrl+C exits the local process.

8. Auto Nâng Cấp 2.0 (manual phôi mode) shares the same chat observer and
   recovery. `/startnang` (or an inventory-full pivot in the full loop) opens
   the upgrade mini-app, selects self-select-phôi mode, fills wait/ratio/OVR/
   price from `config.json upgrade`, picks the lowest-grade cheapest icon
   below target (ICON and its variants: ICON TM, ICON TM Bound, ICONS MATCH,
   TKI, MCFC ICON; supports both Nexon badge URLs and Garena
   `season-icon/<id>.png`, unlocked), filters kho phôi, verifies
   the final screen, and starts. It tracks progress (`lên Mức thẻ N`),
   shortage warnings, and terminal summaries (`Nâng thành công X/Y target`
   with reason: target reached vs out of materials). BP protection is enabled
   only from the configured grade (`bpProtectFromGrade`, 8). After a reached
   target the loop continues with the next icon; after an upgrade that changed
   nothing (same grade, out of materials) it parks for manual intervention
   instead of blind buying into a still-full inventory. The upgrade flow also
   detects a completely blank iframe after 15 seconds, closes it, and retries
   the existing menu without sending `/tn`; only an iframe that never opens
   needs a fresh `/tn`. Advanced `<details>` sections are opened idempotently
   and manual mode is selected through `#modeManual`; a missing/hidden mode
   card no longer toggles the section closed. If the upgrade mini-app still
   fails to load or select manual mode after its one retry, the controller
   reloads Telegram Web up to two times before stopping, using the same
   recovery as the purchase mini-app.
   Starting an upgrade while one already runs adopts and waits for it instead
   of opening a second one. Modes never stop each other's workers on their own;
   only `/stopagent` stops whatever runs.

Before sending a bot command (`/stop`, `/tn`, `/stopauto`, or `/stopnc`), the
agent waits 4 seconds to avoid the bot's "Bạn thao tác quá nhanh" rate-limit
response. `/tn` additionally has a 15-second minimum interval shared by buy and
upgrade, so a failed mini-app cannot cause back-to-back menu commands. If the
bot still rejects `/stop`, `/tn`, `/stopauto`, or `/stopnc` and specifies a
retry delay (for example, "Vui lòng chờ 4s rồi thử lại"), the agent waits that
duration and retries the command (`/tn` up to 3 times). Menu waits are bounded
by `menuResponseTimeoutSeconds` (default 45 seconds); if the menu is still
missing, the agent retries with an increasing backoff: 15s, 30s, 60s, 120s,
then 300s. Other stop/completion waits remain bounded by
`botResponseTimeoutMinutes`, then report an explicit timeout.
If the bot returns a fresh `E006: Lỗi hệ thống` response, the agent stops its
automatic cycle and waits for a new `/startagent`. It does not retry `/tn` or
wait for Enter.

The agent does not write purchase state or cycle totals to disk. After a local
restart it waits for `/startagent`, then checks `/stop` before buying.

The agent advances after either supported completion message:
`Đã mua đủ N cầu thủ` or
`Hết thời gian treo. Hoàn thành mua N cầu thủ.` It does not inspect individual
purchase SPIDs or prices. `Đã dừng treo auto mua cho chatId ...` also ends the
wait and returns the agent to idle without starting another cycle. A generic bot `/stop` confirmation
(`Đã dừng N luồng thành công`) is not attributed to Auto Mua Phôi, so stopping
another worker such as GLXH will not restart a purchase cycle. The value of N
does not stop the loop: after
every completion, the agent starts another cycle until a fresh `/stopagent`
command is received. If neither a completion nor stop message arrives within
`maxCycleWaitMinutes`, the agent reports the timeout and waits for Enter before
retrying; it does not close the Telegram browser.
Completion detection is tied to the current cycle's start/activity notice, so
it continues to work if Telegram trims older chat messages and the visible
completion count becomes smaller than it was at the start of the cycle.
Cycle events (completion, stop, start acknowledgement, `/stop` replies) are
read from chat text appended after the cycle baseline (fresh-text), so head
trimming by Telegram Web or concurrent manual traffic (GLXH/other features)
neither hides them nor creates false signals; absolute counts remain as
fallback. If the rendered window was trimmed so far that even the cycle's
activity line is gone, a remaining auto-buy terminal (completion/stop) with no
activity left in the window is still accepted as the cycle outcome, because
trimming always removes the oldest messages first. Before accepting, the agent
presses End to bring the chat back to the tail and re-reads once, so an old
region viewed while you scroll up cannot fake a completion (which would
otherwise start an overlapping worker and spend real BP). If the feature menu text is still recent but its button is no longer
clickable (keyboard replaced by manual traffic), the agent sends a fresh `/tn`
for a new menu instead of stopping. While
waiting, the agent logs a periodic heartbeat; before every next cycle it logs
that it is checking the feature menu and mini-app.
If the bot reports `reason=43` because the inventory and transfer market are
full and says the auto-buy command was stopped, the agent stops the loop and
waits for a fresh `/startagent` instead of starting another cycle.

## Vòng `/startagent` (đầy kho -> nâng -> mua)

- Kho/TTCN đầy -> chuyển sang phase nâng.
- Còn target -> nâng tiếp; target thiếu phôi (`possible` < yêu cầu) bị đưa vào
  danh sách đen tạm thời và thử target khác.
- Hết phôi (`no-materials`) -> quay lại mua phôi.
- Hết target khả thi, kể cả khi tất cả đã bị blacklist (`no-targets`) -> quay lại
  mua phôi. Danh sách đen chỉ có hiệu lực trong 1 phase nên phase sau thử lại.
- Nâng xong nhưng kho không đổi/không tiến triển -> dừng, chờ can thiệp.

## Vòng `/starticon` (ICON yêu thích)

- Mỗi lần `/starticon` luôn bấm lại `Tra cứu mã cầu thủ offline` để lấy danh
  sách yêu thích hiện tại, chỉ giữ mùa ICON/ICONTM/ICONS MATCH/TKI và bỏ trùng
  theo mã 9 số.
- Chọn ngẫu nhiên 1 mã, gửi `Chèn Member Thường` -> `Mua cầu thủ` với dòng
  `<Mã> 1 1`. Không chạy vòng lặp: xong 1 lượt là về idle, lần gọi sau random
  lại từ đầu.
- Đọc log `Đã đặt mua thành công ... Vị trí mua: N`; nếu `N > 5` **hoặc không
  lấy được vị trí** (kể cả `E004`), mở `Auto Mua Phôi` -> `Gỡ cầu thủ TTCN`,
  chờ danh sách tải xong, chọn đúng đơn mới (đối chiếu `data-orderid` baseline)
  rồi bấm `Hủy`. Chỉ giữ đơn khi biết chắc `N <= 5`.
- Gặp lỗi, hoặc nhận `/stopagent` thì phiên dừng. Chế độ này không gửi `/stop`,
  không dừng worker Auto Mua/Auto Nâng và không bị các chế độ kia dừng theo.

## Recovery chuẩn

- `E006` -> dừng về idle, chờ `/startagent` mới (không retry, không Enter).
- Kho/TTCN đầy (`reason=43`) -> vòng `buy` về idle chờ lệnh; vòng tổng
  (`/startagent`) tự chuyển sang nâng cấp 1 target rồi mua tiếp.
- Bot dừng worker -> về idle, chờ `/startagent`.
- Chrome/page đóng -> mở lại persistent session, gắn lại observer, settle + arm, giữ `agentActive` và kiểm tra lại worker bằng `/stop`.
- Trình duyệt treo (mọi thao tác đọc/ghi quá 30s không phản hồi) -> coi như session chết: đóng, mở lại, tiếp tục vòng hiện tại thay vì im lặng.
- `/resetagent` -> đóng context, mở lại session, không dừng worker mua.
- `/resetagent` rơi đúng lúc một thao tác Playwright đang chạy -> lỗi
  `Target page, context or browser has been closed` là do chủ động đóng
  context, agent khôi phục im lặng (không in stack, không coi là lỗi).
- Telegram Web reset về trang chủ (mất hash `#@bot`) -> trước khi tìm nút menu
  hoặc gửi lệnh, agent kiểm tra và tự mở lại chat bot, tránh gửi `/tn` sai chỗ
  rồi chờ menu vô ích.
- URL vẫn còn hash `#@bot` nhưng cột chat đã đóng (Telegram Web K để lại
  Appearance/tips, trang chủ) -> agent không tin hash nữa: kiểm tra topbar và
  composer thật, rồi bấm lại đúng dòng `BOT-TTCN-FO4` trong danh sách chat. Chỉ
  fallback `page.goto` khi không thấy dòng chat. Tips `Next Tip` được dọn tối đa
  10 giây.
- Telegram Web tự reload/điều hướng đúng lúc agent đang đọc DOM
  (`Execution context was destroyed`) -> coi là lỗi trang tạm thời, mở lại chat
  bot, gắn lại observer, giữ nguyên worker đang chạy; không dừng agent và không
  bắt người dùng nhấn Enter/`/resetagent`.
- Đóng mini-app: chỉ bấm `Escape` khi iframe vẫn còn hiển thị; nếu iframe vừa
  tự đóng trong lúc tìm nút thì bỏ qua, tránh `Escape` đóng luôn chat bot và
  đẩy Telegram về trang chủ.
- Chromium được mở với cờ ẩn bong bóng `Restore pages?` và bỏ qua first-run,
  để sau khi crash/khởi động lại không có hộp thoại che UI.
- Chờ menu `/tn`, chờ nút Auto Nâng Cấp, chờ mini-app nâng cấp tải và chờ bot
  xác nhận khởi động đều ghi log nhịp tim định kỳ, nên trạng thái "đang chờ"
  không còn trông giống "treo".
- Lỗi khác -> ghi log file, về idle, chờ Enter tại PC hoặc `/resetagent` từ xa.
- Không thấy ô nhập tin nhắn (trang load chậm) -> tự tải lại chat MỘT lần, chờ thêm, rồi mới đậu prompt; prompt này cũng đánh thức được bằng `/resetagent` từ xa (trường hợp Telegram bắt đăng nhập lại thì vẫn cần thao tác tại PC một lần).
- Iframe trắng hoàn toàn sau 15 giây -> coi là lỗi render, đóng và bấm lại menu hiện có, KHÔNG gửi `/tn`; nếu iframe không mở lần nào thì mới gửi một `/tn` mới. Thử lại một lần rồi controller tự reload Telegram Web.
- Mini-app mua quá timeout chưa hiện BP -> đóng và thử lại menu hiện có một lần (chỉ gửi `/tn` nếu không còn nút).
- Mini-app nâng cấp trắng hoặc tải quá `upgradeFrameTimeoutSeconds` (mặc định 30 giây) -> đóng và thử lại menu hiện có một lần; iframe không mở mới cần `/tn`. Danh sách target rỗng nhưng form đã render được nhận là "hết target" thay vì chờ đủ timeout.
- Không thấy/chọn được mục "Tự chọn phôi" trong mini-app nâng cấp -> mở các mục `<details>` bằng DOM (không click summary lần hai làm đóng mục), chọn trực tiếp `#modeManual`; nếu iframe đang ẩn hoặc không chọn được sau vài lần thử ngắn, mở lại mini-app một lần rồi để controller reload Telegram Web (tối đa 2 lần), thay vì đậu prompt lỗi.
- Kết quả nâng được nhận bằng phần tin mới; nếu Telegram thay cả snapshot, agent so khóa terminal cuối (nội dung + giờ Telegram), nên trường hợp trim mất terminal cũ và thêm terminal mới mà số terminal không đổi vẫn được nhận. Terminal cũ lộ ra do cuộn ngược (giờ sớm hơn) bị bỏ qua.
- Đã bắt đầu nâng nhưng bot không gửi terminal -> sau `targetCheckDelaySeconds` (mặc định 60 giây), agent kiểm tra kho mỗi `targetCheckIntervalSeconds` (mặc định 120 giây). Nếu mini-app đã tự đóng, agent thử mở lại MỘT lần bằng menu còn trong chat (không gửi `/tn`); không có menu thì tiếp tục chờ thay vì spam bot. Agent bấm "Tải lại" trong mini-app và chỉ kết luận hết target khi thấy loader tải lại thật, không có banner lỗi, không còn thẻ ICON dưới target, không có thẻ đang khóa/training, và xác nhận đủ 2 lần liên tiếp; sau đó về idle chờ lệnh, không gửi `/stopnc`. App mở lại có thể tự về mode `auto_buy_upgrade` và target +5; agent dùng spec trong `config.json` để đọc card, không đòi UI phải đang manual/+7. Đây là guard hồi phục, chưa xác nhận được nguyên nhân gốc của iframe/terminal bị mất.
- `/tn` có cooldown 15 giây dùng chung cho mua/nâng; khi bot chưa trả menu, agent thử lại với backoff 15/30/60/120/300 giây thay vì gửi dồn.
- `/stop`, `/tn`, `/stopauto`, `/stopnc` bị rate-limit -> chờ đúng số giây bot yêu cầu rồi gửi lại (`/tn` tối đa 3 lần), tối đa tới `menuResponseTimeoutSeconds` cho `/tn` và `botResponseTimeoutMinutes` cho các lệnh còn lại.

Normal status logs show when the agent starts, waits for an existing worker,
starts a new cycle, and recognizes its completion. It does not log individual
SPIDs or transaction prices.
If an unexpected operation fails after Telegram opens, the agent keeps the
browser window open, logs the error, and waits for Enter before retrying.
Recoverable cases such as a closed page, a renderer timeout, or Telegram Web
navigating/reloading by itself reopen the session automatically instead. A
diagnostic log is also written to
`%LOCALAPPDATA%\FO4PurchaseAgent\agent.log`.
If the Chrome window or Telegram page is closed, the agent attempts to reopen
the persistent Telegram session, attach chat monitoring again, and re-check
the current worker state instead of retrying against the closed page.
Send `/resetagent` in the bot chat to request that recovery remotely while
keeping the command prompt process open. If the agent is waiting at its
recovery prompt after an error, `/resetagent` also wakes that prompt and
continues recovery without requiring Enter at the PC.

Settings can be changed in `config.json`. To validate the script and its parser
tests, run `npm test` from this folder after dependencies are installed.

The launcher is `agent.js`. The code is deliberately split into independent
features and one thin coordinator:

- `features/buy/`: Auto Mua Phôi only.
  - `patterns.js`: bot message parsers and cycle outcome signals.
  - `menu.js`: Auto Mua menu discovery and fresh `/tn` menu replies.
  - `mini-app.js`: open, configure, and verify the purchase mini-app.
  - `cycle.js`: `/stop`, `/stopauto`, start acknowledgement, cycle completion,
    suspected worker, and inventory receipt waits.
  - `outcome.js`: post-cycle decisions. In master mode an inventory-full result
    only returns `pivotToUpgrade: true`.
  - `index.js`: public API of the feature.
- `features/upgrade/`: Auto Nâng Cấp only.
  - `patterns.js`: upgrade bot parsers, target/OVR parsing, and UI verification.
  - `mini-app.js`: upgrade menu, frame, configuration, target selection, phôi
    filtering, and final start.
  - `runner.js`: one upgrade run, start acknowledgement, completion, and
    `/stopnc`.
  - `loop.js`: upgrade outcome decisions, temporary target blacklist, and the
    master upgrade phase.
  - `index.js`: public API of the feature.
- `features/icon-buy/`: `/starticon` only.
  - `patterns.js`: ICON favorites, purchase-log, position, and TTCN order parsers.
  - `menu.js`: nearest feature-menu reuse, fresh `/tn` on stale tokens, and
    multiline purchase messages.
  - `chat-messages.js`: reads new bot messages by Telegram `data-mid`, so long
    chat trimming cannot hide lookup results or purchase logs.
  - `favorites.js`: re-runs the offline lookup and reads only fresh results.
  - `order.js`: `Chèn Member Thường` -> `Mua cầu thủ` and purchase-result waits.
  - `ttcn.js`: Auto Mua mini-app, TTCN tab, baseline, and cancel actions.
  - `runner.js`: one `/starticon` session and position-based cancellation.
  - `index.js`: public API of the feature.
- `features/controller.js`: Telegram session, command queue, mode selection
  (`master` / `buy` / `nang` / `icon`), and the only code that coordinates
  features. Feature trees never require each other.

Shared infrastructure lives outside the features:

- `lib/browser-session.js`: Chromium/Edge launch and Telegram session recovery.
- `lib/playwright-utils.js`: bounded Playwright calls and closed-session checks.
- `lib/chat-scroll.js`: Telegram chat-container scrolling.
- `lib/chat-observer.js`: chat text tracking, fresh messages, command queue,
  and DOM polling.
- `lib/chat-runtime.js`: shared observer/tracker wiring and orphan-tail
  verification.
- `lib/chat-state.js`: shared `page -> chat tracker` WeakMap.
- `lib/text-utils.js`: fresh-text extraction, command matching, and text scans.
- `lib/bot-patterns.js`: bot message patterns and timing constants.
- `lib/bot-signals.js`: shared E006 and rate-limit detection.
- `lib/control-commands.js`: start commands and mode mapping.
- `features/telegram-io.js`: open Telegram, verify the bot chat is open, send
  commands, rate-limit `/tn`, locate/inspect payment iframes, close the
  mini-app.
- `features/composer.js`: reusable Telegram message composer.
- `features/menu-request.js`: shared `/tn` menu request, bounded retries, and
  rate-limit handling for both features.
- `features/config.js`: centralized config defaults and validation.
- `features/agent-log.js`: console + file logging.
- `features/interactive-prompt.js`: wakeable terminal prompts.

`features/autobuy.js` and `features/autonangcap.js` remain as
backward-compatible entry-point shims. Keep feature behavior in the feature
trees and reusable browser/chat mechanics in `lib/` so a bug fix in one area
cannot accidentally overwrite another feature's orchestration.
