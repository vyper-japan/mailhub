import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawnSync } from "child_process";
import { describe, expect, test } from "vitest";

const scannerPath = resolve(process.cwd(), "scripts/scan-ops-artifacts.mjs");

function runScanner(content: string) {
  const dir = mkdtempSync(join(tmpdir(), "mailhub-secret-scan-"));
  const file = join(dir, "artifact.md");
  writeFileSync(file, content, "utf8");

  try {
    return spawnSync(process.execPath, [scannerPath, file], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runScannerArgs(args: string[]) {
  return spawnSync(process.execPath, [scannerPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

describe("ops artifact secret scan", () => {
  test.each([
    [
      "PEM private key fragment",
      "credential: -----BEGIN PRIVATE KEY-----\\nDUMMYFIXTUREPRIVATEKEYVALUEONLY\\n-----END PRIVATE KEY-----",
      "DUMMYFIXTUREPRIVATEKEYVALUEONLY",
    ],
    [
      "OAuth refresh token",
      'refresh_token: "DUMMY_REFRESH_TOKEN_VALUE_1234567890"',
      "DUMMY_REFRESH_TOKEN_VALUE_1234567890",
    ],
    [
      "OAuth access token",
      'access_token: "DUMMY_ACCESS_TOKEN_VALUE_1234567890"',
      "DUMMY_ACCESS_TOKEN_VALUE_1234567890",
    ],
    [
      "JSON credential value",
      '{"client_secret":"DUMMY_CLIENT_SECRET_VALUE_1234567890"}',
      "DUMMY_CLIENT_SECRET_VALUE_1234567890",
    ],
    [
      "Slack webhook URL",
      "https://hooks.slack.com/services/T00000000/B00000000/DUMMYWEBHOOKTOKEN000",
      "DUMMYWEBHOOKTOKEN000",
    ],
  ])("detects %s and masks the value", (_name, fixture, rawValue) => {
    const result = runScanner(fixture);
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("FAIL CR-F9-R007 ops artifact secret scan");
    expect(output).not.toContain(rawValue);
  });

  test("allows env key names without values", () => {
    const result = runScanner(
      ["MAILHUB_ALERTS_SECRET", "# GOOGLE_CLIENT_SECRET", "RMS_STORE_A_SECRET"].join("\n"),
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS CR-F9-R007 ops artifact secret scan");
  });

  test("allows secret_ref placeholders", () => {
    const result = runScanner("secret_ref: vyper/mailhub/prod/alerts");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS CR-F9-R007 ops artifact secret scan");
  });

  test("fails closed when an explicit target is missing", () => {
    const result = runScannerArgs(["definitely-missing-ops-artifact.md"]);
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("FAIL CR-F9-R007 ops artifact secret scan");
    expect(output).toContain("missing_targets=definitely-missing-ops-artifact.md");
  });

  test("default scan is limited to repo-resident stable ops artifacts", () => {
    const result = runScannerArgs([]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS CR-F9-R007 ops artifact secret scan");
    expect(result.stdout).toContain("- env.example");
    expect(result.stdout).toContain("- OPS_RUNBOOK.md");
    expect(result.stdout).not.toContain("phase1/ops");
    expect(result.stdout).not.toContain("qa");
  });

  test("qa:strict includes the ops artifact scan", () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.["qa:strict"]).toContain("npm run security:scan-artifacts");
  });
});
