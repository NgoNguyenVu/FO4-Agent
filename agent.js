const { runAgent } = require("./features/controller");

// `runAgent()` chạy vòng điều khiển nội bộ (main) và tự xử lý mọi lỗi có thể
// phục hồi (E006, mất session, timeout...) ngay trong vòng lặp của nó. Vì vậy nó
// chỉ reject với lỗi phát sinh lúc khởi động (cấu hình sai, không mở được
// trình duyệt...). Ở đây retry có giới hạn đúng những lỗi đó rồi mới bỏ cuộc,
// tránh vòng lặp vô hạn khi lỗi là cố định (vd config sai).
const MAX_STARTUP_RETRIES = 3;

async function main() {
  for (let attempt = 0; attempt <= MAX_STARTUP_RETRIES; attempt += 1) {
    try {
      await runAgent();
      return;
    } catch {
      // Lỗi đã được runAgent ghi log; ở đây chỉ quyết định thử lại.
      if (attempt === MAX_STARTUP_RETRIES) break;
      console.log(`Restarting agent (lần ${attempt + 1}/${MAX_STARTUP_RETRIES}) sau 10 giây...`);
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }
  process.exitCode = 1;
}

main();
