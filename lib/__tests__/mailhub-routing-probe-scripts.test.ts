import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { execFileSync, spawn, spawnSync } from "child_process";
import { describe, expect, test } from "vitest";
import { createHash } from "crypto";

const routingProbeAuditPath = resolve(process.cwd(), "scripts/audit-mailhub-routing-probes.mjs");
const readinessAuditPath = resolve(process.cwd(), "scripts/audit-mailhub-production-readiness.mjs");
const routingProbeSenderPath = resolve(process.cwd(), "scripts/send-mailhub-routing-probes.mjs");
const routingProbeSecretsPath = resolve(process.cwd(), "scripts/check-mailhub-routing-probe-secrets.mjs");
const routingSecretContractPath = resolve(process.cwd(), "scripts/check-mailhub-routing-secret-readiness-contract.mjs");
const routingNextStepsPath = resolve(process.cwd(), "scripts/write-mailhub-routing-next-steps.mjs");
const routingNextContractPath = resolve(process.cwd(), "scripts/check-mailhub-routing-next-contract.mjs");
const routingProofContractPath = resolve(process.cwd(), "scripts/check-mailhub-routing-proof-contract.mjs");
const routingSecretSetupPath = resolve(process.cwd(), "scripts/setup-mailhub-routing-probe-secrets.mjs");
const readinessRefreshPath = resolve(process.cwd(), "scripts/refresh-mailhub-readiness-artifacts.mjs");
const routingProbeWorkflowPath = resolve(process.cwd(), ".github/workflows/mailhub-routing-probe.yml");

function currentAlertWorkflowSha256() {
  return createHash("sha256")
    .update(readFileSync(resolve(process.cwd(), ".github/workflows/mailhub-alerts.yml"), "utf8"))
    .digest("hex");
}

function formatRoutingProbeMarker(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    "MAILHUB-ROUTING-PROBE-",
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "T",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    "Z",
  ].join("");
}

const freshFixtureTimestamp = new Date().toISOString();
const routingProbeMarker = formatRoutingProbeMarker(new Date(freshFixtureTimestamp));
const canonicalRoutingProbeAddresses = [
  "gopro_y@vtj.co.jp",
  "gopro_order_yahoo@vtj.co.jp",
  "vyper_r@vtj.co.jp",
  "vyper_rakuten@vtj.co.jp",
  "vyperglobal_y@vtj.co.jp",
  "ams_vyper@vtj.co.jp",
  "datacolor_shopify@vtj.co.jp",
  "ebay@vtj.co.jp",
];
const canonicalRoutingProbePlan = canonicalRoutingProbeAddresses.map((address, index) => ({
  channelId: `channel-${index}`,
  label: `Channel ${index}`,
  address,
  subject: routingProbeMarker,
}));
const nonCanonicalRoutingProbeAddresses = canonicalRoutingProbeAddresses.map((_, index) => `noncanonical_${index}@vtj.co.jp`);
const nonCanonicalRoutingProbePlan = nonCanonicalRoutingProbeAddresses.map((address, index) => ({
  channelId: `noncanonical-channel-${index}`,
  label: `Noncanonical Channel ${index}`,
  address,
  subject: routingProbeMarker,
}));

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "mailhub-routing-probes-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function withTempDirAsync<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "mailhub-routing-probes-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readEventually(path: string, timeoutMs = 5000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = readFileSync(path, "utf8").trim();
      if (value) return value;
    } catch {
      // Wait for the child process to create the file.
    }
    await delay(25);
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function stopChild(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill();
  });
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function currentRepoHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function git(repoRoot: string, args: string[]) {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function writeRepoFile(repoRoot: string, relativePath: string, content: string) {
  const path = join(repoRoot, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function commitRepo(repoRoot: string, message: string) {
  git(repoRoot, ["add", "."]);
  git(repoRoot, ["commit", "-m", message]);
  return git(repoRoot, ["rev-parse", "HEAD"]);
}

function withTempGitRepo<T>(fn: (repo: { dir: string; parentHead: string }) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "mailhub-routing-probes-git-"));
  try {
    git(dir, ["init"]);
    git(dir, ["config", "user.name", "MailHub Test"]);
    git(dir, ["config", "user.email", "mailhub-test@example.com"]);
    writeRepoFile(dir, "lib/app.ts", "export const version = 1;\n");
    const parentHead = commitRepo(dir, "base");
    return fn({ dir, parentHead });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function runNodeScript(
  scriptPath: string,
  args: string[],
  env: Partial<NodeJS.ProcessEnv> = {},
  options: { cwd?: string } = {},
) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

async function withLocalSmtpServer<T>(
  dir: string,
  fn: (server: { port: number }) => Promise<T>,
): Promise<T> {
  const serverPath = join(dir, "fake-smtp-server.mjs");
  const portPath = join(dir, "fake-smtp-port.txt");
  writeFileSync(
    serverPath,
    [
      "import { writeFileSync } from 'node:fs';",
      "import net from 'node:net';",
      "",
      "const portFile = process.env.MAILHUB_SMTP_PORT_FILE;",
      "function write(socket, line) { socket.write(`${line}\\r\\n`); }",
      "",
      "const server = net.createServer((socket) => {",
      "  let buffer = '';",
      "  let inData = false;",
      "  let loginStep = null;",
      "",
      "  function handle(line) {",
      "    const upper = line.toUpperCase();",
      "    if (inData) {",
      "      if (line === '.') {",
      "        inData = false;",
      "        write(socket, '250 queued');",
      "      }",
      "      return;",
      "    }",
      "    if (loginStep === 'user') {",
      "      loginStep = 'pass';",
      "      write(socket, '334 UGFzc3dvcmQ6');",
      "      return;",
      "    }",
      "    if (loginStep === 'pass') {",
      "      loginStep = null;",
      "      write(socket, '235 authenticated');",
      "      return;",
      "    }",
      "    if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {",
      "      socket.write('250-localhost\\r\\n250-AUTH PLAIN LOGIN\\r\\n250 OK\\r\\n');",
      "    } else if (upper.startsWith('AUTH PLAIN')) {",
      "      write(socket, '235 authenticated');",
      "    } else if (upper === 'AUTH LOGIN') {",
      "      loginStep = 'user';",
      "      write(socket, '334 VXNlcm5hbWU6');",
      "    } else if (upper.startsWith('AUTH LOGIN ')) {",
      "      loginStep = 'pass';",
      "      write(socket, '334 UGFzc3dvcmQ6');",
      "    } else if (upper.startsWith('MAIL FROM:') || upper.startsWith('RCPT TO:') || upper === 'RSET' || upper === 'NOOP') {",
      "      write(socket, '250 ok');",
      "    } else if (upper === 'DATA') {",
      "      inData = true;",
      "      write(socket, '354 end with dot');",
      "    } else if (upper === 'QUIT') {",
      "      write(socket, '221 bye');",
      "      socket.end();",
      "    } else {",
      "      write(socket, '250 ok');",
      "    }",
      "  }",
      "",
      "  write(socket, '220 local mailhub smtp fixture');",
      "  socket.on('data', (chunk) => {",
      "    buffer += chunk.toString('utf8');",
      "    let index;",
      "    while ((index = buffer.indexOf('\\n')) >= 0) {",
      "      const line = buffer.slice(0, index).replace(/\\r$/, '');",
      "      buffer = buffer.slice(index + 1);",
      "      handle(line);",
      "    }",
      "  });",
      "});",
      "",
      "server.listen(0, '127.0.0.1', () => {",
      "  const address = server.address();",
      "  writeFileSync(portFile, String(address.port));",
      "});",
      "process.on('SIGTERM', () => server.close(() => process.exit(0)));",
      "process.on('SIGINT', () => server.close(() => process.exit(0)));",
    ].join("\n"),
    "utf8",
  );
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, MAILHUB_SMTP_PORT_FILE: portPath },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  try {
    const port = Number(await readEventually(portPath));
    if (!Number.isInteger(port) || port <= 0) throw new Error(`invalid SMTP fixture port: ${port}`);
    return await fn({ port });
  } catch (error) {
    if (stderr) throw new Error(`${error instanceof Error ? error.message : String(error)}\n${stderr}`);
    throw error;
  } finally {
    await stopChild(child);
  }
}

const missingLocalGmailEnv = {
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  GOOGLE_SHARED_INBOX_EMAIL: "",
  GOOGLE_SHARED_INBOX_REFRESH_TOKEN: "",
};

function opsAuditFixture() {
  return {
    generatedAt: freshFixtureTimestamp,
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

function opsAuditFixtureFromProbePlan(
  probePlan: Array<{ channelId: string; label: string; address: string }>,
) {
  const ids = probePlan.map((probe) => probe.channelId);
  return {
    generatedAt: freshFixtureTimestamp,
    gate: {
      sourceInventoryMissing: [],
      productionCompleteClaimReady: false,
      currentSharedGmailRoutingUnconfirmed: ids,
      noSharedInboxEvidence: ids,
      routingConfirmationRequired: ids,
    },
    operationalConfirmations: probePlan.map((probe) => ({
      id: probe.channelId,
      label: probe.label,
      addresses: [probe.address],
    })),
  };
}

function writeReadinessFixtures(
  dir: string,
  routingProbeGate: Record<string, unknown>,
  options: {
    staffWorkflowReady?: boolean;
    routingSendReady?: boolean;
    routingProbeAddressPlan?: Array<{ channelId: string; label: string; address: string; subject?: string }>;
  } = {},
) {
  const staffWorkflowReady = options.staffWorkflowReady === true;
  const routingSendReady = options.routingSendReady === true;
  const repoHead = currentRepoHead();
  const marker = routingProbeMarker;
  const routingProbeAddresses = ["first@example.com", "second@example.com", "third@example.com"];
  const routingProbeAddressPlan = options.routingProbeAddressPlan ?? routingProbeAddresses.map((address, index) => ({
    channelId: index < 2 ? "multi-source" : "single-source",
    label: index < 2 ? "Multi Source" : "Single Source",
    address,
    subject: marker,
  }));
  const presentRoutingSecretNames = routingSendReady
    ? [
        "MAILHUB_PROBE_SMTP_HOST",
        "MAILHUB_PROBE_SMTP_USER",
        "MAILHUB_PROBE_SMTP_PASS",
        "MAILHUB_PROBE_FROM",
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "GOOGLE_SHARED_INBOX_EMAIL",
        "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
      ]
    : [
        "MAILHUB_PROBE_SMTP_USER",
        "MAILHUB_PROBE_SMTP_PASS",
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "GOOGLE_SHARED_INBOX_EMAIL",
        "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
      ];
  const paths = {
    source: join(dir, "source.json"),
    ops: join(dir, "ops.json"),
    gws: join(dir, "gws.json"),
    routing: join(dir, "routing.json"),
    send: join(dir, "send.json"),
    preflight: join(dir, "preflight.json"),
    githubSecrets: join(dir, "github-secrets.json"),
    githubStaffSecrets: join(dir, "github-staff-secrets.json"),
    views: join(dir, "views.json"),
    rules: join(dir, "rules.json"),
    staffWorkflow: join(dir, "staff-workflow.json"),
    out: join(dir, "readiness.json"),
  };
  writeJson(paths.source, {
    generatedAt: freshFixtureTimestamp,
    repoHead,
    zeroEstimateAnalysis: {
      knownCodeGaps: [],
      coverageGate: { codeCoveragePass: true },
    },
  });
  writeJson(paths.ops, {
    ...opsAuditFixture(),
    generatedAt: freshFixtureTimestamp,
    repoHead,
  });
  writeJson(paths.gws, {
    generatedAt: freshFixtureTimestamp,
    repoHead,
    gate: {
      currentSharedGmailRoutingConfirmed: false,
    },
    dns: {
      mxRecords: [{ exchange: "mx01.lolipop.jp", priority: 50 }],
    },
  });
  writeJson(paths.routing, {
    generatedAt: freshFixtureTimestamp,
    repoHead,
    inputs: {
      marker: routingProbeGate.markerProvided === true ? marker : null,
    },
    mode: routingProbeGate.markerProvided === true ? "verify_marker" : "plan_only",
    plannedAddressProbes: routingProbeAddressPlan.map(({ channelId, label, address }) => ({ channelId, label, address })),
    gate: routingProbeGate,
  });
  writeJson(paths.send, {
    generatedAt: freshFixtureTimestamp,
    repoHead,
    mode: routingSendReady ? "sent" : "dry_run",
    marker,
    inputs: {
      preflight: false,
      verifyAfterSend: routingSendReady,
    },
    smtpPreflight: {
      missingRequiredEnv: routingSendReady ? [] : ["MAILHUB_PROBE_SMTP_HOST", "MAILHUB_PROBE_FROM"],
      readyForSend: routingSendReady,
      readyForProductionProof: routingSendReady,
      fromIsVtj: false,
      warnings: [],
    },
    probeCount: routingProbeAddressPlan.length,
    addressProbes: routingProbeAddressPlan,
    sent: routingSendReady
      ? routingProbeAddressPlan.map(({ channelId, address }, index) => ({
          channelId,
          address,
          accepted: [address],
          rejected: [],
          messageId: `fixture-message-${index}`,
        }))
      : [],
    verification: routingSendReady
      ? {
          status: "matched",
          allExpectedAddressesConfirmed: true,
          productionReady: true,
          p0Blockers: [],
        }
      : null,
  });
  writeJson(paths.preflight, {
    generatedAt: freshFixtureTimestamp,
    repoHead,
    smtpPreflight: {
      missingRequiredEnv: routingSendReady ? [] : ["MAILHUB_PROBE_SMTP_HOST", "MAILHUB_PROBE_FROM"],
      readyForSend: routingSendReady,
      readyForProductionProof: routingSendReady,
      warnings: [],
    },
  });
  writeJson(paths.githubSecrets, {
    checkedAt: freshFixtureTimestamp,
    repoHead,
    source: "github_actions_secrets",
    secretCount: presentRoutingSecretNames.length,
    readyForPreflightProductionProof: routingSendReady,
    readyForSendVerify: routingSendReady,
    missingPreflightSecrets: routingSendReady ? [] : ["MAILHUB_PROBE_SMTP_HOST", "MAILHUB_PROBE_FROM"],
    missingSendVerifySecrets: routingSendReady ? [] : ["MAILHUB_PROBE_SMTP_HOST", "MAILHUB_PROBE_FROM"],
    secretGroups: {
      externalSmtpProof: {
        required: [
          "MAILHUB_PROBE_SMTP_HOST",
          "MAILHUB_PROBE_SMTP_USER",
          "MAILHUB_PROBE_SMTP_PASS",
          "MAILHUB_PROBE_FROM",
        ],
        present: presentRoutingSecretNames.filter((name) => name.startsWith("MAILHUB_PROBE_")),
        missing: routingSendReady ? [] : ["MAILHUB_PROBE_SMTP_HOST", "MAILHUB_PROBE_FROM"],
        ready: routingSendReady,
      },
      gmailProof: {
        required: [
          "GOOGLE_CLIENT_ID",
          "GOOGLE_CLIENT_SECRET",
          "GOOGLE_SHARED_INBOX_EMAIL",
          "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
        ],
        present: [
          "GOOGLE_CLIENT_ID",
          "GOOGLE_CLIENT_SECRET",
          "GOOGLE_SHARED_INBOX_EMAIL",
          "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
        ],
        missing: [],
        ready: true,
      },
    },
    presentRequiredSecretNames: presentRoutingSecretNames,
  });
  writeJson(paths.githubStaffSecrets, {
    checkedAt: freshFixtureTimestamp,
    repoHead,
    source: "github_actions_config",
    secretCount: staffWorkflowReady ? 4 : 0,
    variableCount: staffWorkflowReady ? 11 : 0,
    requiredProductionStaffConfig: [
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
      "MAILHUB_SHEETS_ID or MAILHUB_SHEETS_SPREADSHEET_ID",
      "MAILHUB_SHEETS_CLIENT_EMAIL",
      "MAILHUB_SHEETS_PRIVATE_KEY",
      "MAILHUB_READ_ONLY",
    ],
    requiredSecretConfig: [
      "NEXTAUTH_SECRET",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
      "MAILHUB_SHEETS_PRIVATE_KEY",
    ],
    missingProductionStaffConfig: staffWorkflowReady ? [] : ["MAILHUB_ENV", "NEXTAUTH_SECRET"],
    missingSecretConfig: staffWorkflowReady ? [] : ["NEXTAUTH_SECRET"],
    semanticIssues: [],
    readyForSecretBackedStaffConfig: staffWorkflowReady,
    readyForProductionStaffPreflight: staffWorkflowReady,
    readyForProductionAlerts: true,
    missingAlertAutomationConfig: [],
    alertAutomationWorkflow: {
      path: ".github/workflows/mailhub-alerts.yml",
      sha256: currentAlertWorkflowSha256(),
      ready: true,
      missing: [],
    },
    setupCommands: staffWorkflowReady ? [] : [
      "npm run setup:mailhub-staff-github-config",
      "npm run setup:mailhub-staff-github-config -- --apply --confirm-apply APPLY_MAILHUB_STAFF_GITHUB_CONFIG",
    ],
    presentRequiredConfigNames: staffWorkflowReady
      ? [
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
          "MAILHUB_SHEETS_ID or MAILHUB_SHEETS_SPREADSHEET_ID",
          "MAILHUB_SHEETS_CLIENT_EMAIL",
          "MAILHUB_SHEETS_PRIVATE_KEY",
          "MAILHUB_READ_ONLY",
        ]
      : [],
    presentRequiredConfigSources: staffWorkflowReady
      ? {
          MAILHUB_ENV: "variable",
          NEXTAUTH_URL: "variable",
          NEXTAUTH_SECRET: "secret",
          GOOGLE_CLIENT_ID: "variable",
          GOOGLE_CLIENT_SECRET: "secret",
          GOOGLE_SHARED_INBOX_EMAIL: "variable",
          GOOGLE_SHARED_INBOX_REFRESH_TOKEN: "secret",
          MAILHUB_ADMINS: "variable",
          MAILHUB_TEAM_MEMBERS: "variable",
          MAILHUB_CONFIG_STORE: "variable",
          MAILHUB_ACTIVITY_STORE: "variable",
          MAILHUB_SHEETS_ID: "variable",
          MAILHUB_SHEETS_CLIENT_EMAIL: "variable",
          MAILHUB_SHEETS_PRIVATE_KEY: "secret",
          MAILHUB_READ_ONLY: "variable",
        }
      : {},
  });
  writeJson(paths.views, {
    generatedAt: freshFixtureTimestamp,
    repoHead,
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
    generatedAt: freshFixtureTimestamp,
    repoHead,
    inputs: {
      envFile: ".env.local",
      envFileLoaded: true,
      envFileMode: "env_file",
      valuePolicy: "fixture",
    },
    config: {
      requestedSource: "sheets",
      resolvedSource: "sheets",
      warnings: [],
      ruleSetFingerprint: "sha256:fixture-rules",
    },
    ruleSafetyGate: { realDataRuleRiskPass: true },
  });
  writeJson(paths.staffWorkflow, {
    generatedAt: freshFixtureTimestamp,
    repoHead,
    config: {
      alertsSecretConfigured: true,
      alerts: {
        provider: "chatwork",
        providerAllowed: true,
        providerConfigured: true,
        alertsSecretConfigured: true,
        slackWebhookConfigured: false,
        chatworkTokenConfigured: true,
        chatworkRoomConfigured: true,
        missing: [],
        productionAlertsReady: true,
      },
    },
    gate: {
      staffWorkflowPermissionsReady: staffWorkflowReady,
      readOnlyRolloutReady: staffWorkflowReady,
      controlledWritePilotReady: staffWorkflowReady,
      p0Blockers: [],
      p1Blockers: staffWorkflowReady ? [] : ["write_pilot_evidence_missing"],
    },
    requirements: {
      productionEnvReady: staffWorkflowReady,
      adminsReady: staffWorkflowReady,
      assigneeRosterReady: staffWorkflowReady,
      durableConfigReady: staffWorkflowReady,
      durableActivityReady: staffWorkflowReady,
      readOnlyRolloutEvidenceReady: staffWorkflowReady,
      writePilotEvidenceReady: staffWorkflowReady,
      readOnlyRolloutReady: staffWorkflowReady,
      controlledWritePilotReady: staffWorkflowReady,
      staffWorkflowPermissionsReady: staffWorkflowReady,
    },
    blockers: staffWorkflowReady
      ? []
      : [{ id: "write_pilot_evidence_missing", severity: "P1", message: "fixture missing write evidence" }],
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
        secretGroups: {
          externalSmtpProof: { missing: string[]; ready: boolean };
          gmailProof: { missing: string[]; ready: boolean };
        };
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
      expect(out.secretGroups.externalSmtpProof).toMatchObject({
        ready: false,
        missing: [
          "MAILHUB_PROBE_SMTP_HOST",
          "MAILHUB_PROBE_SMTP_USER",
          "MAILHUB_PROBE_SMTP_PASS",
          "MAILHUB_PROBE_FROM",
        ],
      });
      expect(out.secretGroups.gmailProof).toMatchObject({
        ready: false,
        missing: [
          "GOOGLE_CLIENT_ID",
          "GOOGLE_CLIENT_SECRET",
          "GOOGLE_SHARED_INBOX_EMAIL",
          "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
        ],
      });
      expect(out.presentRequiredSecretNames).toEqual([]);
    });
  });

  test("GitHub routing secret readiness contract accepts grouped readiness artifact", () => {
    withTempDir((dir) => {
      const artifactPath = join(dir, "github-routing-secrets-readiness.json");
      writeJson(artifactPath, {
        repo: "vyper-japan/mailhub",
        source: "github_actions_secrets",
        checkedAt: "2026-06-17T00:00:00.000Z",
        secretCount: 4,
        requiredPreflightSecrets: [
          "MAILHUB_PROBE_SMTP_HOST",
          "MAILHUB_PROBE_SMTP_USER",
          "MAILHUB_PROBE_SMTP_PASS",
          "MAILHUB_PROBE_FROM",
        ],
        requiredSendVerifySecrets: [
          "GOOGLE_CLIENT_ID",
          "GOOGLE_CLIENT_SECRET",
          "GOOGLE_SHARED_INBOX_EMAIL",
          "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
          "MAILHUB_PROBE_SMTP_HOST",
          "MAILHUB_PROBE_SMTP_USER",
          "MAILHUB_PROBE_SMTP_PASS",
          "MAILHUB_PROBE_FROM",
        ],
        optionalSecrets: ["MAILHUB_PROBE_SMTP_PORT", "MAILHUB_PROBE_SMTP_SECURE"],
        configuredOptionalSecrets: [],
        missingPreflightSecrets: [
          "MAILHUB_PROBE_SMTP_HOST",
          "MAILHUB_PROBE_SMTP_USER",
          "MAILHUB_PROBE_SMTP_PASS",
          "MAILHUB_PROBE_FROM",
        ],
        missingSendVerifySecrets: [
          "MAILHUB_PROBE_SMTP_HOST",
          "MAILHUB_PROBE_SMTP_USER",
          "MAILHUB_PROBE_SMTP_PASS",
          "MAILHUB_PROBE_FROM",
        ],
        readyForPreflightProductionProof: false,
        readyForSendVerify: false,
        secretGroups: {
          externalSmtpProof: {
            required: [
              "MAILHUB_PROBE_SMTP_HOST",
              "MAILHUB_PROBE_SMTP_USER",
              "MAILHUB_PROBE_SMTP_PASS",
              "MAILHUB_PROBE_FROM",
            ],
            present: [],
            missing: [
              "MAILHUB_PROBE_SMTP_HOST",
              "MAILHUB_PROBE_SMTP_USER",
              "MAILHUB_PROBE_SMTP_PASS",
              "MAILHUB_PROBE_FROM",
            ],
            ready: false,
          },
          gmailProof: {
            required: [
              "GOOGLE_CLIENT_ID",
              "GOOGLE_CLIENT_SECRET",
              "GOOGLE_SHARED_INBOX_EMAIL",
              "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
            ],
            present: [
              "GOOGLE_CLIENT_ID",
              "GOOGLE_CLIENT_SECRET",
              "GOOGLE_SHARED_INBOX_EMAIL",
              "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
            ],
            missing: [],
            ready: true,
          },
        },
        presentRequiredSecretNames: [
          "GOOGLE_CLIENT_ID",
          "GOOGLE_CLIENT_SECRET",
          "GOOGLE_SHARED_INBOX_EMAIL",
          "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
        ],
        note: "Only GitHub secret names and updatedAt metadata were read; secret values are never accessible or printed.",
      });

      const result = runNodeScript(routingSecretContractPath, ["--artifact", artifactPath]);

      expect(result.status).toBe(0);
      const out = JSON.parse(result.stdout) as { ok: boolean; errors: string[] };
      expect(out.ok).toBe(true);
      expect(out.errors).toEqual([]);
    });
  });

  test("GitHub routing secret readiness contract rejects contradictory grouped readiness", () => {
    withTempDir((dir) => {
      const artifactPath = join(dir, "github-routing-secrets-readiness.json");
      writeJson(artifactPath, {
        repo: "vyper-japan/mailhub",
        source: "github_actions_secrets",
        checkedAt: "2026-06-17T00:00:00.000Z",
        secretCount: 4,
        requiredPreflightSecrets: [
          "MAILHUB_PROBE_SMTP_HOST",
          "MAILHUB_PROBE_SMTP_USER",
          "MAILHUB_PROBE_SMTP_PASS",
          "MAILHUB_PROBE_FROM",
        ],
        requiredSendVerifySecrets: [
          "GOOGLE_CLIENT_ID",
          "GOOGLE_CLIENT_SECRET",
          "GOOGLE_SHARED_INBOX_EMAIL",
          "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
          "MAILHUB_PROBE_SMTP_HOST",
          "MAILHUB_PROBE_SMTP_USER",
          "MAILHUB_PROBE_SMTP_PASS",
          "MAILHUB_PROBE_FROM",
        ],
        optionalSecrets: ["MAILHUB_PROBE_SMTP_PORT", "MAILHUB_PROBE_SMTP_SECURE"],
        configuredOptionalSecrets: [],
        missingPreflightSecrets: [],
        missingSendVerifySecrets: [],
        readyForPreflightProductionProof: true,
        readyForSendVerify: true,
        secretGroups: {
          externalSmtpProof: {
            required: [
              "MAILHUB_PROBE_SMTP_HOST",
              "MAILHUB_PROBE_SMTP_USER",
              "MAILHUB_PROBE_SMTP_PASS",
              "MAILHUB_PROBE_FROM",
            ],
            present: [],
            missing: [
              "MAILHUB_PROBE_SMTP_HOST",
              "MAILHUB_PROBE_SMTP_USER",
              "MAILHUB_PROBE_SMTP_PASS",
              "MAILHUB_PROBE_FROM",
            ],
            ready: true,
          },
          gmailProof: {
            required: [
              "GOOGLE_CLIENT_ID",
              "GOOGLE_CLIENT_SECRET",
              "GOOGLE_SHARED_INBOX_EMAIL",
              "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
            ],
            present: [
              "GOOGLE_CLIENT_ID",
              "GOOGLE_CLIENT_SECRET",
              "GOOGLE_SHARED_INBOX_EMAIL",
              "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
            ],
            missing: [],
            ready: true,
          },
        },
        presentRequiredSecretNames: [
          "GOOGLE_CLIENT_ID",
          "GOOGLE_CLIENT_SECRET",
          "GOOGLE_SHARED_INBOX_EMAIL",
          "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
        ],
      });

      const result = runNodeScript(routingSecretContractPath, ["--artifact", artifactPath]);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("secret_group_ready_mismatch:externalSmtpProof");
      expect(result.stdout).toContain("missing_preflight_secrets_mismatch");
      expect(result.stdout).toContain("missing_send_verify_secrets_mismatch");
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
        secretGroups: {
          externalSmtpProof: { missing: string[]; ready: boolean };
          gmailProof: { missing: string[]; ready: boolean };
        };
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
      expect(out.secretGroups.externalSmtpProof).toMatchObject({ ready: true, missing: [] });
      expect(out.secretGroups.gmailProof).toMatchObject({
        ready: false,
        missing: [
          "GOOGLE_CLIENT_ID",
          "GOOGLE_CLIENT_SECRET",
          "GOOGLE_SHARED_INBOX_EMAIL",
          "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
        ],
      });
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
        secretGroups: {
          externalSmtpProof: { missing: string[]; ready: boolean };
          gmailProof: { missing: string[]; ready: boolean };
        };
      };
      expect(out.readyForPreflightProductionProof).toBe(true);
      expect(out.readyForSendVerify).toBe(true);
      expect(out.configuredOptionalSecrets).toEqual(["MAILHUB_PROBE_SMTP_PORT"]);
      expect(out.missingPreflightSecrets).toEqual([]);
      expect(out.missingSendVerifySecrets).toEqual([]);
      expect(out.secretGroups.externalSmtpProof).toMatchObject({ ready: true, missing: [] });
      expect(out.secretGroups.gmailProof).toMatchObject({ ready: true, missing: [] });
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
    withTempDir((dir) => {
      const outPath = join(dir, "routing-secrets-plan.json");
      const result = runNodeScript(
        routingSecretSetupPath,
        ["--include-gmail", "--probe-env-file", "/tmp/missing-mailhub-env", "--out", outPath],
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
      expect(readFileSync(outPath, "utf8")).not.toContain("client-secret");
      expect(readFileSync(outPath, "utf8")).not.toContain("refresh-token");
      expect(readFileSync(outPath, "utf8")).not.toContain("probe-pass");
      const out = readJson<{
        mode: string;
        readyToApply: boolean;
        secretNamesToSet: string[];
        missingRequiredEnv: string[];
        approval: { confirmApplyToken: string; confirmed: boolean };
      }>(outPath);
      expect(out.mode).toBe("dry_run");
      expect(out.readyToApply).toBe(true);
      expect(out.approval).toMatchObject({
        confirmApplyToken: "APPLY_MAILHUB_ROUTING_SECRETS",
        confirmed: false,
      });
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
        ["--apply", "--confirm-apply", "APPLY_MAILHUB_ROUTING_SECRETS", "--probe-env-file", "/tmp/missing-mailhub-env"],
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

  test("routing secret setup requires confirmation token before apply", () => {
    withTempDir((dir) => {
      const fakeGhPath = join(dir, "fake-gh.sh");
      const callsPath = join(dir, "gh-calls.jsonl");
      writeFileSync(callsPath, "", "utf8");
      writeFileSync(
        fakeGhPath,
        [
          "#!/usr/bin/env bash",
          "printf 'called\\n' >> \"$MAILHUB_GH_CALLS\"",
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

      expect(result.status).toBe(2);
      expect(result.stdout).not.toContain("probe-pass");
      const out = JSON.parse(result.stdout) as {
        readyToApply: boolean;
        errors: string[];
        appliedSecretNames: string[];
      };
      expect(out.readyToApply).toBe(true);
      expect(out.errors).toEqual(["missing_or_invalid_confirm_apply_token"]);
      expect(out.appliedSecretNames).toEqual([]);
      expect(readFileSync(callsPath, "utf8")).toBe("");
    });
  });

  test("readiness refresh plan is non-send and non-apply", () => {
    const result = runNodeScript(
      readinessRefreshPath,
      ["--plan-only", "--rules-source", "sheets", "--env-file", "env.example"],
    );

    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout) as {
      mode: string;
      rulesSource: string;
      commands: string[];
    };
    expect(out.mode).toBe("plan_only");
    expect(out.rulesSource).toBe("sheets");
    expect(out.commands.join("\n")).toContain("MAILHUB_CONFIG_STORE=sheets");
    expect(out.commands.join("\n")).not.toContain(process.cwd());
    expect(out.commands.join("\n")).not.toMatch(/\s--send(\s|$)/);
    expect(out.commands.join("\n")).not.toMatch(/\s--apply(\s|$)/);
    expect(out.commands.some((command) => command.includes("npm run probe:routing-send -- --out"))).toBe(true);
    expect(out.commands.some((command) => command.includes("audit:mailhub-rule-config-next -- --local-env-file env.example"))).toBe(true);
  });

  test("readiness refresh plan rejects absolute artifact paths", () => {
    const result = runNodeScript(
      readinessRefreshPath,
      ["--plan-only", "--out-dir", tmpdir()],
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("out_dir_must_be_repo_relative");
  });

  test("readiness refresh plan preserves existing routing proof artifacts", () => {
    const outDir = `.tmp-mailhub-refresh-${process.pid}-${Date.now()}`;
    try {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, "mailhub-routing-probe-preflight.json"), JSON.stringify({
        mode: "preflight",
        smtpPreflight: { readyForProductionProof: true },
      }), "utf8");
      writeFileSync(join(outDir, "mailhub-routing-probe-audit.json"), JSON.stringify({
        mode: "verify_marker",
        gate: { allExpectedAddressesConfirmed: true },
      }), "utf8");
      writeFileSync(join(outDir, "mailhub-routing-probe-send.json"), JSON.stringify({
        mode: "sent",
        verification: { allExpectedAddressesConfirmed: true },
      }), "utf8");

      const result = runNodeScript(
        readinessRefreshPath,
        ["--plan-only", "--out-dir", outDir],
      );

      expect(result.status).toBe(0);
      const out = JSON.parse(result.stdout) as {
        preserveRoutingProof: boolean;
        commands: string[];
      };
      expect(out.preserveRoutingProof).toBe(true);
      expect(out.commands.join("\n")).not.toContain("npm run probe:routing-send");
      expect(out.commands.join("\n")).not.toContain("npm run audit:routing-probes");
      expect(out.commands.join("\n")).not.toContain("npm run probe:routing-preflight");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  test("routing probe workflow validates routing proof without requiring total production readiness", () => {
    const workflow = readFileSync(routingProbeWorkflowPath, "utf8");

    expect(workflow).toContain("current_shared_gmail_routing");
    expect(workflow).toContain("routingConfirmed:s.verification.allExpectedAddressesConfirmed");
    expect(workflow).toContain("CONFIRM_SEND: ${{ github.event.inputs.confirmSend }}");
    expect(workflow).toContain('--confirm-send "$CONFIRM_SEND"');
    expect(workflow).not.toContain('--confirm-send "${{ github.event.inputs.confirmSend }}"');
    expect(workflow).not.toContain("if(!s.verification.productionReady)");
  });

  test("routing next-step artifact blocks send_verify until external SMTP proof secrets are ready", () => {
    withTempDir((dir) => {
      const readinessPath = join(dir, "readiness.json");
      const githubSecretsPath = join(dir, "github-secrets.json");
      const preflightPath = join(dir, "preflight.json");
      const outPath = join(dir, "next.json");
      const localEnvPath = join(dir, "missing.env");
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
        "--local-env-file",
        localEnvPath,
      ], missingLocalGmailEnv);

      expect(result.status).toBe(0);
      const out = readJson<{
        state: {
          canRunSendVerify: boolean;
          canRunGithubWorkflowDispatch: boolean;
          canRunLocalSendVerify: boolean;
          currentSharedGmailRoutingBlocked: boolean;
          externalMailWillBeSentByThisScript: boolean;
        };
        missing: { externalSmtpSecrets: string[]; localGmailVerificationEnv: string[] };
        nextActions: Array<{ id: string; status: string; requiredSecrets?: string[]; commands?: string[] }>;
      }>(outPath);
      expect(out.state.canRunSendVerify).toBe(false);
      expect(out.state.canRunGithubWorkflowDispatch).toBe(false);
      expect(out.state.canRunLocalSendVerify).toBe(false);
      expect(out.state.currentSharedGmailRoutingBlocked).toBe(true);
      expect(out.state.externalMailWillBeSentByThisScript).toBe(false);
      expect(out.missing.externalSmtpSecrets).toEqual([
        "MAILHUB_PROBE_SMTP_HOST",
        "MAILHUB_PROBE_SMTP_PASS",
        "MAILHUB_PROBE_FROM",
      ]);
      expect(out.missing.localGmailVerificationEnv).toEqual([
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "GOOGLE_SHARED_INBOX_EMAIL",
        "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
      ]);
      expect(out.nextActions.find((item) => item.id === "set_external_smtp_secrets")).toMatchObject({
        status: "required",
        requiredSecrets: ["MAILHUB_PROBE_SMTP_HOST", "MAILHUB_PROBE_SMTP_PASS", "MAILHUB_PROBE_FROM"],
        commands: [
          "npm run setup:mailhub-routing-secrets -- --out .ai-runs/mailhub-next-phase/mailhub-routing-secrets-plan.json",
          "npm run setup:mailhub-routing-secrets -- --apply --confirm-apply APPLY_MAILHUB_ROUTING_SECRETS --out .ai-runs/mailhub-next-phase/mailhub-routing-secrets-plan.json",
        ],
      });
      expect(out.nextActions.find((item) => item.id === "run_github_send_verify")).toMatchObject({
        status: "blocked",
      });
      expect(out.nextActions.find((item) => item.id === "run_local_send_verify")).toMatchObject({
        status: "blocked",
      });
    });
  });

  test("routing next-step artifact treats missing input artifacts as blocked", () => {
    withTempDir((dir) => {
      const outPath = join(dir, "next.json");
      const localEnvPath = join(dir, "missing.env");
      const result = runNodeScript(routingNextStepsPath, [
        "--readiness",
        join(dir, "missing-readiness.json"),
        "--github-secrets",
        join(dir, "missing-github-secrets.json"),
        "--preflight",
        join(dir, "missing-preflight.json"),
        "--out",
        outPath,
        "--local-env-file",
        localEnvPath,
      ], missingLocalGmailEnv);

      expect(result.status).toBe(0);
      const out = readJson<{
        state: {
          canRunSendVerify: boolean;
          canRunGithubWorkflowDispatch: boolean;
          canRunLocalSendVerify: boolean;
          readyForGithubSendVerify: boolean;
          readyForLocalProductionProof: boolean;
          readyForLocalGmailVerification: boolean;
        };
        missing: {
          externalSmtpSecrets: string[];
          githubSendVerifySecrets: string[];
          localPreflightEnv: string[];
          localGmailVerificationEnv: string[];
        };
        nextActions: Array<{ id: string; status: string; commands?: string[] }>;
      }>(outPath);
      expect(out.state.canRunSendVerify).toBe(false);
      expect(out.state.canRunGithubWorkflowDispatch).toBe(false);
      expect(out.state.canRunLocalSendVerify).toBe(false);
      expect(out.state.readyForGithubSendVerify).toBe(false);
      expect(out.state.readyForLocalProductionProof).toBe(false);
      expect(out.state.readyForLocalGmailVerification).toBe(false);
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
      expect(out.missing.localGmailVerificationEnv).toEqual([
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "GOOGLE_SHARED_INBOX_EMAIL",
        "GOOGLE_SHARED_INBOX_REFRESH_TOKEN",
      ]);
      expect(out.nextActions.find((item) => item.id === "set_external_smtp_secrets")).toMatchObject({
        status: "required",
        commands: [
          "npm run setup:mailhub-routing-secrets -- --out .ai-runs/mailhub-next-phase/mailhub-routing-secrets-plan.json",
          "npm run setup:mailhub-routing-secrets -- --apply --confirm-apply APPLY_MAILHUB_ROUTING_SECRETS --out .ai-runs/mailhub-next-phase/mailhub-routing-secrets-plan.json",
        ],
      });
      expect(out.nextActions.find((item) => item.id === "run_github_send_verify")).toMatchObject({
        status: "blocked",
      });
      expect(out.nextActions.find((item) => item.id === "run_local_send_verify")).toMatchObject({
        status: "blocked",
      });
    });
  });

  test("routing next-step separates GitHub workflow readiness from local SMTP preflight readiness", () => {
    withTempDir((dir) => {
      const readinessPath = join(dir, "readiness.json");
      const githubSecretsPath = join(dir, "github-secrets.json");
      const preflightPath = join(dir, "preflight.json");
      const outPath = join(dir, "next.json");
      const localEnvPath = join(dir, "missing.env");
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
        "--local-env-file",
        localEnvPath,
      ]);

      expect(result.status).toBe(0);
      const out = readJson<{
        state: {
          canRunSendVerify: boolean;
          canRunGithubWorkflowDispatch: boolean;
          canRunLocalSendVerify: boolean;
        };
        nextActions: Array<{ id: string; status: string }>;
      }>(outPath);
      expect(out.state.canRunSendVerify).toBe(false);
      expect(out.state.canRunGithubWorkflowDispatch).toBe(true);
      expect(out.state.canRunLocalSendVerify).toBe(false);
      expect(out.nextActions.find((item) => item.id === "run_github_send_verify")).toMatchObject({
        status: "ready",
      });
      expect(out.nextActions.find((item) => item.id === "run_local_send_verify")).toMatchObject({
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
      const localEnvPath = join(dir, "local.env");
      writeFileSync(
        localEnvPath,
        [
          "GOOGLE_CLIENT_ID=client-id",
          "GOOGLE_CLIENT_SECRET=client-secret",
          "GOOGLE_SHARED_INBOX_EMAIL=mailhub@vtj.co.jp",
          "GOOGLE_SHARED_INBOX_REFRESH_TOKEN=refresh-token",
        ].join("\n"),
        "utf8",
      );
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
        "--local-env-file",
        localEnvPath,
      ]);

      expect(result.status).toBe(0);
      const out = readJson<{
        state: {
          canRunSendVerify: boolean;
          canRunGithubWorkflowDispatch: boolean;
          canRunLocalSendVerify: boolean;
          readyForLocalGmailVerification: boolean;
        };
        missing: { externalSmtpSecrets: string[]; localGmailVerificationEnv: string[] };
        nextActions: Array<{ id: string; status: string }>;
      }>(outPath);
      expect(out.state.canRunSendVerify).toBe(true);
      expect(out.state.canRunGithubWorkflowDispatch).toBe(true);
      expect(out.state.canRunLocalSendVerify).toBe(true);
      expect(out.state.readyForLocalGmailVerification).toBe(true);
      expect(out.missing.externalSmtpSecrets).toEqual([]);
      expect(out.missing.localGmailVerificationEnv).toEqual([]);
      expect(out.nextActions.find((item) => item.id === "run_github_send_verify")).toMatchObject({
        status: "ready",
      });
      expect(out.nextActions.find((item) => item.id === "run_local_send_verify")).toMatchObject({
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
      const localEnvPath = join(dir, "missing.env");
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
        "--local-env-file",
        localEnvPath,
      ]);

      expect(result.status).toBe(1);
      const out = readJson<{ inputs: { errors: string[]; readinessRepoHead: string; repoHead: string; repoParentHead: string } }>(outPath);
      expect(out.inputs.readinessRepoHead).toBe("old-head");
      expect(out.inputs.repoHead).toBe("current-head");
      expect(out.inputs.repoParentHead).toBe("parent-head");
      expect(out.inputs.errors).toContain("stale_readiness_repo_head");
    });
  });

  test("routing next-step strict mode accepts current readiness repo head", () => {
    withTempGitRepo(({ dir, parentHead }) => {
      writeRepoFile(dir, "lib/app.ts", "export const version = 2;\n");
      const repoHead = commitRepo(dir, "current code");
      const readinessPath = join(dir, "readiness.json");
      const githubSecretsPath = join(dir, "github-secrets.json");
      const preflightPath = join(dir, "preflight.json");
      const outPath = join(dir, "next.json");
      const localEnvPath = join(dir, "missing.env");
      writeJson(readinessPath, {
        generatedAt: "2026-06-17T00:00:00.000Z",
        repoHead,
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
        repoHead,
        "--repo-parent-head",
        parentHead,
        "--local-env-file",
        localEnvPath,
      ], {}, { cwd: dir });

      expect(result.status).toBe(0);
      const out = readJson<{ inputs: { errors: string[]; readinessRepoHead: string } }>(outPath);
      expect(out.inputs.readinessRepoHead).toBe(repoHead);
      expect(out.inputs.errors).toEqual([]);
    });
  });

  test("routing next-step strict mode accepts parent readiness head for artifact-only refresh commits", () => {
    withTempGitRepo(({ dir, parentHead }) => {
      writeRepoFile(dir, ".ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json", "{\"ok\":true}\n");
      const repoHead = commitRepo(dir, "refresh artifacts");
      const readinessPath = join(dir, "readiness.json");
      const githubSecretsPath = join(dir, "github-secrets.json");
      const preflightPath = join(dir, "preflight.json");
      const outPath = join(dir, "next.json");
      const localEnvPath = join(dir, "missing.env");
      writeJson(readinessPath, {
        generatedAt: "2026-06-17T00:00:00.000Z",
        repoHead: parentHead,
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
        repoHead,
        "--repo-parent-head",
        parentHead,
        "--local-env-file",
        localEnvPath,
      ], {}, { cwd: dir });

      expect(result.status).toBe(0);
      const out = readJson<{
        inputs: { errors: string[]; readinessRepoHead: string; repoHead: string; repoParentHead: string };
        state: { externalMailWillBeSentByThisScript: boolean };
      }>(outPath);
      expect(out.inputs.readinessRepoHead).toBe(parentHead);
      expect(out.inputs.repoHead).toBe(repoHead);
      expect(out.inputs.repoParentHead).toBe(parentHead);
      expect(out.inputs.errors).toEqual([]);
      expect(out.state.externalMailWillBeSentByThisScript).toBe(false);
    });
  });

  test("routing next-step strict mode rejects parent readiness head when refresh commits mix artifacts and code", () => {
    withTempGitRepo(({ dir, parentHead }) => {
      writeRepoFile(dir, ".ai-runs/mailhub-next-phase/mailhub-production-readiness-audit.json", "{\"ok\":true}\n");
      writeRepoFile(dir, "lib/app.ts", "export const version = 2;\n");
      const repoHead = commitRepo(dir, "mixed refresh");
      const readinessPath = join(dir, "readiness.json");
      const githubSecretsPath = join(dir, "github-secrets.json");
      const preflightPath = join(dir, "preflight.json");
      const outPath = join(dir, "next.json");
      const localEnvPath = join(dir, "missing.env");
      writeJson(readinessPath, {
        generatedAt: "2026-06-17T00:00:00.000Z",
        repoHead: parentHead,
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
        repoHead,
        "--repo-parent-head",
        parentHead,
        "--local-env-file",
        localEnvPath,
      ], {}, { cwd: dir });

      expect(result.status).toBe(1);
      const out = readJson<{
        inputs: { errors: string[]; readinessRepoHead: string; repoHead: string; repoParentHead: string };
        state: { externalMailWillBeSentByThisScript: boolean };
      }>(outPath);
      expect(out.inputs.readinessRepoHead).toBe(parentHead);
      expect(out.inputs.repoHead).toBe(repoHead);
      expect(out.inputs.repoParentHead).toBe(parentHead);
      expect(out.inputs.errors).toContain("stale_readiness_repo_head");
      expect(out.state.externalMailWillBeSentByThisScript).toBe(false);
    });
  });

  test("routing next-step contract accepts a consistent blocked artifact", () => {
    withTempDir((dir) => {
      const nextPath = join(dir, "next.json");
      const readinessPath = join(dir, "readiness.json");
      writeJson(readinessPath, {
        generatedAt: "2026-06-17T00:00:00.000Z",
        repoHead: "current-head",
        gate: {
          productionReady: false,
          p0Blockers: ["current_shared_gmail_routing"],
          p1Blockers: [],
        },
      });
      writeJson(nextPath, {
        inputs: {
          repoHead: "current-head",
          readinessRepoHead: "current-head",
          readinessGeneratedAt: "2026-06-17T00:00:00.000Z",
          errors: [],
          warnings: [],
        },
        state: {
          productionReady: false,
          p0Blockers: ["current_shared_gmail_routing"],
          currentSharedGmailRoutingBlocked: true,
          readyForGithubSendVerify: false,
          readyForLocalProductionProof: false,
          readyForLocalGmailVerification: false,
          canRunGithubWorkflowDispatch: false,
          canRunLocalSendVerify: false,
          canRunSendVerify: false,
          externalMailWillBeSentByThisScript: false,
        },
        missing: {
          externalSmtpSecrets: ["MAILHUB_PROBE_SMTP_HOST"],
          githubSendVerifySecrets: ["MAILHUB_PROBE_SMTP_HOST"],
          localPreflightEnv: ["MAILHUB_PROBE_SMTP_HOST"],
          localGmailVerificationEnv: ["GOOGLE_CLIENT_ID"],
        },
        nextActions: [
          {
            id: "set_external_smtp_secrets",
            status: "required",
            commands: [
              "npm run setup:mailhub-routing-secrets -- --out .ai-runs/mailhub-next-phase/mailhub-routing-secrets-plan.json",
              "npm run setup:mailhub-routing-secrets -- --apply --confirm-apply APPLY_MAILHUB_ROUTING_SECRETS --out .ai-runs/mailhub-next-phase/mailhub-routing-secrets-plan.json",
            ],
          },
          { id: "verify_secret_readiness", status: "required" },
          { id: "run_no_send_preflight", status: "required" },
          { id: "run_github_send_verify", status: "blocked" },
          { id: "run_local_send_verify", status: "blocked" },
        ],
      });

      const result = runNodeScript(routingNextContractPath, [
        "--next",
        nextPath,
        "--readiness",
        readinessPath,
        "--repo-head",
        "current-head",
        "--repo-parent-head",
        "parent-head",
      ]);

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        artifactRepoHead: "current-head",
        readinessRepoHead: "current-head",
        canRunGithubWorkflowDispatch: false,
        canRunLocalSendVerify: false,
      });
    });
  });

  test("routing next-step contract rejects stale and contradictory execution gates", () => {
    withTempDir((dir) => {
      const nextPath = join(dir, "next.json");
      const readinessPath = join(dir, "readiness.json");
      writeJson(readinessPath, {
        generatedAt: "2026-06-17T00:00:00.000Z",
        repoHead: "parent-head",
        gate: {
          productionReady: false,
          p0Blockers: ["current_shared_gmail_routing"],
          p1Blockers: [],
        },
      });
      writeJson(nextPath, {
        inputs: {
          repoHead: "old-head",
          readinessRepoHead: "old-head",
          readinessGeneratedAt: "2026-06-17T00:00:00.000Z",
          errors: [],
          warnings: [],
        },
        state: {
          productionReady: false,
          p0Blockers: ["current_shared_gmail_routing"],
          currentSharedGmailRoutingBlocked: true,
          readyForGithubSendVerify: false,
          readyForLocalProductionProof: false,
          readyForLocalGmailVerification: false,
          canRunGithubWorkflowDispatch: true,
          canRunLocalSendVerify: false,
          canRunSendVerify: true,
          externalMailWillBeSentByThisScript: true,
        },
        missing: {
          externalSmtpSecrets: ["MAILHUB_PROBE_SMTP_HOST"],
          githubSendVerifySecrets: ["MAILHUB_PROBE_SMTP_HOST"],
          localPreflightEnv: ["MAILHUB_PROBE_SMTP_HOST"],
          localGmailVerificationEnv: ["GOOGLE_CLIENT_ID"],
        },
        nextActions: [
          {
            id: "set_external_smtp_secrets",
            status: "done",
            commands: ["gh secret set MAILHUB_PROBE_SMTP_HOST --repo vyper-japan/mailhub --app actions"],
          },
          { id: "verify_secret_readiness", status: "done" },
          { id: "run_no_send_preflight", status: "required" },
          { id: "run_github_send_verify", status: "blocked" },
          { id: "run_local_send_verify", status: "blocked" },
        ],
      });

      const result = runNodeScript(routingNextContractPath, [
        "--next",
        nextPath,
        "--readiness",
        readinessPath,
        "--repo-head",
        "current-head",
        "--repo-parent-head",
        "parent-head",
      ]);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("stale_artifact_repo_head");
      expect(result.stdout).toContain("stale_readiness_repo_head");
      expect(result.stdout).toContain("routing_next_must_not_claim_to_send_mail");
      expect(result.stdout).toContain("github_dispatch_gate_mismatch");
      expect(result.stdout).toContain("combined_send_gate_mismatch");
      expect(result.stdout).toContain("next_action_status_mismatch:set_external_smtp_secrets");
      expect(result.stdout).toContain("missing_routing_secret_setup_dry_run_command");
      expect(result.stdout).toContain("missing_routing_secret_setup_apply_command");
      expect(result.stdout).toContain("raw_gh_secret_set_commands_disallowed");
      expect(result.stdout).toContain("next_action_status_mismatch:run_github_send_verify");
    });
  });

  test("routing proof contract accepts consistent blocked proof artifacts", () => {
    withTempDir((dir) => {
      const preflightPath = join(dir, "preflight.json");
      const sendPath = join(dir, "send.json");
      const auditPath = join(dir, "audit.json");
      const readinessPath = join(dir, "readiness.json");
      const addresses = [
        "gopro_y@vtj.co.jp",
        "gopro_order_yahoo@vtj.co.jp",
        "vyper_r@vtj.co.jp",
        "vyper_rakuten@vtj.co.jp",
        "vyperglobal_y@vtj.co.jp",
        "ams_vyper@vtj.co.jp",
        "datacolor_shopify@vtj.co.jp",
        "ebay@vtj.co.jp",
      ];
      const marker = routingProbeMarker;
      const probes = addresses.map((address, index) => ({
        channelId: `channel-${index}`,
        label: `Channel ${index}`,
        address,
        subject: marker,
      }));

      writeJson(preflightPath, {
        generatedAt: freshFixtureTimestamp,
        mode: "preflight",
        marker,
        inputs: { preflight: true, verifyAfterSend: false },
        smtpPreflight: {
          missingRequiredEnv: [
            "MAILHUB_PROBE_SMTP_HOST",
            "MAILHUB_PROBE_SMTP_USER",
            "MAILHUB_PROBE_SMTP_PASS",
            "MAILHUB_PROBE_FROM",
          ],
          readyForProductionProof: false,
          fromIsVtj: false,
        },
        probeCount: probes.length,
        addressProbes: probes,
        sent: [],
        verification: null,
      });
      writeJson(sendPath, {
        mode: "dry_run",
        marker,
        probeCount: probes.length,
        addressProbes: probes,
        sent: [],
        verification: null,
      });
      writeJson(auditPath, {
        mode: "plan_only",
        plannedAddressProbes: probes.map(({ channelId, label, address }) => ({ channelId, label, address })),
        gate: {
          markerProvided: false,
          targetAddressCount: addresses.length,
          matchedAddresses: [],
          missingAddresses: addresses,
          allExpectedAddressesConfirmed: false,
        },
      });
      writeJson(readinessPath, {
        gate: {
          productionReady: false,
          p0Blockers: ["current_shared_gmail_routing"],
        },
        blockers: [{
          id: "current_shared_gmail_routing",
          severity: "P0",
          evidence: {
            routingProbeGate: {
              missingAddresses: addresses,
              allExpectedAddressesConfirmed: false,
            },
          },
        }],
      });

      const result = runNodeScript(routingProofContractPath, [
        "--preflight",
        preflightPath,
        "--send",
        sendPath,
        "--audit",
        auditPath,
        "--readiness",
        readinessPath,
      ]);

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        sentCount: 0,
        allExpectedAddressesConfirmed: false,
        productionReady: false,
      });
    });
  });

  test("routing proof contract accepts complete sent proof chain", () => {
    withTempDir((dir) => {
      const preflightPath = join(dir, "preflight.json");
      const sendPath = join(dir, "send.json");
      const auditPath = join(dir, "audit.json");
      const readinessPath = join(dir, "readiness.json");
      const addresses = [
        "gopro_y@vtj.co.jp",
        "gopro_order_yahoo@vtj.co.jp",
        "vyper_r@vtj.co.jp",
        "vyper_rakuten@vtj.co.jp",
        "vyperglobal_y@vtj.co.jp",
        "ams_vyper@vtj.co.jp",
        "datacolor_shopify@vtj.co.jp",
        "ebay@vtj.co.jp",
      ];
      const marker = routingProbeMarker;
      const probes = addresses.map((address, index) => ({
        channelId: `channel-${index}`,
        label: `Channel ${index}`,
        address,
        subject: marker,
      }));

      writeJson(preflightPath, {
        generatedAt: freshFixtureTimestamp,
        mode: "preflight",
        marker,
        inputs: { preflight: true, verifyAfterSend: false },
        smtpPreflight: {
          missingRequiredEnv: [],
          readyForProductionProof: true,
          fromIsVtj: false,
        },
        probeCount: probes.length,
        addressProbes: probes,
        sent: [],
        verification: null,
      });
      writeJson(sendPath, {
        generatedAt: freshFixtureTimestamp,
        mode: "sent",
        marker,
        smtpPreflight: {
          missingRequiredEnv: [],
          readyForProductionProof: true,
          fromIsVtj: false,
        },
        probeCount: probes.length,
        addressProbes: probes,
        sent: probes.map(({ channelId, address }, index) => ({
          channelId,
          address,
          accepted: [address],
          rejected: [],
          messageId: `fixture-${index}`,
        })),
        verification: {
          status: "matched",
          allExpectedAddressesConfirmed: true,
          productionReady: true,
          p0Blockers: [],
        },
      });
      writeJson(auditPath, {
        generatedAt: freshFixtureTimestamp,
        mode: "verify_marker",
        inputs: { marker },
        plannedAddressProbes: probes.map(({ channelId, label, address }) => ({ channelId, label, address })),
        gate: {
          markerProvided: true,
          targetAddressCount: addresses.length,
          matchedAddresses: addresses,
          missingAddresses: [],
          allExpectedAddressesConfirmed: true,
        },
      });
      writeJson(readinessPath, {
        requirements: {
          currentSharedGmailRoutingReady: true,
          routingProbeReady: true,
          routingProbeSendReady: true,
          routingProofChainReady: true,
        },
        gate: {
          productionReady: true,
          p0Blockers: [],
        },
        blockers: [],
      });

      const result = runNodeScript(routingProofContractPath, [
        "--preflight",
        preflightPath,
        "--send",
        sendPath,
        "--audit",
        auditPath,
        "--readiness",
        readinessPath,
      ]);

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        sentCount: addresses.length,
        readyForProductionProof: true,
        allExpectedAddressesConfirmed: true,
        productionReady: true,
      });
    });
  });

  test("routing proof contract rejects stale repoHead proof artifacts", () => {
    withTempDir((dir) => {
      const preflightPath = join(dir, "preflight.json");
      const sendPath = join(dir, "send.json");
      const auditPath = join(dir, "audit.json");
      const readinessPath = join(dir, "readiness.json");
      const marker = routingProbeMarker;
      const probes = canonicalRoutingProbeAddresses.map((address, index) => ({
        channelId: `channel-${index}`,
        label: `Channel ${index}`,
        address,
        subject: marker,
      }));
      const staleRepoHead = "stale-head";

      writeJson(preflightPath, {
        repoHead: staleRepoHead,
        generatedAt: freshFixtureTimestamp,
        mode: "preflight",
        marker,
        inputs: { preflight: true, verifyAfterSend: false },
        smtpPreflight: {
          missingRequiredEnv: [],
          readyForProductionProof: true,
          fromIsVtj: false,
        },
        probeCount: probes.length,
        addressProbes: probes,
        sent: [],
        verification: null,
      });
      writeJson(sendPath, {
        repoHead: staleRepoHead,
        generatedAt: freshFixtureTimestamp,
        mode: "sent",
        marker,
        smtpPreflight: {
          missingRequiredEnv: [],
          readyForProductionProof: true,
          fromIsVtj: false,
        },
        probeCount: probes.length,
        addressProbes: probes,
        sent: probes.map(({ channelId, address }, index) => ({
          channelId,
          address,
          accepted: [address],
          rejected: [],
          messageId: `fixture-${index}`,
        })),
        verification: {
          status: "matched",
          allExpectedAddressesConfirmed: true,
          productionReady: true,
          p0Blockers: [],
        },
      });
      writeJson(auditPath, {
        repoHead: staleRepoHead,
        generatedAt: freshFixtureTimestamp,
        mode: "verify_marker",
        inputs: { marker },
        plannedAddressProbes: probes.map(({ channelId, label, address }) => ({ channelId, label, address })),
        gate: {
          markerProvided: true,
          targetAddressCount: canonicalRoutingProbeAddresses.length,
          matchedAddresses: canonicalRoutingProbeAddresses,
          missingAddresses: [],
          allExpectedAddressesConfirmed: true,
        },
      });
      writeJson(readinessPath, {
        repoHead: staleRepoHead,
        generatedAt: freshFixtureTimestamp,
        requirements: {
          currentSharedGmailRoutingReady: true,
          routingProbeReady: true,
          routingProbeSendReady: true,
          routingProofChainReady: true,
        },
        gate: {
          productionReady: true,
          p0Blockers: [],
        },
        blockers: [],
      });

      const result = runNodeScript(routingProofContractPath, [
        "--preflight",
        preflightPath,
        "--send",
        sendPath,
        "--audit",
        auditPath,
        "--readiness",
        readinessPath,
        "--repo-head",
        "current-head",
        "--repo-parent-head",
        "parent-head",
      ]);

      expect(result.status).toBe(1);
      const out = JSON.parse(result.stdout) as { errors: string[]; repoFreshness: Record<string, { fresh: boolean }> };
      expect(out.errors).toEqual(
        expect.arrayContaining([
          "stale_preflight_repo_head",
          "stale_send_repo_head",
          "stale_audit_repo_head",
          "stale_readiness_repo_head",
        ]),
      );
      expect(out.repoFreshness.preflight.fresh).toBe(false);
      expect(out.repoFreshness.send.fresh).toBe(false);
      expect(out.repoFreshness.audit.fresh).toBe(false);
      expect(out.repoFreshness.readiness.fresh).toBe(false);
    });
  });

  test("routing proof contract rejects 8 matching non-canonical address artifacts", () => {
    withTempDir((dir) => {
      const preflightPath = join(dir, "preflight.json");
      const sendPath = join(dir, "send.json");
      const auditPath = join(dir, "audit.json");
      const readinessPath = join(dir, "readiness.json");
      const marker = routingProbeMarker;
      const addresses = nonCanonicalRoutingProbeAddresses;
      const probes = nonCanonicalRoutingProbePlan;

      writeJson(preflightPath, {
        mode: "preflight",
        marker,
        inputs: { preflight: true, verifyAfterSend: false },
        smtpPreflight: {
          missingRequiredEnv: [],
          readyForProductionProof: true,
          fromIsVtj: false,
        },
        probeCount: probes.length,
        addressProbes: probes,
        sent: [],
        verification: null,
      });
      writeJson(sendPath, {
        mode: "sent",
        marker,
        smtpPreflight: {
          missingRequiredEnv: [],
          readyForProductionProof: true,
          fromIsVtj: false,
        },
        probeCount: probes.length,
        addressProbes: probes,
        sent: probes.map(({ channelId, address }, index) => ({
          channelId,
          address,
          accepted: [address],
          rejected: [],
          messageId: `fixture-${index}`,
        })),
        verification: {
          status: "matched",
          allExpectedAddressesConfirmed: true,
          productionReady: true,
          p0Blockers: [],
        },
      });
      writeJson(auditPath, {
        mode: "verify_marker",
        inputs: { marker },
        plannedAddressProbes: probes.map(({ channelId, label, address }) => ({ channelId, label, address })),
        gate: {
          markerProvided: true,
          targetAddressCount: addresses.length,
          matchedAddresses: addresses,
          missingAddresses: [],
          allExpectedAddressesConfirmed: true,
        },
      });
      writeJson(readinessPath, {
        requirements: {
          currentSharedGmailRoutingReady: true,
          routingProbeReady: true,
          routingProbeSendReady: true,
          routingProofChainReady: true,
        },
        gate: {
          productionReady: true,
          p0Blockers: [],
        },
        blockers: [],
      });

      const result = runNodeScript(routingProofContractPath, [
        "--preflight",
        preflightPath,
        "--send",
        sendPath,
        "--audit",
        auditPath,
        "--readiness",
        readinessPath,
      ]);

      expect(result.status).toBe(1);
      const out = JSON.parse(result.stdout) as { errors: string[] };
      expect(out.errors).toEqual(
        expect.arrayContaining([
          "preflight_canonical_address_mismatch",
          "send_canonical_address_mismatch",
          "audit_canonical_address_mismatch",
          "readiness_routing_probe_send_mismatch",
          "readiness_routing_proof_chain_mismatch",
          "shared_routing_ready_without_routing_proof_chain",
        ]),
      );
      expect(out.errors).not.toContain("preflight_target_address_count_mismatch");
      expect(out.errors).not.toContain("send_target_address_count_mismatch");
      expect(out.errors).not.toContain("audit_expected_target_address_count_mismatch");
    });
  });

  test("routing proof contract rejects complete proof chain with old external timestamps", () => {
    withTempDir((dir) => {
      const preflightPath = join(dir, "preflight.json");
      const sendPath = join(dir, "send.json");
      const auditPath = join(dir, "audit.json");
      const readinessPath = join(dir, "readiness.json");
      const oldTimestamp = "2000-01-01T00:00:00.000Z";
      const oldMarker = "MAILHUB-ROUTING-PROBE-20000101T000000Z";
      const probes = canonicalRoutingProbeAddresses.map((address, index) => ({
        channelId: `channel-${index}`,
        label: `Channel ${index}`,
        address,
        subject: oldMarker,
      }));

      writeJson(preflightPath, {
        generatedAt: freshFixtureTimestamp,
        mode: "preflight",
        marker: oldMarker,
        inputs: { preflight: true, verifyAfterSend: false },
        smtpPreflight: {
          missingRequiredEnv: [],
          readyForProductionProof: true,
          fromIsVtj: false,
        },
        probeCount: probes.length,
        addressProbes: probes,
        sent: [],
        verification: null,
      });
      writeJson(sendPath, {
        generatedAt: oldTimestamp,
        mode: "sent",
        marker: oldMarker,
        smtpPreflight: {
          missingRequiredEnv: [],
          readyForProductionProof: true,
          fromIsVtj: false,
        },
        probeCount: probes.length,
        addressProbes: probes,
        sent: probes.map(({ channelId, address }, index) => ({
          channelId,
          address,
          accepted: [address],
          rejected: [],
          messageId: `fixture-${index}`,
        })),
        verification: {
          status: "matched",
          allExpectedAddressesConfirmed: true,
          productionReady: true,
          p0Blockers: [],
        },
      });
      writeJson(auditPath, {
        generatedAt: oldTimestamp,
        mode: "verify_marker",
        inputs: { marker: oldMarker },
        plannedAddressProbes: probes.map(({ channelId, label, address }) => ({ channelId, label, address })),
        gate: {
          markerProvided: true,
          targetAddressCount: canonicalRoutingProbeAddresses.length,
          matchedAddresses: canonicalRoutingProbeAddresses,
          missingAddresses: [],
          allExpectedAddressesConfirmed: true,
        },
      });
      writeJson(readinessPath, {
        requirements: {
          currentSharedGmailRoutingReady: true,
          routingProbeReady: true,
          routingProbeSendReady: true,
          routingProofChainReady: true,
        },
        gate: {
          productionReady: true,
          p0Blockers: [],
        },
        blockers: [],
      });

      const result = runNodeScript(routingProofContractPath, [
        "--preflight",
        preflightPath,
        "--send",
        sendPath,
        "--audit",
        auditPath,
        "--readiness",
        readinessPath,
      ]);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("routing_probe_audit_generated_at_stale");
      expect(result.stdout).toContain("routing_probe_send_generated_at_stale");
      expect(result.stdout).toContain("routing_probe_marker_stale");
      expect(result.stdout).toContain("readiness_routing_probe_send_mismatch");
      expect(result.stdout).toContain("readiness_routing_proof_chain_mismatch");
    });
  });

  test("routing proof contract rejects send and readiness contradictions", () => {
    withTempDir((dir) => {
      const preflightPath = join(dir, "preflight.json");
      const sendPath = join(dir, "send.json");
      const auditPath = join(dir, "audit.json");
      const readinessPath = join(dir, "readiness.json");
      const addresses = [
        "gopro_y@vtj.co.jp",
        "gopro_order_yahoo@vtj.co.jp",
        "vyper_r@vtj.co.jp",
        "vyper_rakuten@vtj.co.jp",
        "vyperglobal_y@vtj.co.jp",
        "ams_vyper@vtj.co.jp",
        "datacolor_shopify@vtj.co.jp",
        "ebay@vtj.co.jp",
      ];
      const marker = "MAILHUB-ROUTING-PROBE-20260617T000000Z";
      const probes = addresses.map((address, index) => ({
        channelId: `channel-${index}`,
        label: `Channel ${index}`,
        address,
        subject: marker,
      }));

      writeJson(preflightPath, {
        mode: "preflight",
        marker,
        inputs: { preflight: true, verifyAfterSend: false },
        smtpPreflight: {
          missingRequiredEnv: ["MAILHUB_PROBE_SMTP_HOST"],
          readyForProductionProof: true,
          fromIsVtj: true,
        },
        probeCount: probes.length,
        addressProbes: probes,
        sent: [{ address: addresses[0] }],
      });
      writeJson(sendPath, {
        mode: "dry_run",
        marker,
        probeCount: probes.length,
        addressProbes: probes,
        sent: [{ address: addresses[0] }],
      });
      writeJson(auditPath, {
        mode: "plan_only",
        plannedAddressProbes: probes.map(({ channelId, label, address }) => ({ channelId, label, address })),
        gate: {
          markerProvided: false,
          targetAddressCount: addresses.length,
          matchedAddresses: [addresses[0]],
          missingAddresses: addresses.slice(1),
          allExpectedAddressesConfirmed: false,
        },
      });
      writeJson(readinessPath, {
        requirements: {
          currentSharedGmailRoutingReady: true,
          routingProbeReady: true,
          routingProbeSendReady: true,
          routingProofChainReady: true,
        },
        gate: {
          productionReady: true,
          p0Blockers: [],
        },
        blockers: [],
      });

      const result = runNodeScript(routingProofContractPath, [
        "--preflight",
        preflightPath,
        "--send",
        sendPath,
        "--audit",
        auditPath,
        "--readiness",
        readinessPath,
      ]);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("preflight_must_not_send_mail");
      expect(result.stdout).toContain("preflight_ready_with_missing_env");
      expect(result.stdout).toContain("preflight_ready_with_vtj_sender");
      expect(result.stdout).toContain("dry_run_must_not_send_mail");
      expect(result.stdout).toContain("plan_only_must_not_match_addresses");
      expect(result.stdout).toContain("shared_routing_ready_without_sent_artifact");
      expect(result.stdout).toContain("shared_routing_ready_without_verify_marker_audit");
      expect(result.stdout).toContain("shared_routing_ready_without_routing_proof_chain");
      expect(result.stdout).toContain("production_ready_without_confirmed_routing_probe");
      expect(result.stdout).toContain("unconfirmed_routing_without_readiness_p0");
    });
  });

  test("routing proof contract rejects marker-only audit when send artifact is dry-run", () => {
    withTempDir((dir) => {
      const preflightPath = join(dir, "preflight.json");
      const sendPath = join(dir, "send.json");
      const auditPath = join(dir, "audit.json");
      const readinessPath = join(dir, "readiness.json");
      const addresses = [
        "gopro_y@vtj.co.jp",
        "gopro_order_yahoo@vtj.co.jp",
        "vyper_r@vtj.co.jp",
        "vyper_rakuten@vtj.co.jp",
        "vyperglobal_y@vtj.co.jp",
        "ams_vyper@vtj.co.jp",
        "datacolor_shopify@vtj.co.jp",
        "ebay@vtj.co.jp",
      ];
      const marker = "MAILHUB-ROUTING-PROBE-20260617T000000Z";
      const probes = addresses.map((address, index) => ({
        channelId: `channel-${index}`,
        label: `Channel ${index}`,
        address,
        subject: marker,
      }));

      writeJson(preflightPath, {
        mode: "preflight",
        marker,
        inputs: { preflight: true, verifyAfterSend: false },
        smtpPreflight: {
          missingRequiredEnv: [],
          readyForProductionProof: true,
          fromIsVtj: false,
        },
        probeCount: probes.length,
        addressProbes: probes,
        sent: [],
        verification: null,
      });
      writeJson(sendPath, {
        mode: "dry_run",
        marker,
        smtpPreflight: {
          missingRequiredEnv: [],
          readyForProductionProof: true,
          fromIsVtj: false,
        },
        probeCount: probes.length,
        addressProbes: probes,
        sent: [],
        verification: null,
      });
      writeJson(auditPath, {
        mode: "verify_marker",
        inputs: { marker },
        plannedAddressProbes: probes.map(({ channelId, label, address }) => ({ channelId, label, address })),
        gate: {
          markerProvided: true,
          targetAddressCount: addresses.length,
          matchedAddresses: addresses,
          missingAddresses: [],
          allExpectedAddressesConfirmed: true,
        },
      });
      writeJson(readinessPath, {
        requirements: {
          currentSharedGmailRoutingReady: true,
          routingProbeReady: true,
          routingProbeSendReady: true,
          routingProofChainReady: true,
        },
        gate: {
          productionReady: true,
          p0Blockers: [],
        },
        blockers: [],
      });

      const result = runNodeScript(routingProofContractPath, [
        "--preflight",
        preflightPath,
        "--send",
        sendPath,
        "--audit",
        auditPath,
        "--readiness",
        readinessPath,
      ]);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("shared_routing_ready_without_sent_artifact");
      expect(result.stdout).toContain("readiness_routing_probe_send_mismatch");
      expect(result.stdout).toContain("readiness_routing_proof_chain_mismatch");
      expect(result.stdout).toContain("shared_routing_ready_without_routing_proof_chain");
    });
  });

  test("routing proof contract rejects sent artifacts verified with a different marker", () => {
    withTempDir((dir) => {
      const preflightPath = join(dir, "preflight.json");
      const sendPath = join(dir, "send.json");
      const auditPath = join(dir, "audit.json");
      const readinessPath = join(dir, "readiness.json");
      const addresses = [
        "gopro_y@vtj.co.jp",
        "gopro_order_yahoo@vtj.co.jp",
        "vyper_r@vtj.co.jp",
        "vyper_rakuten@vtj.co.jp",
        "vyperglobal_y@vtj.co.jp",
        "ams_vyper@vtj.co.jp",
        "datacolor_shopify@vtj.co.jp",
        "ebay@vtj.co.jp",
      ];
      const sentMarker = "MAILHUB-ROUTING-PROBE-20260617T000000Z";
      const auditMarker = "MAILHUB-ROUTING-PROBE-20260617T000100Z";
      const probes = addresses.map((address, index) => ({
        channelId: `channel-${index}`,
        label: `Channel ${index}`,
        address,
        subject: sentMarker,
      }));

      writeJson(preflightPath, {
        mode: "preflight",
        marker: sentMarker,
        inputs: { preflight: true, verifyAfterSend: false },
        smtpPreflight: {
          missingRequiredEnv: [],
          readyForProductionProof: true,
          fromIsVtj: false,
        },
        probeCount: probes.length,
        addressProbes: probes,
        sent: [],
      });
      writeJson(sendPath, {
        mode: "sent",
        marker: sentMarker,
        probeCount: probes.length,
        addressProbes: probes,
        sent: probes.map(({ channelId, address }) => ({ channelId, address })),
        verification: {
          allExpectedAddressesConfirmed: true,
          productionReady: true,
        },
      });
      writeJson(auditPath, {
        mode: "verify_marker",
        inputs: { marker: auditMarker },
        plannedAddressProbes: probes.map(({ channelId, label, address }) => ({ channelId, label, address })),
        gate: {
          markerProvided: true,
          targetAddressCount: addresses.length,
          matchedAddresses: addresses,
          missingAddresses: [],
          allExpectedAddressesConfirmed: true,
        },
      });
      writeJson(readinessPath, {
        gate: {
          productionReady: true,
          p0Blockers: [],
        },
        blockers: [],
      });

      const result = runNodeScript(routingProofContractPath, [
        "--preflight",
        preflightPath,
        "--send",
        sendPath,
        "--audit",
        auditPath,
        "--readiness",
        readinessPath,
      ]);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("sent_audit_marker_mismatch");
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
  }, 15000);

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
        "--routing-probe-send",
        paths.send,
        "--routing-probe-preflight",
        paths.preflight,
        "--github-routing-secrets",
        paths.githubSecrets,
        "--github-staff-secrets",
        paths.githubStaffSecrets,
        "--views-audit",
        paths.views,
        "--rules-audit",
        paths.rules,
        "--staff-workflow-audit",
        paths.staffWorkflow,
        "--out",
        paths.out,
      ]);

      expect(result.status).toBe(0);
      const out = readJson<{
        requirements: {
          routingProbeReady: boolean;
          routingProbeSendReady: boolean;
          routingProofChainReady: boolean;
          routingProbePreflightReady: boolean;
          routingProbeGithubSecretsReady: boolean;
          currentSharedGmailRoutingReady: boolean;
          defaultViewsRealDataValidated: boolean;
          defaultViewsManualReviewOnly: boolean;
          defaultViewsBulkAutomationSafe: boolean;
        };
        viewSafety: {
          syntaxFailedViews: string[];
          manualReviewOnlyViews: string[];
          bulkUnsafeViews: string[];
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
              secretGroups?: {
                externalSmtpProof?: { missing?: string[]; ready?: boolean };
                gmailProof?: { missing?: string[]; ready?: boolean };
              };
            };
          };
        }>;
      }>(paths.out);
      expect(out.requirements.routingProbeReady).toBe(false);
      expect(out.requirements.routingProbeSendReady).toBe(false);
      expect(out.requirements.routingProofChainReady).toBe(false);
      expect(out.requirements.routingProbePreflightReady).toBe(false);
      expect(out.requirements.routingProbeGithubSecretsReady).toBe(false);
      expect(out.requirements.currentSharedGmailRoutingReady).toBe(false);
      expect(out.requirements.defaultViewsRealDataValidated).toBe(true);
      expect(out.requirements.defaultViewsManualReviewOnly).toBe(true);
      expect(out.requirements.defaultViewsBulkAutomationSafe).toBe(false);
      expect(out.viewSafety).toEqual({
        syntaxFailedViews: [],
        manualReviewOnlyViews: ["invoices"],
        bulkUnsafeViews: ["customer-inquiries"],
      });
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
      expect(out.blockers[0]?.evidence?.routingProbeGithubSecrets?.secretGroups?.externalSmtpProof).toMatchObject({
        ready: false,
        missing: ["MAILHUB_PROBE_SMTP_HOST", "MAILHUB_PROBE_FROM"],
      });
      expect(out.blockers[0]?.evidence?.routingProbeGithubSecrets?.secretGroups?.gmailProof).toMatchObject({
        ready: true,
        missing: [],
      });
    });
  });

  test("production readiness rejects marker-only routing evidence without sent artifact proof", () => {
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
        "--routing-probe-send",
        paths.send,
        "--routing-probe-preflight",
        paths.preflight,
        "--github-routing-secrets",
        paths.githubSecrets,
        "--github-staff-secrets",
        paths.githubStaffSecrets,
        "--views-audit",
        paths.views,
        "--rules-audit",
        paths.rules,
        "--staff-workflow-audit",
        paths.staffWorkflow,
        "--out",
        paths.out,
      ]);

      expect(result.status).toBe(0);
      const out = readJson<{
        requirements: {
          routingProbeReady: boolean;
          routingProbeSendReady: boolean;
          routingProofChainReady: boolean;
          currentSharedGmailRoutingReady: boolean;
        };
        gate: {
          productionReady: boolean;
          p0Blockers: string[];
        };
        blockers: Array<{
          id: string;
          evidence?: {
            routingProofChain?: { issues?: string[] };
          };
        }>;
      }>(paths.out);
      expect(out.requirements.routingProbeReady).toBe(true);
      expect(out.requirements.routingProbeSendReady).toBe(false);
      expect(out.requirements.routingProofChainReady).toBe(false);
      expect(out.requirements.currentSharedGmailRoutingReady).toBe(false);
      expect(out.gate.productionReady).toBe(false);
      expect(out.gate.p0Blockers).toContain("current_shared_gmail_routing");
      const blocker = out.blockers.find((item) => item.id === "current_shared_gmail_routing");
      expect(blocker?.evidence?.routingProofChain?.issues).toContain("routing_probe_send_not_sent");
    });
  });

  test("production readiness accepts full canonical address-level send proof chain", () => {
    withTempDir((dir) => {
      const paths = writeReadinessFixtures(
        dir,
        {
          markerProvided: true,
          targetChannelCount: 8,
          targetAddressCount: canonicalRoutingProbeAddresses.length,
          matchedChannels: canonicalRoutingProbePlan.map((probe) => probe.channelId),
          missingChannels: [],
          matchedAddresses: canonicalRoutingProbeAddresses,
          missingAddresses: [],
          allExpectedChannelsConfirmed: true,
          allExpectedAddressesConfirmed: true,
        },
        {
          staffWorkflowReady: true,
          routingSendReady: true,
          routingProbeAddressPlan: canonicalRoutingProbePlan,
        },
      );

      const result = runNodeScript(readinessAuditPath, [
        "--source-audit",
        paths.source,
        "--ops-audit",
        paths.ops,
        "--gws-routing-audit",
        paths.gws,
        "--routing-probe-audit",
        paths.routing,
        "--routing-probe-send",
        paths.send,
        "--routing-probe-preflight",
        paths.preflight,
        "--github-routing-secrets",
        paths.githubSecrets,
        "--github-staff-secrets",
        paths.githubStaffSecrets,
        "--views-audit",
        paths.views,
        "--rules-audit",
        paths.rules,
        "--staff-workflow-audit",
        paths.staffWorkflow,
        "--out",
        paths.out,
      ]);

      expect(result.status).toBe(0);
      const out = readJson<{
        requirements: {
          routingProbeReady: boolean;
          routingProbeSendReady: boolean;
          routingProofChainReady: boolean;
          currentSharedGmailRoutingReady: boolean;
        };
        gate: {
          productionReady: boolean;
          p0Blockers: string[];
        };
      }>(paths.out);
      expect(out.requirements.routingProbeReady).toBe(true);
      expect(out.requirements.routingProbeSendReady).toBe(true);
      expect(out.requirements.routingProofChainReady).toBe(true);
      expect(out.requirements.currentSharedGmailRoutingReady).toBe(true);
      expect(out.gate.productionReady).toBe(true);
      expect(out.gate.p0Blockers).toEqual([]);
    });
  });

  test("production readiness blocks full routing proof when alert automation secrets are missing", () => {
    withTempDir((dir) => {
      const paths = writeReadinessFixtures(
        dir,
        {
          markerProvided: true,
          targetChannelCount: 8,
          targetAddressCount: canonicalRoutingProbeAddresses.length,
          matchedChannels: canonicalRoutingProbePlan.map((probe) => probe.channelId),
          missingChannels: [],
          matchedAddresses: canonicalRoutingProbeAddresses,
          missingAddresses: [],
          allExpectedChannelsConfirmed: true,
          allExpectedAddressesConfirmed: true,
        },
        {
          staffWorkflowReady: true,
          routingSendReady: true,
          routingProbeAddressPlan: canonicalRoutingProbePlan,
        },
      );
      const staffGithubSecrets = readJson<Record<string, unknown>>(paths.githubStaffSecrets);
      writeJson(paths.githubStaffSecrets, {
        ...staffGithubSecrets,
        readyForProductionAlerts: false,
        missingAlertAutomationConfig: ["MAILHUB_ALERTS_SECRET", "MAILHUB_PROD_URL"],
        alertAutomationWorkflow: {
          path: ".github/workflows/mailhub-alerts.yml",
          sha256: currentAlertWorkflowSha256(),
          ready: true,
          missing: [],
        },
        secretGroups: {
          ...(staffGithubSecrets.secretGroups as Record<string, unknown>),
          alertAutomation: {
            required: ["MAILHUB_ALERTS_SECRET", "MAILHUB_PROD_URL"],
            present: [],
            missing: ["MAILHUB_ALERTS_SECRET", "MAILHUB_PROD_URL"],
            ready: false,
          },
        },
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
        "--routing-probe-send",
        paths.send,
        "--routing-probe-preflight",
        paths.preflight,
        "--github-routing-secrets",
        paths.githubSecrets,
        "--github-staff-secrets",
        paths.githubStaffSecrets,
        "--views-audit",
        paths.views,
        "--rules-audit",
        paths.rules,
        "--staff-workflow-audit",
        paths.staffWorkflow,
        "--out",
        paths.out,
      ]);

      expect(result.status).toBe(0);
      const out = readJson<{
        requirements: {
          productionAlertsAutomationReady: boolean;
          currentSharedGmailRoutingReady: boolean;
        };
        gate: {
          productionReady: boolean;
          p0Blockers: string[];
          p1Blockers: string[];
        };
        blockers: Array<{
          id: string;
          evidence?: {
            alertAutomation?: { readyForProductionAlerts?: boolean; missingAlertAutomationConfig?: string[] };
          };
        }>;
      }>(paths.out);
      expect(out.requirements.currentSharedGmailRoutingReady).toBe(true);
      expect(out.requirements.productionAlertsAutomationReady).toBe(false);
      expect(out.gate.productionReady).toBe(false);
      expect(out.gate.p0Blockers).toEqual([]);
      expect(out.gate.p1Blockers).toContain("alerts_automation_not_ready");
      const blocker = out.blockers.find((item) => item.id === "alerts_automation_not_ready");
      expect(blocker?.evidence?.alertAutomation).toMatchObject({
        readyForProductionAlerts: false,
        missingAlertAutomationConfig: ["MAILHUB_ALERTS_SECRET", "MAILHUB_PROD_URL"],
      });
    });
  });

  test("production readiness blocks full routing proof when alert automation workflow fingerprint is stale", () => {
    withTempDir((dir) => {
      const paths = writeReadinessFixtures(
        dir,
        {
          markerProvided: true,
          targetChannelCount: 8,
          targetAddressCount: canonicalRoutingProbeAddresses.length,
          matchedChannels: canonicalRoutingProbePlan.map((probe) => probe.channelId),
          missingChannels: [],
          matchedAddresses: canonicalRoutingProbeAddresses,
          missingAddresses: [],
          allExpectedChannelsConfirmed: true,
          allExpectedAddressesConfirmed: true,
        },
        {
          staffWorkflowReady: true,
          routingSendReady: true,
          routingProbeAddressPlan: canonicalRoutingProbePlan,
        },
      );
      const staffGithubSecrets = readJson<Record<string, unknown>>(paths.githubStaffSecrets);
      const alertWorkflow = staffGithubSecrets.alertAutomationWorkflow as Record<string, unknown>;
      writeJson(paths.githubStaffSecrets, {
        ...staffGithubSecrets,
        alertAutomationWorkflow: {
          ...alertWorkflow,
          sha256: "stale-workflow-fingerprint",
        },
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
        "--routing-probe-send",
        paths.send,
        "--routing-probe-preflight",
        paths.preflight,
        "--github-routing-secrets",
        paths.githubSecrets,
        "--github-staff-secrets",
        paths.githubStaffSecrets,
        "--views-audit",
        paths.views,
        "--rules-audit",
        paths.rules,
        "--staff-workflow-audit",
        paths.staffWorkflow,
        "--out",
        paths.out,
      ]);

      expect(result.status).toBe(0);
      const out = readJson<{
        requirements: {
          productionAlertsAutomationReady: boolean;
          currentSharedGmailRoutingReady: boolean;
        };
        gate: {
          productionReady: boolean;
          p0Blockers: string[];
          p1Blockers: string[];
        };
        blockers: Array<{
          id: string;
          evidence?: {
            alertAutomation?: { readyForProductionAlerts?: boolean; workflowFingerprintFresh?: boolean };
          };
        }>;
      }>(paths.out);
      expect(out.requirements.currentSharedGmailRoutingReady).toBe(true);
      expect(out.requirements.productionAlertsAutomationReady).toBe(false);
      expect(out.gate.productionReady).toBe(false);
      expect(out.gate.p0Blockers).toEqual([]);
      expect(out.gate.p1Blockers).toContain("alerts_automation_not_ready");
      const blocker = out.blockers.find((item) => item.id === "alerts_automation_not_ready");
      expect(blocker?.evidence?.alertAutomation).toMatchObject({
        readyForProductionAlerts: true,
        workflowFingerprintFresh: false,
      });
    });
  });

  test("production readiness rejects subset send proof even when local and GitHub routing gates are ready", () => {
    withTempDir((dir) => {
      const paths = writeReadinessFixtures(
        dir,
        {
          markerProvided: true,
          targetChannelCount: 2,
          targetAddressCount: 3,
          matchedChannels: ["multi-source", "single-source"],
          missingChannels: [],
          matchedAddresses: ["first@example.com", "second@example.com", "third@example.com"],
          missingAddresses: [],
          allExpectedChannelsConfirmed: true,
          allExpectedAddressesConfirmed: true,
        },
        { staffWorkflowReady: true, routingSendReady: true },
      );

      const result = runNodeScript(readinessAuditPath, [
        "--source-audit",
        paths.source,
        "--ops-audit",
        paths.ops,
        "--gws-routing-audit",
        paths.gws,
        "--routing-probe-audit",
        paths.routing,
        "--routing-probe-send",
        paths.send,
        "--routing-probe-preflight",
        paths.preflight,
        "--github-routing-secrets",
        paths.githubSecrets,
        "--github-staff-secrets",
        paths.githubStaffSecrets,
        "--views-audit",
        paths.views,
        "--rules-audit",
        paths.rules,
        "--staff-workflow-audit",
        paths.staffWorkflow,
        "--out",
        paths.out,
      ]);

      expect(result.status).toBe(0);
      const out = readJson<{
        requirements: {
          routingProbeReady: boolean;
          routingProbeSendReady: boolean;
          routingProofChainReady: boolean;
          routingProbePreflightReady: boolean;
          routingProbeGithubSecretsReady: boolean;
          currentSharedGmailRoutingReady: boolean;
        };
        gate: {
          productionReady: boolean;
          p0Blockers: string[];
        };
        blockers: Array<{
          id: string;
          evidence?: {
            routingProofChain?: {
              issues?: string[];
              canonicalAddressCount?: number;
              auditAddressCount?: number;
              sendAddressCount?: number;
            };
          };
        }>;
      }>(paths.out);
      expect(out.requirements.routingProbeReady).toBe(true);
      expect(out.requirements.routingProbeSendReady).toBe(false);
      expect(out.requirements.routingProofChainReady).toBe(false);
      expect(out.requirements.routingProbePreflightReady).toBe(true);
      expect(out.requirements.routingProbeGithubSecretsReady).toBe(true);
      expect(out.requirements.currentSharedGmailRoutingReady).toBe(false);
      expect(out.gate.productionReady).toBe(false);
      expect(out.gate.p0Blockers).toContain("current_shared_gmail_routing");
      const blocker = out.blockers.find((item) => item.id === "current_shared_gmail_routing");
      expect(blocker?.evidence?.routingProofChain?.canonicalAddressCount).toBe(8);
      expect(blocker?.evidence?.routingProofChain?.auditAddressCount).toBe(3);
      expect(blocker?.evidence?.routingProofChain?.sendAddressCount).toBe(3);
      expect(blocker?.evidence?.routingProofChain?.issues).toEqual(
        expect.arrayContaining([
          "routing_probe_audit_target_count_not_canonical",
          "routing_probe_audit_address_count_not_canonical",
          "routing_probe_audit_canonical_address_mismatch",
          "routing_probe_send_address_count_not_canonical",
          "routing_probe_send_canonical_address_mismatch",
        ]),
      );
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
          GOOGLE_CLIENT_ID: "",
          GOOGLE_CLIENT_SECRET: "",
          GOOGLE_SHARED_INBOX_EMAIL: "",
          GOOGLE_SHARED_INBOX_REFRESH_TOKEN: "",
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

  test("routing probe preflight blocks malformed MAILHUB_PROBE_FROM from send readiness", () => {
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
          MAILHUB_PROBE_FROM: "not-an-email",
        },
      );

      expect(result.status).toBe(0);
      const out = readJson<{
        smtpPreflight: {
          missingRequiredEnv: string[];
          from: string | null;
          fromDomain: string | null;
          fromValid: boolean;
          readyForSend: boolean;
          readyForProductionProof: boolean;
          warnings: string[];
        };
      }>(outPath);
      expect(out.smtpPreflight.missingRequiredEnv).toEqual([]);
      expect(out.smtpPreflight.from).toBeNull();
      expect(out.smtpPreflight.fromDomain).toBeNull();
      expect(out.smtpPreflight.fromValid).toBe(false);
      expect(out.smtpPreflight.readyForSend).toBe(false);
      expect(out.smtpPreflight.readyForProductionProof).toBe(false);
      expect(out.smtpPreflight.warnings).toContain("invalid_MAILHUB_PROBE_FROM");
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

  test("routing probe sender validates Gmail verification env before sending with --verify-after-send", () => {
    withTempDir((dir) => {
      const opsPath = join(dir, "ops.json");
      const outPath = join(dir, "send-plan.json");
      writeJson(opsPath, opsAuditFixture());

      const result = runNodeScript(
        routingProbeSenderPath,
        [
          "--ops-audit",
          opsPath,
          "--out",
          outPath,
          "--send",
          "--verify-after-send",
          "--probe-env-file",
          join(dir, "missing.env"),
        ],
        {
          MAILHUB_PROBE_SMTP_HOST: "smtp.example.com",
          MAILHUB_PROBE_SMTP_USER: "probe-user",
          MAILHUB_PROBE_SMTP_PASS: "probe-pass",
          MAILHUB_PROBE_FROM: "external-probe@example.com",
          GOOGLE_CLIENT_ID: "",
          GOOGLE_CLIENT_SECRET: "",
          GOOGLE_SHARED_INBOX_EMAIL: "",
          GOOGLE_SHARED_INBOX_REFRESH_TOKEN: "",
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("missing_env_for_verify_after_send");
      expect(result.stderr).toContain("GOOGLE_CLIENT_ID");
    });
  });

  test("routing probe sender requires confirmation token before SMTP send", () => {
    withTempDir((dir) => {
      const opsPath = join(dir, "ops.json");
      const outPath = join(dir, "send-plan.json");
      writeJson(opsPath, opsAuditFixtureFromProbePlan(canonicalRoutingProbePlan));

      const result = runNodeScript(
        routingProbeSenderPath,
        [
          "--ops-audit",
          opsPath,
          "--out",
          outPath,
          "--send",
          "--probe-env-file",
          join(dir, "missing.env"),
        ],
        {
          MAILHUB_PROBE_SMTP_HOST: "127.0.0.1",
          MAILHUB_PROBE_SMTP_PORT: "9",
          MAILHUB_PROBE_SMTP_SECURE: "false",
          MAILHUB_PROBE_SMTP_USER: "probe-user",
          MAILHUB_PROBE_SMTP_PASS: "probe-pass",
          MAILHUB_PROBE_FROM: "external-probe@example.com",
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("missing_or_invalid_confirm_send_token");
      expect(result.stderr).not.toContain("ECONNREFUSED");
      expect(result.stderr).not.toContain("probe-pass");
    });
  });

  test("routing probe sender writes sent artifact before verify-after-send readiness regeneration", async () => {
    await withTempDirAsync(async (dir) => {
      await withLocalSmtpServer(dir, async ({ port }) => {
        const scriptsDir = join(dir, "scripts");
        const opsPath = join(dir, "ops.json");
        const outPath = join(dir, "send.json");
        const routingAuditOut = join(dir, "routing-audit.json");
        const readinessOut = join(dir, "readiness.json");
        const readinessWitness = join(dir, "readiness-witness.json");
        const marker = "MAILHUB-ROUTING-PROBE-20260617T000000Z";
        mkdirSync(scriptsDir, { recursive: true });
        writeJson(opsPath, opsAuditFixtureFromProbePlan(canonicalRoutingProbePlan));

        writeFileSync(
          join(scriptsDir, "audit-mailhub-routing-probes.mjs"),
          [
            "import { readFileSync, writeFileSync } from 'node:fs';",
            "function arg(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }",
            "const ops = JSON.parse(readFileSync(arg('--ops-audit'), 'utf8'));",
            "const marker = arg('--marker');",
            "const unconfirmed = new Set(ops.gate.currentSharedGmailRoutingUnconfirmed);",
            "const probes = ops.operationalConfirmations",
            "  .filter((item) => unconfirmed.has(item.id))",
            "  .flatMap((item) => item.addresses.map((address) => ({ channelId: item.id, label: item.label, address })));",
            "writeFileSync(arg('--out'), `${JSON.stringify({",
            "  generatedAt: new Date().toISOString(),",
            "  mode: 'verify_marker',",
            "  inputs: { marker },",
            "  plannedAddressProbes: probes,",
            "  gate: {",
            "    markerProvided: true,",
            "    targetChannelCount: unconfirmed.size,",
            "    targetAddressCount: probes.length,",
            "    matchedChannels: [...unconfirmed],",
            "    missingChannels: [],",
            "    matchedAddresses: probes.map((item) => item.address),",
            "    missingAddresses: [],",
            "    allExpectedChannelsConfirmed: true,",
            "    allExpectedAddressesConfirmed: true,",
            "  },",
            "}, null, 2)}\\n`);",
          ].join("\n"),
          "utf8",
        );
        writeFileSync(
          join(scriptsDir, "audit-mailhub-production-readiness.mjs"),
          [
            "import { readFileSync, writeFileSync } from 'node:fs';",
            "function arg(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }",
            "const sendPath = arg('--routing-probe-send');",
            "const send = JSON.parse(readFileSync(sendPath, 'utf8'));",
            "writeFileSync(process.env.MAILHUB_READINESS_WITNESS, `${JSON.stringify({",
            "  args: process.argv.slice(2),",
            "  routingProbeSend: sendPath,",
            "  artifactBeforeReadiness: {",
            "    mode: send.mode,",
            "    sentCount: Array.isArray(send.sent) ? send.sent.length : 0,",
            "    verificationStatus: send.verification?.status ?? null,",
            "    verificationAllExpectedAddressesConfirmed: send.verification?.allExpectedAddressesConfirmed ?? null,",
            "    hasProductionReady: Object.prototype.hasOwnProperty.call(send.verification ?? {}, 'productionReady'),",
            "  },",
            "}, null, 2)}\\n`);",
            "writeFileSync(arg('--out'), `${JSON.stringify({",
            "  generatedAt: new Date().toISOString(),",
            "  gate: { productionReady: true, p0Blockers: [] },",
            "}, null, 2)}\\n`);",
          ].join("\n"),
          "utf8",
        );

        const result = runNodeScript(
          routingProbeSenderPath,
          [
            "--ops-audit",
            opsPath,
            "--out",
            outPath,
            "--marker",
            marker,
            "--send",
            "--confirm-send",
            "SEND_EXTERNAL_MAILHUB_ROUTING_PROBES",
            "--verify-after-send",
            "--routing-audit-out",
            routingAuditOut,
            "--readiness-out",
            readinessOut,
            "--wait-seconds",
            "0",
            "--probe-env-file",
            join(dir, "missing.env"),
          ],
          {
            GOOGLE_CLIENT_ID: "client-id",
            GOOGLE_CLIENT_SECRET: "client-secret",
            GOOGLE_SHARED_INBOX_EMAIL: "mailhub@example.com",
            GOOGLE_SHARED_INBOX_REFRESH_TOKEN: "refresh-token",
            MAILHUB_PROBE_SMTP_HOST: "127.0.0.1",
            MAILHUB_PROBE_SMTP_PORT: String(port),
            MAILHUB_PROBE_SMTP_SECURE: "false",
            MAILHUB_PROBE_SMTP_USER: "probe-user",
            MAILHUB_PROBE_SMTP_PASS: "probe-pass",
            MAILHUB_PROBE_FROM: "external-probe@example.com",
            MAILHUB_READINESS_WITNESS: readinessWitness,
          },
          { cwd: dir },
        );

        expect(result.status).toBe(0);
        const witness = readJson<{
          args: string[];
          routingProbeSend: string;
          artifactBeforeReadiness: {
            mode: string;
            sentCount: number;
            verificationStatus: string | null;
            verificationAllExpectedAddressesConfirmed: boolean | null;
            hasProductionReady: boolean;
          };
        }>(readinessWitness);
        expect(witness.args).toEqual(expect.arrayContaining(["--routing-probe-send", outPath]));
        expect(witness.routingProbeSend).toBe(outPath);
        expect(witness.artifactBeforeReadiness).toEqual({
          mode: "sent",
          sentCount: canonicalRoutingProbeAddresses.length,
          verificationStatus: "matched",
          verificationAllExpectedAddressesConfirmed: true,
          hasProductionReady: false,
        });

        const out = readJson<{
          mode: string;
          sent: unknown[];
          verification: {
            status: string;
            allExpectedAddressesConfirmed: boolean;
            productionReady: boolean;
            p0Blockers: string[];
          };
        }>(outPath);
        expect(out.mode).toBe("sent");
        expect(out.sent).toHaveLength(canonicalRoutingProbeAddresses.length);
        expect(out.verification).toMatchObject({
          status: "matched",
          allExpectedAddressesConfirmed: true,
          productionReady: true,
          p0Blockers: [],
        });
      });
    });
  }, 15000);

  test("routing probe sender refuses non-canonical recipients before SMTP send", () => {
    withTempDir((dir) => {
      const opsPath = join(dir, "ops.json");
      const outPath = join(dir, "send-plan.json");
      writeJson(opsPath, opsAuditFixtureFromProbePlan(nonCanonicalRoutingProbePlan));

      const result = runNodeScript(
        routingProbeSenderPath,
        [
          "--ops-audit",
          opsPath,
          "--out",
          outPath,
          "--send",
          "--probe-env-file",
          join(dir, "missing.env"),
        ],
        {
          MAILHUB_PROBE_SMTP_HOST: "127.0.0.1",
          MAILHUB_PROBE_SMTP_PORT: "9",
          MAILHUB_PROBE_SMTP_SECURE: "false",
          MAILHUB_PROBE_SMTP_USER: "probe-user",
          MAILHUB_PROBE_SMTP_PASS: "probe-pass",
          MAILHUB_PROBE_FROM: "external-probe@example.com",
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("non_canonical_routing_probe_recipients");
      expect(result.stderr).toContain("routing_probe_send_canonical_address_mismatch");
      expect(result.stderr).not.toContain("ECONNREFUSED");
    });
  });

  test("routing probe sender refuses malformed MAILHUB_PROBE_FROM before SMTP send", () => {
    withTempDir((dir) => {
      const opsPath = join(dir, "ops.json");
      const outPath = join(dir, "send-plan.json");
      writeJson(opsPath, opsAuditFixture());

      const result = runNodeScript(
        routingProbeSenderPath,
        ["--ops-audit", opsPath, "--out", outPath, "--send"],
        {
          MAILHUB_PROBE_SMTP_HOST: "smtp.example.com",
          MAILHUB_PROBE_SMTP_USER: "probe-user",
          MAILHUB_PROBE_SMTP_PASS: "probe-pass",
          MAILHUB_PROBE_FROM: "not-an-email",
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("invalid_env:MAILHUB_PROBE_FROM");
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
