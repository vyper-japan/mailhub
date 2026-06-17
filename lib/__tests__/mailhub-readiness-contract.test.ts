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
      defaultViewsRealDataValidated: true,
      defaultViewsManualReviewOnly: true,
      currentRuleConfigRealDataSafetyReady: true,
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
          mxRecords: [{ exchange: "mx01.lolipop.jp", priority: 50 }],
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
});
