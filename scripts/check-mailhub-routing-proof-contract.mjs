#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isFreshRepoHead } from "./artifact-freshness.mjs";

const repoRoot = process.cwd();
const runDir = join(repoRoot, ".ai-runs", "mailhub-next-phase");

const defaultPaths = {
  preflight: join(runDir, "mailhub-routing-probe-preflight.json"),
  send: join(runDir, "mailhub-routing-probe-send.json"),
  audit: join(runDir, "mailhub-routing-probe-audit.json"),
  readiness: join(runDir, "mailhub-production-readiness-audit.json"),
};

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
const EXPECTED_TARGET_ADDRESS_COUNT = CANONICAL_ROUTING_PROBE_ADDRESSES.length;
const ROUTING_BLOCKER_ID = "current_shared_gmail_routing";
const ROUTING_PROOF_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ROUTING_PROBE_MARKER_RE = /^MAILHUB-ROUTING-PROBE-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

function parseArgs(argv) {
  const out = { ...defaultPaths, repoHead: "", repoParentHead: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--preflight") out.preflight = argv[++i];
    else if (arg === "--send") out.send = argv[++i];
    else if (arg === "--audit") out.audit = argv[++i];
    else if (arg === "--readiness") out.readiness = argv[++i];
    else if (arg === "--repo-head") out.repoHead = argv[++i];
    else if (arg === "--repo-parent-head") out.repoParentHead = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/check-mailhub-routing-proof-contract.mjs [--preflight path] [--send path] [--audit path] [--readiness path] [--repo-head sha] [--repo-parent-head sha]");
      process.exit(0);
    }
  }
  return out;
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

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`missing_${label}_artifact:${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function probeAddresses(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object" && typeof item.address === "string")
    .map((item) => item.address);
}

function unique(values) {
  return [...new Set(values)];
}

function sameArray(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sorted(values) {
  return [...values].sort();
}

function sameStringSet(a, b) {
  return sameArray(sorted(a), sorted(b));
}

function isProbeMarker(value) {
  return probeMarkerDate(value) !== null;
}

function probeMarkerDate(value) {
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
  const markerDate = probeMarkerDate(marker);
  if (!markerDate) return { fresh: false, status: "invalid_timestamp", ageMs: null, maxAgeMs };
  return timestampFreshness(markerDate.toISOString(), maxAgeMs, nowMs);
}

function proofTimestampIssue(label, freshness) {
  if (freshness.fresh) return null;
  const suffix = {
    missing_timestamp: "missing",
    invalid_timestamp: "invalid",
    future_timestamp: "future",
    stale_timestamp: "stale",
  }[freshness.status] ?? freshness.status;
  return `${label}_${suffix}`;
}

function repoHeadFreshness(label, artifact, repoHead, repoParentHead, errors, warnings) {
  const artifactRepoHead = typeof artifact.repoHead === "string" && artifact.repoHead.length > 0 ? artifact.repoHead : null;
  if (!artifactRepoHead) {
    warnings.push(`missing_${label}_repo_head`);
    return { repoHead: null, fresh: null, status: "missing_repo_head" };
  }
  const fresh = isFreshRepoHead({ repoRoot, artifactRepoHead, repoHead, repoParentHead });
  if (!fresh) errors.push(`stale_${label}_repo_head`);
  return { repoHead: artifactRepoHead, fresh, status: fresh ? "fresh" : "stale_repo_head" };
}

function requireRepoHeadForClaim(label, freshness, required, errors) {
  if (required && freshness.status === "missing_repo_head") errors.push(`missing_${label}_repo_head`);
}

function validateProbeList({ label, artifact, probes, errors }) {
  const addresses = probeAddresses(probes);
  if (artifact.probeCount !== addresses.length) errors.push(`${label}_probe_count_mismatch`);
  if (addresses.length !== EXPECTED_TARGET_ADDRESS_COUNT) errors.push(`${label}_target_address_count_mismatch`);
  if (!sameStringSet(addresses, CANONICAL_ROUTING_PROBE_ADDRESSES)) errors.push(`${label}_canonical_address_mismatch`);
  if (unique(addresses).length !== addresses.length) errors.push(`${label}_duplicate_probe_address`);
  if (!isProbeMarker(artifact.marker)) errors.push(`${label}_invalid_marker`);

  if (Array.isArray(probes)) {
    for (const probe of probes) {
      if (!probe || typeof probe !== "object") continue;
      if (probe.subject !== artifact.marker) errors.push(`${label}_probe_subject_marker_mismatch`);
      if (typeof probe.channelId !== "string" || !probe.channelId) errors.push(`${label}_probe_missing_channel_id`);
      if (typeof probe.label !== "string" || !probe.label) errors.push(`${label}_probe_missing_label`);
    }
  }

  return addresses;
}

function sentAddresses(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object" && typeof item.address === "string")
    .map((item) => item.address);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const preflight = readJson(args.preflight, "preflight");
  const send = readJson(args.send, "send");
  const audit = readJson(args.audit, "audit");
  const readiness = readJson(args.readiness, "readiness");
  const errors = [];
  const warnings = [];

  const preflightSent = Array.isArray(preflight.sent) ? preflight.sent : [];
  const sendSent = Array.isArray(send.sent) ? send.sent : [];
  const auditGate = objectValue(audit.gate);
  const readinessGate = objectValue(readiness.gate);
  const readinessRequirements = objectValue(readiness.requirements);
  const readinessBlockers = Array.isArray(readiness.blockers) ? readiness.blockers.filter((item) => item && typeof item === "object") : [];
  const auditMarker = typeof audit.inputs?.marker === "string" ? audit.inputs.marker : null;
  const repoHead = args.repoHead || gitRevParse("HEAD");
  const repoParentHead = args.repoParentHead || gitRevParse("HEAD^");
  const nowMs = Date.now();
  const repoFreshness = {
    preflight: repoHeadFreshness("preflight", preflight, repoHead, repoParentHead, errors, warnings),
    send: repoHeadFreshness("send", send, repoHead, repoParentHead, errors, warnings),
    audit: repoHeadFreshness("audit", audit, repoHead, repoParentHead, errors, warnings),
    readiness: repoHeadFreshness("readiness", readiness, repoHead, repoParentHead, errors, warnings),
  };
  const auditGeneratedAtFreshness = timestampFreshness(audit.generatedAt, ROUTING_PROOF_MAX_AGE_MS, nowMs);
  const sendGeneratedAtFreshness = timestampFreshness(send.generatedAt, ROUTING_PROOF_MAX_AGE_MS, nowMs);
  const markerFreshness = markerTimestampFreshness(auditMarker, ROUTING_PROOF_MAX_AGE_MS, nowMs);

  if (preflight.mode !== "preflight") errors.push("preflight_mode_mismatch");
  if (preflight.inputs?.preflight !== true) errors.push("preflight_input_flag_missing");
  if (preflight.inputs?.verifyAfterSend !== false) errors.push("preflight_verify_after_send_must_be_false");
  if (preflightSent.length !== 0) errors.push("preflight_must_not_send_mail");
  if (!preflight.smtpPreflight || typeof preflight.smtpPreflight !== "object") errors.push("preflight_missing_smtp_gate");

  const missingRequiredEnv = stringArray(preflight.smtpPreflight?.missingRequiredEnv);
  const readyForProductionProof = preflight.smtpPreflight?.readyForProductionProof === true;
  if (readyForProductionProof && missingRequiredEnv.length > 0) errors.push("preflight_ready_with_missing_env");
  if (readyForProductionProof && preflight.smtpPreflight?.fromIsVtj === true) errors.push("preflight_ready_with_vtj_sender");

  if (!["dry_run", "sent"].includes(send.mode)) errors.push("send_mode_invalid");
  if (send.mode === "dry_run" && sendSent.length !== 0) errors.push("dry_run_must_not_send_mail");
  if (send.mode === "dry_run" && send.verification) errors.push("dry_run_must_not_have_verification");
  if (send.mode === "sent") {
    if (sendSent.length !== send.probeCount) errors.push("sent_mode_sent_count_mismatch");
    if (!send.verification || typeof send.verification !== "object") errors.push("sent_mode_missing_verification");
    if (send.verification && send.verification.allExpectedAddressesConfirmed !== true) errors.push("sent_mode_without_address_confirmation");
    if (!auditMarker) errors.push("sent_mode_missing_audit_marker");
    else if (send.marker !== auditMarker) errors.push("sent_audit_marker_mismatch");
    if (
      send.verification &&
      auditGate.allExpectedAddressesConfirmed !== send.verification.allExpectedAddressesConfirmed
    ) {
      errors.push("sent_verification_audit_confirmation_mismatch");
    }
  }

  const preflightAddresses = validateProbeList({
    label: "preflight",
    artifact: preflight,
    probes: preflight.addressProbes,
    errors,
  });
  const sendAddresses = validateProbeList({
    label: "send",
    artifact: send,
    probes: send.addressProbes,
    errors,
  });
  const auditAddresses = probeAddresses(audit.plannedAddressProbes);
  const sendSentAddresses = sentAddresses(sendSent);
  const preflightCanonical = sameStringSet(preflightAddresses, CANONICAL_ROUTING_PROBE_ADDRESSES);
  const sendCanonical = sameStringSet(sendAddresses, CANONICAL_ROUTING_PROBE_ADDRESSES);
  const auditCanonical = sameStringSet(auditAddresses, CANONICAL_ROUTING_PROBE_ADDRESSES);

  if (audit.mode !== "plan_only" && audit.mode !== "verify_marker") errors.push("audit_mode_invalid");
  if (auditGate.targetAddressCount !== auditAddresses.length) errors.push("audit_target_address_count_mismatch");
  if (auditGate.targetAddressCount !== EXPECTED_TARGET_ADDRESS_COUNT) errors.push("audit_expected_target_address_count_mismatch");
  if (!auditCanonical) errors.push("audit_canonical_address_mismatch");
  if (unique(auditAddresses).length !== auditAddresses.length) errors.push("audit_duplicate_planned_address");
  if (!sameStringSet(preflightAddresses, auditAddresses)) errors.push("preflight_audit_address_mismatch");
  if (!sameStringSet(sendAddresses, auditAddresses)) errors.push("send_audit_address_mismatch");
  if (send.mode === "sent" && !sameStringSet(sendSentAddresses, sendAddresses)) {
    errors.push("send_sent_address_mismatch");
  }
  if (sendSent.some((item) => Array.isArray(item.rejected) && item.rejected.length > 0)) {
    errors.push("send_contains_rejected_addresses");
  }

  const matchedAddresses = stringArray(auditGate.matchedAddresses);
  const missingAddresses = stringArray(auditGate.missingAddresses);
  const partition = sorted([...matchedAddresses, ...missingAddresses]);
  if (!sameArray(partition, sorted(auditAddresses))) errors.push("audit_address_partition_mismatch");
  if (unique([...matchedAddresses, ...missingAddresses]).length !== matchedAddresses.length + missingAddresses.length) {
    errors.push("audit_address_partition_overlap");
  }

  if (audit.mode === "plan_only") {
    if (auditGate.markerProvided !== false) errors.push("plan_only_marker_flag_mismatch");
    if (matchedAddresses.length !== 0) errors.push("plan_only_must_not_match_addresses");
    if (auditGate.allExpectedAddressesConfirmed !== false) errors.push("plan_only_must_not_confirm_addresses");
  }
  if (audit.mode === "verify_marker") {
    if (auditGate.markerProvided !== true) errors.push("verify_marker_flag_mismatch");
    if ((auditGate.allExpectedAddressesConfirmed === true) !== (missingAddresses.length === 0)) {
      errors.push("verify_marker_confirmation_mismatch");
    }
  }

  const sendProofReady =
    send.mode === "sent" &&
    sendGeneratedAtFreshness.fresh &&
    sendSent.length === sendAddresses.length &&
    sendCanonical &&
    sameStringSet(sendSentAddresses, sendAddresses) &&
    send.smtpPreflight?.readyForProductionProof === true &&
    send.verification?.status === "matched" &&
    send.verification?.allExpectedAddressesConfirmed === true;
  const auditProofReady =
    audit.mode === "verify_marker" &&
    auditGeneratedAtFreshness.fresh &&
    markerFreshness.fresh &&
    auditGate.markerProvided === true &&
    auditGate.allExpectedAddressesConfirmed === true &&
    missingAddresses.length === 0 &&
    auditCanonical &&
    sameStringSet(matchedAddresses, auditAddresses);
  const proofChainReady =
    readyForProductionProof &&
    preflightCanonical &&
    sendProofReady &&
    auditProofReady &&
    send.marker === auditMarker &&
    sameStringSet(sendAddresses, auditAddresses);

  const readinessSharedRoutingReady = readinessRequirements.currentSharedGmailRoutingReady === true;
  const readinessRoutingProbeReady = readinessRequirements.routingProbeReady === true;
  const readinessRoutingProbeSendReady = readinessRequirements.routingProbeSendReady === true;
  const readinessRoutingProofChainReady = readinessRequirements.routingProofChainReady === true;
  const shouldRequirePreflightRepoHead =
    readyForProductionProof ||
    readinessSharedRoutingReady ||
    readinessRoutingProofChainReady ||
    readinessGate.productionReady === true;
  const shouldRequireSendRepoHead =
    send.mode === "sent" ||
    send.smtpPreflight?.readyForProductionProof === true ||
    send.verification?.status === "matched" ||
    send.verification?.allExpectedAddressesConfirmed === true ||
    readinessSharedRoutingReady ||
    readinessRoutingProbeSendReady ||
    readinessRoutingProofChainReady ||
    readinessGate.productionReady === true;
  const shouldRequireAuditRepoHead =
    audit.mode === "verify_marker" ||
    auditGate.allExpectedAddressesConfirmed === true ||
    readinessSharedRoutingReady ||
    readinessRoutingProbeReady ||
    readinessRoutingProofChainReady ||
    readinessGate.productionReady === true;
  const shouldRequireReadinessRepoHead =
    readinessSharedRoutingReady ||
    readinessRoutingProbeReady ||
    readinessRoutingProbeSendReady ||
    readinessRoutingProofChainReady ||
    readinessGate.productionReady === true;
  const shouldValidateProofAge =
    send.mode === "sent" ||
    readinessSharedRoutingReady ||
    readinessRoutingProbeSendReady ||
    readinessRoutingProofChainReady ||
    readinessGate.productionReady === true;

  requireRepoHeadForClaim("preflight", repoFreshness.preflight, shouldRequirePreflightRepoHead, errors);
  requireRepoHeadForClaim("send", repoFreshness.send, shouldRequireSendRepoHead, errors);
  requireRepoHeadForClaim("audit", repoFreshness.audit, shouldRequireAuditRepoHead, errors);
  requireRepoHeadForClaim("readiness", repoFreshness.readiness, shouldRequireReadinessRepoHead, errors);

  if (shouldValidateProofAge) {
    const auditGeneratedAtIssue = proofTimestampIssue("routing_probe_audit_generated_at", auditGeneratedAtFreshness);
    const sendGeneratedAtIssue = proofTimestampIssue("routing_probe_send_generated_at", sendGeneratedAtFreshness);
    const markerIssue = proofTimestampIssue("routing_probe_marker", markerFreshness);
    if (auditGeneratedAtIssue) errors.push(auditGeneratedAtIssue);
    if (sendGeneratedAtIssue) errors.push(sendGeneratedAtIssue);
    if (markerIssue) errors.push(markerIssue);
  }

  if (send.mode !== "sent" && (readinessSharedRoutingReady || readinessRoutingProbeSendReady || readinessRoutingProofChainReady)) {
    errors.push("shared_routing_ready_without_sent_artifact");
  }
  if (audit.mode !== "verify_marker" && (readinessSharedRoutingReady || readinessRoutingProofChainReady)) {
    errors.push("shared_routing_ready_without_verify_marker_audit");
  }
  if (readinessRoutingProbeReady !== (auditGate.allExpectedAddressesConfirmed === true)) {
    errors.push("readiness_routing_probe_gate_mismatch");
  }
  if (readinessRoutingProbeSendReady !== sendProofReady) {
    errors.push("readiness_routing_probe_send_mismatch");
  }
  if (readinessRoutingProofChainReady !== proofChainReady) {
    errors.push("readiness_routing_proof_chain_mismatch");
  }
  if (readinessSharedRoutingReady && !proofChainReady) {
    errors.push("shared_routing_ready_without_routing_proof_chain");
  }

  const readinessP0 = stringArray(readinessGate.p0Blockers);
  const routingBlocker = readinessBlockers.find((item) => item.id === ROUTING_BLOCKER_ID);
  const blockerEvidence = objectValue(routingBlocker?.evidence);
  const readinessRoutingGate = objectValue(blockerEvidence.routingProbeGate);
  const readinessMissingAddresses = stringArray(readinessRoutingGate.missingAddresses);

  if (readinessGate.productionReady === true && auditGate.allExpectedAddressesConfirmed !== true) {
    errors.push("production_ready_without_confirmed_routing_probe");
  }
  if (auditGate.allExpectedAddressesConfirmed !== true && !readinessP0.includes(ROUTING_BLOCKER_ID)) {
    errors.push("unconfirmed_routing_without_readiness_p0");
  }
  if (readinessP0.includes(ROUTING_BLOCKER_ID)) {
    if (!routingBlocker) errors.push("readiness_missing_routing_blocker_detail");
    if (!sameArray(sorted(readinessMissingAddresses), sorted(missingAddresses))) {
      errors.push("readiness_routing_missing_addresses_mismatch");
    }
    if (readinessRoutingGate.allExpectedAddressesConfirmed !== auditGate.allExpectedAddressesConfirmed) {
      errors.push("readiness_routing_confirmation_mismatch");
    }
  }

  const result = {
    paths: args,
    mode: {
      preflight: preflight.mode,
      send: send.mode,
      audit: audit.mode,
    },
    probeCount: {
      preflight: preflight.probeCount ?? null,
      send: send.probeCount ?? null,
      audit: auditGate.targetAddressCount ?? null,
    },
    sentCount: sendSent.length,
    repoHead,
    repoParentHead,
    repoFreshness,
    repoHeadRequirements: {
      preflight: shouldRequirePreflightRepoHead,
      send: shouldRequireSendRepoHead,
      audit: shouldRequireAuditRepoHead,
      readiness: shouldRequireReadinessRepoHead,
    },
    readyForProductionProof,
    allExpectedAddressesConfirmed: auditGate.allExpectedAddressesConfirmed === true,
    productionReady: readinessGate.productionReady === true,
    p0Blockers: readinessP0,
    errors,
    warnings,
    ok: errors.length === 0,
  };

  console.log(JSON.stringify(result, null, 2));
  if (errors.length > 0) process.exitCode = 1;
}

main();
