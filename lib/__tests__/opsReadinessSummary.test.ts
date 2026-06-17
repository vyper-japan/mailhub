import { describe, expect, test } from "vitest";
import {
  summarizeProductionReadinessAudit,
  unavailableOpsReadinessSummary,
} from "@/lib/opsReadinessSummary";

describe("opsReadinessSummary", () => {
  test("summarizes production readiness blockers for the Ops Board", () => {
    const summary = summarizeProductionReadinessAudit({
      generatedAt: "2026-06-17T00:00:00.000Z",
      requirements: {
        sourceCodeCoverageReady: true,
        sourceInventoryReady: true,
        currentSharedGmailRoutingReady: false,
        routingProbeReady: false,
        defaultViewsRealDataValidated: true,
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
            currentSharedGmailRoutingUnconfirmed: ["gopro-yahoo", "ebay"],
            routingProbeGate: {
              missingAddresses: ["gopro_y@vtj.co.jp", "ebay@vtj.co.jp"],
            },
            mxRecords: [{ exchange: "mx01.lolipop.jp", priority: 50 }],
          },
        },
      ],
    });

    expect(summary).toMatchObject({
      available: true,
      generatedAt: "2026-06-17T00:00:00.000Z",
      productionReady: false,
      p0Blockers: ["current_shared_gmail_routing"],
      sourceCodeCoverageReady: true,
      sourceInventoryReady: true,
      currentSharedGmailRoutingReady: false,
      routingProbeReady: false,
      defaultViewsRealDataValidated: true,
      currentRuleConfigRealDataSafetyReady: true,
      unconfirmedChannels: ["gopro-yahoo", "ebay"],
      missingProbeAddresses: ["gopro_y@vtj.co.jp", "ebay@vtj.co.jp"],
      mxRecords: [{ exchange: "mx01.lolipop.jp", priority: 50 }],
    });
  });

  test("returns an unavailable summary for malformed audit input", () => {
    expect(summarizeProductionReadinessAudit(null)).toEqual(unavailableOpsReadinessSummary());
  });
});
