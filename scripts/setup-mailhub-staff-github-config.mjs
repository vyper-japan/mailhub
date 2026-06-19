#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const repoRoot = process.cwd();
const envPath = join(repoRoot, ".env.local");
const DEFAULT_REPO = "vyper-japan/mailhub";
const APPLY_CONFIRM_TOKEN = "APPLY_MAILHUB_STAFF_GITHUB_CONFIG";

const REQUIRED_SECRET_NAMES = [
  "NEXTAUTH_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
  "MAILHUB_SHEETS_PRIVATE_KEY",
];

const REQUIRED_VARIABLE_NAMES = [
  "MAILHUB_ENV",
  "NEXTAUTH_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_SHARED_INBOX_EMAIL",
  "MAILHUB_ADMINS",
  "MAILHUB_TEAM_MEMBERS",
  "MAILHUB_CONFIG_STORE",
  "MAILHUB_ACTIVITY_STORE",
  "MAILHUB_SHEETS_CLIENT_EMAIL",
  "MAILHUB_READ_ONLY",
];

const SHEETS_ID_NAMES = ["MAILHUB_SHEETS_ID", "MAILHUB_SHEETS_SPREADSHEET_ID"];
const OPTIONAL_VARIABLE_NAMES = ["MAILHUB_SHEETS_TAB_RULES", "MAILHUB_SHEETS_TAB_ASSIGNEE_RULES"];

function parseArgs(argv) {
  const args = {
    repo: DEFAULT_REPO,
    apply: false,
    includeOptional: true,
    envFile: envPath,
    out: "",
    confirmApply: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo") args.repo = argv[++i] || "";
    else if (arg === "--staff-env-file") args.envFile = argv[++i] || "";
    else if (arg === "--out") args.out = argv[++i] || "";
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--confirm-apply") args.confirmApply = argv[++i] || "";
    else if (arg === "--no-optional") args.includeOptional = false;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/setup-mailhub-staff-github-config.mjs [--repo owner/name] [--staff-env-file path] [--out path] [--apply] [--confirm-apply ${APPLY_CONFIRM_TOKEN}] [--no-optional]

Reads MailHub production staff config from environment/.env.local and, only with --apply, writes it to GitHub Actions secrets and variables.
Values are never printed. Secret values are passed to gh via stdin; variables are passed to gh via --body.
--apply requires the exact confirmation token: ${APPLY_CONFIRM_TOKEN}

Required GitHub Actions secrets:
  ${REQUIRED_SECRET_NAMES.join("\n  ")}

Required GitHub Actions variables:
  ${[...REQUIRED_VARIABLE_NAMES, "MAILHUB_SHEETS_ID or MAILHUB_SHEETS_SPREADSHEET_ID"].join("\n  ")}

Optional GitHub Actions variables:
  ${OPTIONAL_VARIABLE_NAMES.join("\n  ")}`);
      process.exit(0);
    }
  }
  return args;
}

function loadEnvFile(path) {
  if (!path || !existsSync(path)) return false;
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
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value.replace(/\\n/g, "\n");
  }
  return true;
}

function valueFor(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function splitCsv(raw) {
  return raw
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseEmailList(raw) {
  return splitCsv(raw).map((entry) => {
    const match = entry.match(/^(.+?)\s*<(.+?)>$/) || entry.match(/^(\S+@\S+)$/);
    const email = (match ? (match[2] ?? match[1]) : entry).toLowerCase().trim();
    return {
      raw: entry,
      email,
      valid: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
      vtj: email.endsWith("@vtj.co.jp"),
    };
  });
}

function emailListIssues(name) {
  const raw = valueFor(name);
  const entries = parseEmailList(raw);
  if (entries.length === 0) return [`${name}_must_be_non_empty_vtj_email_list`];
  const validVtj = entries.filter((entry) => entry.valid && entry.vtj);
  const issues = [];
  if (validVtj.length === 0) issues.push(`${name}_must_be_non_empty_vtj_email_list`);
  if (entries.some((entry) => !entry.valid)) issues.push(`${name}_has_invalid_email`);
  if (entries.some((entry) => entry.valid && !entry.vtj)) issues.push(`${name}_has_non_vtj_email`);
  return issues;
}

function nextAuthUrlIssues() {
  const raw = valueFor("NEXTAUTH_URL");
  if (!raw) return [];
  const issues = [];
  let url;
  try {
    url = new URL(raw);
  } catch {
    return ["NEXTAUTH_URL_must_be_valid_url"];
  }
  if (url.protocol !== "https:") issues.push("NEXTAUTH_URL_must_be_https");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) {
    issues.push("NEXTAUTH_URL_must_not_be_localhost");
  }
  return issues;
}

function selectedSheetsIdName() {
  return SHEETS_ID_NAMES.find((name) => valueFor(name)) || "MAILHUB_SHEETS_ID";
}

function selectedVariableNames(args) {
  const sheetsIdName = selectedSheetsIdName();
  return [
    ...REQUIRED_VARIABLE_NAMES,
    sheetsIdName,
    ...(args.includeOptional ? OPTIONAL_VARIABLE_NAMES.filter((name) => valueFor(name)) : []),
  ];
}

function missingRequiredEnv(variableNames) {
  const missing = [
    ...REQUIRED_SECRET_NAMES.filter((name) => !valueFor(name)),
    ...REQUIRED_VARIABLE_NAMES.filter((name) => !valueFor(name)),
  ];
  if (!SHEETS_ID_NAMES.some((name) => valueFor(name))) {
    missing.push("MAILHUB_SHEETS_ID or MAILHUB_SHEETS_SPREADSHEET_ID");
  }
  return missing.filter((name, index, values) => values.indexOf(name) === index);
}

function semanticIssues() {
  const issues = [];
  if (valueFor("MAILHUB_ENV") && valueFor("MAILHUB_ENV") !== "production") {
    issues.push("MAILHUB_ENV_must_be_production");
  }
  issues.push(...nextAuthUrlIssues());
  if (valueFor("MAILHUB_CONFIG_STORE") && valueFor("MAILHUB_CONFIG_STORE") !== "sheets") {
    issues.push("MAILHUB_CONFIG_STORE_must_be_sheets");
  }
  if (valueFor("MAILHUB_ACTIVITY_STORE") && valueFor("MAILHUB_ACTIVITY_STORE") !== "sheets") {
    issues.push("MAILHUB_ACTIVITY_STORE_must_be_sheets");
  }
  if (valueFor("MAILHUB_READ_ONLY") && valueFor("MAILHUB_READ_ONLY") !== "1") {
    issues.push("MAILHUB_READ_ONLY_must_be_1");
  }
  if (valueFor("MAILHUB_ADMINS")) issues.push(...emailListIssues("MAILHUB_ADMINS"));
  if (valueFor("MAILHUB_TEAM_MEMBERS")) issues.push(...emailListIssues("MAILHUB_TEAM_MEMBERS"));
  return issues;
}

function setSecret({ ghBin, repo, name, value }) {
  execFileSync(ghBin, ["secret", "set", name, "--repo", repo, "--app", "actions"], {
    input: value,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function setVariable({ ghBin, repo, name, value }) {
  execFileSync(ghBin, ["variable", "set", name, "--repo", repo, "--body", value], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function writeOut(path, result) {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const envFileLoaded = loadEnvFile(args.envFile);
  const variableNames = selectedVariableNames(args);
  const missing = missingRequiredEnv(variableNames);
  const issues = semanticIssues();
  const ghBin = process.env.MAILHUB_GH_BIN || "gh";
  const applyConfirmed = args.confirmApply === APPLY_CONFIRM_TOKEN;
  const confirmationErrors = args.apply && !applyConfirmed ? ["missing_or_invalid_confirm_apply_token"] : [];
  const secretNamesToSet = REQUIRED_SECRET_NAMES.filter((name) => valueFor(name));
  const variableNamesToSet = variableNames.filter((name) => valueFor(name));
  const result = {
    repo: args.repo,
    mode: args.apply ? "apply" : "dry_run",
    includeOptional: args.includeOptional,
    envFileLoaded,
    secretNamesToSet,
    variableNamesToSet,
    missingRequiredEnv: missing,
    semanticIssues: issues,
    errors: confirmationErrors,
    readyToApply: missing.length === 0 && issues.length === 0,
    approval: {
      sideEffect: "github_mutation",
      requiresApproval: true,
      confirmApplyToken: APPLY_CONFIRM_TOKEN,
      confirmed: applyConfirmed,
    },
    appliedSecretNames: [],
    appliedVariableNames: [],
    note: "Values are never printed; --apply passes secrets to gh via stdin and variables via gh variable set --body, and requires an explicit confirmation token.",
  };

  if (args.apply) {
    if (!result.readyToApply || confirmationErrors.length > 0) {
      writeOut(args.out, result);
      console.log(JSON.stringify(result, null, 2));
      process.exit(2);
    }
    for (const name of secretNamesToSet) {
      setSecret({ ghBin, repo: args.repo, name, value: valueFor(name) });
      result.appliedSecretNames.push(name);
    }
    for (const name of variableNamesToSet) {
      setVariable({ ghBin, repo: args.repo, name, value: valueFor(name) });
      result.appliedVariableNames.push(name);
    }
  }

  writeOut(args.out, result);
  console.log(JSON.stringify(result, null, 2));
}

main();
