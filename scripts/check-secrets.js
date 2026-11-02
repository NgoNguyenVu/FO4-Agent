#!/usr/bin/env node
"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const SELF = path.relative(ROOT, __filename).replace(/\\/g, "/");
const HISTORY = process.argv.includes("--history");
const STAGED = process.argv.includes("--staged");

const RULES = [
  {
    name: "internal FO4 endpoint",
    re: /\b[a-z0-9-]+\.ngrok\.(?:pro|io|app)\b/i
  },
  {
    name: "customer token refresh endpoint",
    re: /\/api\/[a-z0-9/_-]*refresh-token\b/i
  },
  {
    name: "Telegram WebApp token send",
    re: /Telegram\.WebApp\.sendData\s*\(\s*JSON\.stringify\s*\(\s*\{\s*token\b/i
  },
  {
    name: "private key block",
    re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
  },
  {
    name: "AWS access key",
    re: /\bAKIA[0-9A-Z]{16}\b/
  },
  {
    name: "GitHub token",
    re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/
  },
  {
    name: "Slack token",
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/
  },
  {
    name: "Bearer token",
    re: /\bBearer\s+[A-Za-z0-9._~+/=-]{30,}/
  }
];

const ARTIFACT_RE = /^debug\/.*\.(?:png|html)$/i;

function git(args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
}

function listTrackedFiles() {
  return git(["ls-files", "-z"]).split("\0").filter(Boolean);
}

function scanText(text, where) {
  const findings = [];
  for (const rule of RULES) {
    if (rule.re.test(text)) {
      findings.push({ where, rule: rule.name });
    }
  }
  return findings;
}

function scanWorkingTree() {
  const findings = [];
  for (const file of listTrackedFiles()) {
    if (file === SELF) continue;

    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) continue;

    if (ARTIFACT_RE.test(file)) {
      findings.push({ where: file, rule: "tracked debug artifact" });
      continue;
    }

    const buffer = fs.readFileSync(full);
    if (buffer.includes(0)) continue;
    findings.push(...scanText(buffer.toString("utf8"), file));
  }
  return findings;
}

function scanHistory() {
  const history = git(["log", "-p", "--all", "--no-ext-diff", "--no-color"]);
  return scanText(history, "git history");
}

function scanStaged() {
  const findings = [];
  for (const file of listTrackedFiles()) {
    if (file === SELF) continue;

    if (ARTIFACT_RE.test(file)) {
      findings.push({ where: file, rule: "tracked debug artifact" });
      continue;
    }

    let buffer;
    try {
      buffer = execFileSync("git", ["show", `:${file}`], {
        cwd: ROOT,
        maxBuffer: 64 * 1024 * 1024
      });
    } catch {
      continue;
    }

    if (buffer.includes(0)) continue;
    findings.push(...scanText(buffer.toString("utf8"), file));
  }
  return findings;
}

const findings = HISTORY
  ? scanHistory()
  : STAGED
    ? scanStaged()
    : scanWorkingTree();

if (findings.length) {
  console.error(`Secret scan failed: ${findings.length} finding(s)`);
  for (const finding of findings) {
    console.error(`- ${finding.where}: ${finding.rule}`);
  }
  process.exitCode = 1;
} else {
  const mode = HISTORY ? "history" : STAGED ? "staged index" : "working tree";
  console.log(`Secret scan passed (${mode}).`);
}
