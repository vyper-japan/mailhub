#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const repoRoot = process.cwd();
const defaultRunDir = join(".ai-runs", "mailhub-next-phase");
const DEFAULT_RULES_SOURCE = "file";

function parseArgs(argv) {
  const args = {
    outDir: defaultRunDir,
    envFile: ".env.local",
    rulesSource: DEFAULT_RULES_SOURCE,
    planOnly: false,
    skipContracts: false,
    sourceMaxPages: "3",
    viewsMaxPages: "10",
    rulesMax: "100",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out-dir") args.outDir = argv[++i] || "";
    else if (arg === "--env-file") args.envFile = argv[++i] || "";
    else if (arg === "--rules-source") args.rulesSource = argv[++i] || "";
    else if (arg === "--plan-only") args.planOnly = true;
    else if (arg === "--skip-contracts") args.skipContracts = true;
    else if (arg === "--source-max-pages") args.sourceMaxPages = argv[++i] || "";
    else if (arg === "--views-max-pages") args.viewsMaxPages = argv[++i] || "";
    else if (arg === "--rules-max") args.rulesMax = argv[++i] || "";
    else if (arg === "--send" || arg === "--apply") {
      throw new Error(`${arg.slice(2)}_is_not_supported_by_readiness_refresh`);
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/refresh-mailhub-readiness-artifacts.mjs [--out-dir path] [--env-file path] [--rules-source file|sheets] [--plan-only] [--skip-contracts]

Refreshes MailHub readiness artifacts with no send/apply side effects.

Defaults:
  --out-dir .ai-runs/mailhub-next-phase
  --env-file .env.local
  --rules-source ${DEFAULT_RULES_SOURCE}

For production completion, use --rules-source sheets after Sheets env is configured.
This script intentionally does not support --send or --apply.`);
      process.exit(0);
    } else {
      throw new Error(`unknown_arg:${arg}`);
    }
  }
  if (!["file", "sheets"].includes(args.rulesSource)) {
    throw new Error("rules_source_must_be_file_or_sheets");
  }
  if (isAbsolute(args.outDir)) throw new Error("out_dir_must_be_repo_relative");
  if (isAbsolute(args.envFile)) throw new Error("env_file_must_be_repo_relative");
  return args;
}

function artifact(outDir, name) {
  return join(outDir, name);
}

function command(name, args, options = {}) {
  return { name, args, env: options.env ?? {} };
}

function readOptionalJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function hasCompleteRoutingProof(outDir) {
  const preflight = readOptionalJson(artifact(outDir, "mailhub-routing-probe-preflight.json"));
  const audit = readOptionalJson(artifact(outDir, "mailhub-routing-probe-audit.json"));
  const send = readOptionalJson(artifact(outDir, "mailhub-routing-probe-send.json"));
  return (
    preflight?.mode === "preflight" &&
    preflight?.smtpPreflight?.readyForProductionProof === true &&
    audit?.mode === "verify_marker" &&
    audit?.gate?.allExpectedAddressesConfirmed === true &&
    send?.mode === "sent" &&
    send?.verification?.allExpectedAddressesConfirmed === true
  );
}

function buildCommands(args) {
  const outDir = args.outDir;
  const rulesEnv = args.rulesSource === "sheets" ? { MAILHUB_CONFIG_STORE: "sheets" } : {};
  const preserveRoutingProof = hasCompleteRoutingProof(outDir);
  const routingProbeRefresh = preserveRoutingProof ? [] : [
    command("npm", ["run", "probe:routing-preflight", "--", "--out", artifact(outDir, "mailhub-routing-probe-preflight.json")]),
    command("npm", ["run", "audit:routing-probes", "--", "--out", artifact(outDir, "mailhub-routing-probe-audit.json")]),
    command("npm", ["run", "probe:routing-send", "--", "--out", artifact(outDir, "mailhub-routing-probe-send.json")]),
  ];
  const refresh = [
    command("npm", ["run", "audit:gmail-sources", "--", "--out", artifact(outDir, "gmail-source-coverage-audit.json"), "--max-pages", args.sourceMaxPages]),
    command("npm", ["run", "audit:gmail-views", "--", "--out", artifact(outDir, "gmail-default-views-audit.json"), "--max-pages", args.viewsMaxPages]),
    command("npm", ["run", "audit:gmail-rules", "--", "--env-file", args.envFile, "--config-source", args.rulesSource, "--out", artifact(outDir, "gmail-rule-safety-audit.json"), "--max", args.rulesMax], { env: rulesEnv }),
    command("npm", ["run", "audit:mailhub-ops", "--", "--out", artifact(outDir, "mailhub-operational-confirmations.json")]),
    command("npm", ["run", "audit:gws-routing", "--", "--out", artifact(outDir, "mailhub-gws-routing-audit.json")]),
    command("npm", ["run", "audit:github-routing-secrets", "--", "--no-fail", "--out", artifact(outDir, "github-routing-secrets-readiness.json")]),
    command("npm", ["run", "audit:github-staff-secrets", "--", "--no-fail", "--out", artifact(outDir, "github-staff-secrets-readiness.json")]),
    command("npm", ["run", "audit:mailhub-staff-workflow", "--", "--out", artifact(outDir, "mailhub-staff-workflow-audit.json")]),
    ...routingProbeRefresh,
    command("npm", ["run", "audit:mailhub-readiness", "--", "--out", artifact(outDir, "mailhub-production-readiness-audit.json")]),
    command("npm", ["run", "audit:mailhub-staff-next", "--", "--out", artifact(outDir, "mailhub-staff-workflow-next-steps.json")]),
    command("npm", ["run", "audit:mailhub-rule-config-next", "--", "--local-env-file", args.envFile, "--out", artifact(outDir, "mailhub-rule-config-next-steps.json")]),
    command("npm", ["run", "audit:mailhub-routing-next", "--", "--strict", "--out", artifact(outDir, "mailhub-routing-next-steps.json")]),
    command("npm", ["run", "audit:mailhub-config-request", "--", "--run-dir", outDir, "--out", artifact(outDir, "mailhub-production-config-request.json")]),
  ];
  const contracts = [
    command("npm", ["run", "audit:github-routing-secrets-contract"]),
    command("npm", ["run", "audit:github-staff-secrets-contract"]),
    command("npm", ["run", "audit:mailhub-staff-workflow-contract"]),
    command("npm", ["run", "audit:mailhub-staff-next-contract"]),
    command("npm", ["run", "audit:mailhub-readiness-contract"]),
    command("npm", ["run", "audit:mailhub-rule-config-next-contract"]),
    command("npm", ["run", "audit:mailhub-routing-next-contract"]),
    command("npm", ["run", "audit:mailhub-routing-proof-contract"]),
    command("npm", ["run", "security:scan-artifacts"]),
  ];
  return args.skipContracts ? refresh : [...refresh, ...contracts];
}

function printable(cmd) {
  const prefix = Object.entries(cmd.env)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  return `${prefix ? `${prefix} ` : ""}${[cmd.name, ...cmd.args].join(" ")}`;
}

function assertNoSideEffects(commands) {
  const serialized = commands.map(printable).join("\n");
  if (/\s--send(\s|$)/.test(serialized)) throw new Error("refresh_commands_must_not_send_mail");
  if (/\s--apply(\s|$)/.test(serialized)) throw new Error("refresh_commands_must_not_apply_external_changes");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const commands = buildCommands(args);
  assertNoSideEffects(commands);
  mkdirSync(args.outDir, { recursive: true });

  if (args.planOnly) {
    console.log(JSON.stringify({
      mode: "plan_only",
      outDir: args.outDir,
      rulesSource: args.rulesSource,
      preserveRoutingProof: hasCompleteRoutingProof(args.outDir),
      commandCount: commands.length,
      commands: commands.map(printable),
      sideEffectPolicy: "no --send, no --apply; writes local readiness artifacts only",
    }, null, 2));
    return;
  }

  for (const cmd of commands) {
    console.log(`$ ${printable(cmd)}`);
    execFileSync(cmd.name, cmd.args, {
      cwd: repoRoot,
      env: { ...process.env, ...cmd.env },
      stdio: "inherit",
    });
  }
}

main();
