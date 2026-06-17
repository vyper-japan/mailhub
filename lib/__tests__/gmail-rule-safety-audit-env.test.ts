import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { describe, expect, test } from "vitest";

const scriptPath = resolve(process.cwd(), "scripts/audit-gmail-rule-safety.mjs");

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "gmail-rule-safety-env-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runAudit(args: string[], env: Partial<NodeJS.ProcessEnv> = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      GOOGLE_SHARED_INBOX_EMAIL: "",
      GOOGLE_SHARED_INBOX_REFRESH_TOKEN: "",
      MAILHUB_CONFIG_STORE: "",
      MAILHUB_SHEETS_ID: "",
      MAILHUB_SHEETS_SPREADSHEET_ID: "",
      MAILHUB_SHEETS_CLIENT_EMAIL: "",
      MAILHUB_SHEETS_PRIVATE_KEY: "",
      ...env,
    },
  });
}

describe("gmail rule safety audit env loading", () => {
  test("help documents explicit env-file controls", () => {
    const result = runAudit(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--env-file .env.local");
    expect(result.stdout).toContain("--no-env-file");
    expect(result.stdout).toContain("Secret values are never printed");
  });

  test("uses only process env when --no-env-file is provided", () => {
    withTempDir((dir) => {
      const envPath = join(dir, ".env.local");
      writeFileSync(envPath, "GOOGLE_CLIENT_ID=from-file\n", "utf8");

      const result = runAudit([
        "--no-env-file",
        "--config-source",
        "file",
        "--out",
        join(dir, "audit.json"),
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("missing_env:GOOGLE_CLIENT_ID");
      expect(result.stderr).not.toContain("from-file");
    });
  });

  test("loads the explicitly provided env file without printing values", () => {
    withTempDir((dir) => {
      const envPath = join(dir, ".env.local");
      writeFileSync(envPath, "GOOGLE_CLIENT_ID=from-file-secret\n", "utf8");

      const result = runAudit([
        "--env-file",
        envPath,
        "--config-source",
        "file",
        "--out",
        join(dir, "audit.json"),
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("missing_env:GOOGLE_CLIENT_SECRET");
      expect(result.stderr).not.toContain("from-file-secret");
    });
  });
});
