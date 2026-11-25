const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  writeJsonAtomic,
  writeFileAtomic,
  cleanupStaleTmp
} = require("./atomic-file");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fo4-atomic-"));
}

test("writeJsonAtomic writes valid JSON and leaves no temp file", () => {
  const dir = tempDir();
  const file = path.join(dir, "workers.json");
  writeJsonAtomic(file, { workers: [{ feature: "buy" }] });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {
    workers: [{ feature: "buy" }]
  });
  const leftovers = fs.readdirSync(dir).filter((name) => name.includes(".tmp-"));
  assert.deepEqual(leftovers, []);
});

test("atomic write calls fsync before rename with a PID-scoped temp name", () => {
  const calls = [];
  const fakeFs = {
    mkdirSync: () => calls.push("mkdir"),
    openSync: (tmp, flag) => {
      calls.push(`open:${path.basename(tmp)}:${flag}`);
      return 7;
    },
    writeSync: () => calls.push("write"),
    fsyncSync: () => calls.push("fsync"),
    closeSync: () => calls.push("close"),
    renameSync: (tmp, target) => {
      calls.push(`rename:${path.basename(target)}`);
      assert.match(path.basename(tmp), new RegExp(`\\.tmp-${process.pid}-`));
    }
  };
  writeFileAtomic(path.join(tempDir(), "agent.lock"), "lock", { fsImpl: fakeFs });
  assert.equal(calls[0], "mkdir");
  assert.match(calls[1], /^open:agent\.lock\.tmp-\d+-/);
  assert.deepEqual(calls.slice(2), ["write", "fsync", "close", "rename:agent.lock"]);
  assert.ok(calls.indexOf("fsync") < calls.findIndex((c) => c.startsWith("rename:")));
});

test("cleanupStaleTmp removes only old, helper-generated temp files", () => {
  const dir = tempDir();
  const oldStamp = Date.now() - 120_000;
  const stale = path.join(dir, `heartbeat.json.tmp-${process.pid}-${oldStamp}-0-abc123`);
  const recent = path.join(dir, `workers.json.tmp-${process.pid}-${Date.now()}-1-def456`);
  const alive = path.join(dir, `agent.lock.tmp-999999-${oldStamp}-2-ghi789`);
  const other = path.join(dir, "keep.tmp");
  for (const file of [stale, recent, alive, other]) fs.writeFileSync(file, "x");
  assert.equal(cleanupStaleTmp(dir, { isAlive: (pid) => pid === 999999 }), 1);
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.existsSync(recent), true, "file đang ghi dở không bị xóa");
  assert.equal(fs.existsSync(alive), true, "file của process còn sống không bị xóa");
  assert.equal(fs.existsSync(other), true);
});
