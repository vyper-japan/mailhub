#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { google } from "googleapis";

const repoRoot = process.cwd();
const envPath = join(repoRoot, ".env.local");
const runDir = join(repoRoot, ".ai-runs", "mailhub-next-phase");
const defaultOpsAuditPath = join(runDir, "mailhub-operational-confirmations.json");
const defaultOutPath = join(runDir, "mailhub-routing-probe-audit.json");

function parseArgs(argv) {
  const out = {
    opsAudit: defaultOpsAuditPath,
    out: defaultOutPath,
    marker: "",
    maxResults: 10,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--ops-audit") out.opsAudit = argv[++i];
    else if (arg === "--out") out.out = argv[++i];
    else if (arg === "--marker") out.marker = argv[++i];
    else if (arg === "--max-results") out.maxResults = Math.max(1, Math.min(50, Number(argv[++i]) || 10));
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/audit-mailhub-routing-probes.mjs [--ops-audit path] [--out path] [--marker MAILHUB-ROUTING-PROBE-...] [--max-results 10]`);
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

function createGmailClient() {
  const oauth2Client = new google.auth.OAuth2({
    clientId: requireEnv("GOOGLE_CLIENT_ID"),
    clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
  });
  oauth2Client.setCredentials({
    refresh_token: requireEnv("GOOGLE_SHARED_INBOX_REFRESH_TOKEN"),
  });
  return {
    gmail: google.gmail({ version: "v1", auth: oauth2Client }),
    sharedInboxEmail: requireEnv("GOOGLE_SHARED_INBOX_EMAIL"),
  };
}

function quoteGmailTerm(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function buildAddressQuery(address) {
  const parts = [
    `to:${address}`,
    `cc:${address}`,
    `deliveredto:${address}`,
    quoteGmailTerm(address),
  ];
  return `(${parts.join(" OR ")})`;
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

async function probeGmail(gmail, userId, q, maxResults) {
  const response = await gmail.users.messages.list({
    userId,
    q,
    maxResults,
    includeSpamTrash: true,
  });
  const ids = (response.data.messages ?? []).map((message) => message.id).filter(Boolean);
  return {
    query: q,
    resultSizeEstimate: response.data.resultSizeEstimate ?? null,
    idsReturned: ids.length,
    sampleMessageIds: ids.slice(0, 5),
    hasEvidence: ids.length > 0 || (response.data.resultSizeEstimate ?? 0) > 0,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const opsAudit = readJson(args.opsAudit);
  const targets = targetConfirmations(opsAudit);
  const marker = args.marker.trim();
  const plannedAddressProbes = targets.flatMap((target) =>
    target.addresses.map((address) => ({
      channelId: target.id,
      label: target.label,
      address,
      manualProbeSubject: marker || "MAILHUB-ROUTING-PROBE-<YYYYMMDD-HHMMSS>",
    })),
  );
  const probePlan = targets.map((target) => ({
    channelId: target.id,
    label: target.label,
    addresses: target.addresses,
    manualProbeSubject: marker || "MAILHUB-ROUTING-PROBE-<YYYYMMDD-HHMMSS>",
    sendOneProbeToEachAddress: target.addresses,
  }));

  let probes = [];
  if (marker) {
    loadEnvFile(envPath);
    const { gmail, sharedInboxEmail } = createGmailClient();
    probes = [];
    for (const plannedProbe of plannedAddressProbes) {
      const q = `${quoteGmailTerm(marker)} ${buildAddressQuery(plannedProbe.address)}`;
      const result = await probeGmail(gmail, sharedInboxEmail, q, args.maxResults);
      probes.push({
        channelId: plannedProbe.channelId,
        label: plannedProbe.label,
        address: plannedProbe.address,
        ...result,
      });
    }
  }

  const matchedAddresses = probes.filter((probe) => probe.hasEvidence).map((probe) => probe.address);
  const missingAddresses = marker
    ? probes.filter((probe) => !probe.hasEvidence).map((probe) => probe.address)
    : plannedAddressProbes.map((probe) => probe.address);
  const matchedChannels = [...new Set(probes.filter((probe) => probe.hasEvidence).map((probe) => probe.channelId))];
  const missingChannels = [...new Set(
    (
      marker
        ? probes.filter((probe) => !probe.hasEvidence)
        : plannedAddressProbes
    ).map((probe) => probe.channelId),
  )];
  const result = {
    generatedAt: new Date().toISOString(),
    inputs: {
      opsAudit: args.opsAudit,
      opsAuditGeneratedAt: opsAudit.generatedAt ?? null,
      marker: marker || null,
      maxResults: args.maxResults,
    },
    mode: marker ? "verify_marker" : "plan_only",
    probePlan,
    plannedAddressProbes,
    probes,
    gate: {
      markerProvided: Boolean(marker),
      targetChannelCount: targets.length,
      targetAddressCount: plannedAddressProbes.length,
      matchedChannels,
      missingChannels,
      matchedAddresses,
      missingAddresses,
      allExpectedAddressesConfirmed: Boolean(marker) && plannedAddressProbes.length > 0 && missingAddresses.length === 0,
      allExpectedChannelsConfirmed: Boolean(marker) && targets.length > 0 && missingChannels.length === 0,
    },
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    outPath: args.out,
    generatedAt: result.generatedAt,
    mode: result.mode,
    targetChannelCount: result.gate.targetChannelCount,
    targetAddressCount: result.gate.targetAddressCount,
    matchedChannels: result.gate.matchedChannels,
    missingChannels: result.gate.missingChannels,
    matchedAddresses: result.gate.matchedAddresses,
    missingAddresses: result.gate.missingAddresses,
    allExpectedAddressesConfirmed: result.gate.allExpectedAddressesConfirmed,
    allExpectedChannelsConfirmed: result.gate.allExpectedChannelsConfirmed,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
