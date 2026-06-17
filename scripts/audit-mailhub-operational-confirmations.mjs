#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const repoRoot = process.cwd();
const defaultSourceAuditPath = join(repoRoot, ".ai-runs", "mailhub-next-phase", "gmail-source-coverage-audit.json");
const migrationStatusPath = join(repoRoot, "MAIL_MIGRATION_STATUS.md");
const defaultOutPath = join(repoRoot, ".ai-runs", "mailhub-next-phase", "mailhub-operational-confirmations.json");

function parseArgs(argv) {
  const out = {
    sourceAudit: defaultSourceAuditPath,
    migrationStatus: migrationStatusPath,
    out: defaultOutPath,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--source-audit") out.sourceAudit = argv[++i];
    else if (arg === "--migration-status") out.migrationStatus = argv[++i];
    else if (arg === "--out") out.out = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/audit-mailhub-operational-confirmations.mjs [--source-audit path] [--migration-status path] [--out path]`);
      process.exit(0);
    }
  }
  return out;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function lineReferencesForNeedles(markdown, needles) {
  const normalizedNeedles = [...new Set(needles.filter(Boolean).map((needle) => needle.toLowerCase()))];
  const refs = [];
  const lines = markdown.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const lower = line.toLowerCase();
    if (!normalizedNeedles.some((needle) => lower.includes(needle))) continue;
    refs.push({
      file: "MAIL_MIGRATION_STATUS.md",
      line: index + 1,
      text: line.trim(),
    });
  }
  return refs;
}

function addressNeedles(addresses) {
  const needles = [];
  for (const address of addresses) {
    const lower = String(address).toLowerCase();
    needles.push(lower);
    const local = lower.split("@")[0];
    if (local) {
      needles.push(`${local}@`);
      needles.push(local);
    }
  }
  return needles;
}

function classifyFollowup(item, migrationMarkdown) {
  const activeInboxHasEvidence = Boolean(item.activeInboxHasEvidence);
  const allMailHasEvidence = Boolean(item.allMailHasEvidence);
  const refs = lineReferencesForNeedles(migrationMarkdown, addressNeedles(item.addresses ?? []));
  const sourceOfTruthStatus = refs.length > 0 ? "found" : "missing";
  const sharedInboxEvidence = activeInboxHasEvidence
    ? "active_inbox"
    : allMailHasEvidence
      ? "historical_all_mail"
      : "none";

  let recommendedAction = "confirm_dormant_or_archived";
  let severity = "operator";
  if (sharedInboxEvidence === "none" && sourceOfTruthStatus === "found") {
    recommendedAction = "verify_gws_group_membership_or_mx_routing";
    severity = "routing_confirmation";
  } else if (sharedInboxEvidence === "none" && sourceOfTruthStatus === "missing") {
    recommendedAction = "confirm_source_exists_or_remove_channel";
    severity = "source_of_truth_confirmation";
  } else if (sharedInboxEvidence === "historical_all_mail") {
    recommendedAction = "confirm_no_active_inbox_work";
  }

  return {
    id: item.id,
    label: item.label,
    addresses: item.addresses ?? [],
    sourceAuditStatus: item.status,
    sharedInboxEvidence,
    sourceOfTruthStatus,
    sourceOfTruthReferences: refs,
    recommendedAction,
    severity,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.sourceAudit)) throw new Error(`missing_source_audit:${args.sourceAudit}`);
  if (!existsSync(args.migrationStatus)) throw new Error(`missing_migration_status:${args.migrationStatus}`);

  const sourceAudit = readJson(args.sourceAudit);
  const migrationMarkdown = readFileSync(args.migrationStatus, "utf8");
  const followups = sourceAudit.zeroEstimateAnalysis?.operationalFollowups ?? [];
  const confirmations = followups.map((item) => classifyFollowup(item, migrationMarkdown));
  const codeCoveragePass = Boolean(sourceAudit.zeroEstimateAnalysis?.coverageGate?.codeCoveragePass);
  const knownCodeGaps = sourceAudit.zeroEstimateAnalysis?.knownCodeGaps ?? [];
  const noSharedInboxEvidence = confirmations
    .filter((item) => item.sharedInboxEvidence === "none")
    .map((item) => item.id);
  const sourceOfTruthMissing = confirmations
    .filter((item) => item.sourceOfTruthStatus === "missing")
    .map((item) => item.id);
  const routingConfirmationRequired = confirmations
    .filter((item) => item.recommendedAction === "verify_gws_group_membership_or_mx_routing")
    .map((item) => item.id);

  const result = {
    generatedAt: new Date().toISOString(),
    inputs: {
      sourceAudit: args.sourceAudit,
      migrationStatus: args.migrationStatus,
      sourceAuditGeneratedAt: sourceAudit.generatedAt ?? null,
    },
    sourceCoverage: {
      codeCoveragePass,
      knownCodeGaps,
      aggregateEstimate: sourceAudit.aggregate?.resultSizeEstimate ?? null,
      zeroEstimateChannels: sourceAudit.risks?.zeroEstimateChannels ?? [],
    },
    operationalConfirmations: confirmations,
    gate: {
      codeCoveragePass,
      noSharedInboxEvidence,
      routingConfirmationRequired,
      sourceOfTruthMissing,
      productionCompleteClaimReady:
        codeCoveragePass &&
        knownCodeGaps.length === 0 &&
        noSharedInboxEvidence.length === 0 &&
        sourceOfTruthMissing.length === 0,
    },
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    outPath: args.out,
    generatedAt: result.generatedAt,
    codeCoveragePass: result.gate.codeCoveragePass,
    noSharedInboxEvidence: result.gate.noSharedInboxEvidence,
    routingConfirmationRequired: result.gate.routingConfirmationRequired,
    sourceOfTruthMissing: result.gate.sourceOfTruthMissing,
    productionCompleteClaimReady: result.gate.productionCompleteClaimReady,
  }, null, 2));
}

main();
