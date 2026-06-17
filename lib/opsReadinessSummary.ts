import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type OpsReadinessSummary = {
  available: boolean;
  generatedAt: string | null;
  productionReady: boolean;
  p0Blockers: string[];
  p1Blockers: string[];
  sourceCodeCoverageReady: boolean;
  sourceInventoryReady: boolean;
  currentSharedGmailRoutingReady: boolean;
  routingProbeReady: boolean;
  defaultViewsRealDataValidated: boolean;
  currentRuleConfigRealDataSafetyReady: boolean;
  unconfirmedChannels: string[];
  missingProbeAddresses: string[];
  mxRecords: Array<{ exchange: string; priority: number }>;
};

export function unavailableOpsReadinessSummary(): OpsReadinessSummary {
  return {
    available: false,
    generatedAt: null,
    productionReady: false,
    p0Blockers: [],
    p1Blockers: [],
    sourceCodeCoverageReady: false,
    sourceInventoryReady: false,
    currentSharedGmailRoutingReady: false,
    routingProbeReady: false,
    defaultViewsRealDataValidated: false,
    currentRuleConfigRealDataSafetyReady: false,
    unconfirmedChannels: [],
    missingProbeAddresses: [],
    mxRecords: [],
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function mxRecords(value: unknown): Array<{ exchange: string; priority: number }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      if (typeof record.exchange !== "string" || typeof record.priority !== "number") return null;
      return { exchange: record.exchange, priority: record.priority };
    })
    .filter((item): item is { exchange: string; priority: number } => item !== null);
}

export function summarizeProductionReadinessAudit(value: unknown): OpsReadinessSummary {
  if (!value || typeof value !== "object") return unavailableOpsReadinessSummary();
  const audit = value as Record<string, unknown>;
  const requirements = (audit.requirements && typeof audit.requirements === "object")
    ? audit.requirements as Record<string, unknown>
    : {};
  const gate = (audit.gate && typeof audit.gate === "object")
    ? audit.gate as Record<string, unknown>
    : {};
  const blockers = Array.isArray(audit.blockers) ? audit.blockers : [];
  const routingBlocker = blockers
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .find((item) => item.id === "current_shared_gmail_routing");
  const evidence = routingBlocker?.evidence && typeof routingBlocker.evidence === "object"
    ? routingBlocker.evidence as Record<string, unknown>
    : {};
  const routingProbeGate = evidence.routingProbeGate && typeof evidence.routingProbeGate === "object"
    ? evidence.routingProbeGate as Record<string, unknown>
    : {};

  return {
    available: true,
    generatedAt: typeof audit.generatedAt === "string" ? audit.generatedAt : null,
    productionReady: gate.productionReady === true,
    p0Blockers: stringArray(gate.p0Blockers),
    p1Blockers: stringArray(gate.p1Blockers),
    sourceCodeCoverageReady: requirements.sourceCodeCoverageReady === true,
    sourceInventoryReady: requirements.sourceInventoryReady === true,
    currentSharedGmailRoutingReady: requirements.currentSharedGmailRoutingReady === true,
    routingProbeReady: requirements.routingProbeReady === true,
    defaultViewsRealDataValidated: requirements.defaultViewsRealDataValidated === true,
    currentRuleConfigRealDataSafetyReady: requirements.currentRuleConfigRealDataSafetyReady === true,
    unconfirmedChannels: stringArray(evidence.currentSharedGmailRoutingUnconfirmed),
    missingProbeAddresses: stringArray(routingProbeGate.missingAddresses),
    mxRecords: mxRecords(evidence.mxRecords),
  };
}

export function readOpsReadinessSummary(path = join(process.cwd(), ".ai-runs", "mailhub-next-phase", "mailhub-production-readiness-audit.json")): OpsReadinessSummary {
  if (!existsSync(path)) return unavailableOpsReadinessSummary();
  try {
    return summarizeProductionReadinessAudit(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return unavailableOpsReadinessSummary();
  }
}
