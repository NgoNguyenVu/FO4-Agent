#!/usr/bin/env node
// So sánh telegram-chat.log với agent.log để đo độ trễ nhận lệnh và kiểm tra
// action tương ứng đã xảy ra chưa.
//
// Cách dùng:
//   node scripts/compare-telegram-log.js
//   node scripts/compare-telegram-log.js --agent <path> --chat <path>
//   node scripts/compare-telegram-log.js --session
//   node scripts/compare-telegram-log.js --since "2026-11-18 00:00:00"
//   node scripts/compare-telegram-log.js --json
"use strict";

const { compareLogFiles, parseTimeValue } = require("../lib/log-comparison");
const { logPath } = require("../lib/log-paths");
const { resolveChatLogPath } = require("../lib/telegram-chat-log");
const os = require("node:os");
const path = require("node:path");

function parseArgs(argv) {
  const options = {
    json: false,
    session: false,
    sinceMs: null,
    untilMs: null,
    agentLogPath: logPath,
    chatLogPath: resolveChatLogPath()
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--session") options.session = true;
    else if (arg === "--since") options.sinceMs = parseTimeValue(argv[++index], "--since");
    else if (arg === "--until") options.untilMs = parseTimeValue(argv[++index], "--until");
    else if (arg === "--agent") options.agentLogPath = argv[++index];
    else if (arg === "--chat") options.chatLogPath = argv[++index];
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Tham số không hợp lệ: ${arg}`);
  }
  return options;
}

function displayLogPath(filePath) {
  const value = String(filePath || "");
  const local = path.join(process.env.LOCALAPPDATA || os.homedir(), "FO4PurchaseAgent");
  if (value.startsWith(local)) return value.replace(local, "%LOCALAPPDATA%\\FO4PurchaseAgent");
  const home = os.homedir();
  if (home && value.startsWith(home)) return value.replace(home, "%USERPROFILE%");
  return value;
}

function formatMs(value) {
  if (value === null || value === undefined) return "-";
  if (value < 1_000) return `${value}ms`;
  return `${(value / 1_000).toFixed(value < 60_000 ? 2 : 1)}s`;
}

function formatUtcTimestamp(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (part) => String(part).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`
  );
}

function describeRange(range = {}) {
  if (range.session && !range.sessionStart) {
    return "toàn bộ log (chưa tìm thấy /startagent)";
  }
  if (range.session && range.sessionStart) {
    const until = range.until ? ` đến ${formatUtcTimestamp(range.until)}` : "";
    return `phiên từ /startagent lúc ${formatUtcTimestamp(range.sessionStart)}${until}`;
  }
  if (range.since && range.until) {
    return `từ ${formatUtcTimestamp(range.since)} đến ${formatUtcTimestamp(range.until)}`;
  }
  if (range.since) return `từ ${formatUtcTimestamp(range.since)} đến cuối log`;
  if (range.until) return `từ đầu log đến ${formatUtcTimestamp(range.until)}`;
  return "toàn bộ log";
}

function formatIconStats(report) {
  const stats = report.iconStats;
  if (!stats) return [];
  const purchase = stats.purchase;
  const cancel = stats.cancel;
  const upgrade = stats.upgrade;
  const inventory = stats.inventory;
  const lines = [
    "",
    "Thống kê ICON & nâng cấp",
    "------------------------------------------------------------",
    `Phạm vi     : ${describeRange(report.range)}`,
    `Đặt mua ICON: ${purchase.orders} lượt thành công / ${purchase.cards} thẻ ` +
      `(${purchase.uniquePlayers} cầu thủ); ${purchase.requests} lệnh yêu cầu / ` +
      `${purchase.requestCards} thẻ`,
    `Hủy ICON    : ${cancel.orders} đơn / ${cancel.cards} thẻ (${cancel.uniquePlayers} cầu thủ)`,
    upgrade.successes === 0
      ? `Nâng cấp +7 : 0 (chưa có); ${upgrade.attempts} lượt thử`
      : `Nâng cấp +7 : ${upgrade.successes} lượt thành công / ${upgrade.uniquePlayers} cầu thủ; ` +
        `${upgrade.attempts} lượt thử`
  ];
  if (
    !report.range?.session &&
    !report.range?.since &&
    !report.range?.until &&
    (report.range?.sessionCount ?? 0) > 1
  ) {
    lines.splice(
      4,
      0,
      `Gợi ý       : log có ${report.range.sessionCount} phiên /startagent; ` +
        "thêm --session để chỉ xem phiên mới nhất."
    );
  }
  if (inventory && inventory.found) {
    const details =
      inventory.upgradable === null
        ? "(không có chi tiết)"
        : `(${inventory.upgradable} còn nâng được, ${inventory.locked} khóa, ` +
          `${inventory.reached7} đã đạt +7)`;
    lines.push(
      `Kho ICON    : ${inventory.total} icon tại ${formatUtcTimestamp(inventory.at)} ${details}`
    );
  } else {
    lines.push("Kho ICON    : chưa có dữ liệu kiểm tra kho");
  }
  return lines;
}

function printReport(report) {
  console.log(`Agent log : ${displayLogPath(report.agentLogPath)}`);
  console.log(`Chat log  : ${displayLogPath(report.chatLogPath)}`);
  console.log("");
  if (!report.commands.length) {
    console.log("Chưa có lệnh điều khiển nào trong telegram-chat.log.");
  } else {
    console.log("Thời điểm lệnh           Lệnh         Nhận sau   Action sau  Trạng thái");
    console.log("--------------------------------------------------------------------------");
    for (const item of report.commands) {
      const sent = item.sentAt.replace("T", " ").replace("Z", "Z");
      const status =
        item.reason === "ok"
          ? "khớp"
          : item.reason === "no-ack"
            ? "agent chưa nhận"
            : "nhận nhưng không action";
      console.log(
        `${sent.padEnd(24)} ${item.command.padEnd(12)} ` +
          `${formatMs(item.latencyMs).padEnd(10)} ${formatMs(item.actionLatencyMs).padEnd(11)} ${status}`
      );
      if (item.ackMessage) console.log(`  ↳ ack   : ${item.ackMessage}`);
      if (item.actionMessage && item.actionMessage !== item.ackMessage) {
        console.log(`  ↳ action: ${item.actionMessage}`);
      }
    }
    const { summary } = report;
    console.log("");
    console.log(
      `Tổng ${summary.total} lệnh: ${summary.matched} khớp, ${summary.unmatched} chưa khớp; ` +
        `độ trễ nhận trung bình ${formatMs(summary.averageLatencyMs)}, ` +
        `cao nhất ${formatMs(summary.maxLatencyMs)}.`
    );
  }
  for (const line of formatIconStats(report)) console.log(line);
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(
        [
          "Cách dùng: node scripts/compare-telegram-log.js [--agent <path>] [--chat <path>]",
          "           [--session] [--since <thời gian>] [--until <thời gian>] [--json]",
          "",
          "  --session       Chỉ tính từ lần /startagent gần nhất trong chat log.",
          '  --since <time>  Chỉ tính từ mốc thời gian (ISO hoặc "YYYY-MM-DD HH:mm:ss";',
          "                  không kèm múi giờ thì hiểu là giờ máy).",
          "  --until <time>  Chỉ tính đến mốc thời gian.",
          "  --json          Xuất JSON đầy đủ (gồm cả iconStats)."
        ].join("\n")
      );
      return;
    }
    const report = compareLogFiles(options);
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else printReport(report);
  } catch (error) {
    console.error(`Không đối chiếu được log: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  parseArgs,
  displayLogPath,
  formatMs,
  formatUtcTimestamp,
  describeRange,
  formatIconStats,
  printReport,
  main
};
