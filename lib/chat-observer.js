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
    const waiters = new Set();
    const pendingCommands = [];
    let commandHandler = () => {};

    return {
      snapshot: () => ({ text: latestText, version }),
      publish(text) {
        if (text === latestText) return;
        const previousText = latestText;
        const appendedText = getFreshSince(previousText, text);
        latestText = text;
        version += 1;
        if (armed) {
          const commands = appendedText
            ? controlCommandMatches(appendedText)
            : !text.includes(previousText)
              ? getNewTailCommands(previousText, text)
              : [];
          pendingCommands.push(...commands);
          commands.forEach(commandHandler);
        }
        for (const waiter of [...waiters]) {
          if (version <= waiter.afterVersion) continue;
          clearTimeout(waiter.timer);
          waiters.delete(waiter);
          waiter.resolve({ text: latestText, version });
        }
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

  async function observe(page, onCommand = () => {}) {
    const name = `__fo4ChatTextChanged${bindingId++}`;
    const tracker = createTracker(await withTimeout(page.locator("body").innerText(), playwrightTimeoutMs, "đọc chat ban đầu"));
    tracker.setCommandHandler(onCommand);
    await withTimeout(page.exposeFunction(name, (text) => tracker.publish(text)), playwrightTimeoutMs, "gắn theo dõi chat");
    await withTimeout(scrollChatToBottom(page), playwrightTimeoutMs, "cuộn chat Telegram");
    await withTimeout(page.evaluate((binding) => {
      let timer;
      const notify = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (document.body && typeof window[binding] === "function") window[binding](document.body.innerText);
        }, 75);
      };
      if (!document.documentElement || !document.body) throw new Error("Không thể gắn bộ theo dõi chat.");
      new MutationObserver(notify).observe(document.documentElement, { childList: true, characterData: true, subtree: true });
      notify();
      window[binding](document.body.innerText);
    }, name), playwrightTimeoutMs, "cài quan sát DOM");
    readers.set(page, tracker);
    return tracker;
  }

  return { createTracker, waitForChange, waitForSettle, observe };
}

module.exports = { createChatObserver };
