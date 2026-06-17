import { spawnSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { describe, expect, test } from "vitest";

const writerPath = resolve(process.cwd(), "scripts/write-mailhub-rule-config-next-steps.mjs");
const contractPath = resolve(process.cwd(), "scripts/check-mailhub-rule-config-next-contract.mjs");

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "mailhub-rule-config-next-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function runNode(scriptPath: string, args: string[], env: Partial<NodeJS.ProcessEnv> = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      MAILHUB_CONFIG_STORE: "",
      MAILHUB_SHEETS_ID: "",
      MAILHUB_SHEETS_SPREADSHEET_ID: "",
      MAILHUB_SHEETS_CLIENT_EMAIL: "",
      MAILHUB_SHEETS_PRIVATE_KEY: "",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      GOOGLE_SHARED_INBOX_EMAIL: "",
      GOOGLE_SHARED_INBOX_REFRESH_TOKEN: "",
      ...env,
    },
  });
}

function readinessFixture(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-06-18T00:00:00.000Z",
    repoHead: "head-1",
    inputs: {
      rulesAuditGeneratedAt: "2026-06-18T00:00:00.000Z",
      rulesConfigFingerprint: "sha256:fixture",
      ruleConfigSource: {
        requestedSource: "file",
        resolvedSource: "file",
        warnings: [],
      },
    },
    requirements: {
      currentRuleConfigRealDataSafetyReady: true,
      currentRuleConfigFingerprintPresent: true,
      currentRuleConfigSourceProductionReady: false,
    },
    gate: {
      productionReady: false,
      p0Blockers: ["current_shared_gmail_routing"],
      p1Blockers: ["rule_config_source_not_production", "staff_workflow_permissions"],
    },
    ...overrides,
  };
}

function rulesAuditFixture(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-06-18T00:00:00.000Z",
    config: {
      requestedSource: "file",
      resolvedSource: "file",
      warnings: [],
      ruleSetFingerprint: "sha256:fixture",
    },
    ruleSafetyGate: {
      realDataRuleRiskPass: true,
      suppressiveAutoApplySafe: true,
      blockingFindings: [],
    },
    ...overrides,
  };
}

describe("MailHub rule config next steps", () => {
  test("turns a file-backed rule config source blocker into non-secret next actions", () => {
    withTempDir((dir) => {
      const readinessPath = join(dir, "readiness.json");
      const rulesPath = join(dir, "rules.json");
      const nextPath = join(dir, "rule-next.json");
      writeJson(readinessPath, readinessFixture());
      writeJson(rulesPath, rulesAuditFixture());

      const result = runNode(writerPath, [
        "--readiness",
        readinessPath,
        "--rules-audit",
        rulesPath,
        "--out",
        nextPath,
        "--local-env-file",
        join(dir, ".env.local"),
        "--repo-head",
        "head-1",
        "--repo-parent-head",
        "parent-1",
      ]);

      expect(result.status).toBe(0);
      const artifact = readJson<{
        state: { currentRuleConfigSourceProductionReady: boolean; canRunSheetsRuleSafetyAudit: boolean };
        missing: { sheetsConfig: string[]; gmailRuleAuditEnv: string[] };
        nextActions: Array<{ id: string; status: string; command?: string; commands?: string[] }>;
      }>(nextPath);
      expect(artifact.state.currentRuleConfigSourceProductionReady).toBe(false);
      expect(artifact.state.canRunSheetsRuleSafetyAudit).toBe(false);
      expect(artifact.missing.sheetsConfig).toContain("MAILHUB_CONFIG_STORE=sheets");
      expect(artifact.missing.gmailRuleAuditEnv).toContain("GOOGLE_CLIENT_ID");
      expect(artifact.nextActions.find((action) => action.id === "run_sheets_rule_safety_audit")?.status).toBe("blocked");
      expect(JSON.stringify(artifact)).not.toContain("real-google-secret");

      const contract = runNode(contractPath, [
        "--next",
        nextPath,
        "--readiness",
        readinessPath,
        "--rules-audit",
        rulesPath,
        "--repo-head",
        "head-1",
        "--repo-parent-head",
        "parent-1",
      ]);
      expect(contract.status).toBe(0);
    });
  });

  test("marks the rule config next actions done when readiness proves clean Sheets source", () => {
    withTempDir((dir) => {
      const readinessPath = join(dir, "readiness.json");
      const rulesPath = join(dir, "rules.json");
      const nextPath = join(dir, "rule-next.json");
      const envPath = join(dir, ".env.local");
      writeFileSync(envPath, [
        "MAILHUB_CONFIG_STORE=sheets",
        "MAILHUB_SHEETS_ID=sheet-id",
        "MAILHUB_SHEETS_CLIENT_EMAIL=svc@example.com",
        "MAILHUB_SHEETS_PRIVATE_KEY=real-google-secret",
        "GOOGLE_CLIENT_ID=client-id",
        "GOOGLE_CLIENT_SECRET=real-google-secret",
        "GOOGLE_SHARED_INBOX_EMAIL=mailhub@vtj.co.jp",
        "GOOGLE_SHARED_INBOX_REFRESH_TOKEN=real-refresh-token",
      ].join("\n"), "utf8");
      writeJson(readinessPath, readinessFixture({
        inputs: {
          rulesAuditGeneratedAt: "2026-06-18T00:00:00.000Z",
          rulesConfigFingerprint: "sha256:fixture",
          ruleConfigSource: {
            requestedSource: "sheets",
            resolvedSource: "sheets",
            warnings: [],
          },
        },
        requirements: {
          currentRuleConfigRealDataSafetyReady: true,
          currentRuleConfigFingerprintPresent: true,
          currentRuleConfigSourceProductionReady: true,
        },
        gate: {
          productionReady: false,
          p0Blockers: ["current_shared_gmail_routing"],
          p1Blockers: ["staff_workflow_permissions"],
        },
      }));
      writeJson(rulesPath, rulesAuditFixture({
        config: {
          requestedSource: "sheets",
          resolvedSource: "sheets",
          warnings: [],
          ruleSetFingerprint: "sha256:fixture",
        },
      }));

      const result = runNode(writerPath, [
        "--readiness",
        readinessPath,
        "--rules-audit",
        rulesPath,
        "--out",
        nextPath,
        "--local-env-file",
        envPath,
        "--repo-head",
        "head-1",
        "--repo-parent-head",
        "parent-1",
      ]);

      expect(result.status).toBe(0);
      const artifact = readJson<{
        state: { currentRuleConfigSourceProductionReady: boolean; canRunSheetsRuleSafetyAudit: boolean };
        nextActions: Array<{ status: string }>;
      }>(nextPath);
      expect(artifact.state.currentRuleConfigSourceProductionReady).toBe(true);
      expect(artifact.state.canRunSheetsRuleSafetyAudit).toBe(true);
      expect(artifact.nextActions.every((action) => action.status === "done")).toBe(true);
      expect(JSON.stringify(artifact)).not.toContain("real-google-secret");

      const contract = runNode(contractPath, [
        "--next",
        nextPath,
        "--readiness",
        readinessPath,
        "--rules-audit",
        rulesPath,
        "--repo-head",
        "head-1",
        "--repo-parent-head",
        "parent-1",
      ]);
      expect(contract.status).toBe(0);
    });
  });

  test("contract rejects a contradictory rule safety action status", () => {
    withTempDir((dir) => {
      const readinessPath = join(dir, "readiness.json");
      const rulesPath = join(dir, "rules.json");
      const nextPath = join(dir, "rule-next.json");
      writeJson(readinessPath, readinessFixture());
      writeJson(rulesPath, rulesAuditFixture());
      runNode(writerPath, [
        "--readiness",
        readinessPath,
        "--rules-audit",
        rulesPath,
        "--out",
        nextPath,
        "--local-env-file",
        join(dir, ".env.local"),
        "--repo-head",
        "head-1",
        "--repo-parent-head",
        "parent-1",
      ]);
      const artifact = readJson<{ nextActions: Array<{ id: string; status: string }> }>(nextPath);
      const action = artifact.nextActions.find((item) => item.id === "run_sheets_rule_safety_audit");
      if (action) action.status = "done";
      writeJson(nextPath, artifact);

      const contract = runNode(contractPath, [
        "--next",
        nextPath,
        "--readiness",
        readinessPath,
        "--rules-audit",
        rulesPath,
        "--repo-head",
        "head-1",
        "--repo-parent-head",
        "parent-1",
      ]);

      expect(contract.status).toBe(1);
      expect(contract.stdout).toContain("next_action_status_mismatch:run_sheets_rule_safety_audit");
    });
  });
});
