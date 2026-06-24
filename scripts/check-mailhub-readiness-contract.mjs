#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { isFreshRepoHead } from "./artifact-freshness.mjs";
import {
  alertAutomationWorkflowFresh,
  alertAutomationWorkflowReadiness,
} from "./mailhub-alert-workflow-readiness.mjs";

const repoRoot = process.cwd();
const defaultAuditPath = join(repoRoot, ".ai-runs", "mailhub-next-phase", "mailhub-production-readiness-audit.json");
const STAFF_GITHUB_SETUP_COMMANDS = [
  "npm run setup:mailhub-staff-github-config",
  "npm run setup:mailhub-staff-github-config -- --apply --confirm-apply APPLY_MAILHUB_STAFF_GITHUB_CONFIG",
];
const REQUIRED_SEMANTIC_VARIABLE_NAMES = [
  "MAILHUB_ENV",
  "MAILHUB_CONFIG_STORE",
  "MAILHUB_ACTIVITY_STORE",
  "MAILHUB_READ_ONLY",
];
const STALE_INPUT_BLOCKER_ID = "staleInput";
const INPUT_ARTIFACT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ROUTING_PROOF_MAX_AGE_MS = INPUT_ARTIFACT_MAX_AGE_MS;
const EXPECTED_INPUT_FRESHNESS_SPECS = [
  { key: "sourceAudit", timestampField: "generatedAt", maxAgeMs: INPUT_ARTIFACT_MAX_AGE_MS },
  { key: "opsAudit", timestampField: "generatedAt", maxAgeMs: INPUT_ARTIFACT_MAX_AGE_MS },
  { key: "gwsRoutingAudit", timestampField: "generatedAt", maxAgeMs: INPUT_ARTIFACT_MAX_AGE_MS },
  { key: "routingProbeAudit", timestampField: "generatedAt", maxAgeMs: ROUTING_PROOF_MAX_AGE_MS },
  { key: "routingProbeSend", timestampField: "generatedAt", maxAgeMs: ROUTING_PROOF_MAX_AGE_MS },
  { key: "routingProbePreflight", timestampField: "generatedAt", maxAgeMs: INPUT_ARTIFACT_MAX_AGE_MS },
  { key: "githubRoutingSecrets", timestampField: "checkedAt", maxAgeMs: INPUT_ARTIFACT_MAX_AGE_MS },
  { key: "githubStaffSecrets", timestampField: "checkedAt", maxAgeMs: INPUT_ARTIFACT_MAX_AGE_MS },
  { key: "viewsAudit", timestampField: "generatedAt", maxAgeMs: INPUT_ARTIFACT_MAX_AGE_MS },
  { key: "rulesAudit", timestampField: "generatedAt", maxAgeMs: INPUT_ARTIFACT_MAX_AGE_MS },
  { key: "staffWorkflowAudit", timestampField: "generatedAt", maxAgeMs: INPUT_ARTIFACT_MAX_AGE_MS },
];
const EXPECTED_INPUT_FRESHNESS_KEYS = EXPECTED_INPUT_FRESHNESS_SPECS.map((spec) => spec.key);
const CHILD_MAX_AGE_MS_BY_KEY = new Map(EXPECTED_INPUT_FRESHNESS_SPECS.map((spec) => [spec.key, spec.maxAgeMs]));
const CHILD_TIMESTAMP_FIELD_BY_KEY = new Map(EXPECTED_INPUT_FRESHNESS_SPECS.map((spec) => [spec.key, spec.timestampField]));

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
      console.log("Usage: node scripts/check-mailhub-readiness-contract.mjs [--audit path] [--repo-head sha] [--repo-parent-head sha]");
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
  if (!existsSync(path)) throw new Error(`missing_readiness_audit:${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
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

function childProductionAlertsReady(alerts) {
  const provider = alerts.provider;
  const providerCredentialsReady =
    (provider === "slack" && alerts.slackWebhookConfigured === true) ||
    (provider === "chatwork" && alerts.chatworkTokenConfigured === true && alerts.chatworkRoomConfigured === true);
  return alerts.productionAlertsReady === true &&
    (provider === "slack" || provider === "chatwork") &&
    alerts.providerAllowed === true &&
    alerts.providerConfigured === true &&
    alerts.alertsSecretConfigured === true &&
    providerCredentialsReady &&
    stringArray(alerts.missing).length === 0;
}

function ruleSheetsFromConfig(value) {
  const config = objectValue(value);
  const labelRules = typeof config.labelRules === "string" ? config.labelRules.trim() : "";
  const assigneeRules = typeof config.assigneeRules === "string" ? config.assigneeRules.trim() : "";
  return labelRules && assigneeRules ? [labelRules, assigneeRules] : [];
}

function inputFreshnessEntries(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

function readChildArtifact(path) {
  if (!path || !existsSync(path)) return { present: false, artifact: null, invalidJson: false };
  try {
    return {
      present: true,
      artifact: JSON.parse(readFileSync(path, "utf8")),
      invalidJson: false,
    };
  } catch {
    return { present: true, artifact: null, invalidJson: true };
  }
}

function childTimestampField(key, entry) {
  const pinnedField = CHILD_TIMESTAMP_FIELD_BY_KEY.get(key);
  if (pinnedField) return pinnedField;
  if (typeof entry.timestampField === "string" && entry.timestampField.length > 0) return entry.timestampField;
  return key.startsWith("github") ? "checkedAt" : "generatedAt";
}

function timestampFreshness(value, maxAgeMs, nowMs = Date.now()) {
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return null;
  if (typeof value !== "string" || value.length === 0) {
    return { fresh: false, status: "missing_timestamp", ageMs: null, maxAgeMs };
  }
  const timestampMs = Date.parse(value);
  if (!Number.isFinite(timestampMs)) {
    return { fresh: false, status: "invalid_timestamp", ageMs: null, maxAgeMs };
  }
  const ageMs = nowMs - timestampMs;
  if (ageMs < 0) return { fresh: false, status: "future_timestamp", ageMs, maxAgeMs };
  if (ageMs > maxAgeMs) return { fresh: false, status: "stale_timestamp", ageMs, maxAgeMs };
  return { fresh: true, status: "fresh", ageMs, maxAgeMs };
}

function childInputFreshness(entry, repoHead, repoParentHead, nowMs = Date.now()) {
  const key = typeof entry.key === "string" && entry.key.length > 0 ? entry.key : "unknown";
  const path = typeof entry.path === "string" && entry.path.length > 0 ? entry.path : "";
  const timestampField = childTimestampField(key, entry);
  const maxAgeMs = CHILD_MAX_AGE_MS_BY_KEY.get(key) ?? null;
  const { present, artifact, invalidJson } = readChildArtifact(path);
  const artifactValue = objectValue(artifact);
  const artifactRepoHead = typeof artifactValue.repoHead === "string" && artifactValue.repoHead.length > 0
    ? artifactValue.repoHead
    : null;
  const timestamp = present && !invalidJson && typeof artifactValue[timestampField] === "string"
    ? artifactValue[timestampField]
    : null;
  const timestampInfo = present && !invalidJson ? timestampFreshness(timestamp, maxAgeMs, nowMs) : null;
  const base = {
    key,
    path,
    timestampField,
    timestamp,
    maxAgeMs,
    timestampFresh: timestampInfo ? timestampInfo.fresh : null,
    timestampAgeMs: timestampInfo ? timestampInfo.ageMs : null,
  };

  if (!present) {
    return { ...base, present: false, repoHead: null, repoHeadFresh: null, status: "missing_required", readyForProduction: false };
  }
  if (invalidJson) {
    return { ...base, present: true, repoHead: null, repoHeadFresh: null, status: "invalid_json", readyForProduction: false };
  }
  if (!artifactRepoHead) {
    return { ...base, present: true, repoHead: null, repoHeadFresh: null, status: "missing_repo_head", readyForProduction: false };
  }

  const repoHeadFresh = isFreshRepoHead({ repoRoot, artifactRepoHead, repoHead, repoParentHead });
  const readyForProduction = repoHeadFresh && (!timestampInfo || timestampInfo.fresh);
  return {
    ...base,
    present: true,
    repoHead: artifactRepoHead,
    repoHeadFresh,
    status: !repoHeadFresh ? "stale_repo_head" : timestampInfo?.status ?? "fresh",
    readyForProduction,
  };
}

function declaredInputPath(inputs, key) {
  const path = inputs[key];
  return typeof path === "string" && path.length > 0 ? path : "";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const audit = readJson(args.audit);
  const errors = [];
  const warnings = [];
  const repoHead = args.repoHead || gitRevParse("HEAD");
  const repoParentHead = args.repoParentHead || gitRevParse("HEAD^");
  const auditRepoHead = typeof audit.repoHead === "string" ? audit.repoHead : null;
  const requirements = objectValue(audit.requirements);
  const inputs = objectValue(audit.inputs);
  const ruleConfigSource = objectValue(inputs.ruleConfigSource);
  const ruleSafetyAuditEnv = objectValue(inputs.ruleSafetyAuditEnv);
  const githubStaffSecretsPath = typeof inputs.githubStaffSecrets === "string" ? inputs.githubStaffSecrets : "";
  const githubStaffSecrets = readOptionalJson(githubStaffSecretsPath);
  const staffWorkflowAuditPath = typeof inputs.staffWorkflowAudit === "string" ? inputs.staffWorkflowAudit : "";
  const staffWorkflowAudit = readOptionalJson(staffWorkflowAuditPath);
  const inputFreshness = inputFreshnessEntries(inputs.inputFreshness);
  const ruleConfigSourceSheets = ruleSheetsFromConfig(ruleConfigSource.ruleSheets);
  const viewSafety = objectValue(audit.viewSafety);
  const gate = objectValue(audit.gate);
  const blockers = Array.isArray(audit.blockers) ? audit.blockers.filter((item) => item && typeof item === "object") : [];
  const p0Blockers = stringArray(gate.p0Blockers);
  const p1Blockers = stringArray(gate.p1Blockers);
  const productionReady = gate.productionReady === true;

  if (!auditRepoHead) errors.push("missing_repo_head");
  else if (!isFreshRepoHead({ repoRoot, artifactRepoHead: auditRepoHead, repoHead, repoParentHead })) {
    errors.push("stale_repo_head");
  }

  const staleInputBlocker = blockers.find((item) => item.id === STALE_INPUT_BLOCKER_ID);
  const staleInputEntriesByKey = new Map();
  const recordStaleInput = (entry) => {
    if (typeof entry.key === "string" && entry.key.length > 0 && !staleInputEntriesByKey.has(entry.key)) {
      staleInputEntriesByKey.set(entry.key, entry);
    }
  };
  if (typeof requirements.inputArtifactsFresh !== "boolean") {
    errors.push("input_artifacts_fresh_gate_missing");
  }
  if (inputFreshness.length === 0) {
    errors.push("input_freshness_metadata_missing");
  }
  for (const key of EXPECTED_INPUT_FRESHNESS_KEYS) {
    if (!inputFreshness.some((entry) => entry.key === key)) {
      errors.push(`input_freshness_missing_entry:${key}`);
    }
  }
  for (const entry of inputFreshness) {
    const key = typeof entry.key === "string" && entry.key.length > 0 ? entry.key : "unknown";
    const entryPath = typeof entry.path === "string" && entry.path.length > 0 ? entry.path : "";
    const declaredPath = declaredInputPath(inputs, key);
    const present = entry.present === true;
    const artifactRepoHead = typeof entry.repoHead === "string" && entry.repoHead.length > 0 ? entry.repoHead : null;
    const status = typeof entry.status === "string" ? entry.status : "";
    const readyForProduction = entry.readyForProduction === true;
    const requiresFreshRepoHead = entry.requiresFreshRepoHead === true;
    const actualInputFreshness = childInputFreshness({
      ...entry,
      path: declaredPath || entryPath,
    }, repoHead, repoParentHead);

    if (typeof entry.key !== "string" || entry.key.length === 0) errors.push("input_freshness_entry_missing_key");
    if (typeof entry.path !== "string" || entry.path.length === 0) errors.push(`input_freshness_entry_missing_path:${key}`);
    if (!declaredPath) {
      errors.push(`input_freshness_missing_declared_path:${key}`);
      recordStaleInput({
        key,
        path: entryPath,
        present: false,
        repoHead: null,
        repoHeadFresh: null,
        status: "missing_declared_input_path",
        readyForProduction: false,
      });
    } else if (entryPath !== declaredPath) {
      errors.push(`input_freshness_path_mismatch:${key}`);
      recordStaleInput({
        ...actualInputFreshness,
        path: declaredPath,
        inputFreshnessPath: entryPath,
        declaredPath,
        status: actualInputFreshness.readyForProduction === true ? "path_mismatch" : actualInputFreshness.status,
        readyForProduction: false,
      });
    }
    if (typeof entry.present !== "boolean") errors.push(`input_freshness_entry_missing_present:${key}`);
    if (typeof entry.readyForProduction !== "boolean") errors.push(`input_freshness_entry_missing_ready:${key}`);
    if (!status) errors.push(`input_freshness_entry_missing_status:${key}`);
    if (readyForProduction && status !== "fresh") errors.push(`input_freshness_ready_with_non_fresh_status:${key}`);
    if (readyForProduction && present && !artifactRepoHead) errors.push(`input_freshness_ready_without_repo_head:${key}`);
    if (!readyForProduction) recordStaleInput(entry);

    if (present && artifactRepoHead) {
      const actuallyFresh = isFreshRepoHead({ repoRoot, artifactRepoHead, repoHead, repoParentHead });
      if (entry.repoHeadFresh !== actuallyFresh) errors.push(`input_freshness_repo_head_fresh_mismatch:${key}`);
      if (!actuallyFresh && readyForProduction) errors.push(`input_freshness_stale_repo_head_ready:${key}`);
    }
    if (present && requiresFreshRepoHead && !artifactRepoHead) {
      errors.push(`input_freshness_missing_repo_head:${key}`);
    }

    if (entry.present !== actualInputFreshness.present) errors.push(`input_freshness_child_present_mismatch:${key}`);
    if (artifactRepoHead !== actualInputFreshness.repoHead) errors.push(`input_freshness_child_repo_head_mismatch:${key}`);
    if (entry.repoHeadFresh !== actualInputFreshness.repoHeadFresh) errors.push(`input_freshness_child_repo_head_fresh_mismatch:${key}`);
    if (status && status !== actualInputFreshness.status) errors.push(`input_freshness_child_status_mismatch:${key}`);
    if (entry.readyForProduction !== actualInputFreshness.readyForProduction) errors.push(`input_freshness_child_ready_mismatch:${key}`);
    if (actualInputFreshness.maxAgeMs !== null) {
      if (entry.timestampField !== actualInputFreshness.timestampField) errors.push(`input_freshness_child_timestamp_field_mismatch:${key}`);
      if (entry.maxAgeMs !== actualInputFreshness.maxAgeMs) errors.push(`input_freshness_max_age_mismatch:${key}`);
      if (entry.timestamp !== actualInputFreshness.timestamp) errors.push(`input_freshness_child_timestamp_mismatch:${key}`);
      if (entry.timestampFresh !== actualInputFreshness.timestampFresh) errors.push(`input_freshness_child_timestamp_fresh_mismatch:${key}`);
      if (actualInputFreshness.timestampFresh !== true && readyForProduction) errors.push(`input_freshness_stale_timestamp_ready:${key}`);
    }
    if (actualInputFreshness.readyForProduction !== true) recordStaleInput(actualInputFreshness);
  }
  const staleInputEntries = [...staleInputEntriesByKey.values()];
  if (requirements.inputArtifactsFresh === true && staleInputEntries.length > 0) {
    errors.push("input_artifacts_fresh_with_stale_inputs");
  }
  if (requirements.inputArtifactsFresh !== true) {
    if (!p0Blockers.includes(STALE_INPUT_BLOCKER_ID)) {
      errors.push("input_artifacts_not_fresh_without_stale_input_blocker");
    }
    if (!staleInputBlocker) {
      errors.push("stale_input_blocker_missing_detail");
    } else {
      const evidence = objectValue(staleInputBlocker.evidence);
      const staleInputs = inputFreshnessEntries(evidence.staleInputs);
      if (staleInputs.length === 0) errors.push("stale_input_blocker_missing_stale_inputs");
      if (typeof evidence.currentRepoHead !== "string") errors.push("stale_input_blocker_missing_current_repo_head");
      for (const entry of staleInputEntries) {
        if (!staleInputs.some((staleInput) => staleInput.key === entry.key)) {
          errors.push(`stale_input_blocker_missing_entry:${entry.key ?? "unknown"}`);
        }
      }
    }
  } else if (staleInputBlocker) {
    warnings.push("stale_input_blocker_detail_present_when_ready");
  }

  for (const id of p0Blockers) {
    if (!blockers.some((item) => item.id === id && item.severity === "P0")) {
      errors.push(`missing_p0_blocker_detail:${id}`);
    }
  }
  for (const id of p1Blockers) {
    if (!blockers.some((item) => item.id === id && item.severity === "P1")) {
      errors.push(`missing_p1_blocker_detail:${id}`);
    }
  }

  if (productionReady) {
    if (p0Blockers.length > 0) errors.push("production_ready_with_p0_blockers");
    if (p1Blockers.length > 0) errors.push("production_ready_with_p1_blockers");
    if (requirements.inputArtifactsFresh !== true) errors.push("production_ready_with_stale_inputs");
    if (requirements.currentSharedGmailRoutingReady !== true) errors.push("production_ready_without_current_shared_gmail_routing");
    if (requirements.routingProbeReady !== true) errors.push("production_ready_without_routing_probe_proof");
    if (requirements.routingProbeSendReady !== true) errors.push("production_ready_without_routing_probe_send_artifact");
    if (requirements.routingProofChainReady !== true) errors.push("production_ready_without_routing_proof_chain");
    if (requirements.sourceCodeCoverageReady !== true) errors.push("production_ready_without_source_code_coverage");
    if (requirements.sourceInventoryReady !== true) errors.push("production_ready_without_source_inventory");
    if (requirements.defaultViewsRealDataValidated !== true) errors.push("production_ready_without_default_views_validation");
    if (requirements.currentRuleConfigRealDataSafetyReady !== true) errors.push("production_ready_without_rule_safety");
    if (requirements.currentRuleConfigFingerprintPresent !== true) errors.push("production_ready_without_rule_config_fingerprint");
    if (requirements.currentRuleSafetyEnvSourceExplicit !== true) errors.push("production_ready_without_rule_safety_env_source");
    if (requirements.currentRuleConfigSourceProductionReady !== true) errors.push("production_ready_without_production_rule_config_source");
    if (requirements.productionAlertsReady !== true) errors.push("production_ready_without_alerts");
    if (requirements.productionAlertsAutomationReady !== true) errors.push("production_ready_without_alerts_automation");
    if (requirements.staffWorkflowPermissionsReady !== true) errors.push("production_ready_without_staff_workflow_permissions");
    if (requirements.staffReadOnlyRolloutReady !== true) errors.push("production_ready_without_staff_readonly_rollout");
    if (requirements.staffControlledWritePilotReady !== true) errors.push("production_ready_without_staff_controlled_write_pilot");
    if (requirements.staffWorkflowDurableConfigReady !== true) errors.push("production_ready_without_staff_durable_config");
    if (requirements.staffWorkflowDurableActivityReady !== true) errors.push("production_ready_without_staff_durable_activity");
    if (requirements.staffGithubConfigReady !== true) errors.push("production_ready_without_staff_github_config");
  } else if (p0Blockers.length === 0 && p1Blockers.length === 0) {
    errors.push("not_ready_without_blockers");
  }

  if (requirements.currentSharedGmailRoutingReady === true && requirements.routingProbeReady !== true) {
    errors.push("shared_routing_ready_without_routing_probe_proof");
  }
  if (requirements.currentSharedGmailRoutingReady === true && requirements.routingProbeSendReady !== true) {
    errors.push("shared_routing_ready_without_send_artifact");
  }
  if (requirements.currentSharedGmailRoutingReady === true && requirements.routingProofChainReady !== true) {
    errors.push("shared_routing_ready_without_routing_proof_chain");
  }
  if (requirements.routingProofChainReady === true && requirements.routingProbeReady !== true) {
    errors.push("routing_proof_chain_ready_without_marker_audit");
  }
  if (requirements.routingProofChainReady === true && requirements.routingProbeSendReady !== true) {
    errors.push("routing_proof_chain_ready_without_send_artifact");
  }
  if (typeof requirements.routingProbeSendReady !== "boolean") {
    errors.push("routing_probe_send_gate_missing");
  }
  if (typeof requirements.routingProofChainReady !== "boolean") {
    errors.push("routing_proof_chain_gate_missing");
  }

  if (requirements.currentRuleConfigRealDataSafetyReady === true && requirements.currentRuleConfigFingerprintPresent !== true) {
    errors.push("rule_safety_ready_without_config_fingerprint");
  }
  if (typeof requirements.productionAlertsReady !== "boolean") {
    errors.push("production_alerts_gate_missing");
  }
  if (typeof requirements.productionAlertsAutomationReady !== "boolean") {
    errors.push("production_alerts_automation_gate_missing");
  }
  if (typeof requirements.currentRuleSafetyEnvSourceExplicit !== "boolean") {
    errors.push("rule_safety_env_source_gate_missing");
  }
  const ruleSafetyEnvExplicit = requirements.currentRuleSafetyEnvSourceExplicit === true;
  if (ruleSafetyEnvExplicit) {
    const mode = ruleSafetyAuditEnv.envFileMode;
    if (mode !== "env_file" && mode !== "process_env_only") {
      errors.push("rule_safety_env_source_ready_with_invalid_mode");
    }
    if (mode === "env_file") {
      if (typeof ruleSafetyAuditEnv.envFile !== "string" || !ruleSafetyAuditEnv.envFile.trim()) {
        errors.push("rule_safety_env_file_mode_missing_path");
      }
      if (ruleSafetyAuditEnv.envFileLoaded !== true) {
        errors.push("rule_safety_env_file_mode_not_loaded");
      }
    }
  } else {
    const envSourceBlocker = blockers.find((item) => item.id === "rule_safety_env_source_unverified");
    if (!p0Blockers.includes("rule_safety_env_source_unverified") && !p1Blockers.includes("rule_safety_env_source_unverified")) {
      errors.push("rule_safety_env_source_not_ready_without_blocker");
    }
    if (!envSourceBlocker) {
      errors.push("rule_safety_env_source_blocker_missing_detail");
    } else {
      const evidence = objectValue(envSourceBlocker.evidence);
      const envEvidence = objectValue(evidence.ruleSafetyAuditEnv);
      if (typeof envEvidence.envFileMode !== "string" && envEvidence.envFileMode !== null) {
        errors.push("rule_safety_env_source_blocker_invalid_detail");
      }
    }
  }
  if (typeof requirements.currentRuleConfigSourceProductionReady !== "boolean") {
    errors.push("rule_config_source_gate_missing");
  }
  const ruleConfigSourceBlocker = blockers.find((item) => item.id === "rule_config_source_not_production");
  if (requirements.currentRuleConfigSourceProductionReady !== true) {
    if (!p0Blockers.includes("rule_config_source_not_production") && !p1Blockers.includes("rule_config_source_not_production")) {
      errors.push("rule_config_source_not_ready_without_blocker");
    }
    if (!ruleConfigSourceBlocker) {
      errors.push("rule_config_source_blocker_missing_detail");
    } else {
      const evidence = objectValue(ruleConfigSourceBlocker.evidence);
      const source = objectValue(evidence.ruleConfigSource);
      if (typeof source.resolvedSource !== "string") {
        errors.push("rule_config_source_blocker_missing_resolved_source");
      }
    }
  } else if (ruleConfigSourceBlocker) {
    warnings.push("rule_config_source_blocker_detail_present_when_ready");
  }
  if (requirements.currentRuleConfigSourceProductionReady === true) {
    if (ruleConfigSource.resolvedSource !== "sheets") {
      errors.push("rule_config_source_ready_without_sheets_source");
    }
    if (stringArray(ruleConfigSource.warnings).length > 0) {
      errors.push("rule_config_source_ready_with_warnings");
    }
    if (ruleConfigSourceSheets.length !== 2) {
      errors.push("rule_config_source_ready_without_rule_sheets");
    }
  }

  const alertsBlocker = blockers.find((item) => item.id === "alerts_not_ready");
  if (requirements.productionAlertsReady !== true) {
    if (!p0Blockers.includes("alerts_not_ready") && !p1Blockers.includes("alerts_not_ready")) {
      errors.push("alerts_not_ready_without_blocker");
    }
    if (!alertsBlocker) {
      errors.push("alerts_blocker_missing_detail");
    } else {
      const evidence = objectValue(alertsBlocker.evidence);
      const alerts = objectValue(evidence.alerts);
      if (typeof alerts.provider !== "string") errors.push("alerts_blocker_missing_provider");
      if (typeof alerts.alertsSecretConfigured !== "boolean") errors.push("alerts_blocker_missing_secret_flag");
    }
  } else if (alertsBlocker) {
    warnings.push("alerts_blocker_detail_present_when_ready");
  }

  const alertsAutomationBlocker = blockers.find((item) => item.id === "alerts_automation_not_ready");
  if (requirements.productionAlertsAutomationReady !== true) {
    if (!p0Blockers.includes("alerts_automation_not_ready") && !p1Blockers.includes("alerts_automation_not_ready")) {
      errors.push("alerts_automation_not_ready_without_blocker");
    }
    if (!alertsAutomationBlocker) {
      errors.push("alerts_automation_blocker_missing_detail");
    } else {
      const evidence = objectValue(alertsAutomationBlocker.evidence);
      const alertAutomation = objectValue(evidence.alertAutomation);
      if (typeof alertAutomation.readyForProductionAlerts !== "boolean" && !alertAutomation.missingArtifact) {
        errors.push("alerts_automation_blocker_missing_ready_flag");
      }
      const missingAlertAutomationConfig = stringArray(alertAutomation.missingAlertAutomationConfig);
      const hasTrustGap =
        alertAutomation.sourceTrusted === false ||
        alertAutomation.repoHeadFresh === false ||
        (typeof alertAutomation.repoHeadFresh !== "boolean" && alertAutomation.repoHeadMatchesCurrent === false);
      if (alertAutomation.readyForProductionAlerts !== true &&
        missingAlertAutomationConfig.length === 0 &&
        !hasTrustGap &&
        !alertAutomation.missingArtifact) {
        errors.push("alerts_automation_blocker_missing_gap_detail");
      }
    }
  } else if (alertsAutomationBlocker) {
    warnings.push("alerts_automation_blocker_detail_present_when_ready");
  }

  const syntaxFailedViews = stringArray(viewSafety.syntaxFailedViews);
  const manualReviewOnlyViews = stringArray(viewSafety.manualReviewOnlyViews);
  const bulkUnsafeViews = stringArray(viewSafety.bulkUnsafeViews);
  if (typeof requirements.defaultViewsRealDataValidated !== "boolean") {
    errors.push("default_views_real_data_gate_missing");
  }
  if (typeof requirements.defaultViewsManualReviewOnly !== "boolean") {
    errors.push("default_views_manual_review_gate_missing");
  }
  if (typeof requirements.defaultViewsBulkAutomationSafe !== "boolean") {
    errors.push("default_views_bulk_gate_missing");
  }
  if (requirements.defaultViewsRealDataValidated === true && syntaxFailedViews.length > 0) {
    errors.push("default_views_validated_with_syntax_failures");
  }
  if (requirements.defaultViewsBulkAutomationSafe === false) {
    if (requirements.defaultViewsManualReviewOnly !== true) {
      errors.push("bulk_unsafe_views_not_manual_review_only");
    }
    if (bulkUnsafeViews.length === 0) {
      errors.push("bulk_unsafe_views_missing");
    }
  }
  if (requirements.defaultViewsBulkAutomationSafe === true && bulkUnsafeViews.length > 0) {
    errors.push("bulk_safe_with_unsafe_views");
  }
  if (requirements.defaultViewsManualReviewOnly === true && manualReviewOnlyViews.length === 0) {
    errors.push("manual_review_views_missing");
  }

  const staffWorkflowBlocker = blockers.find((item) => item.id === "staff_workflow_permissions");
  if (typeof requirements.staffReadOnlyRolloutReady !== "boolean") {
    errors.push("staff_readonly_rollout_gate_missing");
  }
  if (typeof requirements.staffControlledWritePilotReady !== "boolean") {
    errors.push("staff_controlled_write_pilot_gate_missing");
  }
  if (typeof requirements.staffWorkflowDurableConfigReady !== "boolean") {
    errors.push("staff_workflow_durable_config_gate_missing");
  }
  if (typeof requirements.staffWorkflowDurableActivityReady !== "boolean") {
    errors.push("staff_workflow_durable_activity_gate_missing");
  }
  if (requirements.staffWorkflowPermissionsReady === true) {
    if (requirements.staffReadOnlyRolloutReady !== true) errors.push("staff_workflow_ready_without_readonly_rollout");
    if (requirements.staffControlledWritePilotReady !== true) errors.push("staff_workflow_ready_without_controlled_write_pilot");
    if (requirements.staffWorkflowDurableConfigReady !== true) errors.push("staff_workflow_ready_without_durable_config");
    if (requirements.staffWorkflowDurableActivityReady !== true) errors.push("staff_workflow_ready_without_durable_activity");
  }
  if (requirements.staffWorkflowPermissionsReady !== true) {
    if (!p0Blockers.includes("staff_workflow_permissions") && !p1Blockers.includes("staff_workflow_permissions")) {
      errors.push("staff_workflow_not_ready_without_blocker");
    }
    if (!staffWorkflowBlocker) {
      errors.push("staff_workflow_blocker_missing_detail");
    } else {
      const evidence = objectValue(staffWorkflowBlocker.evidence);
      const staffWorkflowGate = objectValue(evidence.staffWorkflowGate);
      const staffWorkflowRequirements = objectValue(evidence.staffWorkflowRequirements);
      if (typeof staffWorkflowGate.staffWorkflowPermissionsReady !== "boolean") {
        errors.push("staff_workflow_blocker_missing_gate");
      }
      if (typeof staffWorkflowRequirements.staffWorkflowPermissionsReady !== "boolean") {
        errors.push("staff_workflow_blocker_missing_requirements");
      }
      const aggregatedStaffWorkflow = objectValue(evidence.aggregatedStaffWorkflow);
      if (typeof aggregatedStaffWorkflow.staffWorkflowPermissionsReady !== "boolean") {
        errors.push("staff_workflow_blocker_missing_aggregated_gate");
      }
      if (requirements.currentSharedGmailRoutingReady === true && staffWorkflowBlocker.severity !== "P0") {
        errors.push("staff_workflow_must_be_p0_after_routing_ready");
      }
    }
  } else if (staffWorkflowBlocker) {
    warnings.push("staff_workflow_blocker_detail_present_when_ready");
  }
  if (staffWorkflowAudit) {
    const staffAuditConfig = objectValue(staffWorkflowAudit.config);
    const staffAuditAlerts = objectValue(staffAuditConfig.alerts);
    const staffAuditProductionAlertsReady = childProductionAlertsReady(staffAuditAlerts);
    if (typeof requirements.productionAlertsReady === "boolean" &&
      requirements.productionAlertsReady !== staffAuditProductionAlertsReady) {
      errors.push("production_alerts_gate_mismatch_with_child_config");
    }
    const staffAuditRequirements = objectValue(staffWorkflowAudit.requirements);
    const staffAuditGate = objectValue(staffWorkflowAudit.gate);
    const staffAuditReadOnlyRolloutReady =
      staffAuditGate.readOnlyRolloutReady === true &&
      staffAuditRequirements.readOnlyRolloutReady === true;
    const staffAuditControlledWritePilotReady =
      staffAuditGate.controlledWritePilotReady === true &&
      staffAuditRequirements.controlledWritePilotReady === true;
    const staffAuditPermissionsReady =
      staffAuditGate.staffWorkflowPermissionsReady === true &&
      staffAuditRequirements.staffWorkflowPermissionsReady === true &&
      staffAuditReadOnlyRolloutReady &&
      staffAuditControlledWritePilotReady &&
      staffAuditRequirements.durableConfigReady === true &&
      staffAuditRequirements.durableActivityReady === true;
    if (requirements.staffWorkflowPermissionsReady !== staffAuditPermissionsReady) {
      errors.push("staff_workflow_gate_mismatch_with_child_requirements");
    }
    if (requirements.staffReadOnlyRolloutReady !== staffAuditReadOnlyRolloutReady) {
      errors.push("staff_readonly_rollout_gate_mismatch_with_child_requirements");
    }
    if (requirements.staffControlledWritePilotReady !== staffAuditControlledWritePilotReady) {
      errors.push("staff_controlled_write_pilot_gate_mismatch_with_child_requirements");
    }
    if (requirements.staffWorkflowDurableConfigReady !== (staffAuditRequirements.durableConfigReady === true)) {
      errors.push("staff_workflow_durable_config_gate_mismatch");
    }
    if (requirements.staffWorkflowDurableActivityReady !== (staffAuditRequirements.durableActivityReady === true)) {
      errors.push("staff_workflow_durable_activity_gate_mismatch");
    }
  }

  const staffGithubConfigBlocker = blockers.find((item) => item.id === "staff_github_config_not_ready");
  if (typeof requirements.staffGithubConfigReady !== "boolean") {
    errors.push("staff_github_config_gate_missing");
  }
  if (githubStaffSecrets) {
    const staffArtifactRepoHead = typeof githubStaffSecrets.repoHead === "string" ? githubStaffSecrets.repoHead : null;
    if (!staffArtifactRepoHead) {
      errors.push("staff_github_config_artifact_missing_repo_head");
    } else if (!isFreshRepoHead({ repoRoot, artifactRepoHead: staffArtifactRepoHead, repoHead, repoParentHead })) {
      errors.push("staff_github_config_artifact_stale_repo_head");
    }
    const artifactReady = githubStaffSecrets.readyForProductionStaffPreflight === true;
    const staffArtifactSourceMap = objectValue(githubStaffSecrets.presentRequiredConfigSources);
    const semanticVariableSourceGaps = REQUIRED_SEMANTIC_VARIABLE_NAMES.filter(
      (name) => Object.prototype.hasOwnProperty.call(staffArtifactSourceMap, name) && staffArtifactSourceMap[name] !== "variable",
    );
    const semanticVariableSourcesReady = REQUIRED_SEMANTIC_VARIABLE_NAMES.every(
      (name) => staffArtifactSourceMap[name] === "variable",
    );
    for (const name of semanticVariableSourceGaps) {
      errors.push(`staff_github_config_semantic_non_variable_source:${name}`);
    }
    if (typeof requirements.staffGithubConfigReady === "boolean" && requirements.staffGithubConfigReady !== artifactReady) {
      errors.push("staff_github_config_gate_mismatch");
    }
    const staffAlertAutomationWorkflow = objectValue(githubStaffSecrets.alertAutomationWorkflow);
    const currentAlertAutomationWorkflow = alertAutomationWorkflowReadiness(repoRoot);
    const staffAlertAutomationWorkflowFresh = alertAutomationWorkflowFresh(
      staffAlertAutomationWorkflow,
      currentAlertAutomationWorkflow,
    );
    const artifactAlertAutomationReady =
      githubStaffSecrets.readyForProductionAlerts === true &&
      stringArray(githubStaffSecrets.missingAlertAutomationConfig).length === 0 &&
      staffAlertAutomationWorkflow.ready === true &&
      stringArray(staffAlertAutomationWorkflow.missing).length === 0 &&
      staffAlertAutomationWorkflowFresh;
    if (typeof requirements.productionAlertsAutomationReady === "boolean" &&
      requirements.productionAlertsAutomationReady !== artifactAlertAutomationReady) {
      errors.push("production_alerts_automation_gate_mismatch");
    }
    if (!staffAlertAutomationWorkflowFresh) {
      errors.push("alerts_automation_workflow_fingerprint_mismatch");
    }
    if ((requirements.productionAlertsAutomationReady === true || productionReady) &&
      staffAlertAutomationWorkflow.ready !== true) {
      errors.push("alerts_automation_ready_without_workflow");
    }
    if (artifactReady && githubStaffSecrets.readyForSecretBackedStaffConfig !== true) {
      errors.push("staff_github_config_ready_without_secret_backing");
    }
    if ((artifactReady || requirements.staffGithubConfigReady === true || productionReady) && !semanticVariableSourcesReady) {
      errors.push("staff_github_config_ready_without_semantic_variable_sources");
    }
  }
  if (requirements.staffGithubConfigReady === true || productionReady) {
    if (!githubStaffSecretsPath) {
      errors.push("staff_github_config_input_missing");
    } else if (!githubStaffSecrets) {
      errors.push("staff_github_config_input_artifact_missing");
    } else {
      if (githubStaffSecrets.source !== "github_actions_config") {
        errors.push("staff_github_config_ready_without_github_actions_source");
      }
      if (githubStaffSecrets.readyForProductionStaffPreflight !== true) {
        errors.push("staff_github_config_ready_without_ready_artifact");
      }
      if (githubStaffSecrets.readyForSecretBackedStaffConfig !== true) {
        errors.push("staff_github_config_ready_without_secret_artifact");
      }
    }
  }
  if (requirements.productionAlertsAutomationReady === true || productionReady) {
    if (!githubStaffSecretsPath) {
      errors.push("alerts_automation_input_missing");
    } else if (!githubStaffSecrets) {
      errors.push("alerts_automation_input_artifact_missing");
    } else {
      if (githubStaffSecrets.source !== "github_actions_config") {
        errors.push("alerts_automation_ready_without_github_actions_source");
      }
      if (githubStaffSecrets.readyForProductionAlerts !== true) {
        errors.push("alerts_automation_ready_without_ready_artifact");
      }
      if (objectValue(githubStaffSecrets.alertAutomationWorkflow).ready !== true) {
        errors.push("alerts_automation_ready_without_workflow_artifact");
      }
      if (!alertAutomationWorkflowFresh(
        objectValue(githubStaffSecrets.alertAutomationWorkflow),
        alertAutomationWorkflowReadiness(repoRoot),
      )) {
        errors.push("alerts_automation_ready_without_current_workflow_fingerprint");
      }
    }
  }
  if (requirements.staffGithubConfigReady !== true) {
    if (!p0Blockers.includes("staff_github_config_not_ready") && !p1Blockers.includes("staff_github_config_not_ready")) {
      errors.push("staff_github_config_not_ready_without_blocker");
    }
    if (!staffGithubConfigBlocker) {
      errors.push("staff_github_config_blocker_missing_detail");
    } else {
      const evidence = objectValue(staffGithubConfigBlocker.evidence);
      const staffGithubConfig = objectValue(evidence.staffGithubConfig);
      const missingProductionStaffConfig = stringArray(staffGithubConfig.missingProductionStaffConfig);
      const missingSecretConfig = stringArray(staffGithubConfig.missingSecretConfig);
      const semanticIssues = stringArray(staffGithubConfig.semanticIssues);
      const semanticSourceIssues = stringArray(staffGithubConfig.semanticSourceIssues);
      const hasTrustGap =
        staffGithubConfig.sourceTrusted === false ||
        staffGithubConfig.repoHeadFresh === false ||
        (typeof staffGithubConfig.repoHeadFresh !== "boolean" && staffGithubConfig.repoHeadMatchesCurrent === false) ||
        staffGithubConfig.readyForSecretBackedStaffConfig === false;
      const setupCommands = stringArray(staffGithubConfig.setupCommands);
      if (typeof staffGithubConfig.readyForProductionStaffPreflight !== "boolean" && !staffGithubConfig.missingArtifact) {
        errors.push("staff_github_config_blocker_missing_ready_flag");
      }
      if (staffGithubConfig.readyForProductionStaffPreflight !== true &&
        missingProductionStaffConfig.length === 0 &&
        missingSecretConfig.length === 0 &&
        semanticIssues.length === 0 &&
        semanticSourceIssues.length === 0 &&
        !hasTrustGap &&
        !staffGithubConfig.missingArtifact) {
        errors.push("staff_github_config_blocker_missing_gap_detail");
      }
      if (!staffGithubConfig.missingArtifact) {
        for (const command of STAFF_GITHUB_SETUP_COMMANDS) {
          if (!setupCommands.includes(command)) errors.push(`staff_github_config_blocker_missing_setup_command:${command}`);
        }
        if (setupCommands.some((command) => command.startsWith("gh secret set ") || command.startsWith("gh variable set "))) {
          errors.push("staff_github_config_blocker_raw_gh_commands_disallowed");
        }
      }
      if (requirements.currentSharedGmailRoutingReady === true && staffGithubConfigBlocker.severity !== "P0") {
        errors.push("staff_github_config_must_be_p0_after_routing_ready");
      }
    }
  } else if (staffGithubConfigBlocker) {
    warnings.push("staff_github_config_blocker_detail_present_when_ready");
  }

  const routingBlocker = blockers.find((item) => item.id === "current_shared_gmail_routing");
  if (p0Blockers.includes("current_shared_gmail_routing")) {
    const evidence = objectValue(routingBlocker?.evidence);
    const routingProbeGate = objectValue(evidence.routingProbeGate);
    const routingProbeSend = objectValue(evidence.routingProbeSend);
    const routingProofChain = objectValue(evidence.routingProofChain);
    const routingProbePreflight = objectValue(evidence.routingProbePreflight);
    const routingProbeGithubSecrets = objectValue(evidence.routingProbeGithubSecrets);
    const mxRecords = Array.isArray(evidence.mxRecords) ? evidence.mxRecords : [];
    const unconfirmed = stringArray(evidence.currentSharedGmailRoutingUnconfirmed);
    const missingAddresses = stringArray(routingProbeGate.missingAddresses);
    const routingProofIssues = stringArray(routingProofChain.issues);
    const missingEnv = stringArray(routingProbePreflight.missingRequiredEnv);
    const missingGithubSecrets = stringArray(routingProbeGithubSecrets.missingSendVerifySecrets);

    if (unconfirmed.length === 0) errors.push("routing_blocker_missing_unconfirmed_channels");
    if (mxRecords.length === 0) errors.push("routing_blocker_missing_mx_records");
    if (typeof routingProbeGate.allExpectedAddressesConfirmed !== "boolean") {
      errors.push("routing_blocker_missing_address_probe_gate");
    }
    if ((routingProbeGate.targetAddressCount ?? 0) > 0 && missingAddresses.length === 0 && routingProbeGate.allExpectedAddressesConfirmed !== true) {
      errors.push("routing_blocker_missing_probe_addresses");
    }
    if (requirements.routingProbeSendReady !== true && !routingProbeSend.missingArtifact && typeof routingProbeSend.mode !== "string") {
      errors.push("routing_blocker_missing_send_artifact_gap");
    }
    if (requirements.routingProofChainReady !== true && routingProofIssues.length === 0) {
      errors.push("routing_blocker_missing_proof_chain_gap");
    }
    if (requirements.routingProbePreflightReady !== true && missingEnv.length === 0) {
      errors.push("routing_blocker_missing_preflight_gap");
    }
    if (requirements.routingProbeGithubSecretsReady !== true && missingGithubSecrets.length === 0) {
      errors.push("routing_blocker_missing_github_secret_gap");
    }
  } else if (routingBlocker) {
    warnings.push("routing_blocker_detail_present_without_p0");
  }

  const result = {
    auditPath: args.audit,
    auditRepoHead,
    repoHead,
    repoParentHead,
    productionReady,
    p0Blockers,
    p1Blockers,
    bulkUnsafeViews,
    errors,
    warnings,
    ok: errors.length === 0,
  };

  console.log(JSON.stringify(result, null, 2));
  if (errors.length > 0) process.exitCode = 1;
}

main();
