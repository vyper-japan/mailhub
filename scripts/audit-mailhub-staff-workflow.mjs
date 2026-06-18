#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const repoRoot = process.cwd();
const runDir = join(repoRoot, ".ai-runs", "mailhub-next-phase");
const defaultOut = join(runDir, "mailhub-staff-workflow-audit.json");
const defaultEnvPath = join(repoRoot, ".env.local");
const defaultAssigneesPath = join(repoRoot, ".mailhub", "assignees.json");
const defaultProdEvidenceDir = join(repoRoot, "docs", "pilot", "prod");

const REQUIRED_PRODUCTION_ENV = [
  "NEXTAUTH_URL",
  "NEXTAUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_SHARED_INBOX_EMAIL",
  "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
];

const REQUIRED_SHEETS_ENV = [
  "MAILHUB_SHEETS_CLIENT_EMAIL",
  "MAILHUB_SHEETS_PRIVATE_KEY",
];

const REQUIRED_PROD_READONLY_EVIDENCE = [
  "mailhub-meta-topbar-readonly.png",
  "mailhub-meta-health-readonly.png",
  "staff-workflow-evidence-manifest.json",
];

const REQUIRED_PROD_WRITE_EVIDENCE = [
  "mailhub-meta-topbar-write.png",
  "mailhub-meta-topbar-back-to-readonly.png",
  "staff-workflow-evidence-manifest.json",
];

const EVIDENCE_MANIFEST_FILE = "staff-workflow-evidence-manifest.json";
const EVIDENCE_MANIFEST_SCHEMA = "mailhub.staff-workflow-evidence.v1";
const VALID_WRITE_ACTIONS = new Set(["setWaiting", "archive", "mute", "assign"]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MIN_PNG_BYTES = 1024;
const STAFF_EVIDENCE_MANIFEST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function parseArgs(argv) {
  const out = {
    out: defaultOut,
    envFile: defaultEnvPath,
    assignees: defaultAssigneesPath,
    prodEvidenceDir: defaultProdEvidenceDir,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") out.out = argv[++i];
    else if (arg === "--env-file") out.envFile = argv[++i];
    else if (arg === "--assignees") out.assignees = argv[++i];
    else if (arg === "--prod-evidence-dir") out.prodEvidenceDir = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/audit-mailhub-staff-workflow.mjs [--env-file path] [--assignees path] [--prod-evidence-dir path] [--out path]");
      process.exit(0);
    }
  }
  return out;
}

function loadEnvFile(path) {
  const env = {};
  if (!path || !existsSync(path)) return env;
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value.replace(/\\n/g, "\n");
  }
  return env;
}

function buildEnv(envFile) {
  return { ...loadEnvFile(envFile), ...process.env };
}

function value(env, key) {
  return typeof env[key] === "string" ? env[key].trim() : "";
}

function boolEnv(env, key) {
  const raw = value(env, key).toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function splitCsv(raw) {
  return raw
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseEmailList(raw) {
  const entries = splitCsv(raw);
  return entries.map((entry) => {
    const match = entry.match(/^(.+?)\s*<(.+?)>$/) || entry.match(/^(\S+@\S+)$/);
    const email = (match ? (match[2] ?? match[1]) : entry).toLowerCase().trim();
    const displayName = match?.[2] ? match[1].trim() : null;
    return {
      raw: entry,
      email,
      displayName,
      valid: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
      vtj: email.endsWith("@vtj.co.jp"),
    };
  });
}

function parseAssignees(path) {
  if (!path || !existsSync(path)) return { count: 0, validCount: 0, invalid: [], nonVtj: [], source: "missing" };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const rows = Array.isArray(parsed) ? parsed : [];
    const emails = rows.map((item) => {
      const email = item && typeof item === "object" && typeof item.email === "string"
        ? item.email.toLowerCase().trim()
        : "";
      return {
        email,
        valid: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
        vtj: email.endsWith("@vtj.co.jp"),
      };
    });
    return {
      count: emails.length,
      validCount: emails.filter((item) => item.valid && item.vtj).length,
      invalid: emails.filter((item) => !item.valid).map((item) => item.email || "<missing>"),
      nonVtj: emails.filter((item) => item.valid && !item.vtj).map((item) => item.email),
      source: "file",
    };
  } catch (e) {
    return {
      count: 0,
      validCount: 0,
      invalid: [`parse_error:${e instanceof Error ? e.message : String(e)}`],
      nonVtj: [],
      source: "file_error",
    };
  }
}

function getMailhubEnv(env) {
  const raw = value(env, "MAILHUB_ENV").toLowerCase();
  return raw === "local" || raw === "staging" || raw === "production" ? raw : "local";
}

function sheetsConfigured(env) {
  return Boolean(
    (value(env, "MAILHUB_SHEETS_ID") || value(env, "MAILHUB_SHEETS_SPREADSHEET_ID")) &&
      REQUIRED_SHEETS_ENV.every((key) => value(env, key)),
  );
}

function getConfigStore(env, testMode) {
  if (testMode) return "memory";
  const explicit = value(env, "MAILHUB_CONFIG_STORE");
  if (["memory", "file", "sheets"].includes(explicit)) return explicit;
  return env.NODE_ENV === "production" ? "sheets" : "file";
}

function getActivityStore(env) {
  const requested = value(env, "MAILHUB_ACTIVITY_STORE") || "memory";
  if (requested === "file") return "file";
  if (requested === "sheets") return sheetsConfigured(env) ? "sheets" : "memory";
  return "memory";
}

function getReadOnly(env, mailhubEnv, activityStore) {
  const raw = value(env, "MAILHUB_READ_ONLY");
  const requiresDurableAudit = mailhubEnv === "staging" || mailhubEnv === "production";
  if (raw === "1") return true;
  if (raw === "0") return requiresDurableAudit && activityStore !== "sheets";
  return requiresDurableAudit;
}

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

function listDir(path) {
  try {
    return existsSync(path) ? readdirSync(path) : [];
  } catch {
    return [];
  }
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function isIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
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

function evidenceFileFreshness({ dir, files, filename, field, maxAgeMs, nowMs, errors }) {
  if (typeof filename !== "string" || !files.includes(filename)) return null;
  try {
    const stats = statSync(join(dir, filename));
    if (!stats.isFile()) {
      errors.push(`evidence_file_not_file_${field}:${filename}`);
      return {
        field,
        filename,
        fresh: false,
        status: "not_file",
        mtime: null,
        ageMs: null,
        maxAgeMs,
      };
    }
    const freshness = timestampFreshness(stats.mtime.toISOString(), maxAgeMs, nowMs);
    if (freshness.status === "stale_timestamp") {
      errors.push(`stale_evidence_file_mtime_${field}:${filename}`);
    } else if (freshness.status === "future_timestamp") {
      errors.push(`future_evidence_file_mtime_${field}:${filename}`);
    }
    return {
      field,
      filename,
      fresh: freshness.fresh,
      status: freshness.status,
      mtime: stats.mtime.toISOString(),
      ageMs: freshness.ageMs,
      maxAgeMs,
    };
  } catch {
    errors.push(`evidence_file_stat_error_${field}:${filename}`);
    return {
      field,
      filename,
      fresh: false,
      status: "stat_error",
      mtime: null,
      ageMs: null,
      maxAgeMs,
    };
  }
}

function validVtjEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.toLowerCase().endsWith("@vtj.co.jp");
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function requireManifestFile({ files, filename, field, expected, pattern, errors }) {
  if (typeof filename !== "string" || !filename.trim()) {
    errors.push(`missing_${field}`);
    return false;
  }
  if (expected && filename !== expected) errors.push(`unexpected_${field}:${filename}`);
  if (pattern && !pattern.test(filename)) errors.push(`invalid_${field}:${filename}`);
  if (!files.includes(filename)) errors.push(`missing_manifest_file:${filename}`);
  return files.includes(filename) && (!expected || filename === expected) && (!pattern || pattern.test(filename));
}

function validatePngEvidenceFile({ dir, files, filename, field, errors }) {
  if (typeof filename !== "string" || !files.includes(filename)) return;
  try {
    const bytes = readFileSync(join(dir, filename));
    if (bytes.length < MIN_PNG_BYTES) {
      errors.push(`png_too_small_${field}:${filename}`);
      return;
    }
    if (bytes.subarray(0, PNG_SIGNATURE.length).compare(PNG_SIGNATURE) !== 0) {
      errors.push(`invalid_png_${field}:${filename}`);
    }
  } catch (e) {
    errors.push(`png_read_error_${field}:${filename}:${e instanceof Error ? e.message : String(e)}`);
  }
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parseCsv(raw) {
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map(parseCsvLine);
}

function normalizedHeader(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function headerIndex(headers, candidates) {
  const normalizedCandidates = new Set(candidates.map(normalizedHeader));
  return headers.findIndex((header) => normalizedCandidates.has(normalizedHeader(header)));
}

function validateActivityCsv({ dir, files, filename, expected, errors, nowMs = Date.now() }) {
  if (typeof filename !== "string" || !files.includes(filename)) return;
  try {
    const rows = parseCsv(readFileSync(join(dir, filename), "utf8"));
    if (rows.length < 2) {
      errors.push(`activity_csv_no_data_rows:${filename}`);
      return;
    }
    const [headers, ...dataRows] = rows;
    const messageIndex = headerIndex(headers, ["messageId", "message_id"]);
    const actorIndex = headerIndex(headers, ["actorEmail", "actor", "email"]);
    const actionIndex = headerIndex(headers, ["action"]);
    const timeIndex = headerIndex(headers, ["timeISO", "time_iso", "timestamp", "createdAt"]);
    const missing = [];
    if (messageIndex < 0) missing.push("messageId");
    if (actorIndex < 0) missing.push("actorEmail");
    if (actionIndex < 0) missing.push("action");
    if (timeIndex < 0) missing.push("timeISO");
    if (missing.length > 0) {
      errors.push(`activity_csv_missing_headers:${filename}:${missing.join(",")}`);
      return;
    }
    const expectedActor = expected.actorEmail.toLowerCase();
    const expectedAction = expected.action;
    const activityRows = dataRows.map((row) => ({
      messageId: String(row[messageIndex] ?? "").trim(),
      actorEmail: String(row[actorIndex] ?? "").trim().toLowerCase(),
      action: String(row[actionIndex] ?? "").trim(),
      timeISO: String(row[timeIndex] ?? "").trim(),
    }));
    const matchingRows = activityRows.filter((row) =>
      row.messageId === expected.messageId &&
      row.actorEmail === expectedActor &&
      row.action === expectedAction
    );
    if (matchingRows.length === 0) errors.push(`activity_csv_missing_controlled_write_row:${filename}`);
    if (matchingRows.length > 1) errors.push(`activity_csv_duplicate_controlled_write_row:${filename}:${matchingRows.length}`);
    for (const row of matchingRows) {
      const freshness = timestampFreshness(row.timeISO, STAFF_EVIDENCE_MANIFEST_MAX_AGE_MS, nowMs);
      if (freshness.fresh !== true) {
        errors.push(`activity_csv_stale_controlled_write_time:${filename}:${freshness.status}`);
      }
    }
    if (activityRows.length > 1) errors.push(`activity_csv_extra_write_rows:${filename}:${activityRows.length}`);
  } catch (e) {
    errors.push(`activity_csv_read_error:${filename}:${e instanceof Error ? e.message : String(e)}`);
  }
}

function prodEvidenceManifest(path, files) {
  const manifestPath = join(path, EVIDENCE_MANIFEST_FILE);
  if (!files.includes(EVIDENCE_MANIFEST_FILE)) {
    return {
      manifestFile: EVIDENCE_MANIFEST_FILE,
      manifestPresent: false,
      readOnlyManifestReady: false,
      writePilotManifestReady: false,
      readOnlyManifestErrors: ["missing_staff_workflow_evidence_manifest"],
      writePilotManifestErrors: ["missing_staff_workflow_evidence_manifest"],
    };
  }

  const manifest = readJson(manifestPath);
  if (manifest.error) {
    return {
      manifestFile: EVIDENCE_MANIFEST_FILE,
      manifestPresent: true,
      readOnlyManifestReady: false,
      writePilotManifestReady: false,
      readOnlyManifestErrors: [`manifest_parse_error:${manifest.error}`],
      writePilotManifestErrors: [`manifest_parse_error:${manifest.error}`],
    };
  }

  const commonErrors = [];
  const nowMs = Date.now();
  const capturedAtFreshness = timestampFreshness(manifest.capturedAt, STAFF_EVIDENCE_MANIFEST_MAX_AGE_MS, nowMs);
  if (manifest.schema !== EVIDENCE_MANIFEST_SCHEMA) commonErrors.push("invalid_manifest_schema");
  if (!isIsoDate(manifest.capturedAt)) commonErrors.push("invalid_manifest_captured_at");
  else if (capturedAtFreshness.status === "stale_timestamp") commonErrors.push("stale_manifest_captured_at");
  else if (capturedAtFreshness.status === "future_timestamp") commonErrors.push("future_manifest_captured_at");
  if (!validVtjEmail(manifest.capturedBy)) commonErrors.push("invalid_manifest_captured_by");
  if (manifest.environment !== "production") commonErrors.push("manifest_not_production");

  const readOnlyRollout = objectValue(manifest.readOnlyRollout);
  const readOnlyManifestErrors = [...commonErrors];
  const readOnlyEvidenceFileFreshness = [];
  const writePilotEvidenceFileFreshness = [];
  const trackEvidenceFileFreshness = ({ target, filename, field, errors }) => {
    const freshness = evidenceFileFreshness({
      dir: path,
      files,
      filename,
      field,
      maxAgeMs: STAFF_EVIDENCE_MANIFEST_MAX_AGE_MS,
      nowMs,
      errors,
    });
    if (freshness) target.push(freshness);
  };
  if (readOnlyRollout.readOnly !== true) readOnlyManifestErrors.push("readonly_manifest_not_readonly");
  requireManifestFile({
    files,
    filename: readOnlyRollout.mailhubTopbar,
    field: "readonly_mailhub_topbar",
    expected: "mailhub-meta-topbar-readonly.png",
    errors: readOnlyManifestErrors,
  });
  trackEvidenceFileFreshness({
    target: readOnlyEvidenceFileFreshness,
    filename: readOnlyRollout.mailhubTopbar,
    field: "readonly_mailhub_topbar",
    errors: readOnlyManifestErrors,
  });
  requireManifestFile({
    files,
    filename: readOnlyRollout.mailhubHealth,
    field: "readonly_mailhub_health",
    expected: "mailhub-meta-health-readonly.png",
    errors: readOnlyManifestErrors,
  });
  trackEvidenceFileFreshness({
    target: readOnlyEvidenceFileFreshness,
    filename: readOnlyRollout.mailhubHealth,
    field: "readonly_mailhub_health",
    errors: readOnlyManifestErrors,
  });
  const verifiedStaffEmails = stringArray(readOnlyRollout.verifiedStaffEmails);
  if (verifiedStaffEmails.length < 1) readOnlyManifestErrors.push("missing_readonly_verified_staff");
  if (verifiedStaffEmails.some((email) => !validVtjEmail(email))) {
    readOnlyManifestErrors.push("invalid_readonly_verified_staff");
  }

  const controlledWritePilot = objectValue(manifest.controlledWritePilot);
  const writePilotManifestErrors = [...commonErrors];
  const writeMessageId = typeof controlledWritePilot.messageId === "string" ? controlledWritePilot.messageId.trim() : "";
  const writeAction = typeof controlledWritePilot.action === "string" ? controlledWritePilot.action.trim() : "";
  const writeActorEmail = typeof controlledWritePilot.actorEmail === "string" ? controlledWritePilot.actorEmail.trim().toLowerCase() : "";
  if (!writeMessageId) {
    writePilotManifestErrors.push("missing_write_pilot_message_id");
  }
  if (writeMessageId.includes("/") || writeMessageId.includes("\\")) {
    writePilotManifestErrors.push("invalid_write_pilot_message_id");
  }
  if (!VALID_WRITE_ACTIONS.has(writeAction)) writePilotManifestErrors.push(`invalid_write_pilot_action:${writeAction || "<missing>"}`);
  if (!validVtjEmail(controlledWritePilot.actorEmail)) writePilotManifestErrors.push("invalid_write_pilot_actor_email");
  if (controlledWritePilot.returnedToReadOnly !== true) {
    writePilotManifestErrors.push("write_pilot_not_returned_to_readonly");
  }
  requireManifestFile({
    files,
    filename: controlledWritePilot.mailhubWriteTopbar,
    field: "write_mailhub_topbar",
    expected: "mailhub-meta-topbar-write.png",
    errors: writePilotManifestErrors,
  });
  trackEvidenceFileFreshness({
    target: writePilotEvidenceFileFreshness,
    filename: controlledWritePilot.mailhubWriteTopbar,
    field: "write_mailhub_topbar",
    errors: writePilotManifestErrors,
  });
  validatePngEvidenceFile({
    dir: path,
    files,
    filename: controlledWritePilot.mailhubWriteTopbar,
    field: "write_mailhub_topbar",
    errors: writePilotManifestErrors,
  });
  requireManifestFile({
    files,
    filename: controlledWritePilot.mailhubBackToReadOnlyTopbar,
    field: "write_mailhub_back_to_readonly_topbar",
    expected: "mailhub-meta-topbar-back-to-readonly.png",
    errors: writePilotManifestErrors,
  });
  trackEvidenceFileFreshness({
    target: writePilotEvidenceFileFreshness,
    filename: controlledWritePilot.mailhubBackToReadOnlyTopbar,
    field: "write_mailhub_back_to_readonly_topbar",
    errors: writePilotManifestErrors,
  });
  validatePngEvidenceFile({
    dir: path,
    files,
    filename: controlledWritePilot.mailhubBackToReadOnlyTopbar,
    field: "write_mailhub_back_to_readonly_topbar",
    errors: writePilotManifestErrors,
  });
  requireManifestFile({
    files,
    filename: controlledWritePilot.activityCsv,
    field: "write_activity_csv",
    pattern: /^activity-\d{8}-prod\.csv$/,
    errors: writePilotManifestErrors,
  });
  trackEvidenceFileFreshness({
    target: writePilotEvidenceFileFreshness,
    filename: controlledWritePilot.activityCsv,
    field: "write_activity_csv",
    errors: writePilotManifestErrors,
  });
  if (writeMessageId && writeActorEmail && VALID_WRITE_ACTIONS.has(writeAction)) {
    validateActivityCsv({
      dir: path,
      files,
      filename: controlledWritePilot.activityCsv,
      expected: {
        messageId: writeMessageId,
        actorEmail: writeActorEmail,
        action: writeAction,
      },
      errors: writePilotManifestErrors,
      nowMs,
    });
  }
  const expectedGmailProof = writeMessageId && VALID_WRITE_ACTIONS.has(writeAction)
    ? `gmail-${writeMessageId}-${writeAction}.png`
    : null;
  const expectedMailhubProof = writeMessageId && VALID_WRITE_ACTIONS.has(writeAction)
    ? `mailhub-${writeMessageId}-${writeAction}.png`
    : null;
  requireManifestFile({
    files,
    filename: controlledWritePilot.gmailProof,
    field: "write_gmail_proof",
    expected: expectedGmailProof,
    pattern: expectedGmailProof ? null : /^gmail-.+-.+\.png$/,
    errors: writePilotManifestErrors,
  });
  trackEvidenceFileFreshness({
    target: writePilotEvidenceFileFreshness,
    filename: controlledWritePilot.gmailProof,
    field: "write_gmail_proof",
    errors: writePilotManifestErrors,
  });
  validatePngEvidenceFile({
    dir: path,
    files,
    filename: controlledWritePilot.gmailProof,
    field: "write_gmail_proof",
    errors: writePilotManifestErrors,
  });
  requireManifestFile({
    files,
    filename: controlledWritePilot.mailhubProof,
    field: "write_mailhub_proof",
    expected: expectedMailhubProof,
    pattern: expectedMailhubProof ? null : /^mailhub-.+-.+\.png$/,
    errors: writePilotManifestErrors,
  });
  trackEvidenceFileFreshness({
    target: writePilotEvidenceFileFreshness,
    filename: controlledWritePilot.mailhubProof,
    field: "write_mailhub_proof",
    errors: writePilotManifestErrors,
  });
  validatePngEvidenceFile({
    dir: path,
    files,
    filename: controlledWritePilot.mailhubProof,
    field: "write_mailhub_proof",
    errors: writePilotManifestErrors,
  });

  validatePngEvidenceFile({
    dir: path,
    files,
    filename: readOnlyRollout.mailhubTopbar,
    field: "readonly_mailhub_topbar",
    errors: readOnlyManifestErrors,
  });
  validatePngEvidenceFile({
    dir: path,
    files,
    filename: readOnlyRollout.mailhubHealth,
    field: "readonly_mailhub_health",
    errors: readOnlyManifestErrors,
  });

  return {
    manifestFile: EVIDENCE_MANIFEST_FILE,
    manifestPresent: true,
    manifestSchema: manifest.schema ?? null,
    manifestCapturedAt: manifest.capturedAt ?? null,
    manifestCapturedAtFresh: capturedAtFreshness.fresh,
    manifestCapturedAtAgeMs: capturedAtFreshness.ageMs,
    manifestCapturedAtMaxAgeMs: STAFF_EVIDENCE_MANIFEST_MAX_AGE_MS,
    manifestCapturedByConfigured: validVtjEmail(manifest.capturedBy),
    evidenceFileFreshness: {
      readOnly: readOnlyEvidenceFileFreshness,
      writePilot: writePilotEvidenceFileFreshness,
    },
    readOnlyManifestReady: readOnlyManifestErrors.length === 0,
    writePilotManifestReady: writePilotManifestErrors.length === 0,
    readOnlyManifestErrors,
    writePilotManifestErrors,
  };
}

function prodEvidence(path) {
  const files = listDir(path);
  const has = (name) => files.includes(name);
  const readonlyMissing = REQUIRED_PROD_READONLY_EVIDENCE.filter((name) => !has(name));
  const writeMissing = REQUIRED_PROD_WRITE_EVIDENCE.filter((name) => !has(name));
  const activityCsv = files.filter((name) => /^activity-\d{8}-prod\.csv$/.test(name));
  const gmailProof = files.filter((name) => /^gmail-.+-.+\.png$/.test(name));
  const mailhubProof = files.filter((name) => /^mailhub-.+-.+\.png$/.test(name));
  const manifest = prodEvidenceManifest(path, files);
  const readOnlyEvidenceIssues = [...readonlyMissing, ...manifest.readOnlyManifestErrors.map((item) => `manifest:${item}`)];
  const writePilotEvidenceIssues = [
    ...writeMissing,
    ...(activityCsv.length > 0 ? [] : ["activity-YYYYMMDD-prod.csv"]),
    ...(gmailProof.length > 0 ? [] : ["gmail-*-*.png"]),
    ...(mailhubProof.length > 0 ? [] : ["mailhub-*-*.png"]),
    ...manifest.writePilotManifestErrors.map((item) => `manifest:${item}`),
  ];
  return {
    dir: path,
    readonlyRequired: REQUIRED_PROD_READONLY_EVIDENCE,
    readonlyMissing,
    readOnlyEvidenceIssues,
    writeRequired: REQUIRED_PROD_WRITE_EVIDENCE,
    writeMissing,
    writePilotEvidenceIssues,
    activityCsvCount: activityCsv.length,
    gmailProofCount: gmailProof.length,
    mailhubProofCount: mailhubProof.length,
    manifest,
    readOnlyEvidenceReady: readOnlyEvidenceIssues.length === 0,
    writePilotEvidenceReady:
      writePilotEvidenceIssues.length === 0,
  };
}

function missingEnv(env, keys) {
  return keys.filter((key) => !value(env, key));
}

function blocker(id, severity, message, evidence = {}) {
  return { id, severity, message, evidence };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = buildEnv(args.envFile);
  const mailhubEnv = getMailhubEnv(env);
  const testMode = boolEnv(env, "MAILHUB_TEST_MODE");
  const configStore = getConfigStore(env, testMode);
  const activityStore = getActivityStore(env);
  const readOnly = getReadOnly(env, mailhubEnv, activityStore);
  const sheetsReady = sheetsConfigured(env);
  const admins = parseEmailList(value(env, "MAILHUB_ADMINS"));
  const teamMembers = parseEmailList(value(env, "MAILHUB_TEAM_MEMBERS"));
  const assignees = parseAssignees(args.assignees);
  const evidence = prodEvidence(args.prodEvidenceDir);
  const missingProductionEnv = missingEnv(env, REQUIRED_PRODUCTION_ENV);
  const adminInvalid = admins.filter((item) => !item.valid).map((item) => item.raw);
  const adminNonVtj = admins.filter((item) => item.valid && !item.vtj).map((item) => item.email);
  const teamInvalid = teamMembers.filter((item) => !item.valid).map((item) => item.raw);
  const teamNonVtj = teamMembers.filter((item) => item.valid && !item.vtj).map((item) => item.email);
  const validTeamMembers = teamMembers.filter((item) => item.valid && item.vtj);
  const adminsReady = admins.length > 0 && adminInvalid.length === 0 && adminNonVtj.length === 0;
  const staffAccessAllowlistReady =
    adminsReady && validTeamMembers.length > 0 && teamInvalid.length === 0 && teamNonVtj.length === 0;
  const assigneeRosterReady = validTeamMembers.length > 0 || assignees.validCount > 0;
  const productionEnvReady = mailhubEnv === "production" && !testMode && missingProductionEnv.length === 0;
  const durableConfigReady = configStore === "sheets" && sheetsReady;
  const durableActivityReady = activityStore === "sheets";
  const readOnlyRolloutReady =
    productionEnvReady &&
    readOnly &&
    adminsReady &&
    staffAccessAllowlistReady &&
    durableConfigReady &&
    durableActivityReady &&
    assigneeRosterReady &&
    evidence.readOnlyEvidenceReady;
  const controlledWritePilotReady =
    productionEnvReady &&
    adminsReady &&
    staffAccessAllowlistReady &&
    durableConfigReady &&
    durableActivityReady &&
    assigneeRosterReady &&
    evidence.writePilotEvidenceReady;
  const staffWorkflowPermissionsReady = readOnlyRolloutReady && controlledWritePilotReady;

  const blockers = [];
  if (mailhubEnv !== "production") blockers.push(blocker("not_production_env", "P1", "Staff workflow proof must be generated from the production environment.", { mailhubEnv }));
  if (testMode) blockers.push(blocker("test_mode_enabled", "P0", "Production staff workflow cannot be validated with MAILHUB_TEST_MODE enabled."));
  if (missingProductionEnv.length > 0) blockers.push(blocker("missing_production_env", "P1", "Required production auth/shared-inbox env is missing.", { missing: missingProductionEnv }));
  if (!adminsReady) blockers.push(blocker("admins_not_ready", "P1", "MAILHUB_ADMINS must contain valid @vtj.co.jp admin addresses.", {
    count: admins.length,
    invalid: adminInvalid,
    nonVtj: adminNonVtj,
  }));
  if (!staffAccessAllowlistReady) blockers.push(blocker("staff_access_allowlist_not_ready", "P1", "MAILHUB_TEAM_MEMBERS must contain at least one valid @vtj.co.jp staff user for non-admin access control.", {
    teamMemberCount: validTeamMembers.length,
    teamInvalid,
    teamNonVtj,
  }));
  if (!assigneeRosterReady) blockers.push(blocker("assignee_roster_not_ready", "P1", "At least one @vtj.co.jp staff assignee must be configured.", {
    teamMemberCount: validTeamMembers.length,
    assigneeRegistryCount: assignees.validCount,
    teamInvalid,
    teamNonVtj,
    assigneeInvalid: assignees.invalid,
    assigneeNonVtj: assignees.nonVtj,
  }));
  if (!durableConfigReady) blockers.push(blocker("config_store_not_durable", "P1", "Production staff workflow requires Sheets-backed config.", {
    configStore,
    sheetsConfigured: sheetsReady,
  }));
  if (!durableActivityReady) blockers.push(blocker("activity_store_not_durable", "P1", "Production staff workflow requires Sheets-backed Activity audit logging.", {
    activityStore,
    sheetsConfigured: sheetsReady,
  }));
  if (!readOnly) blockers.push(blocker("read_only_not_enabled", "P1", "Initial production rollout evidence must start from READ ONLY."));
  if (!evidence.readOnlyEvidenceReady) blockers.push(blocker("readonly_evidence_missing", "P1", "Production READ ONLY rollout evidence files are missing.", {
    missing: evidence.readOnlyEvidenceIssues,
  }));
  if (!evidence.writePilotEvidenceReady) blockers.push(blocker("write_pilot_evidence_missing", "P1", "Controlled production WRITE pilot evidence is missing.", {
    missing: evidence.writePilotEvidenceIssues,
    missingMeta: evidence.writeMissing,
    activityCsvCount: evidence.activityCsvCount,
    gmailProofCount: evidence.gmailProofCount,
    mailhubProofCount: evidence.mailhubProofCount,
  }));

  const result = {
    generatedAt: new Date().toISOString(),
    repoHead: currentRepoHead(),
    inputs: {
      envFile: args.envFile || null,
      assignees: args.assignees,
      prodEvidenceDir: args.prodEvidenceDir,
    },
    environment: {
      mailhubEnv,
      nodeEnv: value(env, "NODE_ENV") || null,
      testMode,
      readOnly,
      readOnlyRaw: value(env, "MAILHUB_READ_ONLY") || null,
    },
    config: {
      configStore,
      activityStore,
      sheetsConfigured: sheetsReady,
      missingProductionEnv,
      alertsSecretConfigured: Boolean(value(env, "MAILHUB_ALERTS_SECRET")),
      gmailSendEnabled: value(env, "MAILHUB_SEND_ENABLED") === "1",
    },
    staff: {
      adminsConfigured: admins.length > 0,
      adminCount: admins.length,
      adminInvalid,
      adminNonVtj,
      staffAccessAllowlistReady,
      teamMemberCount: validTeamMembers.length,
      teamInvalid,
      teamNonVtj,
      assigneeRegistry: assignees,
    },
    evidence,
    requirements: {
      productionEnvReady,
      adminsReady,
      staffAccessAllowlistReady,
      assigneeRosterReady,
      durableConfigReady,
      durableActivityReady,
      readOnlyRolloutEvidenceReady: evidence.readOnlyEvidenceReady,
      writePilotEvidenceReady: evidence.writePilotEvidenceReady,
      readOnlyRolloutReady,
      controlledWritePilotReady,
      staffWorkflowPermissionsReady,
    },
    blockers,
    gate: {
      readOnlyRolloutReady,
      controlledWritePilotReady,
      staffWorkflowPermissionsReady,
      p0Blockers: blockers.filter((item) => item.severity === "P0").map((item) => item.id),
      p1Blockers: blockers.filter((item) => item.severity === "P1").map((item) => item.id),
    },
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    outPath: args.out,
    generatedAt: result.generatedAt,
    staffWorkflowPermissionsReady,
    readOnlyRolloutReady,
    controlledWritePilotReady,
    p0Blockers: result.gate.p0Blockers,
    p1Blockers: result.gate.p1Blockers,
  }, null, 2));
}

main();
