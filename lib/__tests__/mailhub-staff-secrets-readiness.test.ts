import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawnSync } from "child_process";
import { describe, expect, test } from "vitest";

const staffSecretsPath = resolve(process.cwd(), "scripts/check-mailhub-staff-secrets.mjs");
const staffSecretContractPath = resolve(process.cwd(), "scripts/check-mailhub-staff-secret-readiness-contract.mjs");

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "mailhub-staff-secrets-"));
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

function runNodeScript(scriptPath: string, args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env },
  });
}

const completeConfig = {
  secrets: [
    { name: "NEXTAUTH_SECRET" },
    { name: "GOOGLE_CLIENT_ID" },
    { name: "GOOGLE_CLIENT_SECRET" },
    { name: "GOOGLE_SHARED_INBOX_EMAIL" },
    { name: "GOOGLE_SHARED_INBOX_REFRESH_TOKEN" },
    { name: "MAILHUB_SHEETS_PRIVATE_KEY" },
  ],
  variables: [
    { name: "MAILHUB_ENV" },
    { name: "NEXTAUTH_URL" },
    { name: "MAILHUB_ADMINS" },
    { name: "MAILHUB_TEAM_MEMBERS" },
    { name: "MAILHUB_CONFIG_STORE" },
    { name: "MAILHUB_ACTIVITY_STORE" },
    { name: "MAILHUB_SHEETS_ID" },
    { name: "MAILHUB_SHEETS_CLIENT_EMAIL" },
    { name: "MAILHUB_READ_ONLY" },
    { name: "MAILHUB_SHEETS_TAB_RULES" },
  ],
};

describe("MailHub staff GitHub config readiness", () => {
  test("reports missing production staff config without printing values", () => {
    withTempDir((dir) => {
      const configPath = join(dir, "github-config.json");
      writeJson(configPath, { secrets: [], variables: [] });

      const result = runNodeScript(staffSecretsPath, ["--config-json", configPath, "--no-fail"]);

      expect(result.status).toBe(0);
      const out = JSON.parse(result.stdout) as {
        readyForProductionStaffPreflight: boolean;
        readyForSecretBackedStaffConfig: boolean;
        missingProductionStaffConfig: string[];
        missingSecretConfig: string[];
        secretGroups: { sheetsConfig: { missing: string[]; ready: boolean } };
        note: string;
      };
      expect(out.readyForProductionStaffPreflight).toBe(false);
      expect(out.readyForSecretBackedStaffConfig).toBe(false);
      expect(out.missingProductionStaffConfig).toContain("MAILHUB_ENV");
      expect(out.missingProductionStaffConfig).toContain("MAILHUB_TEAM_MEMBERS");
      expect(out.missingProductionStaffConfig).toContain("MAILHUB_SHEETS_ID or MAILHUB_SHEETS_SPREADSHEET_ID");
      expect(out.missingSecretConfig).toEqual([
        "NEXTAUTH_SECRET",
        "GOOGLE_CLIENT_SECRET",
        "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
        "MAILHUB_SHEETS_PRIVATE_KEY",
      ]);
      expect(out.secretGroups.sheetsConfig).toMatchObject({
        ready: false,
        missing: [
          "MAILHUB_SHEETS_ID or MAILHUB_SHEETS_SPREADSHEET_ID",
          "MAILHUB_SHEETS_CLIENT_EMAIL",
          "MAILHUB_SHEETS_PRIVATE_KEY",
        ],
      });
      expect(result.stdout).not.toContain("BEGIN PRIVATE KEY");
      expect(out.note).toContain("values are never accessible or printed");
    });
  });

  test("accepts GitHub variables plus secrets and records source names only", () => {
    withTempDir((dir) => {
      const configPath = join(dir, "github-config.json");
      const outPath = join(dir, "github-staff-secrets-readiness.json");
      writeJson(configPath, completeConfig);

      const result = runNodeScript(staffSecretsPath, ["--config-json", configPath, "--out", outPath]);

      expect(result.status).toBe(0);
      const out = readJson<{
        readyForProductionStaffPreflight: boolean;
        readyForSecretBackedStaffConfig: boolean;
        missingProductionStaffConfig: string[];
        missingSecretConfig: string[];
        configuredOptionalRuleSheetConfig: string[];
        presentRequiredConfigSources: Record<string, string>;
        secretGroups: {
          sheetsConfig: { ready: boolean; present: string[] };
          sensitiveSecrets: { ready: boolean; present: string[] };
        };
      }>(outPath);
      expect(out.readyForProductionStaffPreflight).toBe(true);
      expect(out.readyForSecretBackedStaffConfig).toBe(true);
      expect(out.missingProductionStaffConfig).toEqual([]);
      expect(out.missingSecretConfig).toEqual([]);
      expect(out.configuredOptionalRuleSheetConfig).toEqual(["MAILHUB_SHEETS_TAB_RULES"]);
      expect(out.presentRequiredConfigSources.MAILHUB_SHEETS_ID).toBe("variable");
      expect(out.presentRequiredConfigSources.MAILHUB_SHEETS_PRIVATE_KEY).toBe("secret");
      expect(out.secretGroups.sheetsConfig).toMatchObject({
        ready: true,
        present: [
          "MAILHUB_SHEETS_ID or MAILHUB_SHEETS_SPREADSHEET_ID",
          "MAILHUB_SHEETS_CLIENT_EMAIL",
          "MAILHUB_SHEETS_PRIVATE_KEY",
        ],
      });
      expect(out.secretGroups.sensitiveSecrets).toMatchObject({
        ready: true,
        present: [
          "NEXTAUTH_SECRET",
          "GOOGLE_CLIENT_SECRET",
          "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
          "MAILHUB_SHEETS_PRIVATE_KEY",
        ],
      });
    });
  });

  test("rejects sensitive staff config when supplied as variables", () => {
    withTempDir((dir) => {
      const configPath = join(dir, "github-config.json");
      const outPath = join(dir, "github-staff-secrets-readiness.json");
      writeJson(configPath, {
        secrets: [],
        variables: [
          { name: "MAILHUB_ENV" },
          { name: "NEXTAUTH_URL" },
          { name: "NEXTAUTH_SECRET" },
          { name: "GOOGLE_CLIENT_ID" },
          { name: "GOOGLE_CLIENT_SECRET" },
          { name: "GOOGLE_SHARED_INBOX_EMAIL" },
          { name: "GOOGLE_SHARED_INBOX_REFRESH_TOKEN" },
          { name: "MAILHUB_ADMINS" },
          { name: "MAILHUB_TEAM_MEMBERS" },
          { name: "MAILHUB_CONFIG_STORE" },
          { name: "MAILHUB_ACTIVITY_STORE" },
          { name: "MAILHUB_SHEETS_ID" },
          { name: "MAILHUB_SHEETS_CLIENT_EMAIL" },
          { name: "MAILHUB_SHEETS_PRIVATE_KEY" },
          { name: "MAILHUB_READ_ONLY" },
        ],
      });

      const audit = runNodeScript(staffSecretsPath, ["--config-json", configPath, "--out", outPath, "--no-fail"]);

      expect(audit.status).toBe(0);
      const out = readJson<{
        readyForProductionStaffPreflight: boolean;
        readyForSecretBackedStaffConfig: boolean;
        missingProductionStaffConfig: string[];
        missingSecretConfig: string[];
      }>(outPath);
      expect(out.readyForProductionStaffPreflight).toBe(false);
      expect(out.readyForSecretBackedStaffConfig).toBe(false);
      expect(out.missingProductionStaffConfig).toEqual([]);
      expect(out.missingSecretConfig).toEqual([
        "NEXTAUTH_SECRET",
        "GOOGLE_CLIENT_SECRET",
        "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
        "MAILHUB_SHEETS_PRIVATE_KEY",
      ]);

      const contract = runNodeScript(staffSecretContractPath, ["--artifact", outPath]);
      expect(contract.status).toBe(1);
      expect(contract.stdout).toContain("secret_config_non_secret_source:NEXTAUTH_SECRET");
    });
  });

  test("contract accepts generated staff config readiness artifact", () => {
    withTempDir((dir) => {
      const configPath = join(dir, "github-config.json");
      const outPath = join(dir, "github-staff-secrets-readiness.json");
      writeJson(configPath, completeConfig);

      const audit = runNodeScript(staffSecretsPath, ["--config-json", configPath, "--out", outPath]);
      expect(audit.status).toBe(0);

      const contract = runNodeScript(staffSecretContractPath, ["--artifact", outPath, "--allow-non-github-source"]);
      expect(contract.status).toBe(0);
      expect(contract.stdout).toContain('"ok": true');
    });
  });

  test("contract rejects production staff readiness artifacts from JSON sources by default", () => {
    withTempDir((dir) => {
      const configPath = join(dir, "github-config.json");
      const outPath = join(dir, "github-staff-secrets-readiness.json");
      writeJson(configPath, completeConfig);

      const audit = runNodeScript(staffSecretsPath, ["--config-json", configPath, "--out", outPath]);
      expect(audit.status).toBe(0);

      const contract = runNodeScript(staffSecretContractPath, ["--artifact", outPath]);
      expect(contract.status).toBe(1);
      expect(contract.stdout).toContain("production_staff_config_source_not_github_actions");
    });
  });

  test("contract rejects ready artifacts without source provenance", () => {
    withTempDir((dir) => {
      const configPath = join(dir, "github-config.json");
      const outPath = join(dir, "github-staff-secrets-readiness.json");
      writeJson(configPath, completeConfig);

      const audit = runNodeScript(staffSecretsPath, ["--config-json", configPath, "--out", outPath]);
      expect(audit.status).toBe(0);
      const artifact = readJson<Record<string, unknown>>(outPath);
      writeJson(outPath, {
        ...artifact,
        secretCount: 0,
        variableCount: 0,
        presentRequiredConfigSources: {},
      });

      const contract = runNodeScript(staffSecretContractPath, ["--artifact", outPath, "--allow-non-github-source"]);
      expect(contract.status).toBe(1);
      expect(contract.stdout).toContain("present_required_config_missing_source:NEXTAUTH_SECRET");
      expect(contract.stdout).toContain("missing_secret_config_mismatch");
    });
  });
});
