#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { extname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));

const DEFAULT_TARGETS = [
  ".env.example",
  "env.example",
  "OPS_RUNBOOK.md",
  ".ai-runs/mailhub-next-phase/github-routing-secrets-readiness.json",
  ".ai-runs/mailhub-next-phase/mailhub-routing-probe-preflight.json",
  ".ai-runs/mailhub-next-phase/mailhub-routing-probe-send.json",
  ".ai-runs/mailhub-next-phase/mailhub-routing-probe-audit.json",
  ".ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json",
  ".ai-runs/mailhub-next-phase/mailhub-routing-next-steps.json",
];
const SCANNABLE_EXTENSIONS = new Set([
  ".env",
  ".example",
  ".json",
  ".log",
  ".md",
  ".patch",
  ".txt",
  ".yml",
  ".yaml",
]);

const SECRET_PATTERNS = [
  {
    name: "pem_private_key",
    pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/i,
  },
  {
    name: "oauth_refresh_token",
    pattern: /\brefresh[_-]?token\b\s*[:=]\s*["']?([A-Za-z0-9._~+/=-]{20,})["']?/i,
  },
  {
    name: "oauth_access_token",
    pattern: /\baccess[_-]?token\b\s*[:=]\s*["']?([A-Za-z0-9._~+/=-]{20,})["']?/i,
  },
  {
    name: "json_credential_value",
    pattern: /"(?:client_secret|private_key|refresh_token|access_token|webhook_url|token|secret)"\s*:\s*"([^"\n]{12,})"/i,
  },
  {
    name: "slack_webhook_url",
    pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+/i,
  },
  {
    name: "env_secret_value",
    pattern: /\b[A-Z0-9_]*(?:SECRET|TOKEN|PRIVATE_KEY|WEBHOOK_URL)[A-Z0-9_]*\b\s*=\s*["']?([^"'\s#]{12,})["']?/i,
  },
];

function usage() {
  return [
    "Usage: node scripts/scan-ops-artifacts.mjs [file-or-dir ...]",
    "",
    "Scans ops artifacts and committed MailHub proof artifacts for secret values. If no targets are provided, scans:",
    `  ${DEFAULT_TARGETS.join(", ")}`,
    "",
    "Allowed content: env key names without values, and secret_ref: vyper/... placeholders.",
  ].join("\n");
}

function normalizeTarget(input) {
  return resolve(rootDir, input);
}

function isSecretRefOnly(line) {
  return /\bsecret_ref\s*:\s*vyper\/[A-Za-z0-9/_-]+\b/i.test(line);
}

function isKeyNameOnly(line) {
  const trimmed = line.trim().replace(/^#\s*/, "").trim();
  if (!trimmed) return true;
  return /^[A-Z][A-Z0-9_]*(?:\s*(?:#.*)?)?$/.test(trimmed);
}

function shouldScanFile(filePath) {
  const base = filePath.split(/[\\/]/).pop() ?? "";
  if (base === ".env.example" || base === "env.example" || base === "OPS_RUNBOOK.md") return true;
  return SCANNABLE_EXTENSIONS.has(extname(base));
}

function collectFiles(targets) {
  const files = [];
  const missing = [];

  function walk(target) {
    if (!existsSync(target)) {
      missing.push(relative(rootDir, target) || target);
      return;
    }

    const stats = statSync(target);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(target, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") continue;
        walk(join(target, entry.name));
      }
      return;
    }

    if (stats.isFile() && shouldScanFile(target)) {
      files.push(target);
    }
  }

  for (const target of targets) {
    walk(normalizeTarget(target));
  }

  return { files: Array.from(new Set(files)).sort(), missing };
}

function maskSecretLine(line, pattern) {
  if (pattern.name === "slack_webhook_url") {
    return line.replace(/https:\/\/hooks\.slack\.com\/services\/[^\s"'`]+/gi, "https://hooks.slack.com/services/***");
  }

  if (pattern.name === "pem_private_key") {
    return line.replace(/-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----.*$/i, "-----BEGIN *** PRIVATE KEY-----");
  }

  return line.replace(/(:\s*|=\s*)(["']?)([^"',\s#]{4,})(["']?)/, "$1$2***$4");
}

function scanContent(content, filePath) {
  const findings = [];
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (isSecretRefOnly(line) || isKeyNameOnly(line)) return;

    for (const secretPattern of SECRET_PATTERNS) {
      if (secretPattern.pattern.test(line)) {
        findings.push({
          filePath,
          lineNumber: index + 1,
          type: secretPattern.name,
          maskedLine: maskSecretLine(line, secretPattern),
        });
        break;
      }
    }
  });

  return findings;
}

function scanFiles(files) {
  return files.flatMap((filePath) => scanContent(readFileSync(filePath, "utf8"), filePath));
}

function printPass(files, missing) {
  console.log("PASS CR-F9-R007 ops artifact secret scan");
  console.log(`scanned_files=${files.length}`);
  for (const filePath of files) {
    console.log(`- ${relative(rootDir, filePath)}`);
  }
  if (missing.length > 0) {
    console.log(`missing_targets_skipped=${missing.join(", ")}`);
  }
}

function printMissing(files, missing) {
  console.error("FAIL CR-F9-R007 ops artifact secret scan");
  console.error(`scanned_files=${files.length}`);
  console.error(`missing_targets=${missing.join(", ")}`);
}

function printFindings(findings, files, missing) {
  console.error("FAIL CR-F9-R007 ops artifact secret scan");
  console.error(`scanned_files=${files.length}`);
  for (const finding of findings) {
    console.error(
      `${relative(rootDir, finding.filePath)}:${finding.lineNumber} ${finding.type}: ${finding.maskedLine}`,
    );
  }
  if (missing.length > 0) {
    console.error(`missing_targets_skipped=${missing.join(", ")}`);
  }
}

export function scanOpsArtifactTargets(targets = DEFAULT_TARGETS) {
  const { files, missing } = collectFiles(targets);
  const findings = scanFiles(files);
  return { files, findings, missing };
}

export function hasSecretValue(content) {
  return scanContent(content, "<fixture>").length > 0;
}

function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return 0;
  }

  const targets = argv.length > 0 ? argv : DEFAULT_TARGETS;
  const { files, findings, missing } = scanOpsArtifactTargets(targets);

  if (missing.length > 0) {
    printMissing(files, missing);
    return 1;
  }

  if (findings.length === 0) {
    printPass(files, missing);
    return 0;
  }

  printFindings(findings, files, missing);
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
