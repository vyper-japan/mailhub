import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawnSync } from "child_process";
import { describe, expect, test } from "vitest";

const staffSecretsPath = resolve(process.cwd(), "scripts/check-mailhub-staff-secrets.mjs");
const staffSecretContractPath = resolve(process.cwd(), "scripts/check-mailhub-staff-secret-readiness-contract.mjs");
const staffGithubSetupPath = resolve(process.cwd(), "scripts/setup-mailhub-staff-github-config.mjs");
const productionConfigRequestPath = resolve(process.cwd(), "scripts/write-mailhub-production-config-request.mjs");

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

function runNodeScript(scriptPath: string, args: string[], env: Partial<NodeJS.ProcessEnv> = {}, cwd = process.cwd()) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function runGit(cwd: string, args: string[]) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function createArtifactOnlyRefreshRepo(dir: string) {
  runGit(dir, ["init"]);
  runGit(dir, ["config", "user.email", "mailhub-test@example.com"]);
  runGit(dir, ["config", "user.name", "MailHub Test"]);
  runGit(dir, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(dir, "app.txt"), "base\n", "utf8");
  runGit(dir, ["add", "app.txt"]);
  runGit(dir, ["commit", "-m", "base"]);
  const repoParentHead = runGit(dir, ["rev-parse", "HEAD"]);

  const artifactDir = join(dir, ".ai-runs", "mailhub-next-phase");
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, "refresh.json"), "{}\n", "utf8");
  runGit(dir, ["add", ".ai-runs/mailhub-next-phase/refresh.json"]);
  runGit(dir, ["commit", "-m", "artifact refresh"]);
  const repoHead = runGit(dir, ["rev-parse", "HEAD"]);
  return { repoHead, repoParentHead };
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
  GOOGLE_SHARED_INBOX_EMAIL: "mailhub@vtj.co.jp",
  GOOGLE_SHARED_INBOX_REFRESH_TOKEN: "refresh-token-value",
  MAILHUB_ADMINS: "Admin <admin@vtj.co.jp>",
  MAILHUB_TEAM_MEMBERS: "Staff <staff@vtj.co.jp>",
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
    { name: "GOOGLE_CLIENT_ID", value: "google-client-id-value" },
    { name: "GOOGLE_SHARED_INBOX_EMAIL", value: "mailhub@vtj.co.jp" },
    { name: "MAILHUB_ADMINS", value: "Admin <admin@vtj.co.jp>" },
    { name: "MAILHUB_TEAM_MEMBERS", value: "Staff <staff@vtj.co.jp>" },
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
        "npm run setup:mailhub-staff-github-config -- --apply --confirm-apply APPLY_MAILHUB_STAFF_GITHUB_CONFIG",
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
      expect(out.presentRequiredConfigSources.GOOGLE_CLIENT_ID).toBe("variable");
      expect(out.presentRequiredConfigSources.GOOGLE_SHARED_INBOX_EMAIL).toBe("variable");
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

  test("rejects public runtime staff config supplied only as secrets", () => {
    withTempDir((dir) => {
      const configPath = join(dir, "github-config.json");
      const outPath = join(dir, "github-staff-secrets-readiness.json");
      writeJson(configPath, {
        secrets: completeConfig.secrets,
        variables: completeConfig.variables.filter((item) => ![
          "GOOGLE_CLIENT_ID",
          "GOOGLE_SHARED_INBOX_EMAIL",
        ].includes(item.name)),
      });

      const result = runNodeScript(staffSecretsPath, ["--config-json", configPath, "--out", outPath, "--no-fail"]);

      expect(result.status).toBe(0);
      const out = readJson<{
        readyForProductionStaffPreflight: boolean;
        missingProductionStaffConfig: string[];
        semanticIssues: string[];
        presentRequiredConfigSources: Record<string, string>;
      }>(outPath);
      expect(out.readyForProductionStaffPreflight).toBe(false);
      expect(out.missingProductionStaffConfig).toContain("GOOGLE_CLIENT_ID");
      expect(out.missingProductionStaffConfig).toContain("GOOGLE_SHARED_INBOX_EMAIL");
      expect(out.semanticIssues).toEqual([
        "GOOGLE_CLIENT_ID_must_be_variable",
        "GOOGLE_SHARED_INBOX_EMAIL_must_be_variable",
      ]);
      expect(out.presentRequiredConfigSources.GOOGLE_CLIENT_ID).toBeUndefined();
      expect(out.presentRequiredConfigSources.GOOGLE_SHARED_INBOX_EMAIL).toBeUndefined();

      const contract = runNodeScript(staffSecretContractPath, ["--artifact", outPath, "--allow-non-github-source"]);
      expect(contract.status).toBe(0);
      expect(contract.stdout).toContain('"ok": true');
    });
  });

  test("rejects invalid and non-vtj staff email list variables without printing values", () => {
    withTempDir((dir) => {
      const configPath = join(dir, "github-config.json");
      const outPath = join(dir, "github-staff-secrets-readiness.json");
      writeJson(configPath, {
        ...completeConfig,
        variables: completeConfig.variables.map((item) => {
          if (item.name === "MAILHUB_ADMINS") return { ...item, value: "Admin <admin@example.com>" };
          if (item.name === "MAILHUB_TEAM_MEMBERS") return { ...item, value: "bad-team-member" };
          return item;
        }),
      });

      const result = runNodeScript(staffSecretsPath, ["--config-json", configPath, "--out", outPath, "--no-fail"]);

      expect(result.status).toBe(0);
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
        "MAILHUB_ADMINS_has_non_vtj_email",
        "MAILHUB_TEAM_MEMBERS_has_invalid_email",
      ]);
      expect(out.setupCommands).toEqual([
        "npm run setup:mailhub-staff-github-config",
        "npm run setup:mailhub-staff-github-config -- --apply --confirm-apply APPLY_MAILHUB_STAFF_GITHUB_CONFIG",
      ]);
      expect(result.stdout).not.toContain("admin@example.com");
      expect(result.stdout).not.toContain("bad-team-member");
      expect(readFileSync(outPath, "utf8")).not.toContain("admin@example.com");
      expect(readFileSync(outPath, "utf8")).not.toContain("bad-team-member");

      const contract = runNodeScript(staffSecretContractPath, ["--artifact", outPath, "--allow-non-github-source"]);
      expect(contract.status).toBe(0);
      expect(contract.stdout).toContain('"ok": true');
    });
  });

  test("rejects blank or unverified staff email list variables as known semantic issues", () => {
    withTempDir((dir) => {
      const configPath = join(dir, "github-config.json");
      const outPath = join(dir, "github-staff-secrets-readiness.json");
      writeJson(configPath, {
        ...completeConfig,
        variables: completeConfig.variables.map((item) => {
          if (item.name === "MAILHUB_ADMINS") return { ...item, value: "" };
          if (item.name === "MAILHUB_TEAM_MEMBERS") return { name: "MAILHUB_TEAM_MEMBERS" };
          return item;
        }),
      });

      const result = runNodeScript(staffSecretsPath, ["--config-json", configPath, "--out", outPath, "--no-fail"]);

      expect(result.status).toBe(0);
      const out = readJson<{
        readyForProductionStaffPreflight: boolean;
        semanticIssues: string[];
      }>(outPath);
      expect(out.readyForProductionStaffPreflight).toBe(false);
      expect(out.semanticIssues).toEqual([
        "MAILHUB_ADMINS_must_be_non_empty_vtj_email_list",
        "MAILHUB_TEAM_MEMBERS_value_unverified",
      ]);

      const contract = runNodeScript(staffSecretContractPath, ["--artifact", outPath, "--allow-non-github-source"]);
      expect(contract.status).toBe(0);
      expect(contract.stdout).toContain('"ok": true');
    });
  });

  test("rejects staff email lists supplied only as secrets", () => {
    withTempDir((dir) => {
      const configPath = join(dir, "github-config.json");
      const outPath = join(dir, "github-staff-secrets-readiness.json");
      writeJson(configPath, {
        secrets: [
          ...completeConfig.secrets,
          { name: "MAILHUB_ADMINS" },
          { name: "MAILHUB_TEAM_MEMBERS" },
        ],
        variables: completeConfig.variables.filter((item) => ![
          "MAILHUB_ADMINS",
          "MAILHUB_TEAM_MEMBERS",
        ].includes(item.name)),
      });

      const result = runNodeScript(staffSecretsPath, ["--config-json", configPath, "--out", outPath, "--no-fail"]);

      expect(result.status).toBe(0);
      const out = readJson<{
        readyForProductionStaffPreflight: boolean;
        semanticIssues: string[];
        presentRequiredConfigSources: Record<string, string>;
      }>(outPath);
      expect(out.readyForProductionStaffPreflight).toBe(false);
      expect(out.semanticIssues).toEqual([
        "MAILHUB_ADMINS_must_be_variable",
        "MAILHUB_TEAM_MEMBERS_must_be_variable",
      ]);
      expect(out.presentRequiredConfigSources.MAILHUB_ADMINS).toBeUndefined();
      expect(out.presentRequiredConfigSources.MAILHUB_TEAM_MEMBERS).toBeUndefined();

      const contract = runNodeScript(staffSecretContractPath, ["--artifact", outPath, "--allow-non-github-source"]);
      expect(contract.status).toBe(0);
      expect(contract.stdout).toContain('"ok": true');
    });
  });

  test("rejects semantic staff config values supplied only as secrets", () => {
    withTempDir((dir) => {
      const configPath = join(dir, "github-config.json");
      const outPath = join(dir, "github-staff-secrets-readiness.json");
      writeJson(configPath, {
        secrets: [
          ...completeConfig.secrets,
          { name: "MAILHUB_ENV" },
          { name: "MAILHUB_CONFIG_STORE" },
          { name: "MAILHUB_ACTIVITY_STORE" },
          { name: "MAILHUB_READ_ONLY" },
        ],
        variables: completeConfig.variables.filter((item) => ![
          "MAILHUB_ENV",
          "MAILHUB_CONFIG_STORE",
          "MAILHUB_ACTIVITY_STORE",
          "MAILHUB_READ_ONLY",
        ].includes(item.name)),
      });

      const result = runNodeScript(staffSecretsPath, ["--config-json", configPath, "--out", outPath, "--no-fail"]);

      expect(result.status).toBe(0);
      const out = readJson<{
        readyForProductionStaffPreflight: boolean;
        semanticIssues: string[];
        presentRequiredConfigSources: Record<string, string>;
      }>(outPath);
      expect(out.readyForProductionStaffPreflight).toBe(false);
      expect(out.semanticIssues).toEqual([
        "MAILHUB_ENV_must_be_variable",
        "MAILHUB_CONFIG_STORE_must_be_variable",
        "MAILHUB_ACTIVITY_STORE_must_be_variable",
        "MAILHUB_READ_ONLY_must_be_variable",
      ]);
      expect(out.presentRequiredConfigSources.MAILHUB_ENV).toBeUndefined();

      const contract = runNodeScript(staffSecretContractPath, ["--artifact", outPath, "--allow-non-github-source"]);
      expect(contract.status).toBe(0);
      expect(contract.stdout).toContain('"ok": true');
    });
  });

  test("rejects semantic staff config values duplicated as secrets and variables", () => {
    withTempDir((dir) => {
      const configPath = join(dir, "github-config.json");
      const outPath = join(dir, "github-staff-secrets-readiness.json");
      writeJson(configPath, {
        secrets: [
          ...completeConfig.secrets,
          { name: "MAILHUB_ENV" },
          { name: "MAILHUB_CONFIG_STORE" },
          { name: "MAILHUB_ACTIVITY_STORE" },
          { name: "MAILHUB_READ_ONLY" },
        ],
        variables: completeConfig.variables,
      });

      const result = runNodeScript(staffSecretsPath, ["--config-json", configPath, "--out", outPath, "--no-fail"]);

      expect(result.status).toBe(0);
      const out = readJson<{
        readyForProductionStaffPreflight: boolean;
        semanticIssues: string[];
        setupCommands: string[];
        presentRequiredConfigSources: Record<string, string>;
      }>(outPath);
      expect(out.readyForProductionStaffPreflight).toBe(false);
      expect(out.semanticIssues).toEqual([
        "MAILHUB_ENV_must_be_variable",
        "MAILHUB_CONFIG_STORE_must_be_variable",
        "MAILHUB_ACTIVITY_STORE_must_be_variable",
        "MAILHUB_READ_ONLY_must_be_variable",
      ]);
      expect(out.setupCommands).toEqual([
        "npm run setup:mailhub-staff-github-config",
        "npm run setup:mailhub-staff-github-config -- --apply --confirm-apply APPLY_MAILHUB_STAFF_GITHUB_CONFIG",
      ]);
      expect(out.presentRequiredConfigSources.MAILHUB_ENV).toBe("variable");

      const contract = runNodeScript(staffSecretContractPath, ["--artifact", outPath, "--allow-non-github-source"]);
      expect(contract.status).toBe(0);
      expect(contract.stdout).toContain('"ok": true');
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
      expect(out.missingProductionStaffConfig).toEqual([
        "NEXTAUTH_SECRET",
        "GOOGLE_CLIENT_SECRET",
        "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
        "MAILHUB_SHEETS_PRIVATE_KEY",
      ]);
      expect(out.missingSecretConfig).toEqual([
        "NEXTAUTH_SECRET",
        "GOOGLE_CLIENT_SECRET",
        "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
        "MAILHUB_SHEETS_PRIVATE_KEY",
      ]);

      const contract = runNodeScript(staffSecretContractPath, ["--artifact", outPath, "--allow-non-github-source"]);
      expect(contract.status).toBe(0);
      expect(contract.stdout).toContain('"ok": true');
    });
  });

  test("rejects sensitive staff config duplicated as secrets and variables without printing values", () => {
    withTempDir((dir) => {
      const configPath = join(dir, "github-config.json");
      const outPath = join(dir, "github-staff-secrets-readiness.json");
      const duplicatedSensitiveVariables = [
        { name: "NEXTAUTH_SECRET", value: "variable-nextauth-secret-value" },
        { name: "GOOGLE_CLIENT_SECRET", value: "variable-google-client-secret-value" },
        { name: "GOOGLE_SHARED_INBOX_REFRESH_TOKEN", value: "variable-refresh-token-value" },
        { name: "MAILHUB_SHEETS_PRIVATE_KEY", value: "variable-private-key-value" },
      ];
      writeJson(configPath, {
        secrets: completeConfig.secrets,
        variables: [
          ...completeConfig.variables,
          ...duplicatedSensitiveVariables,
        ],
      });

      const audit = runNodeScript(staffSecretsPath, ["--config-json", configPath, "--out", outPath, "--no-fail"]);

      expect(audit.status).toBe(0);
      const out = readJson<{
        readyForProductionStaffPreflight: boolean;
        readyForSecretBackedStaffConfig: boolean;
        missingProductionStaffConfig: string[];
        missingSecretConfig: string[];
        semanticIssues: string[];
        setupCommands: string[];
        presentRequiredConfigSources: Record<string, string>;
      }>(outPath);
      expect(out.readyForProductionStaffPreflight).toBe(false);
      expect(out.readyForSecretBackedStaffConfig).toBe(false);
      expect(out.missingProductionStaffConfig).toEqual([]);
      expect(out.missingSecretConfig).toEqual([]);
      expect(out.semanticIssues).toEqual([
        "NEXTAUTH_SECRET_must_not_be_variable",
        "GOOGLE_CLIENT_SECRET_must_not_be_variable",
        "GOOGLE_SHARED_INBOX_REFRESH_TOKEN_must_not_be_variable",
        "MAILHUB_SHEETS_PRIVATE_KEY_must_not_be_variable",
      ]);
      expect(out.setupCommands).toEqual([
        "npm run setup:mailhub-staff-github-config",
        "npm run setup:mailhub-staff-github-config -- --apply --confirm-apply APPLY_MAILHUB_STAFF_GITHUB_CONFIG",
      ]);
      expect(out.presentRequiredConfigSources.NEXTAUTH_SECRET).toBe("secret");
      for (const variable of duplicatedSensitiveVariables) {
        expect(audit.stdout).not.toContain(variable.value);
        expect(readFileSync(outPath, "utf8")).not.toContain(variable.value);
      }

      const contract = runNodeScript(staffSecretContractPath, ["--artifact", outPath, "--allow-non-github-source"]);
      expect(contract.status).toBe(1);
      expect(contract.stdout).toContain("sensitive_secret_config_present_as_variable:NEXTAUTH_SECRET");
      expect(contract.stdout).toContain("sensitive_secret_config_present_as_variable:GOOGLE_CLIENT_SECRET");
      expect(contract.stdout).toContain("sensitive_secret_config_present_as_variable:GOOGLE_SHARED_INBOX_REFRESH_TOKEN");
      expect(contract.stdout).toContain("sensitive_secret_config_present_as_variable:MAILHUB_SHEETS_PRIVATE_KEY");
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
          { name: "NEXTAUTH_URL", value: "http://localhost:3000" },
          { name: "GOOGLE_CLIENT_ID", value: "google-client-id-value" },
          { name: "GOOGLE_SHARED_INBOX_EMAIL", value: "mailhub@vtj.co.jp" },
          { name: "MAILHUB_ADMINS", value: "Admin <admin@vtj.co.jp>" },
          { name: "MAILHUB_TEAM_MEMBERS", value: "Staff <staff@vtj.co.jp>" },
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
        "NEXTAUTH_URL_must_be_https",
        "NEXTAUTH_URL_must_not_be_localhost",
      ]);
      expect(out.setupCommands).toEqual([
        "npm run setup:mailhub-staff-github-config",
        "npm run setup:mailhub-staff-github-config -- --apply --confirm-apply APPLY_MAILHUB_STAFF_GITHUB_CONFIG",
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

  test("contract accepts ready staff config artifacts from an artifact-only parent refresh", () => {
    withTempDir((dir) => {
      const { repoHead, repoParentHead } = createArtifactOnlyRefreshRepo(dir);
      const configPath = join(dir, "github-config.json");
      const outPath = join(dir, "github-staff-secrets-readiness.json");
      writeJson(configPath, completeConfig);

      const audit = runNodeScript(staffSecretsPath, ["--config-json", configPath, "--out", outPath], {}, dir);
      expect(audit.status).toBe(0);
      const artifact = readJson<Record<string, unknown>>(outPath);
      writeJson(outPath, {
        ...artifact,
        source: "github_actions_config",
        repoHead: repoParentHead,
      });

      const contract = runNodeScript(staffSecretContractPath, [
        "--artifact",
        outPath,
        "--repo-head",
        repoHead,
        "--repo-parent-head",
        repoParentHead,
      ], {}, dir);
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

  test("staff GitHub setup dry-run reports missing names without printing values", () => {
    withTempDir((dir) => {
      const envPath = join(dir, "empty.env");
      const planPath = join(dir, "staff-github-plan.json");
      writeFileSync(envPath, "", "utf8");

      const result = runNodeScript(
        staffGithubSetupPath,
        ["--staff-env-file", envPath, "--out", planPath],
        clearedStaffConfigEnv,
      );

      expect(result.status).toBe(0);
      const out = readJson<{
        readyToApply: boolean;
        missingRequiredEnv: string[];
        secretNamesToSet: string[];
        variableNamesToSet: string[];
      }>(planPath);
      expect(out.readyToApply).toBe(false);
      expect(out.secretNamesToSet).toEqual([]);
      expect(out.variableNamesToSet).toEqual([]);
      expect(out.missingRequiredEnv).toContain("NEXTAUTH_SECRET");
      expect(out.missingRequiredEnv).toContain("MAILHUB_SHEETS_ID or MAILHUB_SHEETS_SPREADSHEET_ID");
      expect(result.stdout).not.toContain("nextauth-secret-value");
      expect(result.stdout).not.toContain("BEGIN PRIVATE KEY");
      const planRaw = readFileSync(planPath, "utf8");
      expect(planRaw).not.toContain("nextauth-secret-value");
      expect(planRaw).not.toContain("BEGIN PRIVATE KEY");
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
          NEXTAUTH_URL: "http://localhost:3000",
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
        "NEXTAUTH_URL_must_be_https",
        "NEXTAUTH_URL_must_not_be_localhost",
        "MAILHUB_CONFIG_STORE_must_be_sheets",
        "MAILHUB_READ_ONLY_must_be_1",
      ]);
      expect(result.stdout).not.toContain("nextauth-secret-value");
      expect(result.stdout).not.toContain("BEGIN PRIVATE KEY");
    });
  });

  test("staff GitHub setup blocks invalid staff email lists before apply", () => {
    withTempDir((dir) => {
      const envPath = join(dir, "staff.env");
      writeFileSync(envPath, "", "utf8");

      const result = runNodeScript(
        staffGithubSetupPath,
        ["--staff-env-file", envPath],
        {
          ...completeStaffEnv,
          MAILHUB_ADMINS: "Admin <admin@example.com>",
          MAILHUB_TEAM_MEMBERS: "bad-team-member",
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
        "MAILHUB_ADMINS_must_be_non_empty_vtj_email_list",
        "MAILHUB_ADMINS_has_non_vtj_email",
        "MAILHUB_TEAM_MEMBERS_must_be_non_empty_vtj_email_list",
        "MAILHUB_TEAM_MEMBERS_has_invalid_email",
      ]);
      expect(result.stdout).not.toContain("admin@example.com");
      expect(result.stdout).not.toContain("bad-team-member");
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
        ["--staff-env-file", envPath, "--apply", "--confirm-apply", "APPLY_MAILHUB_STAFF_GITHUB_CONFIG"],
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

  test("staff GitHub setup requires confirmation token before apply", () => {
    withTempDir((dir) => {
      const envPath = join(dir, "staff.env");
      const ghLog = join(dir, "gh.log");
      const fakeGh = join(dir, "gh");
      writeFileSync(envPath, "", "utf8");
      writeFileSync(ghLog, "", "utf8");
      writeFileSync(fakeGh, `#!/bin/sh
printf 'called\\n' >> "${ghLog}"
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

      expect(result.status).toBe(2);
      const out = JSON.parse(result.stdout) as {
        readyToApply: boolean;
        errors: string[];
        appliedSecretNames: string[];
        appliedVariableNames: string[];
      };
      expect(out.readyToApply).toBe(true);
      expect(out.errors).toEqual(["missing_or_invalid_confirm_apply_token"]);
      expect(out.appliedSecretNames).toEqual([]);
      expect(out.appliedVariableNames).toEqual([]);
      expect(readFileSync(ghLog, "utf8")).toBe("");
    });
  });

  test("production config request writes a secret-free P0/P1 input plan", () => {
    withTempDir((dir) => {
      const runDir = join(dir, "run");
      const outPath = join(runDir, "mailhub-production-config-request.json");
      const markdownOutPath = join(runDir, "mailhub-production-config-intake.md");
      mkdirSync(runDir, { recursive: true });
      writeJson(join(runDir, "mailhub-production-readiness-audit.json"), {
        gate: {
          productionReady: false,
          p0Blockers: ["current_shared_gmail_routing"],
          p1Blockers: [
            "rule_config_source_not_production",
            "staff_workflow_permissions",
            "staff_github_config_not_ready",
          ],
        },
      });
      writeJson(join(runDir, "github-routing-secrets-readiness.json"), {
        secretGroups: {
          externalSmtpProof: {
            missing: [
              "MAILHUB_PROBE_SMTP_HOST",
              "MAILHUB_PROBE_SMTP_USER",
              "MAILHUB_PROBE_SMTP_PASS",
              "MAILHUB_PROBE_FROM",
            ],
          },
          gmailProof: {
            missing: ["GOOGLE_CLIENT_SECRET", "GOOGLE_SHARED_INBOX_REFRESH_TOKEN"],
          },
        },
      });
      writeJson(join(runDir, "github-staff-secrets-readiness.json"), {
        missingProductionStaffConfig: ["MAILHUB_TEAM_MEMBERS", "MAILHUB_SHEETS_ID or MAILHUB_SHEETS_SPREADSHEET_ID"],
        missingSecretConfig: ["MAILHUB_SHEETS_PRIVATE_KEY"],
      });
      writeJson(join(runDir, "mailhub-rule-config-next-steps.json"), {
        requiredActions: ["configure_sheets_rule_config_env", "verify_rule_sheets_tabs"],
      });
      writeJson(join(runDir, "mailhub-staff-workflow-next-steps.json"), {
        requiredActions: ["configure_staff_access_allowlist"],
      });

      const result = runNodeScript(productionConfigRequestPath, ["--run-dir", runDir, "--out", outPath, "--markdown-out", markdownOutPath]);

      expect(result.status).toBe(0);
      const out = readJson<{
        readiness: { productionReady: boolean; p0Blockers: string[]; p1Blockers: string[] };
        currentMissing: {
          externalSmtpSecrets: string[];
          routingGmailProofSecrets: string[];
          staffProductionConfig: string[];
          staffSecretConfig: string[];
          ruleRequiredActions: string[];
        };
        requiredInputs: {
          externalSmtpProof: { requiredGitHubSecrets: string[]; constraints: string[] };
          routingGmailProof: { requiredGitHubSecrets: string[]; constraints: string[] };
          staffGitHubConfig: { requiredGitHubVariables: string[]; requiredGitHubSecrets: string[] };
          sheetsRuleSource: { defaultRuleTabs: Record<string, string> };
          readOnlyRolloutEvidence: { requiredFiles: string[] };
        };
        safeCommands: { dryRun: string[] };
        approvalGatedActions: {
          id: string;
          sideEffect: string;
          requiresApproval: boolean;
          confirmationToken: string;
          commandAfterApproval: string;
          status: string;
        }[];
        valuePolicy: string;
      }>(outPath);
      expect(out.readiness.productionReady).toBe(false);
      expect(out.readiness.p0Blockers).toEqual(["current_shared_gmail_routing"]);
      expect(out.currentMissing.externalSmtpSecrets).toEqual([
        "MAILHUB_PROBE_SMTP_HOST",
        "MAILHUB_PROBE_SMTP_USER",
        "MAILHUB_PROBE_SMTP_PASS",
        "MAILHUB_PROBE_FROM",
      ]);
      expect(out.currentMissing.routingGmailProofSecrets).toEqual([
        "GOOGLE_CLIENT_SECRET",
        "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
      ]);
      expect(out.currentMissing.staffProductionConfig).toContain("MAILHUB_TEAM_MEMBERS");
      expect(out.currentMissing.staffSecretConfig).toEqual(["MAILHUB_SHEETS_PRIVATE_KEY"]);
      expect(out.requiredInputs.externalSmtpProof.constraints.join("\n")).toContain("non-@vtj.co.jp");
      expect(out.requiredInputs.routingGmailProof.requiredGitHubSecrets).toContain("GOOGLE_CLIENT_SECRET");
      expect(out.requiredInputs.staffGitHubConfig.requiredGitHubVariables).toContain("MAILHUB_READ_ONLY");
      expect(out.requiredInputs.staffGitHubConfig.requiredGitHubSecrets).toContain("MAILHUB_SHEETS_PRIVATE_KEY");
      expect(out.requiredInputs.sheetsRuleSource.defaultRuleTabs.MAILHUB_SHEETS_TAB_RULES).toBe("ConfigRules");
      expect(out.requiredInputs.readOnlyRolloutEvidence.requiredFiles).toContain("staff-workflow-evidence-manifest.json");
      expect(out.safeCommands.dryRun).toContain(
        "npm run setup:mailhub-routing-secrets -- --out .ai-runs/mailhub-next-phase/mailhub-routing-secrets-plan.json",
      );
      expect(JSON.stringify(out.safeCommands)).not.toContain("--apply");
      expect(JSON.stringify(out.safeCommands)).not.toContain("--send");
      expect(out.approvalGatedActions.map((action) => action.id)).toEqual([
        "apply_routing_probe_github_secrets",
        "apply_staff_github_config",
        "send_external_routing_probes",
        "run_sheets_mutation_paths",
      ]);
      expect(out.approvalGatedActions.every((action) => action.requiresApproval === true)).toBe(true);
      expect(out.approvalGatedActions.every((action) => action.confirmationToken.length > 0)).toBe(true);
      expect(out.approvalGatedActions).toEqual([
        expect.objectContaining({
          id: "apply_routing_probe_github_secrets",
          sideEffect: "github_mutation",
          requiresApproval: true,
          confirmationToken: "APPLY_MAILHUB_ROUTING_SECRETS",
          commandAfterApproval: "npm run setup:mailhub-routing-secrets -- --include-gmail --apply --confirm-apply APPLY_MAILHUB_ROUTING_SECRETS --out .ai-runs/mailhub-next-phase/mailhub-routing-secrets-plan.json",
        }),
        expect.objectContaining({
          id: "apply_staff_github_config",
          sideEffect: "github_mutation",
          requiresApproval: true,
          confirmationToken: "APPLY_MAILHUB_STAFF_GITHUB_CONFIG",
          commandAfterApproval: "npm run setup:mailhub-staff-github-config -- --apply --confirm-apply APPLY_MAILHUB_STAFF_GITHUB_CONFIG --out .ai-runs/mailhub-next-phase/mailhub-staff-github-config-plan.json",
        }),
        expect.objectContaining({
          id: "send_external_routing_probes",
          sideEffect: "external_mail",
          requiresApproval: true,
          confirmationToken: "SEND_EXTERNAL_MAILHUB_ROUTING_PROBES",
          commandAfterApproval: "npm run probe:routing-send -- --send --confirm-send SEND_EXTERNAL_MAILHUB_ROUTING_PROBES --verify-after-send --out .ai-runs/mailhub-next-phase/mailhub-routing-probe-send.json",
        }),
        expect.objectContaining({
          id: "run_sheets_mutation_paths",
          sideEffect: "sheets_mutation",
          requiresApproval: true,
          confirmationToken: "EXPLICIT_OPERATOR_APPROVAL_REQUIRED",
          commandAfterApproval: "not emitted by this no-secret intake package",
        }),
      ]);
      expect(out.valuePolicy).toContain("Secret values are never printed");
      const serialized = JSON.stringify(out);
      expect(serialized).not.toContain("nextauth-secret-value");
      expect(serialized).not.toContain("BEGIN PRIVATE KEY");
      expect(serialized).not.toContain("probe-pass");
      const markdown = readFileSync(markdownOutPath, "utf8");
      expect(markdown).toContain("# MailHub Production Config Intake");
      expect(markdown).toContain("This artifact is intentionally value-free");
      expect(markdown).toContain("MAILHUB_TEAM_MEMBERS");
      expect(markdown).toContain("non-@vtj.co.jp external sender");
      expect(markdown).toContain("Routing Gmail Proof Intake");
      expect(markdown).toContain("only after values are present and explicit approval is given");
      expect(markdown).toContain("npm run setup:mailhub-routing-secrets -- --include-gmail --apply --confirm-apply APPLY_MAILHUB_ROUTING_SECRETS");
      expect(markdown).toContain("npm run setup:mailhub-staff-github-config -- --apply --confirm-apply APPLY_MAILHUB_STAFF_GITHUB_CONFIG");
      expect(markdown).toContain("npm run probe:routing-send -- --send --confirm-send SEND_EXTERNAL_MAILHUB_ROUTING_PROBES --verify-after-send");
      expect(markdown).not.toContain("nextauth-secret-value");
      expect(markdown).not.toContain("BEGIN PRIVATE KEY");
      expect(markdown).not.toContain("probe-pass");
    });
  });

  test("production config request honors gate-only productionReady true artifacts", () => {
    withTempDir((dir) => {
      const runDir = join(dir, "run");
      const outPath = join(runDir, "mailhub-production-config-request.json");
      const markdownOutPath = join(runDir, "mailhub-production-config-intake.md");
      mkdirSync(runDir, { recursive: true });
      writeJson(join(runDir, "mailhub-production-readiness-audit.json"), {
        gate: {
          productionReady: true,
          p0Blockers: [],
          p1Blockers: [],
        },
      });

      const result = runNodeScript(productionConfigRequestPath, ["--run-dir", runDir, "--out", outPath]);

      expect(result.status).toBe(0);
      const out = readJson<{
        readiness: { productionReady: boolean; p0Blockers: string[]; p1Blockers: string[] };
      }>(outPath);
      expect(out.readiness.productionReady).toBe(true);
      expect(out.readiness.p0Blockers).toEqual([]);
      expect(out.readiness.p1Blockers).toEqual([]);
      expect(readFileSync(markdownOutPath, "utf8")).toContain("productionReady: `true`");
    });
  });
});
