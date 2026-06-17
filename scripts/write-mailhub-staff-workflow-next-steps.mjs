#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const repoRoot = process.cwd();
const runDir = join(repoRoot, ".ai-runs", "mailhub-next-phase");
const defaults = {
  audit: join(runDir, "mailhub-staff-workflow-audit.json"),
  out: join(runDir, "mailhub-staff-workflow-next-steps.json"),
};

const REQUIRED_PRODUCTION_ENV = [
  "NEXTAUTH_URL",
  "NEXTAUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_SHARED_INBOX_EMAIL",
  "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
];
const REQUIRED_SHEETS_ENV = [
  "MAILHUB_SHEETS_ID or MAILHUB_SHEETS_SPREADSHEET_ID",
  "MAILHUB_SHEETS_CLIENT_EMAIL",
  "MAILHUB_SHEETS_PRIVATE_KEY",
];
const REQUIRED_READONLY_EVIDENCE = [
  "mailhub-meta-topbar-readonly.png",
  "mailhub-meta-health-readonly.png",
  "staff-workflow-evidence-manifest.json",
];
const REQUIRED_WRITE_EVIDENCE = [
  "mailhub-meta-topbar-write.png",
  "mailhub-meta-topbar-back-to-readonly.png",
  "staff-workflow-evidence-manifest.json",
  "activity-YYYYMMDD-prod.csv",
  "gmail-*-*.png",
  "mailhub-*-*.png",
];
const STAFF_ENV_PREFLIGHT_COMMAND = "npm run setup:mailhub-staff-env";

function parseArgs(argv) {
  const out = { ...defaults, strict: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--audit") out.audit = argv[++i];
    else if (arg === "--out") out.out = argv[++i];
    else if (arg === "--strict") out.strict = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/write-mailhub-staff-workflow-next-steps.mjs [--audit path] [--out path] [--strict]");
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

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function status(done, blocked = false) {
  if (done) return "done";
  return blocked ? "blocked" : "required";
}

function productionEnvMissing({ productionEnvReady, missingProductionEnv, environment }) {
  if (productionEnvReady) return [];
  const missing = [...missingProductionEnv];
  if (environment.mailhubEnv !== "production") missing.unshift("MAILHUB_ENV=production");
  if (environment.testMode === true) missing.unshift("MAILHUB_TEST_MODE=0");
  return missing.length ? [...new Set(missing)] : REQUIRED_PRODUCTION_ENV;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const audit = readOptionalJson(args.audit);
  const errors = [];
  const warnings = [];
  if (!audit) errors.push("missing_staff_workflow_audit");

  const environment = objectValue(audit?.environment);
  const config = objectValue(audit?.config);
  const staff = objectValue(audit?.staff);
  const evidence = objectValue(audit?.evidence);
  const requirements = objectValue(audit?.requirements);
  const gate = objectValue(audit?.gate);

  const productionEnvReady = requirements.productionEnvReady === true;
  const adminsReady = requirements.adminsReady === true;
  const staffAccessAllowlistReady = requirements.staffAccessAllowlistReady === true;
  const assigneeRosterReady = requirements.assigneeRosterReady === true;
  const durableConfigReady = requirements.durableConfigReady === true;
  const durableActivityReady = requirements.durableActivityReady === true;
  const readOnlyRolloutEvidenceReady = requirements.readOnlyRolloutEvidenceReady === true;
  const writePilotEvidenceReady = requirements.writePilotEvidenceReady === true;
  const readOnlyRolloutReady = gate.readOnlyRolloutReady === true;
  const controlledWritePilotReady = gate.controlledWritePilotReady === true;
  const staffWorkflowPermissionsReady = gate.staffWorkflowPermissionsReady === true;
  const readOnlyEnabled = environment.readOnly === true;
  const basePrerequisitesReady =
    productionEnvReady &&
    adminsReady &&
    staffAccessAllowlistReady &&
    assigneeRosterReady &&
    durableConfigReady &&
    durableActivityReady;

  const missingProductionEnv = stringArray(config.missingProductionEnv);
  const productionMissing = productionEnvMissing({ productionEnvReady, missingProductionEnv, environment });
  const readonlyMissing = stringArray(evidence.readonlyMissing);
  const readOnlyEvidenceIssues = stringArray(evidence.readOnlyEvidenceIssues);
  const writeMissing = stringArray(evidence.writeMissing);
  const writePilotEvidenceIssues = stringArray(evidence.writePilotEvidenceIssues);
  const activityCsvCount = typeof evidence.activityCsvCount === "number" ? evidence.activityCsvCount : 0;
  const gmailProofCount = typeof evidence.gmailProofCount === "number" ? evidence.gmailProofCount : 0;
  const mailhubProofCount = typeof evidence.mailhubProofCount === "number" ? evidence.mailhubProofCount : 0;
  const writeEvidenceMissing = [
    ...writeMissing,
    ...(activityCsvCount > 0 ? [] : ["activity-YYYYMMDD-prod.csv"]),
    ...(gmailProofCount > 0 ? [] : ["gmail-*-*.png"]),
    ...(mailhubProofCount > 0 ? [] : ["mailhub-*-*.png"]),
  ];

  const result = {
    generatedAt: new Date().toISOString(),
    inputs: {
      audit: args.audit,
      auditGeneratedAt: audit?.generatedAt ?? null,
      auditRepoHead: audit?.repoHead ?? null,
      errors,
      warnings,
    },
    state: {
      staffWorkflowPermissionsReady,
      readOnlyRolloutReady,
      controlledWritePilotReady,
      canCaptureReadOnlyRolloutEvidence: basePrerequisitesReady && readOnlyEnabled,
      canCaptureControlledWritePilotEvidence: basePrerequisitesReady && readOnlyRolloutEvidenceReady,
      productionEnvReady,
      adminsReady,
      staffAccessAllowlistReady,
      assigneeRosterReady,
      durableConfigReady,
      durableActivityReady,
      readOnlyEnabled,
    },
    missing: {
      productionEnv: productionMissing,
      staffAdmins: adminsReady ? [] : ["MAILHUB_ADMINS"],
      staffTeamMembers: staffAccessAllowlistReady ? [] : ["MAILHUB_TEAM_MEMBERS"],
      assigneeRoster: assigneeRosterReady ? [] : ["MAILHUB_TEAM_MEMBERS or .mailhub/assignees.json / ConfigAssignees"],
      durableConfig: durableConfigReady ? [] : ["MAILHUB_CONFIG_STORE=sheets", ...REQUIRED_SHEETS_ENV],
      durableActivity: durableActivityReady ? [] : ["MAILHUB_ACTIVITY_STORE=sheets", ...REQUIRED_SHEETS_ENV],
      readOnlyFlag: readOnlyEnabled ? [] : ["MAILHUB_READ_ONLY=1"],
      readOnlyEvidence: readOnlyRolloutEvidenceReady ? [] : (readOnlyEvidenceIssues.length ? readOnlyEvidenceIssues : (readonlyMissing.length ? readonlyMissing : REQUIRED_READONLY_EVIDENCE)),
      writePilotEvidence: writePilotEvidenceReady ? [] : (writePilotEvidenceIssues.length ? writePilotEvidenceIssues : (writeEvidenceMissing.length ? writeEvidenceMissing : REQUIRED_WRITE_EVIDENCE)),
    },
    present: {
      adminCount: staff.adminCount ?? 0,
      teamMemberCount: staff.teamMemberCount ?? 0,
      assigneeRegistryValidCount: staff.assigneeRegistry?.validCount ?? 0,
      configStore: config.configStore ?? null,
      activityStore: config.activityStore ?? null,
    },
    nextActions: [
      {
        id: "configure_production_env",
        status: status(productionEnvReady),
        description: "Run the staff workflow audit against the production MailHub environment with required auth and shared Gmail env present.",
        requiredEnv: productionMissing,
        commands: productionEnvReady ? [] : [STAFF_ENV_PREFLIGHT_COMMAND],
      },
      {
        id: "configure_staff_access_allowlist",
        status: status(adminsReady && staffAccessAllowlistReady),
        description: "Configure explicit MailHub staff access through admin and team member env.",
        requiredEnv: [
          ...(adminsReady ? [] : ["MAILHUB_ADMINS"]),
          ...(staffAccessAllowlistReady ? [] : ["MAILHUB_TEAM_MEMBERS"]),
        ],
        commands: adminsReady && staffAccessAllowlistReady ? [] : [STAFF_ENV_PREFLIGHT_COMMAND],
      },
      {
        id: "configure_staff_roster",
        status: status(assigneeRosterReady),
        description: "Configure at least one valid @vtj.co.jp assignee through MAILHUB_TEAM_MEMBERS or the assignee registry.",
      },
      {
        id: "configure_durable_staff_stores",
        status: status(durableConfigReady && durableActivityReady),
        description: "Use Sheets-backed config and Activity stores before production staff rollout or write pilot.",
        requiredEnv: [
          ...(durableConfigReady ? [] : ["MAILHUB_CONFIG_STORE=sheets"]),
          ...(durableActivityReady ? [] : ["MAILHUB_ACTIVITY_STORE=sheets"]),
          ...((durableConfigReady && durableActivityReady) ? [] : REQUIRED_SHEETS_ENV),
        ],
        commands: durableConfigReady && durableActivityReady ? [] : [STAFF_ENV_PREFLIGHT_COMMAND],
      },
      {
        id: "capture_readonly_rollout_evidence",
        status: status(readOnlyRolloutEvidenceReady, !basePrerequisitesReady || !readOnlyEnabled),
        description: "Capture production READ ONLY rollout evidence before any controlled write pilot.",
        requiredEnv: readOnlyEnabled ? [] : ["MAILHUB_READ_ONLY=1"],
        requiredEvidence: readOnlyRolloutEvidenceReady ? [] : (readOnlyEvidenceIssues.length ? readOnlyEvidenceIssues : (readonlyMissing.length ? readonlyMissing : REQUIRED_READONLY_EVIDENCE)),
        commands: readOnlyRolloutEvidenceReady ? [] : [STAFF_ENV_PREFLIGHT_COMMAND],
      },
      {
        id: "capture_controlled_write_pilot",
        status: status(writePilotEvidenceReady, !basePrerequisitesReady || !readOnlyRolloutEvidenceReady),
        description: "Capture a controlled production write pilot with MailHub, Gmail, and Activity evidence.",
        requiredEvidence: writePilotEvidenceReady ? [] : (writePilotEvidenceIssues.length ? writePilotEvidenceIssues : (writeEvidenceMissing.length ? writeEvidenceMissing : REQUIRED_WRITE_EVIDENCE)),
        commands: [
          "npm run setup:mailhub-staff-manifest -- --captured-by admin@vtj.co.jp --staff-email staff@vtj.co.jp --actor-email staff@vtj.co.jp --message-id <messageId> --action assign --date <YYYYMMDD>",
        ],
      },
      {
        id: "refresh_staff_and_readiness_artifacts",
        status: staffWorkflowPermissionsReady ? "done" : "required",
        commands: [
          "npm run audit:mailhub-staff-workflow -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-audit.json",
          "npm run audit:mailhub-staff-next -- --out .ai-runs/mailhub-next-phase/mailhub-staff-workflow-next-steps.json",
          "npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json",
        ],
      },
    ],
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    outPath: args.out,
    staffWorkflowPermissionsReady,
    readOnlyRolloutReady,
    controlledWritePilotReady,
    canCaptureReadOnlyRolloutEvidence: result.state.canCaptureReadOnlyRolloutEvidence,
    canCaptureControlledWritePilotEvidence: result.state.canCaptureControlledWritePilotEvidence,
    requiredActions: result.nextActions.filter((action) => action.status !== "done").map((action) => action.id),
    inputErrors: errors,
    inputWarnings: warnings,
  }, null, 2));
  if (args.strict && errors.length > 0) process.exitCode = 1;
}

main();
