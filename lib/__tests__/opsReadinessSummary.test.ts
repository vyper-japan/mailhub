import { describe, expect, test } from "vitest";
import {
  summarizeProductionReadinessAudit,
  unavailableOpsReadinessSummary,
} from "@/lib/opsReadinessSummary";

describe("opsReadinessSummary", () => {
  test("summarizes production readiness blockers for the Ops Board", () => {
    const summary = summarizeProductionReadinessAudit({
      generatedAt: "2026-06-17T00:00:00.000Z",
      repoHead: "abc123",
      requirements: {
        sourceCodeCoverageReady: true,
        sourceInventoryReady: true,
        currentSharedGmailRoutingReady: false,
        routingProbeReady: false,
        routingProbePreflightReady: false,
        routingProbeGithubSecretsReady: false,
        defaultViewsRealDataValidated: true,
        defaultViewsManualReviewOnly: true,
        defaultViewsBulkAutomationSafe: false,
        currentRuleConfigRealDataSafetyReady: true,
        currentRuleConfigFingerprintPresent: true,
        currentRuleConfigSourceProductionReady: false,
        staffWorkflowPermissionsReady: false,
        staffReadOnlyRolloutReady: false,
        staffControlledWritePilotReady: false,
      },
      inputs: {
        rulesConfigFingerprint: "sha256:abc123",
        ruleConfigSource: {
          requestedSource: "file",
          resolvedSource: "file",
          warnings: ["not_sheets"],
        },
      },
      viewSafety: {
        syntaxFailedViews: [],
        manualReviewOnlyViews: ["invoice-docs", "customer-inquiries"],
        bulkUnsafeViews: ["customer-inquiries"],
      },
      gate: {
        productionReady: false,
        p0Blockers: ["current_shared_gmail_routing"],
        p1Blockers: [],
      },
      blockers: [
        {
          id: "current_shared_gmail_routing",
          severity: "P0",
          evidence: {
            currentSharedGmailRoutingUnconfirmed: ["gopro-yahoo", "ebay"],
            routingProbeGate: {
              missingAddresses: ["gopro_y@vtj.co.jp", "ebay@vtj.co.jp"],
            },
            routingProbePreflight: {
              missingRequiredEnv: ["MAILHUB_PROBE_SMTP_HOST"],
              warnings: ["vtj_from_not_external_route_proof"],
            },
            routingProbeGithubSecrets: {
              missingSendVerifySecrets: ["MAILHUB_PROBE_SMTP_HOST", "MAILHUB_PROBE_SMTP_PASS"],
              presentRequiredSecretNames: ["GOOGLE_CLIENT_ID"],
              secretGroups: {
                externalSmtpProof: {
                  missing: ["MAILHUB_PROBE_SMTP_HOST", "MAILHUB_PROBE_SMTP_PASS"],
                  ready: false,
                },
                gmailProof: {
                  missing: [],
                  ready: true,
                },
              },
            },
            mxRecords: [{ exchange: "mx01.lolipop.jp", priority: 50 }],
          },
        },
      ],
    }, "abc123", "parent123");

    expect(summary).toMatchObject({
      available: true,
      generatedAt: "2026-06-17T00:00:00.000Z",
      auditRepoHead: "abc123",
      currentRepoHead: "abc123",
      currentRepoParentHead: "parent123",
      repoHeadMatches: true,
      productionReady: false,
      p0Blockers: ["current_shared_gmail_routing"],
      sourceCodeCoverageReady: true,
      sourceInventoryReady: true,
      currentSharedGmailRoutingReady: false,
      routingProbeReady: false,
      routingProbePreflightReady: false,
      routingProbeGithubSecretsReady: false,
      defaultViewsRealDataValidated: true,
      defaultViewsManualReviewOnly: true,
      defaultViewsBulkAutomationSafe: false,
      defaultViewsManualReviewOnlyViews: ["invoice-docs", "customer-inquiries"],
      defaultViewsBulkUnsafeViews: ["customer-inquiries"],
      currentRuleConfigRealDataSafetyReady: true,
      currentRuleConfigFingerprintPresent: true,
      currentRuleConfigSourceProductionReady: false,
      staffWorkflowPermissionsReady: false,
      staffReadOnlyRolloutReady: false,
      staffControlledWritePilotReady: false,
      ruleConfigFingerprint: "sha256:abc123",
      ruleConfigSourceRequested: "file",
      ruleConfigSourceResolved: "file",
      ruleConfigSourceWarnings: ["not_sheets"],
      unconfirmedChannels: ["gopro-yahoo", "ebay"],
      missingProbeAddresses: ["gopro_y@vtj.co.jp", "ebay@vtj.co.jp"],
      missingProbeSmtpEnv: ["MAILHUB_PROBE_SMTP_HOST"],
      missingGithubRoutingSecrets: ["MAILHUB_PROBE_SMTP_HOST", "MAILHUB_PROBE_SMTP_PASS"],
      missingGithubExternalSmtpSecrets: ["MAILHUB_PROBE_SMTP_HOST", "MAILHUB_PROBE_SMTP_PASS"],
      missingGithubGmailProofSecrets: [],
      githubExternalSmtpSecretsReady: false,
      githubGmailProofSecretsReady: true,
      presentGithubRoutingSecrets: ["GOOGLE_CLIENT_ID"],
      probeSmtpWarnings: ["vtj_from_not_external_route_proof"],
      mxRecords: [{ exchange: "mx01.lolipop.jp", priority: 50 }],
    });
  });

  test("returns an unavailable summary for malformed audit input", () => {
    expect(summarizeProductionReadinessAudit(null)).toEqual(unavailableOpsReadinessSummary());
  });

  test("treats the current parent head as fresh for committed audit artifacts", () => {
    const summary = summarizeProductionReadinessAudit({
      repoHead: "parent123",
      requirements: {},
      gate: { productionReady: false, p0Blockers: [], p1Blockers: [] },
      blockers: [],
    }, "current123", "parent123");

    expect(summary.repoHeadMatches).toBe(true);
  });

  test("marks the readiness summary stale when audit and current lineage differ", () => {
    const summary = summarizeProductionReadinessAudit({
      repoHead: "old123",
      requirements: {},
      gate: { productionReady: false, p0Blockers: [], p1Blockers: [] },
      blockers: [],
    }, "current123", "parent123");

    expect(summary.repoHeadMatches).toBe(false);
  });
});
