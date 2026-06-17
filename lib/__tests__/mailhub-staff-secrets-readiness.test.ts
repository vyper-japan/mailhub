import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawnSync } from "child_process";
import { describe, expect, test } from "vitest";

const staffSecretsPath = resolve(process.cwd(), "scripts/check-mailhub-staff-secrets.mjs");
const staffSecretContractPath = resolve(process.cwd(), "scripts/check-mailhub-staff-secret-readiness-contract.mjs");
const staffGithubSetupPath = resolve(process.cwd(), "scripts/setup-mailhub-staff-github-config.mjs");

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

function runNodeScript(scriptPath: string, args: string[], env: Partial<NodeJS.ProcessEnv> = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

const staffConfigEnvKeys = [
  "MAILHUB_ENV",
  "NEXTAUTH_URL",
  "NEXTAUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_SHARED_INBOX_EMAIL",
  "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
  "MAILHUB_ADMINS",
  "MAILHUB_TEAM_MEMBERS",
  "MAILHUB_CONFIG_STORE",
  "MAILHUB_ACTIVITY_STORE",
  "MAILHUB_SHEETS_ID",
  "MAILHUB_SHEETS_SPREADSHEET_ID",
  "MAILHUB_SHEETS_CLIENT_EMAIL",
  "MAILHUB_SHEETS_PRIVATE_KEY",
  "MAILHUB_READ_ONLY",
  "MAILHUB_SHEETS_TAB_RULES",
  "MAILHUB_SHEETS_TAB_ASSIGNEE_RULES",
];

const clearedStaffConfigEnv = Object.fromEntries(staffConfigEnvKeys.map((key) => [key, ""]));

const completeStaffEnv = {
  ...clearedStaffConfigEnv,
  MAILHUB_ENV: "production",
  NEXTAUTH_URL: "https://mailhub.example.com",
  NEXTAUTH_SECRET: "nextauth-secret-value",
  GOOGLE_CLIENT_ID: "google-client-id-value",
  GOOGLE_CLIENT_SECRET: "google-client-secret-value",
  GOOGLE_SHARED_INBOX_EMAIL: "mailhub@example.com",
  GOOGLE_SHARED_INBOX_REFRESH_TOKEN: "refresh-token-value",
  MAILHUB_ADMINS: "Admin <admin@example.com>",
  MAILHUB_TEAM_MEMBERS: "Staff <staff@example.com>",
  MAILHUB_CONFIG_STORE: "sheets",
  MAILHUB_ACTIVITY_STORE: "sheets",
  MAILHUB_SHEETS_ID: "sheet-id-value",
  MAILHUB_SHEETS_CLIENT_EMAIL: "svc@example.iam.gserviceaccount.com",
  MAILHUB_SHEETS_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n",
  MAILHUB_READ_ONLY: "1",
  MAILHUB_SHEETS_TAB_RULES: "ConfigRules",
};

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
    { name: "MAILHUB_ENV", value: "production" },
    { name: "NEXTAUTH_URL", value: "https://mailhub.example.com" },
    { name: "MAILHUB_ADMINS", value: "Admin <admin@example.com>" },
    { name: "MAILHUB_TEAM_MEMBERS", value: "Staff <staff@example.com>" },
    { name: "MAILHUB_CONFIG_STORE", value: "sheets" },
    { name: "MAILHUB_ACTIVITY_STORE", value: "sheets" },
    { name: "MAILHUB_SHEETS_ID", value: "sheet-id-value" },
    { name: "MAILHUB_SHEETS_CLIENT_EMAIL", value: "svc@example.iam.gserviceaccount.com" },
    { name: "MAILHUB_READ_ONLY", value: "1" },
    { name: "MAILHUB_SHEETS_TAB_RULES", value: "ConfigRules" },
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
        setupCommands: string[];
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
      expect(out.setupCommands).toEqual([
        "npm run setup:mailhub-staff-github-config",
        "npm run setup:mailhub-staff-github-config -- --apply",
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
        semanticIssues: string[];
        setupCommands: string[];
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
      expect(out.semanticIssues).toEqual([]);
      expect(out.setupCommands).toEqual([]);
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

  test("rejects present GitHub variables with unverified or non-production semantic values", () => {
    withTempDir((dir) => {
      const configPath = join(dir, "github-config.json");
      const outPath = join(dir, "github-staff-secrets-readiness.json");
      writeJson(configPath, {
        ...completeConfig,
        variables: [
          { name: "MAILHUB_ENV", value: "development" },
          { name: "NEXTAUTH_URL", value: "https://mailhub.example.com" },
          { name: "MAILHUB_ADMINS", value: "Admin <admin@example.com>" },
          { name: "MAILHUB_TEAM_MEMBERS", value: "Staff <staff@example.com>" },
          { name: "MAILHUB_CONFIG_STORE", value: "file" },
          { name: "MAILHUB_ACTIVITY_STORE" },
          { name: "MAILHUB_SHEETS_ID", value: "sheet-id-value" },
          { name: "MAILHUB_SHEETS_CLIENT_EMAIL", value: "svc@example.iam.gserviceaccount.com" },
          { name: "MAILHUB_READ_ONLY", value: "0" },
        ],
      });

      const audit = runNodeScript(staffSecretsPath, ["--config-json", configPath, "--out", outPath, "--no-fail"]);

      expect(audit.status).toBe(0);
      const out = readJson<{
        readyForProductionStaffPreflight: boolean;
        missingProductionStaffConfig: string[];
        missingSecretConfig: string[];
        semanticIssues: string[];
        setupCommands: string[];
      }>(outPath);
      expect(out.readyForProductionStaffPreflight).toBe(false);
      expect(out.missingProductionStaffConfig).toEqual([]);
      expect(out.missingSecretConfig).toEqual([]);
      expect(out.semanticIssues).toEqual([
        "MAILHUB_ENV_must_be_production",
        "MAILHUB_CONFIG_STORE_must_be_sheets",
        "MAILHUB_ACTIVITY_STORE_value_unverified",
        "MAILHUB_READ_ONLY_must_be_1",
      ]);
      expect(out.setupCommands).toEqual([
        "npm run setup:mailhub-staff-github-config",
        "npm run setup:mailhub-staff-github-config -- --apply",
      ]);

      const contract = runNodeScript(staffSecretContractPath, ["--artifact", outPath, "--allow-non-github-source"]);
      expect(contract.status).toBe(0);
      expect(contract.stdout).toContain('"ok": true');
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

  test("contract rejects ready staff config artifacts from the parent commit", () => {
    withTempDir((dir) => {
      const configPath = join(dir, "github-config.json");
      const outPath = join(dir, "github-staff-secrets-readiness.json");
      writeJson(configPath, completeConfig);

      const audit = runNodeScript(staffSecretsPath, ["--config-json", configPath, "--out", outPath]);
      expect(audit.status).toBe(0);
      const artifact = readJson<Record<string, unknown>>(outPath);
      writeJson(outPath, {
        ...artifact,
        source: "github_actions_config",
        repoHead: "parent123",
      });

      const contract = runNodeScript(staffSecretContractPath, [
        "--artifact",
        outPath,
        "--repo-head",
        "head123",
        "--repo-parent-head",
        "parent123",
      ]);
      expect(contract.status).toBe(1);
      expect(contract.stdout).toContain("ready_staff_config_requires_current_repo_head");
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

  test("staff GitHub setup dry-run reports missing names without printing values", () => {
    withTempDir((dir) => {
      const envPath = join(dir, "empty.env");
      writeFileSync(envPath, "", "utf8");

      const result = runNodeScript(
        staffGithubSetupPath,
        ["--staff-env-file", envPath],
        clearedStaffConfigEnv,
      );

      expect(result.status).toBe(0);
      const out = JSON.parse(result.stdout) as {
        readyToApply: boolean;
        missingRequiredEnv: string[];
        secretNamesToSet: string[];
        variableNamesToSet: string[];
      };
      expect(out.readyToApply).toBe(false);
      expect(out.secretNamesToSet).toEqual([]);
      expect(out.variableNamesToSet).toEqual([]);
      expect(out.missingRequiredEnv).toContain("NEXTAUTH_SECRET");
      expect(out.missingRequiredEnv).toContain("MAILHUB_SHEETS_ID or MAILHUB_SHEETS_SPREADSHEET_ID");
      expect(result.stdout).not.toContain("nextauth-secret-value");
      expect(result.stdout).not.toContain("BEGIN PRIVATE KEY");
    });
  });

  test("staff GitHub setup blocks semantic production mistakes", () => {
    withTempDir((dir) => {
      const envPath = join(dir, "staff.env");
      writeFileSync(envPath, "", "utf8");

      const result = runNodeScript(
        staffGithubSetupPath,
        ["--staff-env-file", envPath],
        {
          ...completeStaffEnv,
          MAILHUB_ENV: "development",
          MAILHUB_CONFIG_STORE: "file",
          MAILHUB_READ_ONLY: "0",
        },
      );

      expect(result.status).toBe(0);
      const out = JSON.parse(result.stdout) as {
        readyToApply: boolean;
        missingRequiredEnv: string[];
        semanticIssues: string[];
      };
      expect(out.readyToApply).toBe(false);
      expect(out.missingRequiredEnv).toEqual([]);
      expect(out.semanticIssues).toEqual([
        "MAILHUB_ENV_must_be_production",
        "MAILHUB_CONFIG_STORE_must_be_sheets",
        "MAILHUB_READ_ONLY_must_be_1",
      ]);
      expect(result.stdout).not.toContain("nextauth-secret-value");
      expect(result.stdout).not.toContain("BEGIN PRIVATE KEY");
    });
  });

  test("staff GitHub setup applies secrets and variables through gh without printing values", () => {
    withTempDir((dir) => {
      const envPath = join(dir, "staff.env");
      const ghLog = join(dir, "gh.log");
      const fakeGh = join(dir, "gh");
      writeFileSync(envPath, "", "utf8");
      writeFileSync(fakeGh, `#!/bin/sh
printf '%s\\n' "$1 $2 $3 $4 $5 $6 $7" >> "${ghLog}"
cat >/dev/null
`, "utf8");
      chmodSync(fakeGh, 0o755);

      const result = runNodeScript(
        staffGithubSetupPath,
        ["--staff-env-file", envPath, "--apply"],
        {
          ...completeStaffEnv,
          MAILHUB_GH_BIN: fakeGh,
        },
      );

      expect(result.status).toBe(0);
      const out = JSON.parse(result.stdout) as {
        readyToApply: boolean;
        appliedSecretNames: string[];
        appliedVariableNames: string[];
      };
      expect(out.readyToApply).toBe(true);
      expect(out.appliedSecretNames).toEqual([
        "NEXTAUTH_SECRET",
        "GOOGLE_CLIENT_SECRET",
        "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
        "MAILHUB_SHEETS_PRIVATE_KEY",
      ]);
      expect(out.appliedVariableNames).toContain("MAILHUB_ENV");
      expect(out.appliedVariableNames).toContain("MAILHUB_SHEETS_ID");
      expect(out.appliedVariableNames).toContain("MAILHUB_SHEETS_TAB_RULES");
      expect(result.stdout).not.toContain("nextauth-secret-value");
      expect(result.stdout).not.toContain("BEGIN PRIVATE KEY");
      const log = readFileSync(ghLog, "utf8");
      expect(log).toContain("secret set NEXTAUTH_SECRET --repo vyper-japan/mailhub --app");
      expect(log).toContain("variable set MAILHUB_ENV --repo vyper-japan/mailhub --body");
      expect(log).not.toContain("nextauth-secret-value");
      expect(log).not.toContain("BEGIN PRIVATE KEY");
    });
  });
});
