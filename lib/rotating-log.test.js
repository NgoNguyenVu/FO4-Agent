const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  appendRotating,
  readLogTail,
  readRotatedLogs,
  DEFAULT_MAX_FILES
} = require("./rotating-log");

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fo4-log-"));
  return path.join(dir, "agent.log");
}

test("rotating appender keeps current + 2 rotated files under the size cap", () => {
  const file = tempFile();
  const opts = { maxBytes: 100, maxFiles: DEFAULT_MAX_FILES };
  for (let i = 1; i <= 7; i += 1) {
    appendRotating(file, `line-${i}-${"x".repeat(20)}\n`, opts);
  }
  assert.equal(DEFAULT_MAX_FILES, 3);
  assert.equal(fs.existsSync(file), true);
  assert.equal(fs.existsSync(`${file}.1`), true);
  assert.equal(fs.existsSync(`${file}.2`), true);
  assert.equal(fs.existsSync(`${file}.3`), false, "only .1 and .2 are retained");
  for (const suffix of ["", ".1", ".2"]) {
    assert.ok(fs.statSync(`${file}${suffix}`).size <= 100);
  }
});

test("readLogTail returns only the tail and drops a partial first line", () => {
  const file = tempFile();
  const lines = [];
  for (let i = 0; i < 200; i += 1) lines.push(`[t] line ${i}`);
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  const tail = readLogTail(file, { maxBytes: 200 });
  assert.ok(tail.length <= 200);
  assert.equal(tail.startsWith("[t] line"), true, "partial first line was discarded");
  assert.match(tail, /line 199/);
});

test("readRotatedLogs merges .2 -> .1 -> current in chronological order", () => {
  const file = tempFile();
  fs.writeFileSync(`${file}.2`, "[t] oldest\n");
  fs.writeFileSync(`${file}.1`, "[t] middle\n");
  fs.writeFileSync(file, "[t] newest\n");
  const merged = readRotatedLogs(file);
  assert.equal(merged, "[t] oldest\n[t] middle\n[t] newest");
});

test("readLogTail returns empty string for a missing log", () => {
  assert.equal(readLogTail(path.join(os.tmpdir(), "fo4-log-missing-xyz")), "");
});
