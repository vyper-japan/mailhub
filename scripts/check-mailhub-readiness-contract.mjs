#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = process.cwd();
const defaultAuditPath = join(repoRoot, ".ai-runs", "mailhub-next-phase", "mailhub-production-readiness-audit.json");

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

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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
    if (requirements.sourceCodeCoverageReady !== true) errors.push("production_ready_without_source_code_coverage");
    if (requirements.sourceInventoryReady !== true) errors.push("production_ready_without_source_inventory");
    if (requirements.defaultViewsRealDataValidated !== true) errors.push("production_ready_without_default_views_validation");
    if (requirements.currentRuleConfigRealDataSafetyReady !== true) errors.push("production_ready_without_rule_safety");
  } else if (p0Blockers.length === 0) {
    errors.push("not_ready_without_p0_blockers");
  }

  const routingBlocker = blockers.find((item) => item.id === "current_shared_gmail_routing");
  if (p0Blockers.includes("current_shared_gmail_routing")) {
    const evidence = objectValue(routingBlocker?.evidence);
    const routingProbeGate = objectValue(evidence.routingProbeGate);
    const routingProbePreflight = objectValue(evidence.routingProbePreflight);
    const mxRecords = Array.isArray(evidence.mxRecords) ? evidence.mxRecords : [];
    const unconfirmed = stringArray(evidence.currentSharedGmailRoutingUnconfirmed);
    const missingAddresses = stringArray(routingProbeGate.missingAddresses);
    const missingEnv = stringArray(routingProbePreflight.missingRequiredEnv);

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
    errors,
    warnings,
    ok: errors.length === 0,
  };

  console.log(JSON.stringify(result, null, 2));
  if (errors.length > 0) process.exitCode = 1;
}

main();
