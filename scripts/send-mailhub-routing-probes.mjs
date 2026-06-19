#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import nodemailer from "nodemailer";

const repoRoot = process.cwd();
const envPath = join(repoRoot, ".env.local");
const runDir = join(repoRoot, ".ai-runs", "mailhub-next-phase");
const defaultOpsAuditPath = join(runDir, "mailhub-operational-confirmations.json");
const defaultOutPath = join(runDir, "mailhub-routing-probe-send.json");
const defaultRoutingAuditOutPath = join(runDir, "mailhub-routing-probe-audit.json");
const defaultReadinessOutPath = join(runDir, "mailhub-production-readiness-audit.json");
const SEND_CONFIRM_TOKEN = "SEND_EXTERNAL_MAILHUB_ROUTING_PROBES";
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

function currentRepoHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

const REQUIRED_GMAIL_VERIFY_ENV = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_SHARED_INBOX_EMAIL",
  "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
];

function parseArgs(argv) {
  const out = {
    opsAudit: defaultOpsAuditPath,
    out: defaultOutPath,
    marker: "",
    send: false,
    preflight: false,
    allowVtjFrom: false,
    verifyAfterSend: false,
    waitSeconds: 300,
    pollSeconds: 15,
    routingAuditOut: defaultRoutingAuditOutPath,
    readinessOut: defaultReadinessOutPath,
    maxResults: 10,
    envFile: envPath,
    confirmSend: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--ops-audit") out.opsAudit = argv[++i];
    else if (arg === "--out") out.out = argv[++i];
    else if (arg === "--marker") out.marker = argv[++i];
    else if (arg === "--send") out.send = true;
    else if (arg === "--confirm-send") out.confirmSend = argv[++i] || "";
    else if (arg === "--preflight") out.preflight = true;
    else if (arg === "--allow-vtj-from") out.allowVtjFrom = true;
    else if (arg === "--verify-after-send") out.verifyAfterSend = true;
    else if (arg === "--wait-seconds") out.waitSeconds = Math.max(0, Math.min(1800, Number(argv[++i]) || 0));
    else if (arg === "--poll-seconds") out.pollSeconds = Math.max(1, Math.min(300, Number(argv[++i]) || 15));
    else if (arg === "--routing-audit-out") out.routingAuditOut = argv[++i];
    else if (arg === "--readiness-out") out.readinessOut = argv[++i];
    else if (arg === "--max-results") out.maxResults = Math.max(1, Math.min(50, Number(argv[++i]) || 10));
    else if (arg === "--probe-env-file") out.envFile = argv[++i] || "";
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/send-mailhub-routing-probes.mjs [--ops-audit path] [--out path] [--marker MAILHUB-ROUTING-PROBE-...] [--preflight] [--send] [--confirm-send ${SEND_CONFIRM_TOKEN}] [--allow-vtj-from] [--verify-after-send] [--wait-seconds 300] [--poll-seconds 15] [--probe-env-file .env.local]

Environment for --send:
  MAILHUB_PROBE_SMTP_HOST
  MAILHUB_PROBE_SMTP_PORT (default: 587)
  MAILHUB_PROBE_SMTP_SECURE (true/false, default: false)
  MAILHUB_PROBE_SMTP_USER
  MAILHUB_PROBE_SMTP_PASS
  MAILHUB_PROBE_FROM

Dry-run is the default and writes the exact address-level probe plan without sending mail.
Use --preflight to also report external SMTP readiness without exposing secrets.
Use --verify-after-send with --send to poll shared Gmail for the marker and regenerate readiness.
--send requires the exact confirmation token: ${SEND_CONFIRM_TOKEN}`);
      process.exit(0);
    }
  }
  return out;
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value.replace(/\\n/g, "\n");
  }
}

function requireEnv(key) {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`missing_env:${key}`);
  return value;
}

function missingEnv(keys) {
  return keys.filter((key) => !process.env[key]?.trim());
}

function readJson(path) {
  if (!existsSync(path)) throw new Error(`missing_audit:${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeResult(path, result) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

function targetConfirmations(opsAudit) {
  const unconfirmed = new Set(opsAudit.gate?.currentSharedGmailRoutingUnconfirmed ?? []);
  return (opsAudit.operationalConfirmations ?? [])
    .filter((item) => unconfirmed.has(item.id))
    .map((item) => ({
      id: item.id,
      label: item.label,
      addresses: item.addresses ?? [],
    }));
}

function sorted(values) {
  return [...values].sort();
}

function sameStringSet(a, b) {
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
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

function canonicalRecipientPlanIssues(addressProbes) {
  const addresses = addressProbes.map((probe) => probe.address);
  const issues = [];
  if (addresses.length !== CANONICAL_ROUTING_PROBE_ADDRESSES.length) {
    issues.push("routing_probe_send_address_count_not_canonical");
  }
  if (duplicateStrings(addresses).length > 0) issues.push("routing_probe_send_duplicate_addresses");
  if (!sameStringSet(addresses, CANONICAL_ROUTING_PROBE_ADDRESSES)) {
    issues.push("routing_probe_send_canonical_address_mismatch");
  }
  return issues;
}

function makeMarker() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `MAILHUB-ROUTING-PROBE-${stamp}`;
}

function smtpConfigFromEnv() {
  const port = Number(process.env.MAILHUB_PROBE_SMTP_PORT || 587);
  const secure = String(process.env.MAILHUB_PROBE_SMTP_SECURE || "false").toLowerCase() === "true";
  return {
    host: requireEnv("MAILHUB_PROBE_SMTP_HOST"),
    port: Number.isFinite(port) ? port : 587,
    secure,
    auth: {
      user: requireEnv("MAILHUB_PROBE_SMTP_USER"),
      pass: requireEnv("MAILHUB_PROBE_SMTP_PASS"),
    },
  };
}

function extractEmailAddress(value) {
  const trimmed = value?.trim() || "";
  const angleMatch = trimmed.match(/<([^<>]+)>/);
  return (angleMatch?.[1] ?? trimmed).trim().toLowerCase();
}

function isValidMailboxAddress(email) {
  if (!email) return false;
  const match = email.match(/^([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+)@([A-Z0-9-]+(?:\.[A-Z0-9-]+)+)$/i);
  if (!match) return false;
  const [, local, domain] = match;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  return domain.split(".").every((label) => label && !label.startsWith("-") && !label.endsWith("-"));
}

function isValidEmailAddress(value) {
  const trimmed = value?.trim() || "";
  if (!trimmed) return false;
  if ((trimmed.includes("<") || trimmed.includes(">")) && !/^[^<>]*<[^<>]+>$/.test(trimmed)) {
    return false;
  }
  return isValidMailboxAddress(extractEmailAddress(trimmed));
}

function emailDomain(value) {
  const email = extractEmailAddress(value);
  return isValidMailboxAddress(email) ? email.split("@").pop() : null;
}

function isVtjAddress(value) {
  return emailDomain(value) === "vtj.co.jp";
}

function maskEmail(value) {
  const email = extractEmailAddress(value);
  if (!isValidMailboxAddress(email)) return null;
  return email.replace(/^(.).+(@.+)$/, "$1***$2");
}

function smtpPreflightFromEnv({ allowVtjFrom }) {
  const requiredKeys = [
    "MAILHUB_PROBE_SMTP_HOST",
    "MAILHUB_PROBE_SMTP_USER",
    "MAILHUB_PROBE_SMTP_PASS",
    "MAILHUB_PROBE_FROM",
  ];
  const missingRequiredEnv = requiredKeys.filter((key) => !process.env[key]?.trim());
  const from = process.env.MAILHUB_PROBE_FROM?.trim() || "";
  const fromValid = isValidEmailAddress(from);
  const fromDomain = emailDomain(from);
  const fromIsVtj = isVtjAddress(from);
  const rawPort = process.env.MAILHUB_PROBE_SMTP_PORT?.trim() || "587";
  const port = Number(rawPort);
  const portValid = Number.isInteger(port) && port > 0 && port <= 65535;
  const rawSecure = process.env.MAILHUB_PROBE_SMTP_SECURE?.trim().toLowerCase();
  const secureValid = !rawSecure || rawSecure === "true" || rawSecure === "false";
  const fromAllowedForSend = fromValid && (!fromIsVtj || allowVtjFrom);
  const warnings = [];
  if (from && !fromValid) warnings.push("invalid_MAILHUB_PROBE_FROM");
  if (fromIsVtj) warnings.push("vtj_from_not_external_route_proof");
  if (allowVtjFrom && fromIsVtj) warnings.push("allow_vtj_from_is_smoke_only_not_production_proof");
  if (!portValid) warnings.push("invalid_MAILHUB_PROBE_SMTP_PORT");
  if (!secureValid) warnings.push("invalid_MAILHUB_PROBE_SMTP_SECURE");

  const readyForSend = missingRequiredEnv.length === 0 && portValid && secureValid && fromAllowedForSend;
  const readyForProductionProof = readyForSend && !fromIsVtj;

  return {
    requiredEnvPresent: Object.fromEntries(requiredKeys.map((key) => [key, !missingRequiredEnv.includes(key)])),
    optionalEnvPresent: {
      MAILHUB_PROBE_SMTP_PORT: Boolean(process.env.MAILHUB_PROBE_SMTP_PORT?.trim()),
      MAILHUB_PROBE_SMTP_SECURE: Boolean(process.env.MAILHUB_PROBE_SMTP_SECURE?.trim()),
    },
    missingRequiredEnv,
    from: maskEmail(from),
    fromDomain,
    fromValid,
    fromIsVtj,
    allowVtjFrom,
    portValid,
    secureValid,
    readyForSend,
    readyForProductionProof,
    warnings,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runScript(script, args) {
  const result = spawnSync(process.execPath, [join(repoRoot, "scripts", script), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${script}_failed:${output || result.status}`);
  }
  return result;
}

async function verifyAfterSend(args, marker) {
  const attempts = [];
  const deadline = Date.now() + args.waitSeconds * 1000;
  let finalAudit = null;
  let matched = false;

  do {
    const startedAt = new Date().toISOString();
    runScript("audit-mailhub-routing-probes.mjs", [
      "--ops-audit",
      args.opsAudit,
      "--out",
      args.routingAuditOut,
      "--marker",
      marker,
      "--max-results",
      String(args.maxResults),
    ]);
    finalAudit = readJson(args.routingAuditOut);
    matched = Boolean(finalAudit.gate?.allExpectedAddressesConfirmed);
    attempts.push({
      startedAt,
      matched,
      matchedAddresses: finalAudit.gate?.matchedAddresses ?? [],
      missingAddresses: finalAudit.gate?.missingAddresses ?? [],
    });
    if (matched || Date.now() >= deadline || args.waitSeconds === 0) break;
    await sleep(args.pollSeconds * 1000);
  } while (true);

  return {
    status: matched ? "matched" : "timeout_or_missing",
    waitSeconds: args.waitSeconds,
    pollSeconds: args.pollSeconds,
    attempts,
    routingAuditOut: args.routingAuditOut,
    readinessOut: args.readinessOut,
    allExpectedAddressesConfirmed: Boolean(finalAudit?.gate?.allExpectedAddressesConfirmed),
  };
}

function regenerateReadinessAfterSend(args) {
  runScript("audit-mailhub-production-readiness.mjs", [
    "--out",
    args.readinessOut,
    "--ops-audit",
    args.opsAudit,
    "--routing-probe-audit",
    args.routingAuditOut,
    "--routing-probe-send",
    args.out,
  ]);
  return readJson(args.readinessOut);
}

function buildResult({ args, opsAudit, marker, generatedAt, from, smtpPreflight, addressProbes, sent, verification }) {
  return {
    generatedAt,
    repoHead: currentRepoHead(),
    mode: args.send ? "sent" : args.preflight ? "preflight" : "dry_run",
    marker,
    inputs: {
      opsAudit: args.opsAudit,
      opsAuditGeneratedAt: opsAudit.generatedAt ?? null,
      from: maskEmail(from),
      allowVtjFrom: args.allowVtjFrom,
      preflight: args.preflight,
      verifyAfterSend: args.verifyAfterSend,
    },
    approval: {
      sideEffect: "external_mail",
      requiresApproval: true,
      confirmSendToken: SEND_CONFIRM_TOKEN,
      confirmed: args.confirmSend === SEND_CONFIRM_TOKEN,
    },
    smtpPreflight,
    probeCount: addressProbes.length,
    addressProbes,
    sent,
    verification,
    nextVerificationCommand: `npm run audit:routing-probes -- --marker ${marker} --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-audit.json`,
    nextReadinessCommand: `npm run audit:mailhub-readiness -- --out .ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json`,
  };
}

function addReadinessGateToVerification(verification, readinessAudit) {
  return {
    ...verification,
    productionReady: Boolean(readinessAudit.gate?.productionReady),
    p0Blockers: readinessAudit.gate?.p0Blockers ?? [],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const marker = args.marker.trim() || makeMarker();
  const generatedAt = new Date().toISOString();
  const opsAudit = readJson(args.opsAudit);
  const targets = targetConfirmations(opsAudit);
  const addressProbes = targets.flatMap((target) =>
    target.addresses.map((address) => ({
      channelId: target.id,
      label: target.label,
      address,
      subject: marker,
    })),
  );

  loadEnvFile(args.envFile);
  const from = process.env.MAILHUB_PROBE_FROM?.trim() || null;
  const smtpPreflight = smtpPreflightFromEnv({ allowVtjFrom: args.allowVtjFrom });
  if (args.verifyAfterSend && !args.send) throw new Error("verify_after_send_requires_send");
  if (args.verifyAfterSend) {
    const missingGmailEnv = missingEnv(REQUIRED_GMAIL_VERIFY_ENV);
    if (missingGmailEnv.length > 0) {
      throw new Error(`missing_env_for_verify_after_send:${missingGmailEnv.join(",")}`);
    }
  }
  if (args.send && !from) throw new Error("missing_env:MAILHUB_PROBE_FROM");
  if (args.send && !isValidEmailAddress(from)) throw new Error("invalid_env:MAILHUB_PROBE_FROM");
  if (args.send && isVtjAddress(from) && !args.allowVtjFrom) {
    throw new Error("vtj_from_not_external_route_proof: use a non-vtj external sender or pass --allow-vtj-from for a non-production-proof smoke");
  }
  if (args.send) {
    const canonicalIssues = canonicalRecipientPlanIssues(addressProbes);
    if (canonicalIssues.length > 0) {
      throw new Error(`non_canonical_routing_probe_recipients:${canonicalIssues.join(",")}`);
    }
    if (args.confirmSend !== SEND_CONFIRM_TOKEN) {
      throw new Error("missing_or_invalid_confirm_send_token");
    }
  }

  const sent = [];
  let verification = null;
  if (args.send) {
    const transporter = nodemailer.createTransport(smtpConfigFromEnv());
    for (const probe of addressProbes) {
      const info = await transporter.sendMail({
        from,
        to: probe.address,
        subject: probe.subject,
        text: [
          marker,
          "",
          "MailHub routing probe.",
          `Target channel: ${probe.channelId}`,
          `Target address: ${probe.address}`,
          "",
          "This message is used to verify current external mail routing into the shared Gmail/MailHub workbench.",
        ].join("\n"),
      });
      sent.push({
        channelId: probe.channelId,
        address: probe.address,
        accepted: info.accepted ?? [],
        rejected: info.rejected ?? [],
        messageId: info.messageId ?? null,
      });
    }
    if (args.verifyAfterSend) {
      verification = await verifyAfterSend(args, marker);
      writeResult(args.out, buildResult({
        args,
        opsAudit,
        marker,
        generatedAt,
        from,
        smtpPreflight,
        addressProbes,
        sent,
        verification,
      }));
      const readinessAudit = regenerateReadinessAfterSend(args);
      verification = addReadinessGateToVerification(verification, readinessAudit);
    }
  }

  const result = buildResult({
    args,
    opsAudit,
    marker,
    generatedAt,
    from,
    smtpPreflight,
    addressProbes,
    sent,
    verification,
  });

  writeResult(args.out, result);
  console.log(JSON.stringify({
    outPath: args.out,
    mode: result.mode,
    marker: result.marker,
    probeCount: result.probeCount,
    sentCount: result.sent.length,
    smtpReadyForProductionProof: result.smtpPreflight.readyForProductionProof,
    missingRequiredEnv: result.smtpPreflight.missingRequiredEnv,
    verification: result.verification,
    nextVerificationCommand: result.nextVerificationCommand,
    nextReadinessCommand: result.nextReadinessCommand,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
