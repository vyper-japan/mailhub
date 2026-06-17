#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const runDir = join(repoRoot, ".ai-runs", "mailhub-next-phase");

const defaultPaths = {
  preflight: join(runDir, "mailhub-routing-probe-preflight.json"),
  send: join(runDir, "mailhub-routing-probe-send.json"),
  audit: join(runDir, "mailhub-routing-probe-audit.json"),
  readiness: join(runDir, "mailhub-production-readiness-audit.json"),
};

const EXPECTED_TARGET_ADDRESS_COUNT = 8;
const ROUTING_BLOCKER_ID = "current_shared_gmail_routing";

function parseArgs(argv) {
  const out = { ...defaultPaths };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--preflight") out.preflight = argv[++i];
    else if (arg === "--send") out.send = argv[++i];
    else if (arg === "--audit") out.audit = argv[++i];
    else if (arg === "--readiness") out.readiness = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/check-mailhub-routing-proof-contract.mjs [--preflight path] [--send path] [--audit path] [--readiness path]");
      process.exit(0);
    }
  }
  return out;
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

function isProbeMarker(value) {
  return typeof value === "string" && /^MAILHUB-ROUTING-PROBE-\d{8}T\d{6}Z$/.test(value);
}

function validateProbeList({ label, artifact, probes, errors }) {
  const addresses = probeAddresses(probes);
  if (artifact.probeCount !== addresses.length) errors.push(`${label}_probe_count_mismatch`);
  if (addresses.length !== EXPECTED_TARGET_ADDRESS_COUNT) errors.push(`${label}_target_address_count_mismatch`);
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
  const readinessBlockers = Array.isArray(readiness.blockers) ? readiness.blockers.filter((item) => item && typeof item === "object") : [];

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

  if (audit.mode !== "plan_only" && audit.mode !== "verify_marker") errors.push("audit_mode_invalid");
  if (auditGate.targetAddressCount !== auditAddresses.length) errors.push("audit_target_address_count_mismatch");
  if (auditGate.targetAddressCount !== EXPECTED_TARGET_ADDRESS_COUNT) errors.push("audit_expected_target_address_count_mismatch");
  if (unique(auditAddresses).length !== auditAddresses.length) errors.push("audit_duplicate_planned_address");
  if (!sameArray(sorted(preflightAddresses), sorted(auditAddresses))) errors.push("preflight_audit_address_mismatch");
  if (!sameArray(sorted(sendAddresses), sorted(auditAddresses))) errors.push("send_audit_address_mismatch");

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
