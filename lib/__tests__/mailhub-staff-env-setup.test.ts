import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawnSync } from "child_process";
import { describe, expect, test } from "vitest";

const setupPath = resolve(process.cwd(), "scripts/setup-mailhub-staff-env.mjs");

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "mailhub-staff-env-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runSetup(args: string[]) {
  const cleanEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: process.env.NODE_ENV ?? "test",
  };
  return spawnSync(process.execPath, [setupPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: cleanEnv,
  });
}

describe("MailHub staff env setup helper", () => {
  test("reports missing production staff env without printing values", () => {
    withTempDir((dir) => {
      const outPath = join(dir, "staff-env.json");
      const result = runSetup(["--staff-env-file", join(dir, "missing.env"), "--out", outPath, "--strict"]);

      expect(result.status).toBe(1);
      const artifact = JSON.parse(readFileSync(outPath, "utf8")) as {
        state: { readyForReadOnlyRolloutPreflight: boolean };
        missing: { productionEnvMode: string[]; productionEnv: string[]; staffAdmins: string[] };
      };
      expect(artifact.state.readyForReadOnlyRolloutPreflight).toBe(false);
      expect(artifact.missing.productionEnvMode).toEqual(["MAILHUB_ENV=production"]);
      expect(artifact.missing.productionEnv).toEqual(expect.arrayContaining([
        "NEXTAUTH_URL",
        "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
      ]));
      expect(artifact.missing.staffAdmins).toEqual(["MAILHUB_ADMINS"]);
      expect(result.stdout).not.toContain("refresh-token");
      expect(result.stdout).not.toContain("PRIVATE KEY");
    });
  });

  test("accepts complete production staff env and masks all secret values", () => {
    withTempDir((dir) => {
      const envPath = join(dir, "prod.env");
      const outPath = join(dir, "staff-env.json");
      writeFileSync(envPath, [
        "MAILHUB_ENV=production",
        "MAILHUB_READ_ONLY=1",
        "MAILHUB_CONFIG_STORE=sheets",
        "MAILHUB_ACTIVITY_STORE=sheets",
        "MAILHUB_ADMINS=Admin <admin@vtj.co.jp>",
        "MAILHUB_TEAM_MEMBERS=Maki <maki@vtj.co.jp>",
        "MAILHUB_SHEETS_ID=real-sheet-id-secret",
        "MAILHUB_SHEETS_CLIENT_EMAIL=svc@example.iam.gserviceaccount.com",
        "MAILHUB_SHEETS_PRIVATE_KEY=\"-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n\"",
        "NEXTAUTH_URL=https://mailhub.example.com",
        "NEXTAUTH_SECRET=real-nextauth-secret",
        "GOOGLE_CLIENT_ID=real-google-client-id",
        "GOOGLE_CLIENT_SECRET=real-google-client-secret",
        "GOOGLE_SHARED_INBOX_EMAIL=mailhub@vtj.co.jp",
        "GOOGLE_SHARED_INBOX_REFRESH_TOKEN=real-refresh-token-secret",
      ].join("\n"), "utf8");

      const result = runSetup(["--staff-env-file", envPath, "--out", outPath, "--strict"]);

      expect(result.status).toBe(0);
      const serialized = `${result.stdout}\n${readFileSync(outPath, "utf8")}`;
      expect(serialized).not.toContain("real-nextauth-secret");
      expect(serialized).not.toContain("real-google-client-secret");
      expect(serialized).not.toContain("real-refresh-token-secret");
      expect(serialized).not.toContain("real-sheet-id-secret");
      expect(serialized).not.toContain("BEGIN PRIVATE KEY");
      const artifact = JSON.parse(readFileSync(outPath, "utf8")) as {
        state: { readyForReadOnlyRolloutPreflight: boolean };
        present: { adminCount: number; teamMemberCount: number; sheetsIdConfigured: boolean };
        missing: Record<string, string[]>;
      };
      expect(artifact.state.readyForReadOnlyRolloutPreflight).toBe(true);
      expect(artifact.present).toMatchObject({
        adminCount: 1,
        teamMemberCount: 1,
        sheetsIdConfigured: true,
      });
      expect(Object.values(artifact.missing).flat()).toEqual([]);
    });
  });

  test("keeps invalid and non-vtj staff entries as validation issues only", () => {
    withTempDir((dir) => {
      const envPath = join(dir, "bad-staff.env");
      const outPath = join(dir, "staff-env.json");
      writeFileSync(envPath, [
        "MAILHUB_ADMINS=bad-admin, outside@example.com",
        "MAILHUB_TEAM_MEMBERS=bad-team, user@example.com",
      ].join("\n"), "utf8");

      const result = runSetup(["--staff-env-file", envPath, "--out", outPath]);

      expect(result.status).toBe(0);
      const artifact = JSON.parse(readFileSync(outPath, "utf8")) as {
        issues: {
          adminInvalid: string[];
          adminNonVtj: string[];
          teamInvalid: string[];
          teamNonVtj: string[];
        };
      };
      expect(artifact.issues.adminInvalid).toEqual(["bad-admin"]);
      expect(artifact.issues.adminNonVtj).toEqual(["outside@example.com"]);
      expect(artifact.issues.teamInvalid).toEqual(["bad-team"]);
      expect(artifact.issues.teamNonVtj).toEqual(["user@example.com"]);
    });
  });
});
