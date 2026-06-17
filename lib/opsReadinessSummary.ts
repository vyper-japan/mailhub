import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export type OpsReadinessSummary = {
  available: boolean;
  generatedAt: string | null;
  auditRepoHead: string | null;
  currentRepoHead: string | null;
  currentRepoParentHead: string | null;
  repoHeadMatches: boolean | null;
  productionReady: boolean;
  p0Blockers: string[];
  p1Blockers: string[];
  sourceCodeCoverageReady: boolean;
  sourceInventoryReady: boolean;
  currentSharedGmailRoutingReady: boolean;
  routingProbeReady: boolean;
  routingProbePreflightReady: boolean;
  routingProbeGithubSecretsReady: boolean;
  defaultViewsRealDataValidated: boolean;
  defaultViewsManualReviewOnly: boolean;
  defaultViewsBulkAutomationSafe: boolean;
  currentRuleConfigRealDataSafetyReady: boolean;
  currentRuleConfigFingerprintPresent: boolean;
  ruleConfigFingerprint: string | null;
  unconfirmedChannels: string[];
  missingProbeAddresses: string[];
  missingProbeSmtpEnv: string[];
  missingGithubRoutingSecrets: string[];
  missingGithubExternalSmtpSecrets: string[];
  missingGithubGmailProofSecrets: string[];
  githubExternalSmtpSecretsReady: boolean;
  githubGmailProofSecretsReady: boolean;
  presentGithubRoutingSecrets: string[];
  probeSmtpWarnings: string[];
  mxRecords: Array<{ exchange: string; priority: number }>;
};

const EXTERNAL_SMTP_SECRET_NAMES = [
  "MAILHUB_PROBE_SMTP_HOST",
  "MAILHUB_PROBE_SMTP_USER",
  "MAILHUB_PROBE_SMTP_PASS",
  "MAILHUB_PROBE_FROM",
];

const GMAIL_PROOF_SECRET_NAMES = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_SHARED_INBOX_EMAIL",
  "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
];

export function unavailableOpsReadinessSummary(): OpsReadinessSummary {
  return {
    available: false,
    generatedAt: null,
    auditRepoHead: null,
    currentRepoHead: null,
    currentRepoParentHead: null,
    repoHeadMatches: null,
    productionReady: false,
    p0Blockers: [],
    p1Blockers: [],
    sourceCodeCoverageReady: false,
    sourceInventoryReady: false,
    currentSharedGmailRoutingReady: false,
    routingProbeReady: false,
    routingProbePreflightReady: false,
    routingProbeGithubSecretsReady: false,
    defaultViewsRealDataValidated: false,
    defaultViewsManualReviewOnly: false,
    defaultViewsBulkAutomationSafe: false,
    currentRuleConfigRealDataSafetyReady: false,
    currentRuleConfigFingerprintPresent: false,
    ruleConfigFingerprint: null,
    unconfirmedChannels: [],
    missingProbeAddresses: [],
    missingProbeSmtpEnv: [],
    missingGithubRoutingSecrets: [],
    missingGithubExternalSmtpSecrets: [],
    missingGithubGmailProofSecrets: [],
    githubExternalSmtpSecretsReady: false,
    githubGmailProofSecretsReady: false,
    presentGithubRoutingSecrets: [],
    probeSmtpWarnings: [],
    mxRecords: [],
  };
}

function gitRevParse(ref: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", ref], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function repoHeadMatchesAudit(auditRepoHead: string | null, currentHead: string | null, currentParentHead: string | null): boolean | null {
  if (!auditRepoHead || !currentHead) return null;
  return auditRepoHead === currentHead || auditRepoHead === currentParentHead;
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

export function summarizeProductionReadinessAudit(
  value: unknown,
  currentHead: string | null = null,
  currentParentHead: string | null = null,
): OpsReadinessSummary {
  if (!value || typeof value !== "object") return unavailableOpsReadinessSummary();
  const audit = value as Record<string, unknown>;
  const auditRepoHead = typeof audit.repoHead === "string" ? audit.repoHead : null;
  const repoHeadMatches = repoHeadMatchesAudit(auditRepoHead, currentHead, currentParentHead);
  const requirements = (audit.requirements && typeof audit.requirements === "object")
    ? audit.requirements as Record<string, unknown>
    : {};
  const gate = (audit.gate && typeof audit.gate === "object")
    ? audit.gate as Record<string, unknown>
    : {};
  const inputs = (audit.inputs && typeof audit.inputs === "object")
    ? audit.inputs as Record<string, unknown>
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
  const routingProbePreflight = evidence.routingProbePreflight && typeof evidence.routingProbePreflight === "object"
    ? evidence.routingProbePreflight as Record<string, unknown>
    : {};
  const routingProbeGithubSecrets = evidence.routingProbeGithubSecrets && typeof evidence.routingProbeGithubSecrets === "object"
    ? evidence.routingProbeGithubSecrets as Record<string, unknown>
    : {};
  const secretGroups = routingProbeGithubSecrets.secretGroups && typeof routingProbeGithubSecrets.secretGroups === "object"
    ? routingProbeGithubSecrets.secretGroups as Record<string, unknown>
    : {};
  const externalSmtpProof = secretGroups.externalSmtpProof && typeof secretGroups.externalSmtpProof === "object"
    ? secretGroups.externalSmtpProof as Record<string, unknown>
    : {};
  const gmailProof = secretGroups.gmailProof && typeof secretGroups.gmailProof === "object"
    ? secretGroups.gmailProof as Record<string, unknown>
    : {};
  const missingGithubRoutingSecrets = stringArray(routingProbeGithubSecrets.missingSendVerifySecrets);
  const missingGithubExternalSmtpSecrets = stringArray(externalSmtpProof.missing);
  const missingGithubGmailProofSecrets = stringArray(gmailProof.missing);
  const resolvedMissingGithubExternalSmtpSecrets = missingGithubExternalSmtpSecrets.length > 0 || externalSmtpProof.ready === true
    ? missingGithubExternalSmtpSecrets
    : missingGithubRoutingSecrets.filter((name) => EXTERNAL_SMTP_SECRET_NAMES.includes(name));
  const resolvedMissingGithubGmailProofSecrets = missingGithubGmailProofSecrets.length > 0 || gmailProof.ready === true
    ? missingGithubGmailProofSecrets
    : missingGithubRoutingSecrets.filter((name) => GMAIL_PROOF_SECRET_NAMES.includes(name));

  return {
    available: true,
    generatedAt: typeof audit.generatedAt === "string" ? audit.generatedAt : null,
    auditRepoHead,
    currentRepoHead: currentHead,
    currentRepoParentHead: currentParentHead,
    repoHeadMatches,
    productionReady: gate.productionReady === true,
    p0Blockers: stringArray(gate.p0Blockers),
    p1Blockers: stringArray(gate.p1Blockers),
    sourceCodeCoverageReady: requirements.sourceCodeCoverageReady === true,
    sourceInventoryReady: requirements.sourceInventoryReady === true,
    currentSharedGmailRoutingReady: requirements.currentSharedGmailRoutingReady === true,
    routingProbeReady: requirements.routingProbeReady === true,
    routingProbePreflightReady: requirements.routingProbePreflightReady === true,
    routingProbeGithubSecretsReady: requirements.routingProbeGithubSecretsReady === true,
    defaultViewsRealDataValidated: requirements.defaultViewsRealDataValidated === true,
    defaultViewsManualReviewOnly: requirements.defaultViewsManualReviewOnly === true,
    defaultViewsBulkAutomationSafe: requirements.defaultViewsBulkAutomationSafe === true,
    currentRuleConfigRealDataSafetyReady: requirements.currentRuleConfigRealDataSafetyReady === true,
    currentRuleConfigFingerprintPresent: requirements.currentRuleConfigFingerprintPresent === true,
    ruleConfigFingerprint: typeof inputs.rulesConfigFingerprint === "string" ? inputs.rulesConfigFingerprint : null,
    unconfirmedChannels: stringArray(evidence.currentSharedGmailRoutingUnconfirmed),
    missingProbeAddresses: stringArray(routingProbeGate.missingAddresses),
    missingProbeSmtpEnv: stringArray(routingProbePreflight.missingRequiredEnv),
    missingGithubRoutingSecrets,
    missingGithubExternalSmtpSecrets: resolvedMissingGithubExternalSmtpSecrets,
    missingGithubGmailProofSecrets: resolvedMissingGithubGmailProofSecrets,
    githubExternalSmtpSecretsReady: externalSmtpProof.ready === true || resolvedMissingGithubExternalSmtpSecrets.length === 0,
    githubGmailProofSecretsReady: gmailProof.ready === true || resolvedMissingGithubGmailProofSecrets.length === 0,
    presentGithubRoutingSecrets: stringArray(routingProbeGithubSecrets.presentRequiredSecretNames),
    probeSmtpWarnings: stringArray(routingProbePreflight.warnings),
    mxRecords: mxRecords(evidence.mxRecords),
  };
}

export function readOpsReadinessSummary(path = join(process.cwd(), ".ai-runs", "mailhub-next-phase", "mailhub-production-readiness-audit.json")): OpsReadinessSummary {
  if (!existsSync(path)) return unavailableOpsReadinessSummary();
  try {
    return summarizeProductionReadinessAudit(
      JSON.parse(readFileSync(path, "utf8")),
      gitRevParse("HEAD"),
      gitRevParse("HEAD^"),
    );
  } catch {
    return unavailableOpsReadinessSummary();
  }
}
