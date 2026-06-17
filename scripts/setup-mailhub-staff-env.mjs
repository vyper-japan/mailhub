#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const repoRoot = process.cwd();
const defaultEnvPath = join(repoRoot, ".env.local");
const defaultOutPath = join(repoRoot, ".ai-runs", "mailhub-next-phase", "mailhub-staff-env-readiness.json");

const REQUIRED_PRODUCTION_ENV = [
  "NEXTAUTH_URL",
  "NEXTAUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_SHARED_INBOX_EMAIL",
  "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
];
const REQUIRED_SHEETS_ENV = [
  "MAILHUB_SHEETS_CLIENT_EMAIL",
  "MAILHUB_SHEETS_PRIVATE_KEY",
];

function parseArgs(argv) {
  const args = {
    envFile: defaultEnvPath,
    out: defaultOutPath,
    strict: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--staff-env-file") args.envFile = argv[++i] || "";
    else if (arg === "--out") args.out = argv[++i] || "";
    else if (arg === "--strict") args.strict = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/setup-mailhub-staff-env.mjs [--staff-env-file path] [--out path] [--strict]

Checks production MailHub staff rollout env without printing secret values.

Required production env:
  MAILHUB_ENV=production
  MAILHUB_READ_ONLY=1
  ${REQUIRED_PRODUCTION_ENV.join("\n  ")}
  MAILHUB_ADMINS
  MAILHUB_TEAM_MEMBERS
  MAILHUB_CONFIG_STORE=sheets
  MAILHUB_ACTIVITY_STORE=sheets
  MAILHUB_SHEETS_ID or MAILHUB_SHEETS_SPREADSHEET_ID
  ${REQUIRED_SHEETS_ENV.join("\n  ")}

The output artifact contains only key names, counts, booleans, and validation issues.`);
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value.replace(/\\n/g, "\n");
  }
}

function valueFor(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function boolEnv(name) {
  const raw = valueFor(name).toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
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

function emailDiagnostics(envName) {
  const entries = parseEmailList(valueFor(envName));
  const validVtj = entries.filter((entry) => entry.valid && entry.vtj);
  return {
    count: validVtj.length,
    configured: entries.length > 0,
    invalid: entries.filter((entry) => !entry.valid).map((entry) => entry.raw),
    nonVtj: entries.filter((entry) => entry.valid && !entry.vtj).map((entry) => entry.email),
  };
}

function missingEnv(names) {
  return names.filter((name) => !valueFor(name));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnvFile(args.envFile);

  const admins = emailDiagnostics("MAILHUB_ADMINS");
  const teamMembers = emailDiagnostics("MAILHUB_TEAM_MEMBERS");
  const productionMissing = missingEnv(REQUIRED_PRODUCTION_ENV);
  const sheetsMissing = [
    ...(!valueFor("MAILHUB_SHEETS_ID") && !valueFor("MAILHUB_SHEETS_SPREADSHEET_ID")
      ? ["MAILHUB_SHEETS_ID or MAILHUB_SHEETS_SPREADSHEET_ID"]
      : []),
    ...missingEnv(REQUIRED_SHEETS_ENV),
  ];
  const productionEnvModeReady = valueFor("MAILHUB_ENV").toLowerCase() === "production";
  const testModeDisabled = !boolEnv("MAILHUB_TEST_MODE");
  const productionRequiredEnvReady = productionMissing.length === 0;
  const adminsReady = admins.configured && admins.count > 0 && admins.invalid.length === 0 && admins.nonVtj.length === 0;
  const staffAccessAllowlistReady =
    adminsReady && teamMembers.configured && teamMembers.count > 0 && teamMembers.invalid.length === 0 && teamMembers.nonVtj.length === 0;
  const durableConfigReady = valueFor("MAILHUB_CONFIG_STORE").toLowerCase() === "sheets" && sheetsMissing.length === 0;
  const durableActivityReady = valueFor("MAILHUB_ACTIVITY_STORE").toLowerCase() === "sheets" && sheetsMissing.length === 0;
  const readOnlyEnabled = boolEnv("MAILHUB_READ_ONLY");
  const readyForReadOnlyRolloutPreflight =
    productionEnvModeReady &&
    testModeDisabled &&
    productionRequiredEnvReady &&
    adminsReady &&
    staffAccessAllowlistReady &&
    durableConfigReady &&
    durableActivityReady &&
    readOnlyEnabled;

  const result = {
    generatedAt: new Date().toISOString(),
    inputs: {
      envFile: args.envFile || null,
      envFileLoaded: Boolean(args.envFile && existsSync(args.envFile)),
      valuePolicy: "Secret values are never printed; this artifact contains only key names, booleans, counts, and validation issues.",
    },
    state: {
      readyForReadOnlyRolloutPreflight,
      productionEnvModeReady,
      testModeDisabled,
      productionRequiredEnvReady,
      adminsReady,
      staffAccessAllowlistReady,
      durableConfigReady,
      durableActivityReady,
      readOnlyEnabled,
    },
    missing: {
      productionEnvMode: productionEnvModeReady ? [] : ["MAILHUB_ENV=production"],
      productionEnv: productionMissing,
      staffAdmins: adminsReady ? [] : ["MAILHUB_ADMINS"],
      staffTeamMembers: staffAccessAllowlistReady ? [] : ["MAILHUB_TEAM_MEMBERS"],
      durableConfig: durableConfigReady ? [] : ["MAILHUB_CONFIG_STORE=sheets", ...sheetsMissing],
      durableActivity: durableActivityReady ? [] : ["MAILHUB_ACTIVITY_STORE=sheets", ...sheetsMissing],
      readOnlyFlag: readOnlyEnabled ? [] : ["MAILHUB_READ_ONLY=1"],
    },
    present: {
      adminCount: admins.count,
      teamMemberCount: teamMembers.count,
      sheetsIdConfigured: Boolean(valueFor("MAILHUB_SHEETS_ID") || valueFor("MAILHUB_SHEETS_SPREADSHEET_ID")),
      sheetsClientEmailConfigured: Boolean(valueFor("MAILHUB_SHEETS_CLIENT_EMAIL")),
      sheetsPrivateKeyConfigured: Boolean(valueFor("MAILHUB_SHEETS_PRIVATE_KEY")),
      configStore: valueFor("MAILHUB_CONFIG_STORE") || null,
      activityStore: valueFor("MAILHUB_ACTIVITY_STORE") || null,
    },
    issues: {
      adminInvalid: admins.invalid,
      adminNonVtj: admins.nonVtj,
      teamInvalid: teamMembers.invalid,
      teamNonVtj: teamMembers.nonVtj,
    },
  };

  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify(result, null, 2));
  if (args.strict && !readyForReadOnlyRolloutPreflight) process.exitCode = 1;
}

main();
