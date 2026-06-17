#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import nodemailer from "nodemailer";

const repoRoot = process.cwd();
const envPath = join(repoRoot, ".env.local");
const runDir = join(repoRoot, ".ai-runs", "mailhub-next-phase");
const defaultOpsAuditPath = join(runDir, "mailhub-operational-confirmations.json");
const defaultOutPath = join(runDir, "mailhub-routing-probe-send.json");

function parseArgs(argv) {
  const out = {
    opsAudit: defaultOpsAuditPath,
    out: defaultOutPath,
    marker: "",
    send: false,
    allowVtjFrom: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--ops-audit") out.opsAudit = argv[++i];
    else if (arg === "--out") out.out = argv[++i];
    else if (arg === "--marker") out.marker = argv[++i];
    else if (arg === "--send") out.send = true;
    else if (arg === "--allow-vtj-from") out.allowVtjFrom = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/send-mailhub-routing-probes.mjs [--ops-audit path] [--out path] [--marker MAILHUB-ROUTING-PROBE-...] [--send] [--allow-vtj-from]

Environment for --send:
  MAILHUB_PROBE_SMTP_HOST
  MAILHUB_PROBE_SMTP_PORT (default: 587)
  MAILHUB_PROBE_SMTP_SECURE (true/false, default: false)
  MAILHUB_PROBE_SMTP_USER
  MAILHUB_PROBE_SMTP_PASS
  MAILHUB_PROBE_FROM

Dry-run is the default and writes the exact address-level probe plan without sending mail.`);
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

function readJson(path) {
  if (!existsSync(path)) throw new Error(`missing_audit:${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const marker = args.marker.trim() || makeMarker();
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

  loadEnvFile(envPath);
  const from = process.env.MAILHUB_PROBE_FROM?.trim() || null;
  if (args.send && !from) throw new Error("missing_env:MAILHUB_PROBE_FROM");
  if (args.send && from?.toLowerCase().endsWith("@vtj.co.jp") && !args.allowVtjFrom) {
    throw new Error("vtj_from_not_external_route_proof: use a non-vtj external sender or pass --allow-vtj-from for a non-production-proof smoke");
  }

  const sent = [];
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
  }

  const result = {
    generatedAt: new Date().toISOString(),
    mode: args.send ? "sent" : "dry_run",
    marker,
    inputs: {
      opsAudit: args.opsAudit,
      opsAuditGeneratedAt: opsAudit.generatedAt ?? null,
      from: from ? from.replace(/^(.).+(@.+)$/, "$1***$2") : null,
      allowVtjFrom: args.allowVtjFrom,
    },
    probeCount: addressProbes.length,
    addressProbes,
    sent,
    nextVerificationCommand: `npm run audit:routing-probes -- --marker ${marker} --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-audit.json`,
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    outPath: args.out,
    mode: result.mode,
    marker: result.marker,
    probeCount: result.probeCount,
    sentCount: result.sent.length,
    nextVerificationCommand: result.nextVerificationCommand,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
