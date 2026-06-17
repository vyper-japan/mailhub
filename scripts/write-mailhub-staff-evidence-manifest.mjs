#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const repoRoot = process.cwd();
const defaultOut = join(repoRoot, "docs", "pilot", "prod", "staff-workflow-evidence-manifest.json");
const schema = "mailhub.staff-workflow-evidence.v1";
const validActions = new Set(["assign", "waiting", "done", "mute", "label-add", "label-remove"]);

function parseArgs(argv) {
  const out = {
    out: defaultOut,
    capturedAt: new Date().toISOString(),
    capturedBy: "",
    staffEmail: "",
    actorEmail: "",
    messageId: "",
    action: "assign",
    date: new Date().toISOString().slice(0, 10).replaceAll("-", ""),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") out.out = argv[++i];
    else if (arg === "--captured-at") out.capturedAt = argv[++i];
    else if (arg === "--captured-by") out.capturedBy = argv[++i];
    else if (arg === "--staff-email") out.staffEmail = argv[++i];
    else if (arg === "--actor-email") out.actorEmail = argv[++i];
    else if (arg === "--message-id") out.messageId = argv[++i];
    else if (arg === "--action") out.action = argv[++i];
    else if (arg === "--date") out.date = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/write-mailhub-staff-evidence-manifest.mjs --captured-by admin@vtj.co.jp --staff-email staff@vtj.co.jp --actor-email staff@vtj.co.jp --message-id <messageId> [--action assign] [--date YYYYMMDD] [--out path]");
      process.exit(0);
    }
  }
  return out;
}

function validVtjEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.toLowerCase().endsWith("@vtj.co.jp");
}

function validate(args) {
  const errors = [];
  if (!validVtjEmail(args.capturedBy)) errors.push("invalid_captured_by");
  if (!validVtjEmail(args.staffEmail)) errors.push("invalid_staff_email");
  if (!validVtjEmail(args.actorEmail)) errors.push("invalid_actor_email");
  if (typeof args.messageId !== "string" || !args.messageId.trim()) errors.push("missing_message_id");
  if (!validActions.has(args.action)) errors.push(`invalid_action:${args.action}`);
  if (!/^\d{8}$/.test(args.date)) errors.push("invalid_date");
  if (Number.isNaN(Date.parse(args.capturedAt))) errors.push("invalid_captured_at");
  return errors;
}

function buildManifest(args) {
  const messageId = args.messageId.trim();
  const action = args.action.trim();
  return {
    schema,
    capturedAt: args.capturedAt,
    capturedBy: args.capturedBy.toLowerCase().trim(),
    environment: "production",
    readOnlyRollout: {
      readOnly: true,
      mailhubTopbar: "mailhub-meta-topbar-readonly.png",
      mailhubHealth: "mailhub-meta-health-readonly.png",
      verifiedStaffEmails: [args.staffEmail.toLowerCase().trim()],
    },
    controlledWritePilot: {
      messageId,
      actorEmail: args.actorEmail.toLowerCase().trim(),
      mailhubWriteTopbar: "mailhub-meta-topbar-write.png",
      mailhubBackToReadOnlyTopbar: "mailhub-meta-topbar-back-to-readonly.png",
      activityCsv: `activity-${args.date}-prod.csv`,
      gmailProof: `gmail-${messageId}-${action}.png`,
      mailhubProof: `mailhub-${messageId}-${action}.png`,
      returnedToReadOnly: true,
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const errors = validate(args);
  if (errors.length > 0) {
    console.error(JSON.stringify({ ok: false, errors }, null, 2));
    process.exit(1);
  }

  const manifest = buildManifest(args);
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    outPath: args.out,
    schema: manifest.schema,
    messageId: manifest.controlledWritePilot.messageId,
    action: args.action,
    requiredFiles: [
      manifest.readOnlyRollout.mailhubTopbar,
      manifest.readOnlyRollout.mailhubHealth,
      manifest.controlledWritePilot.mailhubWriteTopbar,
      manifest.controlledWritePilot.mailhubBackToReadOnlyTopbar,
      manifest.controlledWritePilot.activityCsv,
      manifest.controlledWritePilot.gmailProof,
      manifest.controlledWritePilot.mailhubProof,
    ],
  }, null, 2));
}

main();
