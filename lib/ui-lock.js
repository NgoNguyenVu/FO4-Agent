// Khóa dùng chung cho các thao tác UI Telegram (composer, menu, mini-app).
//
// Khóa này tuần tự hóa các thao tác UI; các đoạn chỉ đọc chat phải nhả khóa.
function createUiLock({ name = "Telegram UI" } = {}) {
  let held = false;
  const waiters = [];

  function acquire() {
    if (!held) {
      held = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      waiters.push(resolve);
    });
  }

  // Trả về true nếu đã nhả khóa, false nếu khóa không ở trạng thái giữ.
  // Khi có waiter, chuyển quyền sở hữu trực tiếp để không có khe hở giữa
  // release và acquire của luồng kế tiếp.
  function release() {
    if (waiters.length) {
      const next = waiters.shift();
      next();
      return true;
    }
    if (!held) return false;
    held = false;
    return true;
  }

  async function withLock(fn) {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  return {
    name,
    acquire,
    release,
    withLock,
    isHeld: () => held,
    waitingCount: () => waiters.length
  };
}

module.exports = {
  createUiLock
};
