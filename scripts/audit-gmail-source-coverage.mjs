#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { google } from "googleapis";

const repoRoot = process.cwd();
const envPath = join(repoRoot, ".env.local");
const channelsPath = join(repoRoot, "lib", "channels.ts");
const defaultOutPath = join(repoRoot, ".mailhub", "gmail-source-coverage-audit.json");

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

function loadChannels() {
  const source = readFileSync(channelsPath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;

  const sandbox = {
    exports: {},
    module: { exports: {} },
    require: () => {
      throw new Error("channels.ts should not require external modules");
    },
  };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(compiled, sandbox, { filename: channelsPath });
  return sandbox.module.exports.getChannels(false);
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

async function probeQuery(gmail, userId, q, opts = {}) {
  const maxResults = opts.maxResults ?? 50;
  const maxPages = Math.max(1, opts.maxPages ?? 3);
  const first = await gmail.users.messages.list({
    userId,
    q,
    labelIds: ["INBOX"],
    maxResults,
    includeSpamTrash: false,
  });
  const firstMessages = first.data.messages ?? [];
  const firstIds = firstMessages.map((message) => message.id).filter(Boolean);
  let nextPageToken = first.data.nextPageToken ?? null;
  const seenIds = new Set(firstIds);
  const pageSummaries = [
    {
      page: 1,
      idsReturned: firstIds.length,
      uniqueNewIds: firstIds.length,
      hasNextPageToken: Boolean(nextPageToken),
    },
  ];

  for (let page = 2; nextPageToken && page <= maxPages; page += 1) {
    const response = await gmail.users.messages.list({
      userId,
      q,
      labelIds: ["INBOX"],
      maxResults,
      includeSpamTrash: false,
      pageToken: nextPageToken,
    });
    const ids = (response.data.messages ?? []).map((message) => message.id).filter(Boolean);
    let uniqueNewIds = 0;
    for (const id of ids) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      uniqueNewIds += 1;
    }
    nextPageToken = response.data.nextPageToken ?? null;
    pageSummaries.push({
      page,
      idsReturned: ids.length,
      uniqueNewIds,
      hasNextPageToken: Boolean(nextPageToken),
    });
  }

  return {
    resultSizeEstimate: first.data.resultSizeEstimate ?? null,
    firstPageIdsReturned: firstIds.length,
    pagesFetched: pageSummaries.length,
    uniqueIdsSeenLowerBound: seenIds.size,
    hasMoreAfterFetchedPages: Boolean(nextPageToken),
    hasNextPageToken: pageSummaries[0]?.hasNextPageToken ?? false,
    pageSummaries,
  };
}

function channelSummary(channel, probe) {
  return {
    id: channel.id,
    label: channel.label,
    addresses: channel.addresses,
    replyKind: channel.replyKind,
    query: channel.q ?? null,
    ...probe,
  };
}

function buildFallbackQueries(addresses) {
  return addresses.flatMap((address) => [
    { type: "freeText", q: address },
    { type: "to", q: `to:${address}` },
    { type: "cc", q: `cc:${address}` },
    { type: "deliveredto", q: `deliveredto:${address}` },
    { type: "from", q: `from:${address}` },
  ]);
}

async function buildZeroEstimateFollowups(gmail, userId, probes) {
  const zeroChannels = probes.filter((item) => item.resultSizeEstimate === 0 && item.addresses.length > 0);
  const followups = [];
  for (const channel of zeroChannels) {
    const probesForChannel = [];
    for (const fallback of buildFallbackQueries(channel.addresses)) {
      const result = await probeQuery(gmail, userId, fallback.q, {
        maxResults: 10,
        maxPages: 1,
      });
      probesForChannel.push({
        type: fallback.type,
        query: fallback.q,
        resultSizeEstimate: result.resultSizeEstimate,
        firstPageIdsReturned: result.firstPageIdsReturned,
        hasNextPageToken: result.hasNextPageToken,
      });
    }
    followups.push({
      id: channel.id,
      label: channel.label,
      addresses: channel.addresses,
      probes: probesForChannel,
    });
  }
  return followups;
}

function buildAudit(channels, probes, sharedInboxEmail, zeroEstimateFollowups) {
  const aggregate = probes.find((item) => item.id === "stores") ?? null;
  const sourceChannels = probes.filter((item) => item.id !== "all" && item.id !== "stores");
  const zeroEstimateChannels = sourceChannels
    .filter((item) => item.resultSizeEstimate === 0)
    .map((item) => item.id);
  const paginatedChannels = sourceChannels
    .filter((item) => item.hasNextPageToken)
    .map((item) => item.id);
  const addressCount = new Set(sourceChannels.flatMap((item) => item.addresses)).size;

  return {
    generatedAt: new Date().toISOString(),
    sharedInboxEmailMasked: sharedInboxEmail.replace(/^(.{0,3}).*(@.*)$/, (_m, a, b) => `${a}***${b}`),
    sourceChannelCount: sourceChannels.length,
    sourceAddressCount: addressCount,
    aggregate: aggregate
      ? {
          id: aggregate.id,
          resultSizeEstimate: aggregate.resultSizeEstimate,
          firstPageIdsReturned: aggregate.firstPageIdsReturned,
          pagesFetched: aggregate.pagesFetched,
          uniqueIdsSeenLowerBound: aggregate.uniqueIdsSeenLowerBound,
          hasNextPageToken: aggregate.hasNextPageToken,
          hasMoreAfterFetchedPages: aggregate.hasMoreAfterFetchedPages,
        }
      : null,
    risks: {
      zeroEstimateChannels,
      paginatedChannels,
    },
    zeroEstimateFollowups,
    channels: probes,
    channelInventory: channels.map((channel) => ({
      id: channel.id,
      label: channel.label,
      addresses: channel.addresses,
      replyKind: channel.replyKind,
      query: channel.q ?? null,
    })),
  };
}

async function main() {
  loadEnvFile(envPath);
  const outPath = process.argv.includes("--out")
    ? process.argv[process.argv.indexOf("--out") + 1]
    : defaultOutPath;
  const maxPagesArgIndex = process.argv.indexOf("--max-pages");
  const parsedMaxPages =
    maxPagesArgIndex >= 0 ? Number(process.argv[maxPagesArgIndex + 1]) : 3;
  const maxPages = Number.isFinite(parsedMaxPages)
    ? Math.max(1, Math.min(10, parsedMaxPages))
    : 3;

  const channels = loadChannels();
  const { gmail, sharedInboxEmail } = createGmailClient();
  const targetChannels = channels.filter((channel) => channel.q);
  const probes = [];

  for (const channel of targetChannels) {
    const probe = await probeQuery(gmail, sharedInboxEmail, channel.q, {
      maxResults: 50,
      maxPages,
    });
    probes.push(channelSummary(channel, probe));
  }

  const zeroEstimateFollowups = await buildZeroEstimateFollowups(gmail, sharedInboxEmail, probes);
  const audit = buildAudit(channels, probes, sharedInboxEmail, zeroEstimateFollowups);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        outPath,
        generatedAt: audit.generatedAt,
        sourceChannelCount: audit.sourceChannelCount,
        sourceAddressCount: audit.sourceAddressCount,
        aggregate: audit.aggregate,
        risks: audit.risks,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
