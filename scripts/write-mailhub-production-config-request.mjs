#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const DEFAULT_RUN_DIR = join(".ai-runs", "mailhub-next-phase");
const DEFAULT_OUT = join(DEFAULT_RUN_DIR, "mailhub-production-config-request.json");
const DEFAULT_MARKDOWN_OUT = join(DEFAULT_RUN_DIR, "mailhub-production-config-intake.md");

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
    markdownOut: DEFAULT_MARKDOWN_OUT,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--run-dir") args.runDir = argv[++i] || "";
    else if (arg === "--out") args.out = argv[++i] || "";
    else if (arg === "--markdown-out") args.markdownOut = argv[++i] || "";
    else if (arg === "--no-markdown") args.markdownOut = "";
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/write-mailhub-production-config-request.mjs [--run-dir path] [--out path] [--markdown-out path] [--no-markdown]

Writes a secret-free production configuration request artifact for MailHub readiness blockers.
The artifacts list required key names, action commands, and current blocker ids only.
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

function mdList(values, fallback = "_none_") {
  if (!values?.length) return fallback;
  return values.map((value) => `- \`${value}\``).join("\n");
}

function mdCommandList(values) {
  if (!values?.length) return "_none_";
  return values.map((value) => `- \`${value}\``).join("\n");
}

function statusMark(missing, name) {
  return missing.includes(name) ? "missing" : "not currently missing";
}

function intakeRow({ name, destination, source, constraint, missing }) {
  return `| \`${name}\` | ${destination} | ${source} | ${constraint} | ${statusMark(missing, name)} |`;
}

function blockerIds(readiness, key) {
  const topLevel = array(readiness?.[key]);
  if (topLevel.length > 0) return topLevel;
  return array(readiness?.gate?.[key]);
}

function renderMarkdown(result) {
  const staffMissing = result.currentMissing.staffProductionConfig;
  const smtpMissing = result.currentMissing.externalSmtpSecrets;
  const staffRows = [
    intakeRow({
      name: "MAILHUB_ENV",
      destination: "GitHub variable",
      source: "operator supplied",
      constraint: "`production`",
      missing: staffMissing,
    }),
    intakeRow({
      name: "NEXTAUTH_URL",
      destination: "GitHub variable",
      source: "operator supplied",
      constraint: "HTTPS, non-localhost, production URL",
      missing: staffMissing,
    }),
    intakeRow({
      name: "NEXTAUTH_SECRET",
      destination: "GitHub secret",
      source: "operator supplied",
      constraint: "production value, never commit",
      missing: staffMissing,
    }),
    intakeRow({
      name: "GOOGLE_CLIENT_ID",
      destination: "GitHub variable",
      source: "existing local/env or operator supplied",
      constraint: "staff runtime primary source must be variable",
      missing: staffMissing,
    }),
    intakeRow({
      name: "GOOGLE_CLIENT_SECRET",
      destination: "GitHub secret",
      source: "existing local/env or operator supplied",
      constraint: "secret only",
      missing: staffMissing,
    }),
    intakeRow({
      name: "GOOGLE_SHARED_INBOX_EMAIL",
      destination: "GitHub variable",
      source: "existing local/env or operator supplied",
      constraint: "staff runtime primary source must be variable",
      missing: staffMissing,
    }),
    intakeRow({
      name: "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
      destination: "GitHub secret",
      source: "existing local/env or operator supplied",
      constraint: "secret only",
      missing: staffMissing,
    }),
    intakeRow({
      name: "MAILHUB_ADMINS",
      destination: "GitHub variable",
      source: "operator confirmed",
      constraint: "non-empty @vtj.co.jp CSV",
      missing: staffMissing,
    }),
    intakeRow({
      name: "MAILHUB_TEAM_MEMBERS",
      destination: "GitHub variable",
      source: "operator supplied",
      constraint: "non-empty @vtj.co.jp CSV, at least one staff user",
      missing: staffMissing,
    }),
    intakeRow({
      name: "MAILHUB_CONFIG_STORE",
      destination: "GitHub variable",
      source: "operator supplied",
      constraint: "`sheets`",
      missing: staffMissing,
    }),
    intakeRow({
      name: "MAILHUB_ACTIVITY_STORE",
      destination: "GitHub variable",
      source: "operator supplied",
      constraint: "`sheets`",
      missing: staffMissing,
    }),
    intakeRow({
      name: "MAILHUB_SHEETS_ID or MAILHUB_SHEETS_SPREADSHEET_ID",
      destination: "GitHub variable",
      source: "operator supplied",
      constraint: "production config/activity spreadsheet",
      missing: staffMissing,
    }),
    intakeRow({
      name: "MAILHUB_SHEETS_CLIENT_EMAIL",
      destination: "GitHub variable",
      source: "operator supplied",
      constraint: "service account email with required read access",
      missing: staffMissing,
    }),
    intakeRow({
      name: "MAILHUB_SHEETS_PRIVATE_KEY",
      destination: "GitHub secret",
      source: "operator supplied",
      constraint: "secret only, never commit",
      missing: staffMissing,
    }),
    intakeRow({
      name: "MAILHUB_READ_ONLY",
      destination: "GitHub variable",
      source: "operator supplied",
      constraint: "`1` for first production rollout",
      missing: staffMissing,
    }),
  ];
  const smtpRows = EXTERNAL_SMTP_REQUIRED_SECRETS.map((name) =>
    intakeRow({
      name,
      destination: "GitHub secret",
      source: "operator supplied",
      constraint: name === "MAILHUB_PROBE_FROM" ? "non-@vtj.co.jp external sender" : "external SMTP proof value",
      missing: smtpMissing,
    }),
  );
  return `# MailHub Production Config Intake

Generated: ${result.generatedAt}

Repo head: \`${result.repoHead ?? "unknown"}\`

This artifact is intentionally value-free. Do not paste production secrets, tokens, private keys, SMTP passwords, or OAuth values into this file.

## Current Gate

- productionReady: \`${result.readiness.productionReady}\`
- P0 blockers:
${mdList(result.readiness.p0Blockers)}
- P1 blockers:
${mdList(result.readiness.p1Blockers)}

## Operator Value Intake

Fill real values only in the approved secret manager, local uncommitted env file, or GitHub Actions UI/CLI after approval. This table tracks required key names and constraints only.

| Key | Destination | Source | Constraint | Current status |
| --- | --- | --- | --- | --- |
${staffRows.join("\n")}

## External Routing Proof Intake

These values are required before the external routing P0 can close. \`MAILHUB_PROBE_FROM\` must prove the current external path, so it cannot be an \`@vtj.co.jp\` sender unless the run is explicitly documented as non-production proof.

| Key | Destination | Source | Constraint | Current status |
| --- | --- | --- | --- | --- |
${smtpRows.join("\n")}

Optional SMTP keys: \`${EXTERNAL_SMTP_OPTIONAL_SECRETS.join("`, `")}\`

## Sheets Rule Source Intake

Required before \`rule_config_source_not_production\` can close:

${mdList(result.requiredInputs.sheetsRuleSource.requiredEnvOrGitHubConfig)}

Default tab names:

- \`MAILHUB_SHEETS_TAB_RULES=ConfigRules\`
- \`MAILHUB_SHEETS_TAB_ASSIGNEE_RULES=ConfigAssigneeRules\`

Run read-only verification first. Do not run Sheets mutation/apply paths without explicit approval.

## Approval Gates

The following remain approval-gated:

- GitHub setup/apply commands that write Actions secrets or variables.
- Any external email send command, including routing probes with \`--send\`.
- Any Sheets mutation/apply path.

Dry-run commands:

${mdCommandList(result.safeCommands.dryRun)}

Apply commands, only after values are present and explicit approval is given:

${mdCommandList(result.safeCommands.applyAfterValuesArePresentAndApproved)}

Routing proof commands, only after external SMTP values are present and explicit approval is given:

${mdCommandList(result.safeCommands.proofAfterSmtpSecretsArePresentAndApproved)}

## Post-Apply Verification

After approved apply/send/read-only Sheets verification, refresh evidence:

- \`npm run ops:readiness-refresh -- --rules-source sheets\`
- \`npm run audit:github-staff-secrets-contract\`
- \`npm run audit:github-routing-secrets-contract\`
- \`npm run audit:mailhub-staff-workflow-contract\`
- \`npm run audit:mailhub-rule-config-next-contract\`
- \`npm run audit:mailhub-routing-proof-contract\`
- \`npm run audit:mailhub-readiness-contract\`
- \`npm run security:scan-artifacts\`

## Missing Now

External SMTP proof:

${mdList(result.currentMissing.externalSmtpSecrets)}

Staff production config:

${mdList(result.currentMissing.staffProductionConfig)}

Staff secret config:

${mdList(result.currentMissing.staffSecretConfig)}
`;
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
  if (args.markdownOut) {
    mkdirSync(dirname(args.markdownOut), { recursive: true });
    writeFileSync(args.markdownOut, renderMarkdown(result), "utf8");
  }
  console.log(JSON.stringify({
    outPath: args.out,
    markdownOutPath: args.markdownOut || null,
    productionReady: result.readiness.productionReady,
    p0Blockers: result.readiness.p0Blockers,
    p1Blockers: result.readiness.p1Blockers,
    missingExternalSmtpSecrets,
    missingStaffConfig,
    missingStaffSecrets,
  }, null, 2));
}

main();
