#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isFreshRepoHead } from "./artifact-freshness.mjs";

const repoRoot = process.cwd();
const defaultNextPath = join(repoRoot, ".ai-runs", "mailhub-next-phase", "mailhub-routing-next-steps.json");
const defaultReadinessPath = join(repoRoot, ".ai-runs", "mailhub-next-phase", "mailhub-production-readiness-audit.json");

const REQUIRED_ACTION_IDS = [
  "set_external_smtp_secrets",
  "verify_secret_readiness",
  "run_no_send_preflight",
  "run_github_send_verify",
  "run_local_send_verify",
];

function parseArgs(argv) {
  const out = {
    next: defaultNextPath,
    readiness: defaultReadinessPath,
    repoHead: "",
    repoParentHead: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--next") out.next = argv[++i];
    else if (arg === "--readiness") out.readiness = argv[++i];
    else if (arg === "--repo-head") out.repoHead = argv[++i];
    else if (arg === "--repo-parent-head") out.repoParentHead = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/check-mailhub-routing-next-contract.mjs [--next path] [--readiness path] [--repo-head sha] [--repo-parent-head sha]");
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
  if (!existsSync(path)) throw new Error(`missing_routing_next_artifact:${path}`);
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifact = readJson(args.next);
  const readiness = readJson(args.readiness);
  const errors = [];
  const warnings = [];
  const repoHead = args.repoHead || gitRevParse("HEAD");
  const repoParentHead = args.repoParentHead || gitRevParse("HEAD^");
  const inputs = objectValue(artifact.inputs);
  const state = objectValue(artifact.state);
  const missing = objectValue(artifact.missing);
  const actions = actionsById(artifact.nextActions);
  const inputErrors = stringArray(inputs.errors);
  const inputWarnings = stringArray(inputs.warnings);
  const readinessGate = objectValue(readiness.gate);
  const artifactRepoHead = typeof inputs.repoHead === "string" ? inputs.repoHead : null;
  const readinessRepoHead = typeof inputs.readinessRepoHead === "string" ? inputs.readinessRepoHead : null;
  const actualReadinessRepoHead = typeof readiness.repoHead === "string" ? readiness.repoHead : null;
  const readinessGeneratedAt = typeof readiness.generatedAt === "string" ? readiness.generatedAt : null;
  const inputReadinessGeneratedAt = typeof inputs.readinessGeneratedAt === "string" ? inputs.readinessGeneratedAt : null;
  const p0Blockers = stringArray(state.p0Blockers);
  const readinessP0Blockers = stringArray(readinessGate.p0Blockers);
  const readinessP1Blockers = stringArray(readinessGate.p1Blockers);
  const githubMissing = stringArray(missing.githubSendVerifySecrets);
  const localMissing = stringArray(missing.localPreflightEnv);
  const localGmailMissing = stringArray(missing.localGmailVerificationEnv);
  const externalMissing = stringArray(missing.externalSmtpSecrets);

  if (inputErrors.length > 0) errors.push(...inputErrors.map((error) => `input_error:${error}`));
  if (!artifactRepoHead) errors.push("missing_artifact_repo_head");
  else if (!isFreshRepoHead({ repoRoot, artifactRepoHead, repoHead, repoParentHead })) errors.push("stale_artifact_repo_head");
  if (!readinessRepoHead) errors.push("missing_readiness_repo_head");
  else if (!isFreshRepoHead({ repoRoot, artifactRepoHead: readinessRepoHead, repoHead, repoParentHead })) {
    errors.push("stale_readiness_repo_head");
  }
  if (!actualReadinessRepoHead) errors.push("missing_actual_readiness_repo_head");
  else if (readinessRepoHead && actualReadinessRepoHead !== readinessRepoHead) errors.push("readiness_repo_head_mismatch");
  if (!inputReadinessGeneratedAt) errors.push("missing_input_readiness_generated_at");
  else if (readinessGeneratedAt && inputReadinessGeneratedAt !== readinessGeneratedAt) {
    errors.push("readiness_generated_at_mismatch");
  }

  for (const id of REQUIRED_ACTION_IDS) {
    if (!actions.has(id)) errors.push(`missing_next_action:${id}`);
  }

  const readyForGithub = state.readyForGithubSendVerify === true;
  const readyForLocal = state.readyForLocalProductionProof === true;
  const readyForLocalGmail = state.readyForLocalGmailVerification === true;
  const canRunGithub = state.canRunGithubWorkflowDispatch === true;
  const canRunLocal = state.canRunLocalSendVerify === true;
  const canRunBoth = state.canRunSendVerify === true;
  const readinessProductionReady = readinessGate.productionReady === true;

  if ((state.productionReady === true) !== readinessProductionReady) errors.push("production_ready_mismatch");
  if (JSON.stringify(p0Blockers) !== JSON.stringify(readinessP0Blockers)) errors.push("p0_blockers_mismatch");
  if (JSON.stringify(stringArray(state.p1Blockers)) !== JSON.stringify(readinessP1Blockers)) errors.push("p1_blockers_mismatch");
  if (state.externalMailWillBeSentByThisScript !== false) errors.push("routing_next_must_not_claim_to_send_mail");
  if (canRunGithub !== readyForGithub) errors.push("github_dispatch_gate_mismatch");
  if (canRunLocal !== (readyForLocal && readyForLocalGmail)) errors.push("local_send_gate_mismatch");
  if (canRunBoth !== (readyForGithub && canRunLocal)) errors.push("combined_send_gate_mismatch");
  if (readyForGithub && githubMissing.length > 0) errors.push("github_ready_with_missing_secrets");
  if (!readyForGithub && githubMissing.length === 0 && !state.productionReady) errors.push("github_not_ready_without_missing_secrets");
  if (readyForLocal && localMissing.length > 0) errors.push("local_ready_with_missing_env");
  if (!readyForLocal && localMissing.length === 0 && !state.productionReady) errors.push("local_not_ready_without_missing_env");
  if (readyForLocalGmail && localGmailMissing.length > 0) errors.push("local_gmail_ready_with_missing_env");
  if (!readyForLocalGmail && localGmailMissing.length === 0 && !state.productionReady) {
    errors.push("local_gmail_not_ready_without_missing_env");
  }
  if (state.currentSharedGmailRoutingBlocked === true && !p0Blockers.includes("current_shared_gmail_routing")) {
    errors.push("routing_blocked_without_p0");
  }

  expectActionStatus({
    actions,
    id: "set_external_smtp_secrets",
    expected: externalMissing.length === 0 ? "done" : "required",
    errors,
  });
  const smtpSetupAction = actions.get("set_external_smtp_secrets");
  const smtpSetupCommands = actionCommands(smtpSetupAction);
  if (externalMissing.length > 0) {
    if (!smtpSetupCommands.some((command) => command === "npm run setup:mailhub-routing-secrets")) {
      errors.push("missing_routing_secret_setup_dry_run_command");
    }
    if (!smtpSetupCommands.some((command) => command === "npm run setup:mailhub-routing-secrets -- --apply")) {
      errors.push("missing_routing_secret_setup_apply_command");
    }
    if (smtpSetupCommands.some((command) => command.startsWith("gh secret set "))) {
      errors.push("raw_gh_secret_set_commands_disallowed");
    }
  }
  expectActionStatus({
    actions,
    id: "verify_secret_readiness",
    expected: readyForGithub ? "done" : "required",
    errors,
  });
  expectActionStatus({
    actions,
    id: "run_no_send_preflight",
    expected: readyForLocal ? "done" : "required",
    errors,
  });
  expectActionStatus({
    actions,
    id: "run_github_send_verify",
    expected: canRunGithub ? "ready" : "blocked",
    errors,
  });
  expectActionStatus({
    actions,
    id: "run_local_send_verify",
    expected: canRunLocal ? "ready" : "blocked",
    errors,
  });

  const result = {
    nextPath: args.next,
    readinessPath: args.readiness,
    repoHead,
    repoParentHead,
    artifactRepoHead,
    readinessRepoHead,
    actualReadinessRepoHead,
    productionReady: state.productionReady === true,
    p0Blockers,
    canRunGithubWorkflowDispatch: canRunGithub,
    canRunLocalSendVerify: canRunLocal,
    canRunSendVerify: canRunBoth,
    inputWarnings,
    errors,
    warnings,
    ok: errors.length === 0,
  };

  console.log(JSON.stringify(result, null, 2));
  if (errors.length > 0) process.exitCode = 1;
}

main();
