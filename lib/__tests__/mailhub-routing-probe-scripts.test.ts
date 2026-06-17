import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawnSync } from "child_process";
import { describe, expect, test } from "vitest";

const routingProbeAuditPath = resolve(process.cwd(), "scripts/audit-mailhub-routing-probes.mjs");
const readinessAuditPath = resolve(process.cwd(), "scripts/audit-mailhub-production-readiness.mjs");
const routingProbeSenderPath = resolve(process.cwd(), "scripts/send-mailhub-routing-probes.mjs");
const routingProbeSecretsPath = resolve(process.cwd(), "scripts/check-mailhub-routing-probe-secrets.mjs");
const routingNextStepsPath = resolve(process.cwd(), "scripts/write-mailhub-routing-next-steps.mjs");
const routingSecretSetupPath = resolve(process.cwd(), "scripts/setup-mailhub-routing-probe-secrets.mjs");

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "mailhub-routing-probes-"));
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

function opsAuditFixture() {
  return {
    generatedAt: "2026-06-17T00:00:00.000Z",
    gate: {
      sourceInventoryMissing: [],
      productionCompleteClaimReady: false,
      currentSharedGmailRoutingUnconfirmed: ["multi-source", "single-source"],
      noSharedInboxEvidence: ["single-source"],
      routingConfirmationRequired: ["multi-source", "single-source"],
    },
    operationalConfirmations: [
      {
        id: "multi-source",
        label: "Multi Source",
        addresses: ["first@example.com", "second@example.com"],
      },
      {
        id: "single-source",
        label: "Single Source",
        addresses: ["third@example.com"],
      },
      {
        id: "already-confirmed",
        label: "Already Confirmed",
        addresses: ["ignored@example.com"],
      },
    ],
  };
}

function writeReadinessFixtures(dir: string, routingProbeGate: Record<string, unknown>) {
  const paths = {
    source: join(dir, "source.json"),
    ops: join(dir, "ops.json"),
    gws: join(dir, "gws.json"),
    routing: join(dir, "routing.json"),
    preflight: join(dir, "preflight.json"),
    githubSecrets: join(dir, "github-secrets.json"),
    views: join(dir, "views.json"),
    rules: join(dir, "rules.json"),
    out: join(dir, "readiness.json"),
  };
  writeJson(paths.source, {
    generatedAt: "2026-06-17T00:00:00.000Z",
    zeroEstimateAnalysis: {
      knownCodeGaps: [],
      coverageGate: { codeCoveragePass: true },
    },
  });
  writeJson(paths.ops, opsAuditFixture());
  writeJson(paths.gws, {
    generatedAt: "2026-06-17T00:00:00.000Z",
    gate: {
      currentSharedGmailRoutingConfirmed: false,
    },
    dns: {
      mxRecords: [{ exchange: "mx01.lolipop.jp", priority: 50 }],
    },
  });
  writeJson(paths.routing, {
    generatedAt: "2026-06-17T00:00:00.000Z",
    gate: routingProbeGate,
  });
  writeJson(paths.preflight, {
    generatedAt: "2026-06-17T00:00:00.000Z",
    smtpPreflight: {
      missingRequiredEnv: ["MAILHUB_PROBE_SMTP_HOST", "MAILHUB_PROBE_FROM"],
      readyForSend: false,
      readyForProductionProof: false,
      warnings: [],
    },
  });
  writeJson(paths.githubSecrets, {
    checkedAt: "2026-06-17T00:00:00.000Z",
    source: "github_actions_secrets",
    secretCount: 4,
    readyForPreflightProductionProof: false,
    readyForSendVerify: false,
    missingPreflightSecrets: ["MAILHUB_PROBE_SMTP_HOST", "MAILHUB_PROBE_FROM"],
    missingSendVerifySecrets: ["MAILHUB_PROBE_SMTP_HOST", "MAILHUB_PROBE_FROM"],
    presentRequiredSecretNames: [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_SHARED_INBOX_EMAIL",
      "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
    ],
  });
  writeJson(paths.views, {
    generatedAt: "2026-06-17T00:00:00.000Z",
    gate: {
      syntaxReady: true,
      manualReviewOnly: true,
      bulkAutomationSafe: false,
      syntaxFailedViews: [],
      manualReviewOnlyViews: ["invoices"],
      bulkUnsafeViews: ["customer-inquiries"],
    },
    views: [{ id: "invoices", syntaxAccepted: true, hasMoreAfterMaxPages: false }],
  });
  writeJson(paths.rules, {
    generatedAt: "2026-06-17T00:00:00.000Z",
    ruleSafetyGate: { realDataRuleRiskPass: true },
  });
  return paths;
}

describe("MailHub routing probe CLI gates", () => {
  test("GitHub routing secret audit reports missing proof secrets without gh", () => {
    withTempDir((dir) => {
      const secretsPath = join(dir, "secrets.json");
      writeJson(secretsPath, []);

      const result = runNodeScript(routingProbeSecretsPath, [
        "--secrets-json",
        secretsPath,
        "--no-fail",
      ]);

      expect(result.status).toBe(0);
      const out = JSON.parse(result.stdout) as {
        secretCount: number;
        readyForPreflightProductionProof: boolean;
        readyForSendVerify: boolean;
        missingPreflightSecrets: string[];
        missingSendVerifySecrets: string[];
        presentRequiredSecretNames: string[];
      };
      expect(out.secretCount).toBe(0);
      expect(out.readyForPreflightProductionProof).toBe(false);
      expect(out.readyForSendVerify).toBe(false);
      expect(out.missingPreflightSecrets).toEqual([
        "MAILHUB_PROBE_SMTP_HOST",
        "MAILHUB_PROBE_SMTP_USER",
        "MAILHUB_PROBE_SMTP_PASS",
        "MAILHUB_PROBE_FROM",
      ]);
      expect(out.missingSendVerifySecrets).toEqual([
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "GOOGLE_SHARED_INBOX_EMAIL",
        "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
        "MAILHUB_PROBE_SMTP_HOST",
        "MAILHUB_PROBE_SMTP_USER",
        "MAILHUB_PROBE_SMTP_PASS",
        "MAILHUB_PROBE_FROM",
      ]);
      expect(out.presentRequiredSecretNames).toEqual([]);
    });
  });

  test("GitHub routing secret audit separates SMTP preflight readiness from send_verify readiness", () => {
    withTempDir((dir) => {
      const secretsPath = join(dir, "secrets.json");
      writeJson(secretsPath, [
        { name: "MAILHUB_PROBE_SMTP_HOST" },
        { name: "MAILHUB_PROBE_SMTP_USER" },
        { name: "MAILHUB_PROBE_SMTP_PASS" },
        { name: "MAILHUB_PROBE_FROM" },
      ]);

      const result = runNodeScript(routingProbeSecretsPath, [
        "--secrets-json",
        secretsPath,
        "--no-fail",
      ]);

      expect(result.status).toBe(0);
      const out = JSON.parse(result.stdout) as {
        readyForPreflightProductionProof: boolean;
        readyForSendVerify: boolean;
        missingPreflightSecrets: string[];
        missingSendVerifySecrets: string[];
      };
      expect(out.readyForPreflightProductionProof).toBe(true);
      expect(out.readyForSendVerify).toBe(false);
      expect(out.missingPreflightSecrets).toEqual([]);
      expect(out.missingSendVerifySecrets).toEqual([
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "GOOGLE_SHARED_INBOX_EMAIL",
        "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
      ]);
    });
  });

  test("GitHub routing secret audit passes only when SMTP and Gmail proof secrets are present", () => {
    withTempDir((dir) => {
      const secretsPath = join(dir, "secrets.json");
      const outPath = join(dir, "github-routing-secrets.json");
      writeJson(secretsPath, [
        { name: "GOOGLE_CLIENT_ID" },
        { name: "GOOGLE_CLIENT_SECRET" },
        { name: "GOOGLE_SHARED_INBOX_EMAIL" },
        { name: "GOOGLE_SHARED_INBOX_REFRESH_TOKEN" },
        { name: "MAILHUB_PROBE_SMTP_HOST" },
        { name: "MAILHUB_PROBE_SMTP_USER" },
        { name: "MAILHUB_PROBE_SMTP_PASS" },
        { name: "MAILHUB_PROBE_FROM" },
        { name: "MAILHUB_PROBE_SMTP_PORT" },
      ]);

      const result = runNodeScript(routingProbeSecretsPath, [
        "--secrets-json",
        secretsPath,
        "--out",
        outPath,
      ]);

      expect(result.status).toBe(0);
      const out = JSON.parse(result.stdout) as {
        readyForPreflightProductionProof: boolean;
        readyForSendVerify: boolean;
        configuredOptionalSecrets: string[];
        missingPreflightSecrets: string[];
        missingSendVerifySecrets: string[];
      };
      expect(out.readyForPreflightProductionProof).toBe(true);
      expect(out.readyForSendVerify).toBe(true);
      expect(out.configuredOptionalSecrets).toEqual(["MAILHUB_PROBE_SMTP_PORT"]);
      expect(out.missingPreflightSecrets).toEqual([]);
      expect(out.missingSendVerifySecrets).toEqual([]);
      expect(readJson(outPath)).toMatchObject({
        readyForPreflightProductionProof: true,
        readyForSendVerify: true,
      });
    });
  });

  test("GitHub routing secret audit can inspect injected workflow env without printing values", () => {
    withTempDir((dir) => {
      const outPath = join(dir, "env-routing-secrets.json");
      const result = runNodeScript(
        routingProbeSecretsPath,
        ["--from-env", "--out", outPath],
        {
          GOOGLE_CLIENT_ID: "client-id",
          GOOGLE_CLIENT_SECRET: "client-secret",
          GOOGLE_SHARED_INBOX_EMAIL: "mailhub@vtj.co.jp",
          GOOGLE_SHARED_INBOX_REFRESH_TOKEN: "refresh-token",
          MAILHUB_PROBE_SMTP_HOST: "smtp.example.com",
          MAILHUB_PROBE_SMTP_USER: "probe-user",
          MAILHUB_PROBE_SMTP_PASS: "probe-pass",
          MAILHUB_PROBE_FROM: "external-probe@example.com",
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain("client-secret");
      expect(result.stdout).not.toContain("refresh-token");
      expect(result.stdout).not.toContain("probe-pass");
      expect(readFileSync(outPath, "utf8")).not.toContain("client-secret");
      expect(readFileSync(outPath, "utf8")).not.toContain("refresh-token");
      expect(readFileSync(outPath, "utf8")).not.toContain("probe-pass");
      expect(readJson(outPath)).toMatchObject({
        source: "env",
        readyForPreflightProductionProof: true,
        readyForSendVerify: true,
      });
    });
  });

  test("routing secret setup dry-run never prints secret values", () => {
    const result = runNodeScript(
      routingSecretSetupPath,
      ["--include-gmail", "--probe-env-file", "/tmp/missing-mailhub-env"],
      {
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
        GOOGLE_SHARED_INBOX_EMAIL: "mailhub@vtj.co.jp",
        GOOGLE_SHARED_INBOX_REFRESH_TOKEN: "refresh-token",
        MAILHUB_PROBE_SMTP_HOST: "smtp.example.com",
        MAILHUB_PROBE_SMTP_USER: "probe-user",
        MAILHUB_PROBE_SMTP_PASS: "probe-pass",
        MAILHUB_PROBE_FROM: "External Probe <external-probe@example.com>",
        MAILHUB_PROBE_SMTP_PORT: "587",
        MAILHUB_PROBE_SMTP_SECURE: "false",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("client-secret");
    expect(result.stdout).not.toContain("refresh-token");
    expect(result.stdout).not.toContain("probe-pass");
    expect(result.stdout).not.toContain("probe-user");
    const out = JSON.parse(result.stdout) as {
      mode: string;
      readyToApply: boolean;
      secretNamesToSet: string[];
      missingRequiredEnv: string[];
    };
    expect(out.mode).toBe("dry_run");
    expect(out.readyToApply).toBe(true);
    expect(out.missingRequiredEnv).toEqual([]);
    expect(out.secretNamesToSet).toEqual([
      "MAILHUB_PROBE_SMTP_HOST",
      "MAILHUB_PROBE_SMTP_USER",
      "MAILHUB_PROBE_SMTP_PASS",
      "MAILHUB_PROBE_FROM",
      "MAILHUB_PROBE_SMTP_PORT",
      "MAILHUB_PROBE_SMTP_SECURE",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_SHARED_INBOX_EMAIL",
      "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
    ]);
  });

  test("routing secret setup refuses vtj sender for production proof", () => {
    const result = runNodeScript(
      routingSecretSetupPath,
      ["--apply", "--probe-env-file", "/tmp/missing-mailhub-env"],
      {
        MAILHUB_PROBE_SMTP_HOST: "smtp.example.com",
        MAILHUB_PROBE_SMTP_USER: "probe-user",
        MAILHUB_PROBE_SMTP_PASS: "probe-pass",
        MAILHUB_PROBE_FROM: "probe@vtj.co.jp",
      },
    );

    expect(result.status).toBe(2);
    expect(result.stdout).not.toContain("probe-pass");
    const out = JSON.parse(result.stdout) as {
      readyToApply: boolean;
      warnings: string[];
      appliedSecretNames: string[];
    };
    expect(out.readyToApply).toBe(false);
    expect(out.warnings).toContain("vtj_from_not_external_route_proof");
    expect(out.appliedSecretNames).toEqual([]);
  });

  test("routing secret setup applies values through gh stdin without printing them", () => {
    withTempDir((dir) => {
      const fakeGhPath = join(dir, "fake-gh.sh");
      const callsPath = join(dir, "gh-calls.jsonl");
      writeFileSync(
        fakeGhPath,
        [
          "#!/usr/bin/env bash",
          "set -euo pipefail",
          "payload=$(cat)",
          "printf '{\"args\":' >> \"$MAILHUB_GH_CALLS\"",
          "node -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' \"$@\" >> \"$MAILHUB_GH_CALLS\"",
          "printf ',\"stdinLength\":%s}\\n' \"${#payload}\" >> \"$MAILHUB_GH_CALLS\"",
        ].join("\n"),
        { mode: 0o700 },
      );

      const result = runNodeScript(
        routingSecretSetupPath,
        ["--apply", "--probe-env-file", "/tmp/missing-mailhub-env"],
        {
          MAILHUB_GH_BIN: fakeGhPath,
          MAILHUB_GH_CALLS: callsPath,
          MAILHUB_PROBE_SMTP_HOST: "smtp.example.com",
          MAILHUB_PROBE_SMTP_USER: "probe-user",
          MAILHUB_PROBE_SMTP_PASS: "probe-pass",
          MAILHUB_PROBE_FROM: "external-probe@example.com",
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain("probe-pass");
      expect(result.stdout).not.toContain("probe-user");
      const out = JSON.parse(result.stdout) as {
        mode: string;
        readyToApply: boolean;
        appliedSecretNames: string[];
      };
      expect(out.mode).toBe("apply");
      expect(out.readyToApply).toBe(true);
      expect(out.appliedSecretNames).toEqual([
        "MAILHUB_PROBE_SMTP_HOST",
        "MAILHUB_PROBE_SMTP_USER",
        "MAILHUB_PROBE_SMTP_PASS",
        "MAILHUB_PROBE_FROM",
      ]);
      const callsRaw = readFileSync(callsPath, "utf8");
      expect(callsRaw).not.toContain("probe-pass");
      expect(callsRaw).not.toContain("probe-user");
      const calls = callsRaw
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { args: string[]; stdinLength: number });
      expect(calls).toHaveLength(4);
      expect(calls.map((call) => call.args.slice(0, 3))).toEqual([
        ["secret", "set", "MAILHUB_PROBE_SMTP_HOST"],
        ["secret", "set", "MAILHUB_PROBE_SMTP_USER"],
        ["secret", "set", "MAILHUB_PROBE_SMTP_PASS"],
        ["secret", "set", "MAILHUB_PROBE_FROM"],
      ]);
      expect(calls.every((call) => call.stdinLength > 0)).toBe(true);
    });
  });

  test("routing next-step artifact blocks send_verify until external SMTP proof secrets are ready", () => {
    withTempDir((dir) => {
      const readinessPath = join(dir, "readiness.json");
      const githubSecretsPath = join(dir, "github-secrets.json");
      const preflightPath = join(dir, "preflight.json");
      const outPath = join(dir, "next.json");
      writeJson(readinessPath, {
        generatedAt: "2026-06-17T00:00:00.000Z",
        gate: { productionReady: false, p0Blockers: ["current_shared_gmail_routing"] },
      });
      writeJson(githubSecretsPath, {
        checkedAt: "2026-06-17T00:00:00.000Z",
        readyForSendVerify: false,
        missingSendVerifySecrets: ["MAILHUB_PROBE_SMTP_HOST", "MAILHUB_PROBE_SMTP_PASS"],
        presentRequiredSecretNames: ["GOOGLE_CLIENT_ID"],
      });
      writeJson(preflightPath, {
        generatedAt: "2026-06-17T00:00:00.000Z",
        smtpPreflight: {
          readyForProductionProof: false,
          missingRequiredEnv: ["MAILHUB_PROBE_SMTP_PASS", "MAILHUB_PROBE_FROM"],
        },
      });

      const result = runNodeScript(routingNextStepsPath, [
        "--readiness",
        readinessPath,
        "--github-secrets",
        githubSecretsPath,
        "--preflight",
        preflightPath,
        "--out",
        outPath,
      ]);

      expect(result.status).toBe(0);
      const out = readJson<{
        state: {
          canRunSendVerify: boolean;
          currentSharedGmailRoutingBlocked: boolean;
          externalMailWillBeSentByThisScript: boolean;
        };
        missing: { externalSmtpSecrets: string[] };
        nextActions: Array<{ id: string; status: string; requiredSecrets?: string[] }>;
      }>(outPath);
      expect(out.state.canRunSendVerify).toBe(false);
      expect(out.state.currentSharedGmailRoutingBlocked).toBe(true);
      expect(out.state.externalMailWillBeSentByThisScript).toBe(false);
      expect(out.missing.externalSmtpSecrets).toEqual([
        "MAILHUB_PROBE_SMTP_HOST",
        "MAILHUB_PROBE_SMTP_PASS",
        "MAILHUB_PROBE_FROM",
      ]);
      expect(out.nextActions.find((item) => item.id === "set_external_smtp_secrets")).toMatchObject({
        status: "required",
        requiredSecrets: ["MAILHUB_PROBE_SMTP_HOST", "MAILHUB_PROBE_SMTP_PASS", "MAILHUB_PROBE_FROM"],
      });
      expect(out.nextActions.find((item) => item.id === "run_github_send_verify")).toMatchObject({
        status: "blocked",
      });
    });
  });

  test("routing next-step artifact treats missing input artifacts as blocked", () => {
    withTempDir((dir) => {
      const outPath = join(dir, "next.json");
      const result = runNodeScript(routingNextStepsPath, [
        "--readiness",
        join(dir, "missing-readiness.json"),
        "--github-secrets",
        join(dir, "missing-github-secrets.json"),
        "--preflight",
        join(dir, "missing-preflight.json"),
        "--out",
        outPath,
      ]);

      expect(result.status).toBe(0);
      const out = readJson<{
        state: { canRunSendVerify: boolean; readyForGithubSendVerify: boolean; readyForLocalProductionProof: boolean };
        missing: { externalSmtpSecrets: string[]; githubSendVerifySecrets: string[]; localPreflightEnv: string[] };
        nextActions: Array<{ id: string; status: string }>;
      }>(outPath);
      expect(out.state.canRunSendVerify).toBe(false);
      expect(out.state.readyForGithubSendVerify).toBe(false);
      expect(out.state.readyForLocalProductionProof).toBe(false);
      expect(out.missing.externalSmtpSecrets).toEqual([
        "MAILHUB_PROBE_SMTP_HOST",
        "MAILHUB_PROBE_SMTP_USER",
        "MAILHUB_PROBE_SMTP_PASS",
        "MAILHUB_PROBE_FROM",
      ]);
      expect(out.missing.githubSendVerifySecrets).toEqual([
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "GOOGLE_SHARED_INBOX_EMAIL",
        "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
        "MAILHUB_PROBE_SMTP_HOST",
        "MAILHUB_PROBE_SMTP_USER",
        "MAILHUB_PROBE_SMTP_PASS",
        "MAILHUB_PROBE_FROM",
      ]);
      expect(out.missing.localPreflightEnv).toEqual([
        "MAILHUB_PROBE_SMTP_HOST",
        "MAILHUB_PROBE_SMTP_USER",
        "MAILHUB_PROBE_SMTP_PASS",
        "MAILHUB_PROBE_FROM",
      ]);
      expect(out.nextActions.find((item) => item.id === "set_external_smtp_secrets")).toMatchObject({
        status: "required",
      });
      expect(out.nextActions.find((item) => item.id === "run_github_send_verify")).toMatchObject({
        status: "blocked",
      });
    });
  });

  test("routing next-step artifact marks send_verify ready when GitHub secrets and local preflight are ready", () => {
    withTempDir((dir) => {
      const readinessPath = join(dir, "readiness.json");
      const githubSecretsPath = join(dir, "github-secrets.json");
      const preflightPath = join(dir, "preflight.json");
      const outPath = join(dir, "next.json");
      writeJson(readinessPath, {
        generatedAt: "2026-06-17T00:00:00.000Z",
        gate: { productionReady: false, p0Blockers: ["current_shared_gmail_routing"] },
      });
      writeJson(githubSecretsPath, {
        checkedAt: "2026-06-17T00:00:00.000Z",
        readyForSendVerify: true,
        missingSendVerifySecrets: [],
        presentRequiredSecretNames: [
          "GOOGLE_CLIENT_ID",
          "GOOGLE_CLIENT_SECRET",
          "GOOGLE_SHARED_INBOX_EMAIL",
          "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
          "MAILHUB_PROBE_SMTP_HOST",
          "MAILHUB_PROBE_SMTP_USER",
          "MAILHUB_PROBE_SMTP_PASS",
          "MAILHUB_PROBE_FROM",
        ],
      });
      writeJson(preflightPath, {
        generatedAt: "2026-06-17T00:00:00.000Z",
        smtpPreflight: {
          readyForProductionProof: true,
          missingRequiredEnv: [],
        },
      });

      const result = runNodeScript(routingNextStepsPath, [
        "--readiness",
        readinessPath,
        "--github-secrets",
        githubSecretsPath,
        "--preflight",
        preflightPath,
        "--out",
        outPath,
      ]);

      expect(result.status).toBe(0);
      const out = readJson<{
        state: { canRunSendVerify: boolean };
        missing: { externalSmtpSecrets: string[] };
        nextActions: Array<{ id: string; status: string }>;
      }>(outPath);
      expect(out.state.canRunSendVerify).toBe(true);
      expect(out.missing.externalSmtpSecrets).toEqual([]);
      expect(out.nextActions.find((item) => item.id === "run_github_send_verify")).toMatchObject({
        status: "ready",
      });
    });
  });

  test("routing next-step strict mode rejects stale readiness repo head", () => {
    withTempDir((dir) => {
      const readinessPath = join(dir, "readiness.json");
      const githubSecretsPath = join(dir, "github-secrets.json");
      const preflightPath = join(dir, "preflight.json");
      const outPath = join(dir, "next.json");
      writeJson(readinessPath, {
        generatedAt: "2026-06-17T00:00:00.000Z",
        repoHead: "old-head",
        gate: { productionReady: false, p0Blockers: ["current_shared_gmail_routing"] },
      });
      writeJson(githubSecretsPath, {
        checkedAt: "2026-06-17T00:00:00.000Z",
        readyForSendVerify: false,
        missingSendVerifySecrets: ["MAILHUB_PROBE_SMTP_HOST"],
        presentRequiredSecretNames: ["GOOGLE_CLIENT_ID"],
      });
      writeJson(preflightPath, {
        generatedAt: "2026-06-17T00:00:00.000Z",
        smtpPreflight: {
          readyForProductionProof: false,
          missingRequiredEnv: ["MAILHUB_PROBE_SMTP_HOST"],
        },
      });

      const result = runNodeScript(routingNextStepsPath, [
        "--readiness",
        readinessPath,
        "--github-secrets",
        githubSecretsPath,
        "--preflight",
        preflightPath,
        "--out",
        outPath,
        "--strict",
        "--repo-head",
        "current-head",
        "--repo-parent-head",
        "parent-head",
      ]);

      expect(result.status).toBe(1);
      const out = readJson<{ inputs: { errors: string[]; readinessRepoHead: string; repoHead: string; repoParentHead: string } }>(outPath);
      expect(out.inputs.readinessRepoHead).toBe("old-head");
      expect(out.inputs.repoHead).toBe("current-head");
      expect(out.inputs.repoParentHead).toBe("parent-head");
      expect(out.inputs.errors).toContain("stale_readiness_repo_head");
    });
  });

  test("routing next-step strict mode accepts current or parent readiness repo head", () => {
    withTempDir((dir) => {
      const readinessPath = join(dir, "readiness.json");
      const githubSecretsPath = join(dir, "github-secrets.json");
      const preflightPath = join(dir, "preflight.json");
      const outPath = join(dir, "next.json");
      writeJson(readinessPath, {
        generatedAt: "2026-06-17T00:00:00.000Z",
        repoHead: "parent-head",
        gate: { productionReady: false, p0Blockers: ["current_shared_gmail_routing"] },
      });
      writeJson(githubSecretsPath, {
        checkedAt: "2026-06-17T00:00:00.000Z",
        readyForSendVerify: false,
        missingSendVerifySecrets: ["MAILHUB_PROBE_SMTP_HOST"],
        presentRequiredSecretNames: ["GOOGLE_CLIENT_ID"],
      });
      writeJson(preflightPath, {
        generatedAt: "2026-06-17T00:00:00.000Z",
        smtpPreflight: {
          readyForProductionProof: false,
          missingRequiredEnv: ["MAILHUB_PROBE_SMTP_HOST"],
        },
      });

      const result = runNodeScript(routingNextStepsPath, [
        "--readiness",
        readinessPath,
        "--github-secrets",
        githubSecretsPath,
        "--preflight",
        preflightPath,
        "--out",
        outPath,
        "--strict",
        "--repo-head",
        "current-head",
        "--repo-parent-head",
        "parent-head",
      ]);

      expect(result.status).toBe(0);
      const out = readJson<{ inputs: { errors: string[]; readinessRepoHead: string } }>(outPath);
      expect(out.inputs.readinessRepoHead).toBe("parent-head");
      expect(out.inputs.errors).toEqual([]);
    });
  });

  test("plan-only routing probe audit reports every target address, not just channels", () => {
    withTempDir((dir) => {
      const opsPath = join(dir, "ops.json");
      const outPath = join(dir, "routing-probe.json");
      writeJson(opsPath, opsAuditFixture());

      const result = runNodeScript(routingProbeAuditPath, [
        "--ops-audit",
        opsPath,
        "--out",
        outPath,
      ]);

      expect(result.status).toBe(0);
      const out = readJson<{
        mode: string;
        plannedAddressProbes: Array<{ address: string; channelId: string }>;
        gate: {
          targetChannelCount: number;
          targetAddressCount: number;
          missingChannels: string[];
          missingAddresses: string[];
          allExpectedAddressesConfirmed: boolean;
        };
      }>(outPath);
      expect(out.mode).toBe("plan_only");
      expect(out.gate.targetChannelCount).toBe(2);
      expect(out.gate.targetAddressCount).toBe(3);
      expect(out.gate.missingChannels).toEqual(["multi-source", "single-source"]);
      expect(out.gate.missingAddresses).toEqual([
        "first@example.com",
        "second@example.com",
        "third@example.com",
      ]);
      expect(out.plannedAddressProbes.map((item) => item.address)).toEqual([
        "first@example.com",
        "second@example.com",
        "third@example.com",
      ]);
      expect(out.gate.allExpectedAddressesConfirmed).toBe(false);
    });
  });

  test("production readiness rejects channel-level probe success when address evidence is incomplete", () => {
    withTempDir((dir) => {
      const paths = writeReadinessFixtures(dir, {
        markerProvided: true,
        targetChannelCount: 2,
        targetAddressCount: 3,
        matchedChannels: ["multi-source", "single-source"],
        missingChannels: [],
        matchedAddresses: ["first@example.com", "third@example.com"],
        missingAddresses: ["second@example.com"],
        allExpectedChannelsConfirmed: true,
        allExpectedAddressesConfirmed: false,
      });

      const result = runNodeScript(readinessAuditPath, [
        "--source-audit",
        paths.source,
        "--ops-audit",
        paths.ops,
        "--gws-routing-audit",
        paths.gws,
        "--routing-probe-audit",
        paths.routing,
        "--routing-probe-preflight",
        paths.preflight,
        "--github-routing-secrets",
        paths.githubSecrets,
        "--views-audit",
        paths.views,
        "--rules-audit",
        paths.rules,
        "--out",
        paths.out,
      ]);

      expect(result.status).toBe(0);
      const out = readJson<{
        requirements: {
          routingProbeReady: boolean;
          routingProbePreflightReady: boolean;
          routingProbeGithubSecretsReady: boolean;
          currentSharedGmailRoutingReady: boolean;
          defaultViewsRealDataValidated: boolean;
          defaultViewsManualReviewOnly: boolean;
          defaultViewsBulkAutomationSafe: boolean;
        };
        gate: {
          productionReady: boolean;
          p0Blockers: string[];
        };
        blockers: Array<{
          id: string;
          evidence?: {
            routingProbePreflight?: {
              missingRequiredEnv?: string[];
              readyForProductionProof?: boolean;
            };
            routingProbeGithubSecrets?: {
              missingSendVerifySecrets?: string[];
              readyForSendVerify?: boolean;
            };
          };
        }>;
      }>(paths.out);
      expect(out.requirements.routingProbeReady).toBe(false);
      expect(out.requirements.routingProbePreflightReady).toBe(false);
      expect(out.requirements.routingProbeGithubSecretsReady).toBe(false);
      expect(out.requirements.currentSharedGmailRoutingReady).toBe(false);
      expect(out.requirements.defaultViewsRealDataValidated).toBe(true);
      expect(out.requirements.defaultViewsManualReviewOnly).toBe(true);
      expect(out.requirements.defaultViewsBulkAutomationSafe).toBe(false);
      expect(out.gate.productionReady).toBe(false);
      expect(out.gate.p0Blockers).toEqual(["current_shared_gmail_routing"]);
      expect(out.blockers[0]?.evidence?.routingProbePreflight?.missingRequiredEnv).toEqual([
        "MAILHUB_PROBE_SMTP_HOST",
        "MAILHUB_PROBE_FROM",
      ]);
      expect(out.blockers[0]?.evidence?.routingProbeGithubSecrets?.missingSendVerifySecrets).toEqual([
        "MAILHUB_PROBE_SMTP_HOST",
        "MAILHUB_PROBE_FROM",
      ]);
    });
  });

  test("production readiness accepts complete address-level probe evidence", () => {
    withTempDir((dir) => {
      const paths = writeReadinessFixtures(dir, {
        markerProvided: true,
        targetChannelCount: 2,
        targetAddressCount: 3,
        matchedChannels: ["multi-source", "single-source"],
        missingChannels: [],
        matchedAddresses: ["first@example.com", "second@example.com", "third@example.com"],
        missingAddresses: [],
        allExpectedChannelsConfirmed: true,
        allExpectedAddressesConfirmed: true,
      });

      const result = runNodeScript(readinessAuditPath, [
        "--source-audit",
        paths.source,
        "--ops-audit",
        paths.ops,
        "--gws-routing-audit",
        paths.gws,
        "--routing-probe-audit",
        paths.routing,
        "--github-routing-secrets",
        paths.githubSecrets,
        "--views-audit",
        paths.views,
        "--rules-audit",
        paths.rules,
        "--out",
        paths.out,
      ]);

      expect(result.status).toBe(0);
      const out = readJson<{
        requirements: {
          routingProbeReady: boolean;
          currentSharedGmailRoutingReady: boolean;
        };
        gate: {
          productionReady: boolean;
          p0Blockers: string[];
        };
      }>(paths.out);
      expect(out.requirements.routingProbeReady).toBe(true);
      expect(out.requirements.currentSharedGmailRoutingReady).toBe(true);
      expect(out.gate.productionReady).toBe(true);
      expect(out.gate.p0Blockers).toEqual([]);
    });
  });

  test("routing probe sender dry-run writes the address plan without sending", () => {
    withTempDir((dir) => {
      const opsPath = join(dir, "ops.json");
      const outPath = join(dir, "send-plan.json");
      writeJson(opsPath, opsAuditFixture());

      const result = runNodeScript(routingProbeSenderPath, [
        "--ops-audit",
        opsPath,
        "--out",
        outPath,
        "--marker",
        "MAILHUB-ROUTING-PROBE-FIXTURE",
      ]);

      expect(result.status).toBe(0);
      const out = readJson<{
        mode: string;
        marker: string;
        probeCount: number;
        addressProbes: Array<{ address: string }>;
        sent: unknown[];
        verification: unknown | null;
        nextVerificationCommand: string;
        nextReadinessCommand: string;
      }>(outPath);
      expect(out.mode).toBe("dry_run");
      expect(out.marker).toBe("MAILHUB-ROUTING-PROBE-FIXTURE");
      expect(out.probeCount).toBe(3);
      expect(out.addressProbes.map((item) => item.address)).toEqual([
        "first@example.com",
        "second@example.com",
        "third@example.com",
      ]);
      expect(out.sent).toEqual([]);
      expect(out.verification).toBeNull();
      expect(out.nextVerificationCommand).toContain("MAILHUB-ROUTING-PROBE-FIXTURE");
      expect(out.nextReadinessCommand).toContain("audit:mailhub-readiness");
    });
  });

  test("routing probe preflight reports missing SMTP env without sending", () => {
    withTempDir((dir) => {
      const opsPath = join(dir, "ops.json");
      const outPath = join(dir, "send-plan.json");
      writeJson(opsPath, opsAuditFixture());

      const result = runNodeScript(
        routingProbeSenderPath,
        ["--ops-audit", opsPath, "--out", outPath, "--preflight"],
        {
          MAILHUB_PROBE_SMTP_HOST: " ",
          MAILHUB_PROBE_SMTP_USER: " ",
          MAILHUB_PROBE_SMTP_PASS: " ",
          MAILHUB_PROBE_FROM: " ",
        },
      );

      expect(result.status).toBe(0);
      const out = readJson<{
        mode: string;
        sent: unknown[];
        smtpPreflight: {
          missingRequiredEnv: string[];
          readyForSend: boolean;
          readyForProductionProof: boolean;
        };
      }>(outPath);
      expect(out.mode).toBe("preflight");
      expect(out.sent).toEqual([]);
      expect(out.smtpPreflight.readyForSend).toBe(false);
      expect(out.smtpPreflight.readyForProductionProof).toBe(false);
      expect(out.smtpPreflight.missingRequiredEnv).toEqual([
        "MAILHUB_PROBE_SMTP_HOST",
        "MAILHUB_PROBE_SMTP_USER",
        "MAILHUB_PROBE_SMTP_PASS",
        "MAILHUB_PROBE_FROM",
      ]);
    });
  });

  test("routing probe preflight accepts non-vtj external SMTP proof configuration", () => {
    withTempDir((dir) => {
      const opsPath = join(dir, "ops.json");
      const outPath = join(dir, "send-plan.json");
      writeJson(opsPath, opsAuditFixture());

      const result = runNodeScript(
        routingProbeSenderPath,
        ["--ops-audit", opsPath, "--out", outPath, "--preflight"],
        {
          MAILHUB_PROBE_SMTP_HOST: "smtp.example.com",
          MAILHUB_PROBE_SMTP_PORT: "587",
          MAILHUB_PROBE_SMTP_SECURE: "false",
          MAILHUB_PROBE_SMTP_USER: "probe-user",
          MAILHUB_PROBE_SMTP_PASS: "probe-pass",
          MAILHUB_PROBE_FROM: "external-probe@example.com",
        },
      );

      expect(result.status).toBe(0);
      const serialized = readFileSync(outPath, "utf8");
      const out = readJson<{
        mode: string;
        sent: unknown[];
        smtpPreflight: {
          missingRequiredEnv: string[];
          from: string | null;
          fromDomain: string | null;
          fromIsVtj: boolean;
          readyForSend: boolean;
          readyForProductionProof: boolean;
          warnings: string[];
        };
      }>(outPath);
      expect(out.mode).toBe("preflight");
      expect(out.sent).toEqual([]);
      expect(out.smtpPreflight.missingRequiredEnv).toEqual([]);
      expect(out.smtpPreflight.from).toBe("e***@example.com");
      expect(out.smtpPreflight.fromDomain).toBe("example.com");
      expect(out.smtpPreflight.fromIsVtj).toBe(false);
      expect(out.smtpPreflight.readyForSend).toBe(true);
      expect(out.smtpPreflight.readyForProductionProof).toBe(true);
      expect(out.smtpPreflight.warnings).toEqual([]);
      expect(serialized).not.toContain("probe-user");
      expect(serialized).not.toContain("probe-pass");
      expect(result.stdout).not.toContain("probe-user");
      expect(result.stdout).not.toContain("probe-pass");
      expect(result.stderr).not.toContain("probe-user");
      expect(result.stderr).not.toContain("probe-pass");
    });
  });

  test("routing probe preflight keeps vtj.co.jp smoke senders out of production proof", () => {
    withTempDir((dir) => {
      const opsPath = join(dir, "ops.json");
      const outPath = join(dir, "send-plan.json");
      writeJson(opsPath, opsAuditFixture());

      const result = runNodeScript(
        routingProbeSenderPath,
        ["--ops-audit", opsPath, "--out", outPath, "--preflight", "--allow-vtj-from"],
        {
          MAILHUB_PROBE_SMTP_HOST: "smtp.example.com",
          MAILHUB_PROBE_SMTP_PORT: "587",
          MAILHUB_PROBE_SMTP_SECURE: "false",
          MAILHUB_PROBE_SMTP_USER: "probe-user",
          MAILHUB_PROBE_SMTP_PASS: "probe-pass",
          MAILHUB_PROBE_FROM: "Probe <probe@vtj.co.jp>",
        },
      );

      expect(result.status).toBe(0);
      const out = readJson<{
        mode: string;
        smtpPreflight: {
          from: string | null;
          fromDomain: string | null;
          fromIsVtj: boolean;
          readyForSend: boolean;
          readyForProductionProof: boolean;
          warnings: string[];
        };
      }>(outPath);
      expect(out.mode).toBe("preflight");
      expect(out.smtpPreflight.from).toBe("p***@vtj.co.jp");
      expect(out.smtpPreflight.fromDomain).toBe("vtj.co.jp");
      expect(out.smtpPreflight.fromIsVtj).toBe(true);
      expect(out.smtpPreflight.readyForSend).toBe(true);
      expect(out.smtpPreflight.readyForProductionProof).toBe(false);
      expect(out.smtpPreflight.warnings).toContain("vtj_from_not_external_route_proof");
      expect(out.smtpPreflight.warnings).toContain("allow_vtj_from_is_smoke_only_not_production_proof");
    });
  });

  test("routing probe sender requires --send before --verify-after-send", () => {
    withTempDir((dir) => {
      const opsPath = join(dir, "ops.json");
      const outPath = join(dir, "send-plan.json");
      writeJson(opsPath, opsAuditFixture());

      const result = runNodeScript(routingProbeSenderPath, [
        "--ops-audit",
        opsPath,
        "--out",
        outPath,
        "--verify-after-send",
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("verify_after_send_requires_send");
    });
  });

  test("routing probe sender rejects vtj.co.jp senders as external-route proof by default", () => {
    withTempDir((dir) => {
      const opsPath = join(dir, "ops.json");
      const outPath = join(dir, "send-plan.json");
      writeJson(opsPath, opsAuditFixture());

      const result = runNodeScript(
        routingProbeSenderPath,
        ["--ops-audit", opsPath, "--out", outPath, "--send"],
        { MAILHUB_PROBE_FROM: "Probe <probe@vtj.co.jp>" },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("vtj_from_not_external_route_proof");
    });
  });
});
