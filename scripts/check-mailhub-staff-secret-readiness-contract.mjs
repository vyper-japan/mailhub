#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { isFreshRepoHead } from "./artifact-freshness.mjs";

const repoRoot = process.cwd();
const defaultArtifactPath = join(repoRoot, ".ai-runs", "mailhub-next-phase", "github-staff-secrets-readiness.json");

const REQUIRED_PRODUCTION_RUNTIME = [
  "MAILHUB_ENV",
  "NEXTAUTH_URL",
  "NEXTAUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_SHARED_INBOX_EMAIL",
  "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
];
const REQUIRED_STAFF_ACCESS = ["MAILHUB_ADMINS", "MAILHUB_TEAM_MEMBERS"];
const REQUIRED_DURABLE_STORES = ["MAILHUB_CONFIG_STORE", "MAILHUB_ACTIVITY_STORE"];
const REQUIRED_SHEETS_CONFIG = [
  { label: "MAILHUB_SHEETS_ID or MAILHUB_SHEETS_SPREADSHEET_ID", anyOf: ["MAILHUB_SHEETS_ID", "MAILHUB_SHEETS_SPREADSHEET_ID"] },
  "MAILHUB_SHEETS_CLIENT_EMAIL",
  "MAILHUB_SHEETS_PRIVATE_KEY",
];
const REQUIRED_READ_ONLY_GUARD = ["MAILHUB_READ_ONLY"];
const REQUIRED_PRODUCTION_STAFF_CONFIG = [
  ...REQUIRED_PRODUCTION_RUNTIME,
  ...REQUIRED_STAFF_ACCESS,
  ...REQUIRED_DURABLE_STORES,
  ...REQUIRED_SHEETS_CONFIG,
  ...REQUIRED_READ_ONLY_GUARD,
];
const REQUIRED_SECRET_CONFIG = [
  "NEXTAUTH_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
  "MAILHUB_SHEETS_PRIVATE_KEY",
];
const OPTIONAL_RULE_SHEET_CONFIG = ["MAILHUB_SHEETS_TAB_RULES", "MAILHUB_SHEETS_TAB_ASSIGNEE_RULES"];
const REQUIRED_SEMANTIC_VARIABLE_VALUES = {
  MAILHUB_ENV: "production",
  MAILHUB_CONFIG_STORE: "sheets",
  MAILHUB_ACTIVITY_STORE: "sheets",
  MAILHUB_READ_ONLY: "1",
};
const SEMANTIC_VARIABLE_NAMES = Object.keys(REQUIRED_SEMANTIC_VARIABLE_VALUES);
const URL_SEMANTIC_VARIABLE_NAMES = ["NEXTAUTH_URL"];
const STAFF_EMAIL_LIST_VARIABLE_NAMES = REQUIRED_STAFF_ACCESS;
const VALID_SOURCES = new Set(["github_actions_config", "env", "json"]);
const STAFF_GITHUB_SETUP_COMMANDS = [
  "npm run setup:mailhub-staff-github-config",
  "npm run setup:mailhub-staff-github-config -- --apply",
];

function parseArgs(argv) {
  const out = { artifact: defaultArtifactPath, repoHead: "", repoParentHead: "", allowNonGithubSource: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--artifact") out.artifact = argv[++i];
    else if (arg === "--repo-head") out.repoHead = argv[++i];
    else if (arg === "--repo-parent-head") out.repoParentHead = argv[++i];
    else if (arg === "--allow-non-github-source") out.allowNonGithubSource = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/check-mailhub-staff-secret-readiness-contract.mjs [--artifact path] [--repo-head sha] [--repo-parent-head sha] [--allow-non-github-source]");
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
  if (!existsSync(path)) throw new Error(`missing_github_staff_secrets_artifact:${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function requirementLabel(requirement) {
  return typeof requirement === "string" ? requirement : requirement.label;
}

function flattenRequirements(requirements) {
  return requirements.flatMap((requirement) => typeof requirement === "string" ? [requirement] : requirement.anyOf);
}

function sourceCoversRequirement(requirement, sourceMap) {
  if (typeof requirement === "string") return Object.prototype.hasOwnProperty.call(sourceMap, requirement);
  return requirement.anyOf.some((name) => Object.prototype.hasOwnProperty.call(sourceMap, name));
}

function requirementForSourceName(name, requirements) {
  return requirements.find((requirement) => typeof requirement === "string" ? requirement === name : requirement.anyOf.includes(name));
}

function sameArray(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function hasDuplicates(values) {
  return new Set(values).size !== values.length;
}

function expectedMissing(required, present) {
  const presentSet = new Set(present);
  return required.filter((name) => !presentSet.has(name));
}

function validateGroup({ artifact, groupName, required, errors }) {
  const groups = objectValue(artifact.secretGroups);
  const group = objectValue(groups[groupName]);
  const requiredNames = stringArray(group.required);
  const presentNames = stringArray(group.present);
  const missingNames = stringArray(group.missing);
  const expectedMissingNames = expectedMissing(required.map(requirementLabel), presentNames);

  if (!sameArray(requiredNames, required.map(requirementLabel))) errors.push(`secret_group_required_mismatch:${groupName}`);
  if (hasDuplicates(presentNames)) errors.push(`secret_group_duplicate_present:${groupName}`);
  if (presentNames.some((name) => !required.map(requirementLabel).includes(name))) errors.push(`secret_group_unknown_present:${groupName}`);
  if (!sameArray(missingNames, expectedMissingNames)) errors.push(`secret_group_missing_mismatch:${groupName}`);
  if ((group.ready === true) !== (missingNames.length === 0)) errors.push(`secret_group_ready_mismatch:${groupName}`);

  return { presentNames, missingNames, ready: group.ready === true };
}

function isKnownSemanticIssue(issue) {
  if (REQUIRED_SECRET_CONFIG.some((name) => issue === `${name}_must_not_be_variable`)) return true;

  const fixedSemanticIssue = Object.entries(REQUIRED_SEMANTIC_VARIABLE_VALUES).some(([name, expected]) =>
    issue === `${name}_value_unverified` || issue === `${name}_must_be_${expected}` || issue === `${name}_must_be_variable`);
  if (fixedSemanticIssue) return true;

  const urlSemanticIssue = URL_SEMANTIC_VARIABLE_NAMES.some((name) =>
    issue === `${name}_value_unverified` ||
    issue === `${name}_must_be_variable` ||
    issue === `${name}_must_be_valid_url` ||
    issue === `${name}_must_be_https` ||
    issue === `${name}_must_not_be_localhost`);
  if (urlSemanticIssue) return true;

  return STAFF_EMAIL_LIST_VARIABLE_NAMES.some((name) =>
    issue === `${name}_value_unverified` ||
    issue === `${name}_must_be_variable` ||
    issue === `${name}_must_be_non_empty_vtj_email_list` ||
    issue === `${name}_has_invalid_email` ||
    issue === `${name}_has_non_vtj_email`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifact = readJson(args.artifact);
  const errors = [];
  const warnings = [];
  const repoHead = args.repoHead || gitRevParse("HEAD");
  const repoParentHead = args.repoParentHead || gitRevParse("HEAD^");

  const requiredProductionStaffConfig = stringArray(artifact.requiredProductionStaffConfig);
  const requiredSecretConfig = stringArray(artifact.requiredSecretConfig);
  const optionalRuleSheetConfig = stringArray(artifact.optionalRuleSheetConfig);
  const configuredOptionalRuleSheetConfig = stringArray(artifact.configuredOptionalRuleSheetConfig);
  const missingProductionStaffConfig = stringArray(artifact.missingProductionStaffConfig);
  const missingSecretConfig = stringArray(artifact.missingSecretConfig);
  const semanticIssues = stringArray(artifact.semanticIssues);
  const setupCommands = stringArray(artifact.setupCommands);
  const presentRequiredConfigNames = stringArray(artifact.presentRequiredConfigNames);
  const expectedRequired = REQUIRED_PRODUCTION_STAFF_CONFIG.map(requirementLabel);
  const expectedMissing = expectedRequired.filter((name) => !presentRequiredConfigNames.includes(name));
  const expectedMissingSecrets = REQUIRED_SECRET_CONFIG.filter((name) => artifact.presentRequiredConfigSources?.[name] !== "secret");
  const sourceMap = objectValue(artifact.presentRequiredConfigSources);
  const sensitiveSecretVariableIssueNames = REQUIRED_SECRET_CONFIG.filter((name) =>
    semanticIssues.includes(`${name}_must_not_be_variable`));
  const artifactRepoHead = typeof artifact.repoHead === "string" ? artifact.repoHead : null;

  if (typeof artifact.repo !== "string" || artifact.repo.trim() === "") errors.push("missing_repo");
  if (!VALID_SOURCES.has(artifact.source)) errors.push("invalid_source");
  if (!args.allowNonGithubSource && artifact.source !== "github_actions_config") {
    errors.push("production_staff_config_source_not_github_actions");
  }
  if (Number.isNaN(Date.parse(artifact.checkedAt ?? ""))) errors.push("invalid_checked_at");
  if (!artifactRepoHead) errors.push("missing_repo_head");
  else if (!isFreshRepoHead({ repoRoot, artifactRepoHead, repoHead, repoParentHead })) errors.push("stale_repo_head");
  if (!Number.isInteger(artifact.secretCount) || artifact.secretCount < 0) errors.push("invalid_secret_count");
  if (!Number.isInteger(artifact.variableCount) || artifact.variableCount < 0) errors.push("invalid_variable_count");
  if (!sameArray(requiredProductionStaffConfig, expectedRequired)) errors.push("required_production_staff_config_mismatch");
  if (!sameArray(requiredSecretConfig, REQUIRED_SECRET_CONFIG)) errors.push("required_secret_config_mismatch");
  if (!sameArray(optionalRuleSheetConfig, OPTIONAL_RULE_SHEET_CONFIG)) errors.push("optional_rule_sheet_config_mismatch");
  if (configuredOptionalRuleSheetConfig.some((name) => !OPTIONAL_RULE_SHEET_CONFIG.includes(name))) {
    errors.push("unknown_configured_optional_rule_sheet_config");
  }
  if (presentRequiredConfigNames.some((name) => !expectedRequired.includes(name))) errors.push("unknown_present_required_config");
  if (hasDuplicates(presentRequiredConfigNames)) errors.push("duplicate_present_required_config");
  if (!sameArray(missingProductionStaffConfig, expectedMissing)) errors.push("missing_production_staff_config_mismatch");
  if (!sameArray(missingSecretConfig, expectedMissingSecrets)) errors.push("missing_secret_config_mismatch");
  for (const issue of semanticIssues) {
    if (!isKnownSemanticIssue(issue)) errors.push(`unknown_semantic_issue:${issue}`);
  }
  for (const name of sensitiveSecretVariableIssueNames) {
    errors.push(`sensitive_secret_config_present_as_variable:${name}`);
  }
  if ((artifact.readyForSecretBackedStaffConfig === true) !== (missingSecretConfig.length === 0 && sensitiveSecretVariableIssueNames.length === 0)) {
    errors.push("secret_backed_staff_config_ready_mismatch");
  }
  if ((artifact.readyForProductionStaffPreflight === true) !== (missingProductionStaffConfig.length === 0 && missingSecretConfig.length === 0 && semanticIssues.length === 0)) {
    errors.push("production_staff_preflight_ready_mismatch");
  }
  if (artifact.readyForProductionStaffPreflight === true && setupCommands.length > 0) {
    errors.push("ready_staff_config_with_setup_commands");
  }
  if (artifact.readyForProductionStaffPreflight !== true) {
    for (const command of STAFF_GITHUB_SETUP_COMMANDS) {
      if (!setupCommands.includes(command)) errors.push(`missing_staff_github_setup_command:${command}`);
    }
  }
  if (setupCommands.some((command) => command.startsWith("gh secret set ") || command.startsWith("gh variable set "))) {
    errors.push("raw_gh_staff_config_commands_disallowed");
  }
  if ((artifact.secretCount + artifact.variableCount) < Object.keys(sourceMap).length) {
    errors.push("source_count_less_than_required_sources");
  }

  for (const [name, source] of Object.entries(sourceMap)) {
    if (!flattenRequirements(REQUIRED_PRODUCTION_STAFF_CONFIG).includes(name)) errors.push(`unknown_source_config:${name}`);
    if (source !== "secret" && source !== "variable") errors.push(`invalid_source_for_config:${name}`);
    const requirement = requirementForSourceName(name, REQUIRED_PRODUCTION_STAFF_CONFIG);
    if (requirement && !presentRequiredConfigNames.includes(requirementLabel(requirement))) {
      errors.push(`source_without_present_requirement:${name}`);
    }
    if (REQUIRED_SECRET_CONFIG.includes(name) && source !== "secret") {
      errors.push(`secret_config_non_secret_source:${name}`);
    }
    if (SEMANTIC_VARIABLE_NAMES.includes(name) && source !== "variable") {
      errors.push(`semantic_config_non_variable_source:${name}`);
    }
    if (STAFF_EMAIL_LIST_VARIABLE_NAMES.includes(name) && source !== "variable") {
      errors.push(`staff_access_config_non_variable_source:${name}`);
    }
  }

  for (const requirement of REQUIRED_PRODUCTION_STAFF_CONFIG) {
    const label = requirementLabel(requirement);
    if (presentRequiredConfigNames.includes(label) && !sourceCoversRequirement(requirement, sourceMap)) {
      errors.push(`present_required_config_missing_source:${label}`);
    }
  }

  const productionRuntime = validateGroup({ artifact, groupName: "productionRuntime", required: REQUIRED_PRODUCTION_RUNTIME, errors });
  const staffAccess = validateGroup({ artifact, groupName: "staffAccess", required: REQUIRED_STAFF_ACCESS, errors });
  const durableStores = validateGroup({ artifact, groupName: "durableStores", required: REQUIRED_DURABLE_STORES, errors });
  const sheetsConfig = validateGroup({ artifact, groupName: "sheetsConfig", required: REQUIRED_SHEETS_CONFIG, errors });
  const readOnlyGuard = validateGroup({ artifact, groupName: "readOnlyGuard", required: REQUIRED_READ_ONLY_GUARD, errors });
  validateGroup({ artifact, groupName: "sensitiveSecrets", required: REQUIRED_SECRET_CONFIG, errors });

  const expectedPresent = [
    ...productionRuntime.presentNames,
    ...staffAccess.presentNames,
    ...durableStores.presentNames,
    ...sheetsConfig.presentNames,
    ...readOnlyGuard.presentNames,
  ];
  if (!sameArray(presentRequiredConfigNames, expectedPresent)) errors.push("present_required_config_names_mismatch");
  if (artifact.note && String(artifact.note).match(/pass(word)?|token|secret value/i) && !String(artifact.note).includes("never accessible")) {
    warnings.push("note_mentions_sensitive_terms");
  }

  const result = {
    artifactPath: args.artifact,
    repo: artifact.repo ?? null,
    source: artifact.source ?? null,
    artifactRepoHead,
    repoHead,
    repoParentHead,
    secretCount: artifact.secretCount ?? null,
    variableCount: artifact.variableCount ?? null,
    readyForProductionStaffPreflight: artifact.readyForProductionStaffPreflight === true,
    readyForSecretBackedStaffConfig: artifact.readyForSecretBackedStaffConfig === true,
    missingProductionStaffConfig,
    missingSecretConfig,
    semanticIssues,
    setupCommands,
    errors,
    warnings,
    ok: errors.length === 0,
  };

  console.log(JSON.stringify(result, null, 2));
  if (errors.length > 0) process.exitCode = 1;
}

main();
