const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCANNER = path.resolve(__dirname, "check-secrets.js");

function runScanner(dir, args = []) {
  const result = spawnSync(process.execPath, [SCANNER, ...args], {
    cwd: dir,
    encoding: "utf8"
  });
  assert.equal(result.error ?? null, null);
  return result;
}

function createTempRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fo4-secret-scan-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "FO4 QA"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "qa@fo4.local"], { cwd: dir });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: dir });
  return dir;
}

function git(dir, args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" });
}

function writeFile(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

function commitAll(dir, message) {
  git(dir, ["add", "-A"]);
  execFileSync("git", ["commit", "-m", message], { cwd: dir, encoding: "utf8" });
}

function expectClean(result) {
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes("Secret scan passed"));
}

function expectFinding(result, rule) {
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("Secret scan failed"));
  assert.ok(result.stderr.includes(rule));
}

test("secret scanner passes for a clean tracked file", (t) => {
  const dir = createTempRepo(t);
  writeFile(dir, "src/app.js", "console.log('clean file');\n");
  commitAll(dir, "init");

  expectClean(runScanner(dir, []));
});

test("secret scanner fails for an internal FO4 endpoint", (t) => {
  const dir = createTempRepo(t);
  const host = "myapp" + ".ngrok" + ".io";
  writeFile(dir, "src/tunnel.js", `const host = "${host}";\n`);
  commitAll(dir, "init");

  expectFinding(runScanner(dir, []), "internal FO4 endpoint");
});

test("secret scanner fails for a customer token refresh endpoint", (t) => {
  const dir = createTempRepo(t);
  const refreshEndpoint = "/api/" + "v1" + "/customer" + "/refresh-" + "token";
  writeFile(dir, "src/auth.js", `fetch(${JSON.stringify(refreshEndpoint)});\n`);
  commitAll(dir, "init");

  expectFinding(runScanner(dir, []), "customer token refresh endpoint");
});

test("secret scanner fails for a private key block", (t) => {
  const dir = createTempRepo(t);
  const privateKeyBlock = "-----BEGIN " + "PRIVATE KEY-----";
  writeFile(dir, "src/server.key", `${privateKeyBlock}\n`);
  commitAll(dir, "init");

  expectFinding(runScanner(dir, []), "private key block");
});

test("secret scanner fails for a Bearer token", (t) => {
  const dir = createTempRepo(t);
  const bearerScheme = "Bearer ";
  const bearerSecret = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEF";
  writeFile(dir, "src/api-client.js", `const auth = "${bearerScheme}${bearerSecret}";\n`);
  commitAll(dir, "init");

  expectFinding(runScanner(dir, []), "Bearer token");
});

test("secret scanner fails for an AWS access key", (t) => {
  const dir = createTempRepo(t);
  const awsKeyId = "AKIA" + "ABCDEFGHIJKLMNOP";
  writeFile(dir, "src/config.json", `{\n  "awsKeyId": "${awsKeyId}"\n}\n`);
  commitAll(dir, "init");

  expectFinding(runScanner(dir, []), "AWS access key");
});

test("secret scanner fails for a GitHub token", (t) => {
  const dir = createTempRepo(t);
  const githubToken = "ghp_" + "0123456789012345678901234567890123456789";
  writeFile(dir, "src/github-client.js", `const token = "${githubToken}";\n`);
  commitAll(dir, "init");

  expectFinding(runScanner(dir, []), "GitHub token");
});

test("secret scanner fails for a Slack token", (t) => {
  const dir = createTempRepo(t);
  const slackToken = "xoxb-" + "1234567890abcdefghij";
  writeFile(dir, "src/slack.js", `const token = "${slackToken}";\n`);
  commitAll(dir, "init");

  expectFinding(runScanner(dir, []), "Slack token");
});

test("secret scanner fails for a Telegram WebApp token send", (t) => {
  const dir = createTempRepo(t);
  const telegramCode = "Telegram" + ".WebApp" + ".sendData" + "(JSON.stringify({ token: " + JSON.stringify("123456789:abcdefGHIJKLMnopQRSTuvwxYZ") + " }));\n";
  writeFile(dir, "src/telegram.js", telegramCode);
  commitAll(dir, "init");

  expectFinding(runScanner(dir, []), "Telegram WebApp token send");
});

test("secret scanner skips binary files containing NUL bytes", (t) => {
  const dir = createTempRepo(t);
  const binary = Buffer.from([0, 0x50, 0x4b, 0x03, 0]);
  writeFile(dir, "assets/logo.bin", binary);
  commitAll(dir, "init");

  expectClean(runScanner(dir, []));
});

test("secret scanner fails for a tracked debug artifact", (t) => {
  const dir = createTempRepo(t);
  writeFile(dir, "debug/screenshot.png", Buffer.from("fake png bytes"));
  commitAll(dir, "init");

  expectFinding(runScanner(dir, []), "tracked debug artifact");
});

test("secret scanner fails in history mode for a committed secret", (t) => {
  const dir = createTempRepo(t);
  const host = "myapp" + ".ngrok" + ".io";
  writeFile(dir, "src/tunnel.js", `const host = "${host}";\n`);
  commitAll(dir, "init");
  fs.rmSync(path.join(dir, "src/tunnel.js"), { force: true });
  commitAll(dir, "chore: remove tunnel");

  expectFinding(runScanner(dir, ["--history"]), "internal FO4 endpoint");
});

test("secret scanner passes in history mode for a clean history", (t) => {
  const dir = createTempRepo(t);
  writeFile(dir, "src/app.js", "console.log('clean file');\n");
  commitAll(dir, "init");

  expectClean(runScanner(dir, ["--history"]));
});
