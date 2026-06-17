import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  summarizeProductionReadinessAudit,
  unavailableOpsReadinessSummary,
} from "@/lib/opsReadinessSummary";

function git(repoRoot: string, args: string[]) {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function writeRepoFile(repoRoot: string, relativePath: string, content: string) {
  const path = join(repoRoot, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function commitRepo(repoRoot: string, message: string) {
  git(repoRoot, ["add", "."]);
  git(repoRoot, ["commit", "-m", message]);
  return git(repoRoot, ["rev-parse", "HEAD"]);
}

function withTempGitRepo<T>(fn: (repo: { dir: string; parentHead: string }) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "mailhub-ops-readiness-git-"));
  try {
    git(dir, ["init"]);
    git(dir, ["config", "user.name", "MailHub Test"]);
    git(dir, ["config", "user.email", "mailhub-test@example.com"]);
    writeRepoFile(dir, "lib/app.ts", "export const version = 1;\n");
    const parentHead = commitRepo(dir, "base");
    return fn({ dir, parentHead });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function withCwd<T>(dir: string, fn: () => T): T {
  const previousCwd = process.cwd();
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(previousCwd);
  }
}

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

  test("marks parent-headed artifacts stale unless the current commit is artifact-only", () => {
    const summary = summarizeProductionReadinessAudit({
      repoHead: "parent123",
      requirements: {},
      gate: { productionReady: false, p0Blockers: [], p1Blockers: [] },
      blockers: [],
    }, "current123", "parent123");

    expect(summary.repoHeadMatches).toBe(false);
  });

  test("treats parent-headed artifacts fresh when the current commit only refreshes artifacts", () => {
    withTempGitRepo(({ dir, parentHead }) => {
      writeRepoFile(dir, ".ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json", "{\"ok\":true}\n");
      const currentHead = commitRepo(dir, "refresh artifacts");

      withCwd(dir, () => {
        const summary = summarizeProductionReadinessAudit({
          repoHead: parentHead,
          requirements: {},
          gate: { productionReady: false, p0Blockers: [], p1Blockers: [] },
          blockers: [],
        }, currentHead, parentHead);

        expect(summary.repoHeadMatches).toBe(true);
      });
    });
  });

  test("marks parent-headed artifacts stale when the current commit mixes artifacts and code", () => {
    withTempGitRepo(({ dir, parentHead }) => {
      writeRepoFile(dir, ".ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json", "{\"ok\":true}\n");
      writeRepoFile(dir, "lib/app.ts", "export const version = 2;\n");
      const currentHead = commitRepo(dir, "mixed change");

      withCwd(dir, () => {
        const summary = summarizeProductionReadinessAudit({
          repoHead: parentHead,
          requirements: {},
          gate: { productionReady: false, p0Blockers: [], p1Blockers: [] },
          blockers: [],
        }, currentHead, parentHead);

        expect(summary.repoHeadMatches).toBe(false);
      });
    });
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
