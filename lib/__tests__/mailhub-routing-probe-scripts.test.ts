import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawnSync } from "child_process";
import { describe, expect, test } from "vitest";

const routingProbeAuditPath = resolve(process.cwd(), "scripts/audit-mailhub-routing-probes.mjs");
const readinessAuditPath = resolve(process.cwd(), "scripts/audit-mailhub-production-readiness.mjs");
const routingProbeSenderPath = resolve(process.cwd(), "scripts/send-mailhub-routing-probes.mjs");

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "mailhub-routing-probes-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function runNodeScript(scriptPath: string, args: string[], env: Partial<NodeJS.ProcessEnv> = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function opsAuditFixture() {
  return {
    generatedAt: "2026-06-17T00:00:00.000Z",
    gate: {
      sourceInventoryMissing: [],
      productionCompleteClaimReady: false,
      currentSharedGmailRoutingUnconfirmed: ["multi-source", "single-source"],
      noSharedInboxEvidence: ["single-source"],
      routingConfirmationRequired: ["multi-source", "single-source"],
    },
    operationalConfirmations: [
      {
        id: "multi-source",
        label: "Multi Source",
        addresses: ["first@example.com", "second@example.com"],
      },
      {
        id: "single-source",
        label: "Single Source",
        addresses: ["third@example.com"],
      },
      {
        id: "already-confirmed",
        label: "Already Confirmed",
        addresses: ["ignored@example.com"],
      },
    ],
  };
}

function writeReadinessFixtures(dir: string, routingProbeGate: Record<string, unknown>) {
  const paths = {
    source: join(dir, "source.json"),
    ops: join(dir, "ops.json"),
    gws: join(dir, "gws.json"),
    routing: join(dir, "routing.json"),
    views: join(dir, "views.json"),
    rules: join(dir, "rules.json"),
    out: join(dir, "readiness.json"),
  };
  writeJson(paths.source, {
    generatedAt: "2026-06-17T00:00:00.000Z",
    zeroEstimateAnalysis: {
      knownCodeGaps: [],
      coverageGate: { codeCoveragePass: true },
    },
  });
  writeJson(paths.ops, opsAuditFixture());
  writeJson(paths.gws, {
    generatedAt: "2026-06-17T00:00:00.000Z",
    gate: {
      currentSharedGmailRoutingConfirmed: false,
    },
    dns: {
      mxRecords: [{ exchange: "mx01.lolipop.jp", priority: 50 }],
    },
  });
  writeJson(paths.routing, {
    generatedAt: "2026-06-17T00:00:00.000Z",
    gate: routingProbeGate,
  });
  writeJson(paths.views, {
    generatedAt: "2026-06-17T00:00:00.000Z",
    views: [{ id: "invoices", syntaxAccepted: true, hasMoreAfterMaxPages: false }],
  });
  writeJson(paths.rules, {
    generatedAt: "2026-06-17T00:00:00.000Z",
    ruleSafetyGate: { realDataRuleRiskPass: true },
  });
  return paths;
}

describe("MailHub routing probe CLI gates", () => {
  test("plan-only routing probe audit reports every target address, not just channels", () => {
    withTempDir((dir) => {
      const opsPath = join(dir, "ops.json");
      const outPath = join(dir, "routing-probe.json");
      writeJson(opsPath, opsAuditFixture());

      const result = runNodeScript(routingProbeAuditPath, [
        "--ops-audit",
        opsPath,
        "--out",
        outPath,
      ]);

      expect(result.status).toBe(0);
      const out = readJson<{
        mode: string;
        plannedAddressProbes: Array<{ address: string; channelId: string }>;
        gate: {
          targetChannelCount: number;
          targetAddressCount: number;
          missingChannels: string[];
          missingAddresses: string[];
          allExpectedAddressesConfirmed: boolean;
        };
      }>(outPath);
      expect(out.mode).toBe("plan_only");
      expect(out.gate.targetChannelCount).toBe(2);
      expect(out.gate.targetAddressCount).toBe(3);
      expect(out.gate.missingChannels).toEqual(["multi-source", "single-source"]);
      expect(out.gate.missingAddresses).toEqual([
        "first@example.com",
        "second@example.com",
        "third@example.com",
      ]);
      expect(out.plannedAddressProbes.map((item) => item.address)).toEqual([
        "first@example.com",
        "second@example.com",
        "third@example.com",
      ]);
      expect(out.gate.allExpectedAddressesConfirmed).toBe(false);
    });
  });

  test("production readiness rejects channel-level probe success when address evidence is incomplete", () => {
    withTempDir((dir) => {
      const paths = writeReadinessFixtures(dir, {
        markerProvided: true,
        targetChannelCount: 2,
        targetAddressCount: 3,
        matchedChannels: ["multi-source", "single-source"],
        missingChannels: [],
        matchedAddresses: ["first@example.com", "third@example.com"],
        missingAddresses: ["second@example.com"],
        allExpectedChannelsConfirmed: true,
        allExpectedAddressesConfirmed: false,
      });

      const result = runNodeScript(readinessAuditPath, [
        "--source-audit",
        paths.source,
        "--ops-audit",
        paths.ops,
        "--gws-routing-audit",
        paths.gws,
        "--routing-probe-audit",
        paths.routing,
        "--views-audit",
        paths.views,
        "--rules-audit",
        paths.rules,
        "--out",
        paths.out,
      ]);

      expect(result.status).toBe(0);
      const out = readJson<{
        requirements: {
          routingProbeReady: boolean;
          currentSharedGmailRoutingReady: boolean;
        };
        gate: {
          productionReady: boolean;
          p0Blockers: string[];
        };
      }>(paths.out);
      expect(out.requirements.routingProbeReady).toBe(false);
      expect(out.requirements.currentSharedGmailRoutingReady).toBe(false);
      expect(out.gate.productionReady).toBe(false);
      expect(out.gate.p0Blockers).toEqual(["current_shared_gmail_routing"]);
    });
  });

  test("production readiness accepts complete address-level probe evidence", () => {
    withTempDir((dir) => {
      const paths = writeReadinessFixtures(dir, {
        markerProvided: true,
        targetChannelCount: 2,
        targetAddressCount: 3,
        matchedChannels: ["multi-source", "single-source"],
        missingChannels: [],
        matchedAddresses: ["first@example.com", "second@example.com", "third@example.com"],
        missingAddresses: [],
        allExpectedChannelsConfirmed: true,
        allExpectedAddressesConfirmed: true,
      });

      const result = runNodeScript(readinessAuditPath, [
        "--source-audit",
        paths.source,
        "--ops-audit",
        paths.ops,
        "--gws-routing-audit",
        paths.gws,
        "--routing-probe-audit",
        paths.routing,
        "--views-audit",
        paths.views,
        "--rules-audit",
        paths.rules,
        "--out",
        paths.out,
      ]);

      expect(result.status).toBe(0);
      const out = readJson<{
        requirements: {
          routingProbeReady: boolean;
          currentSharedGmailRoutingReady: boolean;
        };
        gate: {
          productionReady: boolean;
          p0Blockers: string[];
        };
      }>(paths.out);
      expect(out.requirements.routingProbeReady).toBe(true);
      expect(out.requirements.currentSharedGmailRoutingReady).toBe(true);
      expect(out.gate.productionReady).toBe(true);
      expect(out.gate.p0Blockers).toEqual([]);
    });
  });

  test("routing probe sender dry-run writes the address plan without sending", () => {
    withTempDir((dir) => {
      const opsPath = join(dir, "ops.json");
      const outPath = join(dir, "send-plan.json");
      writeJson(opsPath, opsAuditFixture());

      const result = runNodeScript(routingProbeSenderPath, [
        "--ops-audit",
        opsPath,
        "--out",
        outPath,
        "--marker",
        "MAILHUB-ROUTING-PROBE-FIXTURE",
      ]);

      expect(result.status).toBe(0);
      const out = readJson<{
        mode: string;
        marker: string;
        probeCount: number;
        addressProbes: Array<{ address: string }>;
        sent: unknown[];
        nextVerificationCommand: string;
      }>(outPath);
      expect(out.mode).toBe("dry_run");
      expect(out.marker).toBe("MAILHUB-ROUTING-PROBE-FIXTURE");
      expect(out.probeCount).toBe(3);
      expect(out.addressProbes.map((item) => item.address)).toEqual([
        "first@example.com",
        "second@example.com",
        "third@example.com",
      ]);
      expect(out.sent).toEqual([]);
      expect(out.nextVerificationCommand).toContain("MAILHUB-ROUTING-PROBE-FIXTURE");
    });
  });

  test("routing probe sender rejects vtj.co.jp senders as external-route proof by default", () => {
    withTempDir((dir) => {
      const opsPath = join(dir, "ops.json");
      const outPath = join(dir, "send-plan.json");
      writeJson(opsPath, opsAuditFixture());

      const result = runNodeScript(
        routingProbeSenderPath,
        ["--ops-audit", opsPath, "--out", outPath, "--send"],
        { MAILHUB_PROBE_FROM: "probe@vtj.co.jp" },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("vtj_from_not_external_route_proof");
    });
  });
});
