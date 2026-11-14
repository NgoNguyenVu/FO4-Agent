#!/usr/bin/env node
// CLI vận hành cho worker registry (TASK-044).
//
// Bối cảnh: worker ở trạng thái `unknown` chặn mọi lần bắt đầu mới để tránh
// mua chồng sau crash. Trước đây muốn mở khóa phải sửa tay `workers.json` hoặc
// chạy một đoạn `node -e` dài. CLI này làm việc đó một cách an toàn:
//
//   node scripts/resolve-worker.js                 # liệt kê worker
//   node scripts/resolve-worker.js --resolve <id>  # unknown -> stopped
//   node scripts/resolve-worker.js --resolve-all   # resolve mọi unknown
//
// An toàn: nếu agent còn sống (process lock còn lease và pid còn tồn tại) CLI
// từ chối sửa state, vì resolve lúc bot đang chạy có thể dẫn tới mua chồng.
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createWorkerRegistry,
  defaultIsProcessAlive
} = require("../lib/worker-registry");

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_USAGE = 2;

const USAGE = `Cách dùng: node scripts/resolve-worker.js [tùy chọn]

Mặc định (không tham số): liệt kê worker trong registry.

Tùy chọn:
  --list                 Liệt kê worker (mặc định).
  --resolve <workerId>   Chuyển worker unknown -> stopped.
  --resolve-all          Chuyển mọi worker unknown -> stopped.
  --note <text>          Ghi chú lưu vào worker khi resolve.
                         Mặc định: "operator-verified-stopped".
  --state-dir <dir>      Thư mục chứa workers.json + agent.lock.
                         Mặc định: %LOCALAPPDATA%\\FO4PurchaseAgent\\state
  --json                 In kết quả dạng JSON (dùng cho script/CI).
  --help, -h             In hướng dẫn này.

Mã thoát:
  0  thành công
  1  lỗi nghiệp vụ (agent đang chạy, không tìm thấy worker, sai state)
  2  sai tham số

Lưu ý: dừng agent (Ctrl+C) và xác nhận trên Telegram không còn worker chạy
trước khi resolve. CLI sẽ tự từ chối nếu process lock còn hiệu lực.`;

function defaultStateDir() {
  return path.join(
    process.env.LOCALAPPDATA || os.homedir(),
    "FO4PurchaseAgent",
    "state"
  );
}

function parseArgs(argv) {
  const options = {
    action: "list",
    workerId: null,
    note: "operator-verified-stopped",
    stateDir: null,
    json: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw usageError(`Thiếu giá trị cho ${arg}.`);
      }
      index += 1;
      return value;
    };

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--list") {
      options.action = "list";
    } else if (arg === "--resolve") {
      options.action = "resolve";
      options.workerId = next();
    } else if (arg === "--resolve-all") {
      options.action = "resolve-all";
    } else if (arg === "--note") {
      options.note = next();
    } else if (arg === "--state-dir") {
      options.stateDir = next();
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw usageError(`Tham số không hợp lệ: ${arg}`);
    }
  }

  return options;
}

function usageError(message) {
  const error = new Error(message);
  error.code = "USAGE";
  return error;
}

function readJson(file) {
  try {
    const text = fs.readFileSync(file, "utf8");
    if (!text.trim()) return null;
    return JSON.parse(text);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`Không đọc được ${file}: ${error.message}`);
  }
}

function writeJsonAtomic(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

// Process lock còn "sống" khi lease chưa hết VÀ pid vẫn tồn tại. Chỉ dựa vào
// lease là chưa đủ: một pid đã chết vẫn có thể để lại lease trong tương lai.
function agentIsRunning(lockPath) {
  const lock = readJson(lockPath);
  if (!lock || typeof lock !== "object") return false;
  const leaseUntil = Number(lock.leaseUntil) || 0;
  if (leaseUntil <= Date.now()) return false;
  return defaultIsProcessAlive(lock.pid);
}

function describeWorker(worker) {
  return {
    workerId: worker.workerId,
    feature: worker.feature,
    concurrencyGroup: worker.concurrencyGroup || "exclusive",
    state: worker.state,
    reason: worker.reason || null,
    heartbeatAt: worker.heartbeatAt || null,
    startedAt: worker.startedAt || null
  };
}

function formatTable(workers) {
  if (!workers.length) return "Registry chưa có worker nào.";
  const header = ["workerId", "feature", "group", "state", "reason"];
  const rows = workers.map((worker) => [
    worker.workerId,
    worker.feature,
    worker.concurrencyGroup,
    worker.state,
    worker.reason || "-"
  ]);
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => String(row[column]).length))
  );
  const line = (row) =>
    row
      .map((cell, column) => String(cell).padEnd(widths[column]))
      .join("  ")
      .trimEnd();
  return [line(header), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)].join(
    "\n"
  );
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`${error.message}\n`);
    console.error(USAGE);
    return EXIT_USAGE;
  }

  if (options.help) {
    console.log(USAGE);
    return EXIT_OK;
  }

  const stateDir = options.stateDir
    ? path.resolve(options.stateDir)
    : defaultStateDir();
  const statePath = path.join(stateDir, "workers.json");
  const lockPath = path.join(stateDir, "agent.lock");

  let snapshot;
  try {
    snapshot = readJson(statePath);
  } catch (error) {
    console.error(error.message);
    return EXIT_ERROR;
  }

  const workers = Array.isArray(snapshot?.workers)
    ? snapshot.workers.map(describeWorker)
    : [];
  const unknown = workers.filter((worker) => worker.state === "unknown");
  const running = agentIsRunning(lockPath);

  if (options.action === "list") {
    if (options.json) {
      console.log(
        JSON.stringify(
          { statePath, lockPath, agentRunning: running, workers },
          null,
          2
        )
      );
      return EXIT_OK;
    }
    console.log(`Registry: ${statePath}`);
    if (!fs.existsSync(statePath)) {
      console.log("Chưa có file worker state (agent chưa từng chạy hoặc đã xóa).");
      return EXIT_OK;
    }
    console.log(formatTable(workers));
    if (running) {
      console.log(
        "\nAgent đang chạy (process lock còn hiệu lực). Dừng agent trước khi resolve."
      );
    } else if (unknown.length) {
      console.log(
        `\n${unknown.length} worker đang unknown. Sau khi xác nhận trên Telegram ` +
          "không còn worker chạy:\n" +
          `  node scripts/resolve-worker.js --resolve <workerId>\n` +
          "hoặc resolve tất cả:\n" +
          "  node scripts/resolve-worker.js --resolve-all"
      );
    }
    return EXIT_OK;
  }

  // Từ đây trở đi là thao tác ghi state.
  if (running) {
    console.error(
      "Từ chối resolve: agent vẫn đang chạy (process lock còn hiệu lực).\n" +
        "Dừng agent bằng Ctrl+C, xác nhận trên Telegram không còn worker, rồi chạy lại."
    );
    return EXIT_ERROR;
  }

  // CLI không phải agent: giữ nguyên block process cũ thay vì ghi pid của CLI
  // vào state (registry.saveState luôn cập nhật process theo instance hiện tại).
  const previousProcess = snapshot?.process || null;
  const registry = createWorkerRegistry({
    statePath,
    lockPath,
    log: () => {},
    logError: (message) => console.error(message)
  });

  const resolved = [];
  try {
    if (options.action === "resolve") {
      resolved.push(registry.resolveUnknown(options.workerId, options.note));
    } else if (options.action === "resolve-all") {
      if (!unknown.length) {
        if (options.json) {
          console.log(
            JSON.stringify(
              { statePath, lockPath, resolved: [], message: "no-unknown-worker" },
              null,
              2
            )
          );
        } else {
          console.log("Không có worker unknown; không cần resolve.");
        }
        return EXIT_OK;
      }
      for (const worker of unknown) {
        resolved.push(registry.resolveUnknown(worker.workerId, options.note));
      }
    }
  } catch (error) {
    console.error(error.message);
    return EXIT_ERROR;
  }

  if (previousProcess) {
    const written = readJson(statePath);
    if (written && typeof written === "object") {
      writeJsonAtomic(statePath, { ...written, process: previousProcess });
    }
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        { statePath, lockPath, resolved: resolved.map(describeWorker) },
        null,
        2
      )
    );
  } else {
    for (const worker of resolved) {
      console.log(
        `Đã resolve ${worker.workerId} (${worker.feature}): unknown -> stopped (${worker.reason}).`
      );
    }
    console.log("Khởi động lại agent và gửi /startagent khi đã sẵn sàng.");
  }
  return EXIT_OK;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { main, parseArgs, agentIsRunning, defaultStateDir };
