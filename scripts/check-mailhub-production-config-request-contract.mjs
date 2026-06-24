#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isFreshRepoHead } from "./artifact-freshness.mjs";

const repoRoot = process.cwd();
const runDir = join(repoRoot, ".ai-runs", "mailhub-next-phase");
const defaultRequestPath = join(runDir, "mailhub-production-config-request.json");
const defaultReadinessPath = join(runDir, "mailhub-production-readiness-audit.json");

const REQUIRED_ACTIONS = new Map([
  ["apply_routing_probe_github_secrets", {
    sideEffect: "github_mutation",
    confirmationToken: "APPLY_MAILHUB_ROUTING_SECRETS",
    commands: new Set([
      "npm run setup:mailhub-routing-secrets -- --apply --confirm-apply APPLY_MAILHUB_ROUTING_SECRETS --out .ai-runs/mailhub-next-phase/mailhub-routing-secrets-plan.json",
      "npm run setup:mailhub-routing-secrets -- --include-gmail --apply --confirm-apply APPLY_MAILHUB_ROUTING_SECRETS --out .ai-runs/mailhub-next-phase/mailhub-routing-secrets-plan.json",
    ]),
  }],
  ["apply_staff_github_config", {
    sideEffect: "github_mutation",
    confirmationToken: "APPLY_MAILHUB_STAFF_GITHUB_CONFIG",
    commands: new Set([
      "npm run setup:mailhub-staff-github-config -- --apply --confirm-apply APPLY_MAILHUB_STAFF_GITHUB_CONFIG --out .ai-runs/mailhub-next-phase/mailhub-staff-github-config-plan.json",
    ]),
  }],
  ["send_external_routing_probes", {
    sideEffect: "external_mail",
    confirmationToken: "SEND_EXTERNAL_MAILHUB_ROUTING_PROBES",
    commands: new Set([
      "npm run probe:routing-send -- --send --confirm-send SEND_EXTERNAL_MAILHUB_ROUTING_PROBES --verify-after-send --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-send.json",
    ]),
  }],
  ["run_sheets_mutation_paths", {
    sideEffect: "sheets_mutation",
    confirmationToken: "EXPLICIT_OPERATOR_APPROVAL_REQUIRED",
    commands: new Set(["not emitted by this no-secret intake package"]),
  }],
]);

const ALLOWED_ACTION_STATUSES = new Set([
  "ready_after_approval",
  "blocked_missing_values",
  "blocked_requires_separate_approval",
]);

const REQUIRED_DRY_RUN_COMMANDS = [
  "npm run setup:mailhub-routing-secrets -- --out .ai-runs/mailhub-next-phase/mailhub-routing-secrets-plan.json",
  "npm run setup:mailhub-staff-github-config -- --out .ai-runs/mailhub-next-phase/mailhub-staff-github-config-plan.json",
  "npm run setup:mailhub-staff-env -- --strict --out .ai-runs/mailhub-next-phase/mailhub-staff-env-readiness.json",
  "npm run probe:routing-preflight -- --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-preflight.json",
  "npm run ops:readiness-refresh -- --plan-only",
];

const RAW_MUTATION_COMMAND_RE = /\bgh\s+(secret|variable)\s+set\b/;
const SECRET_VALUE_SIGNAL_RE = /(BEGIN [A-Z ]*PRIVATE KEY|nextauth-secret-value|probe-pass|xox[baprs]-|ghp_[A-Za-z0-9_]{20,}|ya29\.[A-Za-z0-9_-]+)/;

function parseArgs(argv) {
  const out = {
    request: defaultRequestPath,
    readiness: defaultReadinessPath,
    markdown: "",
    markdownExplicit: false,
    repoHead: "",
    repoParentHead: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--request") out.request = argv[++i];
    else if (arg === "--readiness") out.readiness = argv[++i];
    else if (arg === "--markdown") {
      out.markdown = argv[++i] || "";
      out.markdownExplicit = true;
    } else if (arg === "--repo-head") out.repoHead = argv[++i];
    else if (arg === "--repo-parent-head") out.repoParentHead = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/check-mailhub-production-config-request-contract.mjs [--request path] [--readiness path] [--markdown path] [--repo-head sha] [--repo-parent-head sha]");
      process.exit(0);
    }
  }
  if (!out.markdownExplicit) out.markdown = join(dirname(out.request), "mailhub-production-config-intake.md");
  delete out.markdownExplicit;
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

function serializedCommands(request) {
  const safe = stringArray(request.safeCommands?.dryRun);
  const gated = Array.isArray(request.approvalGatedActions)
    ? request.approvalGatedActions
        .map((action) => (typeof action?.commandAfterApproval === "string" ? action.commandAfterApproval : ""))
        .filter(Boolean)
    : [];
  return [...safe, ...gated];
}

function missingValues(request) {
  const missing = objectValue(request.currentMissing);
  return [
    ...stringArray(missing.externalSmtpSecrets),
    ...stringArray(missing.routingGmailProofSecrets),
    ...stringArray(missing.staffProductionConfig),
    ...stringArray(missing.staffSecretConfig),
    ...stringArray(missing.alertAutomationConfig),
    ...stringArray(missing.alertAutomationWorkflow),
  ];
}

function markdownSection(markdown, startMarker, endMarker) {
  const start = markdown.indexOf(startMarker);
  if (start < 0) return null;
  const sectionStart = start + startMarker.length;
  const end = markdown.indexOf(endMarker, sectionStart);
  return markdown.slice(sectionStart, end < 0 ? markdown.length : end);
}

function markdownListCommands(section) {
  if (typeof section !== "string") return [];
  return [...section.matchAll(/^- `([^`]+)`$/gm)].map((match) => match[1]);
}

function markdownApprovalCommands(section) {
  if (typeof section !== "string") return [];
  return [...section.matchAll(/commandAfterApproval: `([^`]+)`/g)].map((match) => match[1]);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const request = readJson(args.request, "production_config_request");
  const readiness = readJson(args.readiness, "readiness");
  const errors = [];
  const warnings = [];
  const repoHead = args.repoHead || gitRevParse("HEAD");
  const repoParentHead = args.repoParentHead || gitRevParse("HEAD^");
  const requestReadiness = objectValue(request.readiness);
  const readinessGate = objectValue(readiness.gate);
  const requestRepoHead = typeof request.repoHead === "string" ? request.repoHead : null;
  const readinessRepoHead = typeof readiness.repoHead === "string" ? readiness.repoHead : null;
  const requestP0 = stringArray(requestReadiness.p0Blockers);
  const requestP1 = stringArray(requestReadiness.p1Blockers);
  const readinessP0 = stringArray(readinessGate.p0Blockers);
  const readinessP1 = stringArray(readinessGate.p1Blockers);
  const productionReady = requestReadiness.productionReady === true;
  const readinessProductionReady = readinessGate.productionReady === true;
  const safeCommands = stringArray(request.safeCommands?.dryRun);
  const commands = serializedCommands(request);
  const actions = actionsById(request.approvalGatedActions);
  const allMissing = missingValues(request);
  const serialized = JSON.stringify(request);

  if (Number.isNaN(Date.parse(request.generatedAt ?? ""))) errors.push("invalid_generated_at");
  if (!requestRepoHead) errors.push("missing_request_repo_head");
  else if (!isFreshRepoHead({ repoRoot, artifactRepoHead: requestRepoHead, repoHead, repoParentHead })) {
    errors.push("stale_request_repo_head");
  }
  if (readinessRepoHead && !isFreshRepoHead({ repoRoot, artifactRepoHead: readinessRepoHead, repoHead, repoParentHead })) {
    errors.push("stale_readiness_repo_head");
  }
  if (productionReady !== readinessProductionReady) errors.push("production_ready_mismatch");
  if (!sameStrings(requestP0, readinessP0)) errors.push("p0_blockers_mismatch");
  if (!sameStrings(requestP1, readinessP1)) errors.push("p1_blockers_mismatch");
  if (productionReady && allMissing.length > 0) errors.push("production_ready_with_missing_config_values");

  if (typeof request.valuePolicy !== "string" || !/never printed/i.test(request.valuePolicy)) {
    errors.push("missing_no_secret_value_policy");
  }
  if (SECRET_VALUE_SIGNAL_RE.test(serialized)) errors.push("secret_value_signal_in_request");

  for (const command of REQUIRED_DRY_RUN_COMMANDS) {
    if (!safeCommands.includes(command)) errors.push(`missing_safe_dry_run_command:${command}`);
  }
  if (!sameStrings(safeCommands, REQUIRED_DRY_RUN_COMMANDS)) errors.push("safe_dry_run_commands_mismatch");
  for (const command of safeCommands) {
    if (!REQUIRED_DRY_RUN_COMMANDS.includes(command)) errors.push(`unknown_safe_dry_run_command:${command}`);
    if (/\s--apply(\s|$)/.test(command)) errors.push("safe_command_contains_apply");
    if (/\s--send(\s|$)/.test(command)) errors.push("safe_command_contains_send");
    if (RAW_MUTATION_COMMAND_RE.test(command)) errors.push("safe_command_contains_raw_gh_mutation");
  }
  for (const command of commands) {
    if (RAW_MUTATION_COMMAND_RE.test(command)) errors.push("raw_gh_mutation_command_disallowed");
  }

  for (const [id, expected] of REQUIRED_ACTIONS) {
    const action = actions.get(id);
    if (!action) {
      errors.push(`missing_approval_action:${id}`);
      continue;
    }
    if (action.sideEffect !== expected.sideEffect) errors.push(`approval_action_side_effect_mismatch:${id}`);
    if (action.requiresApproval !== true) errors.push(`approval_action_must_require_approval:${id}`);
    if (action.confirmationToken !== expected.confirmationToken) errors.push(`approval_action_confirmation_token_mismatch:${id}`);
    if (!expected.commands.has(action.commandAfterApproval)) errors.push(`approval_action_command_mismatch:${id}`);
    if (!ALLOWED_ACTION_STATUSES.has(action.status)) errors.push(`approval_action_status_invalid:${id}`);
    const preconditions = stringArray(action.preconditions);
    if (!preconditions.includes("explicit_user_approval")) errors.push(`approval_action_missing_explicit_approval_precondition:${id}`);
    if (action.status === "blocked_missing_values" && typeof action.blockedReason !== "string") {
      errors.push(`approval_action_missing_blocked_reason:${id}`);
    }
  }
  for (const id of actions.keys()) {
    if (!REQUIRED_ACTIONS.has(id)) errors.push(`unknown_approval_action:${id}`);
  }

  let markdownChecked = false;
  if (args.markdown && existsSync(args.markdown)) {
    markdownChecked = true;
    const markdown = readFileSync(args.markdown, "utf8");
    if (!markdown.includes("This artifact is intentionally value-free")) errors.push("markdown_missing_value_free_notice");
    if (SECRET_VALUE_SIGNAL_RE.test(markdown)) errors.push("secret_value_signal_in_markdown");
    if (RAW_MUTATION_COMMAND_RE.test(markdown)) errors.push("raw_gh_mutation_command_in_markdown");
    const dryRunSection = markdownSection(markdown, "Dry-run commands:", "Approval-gated commands");
    const approvalSection = markdownSection(markdown, "Approval-gated commands", "## Post-Apply Verification");
    const markdownDryRunCommands = markdownListCommands(dryRunSection);
    const approvalCommands = Array.isArray(request.approvalGatedActions)
      ? request.approvalGatedActions
          .map((action) => (typeof action?.commandAfterApproval === "string" ? action.commandAfterApproval : ""))
          .filter(Boolean)
      : [];
    const markdownGatedCommands = markdownApprovalCommands(approvalSection);
    if (!dryRunSection) errors.push("markdown_missing_dry_run_section");
    if (!approvalSection) errors.push("markdown_missing_approval_section");
    if (!sameStrings(markdownDryRunCommands, safeCommands)) errors.push("markdown_dry_run_commands_mismatch");
    if (!sameStrings(markdownGatedCommands, approvalCommands)) errors.push("markdown_approval_commands_mismatch");
    for (const command of markdownDryRunCommands) {
      if (!REQUIRED_DRY_RUN_COMMANDS.includes(command)) errors.push(`markdown_unknown_dry_run_command:${command}`);
      if (/\s--apply(\s|$)/.test(command)) errors.push("markdown_dry_run_command_contains_apply");
      if (/\s--send(\s|$)/.test(command)) errors.push("markdown_dry_run_command_contains_send");
    }
  } else if (args.markdown) {
    warnings.push("markdown_artifact_missing");
  }

  const result = {
    requestPath: args.request,
    readinessPath: args.readiness,
    markdownPath: args.markdown || null,
    markdownChecked,
    repoHead,
    repoParentHead,
    requestRepoHead,
    readinessRepoHead,
    productionReady,
    p0Blockers: requestP0,
    p1Blockers: requestP1,
    approvalActionIds: [...actions.keys()],
    safeCommandCount: safeCommands.length,
    missingValueCount: allMissing.length,
    errors,
    warnings,
    ok: errors.length === 0,
  };

  console.log(JSON.stringify(result, null, 2));
  if (errors.length > 0) process.exitCode = 1;
}

main();
