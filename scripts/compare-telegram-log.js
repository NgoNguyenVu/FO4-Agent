#!/usr/bin/env node
// So sánh telegram-chat.log với agent.log để đo độ trễ nhận lệnh và kiểm tra
// action tương ứng đã xảy ra chưa.
//
// Cách dùng:
//   node scripts/compare-telegram-log.js
//   node scripts/compare-telegram-log.js --agent <path> --chat <path>
//   node scripts/compare-telegram-log.js --json
"use strict";

const { compareLogFiles } = require("../lib/log-comparison");
const { logPath } = require("../lib/log-paths");
const { resolveChatLogPath } = require("../lib/telegram-chat-log");

function parseArgs(argv) {
  const options = { json: false, agentLogPath: logPath, chatLogPath: resolveChatLogPath() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--agent") options.agentLogPath = argv[++index];
    else if (arg === "--chat") options.chatLogPath = argv[++index];
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Tham số không hợp lệ: ${arg}`);
  }
  return options;
}

function formatMs(value) {
  if (value === null || value === undefined) return "-";
  if (value < 1_000) return `${value}ms`;
  return `${(value / 1_000).toFixed(value < 60_000 ? 2 : 1)}s`;
}

function printReport(report) {
  console.log(`Agent log : ${report.agentLogPath}`);
  console.log(`Chat log  : ${report.chatLogPath}`);
  console.log("");
  if (!report.commands.length) {
    console.log("Chưa có lệnh điều khiển nào trong telegram-chat.log.");
    return;
  }
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

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(
        "Cách dùng: node scripts/compare-telegram-log.js [--agent <path>] [--chat <path>] [--json]"
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

module.exports = { parseArgs, formatMs, printReport, main };
