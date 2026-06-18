#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { isFreshRepoHead } from "./artifact-freshness.mjs";

const repoRoot = process.cwd();
const runDir = join(repoRoot, ".ai-runs", "mailhub-next-phase");
const defaults = {
  sourceAudit: join(runDir, "gmail-source-coverage-audit.json"),
  opsAudit: join(runDir, "mailhub-operational-confirmations.json"),
  gwsRoutingAudit: join(runDir, "mailhub-gws-routing-audit.json"),
  routingProbeAudit: join(runDir, "mailhub-routing-probe-audit.json"),
  routingProbeSend: join(runDir, "mailhub-routing-probe-send.json"),
  routingProbePreflight: join(runDir, "mailhub-routing-probe-preflight.json"),
  githubRoutingSecrets: join(runDir, "github-routing-secrets-readiness.json"),
  githubStaffSecrets: join(runDir, "github-staff-secrets-readiness.json"),
  viewsAudit: join(runDir, "gmail-default-views-audit.json"),
  rulesAudit: join(runDir, "gmail-rule-safety-audit.json"),
  staffWorkflowAudit: join(runDir, "mailhub-staff-workflow-audit.json"),
  out: join(runDir, "mailhub-production-readiness-audit.json"),
};
const REQUIRED_SEMANTIC_VARIABLE_NAMES = [
  "MAILHUB_ENV",
  "MAILHUB_CONFIG_STORE",
  "MAILHUB_ACTIVITY_STORE",
  "MAILHUB_READ_ONLY",
];
const CANONICAL_ROUTING_PROBE_ADDRESSES = [
  "gopro_y@vtj.co.jp",
  "gopro_order_yahoo@vtj.co.jp",
  "vyper_r@vtj.co.jp",
  "vyper_rakuten@vtj.co.jp",
  "vyperglobal_y@vtj.co.jp",
  "ams_vyper@vtj.co.jp",
  "datacolor_shopify@vtj.co.jp",
  "ebay@vtj.co.jp",
];
const ROUTING_PROBE_MARKER_RE = /^MAILHUB-ROUTING-PROBE-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;
const INPUT_ARTIFACT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ROUTING_PROOF_MAX_AGE_MS = INPUT_ARTIFACT_MAX_AGE_MS;
const STALE_INPUT_BLOCKER_ID = "staleInput";
const INPUT_FRESHNESS_SPECS = [
  { key: "sourceAudit", timestampFields: ["generatedAt"], repoHeadPolicy: "fresh_repo_head", maxAgeMs: INPUT_ARTIFACT_MAX_AGE_MS },
  { key: "opsAudit", timestampFields: ["generatedAt"], repoHeadPolicy: "fresh_repo_head", maxAgeMs: INPUT_ARTIFACT_MAX_AGE_MS },
  { key: "gwsRoutingAudit", timestampFields: ["generatedAt"], repoHeadPolicy: "fresh_repo_head", maxAgeMs: INPUT_ARTIFACT_MAX_AGE_MS },
  { key: "routingProbeAudit", timestampFields: ["generatedAt"], repoHeadPolicy: "fresh_repo_head", maxAgeMs: ROUTING_PROOF_MAX_AGE_MS },
  { key: "routingProbeSend", timestampFields: ["generatedAt"], repoHeadPolicy: "fresh_repo_head", maxAgeMs: ROUTING_PROOF_MAX_AGE_MS },
  { key: "routingProbePreflight", timestampFields: ["generatedAt"], repoHeadPolicy: "fresh_repo_head", maxAgeMs: INPUT_ARTIFACT_MAX_AGE_MS },
  { key: "githubRoutingSecrets", timestampFields: ["checkedAt"], repoHeadPolicy: "fresh_repo_head", maxAgeMs: INPUT_ARTIFACT_MAX_AGE_MS },
  { key: "githubStaffSecrets", timestampFields: ["checkedAt"], repoHeadPolicy: "fresh_repo_head", maxAgeMs: INPUT_ARTIFACT_MAX_AGE_MS },
  { key: "viewsAudit", timestampFields: ["generatedAt"], repoHeadPolicy: "fresh_repo_head", maxAgeMs: INPUT_ARTIFACT_MAX_AGE_MS },
  { key: "rulesAudit", timestampFields: ["generatedAt"], repoHeadPolicy: "fresh_repo_head", maxAgeMs: INPUT_ARTIFACT_MAX_AGE_MS },
  { key: "staffWorkflowAudit", timestampFields: ["generatedAt"], repoHeadPolicy: "fresh_repo_head", maxAgeMs: INPUT_ARTIFACT_MAX_AGE_MS },
];

function parseArgs(argv) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--source-audit") out.sourceAudit = argv[++i];
    else if (arg === "--ops-audit") out.opsAudit = argv[++i];
    else if (arg === "--gws-routing-audit") out.gwsRoutingAudit = argv[++i];
    else if (arg === "--routing-probe-audit") out.routingProbeAudit = argv[++i];
    else if (arg === "--routing-probe-send") out.routingProbeSend = argv[++i];
    else if (arg === "--routing-probe-preflight") out.routingProbePreflight = argv[++i];
    else if (arg === "--github-routing-secrets") out.githubRoutingSecrets = argv[++i];
    else if (arg === "--github-staff-secrets") out.githubStaffSecrets = argv[++i];
    else if (arg === "--views-audit") out.viewsAudit = argv[++i];
    else if (arg === "--rules-audit") out.rulesAudit = argv[++i];
    else if (arg === "--staff-workflow-audit") out.staffWorkflowAudit = argv[++i];
    else if (arg === "--out") out.out = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/audit-mailhub-production-readiness.mjs [--source-audit path] [--ops-audit path] [--gws-routing-audit path] [--routing-probe-audit path] [--routing-probe-send path] [--routing-probe-preflight path] [--github-routing-secrets path] [--github-staff-secrets path] [--views-audit path] [--rules-audit path] [--staff-workflow-audit path] [--out path]`);
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

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function artifactPath(path) {
  const absolutePath = resolve(repoRoot, path);
  const relativePath = relative(repoRoot, absolutePath);
  if (!relativePath || relativePath.startsWith("..") || relativePath.startsWith("/")) return path;
  return relativePath;
}

function probeAddresses(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object" && typeof item.address === "string")
    .map((item) => item.address);
}

function sorted(values) {
  return [...values].sort();
}

function sameStringSet(a, b) {
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}

function isRoutingProbeMarker(value) {
  return routingProbeMarkerDate(value) !== null;
}

function routingProbeMarkerDate(value) {
  if (typeof value !== "string") return null;
  const match = value.match(ROUTING_PROBE_MARKER_RE);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const valid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second;
  return valid ? date : null;
}

function timestampFreshness(value, maxAgeMs, nowMs = Date.now()) {
  if (typeof value !== "string" || value.length === 0) {
    return { fresh: false, status: "missing_timestamp", ageMs: null, maxAgeMs };
  }
  const timestampMs = Date.parse(value);
  if (!Number.isFinite(timestampMs)) {
    return { fresh: false, status: "invalid_timestamp", ageMs: null, maxAgeMs };
  }
  const ageMs = nowMs - timestampMs;
  if (ageMs < 0) return { fresh: false, status: "future_timestamp", ageMs, maxAgeMs };
  if (ageMs > maxAgeMs) return { fresh: false, status: "stale_timestamp", ageMs, maxAgeMs };
  return { fresh: true, status: "fresh", ageMs, maxAgeMs };
}

function markerTimestampFreshness(marker, maxAgeMs, nowMs = Date.now()) {
  const markerDate = routingProbeMarkerDate(marker);
  if (!markerDate) return { fresh: false, status: "invalid_timestamp", ageMs: null, maxAgeMs };
  return timestampFreshness(markerDate.toISOString(), maxAgeMs, nowMs);
}

function routingProofTimestampIssue(label, freshness) {
  if (freshness.fresh) return null;
  const suffix = {
    missing_timestamp: "missing",
    invalid_timestamp: "invalid",
    future_timestamp: "future",
    stale_timestamp: "stale",
  }[freshness.status] ?? freshness.status;
  return `${label}_${suffix}`;
}

function duplicateStrings(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function routingProbeProofStatus({
  routingProbeAudit,
  routingProbeSend,
  routingProbePreflightReady,
  routingProbeGithubSecretsReady,
  nowMs = Date.now(),
}) {
  const issues = [];
  const auditGate = objectValue(routingProbeAudit?.gate);
  const auditMarker = typeof routingProbeAudit?.inputs?.marker === "string" ? routingProbeAudit.inputs.marker : null;
  const auditAddresses = probeAddresses(routingProbeAudit?.plannedAddressProbes);
  const matchedAddresses = stringArray(auditGate.matchedAddresses);
  const missingAddresses = stringArray(auditGate.missingAddresses);
  const sendAddresses = probeAddresses(routingProbeSend?.addressProbes);
  const sentEntries = Array.isArray(routingProbeSend?.sent)
    ? routingProbeSend.sent.filter((item) => item && typeof item === "object")
    : [];
  const sentAddresses = probeAddresses(sentEntries);
  const rejectedAddresses = sentEntries
    .filter((item) => Array.isArray(item.rejected) && item.rejected.length > 0)
    .map((item) => (typeof item.address === "string" ? item.address : "unknown"));
  const sendVerification = objectValue(routingProbeSend?.verification);
  const sendSmtpPreflight = objectValue(routingProbeSend?.smtpPreflight);
  const auditDuplicateAddresses = duplicateStrings(auditAddresses);
  const matchedDuplicateAddresses = duplicateStrings(matchedAddresses);
  const sendDuplicateAddresses = duplicateStrings(sendAddresses);
  const auditGeneratedAtFreshness = timestampFreshness(routingProbeAudit?.generatedAt, ROUTING_PROOF_MAX_AGE_MS, nowMs);
  const sendGeneratedAtFreshness = timestampFreshness(routingProbeSend?.generatedAt, ROUTING_PROOF_MAX_AGE_MS, nowMs);
  const auditMarkerFreshness = markerTimestampFreshness(auditMarker, ROUTING_PROOF_MAX_AGE_MS, nowMs);
  const sendMarkerFreshness = markerTimestampFreshness(routingProbeSend?.marker, ROUTING_PROOF_MAX_AGE_MS, nowMs);

  if (!routingProbeAudit) issues.push("missing_routing_probe_audit");
  if (!routingProbeSend) issues.push("missing_routing_probe_send_artifact");
  const auditGeneratedAtIssue = routingProofTimestampIssue("routing_probe_audit_generated_at", auditGeneratedAtFreshness);
  const sendGeneratedAtIssue = routingProofTimestampIssue("routing_probe_send_generated_at", sendGeneratedAtFreshness);
  if (routingProbeAudit && auditGeneratedAtIssue) issues.push(auditGeneratedAtIssue);
  if (routingProbeSend && sendGeneratedAtIssue) issues.push(sendGeneratedAtIssue);
  if (routingProbeAudit?.mode !== "verify_marker") issues.push("routing_probe_audit_not_verify_marker");
  if (!isRoutingProbeMarker(auditMarker)) issues.push("routing_probe_audit_invalid_marker");
  else if (!auditMarkerFreshness.fresh) issues.push(routingProofTimestampIssue("routing_probe_marker", auditMarkerFreshness));
  if (auditGate.markerProvided !== true) issues.push("routing_probe_audit_marker_missing");
  if (auditGate.allExpectedAddressesConfirmed !== true) issues.push("routing_probe_audit_addresses_unconfirmed");
  if (auditGate.targetAddressCount !== CANONICAL_ROUTING_PROBE_ADDRESSES.length) {
    issues.push("routing_probe_audit_target_count_not_canonical");
  }
  if (auditAddresses.length !== CANONICAL_ROUTING_PROBE_ADDRESSES.length) {
    issues.push("routing_probe_audit_address_count_not_canonical");
  }
  if (auditAddresses.length === 0) issues.push("routing_probe_audit_addresses_missing");
  if (auditDuplicateAddresses.length > 0) issues.push("routing_probe_audit_duplicate_addresses");
  if (matchedDuplicateAddresses.length > 0) issues.push("routing_probe_audit_duplicate_matched_addresses");
  if (!sameStringSet(auditAddresses, CANONICAL_ROUTING_PROBE_ADDRESSES)) {
    issues.push("routing_probe_audit_canonical_address_mismatch");
  }
  if (missingAddresses.length > 0) issues.push("routing_probe_audit_missing_addresses");
  if (!sameStringSet(matchedAddresses, auditAddresses)) issues.push("routing_probe_audit_match_set_mismatch");

  if (routingProbeSend?.mode !== "sent") issues.push("routing_probe_send_not_sent");
  if (!isRoutingProbeMarker(routingProbeSend?.marker)) issues.push("routing_probe_send_invalid_marker");
  else if (!sendMarkerFreshness.fresh && routingProbeSend?.marker !== auditMarker) {
    issues.push(routingProofTimestampIssue("routing_probe_send_marker", sendMarkerFreshness));
  }
  if (sendAddresses.length === 0) issues.push("routing_probe_send_addresses_missing");
  if (sendAddresses.length !== CANONICAL_ROUTING_PROBE_ADDRESSES.length) {
    issues.push("routing_probe_send_address_count_not_canonical");
  }
  if (sendDuplicateAddresses.length > 0) issues.push("routing_probe_send_duplicate_addresses");
  if (!sameStringSet(sendAddresses, CANONICAL_ROUTING_PROBE_ADDRESSES)) {
    issues.push("routing_probe_send_canonical_address_mismatch");
  }
  if (routingProbeSend && routingProbeSend.probeCount !== sendAddresses.length) {
    issues.push("routing_probe_send_probe_count_mismatch");
  }
  if (sentAddresses.length !== sendAddresses.length) issues.push("routing_probe_send_sent_count_mismatch");
  if (!sameStringSet(sentAddresses, sendAddresses)) issues.push("routing_probe_send_sent_address_mismatch");
  if (rejectedAddresses.length > 0) issues.push("routing_probe_send_rejected_addresses");
  if (sendSmtpPreflight.readyForProductionProof !== true) issues.push("routing_probe_send_smtp_not_production_proof");
  if (sendVerification.status !== "matched") issues.push("routing_probe_send_verification_not_matched");
  if (sendVerification.allExpectedAddressesConfirmed !== true) {
    issues.push("routing_probe_send_verification_addresses_unconfirmed");
  }
  if (routingProbeSend?.marker !== auditMarker) issues.push("routing_probe_send_audit_marker_mismatch");
  if (!sameStringSet(sendAddresses, auditAddresses)) issues.push("routing_probe_send_audit_address_mismatch");
  if (routingProbePreflightReady !== true) issues.push("routing_probe_preflight_not_ready");
  if (routingProbeGithubSecretsReady !== true) issues.push("routing_probe_github_secrets_not_ready");

  const sendReady =
    routingProbeSend?.mode === "sent" &&
    sendGeneratedAtFreshness.fresh &&
    sendMarkerFreshness.fresh &&
    isRoutingProbeMarker(routingProbeSend?.marker) &&
    sendAddresses.length === CANONICAL_ROUTING_PROBE_ADDRESSES.length &&
    sendDuplicateAddresses.length === 0 &&
    sameStringSet(sendAddresses, CANONICAL_ROUTING_PROBE_ADDRESSES) &&
    routingProbeSend.probeCount === sendAddresses.length &&
    sentAddresses.length === sendAddresses.length &&
    sameStringSet(sentAddresses, sendAddresses) &&
    rejectedAddresses.length === 0 &&
    sendSmtpPreflight.readyForProductionProof === true &&
    sendVerification.status === "matched" &&
    sendVerification.allExpectedAddressesConfirmed === true;

  return {
    ready: issues.length === 0,
    sendReady,
    issues,
    auditMarker,
    sendMarker: typeof routingProbeSend?.marker === "string" ? routingProbeSend.marker : null,
    auditMode: routingProbeAudit?.mode ?? null,
    sendMode: routingProbeSend?.mode ?? null,
    auditAddressCount: auditAddresses.length,
    sendAddressCount: sendAddresses.length,
    sentCount: sentEntries.length,
    canonicalAddressCount: CANONICAL_ROUTING_PROBE_ADDRESSES.length,
    canonicalAddresses: CANONICAL_ROUTING_PROBE_ADDRESSES,
    auditAddresses,
    sendAddresses,
    missingAddresses,
    rejectedAddresses,
    auditDuplicateAddresses,
    matchedDuplicateAddresses,
    sendDuplicateAddresses,
    maxAgeMs: ROUTING_PROOF_MAX_AGE_MS,
    auditGeneratedAt: typeof routingProbeAudit?.generatedAt === "string" ? routingProbeAudit.generatedAt : null,
    sendGeneratedAt: typeof routingProbeSend?.generatedAt === "string" ? routingProbeSend.generatedAt : null,
    auditGeneratedAtFreshness,
    sendGeneratedAtFreshness,
    auditMarkerFreshness,
    sendMarkerFreshness,
    routingProbePreflightReady,
    routingProbeGithubSecretsReady,
  };
}

function currentRepoHead() {
  return gitRevParse("HEAD");
}

function currentRepoParentHead() {
  return gitRevParse("HEAD^");
}

function gitRevParse(ref) {
  try {
    return execFileSync("git", ["rev-parse", ref], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function semanticVariableSourceIssues(sourceMap) {
  return REQUIRED_SEMANTIC_VARIABLE_NAMES
    .filter((name) => Object.prototype.hasOwnProperty.call(sourceMap, name) && sourceMap[name] !== "variable")
    .map((name) => `${name}_must_be_variable`);
}

function semanticVariableSourcesReady(sourceMap) {
  return REQUIRED_SEMANTIC_VARIABLE_NAMES.every((name) => sourceMap[name] === "variable");
}

function artifactTimestamp(artifact, timestampFields) {
  for (const field of timestampFields) {
    if (typeof artifact?.[field] === "string") return { field, value: artifact[field] };
  }
  return { field: timestampFields[0] ?? null, value: null };
}

function inputFreshnessEntry({ key, timestampFields, repoHeadPolicy, maxAgeMs }, path, artifact, repoHead, repoParentHead, nowMs) {
  const present = artifact !== null && artifact !== undefined;
  const artifactRepoHead = typeof artifact?.repoHead === "string" && artifact.repoHead.length > 0
    ? artifact.repoHead
    : null;
  const timestamp = present ? artifactTimestamp(artifact, timestampFields) : { field: timestampFields[0] ?? null, value: null };
  const timestampFreshnessInfo = maxAgeMs && present
    ? timestampFreshness(timestamp.value, maxAgeMs, nowMs)
    : null;
  const requiresFreshRepoHead = repoHeadPolicy === "fresh_repo_head" && present;
  let repoHeadFresh = null;
  let readyForProduction = true;
  let status = "fresh";

  if (!present) {
    readyForProduction = false;
    status = "missing_required";
  } else if (!artifactRepoHead && requiresFreshRepoHead) {
    readyForProduction = false;
    status = "missing_repo_head";
  } else if (!artifactRepoHead) {
    readyForProduction = false;
    status = "unverifiable_legacy";
  } else {
    repoHeadFresh = isFreshRepoHead({
      repoRoot,
      artifactRepoHead,
      repoHead,
      repoParentHead,
    });
    readyForProduction = repoHeadFresh;
    status = repoHeadFresh ? "fresh" : "stale_repo_head";
  }

  if (readyForProduction && timestampFreshnessInfo && !timestampFreshnessInfo.fresh) {
    readyForProduction = false;
    status = timestampFreshnessInfo.status;
  }

  return {
    key,
    path: artifactPath(path),
    present,
    timestampField: timestamp.field,
    timestamp: timestamp.value,
    repoHeadPolicy,
    requiresFreshRepoHead,
    repoHead: artifactRepoHead,
    repoHeadFresh,
    maxAgeMs: maxAgeMs ?? null,
    timestampFresh: timestampFreshnessInfo ? timestampFreshnessInfo.fresh : null,
    timestampAgeMs: timestampFreshnessInfo ? timestampFreshnessInfo.ageMs : null,
    status,
    readyForProduction,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const nowMs = Date.now();
  const sourceAudit = readJson(args.sourceAudit);
  const opsAudit = readJson(args.opsAudit);
  const gwsRoutingAudit = readJson(args.gwsRoutingAudit);
  const routingProbeAudit = readOptionalJson(args.routingProbeAudit);
  const routingProbeSend = readOptionalJson(args.routingProbeSend);
  const routingProbePreflight = readOptionalJson(args.routingProbePreflight);
  const githubRoutingSecrets = readOptionalJson(args.githubRoutingSecrets);
  const githubStaffSecrets = readOptionalJson(args.githubStaffSecrets);
  const viewsAudit = readJson(args.viewsAudit);
  const rulesAudit = readJson(args.rulesAudit);
  const staffWorkflowAudit = readOptionalJson(args.staffWorkflowAudit);
  const repoHead = currentRepoHead();
  const repoParentHead = currentRepoParentHead();

  const knownCodeGaps = sourceAudit.zeroEstimateAnalysis?.knownCodeGaps ?? [];
  const sourceCodeCoverageReady =
    Boolean(sourceAudit.zeroEstimateAnalysis?.coverageGate?.codeCoveragePass) &&
    knownCodeGaps.length === 0;
  const sourceInventoryReady = (opsAudit.gate?.sourceInventoryMissing ?? []).length === 0;
  const routingProbeReady = Boolean(routingProbeAudit?.gate?.allExpectedAddressesConfirmed);
  const routingProbePreflightReady = Boolean(routingProbePreflight?.smtpPreflight?.readyForProductionProof);
  const routingProbeGithubSecretsReady = Boolean(githubRoutingSecrets?.readyForSendVerify);
  const routingProbeProof = routingProbeProofStatus({
    routingProbeAudit,
    routingProbeSend,
    routingProbePreflightReady,
    routingProbeGithubSecretsReady,
    nowMs,
  });
  const routingProbeSendReady = routingProbeProof.sendReady;
  const routingProofChainReady =
    routingProbeReady &&
    routingProbeProof.ready;
  const currentSharedGmailRoutingReady = routingProofChainReady;
  const viewSyntaxReady = viewsAudit.gate?.syntaxReady === true ||
    (viewsAudit.views ?? []).every((view) => view.syntaxAccepted === true && !view.error);
  const viewSafety = {
    syntaxFailedViews: stringArray(viewsAudit.gate?.syntaxFailedViews),
    manualReviewOnlyViews: stringArray(viewsAudit.gate?.manualReviewOnlyViews),
    bulkUnsafeViews: stringArray(viewsAudit.gate?.bulkUnsafeViews),
  };
  const viewsManualReviewOnly = viewsAudit.gate?.manualReviewOnly === true ||
    (viewsAudit.views ?? []).some(
      (view) => view.risk === "broad_manual_review_only" || view.hasMoreAfterMaxPages === true,
    );
  const defaultViewsBulkAutomationSafe = viewsAudit.gate?.bulkAutomationSafe === true;
  const rulesConfigFingerprint =
    typeof rulesAudit.config?.ruleSetFingerprint === "string" && rulesAudit.config.ruleSetFingerprint.startsWith("sha256:")
      ? rulesAudit.config.ruleSetFingerprint
      : null;
  const ruleAuditInputs = objectValue(rulesAudit.inputs);
  const ruleSafetyAuditEnv = {
    envFile: typeof ruleAuditInputs.envFile === "string" ? ruleAuditInputs.envFile : null,
    envFileLoaded: typeof ruleAuditInputs.envFileLoaded === "boolean" ? ruleAuditInputs.envFileLoaded : null,
    envFileMode: typeof ruleAuditInputs.envFileMode === "string" ? ruleAuditInputs.envFileMode : null,
    valuePolicyPresent: typeof ruleAuditInputs.valuePolicy === "string" && ruleAuditInputs.valuePolicy.length > 0,
  };
  const ruleSafetyEnvSourceExplicit =
    ruleSafetyAuditEnv.envFileMode === "process_env_only" ||
    (ruleSafetyAuditEnv.envFileMode === "env_file" &&
      typeof ruleSafetyAuditEnv.envFile === "string" &&
      ruleSafetyAuditEnv.envFile.length > 0 &&
      ruleSafetyAuditEnv.envFileLoaded === true);
  const ruleConfigFingerprintPresent = Boolean(rulesConfigFingerprint);
  const ruleConfigSource = {
    requestedSource: rulesAudit.config?.requestedSource ?? null,
    resolvedSource: rulesAudit.config?.resolvedSource ?? null,
    ruleSheets: objectValue(rulesAudit.config?.ruleSheets),
    warnings: stringArray(rulesAudit.config?.warnings),
  };
  const ruleConfigSourceProductionReady =
    ruleConfigSource.resolvedSource === "sheets" && ruleConfigSource.warnings.length === 0;
  const ruleSafetyReady = Boolean(rulesAudit.ruleSafetyGate?.realDataRuleRiskPass) && ruleConfigFingerprintPresent;
  const staffWorkflowPermissionsReady = Boolean(staffWorkflowAudit?.gate?.staffWorkflowPermissionsReady);
  const staffGithubConfigSources = objectValue(githubStaffSecrets?.presentRequiredConfigSources);
  const staffGithubSemanticSourceIssues = githubStaffSecrets ? semanticVariableSourceIssues(staffGithubConfigSources) : [];
  const staffGithubSemanticSourcesReady = githubStaffSecrets ? semanticVariableSourcesReady(staffGithubConfigSources) : false;
  const staffGithubRepoHead = typeof githubStaffSecrets?.repoHead === "string" ? githubStaffSecrets.repoHead : null;
  const staffGithubRepoHeadFresh = isFreshRepoHead({
    repoRoot,
    artifactRepoHead: staffGithubRepoHead,
    repoHead,
    repoParentHead,
  });
  const staffGithubConfigReady =
    githubStaffSecrets?.source === "github_actions_config" &&
    staffGithubRepoHeadFresh &&
    githubStaffSecrets?.readyForProductionStaffPreflight === true &&
    githubStaffSecrets?.readyForSecretBackedStaffConfig === true &&
    stringArray(githubStaffSecrets?.semanticIssues).length === 0 &&
    staffGithubSemanticSourcesReady;
  const staffWorkflowBlockerSeverity = currentSharedGmailRoutingReady ? "P0" : "P1";
  const staffGithubConfigBlockerSeverity = currentSharedGmailRoutingReady ? "P0" : "P1";
  const artifactsByKey = {
    sourceAudit,
    opsAudit,
    gwsRoutingAudit,
    routingProbeAudit,
    routingProbeSend,
    routingProbePreflight,
    githubRoutingSecrets,
    githubStaffSecrets,
    viewsAudit,
    rulesAudit,
    staffWorkflowAudit,
  };
  const inputFreshness = INPUT_FRESHNESS_SPECS.map((spec) =>
    inputFreshnessEntry(spec, args[spec.key], artifactsByKey[spec.key], repoHead, repoParentHead, nowMs));
  const staleInputs = inputFreshness.filter((input) => input.readyForProduction !== true);
  const inputArtifactsFresh = staleInputs.length === 0;

  const blockers = [];
  if (!inputArtifactsFresh) {
    blockers.push(blocker(STALE_INPUT_BLOCKER_ID, "P0", "Production readiness input artifacts are stale or unverifiable.", {
      currentRepoHead: repoHead,
      repoParentHead,
      staleInputs,
    }));
  }
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
      routingProbeSend: routingProbeSend ? {
        mode: routingProbeSend.mode ?? null,
        marker: routingProbeSend.marker ?? null,
        probeCount: routingProbeSend.probeCount ?? null,
        addressProbeCount: probeAddresses(routingProbeSend.addressProbes).length,
        sentCount: Array.isArray(routingProbeSend.sent) ? routingProbeSend.sent.length : 0,
        smtpPreflight: routingProbeSend.smtpPreflight ?? null,
        verification: routingProbeSend.verification ?? null,
      } : {
        missingArtifact: args.routingProbeSend,
      },
      routingProofChain: routingProbeProof,
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
  if (!ruleSafetyEnvSourceExplicit) {
    blockers.push(blocker("rule_safety_env_source_unverified", "P1", "Rule-safety audit must record an explicit env source before production readiness.", {
      ruleSafetyAuditEnv,
    }));
  }
  if (!ruleConfigSourceProductionReady) {
    blockers.push(blocker("rule_config_source_not_production", "P1", "Production readiness requires the rule-safety audit to validate the Sheets-backed production rule config.", {
      ruleConfigSource,
      ruleSafetyGate: rulesAudit.ruleSafetyGate ?? null,
      ruleSetFingerprint: rulesConfigFingerprint,
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
  if (!staffGithubConfigReady) {
    blockers.push(blocker("staff_github_config_not_ready", staffGithubConfigBlockerSeverity, "GitHub Actions production staff config is not complete or not backed by required secrets.", {
      staffGithubConfig: githubStaffSecrets ? {
        source: githubStaffSecrets.source ?? null,
        sourceTrusted: githubStaffSecrets.source === "github_actions_config",
        checkedAt: githubStaffSecrets.checkedAt ?? null,
        repoHead: githubStaffSecrets.repoHead ?? null,
        currentRepoHead: repoHead,
        repoParentHead,
        repoHeadMatchesCurrent: githubStaffSecrets.repoHead === repoHead,
        repoHeadFresh: staffGithubRepoHeadFresh,
        secretCount: githubStaffSecrets.secretCount ?? null,
        variableCount: githubStaffSecrets.variableCount ?? null,
        readyForProductionStaffPreflight: githubStaffSecrets.readyForProductionStaffPreflight ?? null,
        readyForSecretBackedStaffConfig: githubStaffSecrets.readyForSecretBackedStaffConfig ?? null,
        missingProductionStaffConfig: githubStaffSecrets.missingProductionStaffConfig ?? [],
        missingSecretConfig: githubStaffSecrets.missingSecretConfig ?? [],
        semanticIssues: githubStaffSecrets.semanticIssues ?? [],
        semanticSourceIssues: staffGithubSemanticSourceIssues,
        presentRequiredConfigNames: githubStaffSecrets.presentRequiredConfigNames ?? [],
        presentRequiredConfigSources: githubStaffSecrets.presentRequiredConfigSources ?? {},
        setupCommands: githubStaffSecrets.setupCommands ?? [],
      } : {
        missingArtifact: args.githubStaffSecrets,
      },
      escalatesToP0AfterRoutingProof: !currentSharedGmailRoutingReady,
    }));
  }

  const result = {
    generatedAt: new Date().toISOString(),
    repoHead,
    inputs: {
      sourceAudit: artifactPath(args.sourceAudit),
      opsAudit: artifactPath(args.opsAudit),
      gwsRoutingAudit: artifactPath(args.gwsRoutingAudit),
      routingProbeAudit: artifactPath(args.routingProbeAudit),
      routingProbeSend: artifactPath(args.routingProbeSend),
      routingProbePreflight: artifactPath(args.routingProbePreflight),
      githubRoutingSecrets: artifactPath(args.githubRoutingSecrets),
      githubStaffSecrets: artifactPath(args.githubStaffSecrets),
      viewsAudit: artifactPath(args.viewsAudit),
      rulesAudit: artifactPath(args.rulesAudit),
      staffWorkflowAudit: artifactPath(args.staffWorkflowAudit),
      sourceAuditGeneratedAt: sourceAudit.generatedAt ?? null,
      opsAuditGeneratedAt: opsAudit.generatedAt ?? null,
      gwsRoutingAuditGeneratedAt: gwsRoutingAudit.generatedAt ?? null,
      routingProbeAuditGeneratedAt: routingProbeAudit?.generatedAt ?? null,
      routingProbeSendGeneratedAt: routingProbeSend?.generatedAt ?? null,
      routingProbePreflightGeneratedAt: routingProbePreflight?.generatedAt ?? null,
      githubRoutingSecretsCheckedAt: githubRoutingSecrets?.checkedAt ?? null,
      githubStaffSecretsCheckedAt: githubStaffSecrets?.checkedAt ?? null,
      viewsAuditGeneratedAt: viewsAudit.generatedAt ?? null,
      rulesAuditGeneratedAt: rulesAudit.generatedAt ?? null,
      ruleSafetyAuditEnv,
      staffWorkflowAuditGeneratedAt: staffWorkflowAudit?.generatedAt ?? null,
      rulesConfigFingerprint,
      ruleConfigSource,
      inputFreshness,
    },
    requirements: {
      inputArtifactsFresh,
      sourceCodeCoverageReady,
      sourceInventoryReady,
      currentSharedGmailRoutingReady,
      routingProbeReady,
      routingProbeSendReady,
      routingProofChainReady,
      routingProbePreflightReady,
      routingProbeGithubSecretsReady,
      defaultViewsRealDataValidated: viewSyntaxReady,
      defaultViewsManualReviewOnly: viewsManualReviewOnly,
      defaultViewsBulkAutomationSafe,
      currentRuleConfigRealDataSafetyReady: ruleSafetyReady,
      currentRuleConfigFingerprintPresent: ruleConfigFingerprintPresent,
      currentRuleConfigSourceProductionReady: ruleConfigSourceProductionReady,
      currentRuleSafetyEnvSourceExplicit: ruleSafetyEnvSourceExplicit,
      staffWorkflowPermissionsReady,
      staffGithubConfigReady,
      staffReadOnlyRolloutReady: staffWorkflowAudit?.gate?.readOnlyRolloutReady === true,
      staffControlledWritePilotReady: staffWorkflowAudit?.gate?.controlledWritePilotReady === true,
    },
    viewSafety,
    blockers,
    gate: {
      productionReady:
        inputArtifactsFresh &&
        sourceCodeCoverageReady &&
        sourceInventoryReady &&
        currentSharedGmailRoutingReady &&
        viewSyntaxReady &&
        ruleSafetyReady &&
        ruleSafetyEnvSourceExplicit &&
        ruleConfigSourceProductionReady &&
        staffWorkflowPermissionsReady &&
        staffGithubConfigReady &&
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
