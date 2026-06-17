#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = process.cwd();
const runDir = join(repoRoot, ".ai-runs", "mailhub-next-phase");
const defaults = {
  sourceAudit: join(runDir, "gmail-source-coverage-audit.json"),
  opsAudit: join(runDir, "mailhub-operational-confirmations.json"),
  gwsRoutingAudit: join(runDir, "mailhub-gws-routing-audit.json"),
  routingProbeAudit: join(runDir, "mailhub-routing-probe-audit.json"),
  routingProbePreflight: join(runDir, "mailhub-routing-probe-preflight.json"),
  githubRoutingSecrets: join(runDir, "github-routing-secrets-readiness.json"),
  viewsAudit: join(runDir, "gmail-default-views-audit.json"),
  rulesAudit: join(runDir, "gmail-rule-safety-audit.json"),
  staffWorkflowAudit: join(runDir, "mailhub-staff-workflow-audit.json"),
  out: join(runDir, "mailhub-production-readiness-audit.json"),
};

function parseArgs(argv) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--source-audit") out.sourceAudit = argv[++i];
    else if (arg === "--ops-audit") out.opsAudit = argv[++i];
    else if (arg === "--gws-routing-audit") out.gwsRoutingAudit = argv[++i];
    else if (arg === "--routing-probe-audit") out.routingProbeAudit = argv[++i];
    else if (arg === "--routing-probe-preflight") out.routingProbePreflight = argv[++i];
    else if (arg === "--github-routing-secrets") out.githubRoutingSecrets = argv[++i];
    else if (arg === "--views-audit") out.viewsAudit = argv[++i];
    else if (arg === "--rules-audit") out.rulesAudit = argv[++i];
    else if (arg === "--staff-workflow-audit") out.staffWorkflowAudit = argv[++i];
    else if (arg === "--out") out.out = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/audit-mailhub-production-readiness.mjs [--source-audit path] [--ops-audit path] [--gws-routing-audit path] [--routing-probe-audit path] [--routing-probe-preflight path] [--github-routing-secrets path] [--views-audit path] [--rules-audit path] [--staff-workflow-audit path] [--out path]`);
      process.exit(0);
    }
  }
  return out;
}

function readJson(path) {
  if (!existsSync(path)) throw new Error(`missing_audit:${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function readOptionalJson(path) {
  if (!path || !existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function blocker(id, severity, message, evidence = {}) {
  return { id, severity, message, evidence };
}

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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceAudit = readJson(args.sourceAudit);
  const opsAudit = readJson(args.opsAudit);
  const gwsRoutingAudit = readJson(args.gwsRoutingAudit);
  const routingProbeAudit = readOptionalJson(args.routingProbeAudit);
  const routingProbePreflight = readOptionalJson(args.routingProbePreflight);
  const githubRoutingSecrets = readOptionalJson(args.githubRoutingSecrets);
  const viewsAudit = readJson(args.viewsAudit);
  const rulesAudit = readJson(args.rulesAudit);
  const staffWorkflowAudit = readOptionalJson(args.staffWorkflowAudit);

  const knownCodeGaps = sourceAudit.zeroEstimateAnalysis?.knownCodeGaps ?? [];
  const sourceCodeCoverageReady =
    Boolean(sourceAudit.zeroEstimateAnalysis?.coverageGate?.codeCoveragePass) &&
    knownCodeGaps.length === 0;
  const sourceInventoryReady = (opsAudit.gate?.sourceInventoryMissing ?? []).length === 0;
  const routingProbeReady = Boolean(routingProbeAudit?.gate?.allExpectedAddressesConfirmed);
  const routingProbePreflightReady = Boolean(routingProbePreflight?.smtpPreflight?.readyForProductionProof);
  const routingProbeGithubSecretsReady = Boolean(githubRoutingSecrets?.readyForSendVerify);
  const currentSharedGmailRoutingReady = routingProbeReady;
  const viewSyntaxReady = viewsAudit.gate?.syntaxReady === true ||
    (viewsAudit.views ?? []).every((view) => view.syntaxAccepted === true && !view.error);
  const viewsManualReviewOnly = viewsAudit.gate?.manualReviewOnly === true ||
    (viewsAudit.views ?? []).some(
      (view) => view.risk === "broad_manual_review_only" || view.hasMoreAfterMaxPages === true,
    );
  const defaultViewsBulkAutomationSafe = viewsAudit.gate?.bulkAutomationSafe === true;
  const rulesConfigFingerprint =
    typeof rulesAudit.config?.ruleSetFingerprint === "string" && rulesAudit.config.ruleSetFingerprint.startsWith("sha256:")
      ? rulesAudit.config.ruleSetFingerprint
      : null;
  const ruleConfigFingerprintPresent = Boolean(rulesConfigFingerprint);
  const ruleSafetyReady = Boolean(rulesAudit.ruleSafetyGate?.realDataRuleRiskPass) && ruleConfigFingerprintPresent;
  const staffWorkflowPermissionsReady = Boolean(staffWorkflowAudit?.gate?.staffWorkflowPermissionsReady);
  const staffWorkflowBlockerSeverity = currentSharedGmailRoutingReady ? "P0" : "P1";

  const blockers = [];
  if (!sourceCodeCoverageReady) {
    blockers.push(blocker("source_code_coverage", "P0", "Source code coverage gate is not ready.", {
      knownCodeGaps,
      codeCoveragePass: sourceAudit.zeroEstimateAnalysis?.coverageGate?.codeCoveragePass ?? null,
    }));
  }
  if (!sourceInventoryReady) {
    blockers.push(blocker("source_inventory_missing", "P0", "Some operational source addresses still lack source inventory evidence.", {
      sourceInventoryMissing: opsAudit.gate?.sourceInventoryMissing ?? [],
    }));
  }
  if (!currentSharedGmailRoutingReady) {
    blockers.push(blocker("current_shared_gmail_routing", "P0", "Current external mail routing into the shared Gmail/MailHub workbench is not fully confirmed.", {
      currentSharedGmailRoutingUnconfirmed: opsAudit.gate?.currentSharedGmailRoutingUnconfirmed ?? [],
      noSharedInboxEvidence: opsAudit.gate?.noSharedInboxEvidence ?? [],
      routingConfirmationRequired: opsAudit.gate?.routingConfirmationRequired ?? [],
      gwsRoutingGate: gwsRoutingAudit.gate ?? null,
      routingProbeGate: routingProbeAudit?.gate ?? null,
      routingProbePreflight: routingProbePreflight?.smtpPreflight ?? null,
      routingProbeGithubSecrets: githubRoutingSecrets ? {
        source: githubRoutingSecrets.source ?? null,
        secretCount: githubRoutingSecrets.secretCount ?? null,
        readyForPreflightProductionProof: githubRoutingSecrets.readyForPreflightProductionProof ?? null,
        readyForSendVerify: githubRoutingSecrets.readyForSendVerify ?? null,
        missingPreflightSecrets: githubRoutingSecrets.missingPreflightSecrets ?? [],
        missingSendVerifySecrets: githubRoutingSecrets.missingSendVerifySecrets ?? [],
        presentRequiredSecretNames: githubRoutingSecrets.presentRequiredSecretNames ?? [],
        secretGroups: githubRoutingSecrets.secretGroups ?? null,
      } : null,
      mxRecords: gwsRoutingAudit.dns?.mxRecords ?? [],
    }));
  }
  if (!viewSyntaxReady) {
    blockers.push(blocker("default_view_syntax", "P1", "At least one default operational view failed Gmail syntax validation.", {
      failedViews: (viewsAudit.views ?? []).filter((view) => view.syntaxAccepted !== true || view.error),
    }));
  }
  if (!ruleSafetyReady) {
    blockers.push(blocker("rule_safety_real_data", "P0", "Real-data rule safety gate is not passing.", {
      ruleSafetyGate: rulesAudit.ruleSafetyGate ?? null,
      ruleSetFingerprint: rulesConfigFingerprint,
      fingerprintPresent: ruleConfigFingerprintPresent,
    }));
  }
  if (!staffWorkflowPermissionsReady) {
    blockers.push(blocker("staff_workflow_permissions", staffWorkflowBlockerSeverity, "Production staff workflow and permission rollout evidence is not complete.", {
      staffWorkflowGate: staffWorkflowAudit?.gate ?? null,
      staffWorkflowRequirements: staffWorkflowAudit?.requirements ?? null,
      staffWorkflowBlockers: staffWorkflowAudit?.blockers ?? ["missing_staff_workflow_audit"],
      escalatesToP0AfterRoutingProof: !currentSharedGmailRoutingReady,
    }));
  }

  const result = {
    generatedAt: new Date().toISOString(),
    repoHead: currentRepoHead(),
    inputs: {
      sourceAudit: args.sourceAudit,
      opsAudit: args.opsAudit,
      gwsRoutingAudit: args.gwsRoutingAudit,
      routingProbeAudit: args.routingProbeAudit,
      routingProbePreflight: args.routingProbePreflight,
      githubRoutingSecrets: args.githubRoutingSecrets,
      viewsAudit: args.viewsAudit,
      rulesAudit: args.rulesAudit,
      staffWorkflowAudit: args.staffWorkflowAudit,
      sourceAuditGeneratedAt: sourceAudit.generatedAt ?? null,
      opsAuditGeneratedAt: opsAudit.generatedAt ?? null,
      gwsRoutingAuditGeneratedAt: gwsRoutingAudit.generatedAt ?? null,
      routingProbeAuditGeneratedAt: routingProbeAudit?.generatedAt ?? null,
      routingProbePreflightGeneratedAt: routingProbePreflight?.generatedAt ?? null,
      githubRoutingSecretsCheckedAt: githubRoutingSecrets?.checkedAt ?? null,
      viewsAuditGeneratedAt: viewsAudit.generatedAt ?? null,
      rulesAuditGeneratedAt: rulesAudit.generatedAt ?? null,
      staffWorkflowAuditGeneratedAt: staffWorkflowAudit?.generatedAt ?? null,
      rulesConfigFingerprint,
    },
    requirements: {
      sourceCodeCoverageReady,
      sourceInventoryReady,
      currentSharedGmailRoutingReady,
      routingProbeReady,
      routingProbePreflightReady,
      routingProbeGithubSecretsReady,
      defaultViewsRealDataValidated: viewSyntaxReady,
      defaultViewsManualReviewOnly: viewsManualReviewOnly,
      defaultViewsBulkAutomationSafe,
      currentRuleConfigRealDataSafetyReady: ruleSafetyReady,
      currentRuleConfigFingerprintPresent: ruleConfigFingerprintPresent,
      staffWorkflowPermissionsReady,
      staffReadOnlyRolloutReady: staffWorkflowAudit?.gate?.readOnlyRolloutReady === true,
      staffControlledWritePilotReady: staffWorkflowAudit?.gate?.controlledWritePilotReady === true,
    },
    blockers,
    gate: {
      productionReady:
        sourceCodeCoverageReady &&
        sourceInventoryReady &&
        currentSharedGmailRoutingReady &&
        viewSyntaxReady &&
        ruleSafetyReady &&
        staffWorkflowPermissionsReady &&
        blockers.filter((item) => item.severity === "P0").length === 0,
      p0Blockers: blockers.filter((item) => item.severity === "P0").map((item) => item.id),
      p1Blockers: blockers.filter((item) => item.severity === "P1").map((item) => item.id),
    },
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    outPath: args.out,
    generatedAt: result.generatedAt,
    productionReady: result.gate.productionReady,
    p0Blockers: result.gate.p0Blockers,
    p1Blockers: result.gate.p1Blockers,
  }, null, 2));
}

main();
