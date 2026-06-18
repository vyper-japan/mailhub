#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const DEFAULT_REPO = "vyper-japan/mailhub";
const repoRoot = process.cwd();

const REQUIRED_PREFLIGHT_SECRETS = [
  "MAILHUB_PROBE_SMTP_HOST",
  "MAILHUB_PROBE_SMTP_USER",
  "MAILHUB_PROBE_SMTP_PASS",
  "MAILHUB_PROBE_FROM",
];

const REQUIRED_SEND_VERIFY_SECRETS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_SHARED_INBOX_EMAIL",
  "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
  ...REQUIRED_PREFLIGHT_SECRETS,
];

const OPTIONAL_SECRETS = ["MAILHUB_PROBE_SMTP_PORT", "MAILHUB_PROBE_SMTP_SECURE"];

function parseArgs(argv) {
  const args = {
    repo: DEFAULT_REPO,
    failOnMissing: true,
    secretsJson: "",
    out: "",
    fromEnv: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo") args.repo = argv[++i] || "";
    else if (arg === "--secrets-json") args.secretsJson = argv[++i] || "";
    else if (arg === "--out") args.out = argv[++i] || "";
    else if (arg === "--from-env") args.fromEnv = true;
    else if (arg === "--no-fail") args.failOnMissing = false;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/check-mailhub-routing-probe-secrets.mjs [--repo owner/name] [--secrets-json path] [--from-env] [--out path] [--no-fail]");
      process.exit(0);
    }
  }
  return args;
}

function readSecretsJson(path) {
  if (!existsSync(path)) throw new Error(`missing_secrets_json:${path}`);
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.secrets)) return parsed.secrets;
  throw new Error("invalid_secrets_json");
}

function readActionSecrets(repo) {
  const raw = execFileSync(
    "gh",
    ["secret", "list", "--repo", repo, "--app", "actions", "--json", "name,updatedAt"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function readEnvSecrets() {
  return REQUIRED_SEND_VERIFY_SECRETS
    .filter((name) => typeof process.env[name] === "string" && process.env[name].trim())
    .map((name) => ({ name }));
}

function currentRepoHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function missingSecrets(required, present) {
  return required.filter((name) => !present.has(name));
}

function groupReadiness(required, present) {
  const presentNames = required.filter((name) => present.has(name));
  const missingNames = missingSecrets(required, present);
  return {
    required: required,
    present: presentNames,
    missing: missingNames,
    ready: missingNames.length === 0,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const secrets = args.fromEnv ? readEnvSecrets() : args.secretsJson ? readSecretsJson(args.secretsJson) : readActionSecrets(args.repo);
  const present = new Set(secrets.map((secret) => secret.name).filter(Boolean));
  const missingPreflight = missingSecrets(REQUIRED_PREFLIGHT_SECRETS, present);
  const missingSendVerify = missingSecrets(REQUIRED_SEND_VERIFY_SECRETS, present);
  const externalSmtpSecrets = groupReadiness(REQUIRED_PREFLIGHT_SECRETS, present);
  const gmailProofSecrets = groupReadiness(
    REQUIRED_SEND_VERIFY_SECRETS.filter((name) => !REQUIRED_PREFLIGHT_SECRETS.includes(name)),
    present,
  );
  const configuredOptional = OPTIONAL_SECRETS.filter((name) => present.has(name));
  const result = {
    repo: args.repo,
    source: args.fromEnv ? "env" : args.secretsJson ? "json" : "github_actions_secrets",
    checkedAt: new Date().toISOString(),
    repoHead: currentRepoHead(),
    secretCount: secrets.length,
    requiredPreflightSecrets: REQUIRED_PREFLIGHT_SECRETS,
    requiredSendVerifySecrets: REQUIRED_SEND_VERIFY_SECRETS,
    optionalSecrets: OPTIONAL_SECRETS,
    configuredOptionalSecrets: configuredOptional,
    missingPreflightSecrets: missingPreflight,
    missingSendVerifySecrets: missingSendVerify,
    readyForPreflightProductionProof: missingPreflight.length === 0,
    readyForSendVerify: missingSendVerify.length === 0,
    secretGroups: {
      externalSmtpProof: externalSmtpSecrets,
      gmailProof: gmailProofSecrets,
    },
    presentRequiredSecretNames: REQUIRED_SEND_VERIFY_SECRETS.filter((name) => present.has(name)),
    note: "Only GitHub secret names and updatedAt metadata were read; secret values are never accessible or printed.",
  };

  console.log(JSON.stringify(result, null, 2));
  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  if (args.failOnMissing && !result.readyForSendVerify) process.exitCode = 1;
}

main();
