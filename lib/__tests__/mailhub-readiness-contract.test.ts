import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawnSync } from "child_process";
import { describe, expect, test } from "vitest";

const readinessContractPath = resolve(process.cwd(), "scripts/check-mailhub-readiness-contract.mjs");

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "mailhub-readiness-contract-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runContract(auditPath: string, repoHead = "head123", repoParentHead = "parent123") {
  return spawnSync(process.execPath, [
    readinessContractPath,
    "--audit",
    auditPath,
    "--repo-head",
    repoHead,
    "--repo-parent-head",
    repoParentHead,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function baseReadinessAudit(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-06-17T00:00:00.000Z",
    repoHead: "head123",
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
      currentRuleConfigSourceProductionReady: true,
      staffWorkflowPermissionsReady: false,
      staffReadOnlyRolloutReady: false,
      staffControlledWritePilotReady: false,
    },
    inputs: {
      rulesConfigFingerprint: "sha256:abc123",
      ruleConfigSource: {
        requestedSource: "sheets",
        resolvedSource: "sheets",
        warnings: [],
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
      p1Blockers: ["staff_workflow_permissions"],
    },
    blockers: [
      {
        id: "current_shared_gmail_routing",
        severity: "P0",
        evidence: {
          currentSharedGmailRoutingUnconfirmed: ["gopro-yahoo"],
          routingProbeGate: {
            targetAddressCount: 8,
            allExpectedAddressesConfirmed: false,
            missingAddresses: ["gopro_y@vtj.co.jp"],
          },
          routingProbePreflight: {
            readyForProductionProof: false,
            missingRequiredEnv: ["MAILHUB_PROBE_SMTP_HOST"],
            warnings: [],
          },
          routingProbeGithubSecrets: {
            readyForSendVerify: false,
            missingSendVerifySecrets: ["MAILHUB_PROBE_SMTP_HOST"],
          },
          mxRecords: [{ exchange: "mx01.lolipop.jp", priority: 50 }],
        },
      },
      {
        id: "staff_workflow_permissions",
        severity: "P1",
        evidence: {
          staffWorkflowGate: {
            readOnlyRolloutReady: false,
            controlledWritePilotReady: false,
            staffWorkflowPermissionsReady: false,
          },
          staffWorkflowRequirements: {
            staffWorkflowPermissionsReady: false,
          },
          staffWorkflowBlockers: [{ id: "not_production_env", severity: "P1" }],
          escalatesToP0AfterRoutingProof: true,
        },
      },
    ],
    ...overrides,
  };
}

describe("MailHub readiness contract check", () => {
  test("accepts explicit not-ready routing evidence", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      writeJson(auditPath, baseReadinessAudit());

      const result = runContract(auditPath);
      expect(result.status).toBe(0);
      const out = JSON.parse(result.stdout) as { ok: boolean; errors: string[] };
      expect(out.ok).toBe(true);
      expect(out.errors).toEqual([]);
    });
  });

  test("rejects stale readiness artifacts outside current lineage", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      writeJson(auditPath, baseReadinessAudit({ repoHead: "old123" }));

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("stale_repo_head");
    });
  });

  test("rejects routing blockers without preflight gap evidence", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      writeJson(auditPath, baseReadinessAudit({
        blockers: [
          {
            id: "current_shared_gmail_routing",
            severity: "P0",
            evidence: {
              currentSharedGmailRoutingUnconfirmed: ["gopro-yahoo"],
              routingProbeGate: {
                targetAddressCount: 8,
                allExpectedAddressesConfirmed: false,
                missingAddresses: ["gopro_y@vtj.co.jp"],
              },
              routingProbePreflight: {
                readyForProductionProof: false,
                missingRequiredEnv: [],
                warnings: [],
              },
              mxRecords: [{ exchange: "mx01.lolipop.jp", priority: 50 }],
            },
          },
        ],
      }));

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("routing_blocker_missing_preflight_gap");
    });
  });

  test("rejects routing blockers without GitHub secret gap evidence", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      writeJson(auditPath, baseReadinessAudit({
        blockers: [
          {
            id: "current_shared_gmail_routing",
            severity: "P0",
            evidence: {
              currentSharedGmailRoutingUnconfirmed: ["gopro-yahoo"],
              routingProbeGate: {
                targetAddressCount: 8,
                allExpectedAddressesConfirmed: false,
                missingAddresses: ["gopro_y@vtj.co.jp"],
              },
              routingProbePreflight: {
                readyForProductionProof: false,
                missingRequiredEnv: ["MAILHUB_PROBE_SMTP_HOST"],
                warnings: [],
              },
              routingProbeGithubSecrets: {
                readyForSendVerify: false,
                missingSendVerifySecrets: [],
              },
              mxRecords: [{ exchange: "mx01.lolipop.jp", priority: 50 }],
            },
          },
        ],
      }));

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("routing_blocker_missing_github_secret_gap");
    });
  });

  test("rejects rule safety readiness without a config fingerprint", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      const audit = baseReadinessAudit();
      writeJson(auditPath, {
        ...audit,
        requirements: {
          ...audit.requirements,
          currentRuleConfigFingerprintPresent: false,
        },
        inputs: {},
      });

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("rule_safety_ready_without_config_fingerprint");
    });
  });

  test("rejects missing rule config source gate", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      const audit = baseReadinessAudit();
      const requirements = { ...audit.requirements };
      delete (requirements as Record<string, unknown>).currentRuleConfigSourceProductionReady;
      writeJson(auditPath, {
        ...audit,
        requirements,
      });

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("rule_config_source_gate_missing");
    });
  });

  test("rejects non-production rule config source without blocker evidence", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      const audit = baseReadinessAudit();
      writeJson(auditPath, {
        ...audit,
        requirements: {
          ...audit.requirements,
          currentRuleConfigSourceProductionReady: false,
        },
      });

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("rule_config_source_not_ready_without_blocker");
      expect(result.stdout).toContain("rule_config_source_blocker_missing_detail");
    });
  });

  test("accepts non-production rule config source when explicit blocker evidence is present", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      const audit = baseReadinessAudit();
      writeJson(auditPath, {
        ...audit,
        requirements: {
          ...audit.requirements,
          currentRuleConfigSourceProductionReady: false,
        },
        gate: {
          ...audit.gate,
          p1Blockers: ["staff_workflow_permissions", "rule_config_source_not_production"],
        },
        blockers: [
          ...audit.blockers,
          {
            id: "rule_config_source_not_production",
            severity: "P1",
            evidence: {
              ruleConfigSource: {
                requestedSource: "file",
                resolvedSource: "file",
                warnings: [],
              },
              ruleSetFingerprint: "sha256:abc123",
            },
          },
        ],
      });

      const result = runContract(auditPath);
      expect(result.status).toBe(0);
    });
  });

  test("rejects bulk-unsafe default views without unsafe view evidence", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      writeJson(auditPath, baseReadinessAudit({
        viewSafety: {
          syntaxFailedViews: [],
          manualReviewOnlyViews: ["customer-inquiries"],
          bulkUnsafeViews: [],
        },
      }));

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("bulk_unsafe_views_missing");
    });
  });

  test("rejects bulk-unsafe default views that are not marked manual-review only", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      const audit = baseReadinessAudit();
      writeJson(auditPath, {
        ...audit,
        requirements: {
          ...audit.requirements,
          defaultViewsManualReviewOnly: false,
        },
      });

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("bulk_unsafe_views_not_manual_review_only");
    });
  });

  test("rejects validated default views with syntax failure evidence", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      writeJson(auditPath, baseReadinessAudit({
        viewSafety: {
          syntaxFailedViews: ["invoice-docs"],
          manualReviewOnlyViews: ["invoice-docs"],
          bulkUnsafeViews: ["invoice-docs"],
        },
      }));

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("default_views_validated_with_syntax_failures");
    });
  });

  test("rejects production-ready claims missing shared routing readiness", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      writeJson(auditPath, baseReadinessAudit({
        gate: {
          productionReady: true,
          p0Blockers: [],
          p1Blockers: [],
        },
        blockers: [],
      }));

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("production_ready_without_current_shared_gmail_routing");
    });
  });

  test("rejects shared routing readiness without address-level routing probe proof", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      writeJson(auditPath, baseReadinessAudit({
        requirements: {
          sourceCodeCoverageReady: true,
          sourceInventoryReady: true,
          currentSharedGmailRoutingReady: true,
          routingProbeReady: false,
          routingProbePreflightReady: true,
          routingProbeGithubSecretsReady: true,
          defaultViewsRealDataValidated: true,
          defaultViewsManualReviewOnly: true,
          defaultViewsBulkAutomationSafe: false,
          currentRuleConfigRealDataSafetyReady: true,
          currentRuleConfigFingerprintPresent: true,
          currentRuleConfigSourceProductionReady: true,
        },
        gate: {
          productionReady: true,
          p0Blockers: [],
          p1Blockers: [],
        },
        blockers: [],
      }));

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("production_ready_without_routing_probe_proof");
      expect(result.stdout).toContain("shared_routing_ready_without_routing_probe_proof");
    });
  });
});
