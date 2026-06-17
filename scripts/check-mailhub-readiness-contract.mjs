#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = process.cwd();
const defaultAuditPath = join(repoRoot, ".ai-runs", "mailhub-next-phase", "mailhub-production-readiness-audit.json");
const STAFF_GITHUB_SETUP_COMMANDS = [
  "npm run setup:mailhub-staff-github-config",
  "npm run setup:mailhub-staff-github-config -- --apply",
];

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

function ruleSheetsFromConfig(value) {
  const config = objectValue(value);
  const labelRules = typeof config.labelRules === "string" ? config.labelRules.trim() : "";
  const assigneeRules = typeof config.assigneeRules === "string" ? config.assigneeRules.trim() : "";
  return labelRules && assigneeRules ? [labelRules, assigneeRules] : [];
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
  const ruleConfigSourceSheets = ruleSheetsFromConfig(ruleConfigSource.ruleSheets);
  const viewSafety = objectValue(audit.viewSafety);
  const gate = objectValue(audit.gate);
  const blockers = Array.isArray(audit.blockers) ? audit.blockers.filter((item) => item && typeof item === "object") : [];
  const p0Blockers = stringArray(gate.p0Blockers);
  const p1Blockers = stringArray(gate.p1Blockers);
  const productionReady = gate.productionReady === true;

  if (!auditRepoHead) errors.push("missing_repo_head");
  else if (repoHead && auditRepoHead !== repoHead && auditRepoHead !== repoParentHead) {
    errors.push("stale_repo_head");
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
    if (requirements.currentSharedGmailRoutingReady !== true) errors.push("production_ready_without_current_shared_gmail_routing");
    if (requirements.routingProbeReady !== true) errors.push("production_ready_without_routing_probe_proof");
    if (requirements.sourceCodeCoverageReady !== true) errors.push("production_ready_without_source_code_coverage");
    if (requirements.sourceInventoryReady !== true) errors.push("production_ready_without_source_inventory");
    if (requirements.defaultViewsRealDataValidated !== true) errors.push("production_ready_without_default_views_validation");
    if (requirements.currentRuleConfigRealDataSafetyReady !== true) errors.push("production_ready_without_rule_safety");
    if (requirements.currentRuleConfigFingerprintPresent !== true) errors.push("production_ready_without_rule_config_fingerprint");
    if (requirements.currentRuleSafetyEnvSourceExplicit !== true) errors.push("production_ready_without_rule_safety_env_source");
    if (requirements.currentRuleConfigSourceProductionReady !== true) errors.push("production_ready_without_production_rule_config_source");
    if (requirements.staffWorkflowPermissionsReady !== true) errors.push("production_ready_without_staff_workflow_permissions");
    if (requirements.staffGithubConfigReady !== true) errors.push("production_ready_without_staff_github_config");
  } else if (p0Blockers.length === 0) {
    errors.push("not_ready_without_p0_blockers");
  }

  if (requirements.currentSharedGmailRoutingReady === true && requirements.routingProbeReady !== true) {
    errors.push("shared_routing_ready_without_routing_probe_proof");
  }

  if (requirements.currentRuleConfigRealDataSafetyReady === true && requirements.currentRuleConfigFingerprintPresent !== true) {
    errors.push("rule_safety_ready_without_config_fingerprint");
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
      if (requirements.currentSharedGmailRoutingReady === true && staffWorkflowBlocker.severity !== "P0") {
        errors.push("staff_workflow_must_be_p0_after_routing_ready");
      }
    }
  } else if (staffWorkflowBlocker) {
    warnings.push("staff_workflow_blocker_detail_present_when_ready");
  }

  const staffGithubConfigBlocker = blockers.find((item) => item.id === "staff_github_config_not_ready");
  if (typeof requirements.staffGithubConfigReady !== "boolean") {
    errors.push("staff_github_config_gate_missing");
  }
  if (githubStaffSecrets) {
    const staffArtifactRepoHead = typeof githubStaffSecrets.repoHead === "string" ? githubStaffSecrets.repoHead : null;
    if (!staffArtifactRepoHead) {
      errors.push("staff_github_config_artifact_missing_repo_head");
    } else if (repoHead && staffArtifactRepoHead !== repoHead && staffArtifactRepoHead !== repoParentHead) {
      errors.push("staff_github_config_artifact_stale_repo_head");
    }
    const artifactReady = githubStaffSecrets.readyForProductionStaffPreflight === true;
    if (typeof requirements.staffGithubConfigReady === "boolean" && requirements.staffGithubConfigReady !== artifactReady) {
      errors.push("staff_github_config_gate_mismatch");
    }
    if (artifactReady && githubStaffSecrets.readyForSecretBackedStaffConfig !== true) {
      errors.push("staff_github_config_ready_without_secret_backing");
    }
    if ((requirements.staffGithubConfigReady === true || productionReady) && repoHead && staffArtifactRepoHead !== repoHead) {
      errors.push("staff_github_config_ready_artifact_requires_current_repo_head");
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
      const hasTrustGap =
        staffGithubConfig.sourceTrusted === false ||
        staffGithubConfig.repoHeadMatchesCurrent === false ||
        staffGithubConfig.readyForSecretBackedStaffConfig === false;
      const setupCommands = stringArray(staffGithubConfig.setupCommands);
      if (typeof staffGithubConfig.readyForProductionStaffPreflight !== "boolean" && !staffGithubConfig.missingArtifact) {
        errors.push("staff_github_config_blocker_missing_ready_flag");
      }
      if (staffGithubConfig.readyForProductionStaffPreflight !== true &&
        missingProductionStaffConfig.length === 0 &&
        missingSecretConfig.length === 0 &&
        semanticIssues.length === 0 &&
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
    const routingProbePreflight = objectValue(evidence.routingProbePreflight);
    const routingProbeGithubSecrets = objectValue(evidence.routingProbeGithubSecrets);
    const mxRecords = Array.isArray(evidence.mxRecords) ? evidence.mxRecords : [];
    const unconfirmed = stringArray(evidence.currentSharedGmailRoutingUnconfirmed);
    const missingAddresses = stringArray(routingProbeGate.missingAddresses);
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
