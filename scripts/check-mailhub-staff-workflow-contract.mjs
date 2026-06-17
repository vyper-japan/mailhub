#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const defaultAuditPath = join(repoRoot, ".ai-runs", "mailhub-next-phase", "mailhub-staff-workflow-audit.json");

function parseArgs(argv) {
  const out = {
    audit: defaultAuditPath,
    repoHead: "",
    repoParentHead: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--audit") out.audit = argv[++i];
    else if (arg === "--repo-head") out.repoHead = argv[++i];
    else if (arg === "--repo-parent-head") out.repoParentHead = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/check-mailhub-staff-workflow-contract.mjs [--audit path] [--repo-head sha] [--repo-parent-head sha]");
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

function readJson(path) {
  if (!existsSync(path)) throw new Error(`missing_staff_workflow_audit:${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function blockers(value) {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object" && typeof item.id === "string")
    : [];
}

function isFresh(repoValue, repoHead, repoParentHead) {
  return Boolean(repoValue && repoHead && (repoValue === repoHead || repoValue === repoParentHead));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const audit = readJson(args.audit);
  const errors = [];
  const warnings = [];
  const repoHead = args.repoHead || gitRevParse("HEAD");
  const repoParentHead = args.repoParentHead || gitRevParse("HEAD^");
  const auditRepoHead = typeof audit.repoHead === "string" ? audit.repoHead : null;
  const environment = objectValue(audit.environment);
  const config = objectValue(audit.config);
  const staff = objectValue(audit.staff);
  const evidence = objectValue(audit.evidence);
  const requirements = objectValue(audit.requirements);
  const gate = objectValue(audit.gate);
  const details = blockers(audit.blockers);
  const p0Blockers = stringArray(gate.p0Blockers);
  const p1Blockers = stringArray(gate.p1Blockers);

  if (Number.isNaN(Date.parse(audit.generatedAt ?? ""))) errors.push("invalid_generated_at");
  if (!auditRepoHead) errors.push("missing_repo_head");
  else if (!isFresh(auditRepoHead, repoHead, repoParentHead)) errors.push("stale_repo_head");

  for (const id of p0Blockers) {
    if (!details.some((item) => item.id === id && item.severity === "P0")) {
      errors.push(`missing_p0_blocker_detail:${id}`);
    }
  }
  for (const id of p1Blockers) {
    if (!details.some((item) => item.id === id && item.severity === "P1")) {
      errors.push(`missing_p1_blocker_detail:${id}`);
    }
  }

  const readOnlyRolloutReady = requirements.readOnlyRolloutReady === true;
  const controlledWritePilotReady = requirements.controlledWritePilotReady === true;
  const staffWorkflowPermissionsReady = requirements.staffWorkflowPermissionsReady === true;

  if ((gate.readOnlyRolloutReady === true) !== readOnlyRolloutReady) errors.push("readonly_rollout_gate_mismatch");
  if ((gate.controlledWritePilotReady === true) !== controlledWritePilotReady) errors.push("controlled_write_gate_mismatch");
  if ((gate.staffWorkflowPermissionsReady === true) !== staffWorkflowPermissionsReady) errors.push("staff_workflow_gate_mismatch");
  if (staffWorkflowPermissionsReady !== (readOnlyRolloutReady && controlledWritePilotReady)) {
    errors.push("staff_workflow_ready_formula_mismatch");
  }

  if (staffWorkflowPermissionsReady) {
    if (environment.mailhubEnv !== "production") errors.push("ready_without_production_env");
    if (environment.testMode === true) errors.push("ready_with_test_mode");
    if (environment.readOnly !== true) errors.push("ready_without_readonly_return_state");
    if (requirements.productionEnvReady !== true) errors.push("ready_without_production_env_requirements");
    if (requirements.adminsReady !== true) errors.push("ready_without_admins");
    if (requirements.assigneeRosterReady !== true) errors.push("ready_without_assignee_roster");
    if (requirements.durableConfigReady !== true) errors.push("ready_without_durable_config");
    if (requirements.durableActivityReady !== true) errors.push("ready_without_durable_activity");
    if (requirements.readOnlyRolloutEvidenceReady !== true) errors.push("ready_without_readonly_evidence");
    if (requirements.writePilotEvidenceReady !== true) errors.push("ready_without_write_pilot_evidence");
    if (p0Blockers.length > 0 || p1Blockers.length > 0) errors.push("ready_with_blockers");
  } else if (p0Blockers.length === 0 && p1Blockers.length === 0) {
    errors.push("not_ready_without_blockers");
  }

  if (requirements.productionEnvReady === true) {
    if (environment.mailhubEnv !== "production") errors.push("production_env_ready_mismatch");
    if (environment.testMode === true) errors.push("production_env_ready_with_test_mode");
    if (stringArray(config.missingProductionEnv).length > 0) errors.push("production_env_ready_with_missing_env");
  }
  if (requirements.adminsReady === true) {
    if (staff.adminsConfigured !== true || (staff.adminCount ?? 0) < 1) errors.push("admins_ready_without_admins");
    if (stringArray(staff.adminInvalid).length > 0) errors.push("admins_ready_with_invalid");
    if (stringArray(staff.adminNonVtj).length > 0) errors.push("admins_ready_with_non_vtj");
  }
  if (requirements.durableConfigReady === true && config.configStore !== "sheets") errors.push("durable_config_not_sheets");
  if (requirements.durableActivityReady === true && config.activityStore !== "sheets") errors.push("durable_activity_not_sheets");
  if (requirements.readOnlyRolloutEvidenceReady === true && stringArray(evidence.readonlyMissing).length > 0) {
    errors.push("readonly_evidence_ready_with_missing_files");
  }
  if (requirements.writePilotEvidenceReady === true) {
    if (stringArray(evidence.writeMissing).length > 0) errors.push("write_evidence_ready_with_missing_meta");
    if ((evidence.activityCsvCount ?? 0) < 1) errors.push("write_evidence_ready_without_activity_csv");
    if ((evidence.gmailProofCount ?? 0) < 1) errors.push("write_evidence_ready_without_gmail_proof");
    if ((evidence.mailhubProofCount ?? 0) < 1) errors.push("write_evidence_ready_without_mailhub_proof");
  }

  const result = {
    auditPath: args.audit,
    auditRepoHead,
    repoHead,
    repoParentHead,
    staffWorkflowPermissionsReady,
    readOnlyRolloutReady,
    controlledWritePilotReady,
    p0Blockers,
    p1Blockers,
    errors,
    warnings,
    ok: errors.length === 0,
  };

  console.log(JSON.stringify(result, null, 2));
  if (errors.length > 0) process.exitCode = 1;
}

main();
