#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const repoRoot = process.cwd();
const runDir = join(repoRoot, ".ai-runs", "mailhub-next-phase");
const defaults = {
  readiness: join(runDir, "mailhub-production-readiness-audit.json"),
  githubSecrets: join(runDir, "github-routing-secrets-readiness.json"),
  preflight: join(runDir, "mailhub-routing-probe-preflight.json"),
  out: join(runDir, "mailhub-routing-next-steps.json"),
};

const REQUIRED_EXTERNAL_SMTP_SECRETS = [
  "MAILHUB_PROBE_SMTP_HOST",
  "MAILHUB_PROBE_SMTP_USER",
  "MAILHUB_PROBE_SMTP_PASS",
  "MAILHUB_PROBE_FROM",
];
const REQUIRED_LOCAL_GMAIL_ENV = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_SHARED_INBOX_EMAIL",
  "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
];

function parseArgs(argv) {
  const out = { ...defaults, localEnvFile: join(repoRoot, ".env.local"), strict: false, repoHead: "", repoParentHead: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--readiness") out.readiness = argv[++i];
    else if (arg === "--github-secrets") out.githubSecrets = argv[++i];
    else if (arg === "--preflight") out.preflight = argv[++i];
    else if (arg === "--out") out.out = argv[++i];
    else if (arg === "--local-env-file") out.localEnvFile = argv[++i];
    else if (arg === "--strict") out.strict = true;
    else if (arg === "--repo-head") out.repoHead = argv[++i];
    else if (arg === "--repo-parent-head") out.repoParentHead = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/write-mailhub-routing-next-steps.mjs [--readiness path] [--github-secrets path] [--preflight path] [--out path] [--local-env-file path] [--strict] [--repo-head sha] [--repo-parent-head sha]");
      process.exit(0);
    }
  }
  return out;
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
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value.replace(/\\n/g, "\n");
  }
  return true;
}

function readOptionalJson(path) {
  if (!path || !existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function unique(values) {
  return [...new Set(values)];
}

function missingEnv(keys) {
  return keys.filter((key) => !process.env[key]?.trim());
}

function gitRevParse(ref) {
  try {
    return execFileSync("git", ["rev-parse", ref], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const localEnvFileLoaded = loadEnvFile(args.localEnvFile);
  const readiness = readOptionalJson(args.readiness);
  const githubSecrets = readOptionalJson(args.githubSecrets);
  const preflight = readOptionalJson(args.preflight);
  const repoHead = args.repoHead || gitRevParse("HEAD");
  const repoParentHead = args.repoParentHead || gitRevParse("HEAD^");
  const readinessRepoHead = typeof readiness?.repoHead === "string" ? readiness.repoHead : null;
  const inputErrors = [];
  const inputWarnings = [];
  if (!readiness) inputErrors.push("missing_readiness_artifact");
  if (!githubSecrets) inputWarnings.push("missing_github_secrets_artifact");
  if (!preflight) inputWarnings.push("missing_preflight_artifact");
  if (readiness && !readinessRepoHead) inputErrors.push("readiness_missing_repo_head");
  if (readinessRepoHead && repoHead && readinessRepoHead !== repoHead && readinessRepoHead !== repoParentHead) {
    inputErrors.push("stale_readiness_repo_head");
  }

  const p0Blockers = stringArray(readiness?.gate?.p0Blockers);
  const p1Blockers = stringArray(readiness?.gate?.p1Blockers);
  const productionReady = readiness?.gate?.productionReady === true;
  const missingGithubSecrets = githubSecrets
    ? stringArray(githubSecrets.missingSendVerifySecrets)
    : [
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "GOOGLE_SHARED_INBOX_EMAIL",
        "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
        ...REQUIRED_EXTERNAL_SMTP_SECRETS,
      ];
  const presentGithubSecrets = stringArray(githubSecrets?.presentRequiredSecretNames);
  const missingPreflightEnv = preflight
    ? stringArray(preflight.smtpPreflight?.missingRequiredEnv)
    : REQUIRED_EXTERNAL_SMTP_SECRETS;
  const missingLocalGmailEnv = missingEnv(REQUIRED_LOCAL_GMAIL_ENV);
  const missingExternalSmtpSecrets = unique([
    ...REQUIRED_EXTERNAL_SMTP_SECRETS.filter((name) => missingGithubSecrets.includes(name)),
    ...REQUIRED_EXTERNAL_SMTP_SECRETS.filter((name) => missingPreflightEnv.includes(name)),
  ]);
  const readyForGithubSendVerify = githubSecrets?.readyForSendVerify === true;
  const readyForLocalProductionProof = preflight?.smtpPreflight?.readyForProductionProof === true;
  const readyForLocalGmailVerification = missingLocalGmailEnv.length === 0;
  const canRunGithubWorkflowDispatch = readyForGithubSendVerify;
  const canRunLocalSendVerify = readyForLocalProductionProof && readyForLocalGmailVerification;
  const canRunSendVerify = readyForGithubSendVerify && canRunLocalSendVerify;

  const result = {
    generatedAt: new Date().toISOString(),
    inputs: {
      readiness: args.readiness,
      githubSecrets: args.githubSecrets,
      preflight: args.preflight,
      readinessGeneratedAt: readiness?.generatedAt ?? null,
      readinessRepoHead,
      repoHead,
      repoParentHead,
      githubSecretsCheckedAt: githubSecrets?.checkedAt ?? null,
      preflightGeneratedAt: preflight?.generatedAt ?? null,
      localEnvFile: args.localEnvFile,
      localEnvFileLoaded,
      errors: inputErrors,
      warnings: inputWarnings,
    },
    state: {
      productionReady,
      p0Blockers,
      p1Blockers,
      currentSharedGmailRoutingBlocked: p0Blockers.includes("current_shared_gmail_routing"),
      readyForGithubSendVerify,
      readyForLocalProductionProof,
      readyForLocalGmailVerification,
      canRunGithubWorkflowDispatch,
      canRunLocalSendVerify,
      canRunSendVerify,
      externalMailWillBeSentByThisScript: false,
    },
    missing: {
      externalSmtpSecrets: missingExternalSmtpSecrets,
      githubSendVerifySecrets: missingGithubSecrets,
      localPreflightEnv: missingPreflightEnv,
      localGmailVerificationEnv: missingLocalGmailEnv,
    },
    present: {
      githubRequiredSecrets: presentGithubSecrets,
    },
    nextActions: [
      {
        id: "set_external_smtp_secrets",
        status: missingExternalSmtpSecrets.length === 0 ? "done" : "required",
        description: "Add a non-@vtj.co.jp external SMTP proof sender to GitHub Actions secrets.",
        requiredSecrets: missingExternalSmtpSecrets,
        commands: missingExternalSmtpSecrets.map((name) => `gh secret set ${name} --repo vyper-japan/mailhub --app actions`),
      },
      {
        id: "verify_secret_readiness",
        status: readyForGithubSendVerify ? "done" : "required",
        command: "npm run audit:github-routing-secrets -- --no-fail --out .ai-runs/mailhub-next-phase/github-routing-secrets-readiness.json",
        expected: "readyForSendVerify=true",
      },
      {
        id: "run_no_send_preflight",
        status: readyForLocalProductionProof ? "done" : "required",
        command: "npm run probe:routing-preflight -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-preflight.json",
        expected: "smtpPreflight.readyForProductionProof=true and sentCount=0",
      },
      {
        id: "run_github_send_verify",
        status: canRunGithubWorkflowDispatch ? "ready" : "blocked",
        command: "gh workflow run mailhub-routing-probe.yml --repo vyper-japan/mailhub -f mode=send_verify -f confirmSend=SEND_EXTERNAL_MAILHUB_ROUTING_PROBES -f waitSeconds=300 -f pollSeconds=15",
        expected: "GitHub Actions re-runs injected-env preflight, sends 8 external probes, verifies all expected addresses, refreshes readiness, and uploads artifacts",
      },
      {
        id: "run_local_send_verify",
        status: canRunLocalSendVerify ? "ready" : "blocked",
        command: "npm run probe:routing-send -- --send --verify-after-send --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-send.json",
        expected: "local SMTP preflight and local Gmail verification env are ready, then sends 8 external probes and verifies all expected addresses",
      },
    ],
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    outPath: args.out,
    productionReady,
    canRunGithubWorkflowDispatch,
    canRunLocalSendVerify,
    canRunSendVerify,
    missingExternalSmtpSecrets,
    inputErrors,
    inputWarnings,
  }, null, 2));
  if (args.strict && inputErrors.length > 0) process.exitCode = 1;
}

main();
