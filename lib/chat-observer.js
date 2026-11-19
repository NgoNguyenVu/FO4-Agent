const {
  withTimeout,
  CLOSED_SESSION_RE,
  toNavigationError
} = require("./playwright-utils");
const { scrollChatToBottom } = require("./chat-scroll");
const {
  getFreshSince,
  controlCommandMatches,
  getNewTailCommands
} = require("./text-utils");
const {
  CHAT_MESSAGE_SELECTOR,
  directionForMessage,
  logTelegramMessage,
  normalizeContent
} = require("./telegram-chat-log");

function isClosedSessionError(error) {
  return CLOSED_SESSION_RE.test(error?.message || "");
}

function createChatObserver({ playwrightTimeoutMs, pollIntervalMs, readers }) {
  let bindingId = 0;

  function createTracker(initialText = "", initialMessageIds = null) {
    let latestText = initialText;
    let version = 0;
    let armed = false;
    // Sau khi tải lại trang, text có thể nhảy từ màn hình "Chats" sang cả lịch
    // sử chat. Chỉ bỏ quét suy đoán "đuôi chat" đúng một lần để không nhặt lại
    // /stopagent cũ; phần text nối thêm vẫn được quét nên lệnh mới gửi ngay
    // sau reload không bị nuốt.
    let skipNextCommandScan = false;
    const waiters = new Set();
    const pendingCommands = [];
    // ID các bubble đã thấy. Lần publish đầu tiên chỉ lấy mốc (baseline) để
    // không ghi lại toàn bộ lịch sử chat vào telegram-chat.log.
    const seenMessageIds = new Set();
    // ID bubble đã có ngay lúc tạo tracker. Dùng thay cho "bỏ toàn bộ batch
    // đầu": nếu Telegram render chat chậm, batch đầu tiên có thể đã chứa lệnh
    // /startagent mới gửi. So id sẽ giữ lịch sử cũ nhưng vẫn ghi lệnh mới.
    const initialIds = initialMessageIds
      ? new Set([...initialMessageIds].map(String))
      : null;
    let messageBaselineReady = false;
    // Telegram Web K có lúc render bubble tạm (optimistic) rồi bubble thật với
    // data-mid khác nhưng cùng nội dung, cách nhau ~100ms. Chỉ chống trùng cho
    // tin IN trong cửa sổ ngắn; tin OUT của bot giữ nguyên vì có thể là hai
    // thông báo thật giống nhau.
    const IN_DEDUPE_MS = 2_000;
    const recentInMessages = new Map();
    // Tên lệnh điều khiển đã ghi từ bubble DOM trong cửa sổ ngắn. Dùng để
    // không ghi trùng khi cùng lệnh vừa được phát hiện từ text (và ngược lại).
    const recentLoggedCommands = new Map();
    let commandHandler = () => {};

    function pruneRecent(map, now) {
      for (const [key, at] of map) {
        if (now - at > IN_DEDUPE_MS) map.delete(key);
      }
    }

    function rememberLoggedCommands(content, now) {
      for (const command of controlCommandMatches(content)) {
        recentLoggedCommands.set(command, now);
      }
    }

    // Ghi lệnh phát hiện từ text nếu bubble DOM chưa ghi lệnh đó. Telegram Web K
    // có lúc cập nhật body text trước khi bubble kịp có data-mid/nội dung, nên
    // "có messages" không bảo đảm lệnh đã được log.
    function logCommandIfNeeded(command, now) {
      pruneRecent(recentLoggedCommands, now);
      const loggedAt = recentLoggedCommands.get(command);
      if (loggedAt !== undefined && now - loggedAt <= IN_DEDUPE_MS) return null;
      const content = `/${command}`;
      const line = logTelegramMessage("IN", content);
      if (line) {
        recentLoggedCommands.set(command, now);
        // Để bubble DOM của cùng lệnh xuất hiện ở publish sau không bị ghi
        // trùng lần nữa.
        recentInMessages.set(content, now);
      }
      return line;
    }

    function logNewMessages(messages) {
      let logged = 0;
      const now = Date.now();
      pruneRecent(recentInMessages, now);
      for (const message of messages) {
        const id = message && message.id != null ? String(message.id) : "";
        if (!id || seenMessageIds.has(id)) continue;
        seenMessageIds.add(id);
        if (!messageBaselineReady) {
          // Không đọc được id baseline (DOM đổi cấu trúc) thì giữ hành vi cũ:
          // bỏ batch đầu để tránh ghi lại cả lịch sử.
          if (!initialIds || initialIds.has(id)) continue;
        }
        const direction = directionForMessage(message);
        const content = normalizeContent(message.text);
        if (direction === "IN" && content) {
          // Lệnh vừa được ghi từ fallback text (bubble chưa kịp render) thì
          // bubble xuất hiện ở publish sau không được ghi trùng.
          const commandsInContent = controlCommandMatches(content);
          if (
            commandsInContent.length &&
            commandsInContent.every((command) => {
              const loggedAt = recentLoggedCommands.get(command);
              return (
                loggedAt !== undefined && now - loggedAt <= IN_DEDUPE_MS
              );
            })
          ) {
            continue;
          }
        }
        if (
          direction === "IN" &&
          content &&
          recentInMessages.has(content) &&
          now - recentInMessages.get(content) <= IN_DEDUPE_MS
        ) {
          continue;
        }
        const line = logTelegramMessage(direction, message.text);
        if (line) {
          logged += 1;
          if (direction === "IN" && content) {
            recentInMessages.set(content, now);
            rememberLoggedCommands(content, now);
          }
        }
      }
      messageBaselineReady = messageBaselineReady || messages.length > 0;
      return logged;
    }

    function notifyWaiters() {
      for (const waiter of [...waiters]) {
        if (version <= waiter.afterVersion) continue;
        clearTimeout(waiter.timer);
        waiters.delete(waiter);
        waiter.resolve({ text: latestText, version });
      }
    }

    return {
      snapshot: () => ({ text: latestText, version }),
      publish(text, messages) {
        // Log hội thoại trước khi so text: bubble mới có thể xuất hiện dù
        // body text chưa đổi (Telegram đang render), và lần publish đầu tiên
        // chỉ dùng để lấy mốc lịch sử.
        if (Array.isArray(messages)) logNewMessages(messages);
        if (text === latestText) return;
        const previousText = latestText;
        const appendedText = getFreshSince(previousText, text);
        latestText = text;
        version += 1;
        if (armed) {
          let commands = [];
          if (appendedText) {
            // Text nối thêm chắc chắn là mới, kể cả ngay sau reload.
            commands = controlCommandMatches(appendedText);
          } else if (!text.includes(previousText) && !skipNextCommandScan) {
            // Snapshot bị thay hẳn: chỉ đoán lệnh mới trong đuôi khi không
            // phải lần đồng bộ đầu tiên sau reload.
            commands = getNewTailCommands(previousText, text);
          }
          if (commands.length) {
            const now = Date.now();
            pendingCommands.push(...commands);
            // Luôn ghi lệnh đã phát hiện ra telegram-chat.log, kể cả khi batch
            // messages có bubble khác nhưng thiếu bubble lệnh (Telegram render
            // text trước khi bubble kịp có data-mid). Bỏ qua nếu bubble lệnh
            // đã được log ở logNewMessages phía trên.
            for (const command of commands) logCommandIfNeeded(command, now);
            commands.forEach(commandHandler);
          }
        }
        skipNextCommandScan = false;
        notifyWaiters();
      },
      // Đặt lại mốc text sau khi trang reload mà không coi phần chênh lệch là
      // lệnh mới. Vẫn ghi các bubble mới xuất hiện trong lúc mất observer
      // (vd /startagent gửi đúng lúc reload) nhưng không quét lại text.
      reset(text, messages) {
        if (Array.isArray(messages)) logNewMessages(messages);
        latestText = text;
        version += 1;
        skipNextCommandScan = true;
        notifyWaiters();
      },
      arm: () => { armed = true; },
      setCommandHandler: (handler) => { commandHandler = handler; },
      takeCommands: () => pendingCommands.splice(0),
      takeCommandsMatching(commands) {
        const accepted = new Set(commands);
        const selected = [];
        const retained = [];
        for (const command of pendingCommands) {
          (accepted.has(command) ? selected : retained).push(command);
        }
        pendingCommands.splice(0, pendingCommands.length, ...retained);
        return selected;
      },
      takeNextCommand: () => pendingCommands.shift() || null,
      takeCommand(command) {
        const index = pendingCommands.indexOf(command);
        return index < 0 ? null : pendingCommands.splice(index, 1)[0];
      },
      hasCommand: (command) => pendingCommands.includes(command),
      waitForChange(afterVersion, timeoutMs) {
        if (version > afterVersion) {
          return Promise.resolve({ text: latestText, version });
        }
        return new Promise((resolve) => {
          const waiter = {
            afterVersion,
            resolve,
            timer: setTimeout(() => {
              waiters.delete(waiter);
              resolve(null);
            }, timeoutMs)
          };
          waiters.add(waiter);
        });
      }
    };
  }

  // Đọc lại DOM theo nhịp có backoff. Đây là watchdog cho trường hợp
  // MutationObserver không bắt được thay đổi (Telegram re-render/iframe).
  async function waitForChange(page, reader, afterVersion, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let quietStreak = 0;
    while (Date.now() < deadline) {
      try {
        await withTimeout(scrollChatToBottom(page), playwrightTimeoutMs, "cuộn chat Telegram");
      } catch (error) {
        if (isClosedSessionError(error)) return null;
        throw error;
      }
      const snapshot = reader.snapshot();
      if (snapshot.version > afterVersion) return snapshot;
      const remaining = deadline - Date.now();
      const backoff = Math.min(pollIntervalMs * 2 ** quietStreak, 5000, remaining);
      const update = await reader.waitForChange(afterVersion, backoff);
      if (update) return update;
      const before = reader.snapshot().version;
      try {
        await withTimeout(scrollChatToBottom(page), playwrightTimeoutMs, "cuộn chat Telegram");
      } catch (error) {
        if (isClosedSessionError(error)) return null;
        throw error;
      }
      try {
        if (page.keyboard && typeof page.keyboard.press === "function") {
          await withTimeout(page.keyboard.press("End"), 5_000, "đưa chat về tin mới nhất");
        }
      } catch (error) {
        if (isClosedSessionError(error)) return null;
        throw toNavigationError(error);
      }
      let bodyText;
      try {
        bodyText = await withTimeout(page.locator("body").innerText(), playwrightTimeoutMs, "đọc chat Telegram");
      } catch (error) {
        if (isClosedSessionError(error)) return null;
        throw toNavigationError(error);
      }
      reader.publish(bodyText);
      const refreshed = reader.snapshot();
      if (refreshed.version > afterVersion) return refreshed;
      quietStreak = refreshed.version === before ? quietStreak + 1 : 0;
    }
    return null;
  }

  async function waitForSettle(reader, quietMs, timeoutMs, page = null) {
    const deadline = Date.now() + timeoutMs;
    let snapshot = reader.snapshot();
    let lastChangeAt = Date.now();
    while (Date.now() < deadline) {
      const remaining = quietMs - (Date.now() - lastChangeAt);
      if (remaining <= 0) return snapshot;
      const update = page
        ? await waitForChange(page, reader, snapshot.version, Math.min(remaining, deadline - Date.now()))
        : await reader.waitForChange(snapshot.version, Math.min(remaining, deadline - Date.now()));
      if (update) {
        snapshot = update;
        lastChangeAt = Date.now();
      }
    }
    throw new Error(`Nội dung chat Telegram vẫn thay đổi sau ${timeoutMs / 1000} giây.`);
  }

  // Cài MutationObserver trỏ tới binding đã expose. Tách khỏi observe() để có
  // thể gắn lại sau khi Telegram Web bị reload: document mới làm mất observer,
  // còn binding của Playwright vẫn được cài lại cho mọi document mới.
  async function installObserver(page, binding) {
    return withTimeout(page.evaluate(({ name, messageSelector }) => {
      if (!document.documentElement || !document.body) {
        throw new Error("Không thể gắn bộ theo dõi chat.");
      }
      if (typeof window[name] !== "function") return false;
      // Đọc bubble kèm hướng: is-out = tin của tài khoản đang đăng nhập.
      // Bọc try/catch để lỗi DOM không làm hỏng watchdog đọc chat.
      const collectMessages = () => {
        try {
          return [...document.querySelectorAll(messageSelector)]
            .map((element) => ({
              id: element.getAttribute("data-mid"),
              text: element.querySelector(".message")?.innerText || "",
              out: element.classList.contains("is-out")
            }))
            .filter((message) => message.id);
        } catch {
          return [];
        }
      };
      let timer;
      const notify = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (document.body && typeof window[name] === "function") {
            window[name](document.body.innerText, collectMessages());
          }
        }, 75);
      };
      new MutationObserver(notify).observe(document.documentElement, {
        childList: true,
        characterData: true,
        subtree: true
      });
      notify();
      return true;
    }, { name: binding, messageSelector: CHAT_MESSAGE_SELECTOR }), playwrightTimeoutMs, "cài quan sát DOM");
  }

  // Đọc bubble đang hiển thị kèm hướng. Dùng chung cho baseline lúc mở chat
  // và lúc đồng bộ sau reload. Best-effort: DOM chưa render/đổi cấu trúc thì
  // trả null.
  async function readVisibleMessages(page) {
    try {
      const messages = await withTimeout(
        page.evaluate(
          ({ messageSelector }) =>
            [...document.querySelectorAll(messageSelector)]
              .map((element) => ({
                id: element.getAttribute("data-mid"),
                text: element.querySelector(".message")?.innerText || "",
                // Telegram Web K gắn is-out lên chính bubble của tài khoản
                // đang đăng nhập (bubbles.ts: bubble.classList.add('bubble',
                // isOut ? 'is-out' : 'is-in')).
                out: element.classList.contains("is-out")
              }))
              .filter((message) => message.id),
          { messageSelector: CHAT_MESSAGE_SELECTOR }
        ),
        playwrightTimeoutMs,
        "đọc tin nhắn hiển thị"
      );
      return Array.isArray(messages) ? messages : null;
    } catch {
      return null;
    }
  }

  // Chụp id các bubble đang có trước khi gắn observer. Best-effort: DOM chưa
  // render xong hoặc Telegram đổi cấu trúc thì trả null để dùng baseline cũ.
  // Chỉ đọc attribute (không đọc innerText) để không làm chậm lúc mở chat.
  async function readVisibleMessageIds(page) {
    try {
      const ids = await withTimeout(
        page.evaluate(
          ({ messageSelector }) =>
            [...document.querySelectorAll(messageSelector)]
              .map((element) => element.getAttribute("data-mid"))
              .filter(Boolean),
          { messageSelector: CHAT_MESSAGE_SELECTOR }
        ),
        playwrightTimeoutMs,
        "đọc id tin nhắn ban đầu"
      );
      return Array.isArray(ids) ? ids.map(String) : null;
    } catch {
      return null;
    }
  }

  async function observe(page, onCommand = () => {}) {
    const name = `__fo4ChatTextChanged${bindingId++}`;
    const initialText = await withTimeout(page.locator("body").innerText(), playwrightTimeoutMs, "đọc chat ban đầu");
    const initialMessageIds = await readVisibleMessageIds(page);
    const tracker = createTracker(initialText, initialMessageIds);
    tracker.setCommandHandler(onCommand);
    tracker.binding = name;
    await withTimeout(page.exposeFunction(name, (text, messages) => tracker.publish(text, messages)), playwrightTimeoutMs, "gắn theo dõi chat");
    await withTimeout(scrollChatToBottom(page), playwrightTimeoutMs, "cuộn chat Telegram");
    if (!(await installObserver(page, name))) {
      throw new Error("Không thể gắn bộ theo dõi chat.");
    }
    readers.set(page, tracker);
    return tracker;
  }

  // Gắn lại MutationObserver sau khi trang Telegram reload, giữ nguyên tracker
  // (lịch sử text + lệnh đang chờ) để luồng ICON đang giữ reader cũ vẫn đọc được
  // "Vị trí mua" và vẫn nhận /stopagent, /resetagent.
  // Đồng thời đọc lại bubble đang hiển thị: lệnh điều khiển gửi đúng lúc mất
  // observer (vd /startagent) phải được ghi vào telegram-chat.log.
  // Trả về null nếu page chưa có tracker, false nếu không cài lại được.
  async function reattach(page) {
    const tracker = readers.get(page);
    if (!tracker) return null;
    if (!tracker.binding) return false;
    if (!(await installObserver(page, tracker.binding))) return false;
    await withTimeout(scrollChatToBottom(page), playwrightTimeoutMs, "cuộn chat Telegram");
    try {
      const text = await withTimeout(
        page.locator("body").innerText(),
        playwrightTimeoutMs,
        "đọc chat sau khi tải lại"
      );
      const messages = await readVisibleMessages(page);
      if (typeof tracker.reset === "function") tracker.reset(text, messages);
      else tracker.publish(text, messages || undefined);
    } catch { /* lần đọc kế tiếp sẽ bù */ }
    return true;
  }

  return { createTracker, waitForChange, waitForSettle, observe, reattach };
}

module.exports = { createChatObserver };
