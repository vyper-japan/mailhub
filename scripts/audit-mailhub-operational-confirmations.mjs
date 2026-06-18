#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = process.cwd();
const defaultSourceAuditPath = join(repoRoot, ".ai-runs", "mailhub-next-phase", "gmail-source-coverage-audit.json");
const migrationStatusPath = join(repoRoot, "MAIL_MIGRATION_STATUS.md");
const defaultOutPath = join(repoRoot, ".ai-runs", "mailhub-next-phase", "mailhub-operational-confirmations.json");
const defaultMigrationEvidenceDir = join(homedir(), "Desktop", "Claude出力", "mx-migration");

function currentRepoHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const out = {
    sourceAudit: defaultSourceAuditPath,
    migrationStatus: migrationStatusPath,
    gwsGroups: join(defaultMigrationEvidenceDir, "gws_groups.json"),
    lolipopInventory: join(defaultMigrationEvidenceDir, "lolipop_inventory.json"),
    lolipopPeek: join(defaultMigrationEvidenceDir, "lolipop_inbox_peek.json"),
    out: defaultOutPath,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--source-audit") out.sourceAudit = argv[++i];
    else if (arg === "--migration-status") out.migrationStatus = argv[++i];
    else if (arg === "--gws-groups") out.gwsGroups = argv[++i];
    else if (arg === "--lolipop-inventory") out.lolipopInventory = argv[++i];
    else if (arg === "--lolipop-peek") out.lolipopPeek = argv[++i];
    else if (arg === "--out") out.out = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/audit-mailhub-operational-confirmations.mjs [--source-audit path] [--migration-status path] [--gws-groups path] [--lolipop-inventory path] [--lolipop-peek path] [--out path]`);
      process.exit(0);
    }
  }
  return out;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readOptionalJson(path) {
  if (!path || !existsSync(path)) return null;
  return readJson(path);
}

function normalizeMail(value) {
  return String(value ?? "").trim().toLowerCase();
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

function buildSourceInventoryEvidence({ gwsGroups, lolipopInventory, lolipopPeek }) {
  const groupAddresses = new Set(Array.isArray(gwsGroups) ? gwsGroups.map(normalizeMail) : []);
  const inventoryByMail = new Map();
  const peekByMail = new Map();

  if (Array.isArray(lolipopInventory)) {
    for (const entry of lolipopInventory) {
      const mail = normalizeMail(entry?.mail);
      if (!mail) continue;
      inventoryByMail.set(mail, {
        mail,
        usage: String(entry?.usage ?? ""),
        count: String(entry?.count ?? ""),
      });
    }
  }

  if (Array.isArray(lolipopPeek)) {
    for (const entry of lolipopPeek) {
      const mail = normalizeMail(entry?.mail);
      if (!mail) continue;
      const rows = Array.isArray(entry?.rows) ? entry.rows : [];
      const text = rows.map((row) => (Array.isArray(row) ? row.join(" ") : String(row))).join(" ");
      const dateSnippets = [...new Set(text.match(/\b\d{2}\/\d{2}\/\d{2}\b/g) ?? [])].slice(0, 10);
      peekByMail.set(mail, {
        mail,
        rowCount: rows.length,
        dateSnippets,
      });
    }
  }

  return { groupAddresses, inventoryByMail, peekByMail };
}

function sourceInventoryEvidenceForAddresses(addresses, inventoryEvidence) {
  const markdownReferences = [];
  const gwsGroups = [];
  const lolipopInventory = [];
  const lolipopInboxPeek = [];

  for (const address of addresses ?? []) {
    const mail = normalizeMail(address);
    if (!mail) continue;
    if (inventoryEvidence.groupAddresses.has(mail)) gwsGroups.push(mail);
    const inventory = inventoryEvidence.inventoryByMail.get(mail);
    if (inventory) lolipopInventory.push(inventory);
    const peek = inventoryEvidence.peekByMail.get(mail);
    if (peek) lolipopInboxPeek.push(peek);
  }

  return {
    markdownReferences,
    gwsGroups,
    lolipopInventory,
    lolipopInboxPeek,
  };
}

function hasSourceInventoryEvidence(sourceInventoryEvidence) {
  return (
    sourceInventoryEvidence.markdownReferences.length > 0 ||
    sourceInventoryEvidence.gwsGroups.length > 0 ||
    sourceInventoryEvidence.lolipopInventory.length > 0 ||
    sourceInventoryEvidence.lolipopInboxPeek.length > 0
  );
}

function classifyFollowup(item, migrationMarkdown, inventoryEvidence) {
  const activeInboxHasEvidence = Boolean(item.activeInboxHasEvidence);
  const allMailHasEvidence = Boolean(item.allMailHasEvidence);
  const refs = lineReferencesForNeedles(migrationMarkdown, addressNeedles(item.addresses ?? []));
  const sourceInventoryEvidence = sourceInventoryEvidenceForAddresses(item.addresses ?? [], inventoryEvidence);
  sourceInventoryEvidence.markdownReferences = refs;
  const sourceInventoryStatus = hasSourceInventoryEvidence(sourceInventoryEvidence) ? "found" : "missing";
  const sharedInboxEvidence = activeInboxHasEvidence
    ? "active_inbox"
    : allMailHasEvidence
      ? "historical_all_mail"
      : "none";

  let recommendedAction = "confirm_dormant_or_archived";
  let severity = "operator";
  if (sharedInboxEvidence === "none" && sourceInventoryStatus === "found") {
    recommendedAction = "verify_gws_group_membership_or_mx_routing";
    severity = "routing_confirmation";
  } else if (sharedInboxEvidence === "none" && sourceInventoryStatus === "missing") {
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
    sourceInventoryStatus,
    sourceInventoryEvidence,
    currentSharedGmailRoutingStatus: activeInboxHasEvidence ? "active_inbox_confirmed" : "unconfirmed",
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
  const migrationEvidenceInputs = {
    gwsGroups: { path: args.gwsGroups, exists: existsSync(args.gwsGroups) },
    lolipopInventory: { path: args.lolipopInventory, exists: existsSync(args.lolipopInventory) },
    lolipopPeek: { path: args.lolipopPeek, exists: existsSync(args.lolipopPeek) },
  };
  const sourceInventoryEvidence = buildSourceInventoryEvidence({
    gwsGroups: readOptionalJson(args.gwsGroups),
    lolipopInventory: readOptionalJson(args.lolipopInventory),
    lolipopPeek: readOptionalJson(args.lolipopPeek),
  });
  const followups = sourceAudit.zeroEstimateAnalysis?.operationalFollowups ?? [];
  const confirmations = followups.map((item) => classifyFollowup(item, migrationMarkdown, sourceInventoryEvidence));
  const codeCoveragePass = Boolean(sourceAudit.zeroEstimateAnalysis?.coverageGate?.codeCoveragePass);
  const knownCodeGaps = sourceAudit.zeroEstimateAnalysis?.knownCodeGaps ?? [];
  const noSharedInboxEvidence = confirmations
    .filter((item) => item.sharedInboxEvidence === "none")
    .map((item) => item.id);
  const sourceInventoryMissing = confirmations
    .filter((item) => item.sourceInventoryStatus === "missing")
    .map((item) => item.id);
  const routingConfirmationRequired = confirmations
    .filter((item) => item.recommendedAction === "verify_gws_group_membership_or_mx_routing")
    .map((item) => item.id);
  const currentSharedGmailRoutingUnconfirmed = confirmations
    .filter((item) => item.currentSharedGmailRoutingStatus !== "active_inbox_confirmed")
    .map((item) => item.id);

  const result = {
    generatedAt: new Date().toISOString(),
    repoHead: currentRepoHead(),
    inputs: {
      sourceAudit: args.sourceAudit,
      migrationStatus: args.migrationStatus,
      migrationEvidence: migrationEvidenceInputs,
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
      sourceInventoryMissing,
      currentSharedGmailRoutingUnconfirmed,
      productionCompleteClaimReady:
        codeCoveragePass &&
        knownCodeGaps.length === 0 &&
        sourceInventoryMissing.length === 0 &&
        noSharedInboxEvidence.length === 0 &&
        routingConfirmationRequired.length === 0 &&
        currentSharedGmailRoutingUnconfirmed.length === 0,
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
    sourceInventoryMissing: result.gate.sourceInventoryMissing,
    currentSharedGmailRoutingUnconfirmed: result.gate.currentSharedGmailRoutingUnconfirmed,
    productionCompleteClaimReady: result.gate.productionCompleteClaimReady,
  }, null, 2));
}

main();
