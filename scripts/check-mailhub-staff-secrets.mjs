#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const DEFAULT_REPO = "vyper-japan/mailhub";

const REQUIRED_PRODUCTION_RUNTIME = [
  "MAILHUB_ENV",
  "NEXTAUTH_URL",
  "NEXTAUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_SHARED_INBOX_EMAIL",
  "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
];

const REQUIRED_STAFF_ACCESS = [
  "MAILHUB_ADMINS",
  "MAILHUB_TEAM_MEMBERS",
];

const REQUIRED_DURABLE_STORES = [
  "MAILHUB_CONFIG_STORE",
  "MAILHUB_ACTIVITY_STORE",
];

const REQUIRED_SHEETS_CONFIG = [
  { label: "MAILHUB_SHEETS_ID or MAILHUB_SHEETS_SPREADSHEET_ID", anyOf: ["MAILHUB_SHEETS_ID", "MAILHUB_SHEETS_SPREADSHEET_ID"] },
  "MAILHUB_SHEETS_CLIENT_EMAIL",
  "MAILHUB_SHEETS_PRIVATE_KEY",
];

const REQUIRED_READ_ONLY_GUARD = [
  "MAILHUB_READ_ONLY",
];

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

const OPTIONAL_RULE_SHEET_CONFIG = [
  "MAILHUB_SHEETS_TAB_RULES",
  "MAILHUB_SHEETS_TAB_ASSIGNEE_RULES",
];
const REQUIRED_SEMANTIC_VARIABLE_VALUES = {
  MAILHUB_ENV: "production",
  MAILHUB_CONFIG_STORE: "sheets",
  MAILHUB_ACTIVITY_STORE: "sheets",
  MAILHUB_READ_ONLY: "1",
};
const SEMANTIC_VARIABLE_NAMES = Object.keys(REQUIRED_SEMANTIC_VARIABLE_VALUES);
const STAFF_EMAIL_LIST_VARIABLE_NAMES = REQUIRED_STAFF_ACCESS;
const STAFF_GITHUB_SETUP_DRY_RUN_COMMAND = "npm run setup:mailhub-staff-github-config";
const STAFF_GITHUB_SETUP_APPLY_COMMAND = "npm run setup:mailhub-staff-github-config -- --apply";

function parseArgs(argv) {
  const args = {
    repo: DEFAULT_REPO,
    configJson: "",
    out: "",
    fromEnv: false,
    failOnMissing: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo") args.repo = argv[++i] || "";
    else if (arg === "--config-json") args.configJson = argv[++i] || "";
    else if (arg === "--out") args.out = argv[++i] || "";
    else if (arg === "--from-env") args.fromEnv = true;
    else if (arg === "--no-fail") args.failOnMissing = false;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/check-mailhub-staff-secrets.mjs [--repo owner/name] [--config-json path] [--from-env] [--out path] [--no-fail]");
      process.exit(0);
    }
  }
  return args;
}

function normalizeItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return { name: item };
      if (item && typeof item === "object" && typeof item.name === "string") {
        return {
          name: item.name,
          updatedAt: item.updatedAt,
          value: typeof item.value === "string" ? item.value : undefined,
        };
      }
      return null;
    })
    .filter(Boolean);
}

function readConfigJson(path) {
  if (!existsSync(path)) throw new Error(`missing_config_json:${path}`);
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (Array.isArray(parsed)) return { secrets: normalizeItems(parsed), variables: [] };
  return {
    secrets: normalizeItems(parsed.secrets),
    variables: normalizeItems(parsed.variables),
  };
}

function readGhList(kind, repo) {
  const args = kind === "secrets"
    ? ["secret", "list", "--repo", repo, "--app", "actions", "--json", "name,updatedAt"]
    : ["variable", "list", "--repo", repo, "--json", "name,updatedAt,value"];
  const raw = execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const parsed = JSON.parse(raw);
  return normalizeItems(parsed);
}

function readGitHubConfig(repo) {
  return {
    secrets: readGhList("secrets", repo),
    variables: readGhList("variables", repo),
  };
}

function currentRepoHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function readEnvConfig() {
  const names = new Set([
    ...flattenRequirements(REQUIRED_PRODUCTION_STAFF_CONFIG),
    ...OPTIONAL_RULE_SHEET_CONFIG,
  ]);
  return {
    secrets: [],
    variables: [...names]
      .filter((name) => typeof process.env[name] === "string" && process.env[name].trim())
      .map((name) => ({ name, value: process.env[name]?.trim() })),
  };
}

function requirementLabel(requirement) {
  return typeof requirement === "string" ? requirement : requirement.label;
}

function flattenRequirements(requirements) {
  return requirements.flatMap((requirement) => typeof requirement === "string" ? [requirement] : requirement.anyOf);
}

function requirementSatisfied(requirement, present) {
  if (typeof requirement === "string") return present.has(requirement);
  return requirement.anyOf.some((name) => present.has(name));
}

function presentRequirementNames(requirements, present) {
  return requirements.filter((requirement) => requirementSatisfied(requirement, present)).map(requirementLabel);
}

function missingRequirementNames(requirements, present) {
  return requirements.filter((requirement) => !requirementSatisfied(requirement, present)).map(requirementLabel);
}

function missingSecretConfigNames(names, secretNames) {
  return names.filter((name) => !secretNames.has(name));
}

function groupReadiness(requirements, present) {
  const required = requirements.map(requirementLabel);
  const presentNames = presentRequirementNames(requirements, present);
  const missing = missingRequirementNames(requirements, present);
  return {
    required,
    present: presentNames,
    missing,
    ready: missing.length === 0,
  };
}

function sourceForName(name, secretNames, variableNames) {
  if (secretNames.has(name)) return "secret";
  if (variableNames.has(name)) return "variable";
  return null;
}

function configuredOptional(names, present) {
  return names.filter((name) => present.has(name));
}

function splitCsv(raw) {
  return raw
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseEmailList(raw) {
  return splitCsv(raw).map((entry) => {
    const match = entry.match(/^(.+?)\s*<(.+?)>$/) || entry.match(/^(\S+@\S+)$/);
    const email = (match ? (match[2] ?? match[1]) : entry).toLowerCase().trim();
    return {
      valid: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
      vtj: email.endsWith("@vtj.co.jp"),
    };
  });
}

function fixedSemanticIssues(variables, secretNames) {
  return Object.entries(REQUIRED_SEMANTIC_VARIABLE_VALUES).flatMap(([name, expected]) => {
    const issues = [];
    const item = variables.find((variable) => variable.name === name);
    if (secretNames.has(name)) issues.push(`${name}_must_be_variable`);
    if (!item) return issues;
    if (typeof item.value !== "string") return [...issues, `${name}_value_unverified`];
    return item.value === expected ? issues : [...issues, `${name}_must_be_${expected}`];
  });
}

function staffEmailListSemanticIssues(variables, secretNames) {
  return STAFF_EMAIL_LIST_VARIABLE_NAMES.flatMap((name) => {
    const issues = [];
    const item = variables.find((variable) => variable.name === name);
    if (secretNames.has(name)) issues.push(`${name}_must_be_variable`);
    if (!item) return issues;
    if (typeof item.value !== "string") return [...issues, `${name}_value_unverified`];

    const entries = parseEmailList(item.value);
    if (entries.length === 0) issues.push(`${name}_must_be_non_empty_vtj_email_list`);
    if (entries.some((entry) => !entry.valid)) issues.push(`${name}_has_invalid_email`);
    if (entries.some((entry) => entry.valid && !entry.vtj)) issues.push(`${name}_has_non_vtj_email`);
    return issues;
  });
}

function semanticIssues(variables, secretNames) {
  return [
    ...fixedSemanticIssues(variables, secretNames),
    ...staffEmailListSemanticIssues(variables, secretNames),
  ];
}

function sensitiveSecretVariableIssues(secretNames, variableNames) {
  return REQUIRED_SECRET_CONFIG
    .filter((name) => secretNames.has(name) && variableNames.has(name))
    .map((name) => `${name}_must_not_be_variable`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = args.fromEnv ? readEnvConfig() : args.configJson ? readConfigJson(args.configJson) : readGitHubConfig(args.repo);
  const secretNames = new Set(config.secrets.map((item) => item.name).filter(Boolean));
  const variableNames = new Set(config.variables.map((item) => item.name).filter(Boolean));
  const present = new Set([...secretNames, ...variableNames]);
  const groups = {
    productionRuntime: groupReadiness(REQUIRED_PRODUCTION_RUNTIME, present),
    staffAccess: groupReadiness(REQUIRED_STAFF_ACCESS, present),
    durableStores: groupReadiness(REQUIRED_DURABLE_STORES, present),
    sheetsConfig: groupReadiness(REQUIRED_SHEETS_CONFIG, present),
    readOnlyGuard: groupReadiness(REQUIRED_READ_ONLY_GUARD, present),
    sensitiveSecrets: groupReadiness(REQUIRED_SECRET_CONFIG, secretNames),
  };
  const missingProductionStaffConfig = missingRequirementNames(REQUIRED_PRODUCTION_STAFF_CONFIG, present);
  const missingSecretConfig = missingSecretConfigNames(REQUIRED_SECRET_CONFIG, secretNames);
  const sensitiveSecretVariableIssueCodes = sensitiveSecretVariableIssues(secretNames, variableNames);
  const productionSemanticIssues = [
    ...semanticIssues(config.variables, secretNames),
    ...sensitiveSecretVariableIssueCodes,
  ];
  const readyForSecretBackedStaffConfig = missingSecretConfig.length === 0 && sensitiveSecretVariableIssueCodes.length === 0;
  const readyForProductionStaffPreflight = missingProductionStaffConfig.length === 0 &&
    missingSecretConfig.length === 0 &&
    productionSemanticIssues.length === 0;
  const presentRequiredConfigNames = presentRequirementNames(REQUIRED_PRODUCTION_STAFF_CONFIG, present);
  const presentRequiredConfigSources = Object.fromEntries(
    flattenRequirements(REQUIRED_PRODUCTION_STAFF_CONFIG)
      .filter((name) => present.has(name))
      .map((name) => [name, sourceForName(name, secretNames, variableNames)]),
  );
  const result = {
    repo: args.repo,
    source: args.fromEnv ? "env" : args.configJson ? "json" : "github_actions_config",
    checkedAt: new Date().toISOString(),
    repoHead: currentRepoHead(),
    secretCount: config.secrets.length,
    variableCount: config.variables.length,
    requiredProductionStaffConfig: REQUIRED_PRODUCTION_STAFF_CONFIG.map(requirementLabel),
    requiredSecretConfig: REQUIRED_SECRET_CONFIG,
    optionalRuleSheetConfig: OPTIONAL_RULE_SHEET_CONFIG,
    configuredOptionalRuleSheetConfig: configuredOptional(OPTIONAL_RULE_SHEET_CONFIG, present),
    missingProductionStaffConfig,
    missingSecretConfig,
    semanticIssues: productionSemanticIssues,
    readyForSecretBackedStaffConfig,
    readyForProductionStaffPreflight,
    setupCommands: readyForProductionStaffPreflight
      ? []
      : [STAFF_GITHUB_SETUP_DRY_RUN_COMMAND, STAFF_GITHUB_SETUP_APPLY_COMMAND],
    secretGroups: groups,
    presentRequiredConfigNames,
    presentRequiredConfigSources,
    semanticWarnings: [
      "source_policy:NEXTAUTH_SECRET, GOOGLE_CLIENT_SECRET, GOOGLE_SHARED_INBOX_REFRESH_TOKEN, and MAILHUB_SHEETS_PRIVATE_KEY must be GitHub Actions secrets, not variables",
      "semantic_check:MAILHUB_ENV value must be production",
      "semantic_check:MAILHUB_READ_ONLY value must be 1 before read-only rollout",
      "semantic_check:MAILHUB_CONFIG_STORE and MAILHUB_ACTIVITY_STORE values must be sheets",
      `semantic_source_policy:${SEMANTIC_VARIABLE_NAMES.join(", ")} must be GitHub Actions variables, not secrets`,
      "semantic_check:MAILHUB_ADMINS and MAILHUB_TEAM_MEMBERS must be non-empty @vtj.co.jp email lists",
      `semantic_source_policy:${STAFF_EMAIL_LIST_VARIABLE_NAMES.join(", ")} must be GitHub Actions variables, not secrets`,
    ],
    note: "Only GitHub Actions secret names, variable names, updatedAt metadata, and non-secret semantic check results were printed; secret values are never accessible or printed.",
  };

  console.log(JSON.stringify(result, null, 2));
  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  if (args.failOnMissing && !result.readyForProductionStaffPreflight) process.exitCode = 1;
}

main();
