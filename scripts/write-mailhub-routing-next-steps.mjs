#!/usr/bin/env node

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

function parseArgs(argv) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--readiness") out.readiness = argv[++i];
    else if (arg === "--github-secrets") out.githubSecrets = argv[++i];
    else if (arg === "--preflight") out.preflight = argv[++i];
    else if (arg === "--out") out.out = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/write-mailhub-routing-next-steps.mjs [--readiness path] [--github-secrets path] [--preflight path] [--out path]");
      process.exit(0);
    }
  }
  return out;
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const readiness = readOptionalJson(args.readiness);
  const githubSecrets = readOptionalJson(args.githubSecrets);
  const preflight = readOptionalJson(args.preflight);
  const p0Blockers = stringArray(readiness?.gate?.p0Blockers);
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
  const missingExternalSmtpSecrets = unique([
    ...REQUIRED_EXTERNAL_SMTP_SECRETS.filter((name) => missingGithubSecrets.includes(name)),
    ...REQUIRED_EXTERNAL_SMTP_SECRETS.filter((name) => missingPreflightEnv.includes(name)),
  ]);
  const readyForGithubSendVerify = githubSecrets?.readyForSendVerify === true;
  const readyForLocalProductionProof = preflight?.smtpPreflight?.readyForProductionProof === true;
  const canRunSendVerify = readyForGithubSendVerify && readyForLocalProductionProof;

  const result = {
    generatedAt: new Date().toISOString(),
    inputs: {
      readiness: args.readiness,
      githubSecrets: args.githubSecrets,
      preflight: args.preflight,
      readinessGeneratedAt: readiness?.generatedAt ?? null,
      githubSecretsCheckedAt: githubSecrets?.checkedAt ?? null,
      preflightGeneratedAt: preflight?.generatedAt ?? null,
    },
    state: {
      productionReady,
      p0Blockers,
      currentSharedGmailRoutingBlocked: p0Blockers.includes("current_shared_gmail_routing"),
      readyForGithubSendVerify,
      readyForLocalProductionProof,
      canRunSendVerify,
      externalMailWillBeSentByThisScript: false,
    },
    missing: {
      externalSmtpSecrets: missingExternalSmtpSecrets,
      githubSendVerifySecrets: missingGithubSecrets,
      localPreflightEnv: missingPreflightEnv,
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
        status: canRunSendVerify ? "ready" : "blocked",
        command: "gh workflow run mailhub-routing-probe.yml --repo vyper-japan/mailhub -f mode=send_verify -f confirmSend=SEND_EXTERNAL_MAILHUB_ROUTING_PROBES -f waitSeconds=300 -f pollSeconds=15",
        expected: "sends 8 external probes, verifies all expected addresses, refreshes readiness, and uploads artifacts",
      },
    ],
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    outPath: args.out,
    productionReady,
    canRunSendVerify,
    missingExternalSmtpSecrets,
  }, null, 2));
}

main();
