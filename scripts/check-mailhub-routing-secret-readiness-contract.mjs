#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const defaultArtifactPath = join(repoRoot, ".ai-runs", "mailhub-next-phase", "github-routing-secrets-readiness.json");

const REQUIRED_PREFLIGHT_SECRETS = [
  "MAILHUB_PROBE_SMTP_HOST",
  "MAILHUB_PROBE_SMTP_USER",
  "MAILHUB_PROBE_SMTP_PASS",
  "MAILHUB_PROBE_FROM",
];

const REQUIRED_GMAIL_PROOF_SECRETS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_SHARED_INBOX_EMAIL",
  "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
];

const REQUIRED_SEND_VERIFY_SECRETS = [
  ...REQUIRED_GMAIL_PROOF_SECRETS,
  ...REQUIRED_PREFLIGHT_SECRETS,
];

const OPTIONAL_SECRETS = ["MAILHUB_PROBE_SMTP_PORT", "MAILHUB_PROBE_SMTP_SECURE"];
const VALID_SOURCES = new Set(["github_actions_secrets", "env", "json"]);

function parseArgs(argv) {
  const out = { artifact: defaultArtifactPath };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--artifact") out.artifact = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/check-mailhub-routing-secret-readiness-contract.mjs [--artifact path]");
      process.exit(0);
    }
  }
  return out;
}

function readJson(path) {
  if (!existsSync(path)) throw new Error(`missing_github_routing_secrets_artifact:${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sameArray(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function hasDuplicates(values) {
  return new Set(values).size !== values.length;
}

function expectedMissing(required, present) {
  const presentSet = new Set(present);
  return required.filter((name) => !presentSet.has(name));
}

function validateGroup({ artifact, groupName, required, errors }) {
  const groups = objectValue(artifact.secretGroups);
  const group = objectValue(groups[groupName]);
  const requiredNames = stringArray(group.required);
  const presentNames = stringArray(group.present);
  const missingNames = stringArray(group.missing);
  const expectedMissingNames = expectedMissing(required, presentNames);

  if (!sameArray(requiredNames, required)) errors.push(`secret_group_required_mismatch:${groupName}`);
  if (hasDuplicates(presentNames)) errors.push(`secret_group_duplicate_present:${groupName}`);
  if (presentNames.some((name) => !required.includes(name))) errors.push(`secret_group_unknown_present:${groupName}`);
  if (!sameArray(missingNames, expectedMissingNames)) errors.push(`secret_group_missing_mismatch:${groupName}`);
  if ((group.ready === true) !== (missingNames.length === 0)) errors.push(`secret_group_ready_mismatch:${groupName}`);

  return { presentNames, missingNames, ready: group.ready === true };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifact = readJson(args.artifact);
  const errors = [];
  const warnings = [];

  const requiredPreflight = stringArray(artifact.requiredPreflightSecrets);
  const requiredSendVerify = stringArray(artifact.requiredSendVerifySecrets);
  const optionalSecrets = stringArray(artifact.optionalSecrets);
  const configuredOptional = stringArray(artifact.configuredOptionalSecrets);
  const missingPreflight = stringArray(artifact.missingPreflightSecrets);
  const missingSendVerify = stringArray(artifact.missingSendVerifySecrets);
  const presentRequired = stringArray(artifact.presentRequiredSecretNames);

  if (typeof artifact.repo !== "string" || artifact.repo.trim() === "") errors.push("missing_repo");
  if (!VALID_SOURCES.has(artifact.source)) errors.push("invalid_source");
  if (Number.isNaN(Date.parse(artifact.checkedAt ?? ""))) errors.push("invalid_checked_at");
  if (!Number.isInteger(artifact.secretCount) || artifact.secretCount < 0) errors.push("invalid_secret_count");
  if (!sameArray(requiredPreflight, REQUIRED_PREFLIGHT_SECRETS)) errors.push("required_preflight_secrets_mismatch");
  if (!sameArray(requiredSendVerify, REQUIRED_SEND_VERIFY_SECRETS)) errors.push("required_send_verify_secrets_mismatch");
  if (!sameArray(optionalSecrets, OPTIONAL_SECRETS)) errors.push("optional_secrets_mismatch");
  if (configuredOptional.some((name) => !OPTIONAL_SECRETS.includes(name))) errors.push("unknown_configured_optional_secret");
  if (presentRequired.some((name) => !REQUIRED_SEND_VERIFY_SECRETS.includes(name))) errors.push("unknown_present_required_secret");
  if (hasDuplicates(presentRequired)) errors.push("duplicate_present_required_secret");
  if (artifact.note && String(artifact.note).match(/pass(word)?|token|secret value/i) && !String(artifact.note).includes("never accessible")) {
    warnings.push("note_mentions_sensitive_terms");
  }

  const externalSmtpProof = validateGroup({
    artifact,
    groupName: "externalSmtpProof",
    required: REQUIRED_PREFLIGHT_SECRETS,
    errors,
  });
  const gmailProof = validateGroup({
    artifact,
    groupName: "gmailProof",
    required: REQUIRED_GMAIL_PROOF_SECRETS,
    errors,
  });

  const expectedPresentRequired = REQUIRED_SEND_VERIFY_SECRETS.filter((name) => {
    return externalSmtpProof.presentNames.includes(name) || gmailProof.presentNames.includes(name);
  });
  const expectedMissingPreflightNames = externalSmtpProof.missingNames;
  const expectedMissingSendVerifyNames = [
    ...gmailProof.missingNames,
    ...externalSmtpProof.missingNames,
  ];

  if (!sameArray(presentRequired, expectedPresentRequired)) errors.push("present_required_secret_names_mismatch");
  if (!sameArray(missingPreflight, expectedMissingPreflightNames)) errors.push("missing_preflight_secrets_mismatch");
  if (!sameArray(missingSendVerify, expectedMissingSendVerifyNames)) errors.push("missing_send_verify_secrets_mismatch");
  if ((artifact.readyForPreflightProductionProof === true) !== externalSmtpProof.ready) {
    errors.push("preflight_ready_mismatch");
  }
  if ((artifact.readyForSendVerify === true) !== (externalSmtpProof.ready && gmailProof.ready)) {
    errors.push("send_verify_ready_mismatch");
  }
  if (artifact.secretCount < presentRequired.length + configuredOptional.length) errors.push("secret_count_less_than_reported_present");

  const result = {
    artifactPath: args.artifact,
    repo: artifact.repo ?? null,
    source: artifact.source ?? null,
    secretCount: artifact.secretCount ?? null,
    readyForPreflightProductionProof: artifact.readyForPreflightProductionProof === true,
    readyForSendVerify: artifact.readyForSendVerify === true,
    externalSmtpProofReady: externalSmtpProof.ready,
    gmailProofReady: gmailProof.ready,
    missingPreflightSecrets: missingPreflight,
    missingSendVerifySecrets: missingSendVerify,
    errors,
    warnings,
    ok: errors.length === 0,
  };

  console.log(JSON.stringify(result, null, 2));
  if (errors.length > 0) process.exitCode = 1;
}

main();
