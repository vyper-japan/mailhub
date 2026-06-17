#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const runDir = join(repoRoot, ".ai-runs", "mailhub-next-phase");
const defaultNextPath = join(runDir, "mailhub-rule-config-next-steps.json");
const defaultReadinessPath = join(runDir, "mailhub-production-readiness-audit.json");
const defaultRulesAuditPath = join(runDir, "gmail-rule-safety-audit.json");

const REQUIRED_ACTION_IDS = [
  "configure_sheets_rule_config_env",
  "configure_gmail_rule_audit_env",
  "verify_rule_sheets_tabs",
  "run_sheets_rule_safety_audit",
  "refresh_rule_and_readiness_artifacts",
];
const RULE_SAFETY_COMMAND =
  "MAILHUB_CONFIG_STORE=sheets npm run audit:gmail-rules -- --config-source sheets --out .ai-runs/mailhub-next-phase/gmail-rule-safety-audit.json --max 100";

function parseArgs(argv) {
  const out = {
    next: defaultNextPath,
    readiness: defaultReadinessPath,
    rulesAudit: defaultRulesAuditPath,
    repoHead: "",
    repoParentHead: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--next") out.next = argv[++i];
    else if (arg === "--readiness") out.readiness = argv[++i];
    else if (arg === "--rules-audit") out.rulesAudit = argv[++i];
    else if (arg === "--repo-head") out.repoHead = argv[++i];
    else if (arg === "--repo-parent-head") out.repoParentHead = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/check-mailhub-rule-config-next-contract.mjs [--next path] [--readiness path] [--rules-audit path] [--repo-head sha] [--repo-parent-head sha]");
      process.exit(0);
    }
  }
  return out;
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

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`missing_${label}:${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function ruleSheetsFromConfig(value) {
  const config = objectValue(value);
  const labelRules = typeof config.labelRules === "string" ? config.labelRules.trim() : "";
  const assigneeRules = typeof config.assigneeRules === "string" ? config.assigneeRules.trim() : "";
  return labelRules && assigneeRules ? [labelRules, assigneeRules] : [];
}

function actionsById(value) {
  const map = new Map();
  if (!Array.isArray(value)) return map;
  for (const item of value) {
    if (!item || typeof item !== "object" || typeof item.id !== "string") continue;
    map.set(item.id, item);
  }
  return map;
}

function isFresh(repoValue, repoHead, repoParentHead) {
  return Boolean(repoValue && repoHead && (repoValue === repoHead || repoValue === repoParentHead));
}

function sameStrings(a, b) {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

function expectActionStatus({ actions, id, expected, errors }) {
  const action = actions.get(id);
  if (!action) {
    errors.push(`missing_next_action:${id}`);
    return;
  }
  if (action.status !== expected) {
    errors.push(`next_action_status_mismatch:${id}:expected_${expected}:actual_${action.status ?? "missing"}`);
  }
}

function actionCommands(action) {
  if (!action || typeof action !== "object") return [];
  return Array.isArray(action.commands) ? action.commands.filter((item) => typeof item === "string") : [];
}

function actionCommand(action) {
  return action && typeof action === "object" && typeof action.command === "string" ? action.command : "";
}

function actionStringArray(action, key) {
  if (!action || typeof action !== "object") return [];
  return stringArray(action[key]);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const next = readJson(args.next, "rule_config_next_artifact");
  const readiness = readJson(args.readiness, "readiness_artifact");
  const rulesAudit = readJson(args.rulesAudit, "rules_audit");
  const errors = [];
  const warnings = [];
  const repoHead = args.repoHead || gitRevParse("HEAD");
  const repoParentHead = args.repoParentHead || gitRevParse("HEAD^");
  const inputs = objectValue(next.inputs);
  const state = objectValue(next.state);
  const missing = objectValue(next.missing);
  const actions = actionsById(next.nextActions);
  const inputErrors = stringArray(inputs.errors);
  const inputWarnings = stringArray(inputs.warnings);
  const readinessRequirements = objectValue(readiness.requirements);
  const readinessInputs = objectValue(readiness.inputs);
  const readinessRuleSource = objectValue(readinessInputs.ruleConfigSource);
  const readinessGate = objectValue(readiness.gate);
  const rulesConfig = objectValue(rulesAudit.config);
  const artifactRepoHead = typeof inputs.repoHead === "string" ? inputs.repoHead : null;
  const readinessRepoHead = typeof inputs.readinessRepoHead === "string" ? inputs.readinessRepoHead : null;
  const actualReadinessRepoHead = typeof readiness.repoHead === "string" ? readiness.repoHead : null;
  const readinessGeneratedAt = typeof readiness.generatedAt === "string" ? readiness.generatedAt : null;
  const inputReadinessGeneratedAt = typeof inputs.readinessGeneratedAt === "string" ? inputs.readinessGeneratedAt : null;
  const rulesAuditGeneratedAt = typeof rulesAudit.generatedAt === "string" ? rulesAudit.generatedAt : null;
  const inputRulesAuditGeneratedAt = typeof inputs.rulesAuditGeneratedAt === "string" ? inputs.rulesAuditGeneratedAt : null;
  const sourceWarnings = stringArray(state.sourceWarnings);
  const requiredRuleSheets = stringArray(state.requiredRuleSheets);
  const auditedRuleSheets = stringArray(state.auditedRuleSheets);
  const missingRuleSheets = stringArray(missing.ruleSheets);
  const missingSheetsConfig = stringArray(missing.sheetsConfig);
  const missingGmailEnv = stringArray(missing.gmailRuleAuditEnv);
  const p0Blockers = stringArray(readinessGate.p0Blockers);
  const p1Blockers = stringArray(readinessGate.p1Blockers);

  if (Number.isNaN(Date.parse(next.generatedAt ?? ""))) errors.push("invalid_generated_at");
  if (inputErrors.length > 0) errors.push(...inputErrors.map((error) => `input_error:${error}`));
  if (!artifactRepoHead) errors.push("missing_artifact_repo_head");
  else if (!isFresh(artifactRepoHead, repoHead, repoParentHead)) errors.push("stale_artifact_repo_head");
  if (!readinessRepoHead) errors.push("missing_input_readiness_repo_head");
  else if (!isFresh(readinessRepoHead, repoHead, repoParentHead)) errors.push("stale_input_readiness_repo_head");
  if (!actualReadinessRepoHead) errors.push("missing_actual_readiness_repo_head");
  else if (readinessRepoHead && actualReadinessRepoHead !== readinessRepoHead) errors.push("readiness_repo_head_mismatch");
  if (!inputReadinessGeneratedAt) errors.push("missing_input_readiness_generated_at");
  else if (readinessGeneratedAt && inputReadinessGeneratedAt !== readinessGeneratedAt) {
    errors.push("readiness_generated_at_mismatch");
  }
  if (!inputRulesAuditGeneratedAt) errors.push("missing_input_rules_audit_generated_at");
  else if (rulesAuditGeneratedAt && inputRulesAuditGeneratedAt !== rulesAuditGeneratedAt) {
    errors.push("rules_audit_generated_at_mismatch");
  }

  for (const id of REQUIRED_ACTION_IDS) {
    if (!actions.has(id)) errors.push(`missing_next_action:${id}`);
  }

  const sourceReady = readinessRequirements.currentRuleConfigSourceProductionReady === true;
  const ruleSafetyReady = readinessRequirements.currentRuleConfigRealDataSafetyReady === true;
  const fingerprintPresent = readinessRequirements.currentRuleConfigFingerprintPresent === true;
  const expectedRequestedSource = typeof readinessRuleSource.requestedSource === "string"
    ? readinessRuleSource.requestedSource
    : (typeof rulesConfig.requestedSource === "string" ? rulesConfig.requestedSource : null);
  const expectedResolvedSource = typeof readinessRuleSource.resolvedSource === "string"
    ? readinessRuleSource.resolvedSource
    : (typeof rulesConfig.resolvedSource === "string" ? rulesConfig.resolvedSource : null);
  const expectedWarnings = stringArray(readinessRuleSource.warnings).length
    ? stringArray(readinessRuleSource.warnings)
    : stringArray(rulesConfig.warnings);
  const rulesAuditRuleSheets = ruleSheetsFromConfig(rulesConfig.ruleSheets);
  const readinessRuleSheets = ruleSheetsFromConfig(readinessRuleSource.ruleSheets);
  const expectedAuditedRuleSheets = readinessRuleSheets.length ? readinessRuleSheets : rulesAuditRuleSheets;
  const canRunAudit = state.canRunSheetsRuleSafetyAudit === true;
  const sheetsEnvReady = state.sheetsConfigEnvReady === true;
  const gmailEnvReady = state.gmailRuleAuditEnvReady === true;

  if (state.currentRuleConfigSourceProductionReady !== sourceReady) errors.push("rule_source_ready_state_mismatch");
  if (state.ruleSafetyReady !== ruleSafetyReady) errors.push("rule_safety_state_mismatch");
  if (state.fingerprintPresent !== fingerprintPresent) errors.push("fingerprint_state_mismatch");
  if ((state.ruleSetFingerprintPresent === true) !== Boolean(readinessInputs.rulesConfigFingerprint ?? rulesConfig.ruleSetFingerprint)) {
    errors.push("rule_fingerprint_present_mismatch");
  }
  if ((state.requestedSource ?? null) !== expectedRequestedSource) errors.push("requested_source_mismatch");
  if ((state.resolvedSource ?? null) !== expectedResolvedSource) errors.push("resolved_source_mismatch");
  if (!sameStrings(sourceWarnings, expectedWarnings)) errors.push("source_warnings_mismatch");
  if (requiredRuleSheets.length !== 2 || requiredRuleSheets.some((sheet) => !sheet.trim())) {
    errors.push("required_rule_sheets_invalid");
  }
  if (!sameStrings(auditedRuleSheets, expectedAuditedRuleSheets)) errors.push("audited_rule_sheets_mismatch");
  if (rulesAuditRuleSheets.length > 0 && !sameStrings(readinessRuleSheets, rulesAuditRuleSheets)) {
    errors.push("readiness_rule_sheets_mismatch");
  }
  if (expectedResolvedSource === "sheets") {
    if (rulesAuditRuleSheets.length !== 2) errors.push("rules_audit_rule_sheets_missing");
    if (readinessRuleSheets.length !== 2) errors.push("readiness_rule_sheets_missing");
    if (!sameStrings(requiredRuleSheets, rulesAuditRuleSheets)) errors.push("required_rule_sheets_audit_mismatch");
  }
  if (sourceReady && (expectedResolvedSource !== "sheets" || expectedWarnings.length > 0)) {
    errors.push("source_ready_without_clean_sheets_source");
  }
  if (!sourceReady && !p0Blockers.includes("rule_config_source_not_production") && !p1Blockers.includes("rule_config_source_not_production")) {
    errors.push("source_not_ready_without_readiness_blocker");
  }
  if (sourceReady && (p0Blockers.includes("rule_config_source_not_production") || p1Blockers.includes("rule_config_source_not_production"))) {
    errors.push("source_ready_with_readiness_blocker");
  }
  if (sheetsEnvReady !== (missingSheetsConfig.length === 0)) errors.push("sheets_env_missing_state_mismatch");
  if (gmailEnvReady !== (missingGmailEnv.length === 0)) errors.push("gmail_env_missing_state_mismatch");
  if (canRunAudit !== (sheetsEnvReady && gmailEnvReady)) errors.push("can_run_audit_gate_mismatch");

  const expectedMissingRuleSheets = expectedWarnings
    .filter((warning) => warning.startsWith("missing_sheet:"))
    .map((warning) => warning.replace("missing_sheet:", ""));
  if (!sameStrings(missingRuleSheets, expectedMissingRuleSheets)) errors.push("missing_rule_sheets_mismatch");
  if (missingRuleSheets.some((sheet) => !requiredRuleSheets.includes(sheet))) {
    errors.push("missing_rule_sheet_not_required");
  }

  expectActionStatus({
    actions,
    id: "configure_sheets_rule_config_env",
    expected: sourceReady || sheetsEnvReady ? "done" : "required",
    errors,
  });
  expectActionStatus({
    actions,
    id: "configure_gmail_rule_audit_env",
    expected: sourceReady || gmailEnvReady ? "done" : "required",
    errors,
  });
  expectActionStatus({
    actions,
    id: "verify_rule_sheets_tabs",
    expected: sourceReady ? "done" : (missingRuleSheets.length > 0 ? "required" : (canRunAudit ? "ready" : "blocked")),
    errors,
  });
  const verifySheetsAction = actions.get("verify_rule_sheets_tabs");
  if (!sameStrings(actionStringArray(verifySheetsAction, "requiredSheets"), sourceReady ? [] : requiredRuleSheets)) {
    errors.push("verify_rule_sheets_required_sheets_mismatch");
  }
  if (!sameStrings(actionStringArray(verifySheetsAction, "missingSheets"), sourceReady ? [] : missingRuleSheets)) {
    errors.push("verify_rule_sheets_missing_sheets_mismatch");
  }
  expectActionStatus({
    actions,
    id: "run_sheets_rule_safety_audit",
    expected: sourceReady ? "done" : (canRunAudit ? "ready" : "blocked"),
    errors,
  });
  expectActionStatus({
    actions,
    id: "refresh_rule_and_readiness_artifacts",
    expected: sourceReady ? "done" : "required",
    errors,
  });

  const auditAction = actions.get("run_sheets_rule_safety_audit");
  if (actionCommand(auditAction) !== RULE_SAFETY_COMMAND) errors.push("rule_safety_command_mismatch");
  const refreshAction = actions.get("refresh_rule_and_readiness_artifacts");
  if (!actionCommands(refreshAction).includes(RULE_SAFETY_COMMAND)) errors.push("refresh_missing_rule_safety_command");
  for (const action of actions.values()) {
    const serialized = JSON.stringify(action);
    if (/MAILHUB_SHEETS_PRIVATE_KEY\s*=/.test(serialized) || /GOOGLE_CLIENT_SECRET\s*=/.test(serialized)) {
      errors.push(`secret_value_command_disallowed:${action.id}`);
    }
  }

  const result = {
    nextPath: args.next,
    readinessPath: args.readiness,
    rulesAuditPath: args.rulesAudit,
    repoHead,
    repoParentHead,
    artifactRepoHead,
    readinessRepoHead,
    actualReadinessRepoHead,
    currentRuleConfigSourceProductionReady: sourceReady,
    requestedSource: expectedRequestedSource,
    resolvedSource: expectedResolvedSource,
    sourceWarnings,
    requiredActions: [...actions.values()].filter((action) => action.status !== "done").map((action) => action.id),
    inputWarnings,
    errors,
    warnings,
    ok: errors.length === 0,
  };

  console.log(JSON.stringify(result, null, 2));
  if (errors.length > 0) process.exitCode = 1;
}

main();
