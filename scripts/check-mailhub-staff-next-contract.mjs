#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isFreshRepoHead } from "./artifact-freshness.mjs";

const repoRoot = process.cwd();
const runDir = join(repoRoot, ".ai-runs", "mailhub-next-phase");
const defaultNextPath = join(runDir, "mailhub-staff-workflow-next-steps.json");
const defaultAuditPath = join(runDir, "mailhub-staff-workflow-audit.json");

const REQUIRED_ACTION_IDS = [
  "configure_production_env",
  "configure_staff_access_allowlist",
  "configure_staff_roster",
  "configure_durable_staff_stores",
  "capture_readonly_rollout_evidence",
  "capture_controlled_write_pilot",
  "refresh_staff_and_readiness_artifacts",
];
const STAFF_ENV_PREFLIGHT_COMMAND = "npm run setup:mailhub-staff-env";
const REQUIRED_PRODUCTION_ENV = [
  "NEXTAUTH_URL",
  "NEXTAUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_SHARED_INBOX_EMAIL",
  "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
];

function parseArgs(argv) {
  const out = {
    next: defaultNextPath,
    audit: defaultAuditPath,
    repoHead: "",
    repoParentHead: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--next") out.next = argv[++i];
    else if (arg === "--audit") out.audit = argv[++i];
    else if (arg === "--repo-head") out.repoHead = argv[++i];
    else if (arg === "--repo-parent-head") out.repoParentHead = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/check-mailhub-staff-next-contract.mjs [--next path] [--audit path] [--repo-head sha] [--repo-parent-head sha]");
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

function actionsById(value) {
  const map = new Map();
  if (!Array.isArray(value)) return map;
  for (const item of value) {
    if (!item || typeof item !== "object" || typeof item.id !== "string") continue;
    map.set(item.id, item);
  }
  return map;
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

function expectStaffEnvPreflightCommand({ actions, id, required, errors }) {
  const action = actions.get(id);
  if (!action || !required) return;
  if (!actionCommands(action).includes(STAFF_ENV_PREFLIGHT_COMMAND)) {
    errors.push(`missing_staff_env_preflight_command:${id}`);
  }
}

function expectedProductionMissing({ productionEnvReady, auditConfig, auditEnvironment }) {
  if (productionEnvReady) return [];
  const missing = stringArray(auditConfig.missingProductionEnv);
  if (auditEnvironment.mailhubEnv !== "production") missing.unshift("MAILHUB_ENV=production");
  if (auditEnvironment.testMode === true) missing.unshift("MAILHUB_TEST_MODE=0");
  return missing.length ? [...new Set(missing)] : REQUIRED_PRODUCTION_ENV;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const next = readJson(args.next, "staff_next_artifact");
  const audit = readJson(args.audit, "staff_workflow_audit");
  const errors = [];
  const warnings = [];
  const repoHead = args.repoHead || gitRevParse("HEAD");
  const repoParentHead = args.repoParentHead || gitRevParse("HEAD^");
  const inputs = objectValue(next.inputs);
  const state = objectValue(next.state);
  const missing = objectValue(next.missing);
  const present = objectValue(next.present);
  const actions = actionsById(next.nextActions);
  const auditRequirements = objectValue(audit.requirements);
  const auditGate = objectValue(audit.gate);
  const auditConfig = objectValue(audit.config);
  const auditEnvironment = objectValue(audit.environment);
  const auditStaff = objectValue(audit.staff);
  const auditEvidence = objectValue(audit.evidence);
  const inputErrors = stringArray(inputs.errors);
  const inputWarnings = stringArray(inputs.warnings);
  const auditRepoHead = typeof audit.repoHead === "string" ? audit.repoHead : null;
  const inputAuditRepoHead = typeof inputs.auditRepoHead === "string" ? inputs.auditRepoHead : null;
  const auditGeneratedAt = typeof audit.generatedAt === "string" ? audit.generatedAt : null;
  const inputAuditGeneratedAt = typeof inputs.auditGeneratedAt === "string" ? inputs.auditGeneratedAt : null;

  if (Number.isNaN(Date.parse(next.generatedAt ?? ""))) errors.push("invalid_generated_at");
  if (inputErrors.length > 0) errors.push(...inputErrors.map((error) => `input_error:${error}`));
  if (!inputAuditRepoHead) errors.push("missing_input_audit_repo_head");
  else if (!isFreshRepoHead({ repoRoot, artifactRepoHead: inputAuditRepoHead, repoHead, repoParentHead })) {
    errors.push("stale_input_audit_repo_head");
  }
  if (!auditRepoHead) errors.push("missing_actual_audit_repo_head");
  else if (inputAuditRepoHead && auditRepoHead !== inputAuditRepoHead) errors.push("audit_repo_head_mismatch");
  if (!inputAuditGeneratedAt) errors.push("missing_input_audit_generated_at");
  else if (auditGeneratedAt && inputAuditGeneratedAt !== auditGeneratedAt) errors.push("audit_generated_at_mismatch");

  for (const id of REQUIRED_ACTION_IDS) {
    if (!actions.has(id)) errors.push(`missing_next_action:${id}`);
  }

  const productionEnvReady = auditRequirements.productionEnvReady === true;
  const adminsReady = auditRequirements.adminsReady === true;
  const staffAccessAllowlistReady = auditRequirements.staffAccessAllowlistReady === true;
  const assigneeRosterReady = auditRequirements.assigneeRosterReady === true;
  const durableConfigReady = auditRequirements.durableConfigReady === true;
  const durableActivityReady = auditRequirements.durableActivityReady === true;
  const readOnlyRolloutEvidenceReady = auditRequirements.readOnlyRolloutEvidenceReady === true;
  const writePilotEvidenceReady = auditRequirements.writePilotEvidenceReady === true;
  const readOnlyRolloutReady = auditGate.readOnlyRolloutReady === true;
  const controlledWritePilotReady = auditGate.controlledWritePilotReady === true;
  const staffWorkflowPermissionsReady = auditGate.staffWorkflowPermissionsReady === true;
  const readOnlyEnabled = auditEnvironment.readOnly === true;
  const basePrerequisitesReady =
    productionEnvReady &&
    adminsReady &&
    staffAccessAllowlistReady &&
    assigneeRosterReady &&
    durableConfigReady &&
    durableActivityReady;

  if (state.staffWorkflowPermissionsReady !== staffWorkflowPermissionsReady) errors.push("staff_workflow_ready_mismatch");
  if (state.readOnlyRolloutReady !== readOnlyRolloutReady) errors.push("readonly_rollout_ready_mismatch");
  if (state.controlledWritePilotReady !== controlledWritePilotReady) errors.push("controlled_write_ready_mismatch");
  if (state.canCaptureReadOnlyRolloutEvidence !== (basePrerequisitesReady && readOnlyEnabled)) {
    errors.push("readonly_capture_gate_mismatch");
  }
  if (state.canCaptureControlledWritePilotEvidence !== (basePrerequisitesReady && readOnlyRolloutEvidenceReady)) {
    errors.push("controlled_write_capture_gate_mismatch");
  }
  if (state.productionEnvReady !== productionEnvReady) errors.push("production_env_state_mismatch");
  if (state.adminsReady !== adminsReady) errors.push("admins_state_mismatch");
  if (state.staffAccessAllowlistReady !== staffAccessAllowlistReady) errors.push("staff_allowlist_state_mismatch");
  if (state.assigneeRosterReady !== assigneeRosterReady) errors.push("assignee_roster_state_mismatch");
  if (state.durableConfigReady !== durableConfigReady) errors.push("durable_config_state_mismatch");
  if (state.durableActivityReady !== durableActivityReady) errors.push("durable_activity_state_mismatch");
  if (state.readOnlyEnabled !== readOnlyEnabled) errors.push("readonly_flag_state_mismatch");

  const productionMissing = expectedProductionMissing({ productionEnvReady, auditConfig, auditEnvironment });
  if (!sameStrings(stringArray(missing.productionEnv), productionMissing)) {
    errors.push("production_missing_mismatch");
  }
  if (adminsReady !== (stringArray(missing.staffAdmins).length === 0)) errors.push("staff_admins_missing_mismatch");
  if (staffAccessAllowlistReady !== (stringArray(missing.staffTeamMembers).length === 0)) {
    errors.push("staff_team_members_missing_mismatch");
  }
  if (assigneeRosterReady !== (stringArray(missing.assigneeRoster).length === 0)) {
    errors.push("assignee_roster_missing_mismatch");
  }
  if (durableConfigReady !== (stringArray(missing.durableConfig).length === 0)) errors.push("durable_config_missing_mismatch");
  if (durableActivityReady !== (stringArray(missing.durableActivity).length === 0)) {
    errors.push("durable_activity_missing_mismatch");
  }
  if (readOnlyEnabled !== (stringArray(missing.readOnlyFlag).length === 0)) errors.push("readonly_flag_missing_mismatch");
  if (readOnlyRolloutEvidenceReady !== (stringArray(missing.readOnlyEvidence).length === 0)) {
    errors.push("readonly_evidence_missing_mismatch");
  }
  if (writePilotEvidenceReady !== (stringArray(missing.writePilotEvidence).length === 0)) {
    errors.push("write_pilot_evidence_missing_mismatch");
  }

  if ((present.adminCount ?? 0) !== (auditStaff.adminCount ?? 0)) errors.push("present_admin_count_mismatch");
  if ((present.teamMemberCount ?? 0) !== (auditStaff.teamMemberCount ?? 0)) errors.push("present_team_member_count_mismatch");
  if ((present.assigneeRegistryValidCount ?? 0) !== (auditStaff.assigneeRegistry?.validCount ?? 0)) {
    errors.push("present_assignee_registry_count_mismatch");
  }
  if ((present.configStore ?? null) !== (auditConfig.configStore ?? null)) errors.push("present_config_store_mismatch");
  if ((present.activityStore ?? null) !== (auditConfig.activityStore ?? null)) {
    errors.push("present_activity_store_mismatch");
  }
  if (readOnlyRolloutEvidenceReady && stringArray(auditEvidence.readonlyMissing).length > 0) {
    errors.push("readonly_evidence_ready_with_missing_files");
  }
  if (readOnlyRolloutEvidenceReady && stringArray(auditEvidence.readOnlyEvidenceIssues).length > 0) {
    errors.push("readonly_evidence_ready_with_issues");
  }
  const auditEvidenceManifest = objectValue(auditEvidence.manifest);
  if (readOnlyRolloutEvidenceReady && auditEvidenceManifest.readOnlyManifestReady !== true) {
    errors.push("readonly_evidence_ready_without_manifest");
  }
  if (writePilotEvidenceReady) {
    if (stringArray(auditEvidence.writeMissing).length > 0) errors.push("write_pilot_ready_with_missing_meta");
    if (stringArray(auditEvidence.writePilotEvidenceIssues).length > 0) errors.push("write_pilot_ready_with_issues");
    if (auditEvidenceManifest.writePilotManifestReady !== true) errors.push("write_pilot_ready_without_manifest");
    if ((auditEvidence.activityCsvCount ?? 0) < 1) errors.push("write_pilot_ready_without_activity_csv");
    if ((auditEvidence.gmailProofCount ?? 0) < 1) errors.push("write_pilot_ready_without_gmail_proof");
    if ((auditEvidence.mailhubProofCount ?? 0) < 1) errors.push("write_pilot_ready_without_mailhub_proof");
  }

  expectActionStatus({
    actions,
    id: "configure_production_env",
    expected: productionEnvReady ? "done" : "required",
    errors,
  });
  expectStaffEnvPreflightCommand({
    actions,
    id: "configure_production_env",
    required: !productionEnvReady,
    errors,
  });
  expectActionStatus({
    actions,
    id: "configure_staff_access_allowlist",
    expected: adminsReady && staffAccessAllowlistReady ? "done" : "required",
    errors,
  });
  expectStaffEnvPreflightCommand({
    actions,
    id: "configure_staff_access_allowlist",
    required: !(adminsReady && staffAccessAllowlistReady),
    errors,
  });
  expectActionStatus({
    actions,
    id: "configure_staff_roster",
    expected: assigneeRosterReady ? "done" : "required",
    errors,
  });
  expectActionStatus({
    actions,
    id: "configure_durable_staff_stores",
    expected: durableConfigReady && durableActivityReady ? "done" : "required",
    errors,
  });
  expectStaffEnvPreflightCommand({
    actions,
    id: "configure_durable_staff_stores",
    required: !(durableConfigReady && durableActivityReady),
    errors,
  });
  expectActionStatus({
    actions,
    id: "capture_readonly_rollout_evidence",
    expected: readOnlyRolloutEvidenceReady ? "done" : (!basePrerequisitesReady || !readOnlyEnabled ? "blocked" : "required"),
    errors,
  });
  expectStaffEnvPreflightCommand({
    actions,
    id: "capture_readonly_rollout_evidence",
    required: !readOnlyRolloutEvidenceReady,
    errors,
  });
  expectActionStatus({
    actions,
    id: "capture_controlled_write_pilot",
    expected: writePilotEvidenceReady ? "done" : (!basePrerequisitesReady || !readOnlyRolloutEvidenceReady ? "blocked" : "required"),
    errors,
  });
  expectActionStatus({
    actions,
    id: "refresh_staff_and_readiness_artifacts",
    expected: staffWorkflowPermissionsReady ? "done" : "required",
    errors,
  });

  const result = {
    nextPath: args.next,
    auditPath: args.audit,
    repoHead,
    repoParentHead,
    auditRepoHead: inputAuditRepoHead,
    actualAuditRepoHead: auditRepoHead,
    staffWorkflowPermissionsReady,
    readOnlyRolloutReady,
    controlledWritePilotReady,
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
