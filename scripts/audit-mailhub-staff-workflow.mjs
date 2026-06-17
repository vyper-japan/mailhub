#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const repoRoot = process.cwd();
const runDir = join(repoRoot, ".ai-runs", "mailhub-next-phase");
const defaultOut = join(runDir, "mailhub-staff-workflow-audit.json");
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
];

const REQUIRED_PROD_WRITE_EVIDENCE = [
  "mailhub-meta-topbar-write.png",
  "mailhub-meta-topbar-back-to-readonly.png",
];

function parseArgs(argv) {
  const out = {
    out: defaultOut,
    envFile: "",
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
  return { ...process.env, ...loadEnvFile(envFile) };
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

function prodEvidence(path) {
  const files = listDir(path);
  const has = (name) => files.includes(name);
  const readonlyMissing = REQUIRED_PROD_READONLY_EVIDENCE.filter((name) => !has(name));
  const writeMissing = REQUIRED_PROD_WRITE_EVIDENCE.filter((name) => !has(name));
  const activityCsv = files.filter((name) => /^activity-\d{8}-prod\.csv$/.test(name));
  const gmailProof = files.filter((name) => /^gmail-.+-.+\.png$/.test(name));
  const mailhubProof = files.filter((name) => /^mailhub-.+-.+\.png$/.test(name));
  return {
    dir: path,
    readonlyRequired: REQUIRED_PROD_READONLY_EVIDENCE,
    readonlyMissing,
    writeRequired: REQUIRED_PROD_WRITE_EVIDENCE,
    writeMissing,
    activityCsvCount: activityCsv.length,
    gmailProofCount: gmailProof.length,
    mailhubProofCount: mailhubProof.length,
    readOnlyEvidenceReady: readonlyMissing.length === 0,
    writePilotEvidenceReady:
      writeMissing.length === 0 &&
      activityCsv.length > 0 &&
      gmailProof.length > 0 &&
      mailhubProof.length > 0,
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
    missing: evidence.readonlyMissing,
  }));
  if (!evidence.writePilotEvidenceReady) blockers.push(blocker("write_pilot_evidence_missing", "P1", "Controlled production WRITE pilot evidence is missing.", {
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
