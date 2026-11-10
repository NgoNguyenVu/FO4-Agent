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

function isClosedSessionError(error) {
  return CLOSED_SESSION_RE.test(error?.message || "");
}

function createChatObserver({ playwrightTimeoutMs, pollIntervalMs, readers }) {
  let bindingId = 0;

  function createTracker(initialText = "") {
    let latestText = initialText;
    let version = 0;
    let armed = false;
    // Sau khi tải lại trang, text có thể nhảy từ màn hình "Chats" sang cả lịch
    // sử chat. Bỏ quét lệnh đúng một lần để không nhặt lại /stopagent cũ trong
    // đuôi chat và dừng luồng oan.
    let skipNextCommandScan = false;
    const waiters = new Set();
    const pendingCommands = [];
    let commandHandler = () => {};

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
      publish(text) {
        if (text === latestText) return;
        const previousText = latestText;
        const appendedText = getFreshSince(previousText, text);
        latestText = text;
        version += 1;
        if (armed && !skipNextCommandScan) {
          const commands = appendedText
            ? controlCommandMatches(appendedText)
            : !text.includes(previousText)
              ? getNewTailCommands(previousText, text)
              : [];
          pendingCommands.push(...commands);
          commands.forEach(commandHandler);
        }
        skipNextCommandScan = false;
        notifyWaiters();
      },
      // Đặt lại mốc text sau khi trang reload mà không coi phần chênh lệch là
      // lệnh mới. Lần publish kế tiếp cũng bỏ quét lệnh (xem skipNextCommandScan).
      reset(text) {
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
    return withTimeout(page.evaluate((name) => {
      if (!document.documentElement || !document.body) {
        throw new Error("Không thể gắn bộ theo dõi chat.");
      }
      if (typeof window[name] !== "function") return false;
      let timer;
      const notify = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (document.body && typeof window[name] === "function") window[name](document.body.innerText);
        }, 75);
      };
      new MutationObserver(notify).observe(document.documentElement, {
        childList: true,
        characterData: true,
        subtree: true
      });
      notify();
      return true;
    }, binding), playwrightTimeoutMs, "cài quan sát DOM");
  }

  async function observe(page, onCommand = () => {}) {
    const name = `__fo4ChatTextChanged${bindingId++}`;
    const tracker = createTracker(await withTimeout(page.locator("body").innerText(), playwrightTimeoutMs, "đọc chat ban đầu"));
    tracker.setCommandHandler(onCommand);
    tracker.binding = name;
    await withTimeout(page.exposeFunction(name, (text) => tracker.publish(text)), playwrightTimeoutMs, "gắn theo dõi chat");
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
      if (typeof tracker.reset === "function") tracker.reset(text);
      else tracker.publish(text);
    } catch { /* lần đọc kế tiếp sẽ bù */ }
    return true;
  }

  return { createTracker, waitForChange, waitForSettle, observe, reattach };
}

module.exports = { createChatObserver };
