#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const envPath = join(repoRoot, ".env.local");
const DEFAULT_REPO = "vyper-japan/mailhub";
const SMTP_SECRET_NAMES = [
  "MAILHUB_PROBE_SMTP_HOST",
  "MAILHUB_PROBE_SMTP_USER",
  "MAILHUB_PROBE_SMTP_PASS",
  "MAILHUB_PROBE_FROM",
];
const OPTIONAL_SMTP_SECRET_NAMES = [
  "MAILHUB_PROBE_SMTP_PORT",
  "MAILHUB_PROBE_SMTP_SECURE",
];
const GMAIL_SECRET_NAMES = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_SHARED_INBOX_EMAIL",
  "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
];

function parseArgs(argv) {
  const args = {
    repo: DEFAULT_REPO,
    apply: false,
    includeGmail: false,
    includeOptional: true,
    allowVtjFrom: false,
    envFile: envPath,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo") args.repo = argv[++i] || "";
    else if (arg === "--probe-env-file") args.envFile = argv[++i] || "";
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--include-gmail") args.includeGmail = true;
    else if (arg === "--no-optional") args.includeOptional = false;
    else if (arg === "--allow-vtj-from") args.allowVtjFrom = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/setup-mailhub-routing-probe-secrets.mjs [--repo owner/name] [--probe-env-file path] [--apply] [--include-gmail] [--no-optional] [--allow-vtj-from]

Reads routing probe secret values from environment/.env.local and, only with --apply, writes them to GitHub Actions secrets.
Secret values are never printed and are passed to gh via stdin.

Required external SMTP proof env:
  ${SMTP_SECRET_NAMES.join("\n  ")}

Optional SMTP env:
  ${OPTIONAL_SMTP_SECRET_NAMES.join("\n  ")}

Gmail proof env can also be written with --include-gmail:
  ${GMAIL_SECRET_NAMES.join("\n  ")}`);
      process.exit(0);
    }
  }
  return args;
}

function loadEnvFile(path) {
  if (!path || !existsSync(path)) return;
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value.replace(/\\n/g, "\n");
  }
}

function valueFor(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value : "";
}

function extractEmailAddress(value) {
  const trimmed = value?.trim() || "";
  const angleMatch = trimmed.match(/<([^<>]+)>/);
  return (angleMatch?.[1] ?? trimmed).trim().toLowerCase();
}

function emailDomain(value) {
  const email = extractEmailAddress(value);
  return email.includes("@") ? email.split("@").pop() : null;
}

function isVtjAddress(value) {
  return emailDomain(value) === "vtj.co.jp";
}

function selectedSecretNames(args) {
  return [
    ...SMTP_SECRET_NAMES,
    ...(args.includeOptional ? OPTIONAL_SMTP_SECRET_NAMES.filter((name) => valueFor(name)) : []),
    ...(args.includeGmail ? GMAIL_SECRET_NAMES : []),
  ];
}

function validate(args, names) {
  const missingRequired = [
    ...SMTP_SECRET_NAMES,
    ...(args.includeGmail ? GMAIL_SECRET_NAMES : []),
  ].filter((name) => !valueFor(name));
  const warnings = [];
  const from = valueFor("MAILHUB_PROBE_FROM");
  if (from && isVtjAddress(from)) warnings.push("vtj_from_not_external_route_proof");
  const rawPort = valueFor("MAILHUB_PROBE_SMTP_PORT");
  if (rawPort) {
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) warnings.push("invalid_MAILHUB_PROBE_SMTP_PORT");
  }
  const rawSecure = valueFor("MAILHUB_PROBE_SMTP_SECURE").toLowerCase();
  if (rawSecure && rawSecure !== "true" && rawSecure !== "false") warnings.push("invalid_MAILHUB_PROBE_SMTP_SECURE");
  const valueSecretNames = names.filter((name) => valueFor(name));
  return {
    missingRequired,
    warnings,
    valueSecretNames,
    readyToApply: missingRequired.length === 0 && (args.allowVtjFrom || !isVtjAddress(from)),
  };
}

function setSecret({ ghBin, repo, name, value }) {
  execFileSync(ghBin, ["secret", "set", name, "--repo", repo, "--app", "actions"], {
    input: value,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnvFile(args.envFile);
  const names = selectedSecretNames(args);
  const validation = validate(args, names);
  const ghBin = process.env.MAILHUB_GH_BIN || "gh";
  const result = {
    repo: args.repo,
    mode: args.apply ? "apply" : "dry_run",
    includeGmail: args.includeGmail,
    includeOptional: args.includeOptional,
    allowVtjFrom: args.allowVtjFrom,
    envFileLoaded: Boolean(args.envFile && existsSync(args.envFile)),
    secretNamesToSet: validation.valueSecretNames,
    missingRequiredEnv: validation.missingRequired,
    warnings: validation.warnings,
    readyToApply: validation.readyToApply,
    appliedSecretNames: [],
    note: "Secret values are never printed; --apply passes values to gh via stdin.",
  };

  if (args.apply) {
    if (!validation.readyToApply) {
      console.log(JSON.stringify(result, null, 2));
      process.exit(2);
    }
    for (const name of validation.valueSecretNames) {
      setSecret({ ghBin, repo: args.repo, name, value: valueFor(name) });
      result.appliedSecretNames.push(name);
    }
  }

  console.log(JSON.stringify(result, null, 2));
}

main();
