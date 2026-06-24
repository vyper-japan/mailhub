import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ALERT_AUTOMATION_WORKFLOW_PATH = ".github/workflows/mailhub-alerts.yml";

export const ALERT_AUTOMATION_WORKFLOW_REQUIRED_MISSING = [
  "workflow_file",
  "schedule.cron",
  "MAILHUB_ALERTS_SECRET",
  "MAILHUB_PROD_URL",
  "alerts_run_endpoint",
];

const ALERT_AUTOMATION_WORKFLOW_REQUIRED_CHECKS = [
  {
    id: "schedule.cron",
    test: (active) =>
      /^on:\s*(?:\n[ \t].*)*?\n[ \t]+schedule:\s*(?:\n[ \t].*)*?\n[ \t]+-\s*cron:\s*["'][^"'\n]+["']\s*$/m.test(active),
  },
  {
    id: "MAILHUB_ALERTS_SECRET",
    test: (active) => /^[ \t]*[^#\n]*\$\{\{\s*secrets\.MAILHUB_ALERTS_SECRET\s*\}\}/m.test(active),
  },
  {
    id: "MAILHUB_PROD_URL",
    test: (active) => /^[ \t]*[^#\n]*\$\{\{\s*secrets\.MAILHUB_PROD_URL\s*\}\}/m.test(active),
  },
  {
    id: "alerts_run_endpoint",
    test: (active) => /^[ \t]*[^#\n]*\/api\/mailhub\/alerts\/run\?scope=all/m.test(active),
  },
];

function activeWorkflowText(raw) {
  return raw
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function sameStringSet(a, b) {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

export function alertAutomationWorkflowReadiness(repoRoot = process.cwd()) {
  const workflowPath = join(repoRoot, ALERT_AUTOMATION_WORKFLOW_PATH);
  if (!existsSync(workflowPath)) {
    return {
      path: ALERT_AUTOMATION_WORKFLOW_PATH,
      sha256: null,
      ready: false,
      missing: ["workflow_file"],
    };
  }
  const raw = readFileSync(workflowPath, "utf8");
  const active = activeWorkflowText(raw);
  const sha256 = createHash("sha256").update(raw).digest("hex");
  const missing = ALERT_AUTOMATION_WORKFLOW_REQUIRED_CHECKS
    .filter((item) => !item.test(active))
    .map((item) => item.id);
  return {
    path: ALERT_AUTOMATION_WORKFLOW_PATH,
    sha256,
    ready: missing.length === 0,
    missing,
  };
}

export function alertAutomationWorkflowFresh(artifactWorkflow, currentWorkflow) {
  return artifactWorkflow?.path === currentWorkflow?.path &&
    artifactWorkflow?.sha256 === currentWorkflow?.sha256 &&
    artifactWorkflow?.ready === currentWorkflow?.ready &&
    sameStringSet(stringArray(artifactWorkflow?.missing), stringArray(currentWorkflow?.missing));
}
