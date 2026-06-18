#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const DEFAULT_RUN_DIR = join(".ai-runs", "mailhub-next-phase");
const DEFAULT_OUT = join(DEFAULT_RUN_DIR, "mailhub-production-config-request.json");

const EXTERNAL_SMTP_REQUIRED_SECRETS = [
  "MAILHUB_PROBE_SMTP_HOST",
  "MAILHUB_PROBE_SMTP_USER",
  "MAILHUB_PROBE_SMTP_PASS",
  "MAILHUB_PROBE_FROM",
];

const EXTERNAL_SMTP_OPTIONAL_SECRETS = [
  "MAILHUB_PROBE_SMTP_PORT",
  "MAILHUB_PROBE_SMTP_SECURE",
];

const STAFF_REQUIRED_SECRETS = [
  "NEXTAUTH_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
  "MAILHUB_SHEETS_PRIVATE_KEY",
];

const STAFF_REQUIRED_VARIABLES = [
  "MAILHUB_ENV",
  "NEXTAUTH_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_SHARED_INBOX_EMAIL",
  "MAILHUB_ADMINS",
  "MAILHUB_TEAM_MEMBERS",
  "MAILHUB_CONFIG_STORE",
  "MAILHUB_ACTIVITY_STORE",
  "MAILHUB_SHEETS_ID or MAILHUB_SHEETS_SPREADSHEET_ID",
  "MAILHUB_SHEETS_CLIENT_EMAIL",
  "MAILHUB_READ_ONLY",
];

const RULE_SOURCE_REQUIRED_ENV = [
  "MAILHUB_CONFIG_STORE=sheets",
  "MAILHUB_SHEETS_ID or MAILHUB_SHEETS_SPREADSHEET_ID",
  "MAILHUB_SHEETS_CLIENT_EMAIL",
  "MAILHUB_SHEETS_PRIVATE_KEY",
  "MAILHUB_SHEETS_TAB_RULES",
  "MAILHUB_SHEETS_TAB_ASSIGNEE_RULES",
];

const READONLY_EVIDENCE_FILES = [
  "mailhub-meta-topbar-readonly.png",
  "mailhub-meta-health-readonly.png",
  "staff-workflow-evidence-manifest.json",
];

function parseArgs(argv) {
  const args = {
    runDir: DEFAULT_RUN_DIR,
    out: DEFAULT_OUT,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--run-dir") args.runDir = argv[++i] || "";
    else if (arg === "--out") args.out = argv[++i] || "";
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/write-mailhub-production-config-request.mjs [--run-dir path] [--out path]

Writes a secret-free production configuration request artifact for MailHub readiness blockers.
The artifact lists required key names, action commands, and current blocker ids only.
Secret values are never read from GitHub and never printed.`);
      process.exit(0);
    } else {
      throw new Error(`unknown_arg:${arg}`);
    }
  }
  return args;
}

function readJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function artifact(runDir, name) {
  return join(runDir, name);
}

function repoHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function array(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function blockerIds(readiness, key) {
  const topLevel = array(readiness?.[key]);
  if (topLevel.length > 0) return topLevel;
  return array(readiness?.gate?.[key]);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const readiness = readJson(artifact(args.runDir, "mailhub-production-readiness-audit.json"));
  const routingSecrets = readJson(artifact(args.runDir, "github-routing-secrets-readiness.json"));
  const staffConfig = readJson(artifact(args.runDir, "github-staff-secrets-readiness.json"));
  const routingNext = readJson(artifact(args.runDir, "mailhub-routing-next-steps.json"));
  const staffNext = readJson(artifact(args.runDir, "mailhub-staff-workflow-next-steps.json"));
  const ruleNext = readJson(artifact(args.runDir, "mailhub-rule-config-next-steps.json"));

  const p0Blockers = blockerIds(readiness, "p0Blockers");
  const p1Blockers = blockerIds(readiness, "p1Blockers");
  const missingExternalSmtpSecrets = unique([
    ...array(routingSecrets?.missingPreflightSecrets),
    ...array(routingSecrets?.missingSendVerifySecrets),
    ...array(routingNext?.missingExternalSmtpSecrets),
  ]);
  const missingStaffConfig = unique(array(staffConfig?.missingProductionStaffConfig));
  const missingStaffSecrets = unique(array(staffConfig?.missingSecretConfig));
  const ruleRequiredActions = array(ruleNext?.requiredActions);
  const staffRequiredActions = array(staffNext?.requiredActions);

  const result = {
    generatedAt: new Date().toISOString(),
    repoHead: repoHead(),
    valuePolicy: "Secret values are never printed; this artifact contains only key names, blocker ids, readiness booleans, and commands.",
    readiness: {
      productionReady: readiness?.productionReady === true,
      p0Blockers,
      p1Blockers,
    },
    currentMissing: {
      externalSmtpSecrets: missingExternalSmtpSecrets,
      staffProductionConfig: missingStaffConfig,
      staffSecretConfig: missingStaffSecrets,
      staffRequiredActions,
      ruleRequiredActions,
    },
    requiredInputs: {
      externalSmtpProof: {
        purpose: "Prove current external routing into the shared Gmail inbox for all MailHub source addresses.",
        requiredGitHubSecrets: EXTERNAL_SMTP_REQUIRED_SECRETS,
        optionalGitHubSecrets: EXTERNAL_SMTP_OPTIONAL_SECRETS,
        constraints: [
          "MAILHUB_PROBE_FROM must be a non-@vtj.co.jp external sender.",
          "Values may be supplied via .env.local for local setup dry-run/apply, but must not be committed.",
        ],
      },
      staffGitHubConfig: {
        purpose: "Enable read-only staff rollout with durable Sheets-backed config/activity stores.",
        requiredGitHubSecrets: STAFF_REQUIRED_SECRETS,
        requiredGitHubVariables: STAFF_REQUIRED_VARIABLES,
        requiredVariableValues: {
          MAILHUB_ENV: "production",
          MAILHUB_CONFIG_STORE: "sheets",
          MAILHUB_ACTIVITY_STORE: "sheets",
          MAILHUB_READ_ONLY: "1",
        },
        constraints: [
          "NEXTAUTH_URL must be a verified HTTPS non-localhost URL.",
          "MAILHUB_ADMINS and MAILHUB_TEAM_MEMBERS must be non-empty @vtj.co.jp email lists.",
        ],
      },
      sheetsRuleSource: {
        purpose: "Move Auto Rules and Assignee Rules readiness from local file config to production Sheets config.",
        requiredEnvOrGitHubConfig: RULE_SOURCE_REQUIRED_ENV,
        defaultRuleTabs: {
          MAILHUB_SHEETS_TAB_RULES: "ConfigRules",
          MAILHUB_SHEETS_TAB_ASSIGNEE_RULES: "ConfigAssigneeRules",
        },
      },
      readOnlyRolloutEvidence: {
        purpose: "Capture authenticated production read-only UI evidence before controlled write pilot.",
        requiredFiles: READONLY_EVIDENCE_FILES,
        note: "Unauthenticated /api/mailhub/config/health returns 401; capture requires an authenticated browser/session.",
      },
    },
    safeCommands: {
      dryRun: [
        "npm run setup:mailhub-routing-secrets",
        "npm run setup:mailhub-staff-github-config -- --out .ai-runs/mailhub-next-phase/mailhub-staff-github-config-plan.json",
        "npm run setup:mailhub-staff-env -- --strict --out .ai-runs/mailhub-next-phase/mailhub-staff-env-readiness.json",
        "npm run ops:readiness-refresh -- --plan-only",
      ],
      applyAfterValuesArePresentAndApproved: [
        "npm run setup:mailhub-routing-secrets -- --apply",
        "npm run setup:mailhub-staff-github-config -- --apply",
      ],
      proofAfterSmtpSecretsArePresentAndApproved: [
        "npm run probe:routing-preflight -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-preflight.json",
        "npm run probe:routing-send -- --send --verify-after-send --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-send.json",
        "npm run ops:readiness-refresh -- --rules-source sheets",
      ],
    },
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    outPath: args.out,
    productionReady: result.readiness.productionReady,
    p0Blockers: result.readiness.p0Blockers,
    p1Blockers: result.readiness.p1Blockers,
    missingExternalSmtpSecrets,
    missingStaffConfig,
    missingStaffSecrets,
  }, null, 2));
}

main();
