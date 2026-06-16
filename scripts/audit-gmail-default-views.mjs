#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { google } from "googleapis";

const repoRoot = process.cwd();
const envPath = join(repoRoot, ".env.local");
const viewsPath = join(repoRoot, "lib", "views.ts");
const defaultOutPath = join(repoRoot, ".mailhub", "gmail-default-views-audit.json");

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
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

function loadDefaultViews() {
  const source = readFileSync(viewsPath, "utf8");
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
      throw new Error("views.ts should not require external modules");
    },
  };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(compiled, sandbox, { filename: viewsPath });
  return sandbox.module.exports.DEFAULT_VIEWS;
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

async function probeView(gmail, userId, view, opts = {}) {
  const maxResults = opts.maxResults ?? 100;
  const maxPages = Math.max(1, opts.maxPages ?? 10);
  const q = view.q || "";
  let nextPageToken = null;
  const seenIds = new Set();
  const pageSummaries = [];
  let resultSizeEstimate = null;
  let accepted = true;
  let error = null;

  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const response = await gmail.users.messages.list({
        userId,
        q,
        labelIds: ["INBOX"],
        maxResults,
        includeSpamTrash: false,
        pageToken: nextPageToken || undefined,
      });
      if (page === 1) resultSizeEstimate = response.data.resultSizeEstimate ?? null;
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
      if (!nextPageToken) break;
    }
  } catch (e) {
    accepted = false;
    error = e instanceof Error ? e.message : String(e);
  }

  const risk =
    seenIds.size >= maxResults * maxPages
      ? "too_broad_for_bulk_workflow"
      : seenIds.size >= 500
        ? "broad_manual_review_only"
        : "manual_review_candidate";

  return {
    id: view.id,
    name: view.name,
    labelId: view.labelId,
    q,
    labelIds: ["INBOX"],
    effectiveScope: view.labelId === "todo" ? "todo_inbox" : "inbox",
    syntaxAccepted: accepted,
    error,
    resultSizeEstimate,
    pagesFetched: pageSummaries.length,
    uniqueSeenLowerBound: seenIds.size,
    hasMoreAfterMaxPages: Boolean(nextPageToken),
    risk,
    pageSummaries,
  };
}

async function main() {
  loadEnvFile(envPath);
  const outPath = process.argv.includes("--out")
    ? process.argv[process.argv.indexOf("--out") + 1]
    : defaultOutPath;
  const maxPagesArgIndex = process.argv.indexOf("--max-pages");
  const parsedMaxPages = maxPagesArgIndex >= 0 ? Number(process.argv[maxPagesArgIndex + 1]) : 10;
  const maxPages = Number.isFinite(parsedMaxPages) ? Math.max(1, Math.min(20, parsedMaxPages)) : 10;

  const views = loadDefaultViews().filter((view) =>
    ["invoice-docs", "customer-inquiries", "noise-candidates"].includes(view.id),
  );
  const { gmail, sharedInboxEmail } = createGmailClient();
  const viewAudits = [];
  for (const view of views) {
    viewAudits.push(await probeView(gmail, sharedInboxEmail, view, { maxPages }));
  }

  const audit = {
    generatedAt: new Date().toISOString(),
    sharedInboxEmailMasked: sharedInboxEmail.replace(/^(.{0,3}).*(@.*)$/, (_m, a, b) => `${a}***${b}`),
    viewCount: viewAudits.length,
    views: viewAudits,
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        outPath,
        generatedAt: audit.generatedAt,
        views: viewAudits.map((view) => ({
          id: view.id,
          uniqueSeenLowerBound: view.uniqueSeenLowerBound,
          hasMoreAfterMaxPages: view.hasMoreAfterMaxPages,
          risk: view.risk,
        })),
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
