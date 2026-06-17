#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isFreshRepoHead } from "./artifact-freshness.mjs";

const repoRoot = process.cwd();
const runDir = join(repoRoot, ".ai-runs", "mailhub-next-phase");
const defaults = {
  readiness: join(runDir, "mailhub-production-readiness-audit.json"),
  rulesAudit: join(runDir, "gmail-rule-safety-audit.json"),
  out: join(runDir, "mailhub-rule-config-next-steps.json"),
};

const REQUIRED_SHEETS_ENV = [
  "MAILHUB_SHEETS_CLIENT_EMAIL",
  "MAILHUB_SHEETS_PRIVATE_KEY",
];
const REQUIRED_GMAIL_ENV = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_SHARED_INBOX_EMAIL",
  "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
];
const DEFAULT_RULE_SHEETS = ["ConfigRules", "ConfigAssigneeRules"];
const RULE_SAFETY_COMMAND =
  "MAILHUB_CONFIG_STORE=sheets npm run audit:gmail-rules -- --env-file .env.local --config-source sheets --out .ai-runs/mailhub-next-phase/gmail-rule-safety-audit.json --max 100";

function parseArgs(argv) {
  const out = {
    ...defaults,
    localEnvFile: join(repoRoot, ".env.local"),
    strict: false,
    repoHead: "",
    repoParentHead: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--readiness") out.readiness = argv[++i];
    else if (arg === "--rules-audit") out.rulesAudit = argv[++i];
    else if (arg === "--out") out.out = argv[++i];
    else if (arg === "--local-env-file") out.localEnvFile = argv[++i];
    else if (arg === "--strict") out.strict = true;
    else if (arg === "--repo-head") out.repoHead = argv[++i];
    else if (arg === "--repo-parent-head") out.repoParentHead = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/write-mailhub-rule-config-next-steps.mjs [--readiness path] [--rules-audit path] [--out path] [--local-env-file path] [--strict] [--repo-head sha] [--repo-parent-head sha]");
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
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

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function ruleSheetsFromConfig(value) {
  const config = objectValue(value);
  const labelRules = typeof config.labelRules === "string" ? config.labelRules.trim() : "";
  const assigneeRules = typeof config.assigneeRules === "string" ? config.assigneeRules.trim() : "";
  return labelRules && assigneeRules ? [labelRules, assigneeRules] : [];
}

function valueFor(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function missingEnv(names) {
  return names.filter((name) => !valueFor(name));
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

function actionStatus(ready, blocked = false) {
  if (ready) return "done";
  return blocked ? "blocked" : "required";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const localEnvFileLoaded = loadEnvFile(args.localEnvFile);
  const readiness = readOptionalJson(args.readiness);
  const rulesAudit = readOptionalJson(args.rulesAudit);
  const repoHead = args.repoHead || gitRevParse("HEAD");
  const repoParentHead = args.repoParentHead || gitRevParse("HEAD^");
  const readinessRepoHead = typeof readiness?.repoHead === "string" ? readiness.repoHead : null;
  const rulesConfig = rulesAudit?.config && typeof rulesAudit.config === "object" ? rulesAudit.config : {};
  const readinessRuleSource =
    readiness?.inputs?.ruleConfigSource && typeof readiness.inputs.ruleConfigSource === "object"
      ? readiness.inputs.ruleConfigSource
      : {};
  const inputErrors = [];
  const inputWarnings = [];

  if (!readiness) inputErrors.push("missing_readiness_artifact");
  if (!rulesAudit) inputErrors.push("missing_rules_audit_artifact");
  if (readiness && !readinessRepoHead) inputErrors.push("readiness_missing_repo_head");
  if (readinessRepoHead && !isFreshRepoHead({ repoRoot, artifactRepoHead: readinessRepoHead, repoHead, repoParentHead })) {
    inputErrors.push("stale_readiness_repo_head");
  }

  const currentRuleConfigSourceProductionReady =
    readiness?.requirements?.currentRuleConfigSourceProductionReady === true;
  const requestedSource =
    typeof readinessRuleSource.requestedSource === "string"
      ? readinessRuleSource.requestedSource
      : (typeof rulesConfig.requestedSource === "string" ? rulesConfig.requestedSource : null);
  const resolvedSource =
    typeof readinessRuleSource.resolvedSource === "string"
      ? readinessRuleSource.resolvedSource
      : (typeof rulesConfig.resolvedSource === "string" ? rulesConfig.resolvedSource : null);
  const sourceWarnings = stringArray(readinessRuleSource.warnings).length
    ? stringArray(readinessRuleSource.warnings)
    : stringArray(rulesConfig.warnings);
  const auditedRuleSheets = ruleSheetsFromConfig(readinessRuleSource.ruleSheets).length
    ? ruleSheetsFromConfig(readinessRuleSource.ruleSheets)
    : ruleSheetsFromConfig(rulesConfig.ruleSheets);
  const ruleSetFingerprint =
    typeof readiness?.inputs?.rulesConfigFingerprint === "string"
      ? readiness.inputs.rulesConfigFingerprint
      : (typeof rulesConfig.ruleSetFingerprint === "string" ? rulesConfig.ruleSetFingerprint : null);
  const ruleSafetyReady = readiness?.requirements?.currentRuleConfigRealDataSafetyReady === true;
  const fingerprintPresent = readiness?.requirements?.currentRuleConfigFingerprintPresent === true;
  const sheetsMissing = [
    ...(!valueFor("MAILHUB_SHEETS_ID") && !valueFor("MAILHUB_SHEETS_SPREADSHEET_ID")
      ? ["MAILHUB_SHEETS_ID or MAILHUB_SHEETS_SPREADSHEET_ID"]
      : []),
    ...missingEnv(REQUIRED_SHEETS_ENV),
  ];
  const gmailMissing = missingEnv(REQUIRED_GMAIL_ENV);
  const configStoreReady = valueFor("MAILHUB_CONFIG_STORE").toLowerCase() === "sheets";
  const sheetsConfigEnvReady = configStoreReady && sheetsMissing.length === 0;
  const gmailRuleAuditEnvReady = gmailMissing.length === 0;
  const canRunSheetsRuleSafetyAudit = sheetsConfigEnvReady && gmailRuleAuditEnvReady;
  const envRuleSheets = [
    valueFor("MAILHUB_SHEETS_TAB_RULES") || DEFAULT_RULE_SHEETS[0],
    valueFor("MAILHUB_SHEETS_TAB_ASSIGNEE_RULES") || DEFAULT_RULE_SHEETS[1],
  ];
  const requiredRuleSheets = auditedRuleSheets.length === 2 ? auditedRuleSheets : envRuleSheets;
  const missingRuleSheets = sourceWarnings
    .filter((warning) => warning.startsWith("missing_sheet:"))
    .map((warning) => warning.replace("missing_sheet:", ""));
  const ruleSheetsChecked = resolvedSource === "sheets";
  const ruleSheetsVerified = currentRuleConfigSourceProductionReady;
  const ruleSheetsVerificationState = ruleSheetsVerified
    ? "verified_clean_sheets_source"
    : (ruleSheetsChecked
        ? (missingRuleSheets.length > 0 ? "checked_missing_sheets" : "checked_sheets_source_warnings")
        : (canRunSheetsRuleSafetyAudit ? "ready_to_check_sheets" : "not_checked_missing_prerequisites"));
  const unverifiedRuleSheets = ruleSheetsChecked ? [] : requiredRuleSheets;

  const result = {
    generatedAt: new Date().toISOString(),
    inputs: {
      readiness: args.readiness,
      rulesAudit: args.rulesAudit,
      readinessGeneratedAt: readiness?.generatedAt ?? null,
      readinessRepoHead,
      rulesAuditGeneratedAt: rulesAudit?.generatedAt ?? null,
      repoHead,
      repoParentHead,
      localEnvFile: args.localEnvFile,
      localEnvFileLoaded,
      valuePolicy: "Secret values are never printed; this artifact contains only key names, booleans, counts, commands, and validation issues.",
      errors: inputErrors,
      warnings: inputWarnings,
    },
    state: {
      currentRuleConfigSourceProductionReady,
      requestedSource,
      resolvedSource,
      sourceWarnings,
      ruleSafetyReady,
      fingerprintPresent,
      ruleSetFingerprintPresent: Boolean(ruleSetFingerprint),
      sheetsConfigEnvReady,
      gmailRuleAuditEnvReady,
      canRunSheetsRuleSafetyAudit,
      auditedRuleSheets,
      requiredRuleSheets,
      requiredRuleSheetsSource: auditedRuleSheets.length === 2 ? "audit" : "env_or_default",
      ruleSheetsChecked,
      ruleSheetsVerified,
      ruleSheetsVerificationState,
    },
    missing: {
      productionConfigStore: currentRuleConfigSourceProductionReady || configStoreReady ? [] : ["MAILHUB_CONFIG_STORE=sheets"],
      sheetsConfig: sheetsConfigEnvReady ? [] : [
        ...(configStoreReady ? [] : ["MAILHUB_CONFIG_STORE=sheets"]),
        ...sheetsMissing,
      ],
      gmailRuleAuditEnv: gmailRuleAuditEnvReady ? [] : gmailMissing,
      ruleSheets: missingRuleSheets,
      unverifiedRuleSheets,
      sourceWarnings: sourceWarnings,
    },
    present: {
      sheetsIdConfigured: Boolean(valueFor("MAILHUB_SHEETS_ID") || valueFor("MAILHUB_SHEETS_SPREADSHEET_ID")),
      sheetsClientEmailConfigured: Boolean(valueFor("MAILHUB_SHEETS_CLIENT_EMAIL")),
      sheetsPrivateKeyConfigured: Boolean(valueFor("MAILHUB_SHEETS_PRIVATE_KEY")),
      configStore: valueFor("MAILHUB_CONFIG_STORE") || null,
      ruleSetFingerprintPresent: Boolean(ruleSetFingerprint),
    },
    nextActions: [
      {
        id: "configure_sheets_rule_config_env",
        status: actionStatus(currentRuleConfigSourceProductionReady || sheetsConfigEnvReady),
        description: "Configure the MailHub rule config audit to read the Sheets-backed production rule config.",
        requiredEnv: currentRuleConfigSourceProductionReady || sheetsConfigEnvReady ? [] : [
          ...(configStoreReady ? [] : ["MAILHUB_CONFIG_STORE=sheets"]),
          ...sheetsMissing,
        ],
        commands: currentRuleConfigSourceProductionReady || sheetsConfigEnvReady ? [] : ["npm run setup:mailhub-staff-env"],
      },
      {
        id: "configure_gmail_rule_audit_env",
        status: actionStatus(currentRuleConfigSourceProductionReady || gmailRuleAuditEnvReady),
        description: "Provide shared Gmail read credentials so the rule safety audit can inspect real INBOX messages.",
        requiredEnv: currentRuleConfigSourceProductionReady || gmailRuleAuditEnvReady ? [] : gmailMissing,
      },
      {
        id: "verify_rule_sheets_tabs",
        status: currentRuleConfigSourceProductionReady
          ? "done"
          : (missingRuleSheets.length > 0 ? "required" : (canRunSheetsRuleSafetyAudit ? "ready" : "blocked")),
        description: "Ensure the production Sheets workbook contains the rule tabs used by the rule safety audit.",
        requiredSheets: currentRuleConfigSourceProductionReady ? [] : requiredRuleSheets,
        missingSheets: currentRuleConfigSourceProductionReady ? [] : missingRuleSheets,
        unverifiedSheets: currentRuleConfigSourceProductionReady ? [] : unverifiedRuleSheets,
        verificationState: ruleSheetsVerificationState,
        expected: `${requiredRuleSheets.join(" and ")} can be read without source warnings.`,
      },
      {
        id: "run_sheets_rule_safety_audit",
        status: currentRuleConfigSourceProductionReady ? "done" : (canRunSheetsRuleSafetyAudit ? "ready" : "blocked"),
        command: RULE_SAFETY_COMMAND,
        expected: "config.resolvedSource=sheets, config.warnings=[], and ruleSafetyGate.realDataRuleRiskPass=true",
      },
      {
        id: "refresh_rule_and_readiness_artifacts",
        status: currentRuleConfigSourceProductionReady ? "done" : "required",
        commands: [
          RULE_SAFETY_COMMAND,
          "npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json",
          "npm run audit:mailhub-rule-config-next -- --out .ai-runs/mailhub-next-phase/mailhub-rule-config-next-steps.json",
        ],
      },
    ],
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    outPath: args.out,
    currentRuleConfigSourceProductionReady,
    requestedSource,
    resolvedSource,
    sourceWarnings,
    sheetsConfigEnvReady,
    gmailRuleAuditEnvReady,
    canRunSheetsRuleSafetyAudit,
    requiredActions: result.nextActions.filter((action) => action.status !== "done").map((action) => action.id),
    ruleSheetsVerificationState,
    inputErrors,
    inputWarnings,
  }, null, 2));
  if (args.strict && inputErrors.length > 0) process.exitCode = 1;
}

main();
