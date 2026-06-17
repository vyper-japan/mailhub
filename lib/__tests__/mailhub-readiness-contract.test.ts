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
      currentRuleConfigRealDataSafetyReady: true,
      currentRuleConfigFingerprintPresent: true,
      staffWorkflowPermissionsReady: false,
      staffReadOnlyRolloutReady: false,
      staffControlledWritePilotReady: false,
    },
    inputs: {
      rulesConfigFingerprint: "sha256:abc123",
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
          currentRuleConfigRealDataSafetyReady: true,
          currentRuleConfigFingerprintPresent: true,
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
