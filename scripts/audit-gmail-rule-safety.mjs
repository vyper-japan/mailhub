#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { google } from "googleapis";

const repoRoot = process.cwd();
const defaultEnvPath = join(repoRoot, ".env.local");
const defaultOutPath = join(repoRoot, ".mailhub", "gmail-rule-safety-audit.json");

const RISKY_DOMAINS = new Set([
  "gmail.com",
  "yahoo.co.jp",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
]);

const PURPOSE_KEYWORDS = [
  {
    purpose: "important",
    keywords: ["至急", "重要", "urgent", "important", "督促", "未払い", "停止", "エラー", "返品", "交換", "キャンセル"],
  },
  {
    purpose: "invoice",
    keywords: ["請求書", "領収書", "見積書", "納品書", "支払明細", "invoice", "receipt", "statement", "payment", "billing"],
  },
  {
    purpose: "inquiry",
    keywords: ["問い合わせ", "お問い合わせ", "質問", "相談", "inquiry", "question", "r-messe", "rmesse", "メッセージ"],
  },
  {
    purpose: "noise",
    keywords: ["no-reply", "noreply", "newsletter", "unsubscribe", "配信停止", "メルマガ", "広告", "セール", "キャンペーン", "notification"],
  },
];

function loadEnvFile(path) {
  if (!path || !existsSync(path)) return false;
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
  return true;
}

function parseArgs(argv) {
  const args = {
    out: defaultOutPath,
    max: 100,
    configSource: "auto",
    envFile: defaultEnvPath,
    loadEnvFile: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") args.out = argv[++i] || args.out;
    else if (arg === "--max") args.max = Math.max(1, Math.min(500, Number(argv[++i]) || 100));
    else if (arg === "--config-source") args.configSource = argv[++i] || args.configSource;
    else if (arg === "--env-file") {
      args.envFile = argv[++i] || "";
      args.loadEnvFile = true;
    } else if (arg === "--no-env-file") {
      args.envFile = "";
      args.loadEnvFile = false;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/audit-gmail-rule-safety.mjs [--out path] [--max 100] [--config-source auto|file|sheets] [--env-file .env.local] [--no-env-file]

Loads .env.local by default. Use --env-file to make the env source explicit, or --no-env-file when the process environment is already injected.
Secret values are never printed; artifacts include only env file path/load metadata and validation results.`);
      process.exit(0);
    }
  }
  return args;
}

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

function requireEnv(key) {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`missing_env:${key}`);
  return value;
}

function normalizeEmail(input) {
  if (!input) return null;
  const angle = String(input).match(/<\s*([^>\s]+@[^>\s]+)\s*>/);
  const candidate = (angle?.[1] ?? String(input)).trim().toLowerCase();
  const token = candidate.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)?.[1]?.toLowerCase() ?? candidate;
  if (!token || !token.includes("@") || token.includes(" ")) return null;
  return token;
}

function normalizeDomain(input) {
  const value = String(input ?? "").trim().toLowerCase().replace(/^@/, "");
  if (!value || value.includes(" ") || !value.includes(".")) return null;
  return value;
}

function domainForEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const at = normalized.lastIndexOf("@");
  return at >= 0 ? normalized.slice(at + 1) : null;
}

function maskEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const [local, domain] = normalized.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}

function hashId(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`).join(",")}}`;
}

function ruleSetFingerprint(labelRules, assigneeRules) {
  const canonical = stableJson({ assigneeRules, labelRules });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function labelsForRule(rule) {
  if (Array.isArray(rule.labelNames)) return rule.labelNames.filter((v) => typeof v === "string" && v.trim());
  if (typeof rule.labelName === "string" && rule.labelName.trim()) return [rule.labelName];
  return [];
}

function isSuppressiveLabelName(labelName) {
  const normalized = labelName.trim().toLowerCase();
  return normalized.includes("muted") || normalized.includes("noise") || normalized.includes("処理不要");
}

function classifyMessage(message) {
  const fields = [
    { field: "subject", value: message.subject },
    { field: "from", value: message.from },
    { field: "snippet", value: message.snippet },
  ];

  for (const group of PURPOSE_KEYWORDS) {
    const evidence = [];
    for (const keyword of group.keywords) {
      const hit = fields.find((entry) => String(entry.value ?? "").toLowerCase().includes(keyword.toLowerCase()));
      if (hit) evidence.push({ field: hit.field, keyword });
    }
    if (!evidence.length) continue;
    const protectedPurpose = group.purpose === "important" || group.purpose === "invoice" || group.purpose === "inquiry";
    return {
      purpose: group.purpose,
      evidence,
      suppressible: !protectedPurpose,
      blockedReasons: protectedPurpose ? [`protected_${group.purpose}`] : [],
    };
  }

  return { purpose: "other", evidence: [], suppressible: true, blockedReasons: [] };
}

function parseLabelRules(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((value) => (value && typeof value === "object" ? value : {}))
    .map((rule) => ({
      id: typeof rule.id === "string" ? rule.id : "",
      enabled: typeof rule.enabled === "boolean" ? rule.enabled : true,
      match: {
        ...(typeof rule.match?.fromEmail === "string" ? { fromEmail: rule.match.fromEmail } : {}),
        ...(typeof rule.match?.fromDomain === "string" ? { fromDomain: rule.match.fromDomain } : {}),
      },
      ...(Array.isArray(rule.labelNames) ? { labelNames: rule.labelNames.filter((v) => typeof v === "string" && v.trim()) } : {}),
      ...(typeof rule.labelName === "string" ? { labelName: rule.labelName } : {}),
      ...(rule.assignTo ? { assignTo: rule.assignTo } : {}),
    }))
    .filter((rule) => rule.id);
}

function parseAssigneeRules(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((value) => (value && typeof value === "object" ? value : {}))
    .map((rule) => {
      const assigneeEmail = normalizeEmail(rule.assigneeEmail);
      const fromEmail = normalizeEmail(rule.match?.fromEmail);
      const fromDomain = normalizeDomain(rule.match?.fromDomain);
      if (!rule.id || !assigneeEmail || (!fromEmail && !fromDomain)) return null;
      return {
        id: String(rule.id),
        enabled: typeof rule.enabled === "boolean" ? rule.enabled : true,
        priority: Number.isFinite(rule.priority) ? rule.priority : 0,
        match: { ...(fromEmail ? { fromEmail } : {}), ...(fromDomain ? { fromDomain } : {}) },
        assigneeEmail,
        when: { unassignedOnly: rule.when?.unassignedOnly !== false },
        safety: { dangerousDomainConfirm: rule.safety?.dangerousDomainConfirm === true },
      };
    })
    .filter(Boolean);
}

function loadJsonFile(path, parser) {
  if (!existsSync(path)) return { data: [], lastUpdatedAt: null, found: false };
  return { data: parser(readFileSync(path, "utf8")), lastUpdatedAt: null, found: true };
}

async function readSheetsJsonBlob({ sheetName, parser }) {
  const spreadsheetId = process.env.MAILHUB_SHEETS_ID ?? process.env.MAILHUB_SHEETS_SPREADSHEET_ID ?? "";
  const clientEmail = process.env.MAILHUB_SHEETS_CLIENT_EMAIL ?? "";
  const privateKey = process.env.MAILHUB_SHEETS_PRIVATE_KEY ?? "";
  if (!spreadsheetId || !clientEmail || !privateKey) {
    return { data: [], lastUpdatedAt: null, found: false, warning: "missing_sheets_config" };
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A1:B2`,
    });
    const values = response.data.values ?? [];
    const json = String(values?.[1]?.[0] ?? "");
    const updatedAt = String(values?.[1]?.[1] ?? "") || null;
    return { data: parser(json), lastUpdatedAt: updatedAt, found: Boolean(json.trim()) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.toLowerCase().includes("unable to parse range")) {
      return { data: [], lastUpdatedAt: null, found: false, warning: `missing_sheet:${sheetName}` };
    }
    throw e;
  }
}

async function loadRules(configSource) {
  const requested =
    configSource === "auto"
      ? (process.env.MAILHUB_CONFIG_STORE || (process.env.NODE_ENV === "production" ? "sheets" : "file"))
      : configSource;

  if (requested === "sheets") {
    const labelSheetName = process.env.MAILHUB_SHEETS_TAB_RULES || "ConfigRules";
    const assigneeSheetName = process.env.MAILHUB_SHEETS_TAB_ASSIGNEE_RULES || "ConfigAssigneeRules";
    const [labelRules, assigneeRules] = await Promise.all([
      readSheetsJsonBlob({ sheetName: labelSheetName, parser: parseLabelRules }),
      readSheetsJsonBlob({ sheetName: assigneeSheetName, parser: parseAssigneeRules }),
    ]);
    return {
      requested,
      resolved: labelRules.warning === "missing_sheets_config" && assigneeRules.warning === "missing_sheets_config" ? "memory_fallback_missing_sheets_config" : "sheets",
      ruleSheets: {
        labelRules: labelSheetName,
        assigneeRules: assigneeSheetName,
      },
      warnings: [labelRules.warning, assigneeRules.warning].filter(Boolean),
      labelRules: labelRules.data,
      assigneeRules: assigneeRules.data,
      lastUpdatedAt: {
        labelRules: labelRules.lastUpdatedAt,
        assigneeRules: assigneeRules.lastUpdatedAt,
      },
    };
  }

  const labelPrimary = loadJsonFile(join(repoRoot, ".mailhub", "labelRules.json"), parseLabelRules);
  const labelLegacy = labelPrimary.found ? null : loadJsonFile(join(repoRoot, ".mailhub", "label-rules.json"), parseLabelRules);
  const assignee = loadJsonFile(join(repoRoot, ".mailhub", "assigneeRules.json"), parseAssigneeRules);
  return {
    requested,
    resolved: "file",
    ruleSheets: null,
    warnings: [],
    labelRules: labelPrimary.found ? labelPrimary.data : labelLegacy?.data ?? [],
    assigneeRules: assignee.data,
    lastUpdatedAt: {
      labelRules: labelPrimary.lastUpdatedAt ?? labelLegacy?.lastUpdatedAt ?? null,
      assigneeRules: assignee.lastUpdatedAt,
    },
  };
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

function getHeader(headers, name) {
  return headers.find((header) => String(header.name ?? "").toLowerCase() === name.toLowerCase())?.value ?? "";
}

async function fetchInboxMessages(gmail, userId, max) {
  const response = await gmail.users.messages.list({
    userId,
    labelIds: ["INBOX"],
    maxResults: max,
    includeSpamTrash: false,
  });
  const ids = (response.data.messages ?? []).map((message) => message.id).filter(Boolean);
  const messages = [];
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const fetched = await Promise.all(
      chunk.map(async (id) => {
        const message = await gmail.users.messages.get({
          userId,
          id,
          format: "metadata",
          metadataHeaders: ["From", "Subject"],
        });
        const headers = message.data.payload?.headers ?? [];
        return {
          id,
          threadId: message.data.threadId ?? "",
          from: getHeader(headers, "From"),
          subject: getHeader(headers, "Subject"),
          snippet: message.data.snippet ?? "",
        };
      }),
    );
    messages.push(...fetched);
  }
  return {
    resultSizeEstimate: response.data.resultSizeEstimate ?? null,
    hasMore: Boolean(response.data.nextPageToken),
    messages,
  };
}

function ruleMatchesEmail(rule, fromEmail) {
  const email = normalizeEmail(fromEmail);
  if (!email) return false;
  const domain = domainForEmail(email);
  const matchEmail = normalizeEmail(rule.match?.fromEmail);
  const matchDomain = normalizeDomain(rule.match?.fromDomain);
  if (matchEmail && email === matchEmail) return true;
  return Boolean(matchDomain && domain && domain === matchDomain);
}

function inspectRuleInventory(labelRules, assigneeRules, messages) {
  const enabledLabelRules = labelRules.filter((rule) => rule.enabled !== false);
  const enabledAssigneeRules = assigneeRules.filter((rule) => rule.enabled !== false);
  const suppressiveLabelRules = enabledLabelRules.filter((rule) => labelsForRule(rule).some(isSuppressiveLabelName));
  const dangerousBroadRules = [];
  const inactiveRules = [];
  const tooManyMatches = [];
  const protectedSuppressiveMatches = [];
  const missingSummarySuppressiveMatches = [];
  const ruleHitCounts = [];

  const allRules = [
    ...enabledLabelRules.map((rule) => ({ kind: "label", rule })),
    ...enabledAssigneeRules.map((rule) => ({ kind: "assignee", rule })),
  ];

  for (const entry of allRules) {
    const domain = normalizeDomain(entry.rule.match?.fromDomain);
    if (domain && RISKY_DOMAINS.has(domain)) {
      dangerousBroadRules.push({
        kind: entry.kind,
        id: entry.rule.id,
        fromDomain: domain,
        labels: entry.kind === "label" ? labelsForRule(entry.rule) : [],
        assigneeEmailMasked: entry.kind === "assignee" ? maskEmail(entry.rule.assigneeEmail) : null,
      });
    }

    const hits = messages.filter((message) => ruleMatchesEmail(entry.rule, message.from));
    ruleHitCounts.push({ kind: entry.kind, id: entry.rule.id, hits: hits.length });
    if (hits.length === 0) inactiveRules.push({ kind: entry.kind, id: entry.rule.id });
    if (messages.length >= 20 && hits.length / messages.length >= 0.8) {
      tooManyMatches.push({ kind: entry.kind, id: entry.rule.id, hits: hits.length, inspected: messages.length });
    }
  }

  for (const rule of suppressiveLabelRules) {
    const labels = labelsForRule(rule).filter(isSuppressiveLabelName);
    const hits = messages.filter((message) => ruleMatchesEmail(rule, message.from));
    for (const message of hits) {
      const classification = classifyMessage(message);
      const evidence = {
        ruleId: rule.id,
        labels,
        messageIdHash: hashId(message.id),
        threadIdHash: hashId(message.threadId || message.id),
        fromMasked: maskEmail(message.from),
        classification: {
          purpose: classification.purpose,
          evidence: classification.evidence,
          blockedReasons: classification.blockedReasons,
        },
      };
      if (!message.subject && !message.snippet) {
        missingSummarySuppressiveMatches.push(evidence);
      }
      if (!classification.suppressible) {
        protectedSuppressiveMatches.push(evidence);
      }
    }
  }

  return {
    inventory: {
      labelRuleCount: labelRules.length,
      enabledLabelRuleCount: enabledLabelRules.length,
      suppressiveLabelRuleCount: suppressiveLabelRules.length,
      assigneeRuleCount: assigneeRules.length,
      enabledAssigneeRuleCount: enabledAssigneeRules.length,
    },
    findings: {
      dangerousBroadRules,
      tooManyMatches,
      inactiveRules,
      protectedSuppressiveMatches,
      missingSummarySuppressiveMatches,
      ruleHitCounts,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envFileLoaded = args.loadEnvFile ? loadEnvFile(args.envFile) : false;
  const outPath = args.out;
  const max = args.max;
  const configSource = args.configSource;
  if (!["auto", "file", "sheets"].includes(configSource)) {
    throw new Error("invalid_config_source");
  }

  const rules = await loadRules(configSource);
  const { gmail, sharedInboxEmail } = createGmailClient();
  const sample = await fetchInboxMessages(gmail, sharedInboxEmail, max);
  const inspected = inspectRuleInventory(rules.labelRules, rules.assigneeRules, sample.messages);
  const fingerprint = ruleSetFingerprint(rules.labelRules, rules.assigneeRules);
  const blockingFindings = [
    ...(inspected.findings.dangerousBroadRules.length ? ["dangerous_broad_rules"] : []),
    ...(inspected.findings.tooManyMatches.length ? ["too_many_matches"] : []),
    ...(inspected.findings.protectedSuppressiveMatches.length ? ["protected_suppressive_matches"] : []),
    ...(inspected.findings.missingSummarySuppressiveMatches.length ? ["missing_summary_suppressive_matches"] : []),
  ];

  const audit = {
    generatedAt: new Date().toISOString(),
    inputs: {
      envFile: args.envFile || null,
      envFileLoaded,
      envFileMode: args.loadEnvFile ? "env_file" : "process_env_only",
      valuePolicy: "Secret values are never printed; this artifact contains only env file path/load metadata, masked addresses, counts, fingerprints, and validation findings.",
    },
    sharedInboxEmailMasked: sharedInboxEmail.replace(/^(.{0,3}).*(@.*)$/, (_m, a, b) => `${a}***${b}`),
    config: {
      requestedSource: rules.requested,
      resolvedSource: rules.resolved,
      ruleSheets: rules.ruleSheets,
      warnings: rules.warnings,
      lastUpdatedAt: rules.lastUpdatedAt,
      ruleSetFingerprint: fingerprint,
      fingerprintIncludes: ["normalized_label_rules", "normalized_assignee_rules"],
    },
    sample: {
      labelIds: ["INBOX"],
      requestedMax: max,
      inspectedCount: sample.messages.length,
      resultSizeEstimate: sample.resultSizeEstimate,
      hasMoreAfterSample: sample.hasMore,
    },
    rulesConfigured: inspected.inventory.labelRuleCount + inspected.inventory.assigneeRuleCount > 0,
    ...inspected,
    ruleSafetyGate: {
      realDataRuleRiskPass: blockingFindings.length === 0,
      suppressiveAutoApplySafe: inspected.findings.protectedSuppressiveMatches.length === 0 && inspected.findings.missingSummarySuppressiveMatches.length === 0,
      blockingFindings,
    },
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        outPath,
        generatedAt: audit.generatedAt,
        inputs: audit.inputs,
        config: audit.config,
        inspectedCount: audit.sample.inspectedCount,
        rulesConfigured: audit.rulesConfigured,
        inventory: audit.inventory,
        ruleSafetyGate: audit.ruleSafetyGate,
      },
      null,
      2,
    ),
  );
  if (!audit.ruleSafetyGate.realDataRuleRiskPass) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
