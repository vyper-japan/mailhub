import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { isAbsolute, join, resolve } from "path";
import { spawnSync } from "child_process";
import { describe, expect, test } from "vitest";

const readinessContractPath = resolve(process.cwd(), "scripts/check-mailhub-readiness-contract.mjs");
const readinessAuditPath = resolve(process.cwd(), "scripts/audit-mailhub-production-readiness.mjs");
const inputArtifactMaxAgeMs = 24 * 60 * 60 * 1000;

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

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "mailhub-readiness-contract-"));
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

function runContract(auditPath: string, repoHead = "head123", repoParentHead = "parent123", cwd = process.cwd()) {
  return spawnSync(process.execPath, [
    readinessContractPath,
    "--audit",
    auditPath,
    "--repo-head",
    repoHead,
    "--repo-parent-head",
    repoParentHead,
  ], {
    cwd,
    encoding: "utf8",
  });
}

function runAudit(args: string[]) {
  return spawnSync(process.execPath, [readinessAuditPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function gitRevParse(ref: string) {
  const result = spawnSync("git", ["rev-parse", ref], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git rev-parse ${ref} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

const inputFreshnessKeys = [
  "sourceAudit",
  "opsAudit",
  "gwsRoutingAudit",
  "routingProbeAudit",
  "routingProbeSend",
  "routingProbePreflight",
  "githubRoutingSecrets",
  "githubStaffSecrets",
  "viewsAudit",
  "rulesAudit",
  "staffWorkflowAudit",
];

function inputFreshnessTimestampField(key: string) {
  return key.startsWith("github") ? "checkedAt" : "generatedAt";
}

function writeBaseInputArtifacts(
  dir: string,
  repoHead = "head123",
  overrides: Record<string, Record<string, unknown>> = {},
) {
  const paths = Object.fromEntries(
    inputFreshnessKeys.map((key) => [key, join(dir, `${key}.json`)]),
  ) as Record<string, string>;

  for (const key of inputFreshnessKeys) {
    writeJson(paths[key], {
      [inputFreshnessTimestampField(key)]: freshFixtureTimestamp,
      repoHead,
      ...(overrides[key] ?? {}),
    });
  }

  return paths;
}

function baseInputFreshness(paths: Record<string, string>, repoHead = "head123") {
  return inputFreshnessKeys.map((key) => {
    return {
      key,
      path: paths[key],
      present: true,
      timestampField: inputFreshnessTimestampField(key),
      timestamp: freshFixtureTimestamp,
      repoHeadPolicy: "fresh_repo_head",
      requiresFreshRepoHead: true,
      repoHead,
      repoHeadFresh: true,
      maxAgeMs: inputArtifactMaxAgeMs,
      timestampFresh: true,
      status: "fresh",
      readyForProduction: true,
    };
  });
}

function baseReadinessAudit(
  dirOrOverrides: string | Record<string, unknown> = {},
  maybeOverrides: Record<string, unknown> = {},
) {
  const dir = typeof dirOrOverrides === "string"
    ? dirOrOverrides
    : mkdtempSync(join(tmpdir(), "mailhub-readiness-contract-inputs-"));
  const overrides = typeof dirOrOverrides === "string" ? maybeOverrides : dirOrOverrides;
  const inputArtifactPaths = writeBaseInputArtifacts(dir);

  return {
    generatedAt: freshFixtureTimestamp,
    repoHead: "head123",
    requirements: {
      inputArtifactsFresh: true,
      sourceCodeCoverageReady: true,
      sourceInventoryReady: true,
      currentSharedGmailRoutingReady: false,
      routingProbeReady: false,
      routingProbeSendReady: false,
      routingProofChainReady: false,
      routingProbePreflightReady: false,
      routingProbeGithubSecretsReady: false,
      defaultViewsRealDataValidated: true,
      defaultViewsManualReviewOnly: true,
      defaultViewsBulkAutomationSafe: false,
      currentRuleConfigRealDataSafetyReady: true,
      currentRuleConfigFingerprintPresent: true,
      currentRuleConfigSourceProductionReady: true,
      currentRuleSafetyEnvSourceExplicit: true,
      staffWorkflowPermissionsReady: false,
      staffGithubConfigReady: false,
      staffReadOnlyRolloutReady: false,
      staffControlledWritePilotReady: false,
    },
    inputs: {
      ...inputArtifactPaths,
      inputFreshness: baseInputFreshness(inputArtifactPaths),
      rulesConfigFingerprint: "sha256:abc123",
      ruleConfigSource: {
        requestedSource: "sheets",
        resolvedSource: "sheets",
        ruleSheets: {
          labelRules: "ConfigRules",
          assigneeRules: "ConfigAssigneeRules",
        },
        warnings: [],
      },
      ruleSafetyAuditEnv: {
        envFile: ".env.local",
        envFileLoaded: true,
        envFileMode: "env_file",
        valuePolicyPresent: true,
      },
    },
    viewSafety: {
      syntaxFailedViews: [],
      manualReviewOnlyViews: ["invoice-docs", "customer-inquiries"],
      bulkUnsafeViews: ["customer-inquiries"],
    },
    gate: {
      productionReady: false,
      p0Blockers: ["current_shared_gmail_routing"],
      p1Blockers: ["staff_workflow_permissions", "staff_github_config_not_ready"],
    },
    blockers: [
      {
        id: "current_shared_gmail_routing",
        severity: "P0",
        evidence: {
          currentSharedGmailRoutingUnconfirmed: ["gopro-yahoo"],
          routingProbeGate: {
            targetAddressCount: 8,
            allExpectedAddressesConfirmed: false,
            missingAddresses: ["gopro_y@vtj.co.jp"],
          },
          routingProbeSend: {
            mode: "dry_run",
            probeCount: 8,
            sentCount: 0,
          },
          routingProofChain: {
            ready: false,
            issues: ["routing_probe_send_not_sent"],
          },
          routingProbePreflight: {
            readyForProductionProof: false,
            missingRequiredEnv: ["MAILHUB_PROBE_SMTP_HOST"],
            warnings: [],
          },
          routingProbeGithubSecrets: {
            readyForSendVerify: false,
            missingSendVerifySecrets: ["MAILHUB_PROBE_SMTP_HOST"],
          },
          mxRecords: [{ exchange: "mx01.lolipop.jp", priority: 50 }],
        },
      },
      {
        id: "staff_workflow_permissions",
        severity: "P1",
        evidence: {
          staffWorkflowGate: {
            readOnlyRolloutReady: false,
            controlledWritePilotReady: false,
            staffWorkflowPermissionsReady: false,
          },
          staffWorkflowRequirements: {
            staffWorkflowPermissionsReady: false,
          },
          staffWorkflowBlockers: [{ id: "not_production_env", severity: "P1" }],
          escalatesToP0AfterRoutingProof: true,
        },
      },
      {
        id: "staff_github_config_not_ready",
        severity: "P1",
        evidence: {
          staffGithubConfig: {
            readyForProductionStaffPreflight: false,
            readyForSecretBackedStaffConfig: false,
            missingProductionStaffConfig: ["MAILHUB_ENV"],
            missingSecretConfig: ["NEXTAUTH_SECRET"],
            presentRequiredConfigNames: [],
            presentRequiredConfigSources: {},
            setupCommands: [
              "npm run setup:mailhub-staff-github-config",
              "npm run setup:mailhub-staff-github-config -- --apply",
            ],
          },
          escalatesToP0AfterRoutingProof: true,
        },
      },
    ],
    ...overrides,
  };
}

function writeReadyAggregateArtifacts(
  dir: string,
  repoHead: string,
  overrides: Record<string, Record<string, unknown>> = {},
) {
  const paths: Record<string, string> = {
    sourceAudit: join(dir, "source.json"),
    opsAudit: join(dir, "ops.json"),
    gwsRoutingAudit: join(dir, "gws.json"),
    routingProbeAudit: join(dir, "routing-probe.json"),
    routingProbeSend: join(dir, "routing-probe-send.json"),
    routingProbePreflight: join(dir, "routing-preflight.json"),
    githubRoutingSecrets: join(dir, "github-routing-secrets.json"),
    githubStaffSecrets: join(dir, "github-staff-secrets-readiness.json"),
    viewsAudit: join(dir, "views.json"),
    rulesAudit: join(dir, "rules.json"),
    staffWorkflowAudit: join(dir, "staff-workflow.json"),
  };
  const artifacts: Record<string, Record<string, unknown>> = {
    sourceAudit: {
      generatedAt: freshFixtureTimestamp,
      repoHead,
      zeroEstimateAnalysis: {
        knownCodeGaps: [],
        coverageGate: { codeCoveragePass: true },
      },
    },
    opsAudit: {
      generatedAt: freshFixtureTimestamp,
      repoHead,
      gate: {
        sourceInventoryMissing: [],
        currentSharedGmailRoutingUnconfirmed: [],
        noSharedInboxEvidence: [],
        routingConfirmationRequired: [],
      },
    },
    gwsRoutingAudit: {
      generatedAt: freshFixtureTimestamp,
      repoHead,
      gate: {},
      dns: { mxRecords: [{ exchange: "mx01.lolipop.jp", priority: 50 }] },
    },
    routingProbeAudit: {
      generatedAt: freshFixtureTimestamp,
      repoHead,
      mode: "verify_marker",
      inputs: {
        marker: routingProbeMarker,
      },
      plannedAddressProbes: canonicalRoutingProbePlan.map(({ channelId, label, address }) => ({ channelId, label, address })),
      gate: {
        targetAddressCount: canonicalRoutingProbeAddresses.length,
        markerProvided: true,
        allExpectedAddressesConfirmed: true,
        matchedAddresses: canonicalRoutingProbeAddresses,
        missingAddresses: [],
      },
    },
    routingProbeSend: {
      generatedAt: freshFixtureTimestamp,
      repoHead,
      mode: "sent",
      marker: routingProbeMarker,
      probeCount: canonicalRoutingProbePlan.length,
      addressProbes: canonicalRoutingProbePlan,
      sent: canonicalRoutingProbePlan.map(({ channelId, address }, index) => ({
        channelId,
        address,
        accepted: [address],
        rejected: [],
        messageId: `fixture-message-${index}`,
      })),
      smtpPreflight: {
        readyForProductionProof: true,
      },
      verification: {
        status: "matched",
        allExpectedAddressesConfirmed: true,
      },
    },
    routingProbePreflight: {
      generatedAt: freshFixtureTimestamp,
      repoHead,
      smtpPreflight: {
        readyForProductionProof: true,
        missingRequiredEnv: [],
        warnings: [],
      },
    },
    githubRoutingSecrets: {
      checkedAt: freshFixtureTimestamp,
      repoHead,
      readyForPreflightProductionProof: true,
      readyForSendVerify: true,
      missingPreflightSecrets: [],
      missingSendVerifySecrets: [],
    },
    githubStaffSecrets: {
      source: "github_actions_config",
      checkedAt: freshFixtureTimestamp,
      repoHead,
      secretCount: 12,
      variableCount: 12,
      readyForProductionStaffPreflight: true,
      readyForSecretBackedStaffConfig: true,
      missingProductionStaffConfig: [],
      missingSecretConfig: [],
      semanticIssues: [],
      setupCommands: [],
      presentRequiredConfigSources: {
        MAILHUB_ENV: "variable",
        MAILHUB_CONFIG_STORE: "variable",
        MAILHUB_ACTIVITY_STORE: "variable",
        MAILHUB_READ_ONLY: "variable",
      },
    },
    viewsAudit: {
      generatedAt: freshFixtureTimestamp,
      repoHead,
      gate: {
        syntaxReady: true,
        manualReviewOnly: false,
        bulkAutomationSafe: true,
        syntaxFailedViews: [],
        manualReviewOnlyViews: [],
        bulkUnsafeViews: [],
      },
      views: [],
    },
    rulesAudit: {
      generatedAt: freshFixtureTimestamp,
      repoHead,
      inputs: {
        envFileMode: "process_env_only",
        valuePolicy: "present",
      },
      config: {
        ruleSetFingerprint: "sha256:abc123",
        requestedSource: "sheets",
        resolvedSource: "sheets",
        ruleSheets: {
          labelRules: "ConfigRules",
          assigneeRules: "ConfigAssigneeRules",
        },
        warnings: [],
      },
      ruleSafetyGate: {
        realDataRuleRiskPass: true,
      },
    },
    staffWorkflowAudit: {
      generatedAt: freshFixtureTimestamp,
      repoHead,
      gate: {
        staffWorkflowPermissionsReady: true,
        readOnlyRolloutReady: true,
        controlledWritePilotReady: true,
      },
      requirements: {
        staffWorkflowPermissionsReady: true,
      },
      blockers: [],
    },
  };

  for (const key of Object.keys(paths)) {
    writeJson(paths[key], { ...artifacts[key], ...(overrides[key] ?? {}) });
  }

  return paths;
}

function aggregateArgs(paths: Record<string, string>, outPath: string) {
  return [
    "--source-audit",
    paths.sourceAudit,
    "--ops-audit",
    paths.opsAudit,
    "--gws-routing-audit",
    paths.gwsRoutingAudit,
    "--routing-probe-audit",
    paths.routingProbeAudit,
    "--routing-probe-send",
    paths.routingProbeSend,
    "--routing-probe-preflight",
    paths.routingProbePreflight,
    "--github-routing-secrets",
    paths.githubRoutingSecrets,
    "--github-staff-secrets",
    paths.githubStaffSecrets,
    "--views-audit",
    paths.viewsAudit,
    "--rules-audit",
    paths.rulesAudit,
    "--staff-workflow-audit",
    paths.staffWorkflowAudit,
    "--out",
    outPath,
  ];
}

describe("MailHub readiness contract check", () => {
  test("accepts explicit not-ready routing evidence", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      writeJson(auditPath, baseReadinessAudit(dir));

      const result = runContract(auditPath);
      expect(result.status).toBe(0);
      const out = JSON.parse(result.stdout) as { ok: boolean; errors: string[] };
      expect(out.ok).toBe(true);
      expect(out.errors).toEqual([]);
    });
  });

  test("rejects stale readiness artifacts outside current lineage", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      writeJson(auditPath, baseReadinessAudit(dir, { repoHead: "old123" }));

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("stale_repo_head");
    });
  });

  test("rejects production-ready claims when child input freshness is not clean", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      const audit = baseReadinessAudit(dir);
      const staleInputFreshness = audit.inputs.inputFreshness.map((entry) =>
        entry.key === "sourceAudit"
          ? { ...entry, repoHead: "old123", repoHeadFresh: false, status: "stale_repo_head", readyForProduction: false }
          : entry);
      writeJson(auditPath, {
        ...audit,
        requirements: {
          ...audit.requirements,
          inputArtifactsFresh: false,
          currentSharedGmailRoutingReady: true,
          routingProbeReady: true,
          routingProbePreflightReady: true,
          routingProbeGithubSecretsReady: true,
          defaultViewsBulkAutomationSafe: true,
          staffWorkflowPermissionsReady: true,
          staffGithubConfigReady: true,
          staffReadOnlyRolloutReady: true,
          staffControlledWritePilotReady: true,
        },
        inputs: {
          ...audit.inputs,
          inputFreshness: staleInputFreshness,
        },
        viewSafety: {
          syntaxFailedViews: [],
          manualReviewOnlyViews: ["invoice-docs"],
          bulkUnsafeViews: [],
        },
        gate: {
          productionReady: true,
          p0Blockers: [],
          p1Blockers: [],
        },
        blockers: [],
      });

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("production_ready_with_stale_inputs");
      expect(result.stdout).toContain("input_artifacts_not_fresh_without_stale_input_blocker");
    });
  });

  test("rejects fresh aggregate input claims when referenced child artifacts are stale, unversioned, or missing", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      const audit = baseReadinessAudit(dir);
      const sourceAudit = audit.inputs.inputFreshness.find((entry) => entry.key === "sourceAudit");
      const opsAudit = audit.inputs.inputFreshness.find((entry) => entry.key === "opsAudit");
      const routingProbeAudit = audit.inputs.inputFreshness.find((entry) => entry.key === "routingProbeAudit");
      if (!sourceAudit || !opsAudit || !routingProbeAudit) throw new Error("missing test input freshness fixture");

      writeJson(sourceAudit.path, {
        generatedAt: "2026-06-17T00:00:00.000Z",
        repoHead: "old123",
      });
      writeJson(opsAudit.path, {
        generatedAt: "2026-06-17T00:00:00.000Z",
      });
      rmSync(routingProbeAudit.path, { force: true });
      writeJson(auditPath, audit);

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("input_freshness_child_repo_head_mismatch:sourceAudit");
      expect(result.stdout).toContain("input_freshness_child_status_mismatch:sourceAudit");
      expect(result.stdout).toContain("input_freshness_child_repo_head_mismatch:opsAudit");
      expect(result.stdout).toContain("input_freshness_child_status_mismatch:opsAudit");
      expect(result.stdout).toContain("input_freshness_child_present_mismatch:routingProbeAudit");
      expect(result.stdout).toContain("input_artifacts_fresh_with_stale_inputs");
    });
  });

  test("rejects fresh aggregate routing probe child claims when generatedAt is stale", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      const audit = baseReadinessAudit(dir);
      const routingProbeSend = audit.inputs.inputFreshness.find((entry) => entry.key === "routingProbeSend");
      const routingProbeAudit = audit.inputs.inputFreshness.find((entry) => entry.key === "routingProbeAudit");
      if (!routingProbeSend || !routingProbeAudit) throw new Error("missing routing probe freshness fixture");

      writeJson(routingProbeSend.path, {
        generatedAt: "2000-01-01T00:00:00.000Z",
        repoHead: "head123",
      });
      writeJson(routingProbeAudit.path, {
        generatedAt: "2000-01-01T00:00:00.000Z",
        repoHead: "head123",
      });
      writeJson(auditPath, audit);

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("input_freshness_child_status_mismatch:routingProbeSend");
      expect(result.stdout).toContain("input_freshness_child_ready_mismatch:routingProbeSend");
      expect(result.stdout).toContain("input_freshness_child_timestamp_mismatch:routingProbeSend");
      expect(result.stdout).toContain("input_freshness_child_timestamp_fresh_mismatch:routingProbeSend");
      expect(result.stdout).toContain("input_freshness_stale_timestamp_ready:routingProbeSend");
      expect(result.stdout).toContain("input_freshness_child_status_mismatch:routingProbeAudit");
      expect(result.stdout).toContain("input_freshness_child_ready_mismatch:routingProbeAudit");
      expect(result.stdout).toContain("input_freshness_child_timestamp_mismatch:routingProbeAudit");
      expect(result.stdout).toContain("input_freshness_child_timestamp_fresh_mismatch:routingProbeAudit");
      expect(result.stdout).toContain("input_freshness_stale_timestamp_ready:routingProbeAudit");
      expect(result.stdout).toContain("input_artifacts_fresh_with_stale_inputs");
    });
  });

  test("rejects fresh aggregate non-routing child claims when generatedAt or checkedAt is stale", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      const audit = baseReadinessAudit(dir);
      const sourceAudit = audit.inputs.inputFreshness.find((entry) => entry.key === "sourceAudit");
      const githubRoutingSecrets = audit.inputs.inputFreshness.find((entry) => entry.key === "githubRoutingSecrets");
      if (!sourceAudit || !githubRoutingSecrets) throw new Error("missing non-routing freshness fixture");

      writeJson(sourceAudit.path, {
        generatedAt: "2000-01-01T00:00:00.000Z",
        repoHead: "head123",
      });
      writeJson(githubRoutingSecrets.path, {
        checkedAt: "2000-01-01T00:00:00.000Z",
        repoHead: "head123",
      });
      writeJson(auditPath, audit);

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("input_freshness_child_status_mismatch:sourceAudit");
      expect(result.stdout).toContain("input_freshness_child_ready_mismatch:sourceAudit");
      expect(result.stdout).toContain("input_freshness_child_timestamp_mismatch:sourceAudit");
      expect(result.stdout).toContain("input_freshness_child_timestamp_fresh_mismatch:sourceAudit");
      expect(result.stdout).toContain("input_freshness_stale_timestamp_ready:sourceAudit");
      expect(result.stdout).toContain("input_freshness_child_status_mismatch:githubRoutingSecrets");
      expect(result.stdout).toContain("input_freshness_child_ready_mismatch:githubRoutingSecrets");
      expect(result.stdout).toContain("input_freshness_child_timestamp_mismatch:githubRoutingSecrets");
      expect(result.stdout).toContain("input_freshness_child_timestamp_fresh_mismatch:githubRoutingSecrets");
      expect(result.stdout).toContain("input_freshness_stale_timestamp_ready:githubRoutingSecrets");
      expect(result.stdout).toContain("input_artifacts_fresh_with_stale_inputs");
    });
  });

  test("rejects routing probe timestampField spoof that hides stale generatedAt", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      const audit = baseReadinessAudit(dir);
      const spoofedInputFreshness = audit.inputs.inputFreshness.map((entry) =>
        entry.key === "routingProbeSend" || entry.key === "routingProbeAudit"
          ? { ...entry, timestampField: "checkedAt", timestamp: freshFixtureTimestamp }
          : entry);
      const routingProbeSend = spoofedInputFreshness.find((entry) => entry.key === "routingProbeSend");
      const routingProbeAudit = spoofedInputFreshness.find((entry) => entry.key === "routingProbeAudit");
      if (!routingProbeSend || !routingProbeAudit) throw new Error("missing routing probe freshness fixture");

      writeJson(routingProbeSend.path, {
        generatedAt: "2000-01-01T00:00:00.000Z",
        checkedAt: freshFixtureTimestamp,
        repoHead: "head123",
      });
      writeJson(routingProbeAudit.path, {
        generatedAt: "2000-01-01T00:00:00.000Z",
        checkedAt: freshFixtureTimestamp,
        repoHead: "head123",
      });
      writeJson(auditPath, {
        ...audit,
        inputs: {
          ...audit.inputs,
          inputFreshness: spoofedInputFreshness,
        },
      });

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("input_freshness_child_timestamp_field_mismatch:routingProbeSend");
      expect(result.stdout).toContain("input_freshness_child_status_mismatch:routingProbeSend");
      expect(result.stdout).toContain("input_freshness_child_ready_mismatch:routingProbeSend");
      expect(result.stdout).toContain("input_freshness_child_timestamp_mismatch:routingProbeSend");
      expect(result.stdout).toContain("input_freshness_child_timestamp_fresh_mismatch:routingProbeSend");
      expect(result.stdout).toContain("input_freshness_stale_timestamp_ready:routingProbeSend");
      expect(result.stdout).toContain("input_freshness_child_timestamp_field_mismatch:routingProbeAudit");
      expect(result.stdout).toContain("input_freshness_child_status_mismatch:routingProbeAudit");
      expect(result.stdout).toContain("input_freshness_child_ready_mismatch:routingProbeAudit");
      expect(result.stdout).toContain("input_freshness_child_timestamp_mismatch:routingProbeAudit");
      expect(result.stdout).toContain("input_freshness_child_timestamp_fresh_mismatch:routingProbeAudit");
      expect(result.stdout).toContain("input_freshness_stale_timestamp_ready:routingProbeAudit");
      expect(result.stdout).toContain("input_artifacts_fresh_with_stale_inputs");
    });
  });

  test("rejects freshness entries without matching declared input paths", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      const audit = baseReadinessAudit(dir);
      delete (audit.inputs as Record<string, unknown>).opsAudit;
      writeJson(auditPath, audit);

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("input_freshness_missing_declared_path:opsAudit");
      expect(result.stdout).toContain("input_artifacts_fresh_with_stale_inputs");
    });
  });

  test("rejects stale declared routing probe send artifacts hidden by fresh freshness shadows", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      const staleRoutingProbeSendPath = join(dir, "stale-routing-probe-send.json");
      const audit = baseReadinessAudit(dir);
      writeJson(staleRoutingProbeSendPath, {
        generatedAt: "2026-06-17T00:00:00.000Z",
        repoHead: "old123",
      });
      writeJson(auditPath, {
        ...audit,
        inputs: {
          ...audit.inputs,
          routingProbeSend: staleRoutingProbeSendPath,
        },
      });

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("input_freshness_path_mismatch:routingProbeSend");
      expect(result.stdout).toContain("input_freshness_child_repo_head_mismatch:routingProbeSend");
      expect(result.stdout).toContain("input_freshness_child_status_mismatch:routingProbeSend");
      expect(result.stdout).toContain("input_artifacts_fresh_with_stale_inputs");
    });
  });

  test("aggregate readiness blocks production-ready output from unversioned child artifacts", () => {
    withTempDir((dir) => {
      const outPath = join(dir, "readiness.json");
      const repoHead = gitRevParse("HEAD");
      const paths = writeReadyAggregateArtifacts(dir, repoHead, {
        sourceAudit: { repoHead: undefined },
      });

      const result = runAudit(aggregateArgs(paths, outPath));
      expect(result.status).toBe(0);
      const out = readJson<{
        requirements: { inputArtifactsFresh: boolean };
        gate: { productionReady: boolean; p0Blockers: string[] };
        blockers: Array<{
          id: string;
          evidence?: { staleInputs?: Array<{ key: string; status: string }> };
        }>;
      }>(outPath);
      expect(out.requirements.inputArtifactsFresh).toBe(false);
      expect(out.gate.productionReady).toBe(false);
      expect(out.gate.p0Blockers).toContain("staleInput");
      const blocker = out.blockers.find((item) => item.id === "staleInput");
      expect(blocker?.evidence?.staleInputs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: "sourceAudit", status: "missing_repo_head" }),
        ]),
      );
    });
  });

  test("aggregate readiness stores repo-local child artifact paths as relative paths", () => {
    const dir = mkdtempSync(join(process.cwd(), ".tmp-mailhub-readiness-contract-"));
    try {
      const outPath = join(dir, "readiness.json");
      const repoHead = gitRevParse("HEAD");
      const paths = writeReadyAggregateArtifacts(dir, repoHead);

      const result = runAudit(aggregateArgs(paths, outPath));
      expect(result.status).toBe(0);
      const out = readJson<{
        inputs: Record<string, string> & {
          inputFreshness: Array<{ key: string; path: string; readyForProduction: boolean }>;
        };
      }>(outPath);

      for (const key of inputFreshnessKeys) {
        expect(isAbsolute(out.inputs[key])).toBe(false);
        expect(out.inputs[key]).toContain(".tmp-mailhub-readiness-contract-");
      }
      for (const entry of out.inputs.inputFreshness) {
        expect(isAbsolute(entry.path)).toBe(false);
        expect(entry.path).toContain(".tmp-mailhub-readiness-contract-");
        expect(entry.readyForProduction).toBe(true);
      }

      const contract = runContract(outPath, repoHead, "parent123");
      expect(contract.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("aggregate readiness blocks production-ready output from stale repoHead child artifacts", () => {
    withTempDir((dir) => {
      const outPath = join(dir, "readiness.json");
      const repoHead = gitRevParse("HEAD");
      const paths = writeReadyAggregateArtifacts(dir, repoHead, {
        staffWorkflowAudit: { repoHead: "old123" },
      });

      const result = runAudit(aggregateArgs(paths, outPath));
      expect(result.status).toBe(0);
      const out = readJson<{
        requirements: { inputArtifactsFresh: boolean };
        gate: { productionReady: boolean; p0Blockers: string[] };
        blockers: Array<{
          id: string;
          evidence?: { staleInputs?: Array<{ key: string; status: string }> };
        }>;
      }>(outPath);
      expect(out.requirements.inputArtifactsFresh).toBe(false);
      expect(out.gate.productionReady).toBe(false);
      expect(out.gate.p0Blockers).toContain("staleInput");
      const blocker = out.blockers.find((item) => item.id === "staleInput");
      expect(blocker?.evidence?.staleInputs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: "staffWorkflowAudit", status: "stale_repo_head" }),
        ]),
      );
    });
  });

  test("aggregate readiness blocks current-repoHead non-routing child artifacts with old timestamps", () => {
    withTempDir((dir) => {
      const outPath = join(dir, "readiness.json");
      const repoHead = gitRevParse("HEAD");
      const oldTimestamp = "2000-01-01T00:00:00.000Z";
      const paths = writeReadyAggregateArtifacts(dir, repoHead, {
        sourceAudit: {
          generatedAt: oldTimestamp,
        },
        githubRoutingSecrets: {
          checkedAt: oldTimestamp,
        },
      });

      const result = runAudit(aggregateArgs(paths, outPath));
      expect(result.status).toBe(0);
      const out = readJson<{
        requirements: { inputArtifactsFresh: boolean };
        gate: { productionReady: boolean; p0Blockers: string[] };
        blockers: Array<{
          id: string;
          evidence?: { staleInputs?: Array<{ key: string; status: string }> };
        }>;
      }>(outPath);
      expect(out.requirements.inputArtifactsFresh).toBe(false);
      expect(out.gate.productionReady).toBe(false);
      expect(out.gate.p0Blockers).toContain("staleInput");
      const blocker = out.blockers.find((item) => item.id === "staleInput");
      expect(blocker?.evidence?.staleInputs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: "sourceAudit", status: "stale_timestamp" }),
          expect.objectContaining({ key: "githubRoutingSecrets", status: "stale_timestamp" }),
        ]),
      );
    });
  });

  test("aggregate readiness blocks current-repoHead routing proof with old external timestamps", () => {
    withTempDir((dir) => {
      const outPath = join(dir, "readiness.json");
      const repoHead = gitRevParse("HEAD");
      const oldTimestamp = "2000-01-01T00:00:00.000Z";
      const oldMarker = "MAILHUB-ROUTING-PROBE-20000101T000000Z";
      const oldProbePlan = canonicalRoutingProbeAddresses.map((address, index) => ({
        channelId: `channel-${index}`,
        label: `Channel ${index}`,
        address,
        subject: oldMarker,
      }));
      const paths = writeReadyAggregateArtifacts(dir, repoHead, {
        routingProbeAudit: {
          generatedAt: oldTimestamp,
          inputs: { marker: oldMarker },
        },
        routingProbeSend: {
          generatedAt: oldTimestamp,
          marker: oldMarker,
          addressProbes: oldProbePlan,
          sent: oldProbePlan.map(({ channelId, address }, index) => ({
            channelId,
            address,
            accepted: [address],
            rejected: [],
            messageId: `fixture-message-${index}`,
          })),
        },
      });

      const result = runAudit(aggregateArgs(paths, outPath));
      expect(result.status).toBe(0);
      const out = readJson<{
        requirements: {
          inputArtifactsFresh: boolean;
          routingProofChainReady: boolean;
          currentSharedGmailRoutingReady: boolean;
        };
        gate: { productionReady: boolean; p0Blockers: string[] };
        blockers: Array<{
          id: string;
          evidence?: {
            staleInputs?: Array<{ key: string; status: string }>;
            routingProofChain?: { issues?: string[] };
          };
        }>;
      }>(outPath);
      expect(out.requirements.inputArtifactsFresh).toBe(false);
      expect(out.requirements.routingProofChainReady).toBe(false);
      expect(out.requirements.currentSharedGmailRoutingReady).toBe(false);
      expect(out.gate.productionReady).toBe(false);
      expect(out.gate.p0Blockers).toEqual(expect.arrayContaining(["staleInput", "current_shared_gmail_routing"]));
      const staleBlocker = out.blockers.find((item) => item.id === "staleInput");
      expect(staleBlocker?.evidence?.staleInputs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: "routingProbeAudit", status: "stale_timestamp" }),
          expect.objectContaining({ key: "routingProbeSend", status: "stale_timestamp" }),
        ]),
      );
      const routingBlocker = out.blockers.find((item) => item.id === "current_shared_gmail_routing");
      expect(routingBlocker?.evidence?.routingProofChain?.issues).toEqual(
        expect.arrayContaining([
          "routing_probe_audit_generated_at_stale",
          "routing_probe_send_generated_at_stale",
          "routing_probe_marker_stale",
        ]),
      );
    });
  });

  test("rejects routing blockers without preflight gap evidence", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      writeJson(auditPath, baseReadinessAudit(dir, {
        blockers: [
          {
            id: "current_shared_gmail_routing",
            severity: "P0",
            evidence: {
              currentSharedGmailRoutingUnconfirmed: ["gopro-yahoo"],
              routingProbeGate: {
                targetAddressCount: 8,
                allExpectedAddressesConfirmed: false,
                missingAddresses: ["gopro_y@vtj.co.jp"],
              },
              routingProbePreflight: {
                readyForProductionProof: false,
                missingRequiredEnv: [],
                warnings: [],
              },
              mxRecords: [{ exchange: "mx01.lolipop.jp", priority: 50 }],
            },
          },
        ],
      }));

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("routing_blocker_missing_preflight_gap");
    });
  });

  test("rejects routing blockers without GitHub secret gap evidence", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      writeJson(auditPath, baseReadinessAudit(dir, {
        blockers: [
          {
            id: "current_shared_gmail_routing",
            severity: "P0",
            evidence: {
              currentSharedGmailRoutingUnconfirmed: ["gopro-yahoo"],
              routingProbeGate: {
                targetAddressCount: 8,
                allExpectedAddressesConfirmed: false,
                missingAddresses: ["gopro_y@vtj.co.jp"],
              },
              routingProbePreflight: {
                readyForProductionProof: false,
                missingRequiredEnv: ["MAILHUB_PROBE_SMTP_HOST"],
                warnings: [],
              },
              routingProbeGithubSecrets: {
                readyForSendVerify: false,
                missingSendVerifySecrets: [],
              },
              mxRecords: [{ exchange: "mx01.lolipop.jp", priority: 50 }],
            },
          },
        ],
      }));

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("routing_blocker_missing_github_secret_gap");
    });
  });

  test("rejects rule safety readiness without a config fingerprint", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      const audit = baseReadinessAudit(dir);
      writeJson(auditPath, {
        ...audit,
        requirements: {
          ...audit.requirements,
          currentRuleConfigFingerprintPresent: false,
        },
        inputs: {},
      });

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("rule_safety_ready_without_config_fingerprint");
    });
  });

  test("rejects missing rule config source gate", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      const audit = baseReadinessAudit(dir);
      const requirements = { ...audit.requirements };
      delete (requirements as Record<string, unknown>).currentRuleConfigSourceProductionReady;
      writeJson(auditPath, {
        ...audit,
        requirements,
      });

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("rule_config_source_gate_missing");
    });
  });

  test("rejects missing rule safety env source gate", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      const audit = baseReadinessAudit(dir);
      const requirements = { ...audit.requirements };
      delete (requirements as Record<string, unknown>).currentRuleSafetyEnvSourceExplicit;
      writeJson(auditPath, {
        ...audit,
        requirements,
      });

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("rule_safety_env_source_gate_missing");
    });
  });

  test("rejects production-ready rule safety without explicit env source", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      const audit = baseReadinessAudit(dir);
      writeJson(auditPath, {
        ...audit,
        requirements: {
          ...audit.requirements,
          currentSharedGmailRoutingReady: true,
          routingProbeReady: true,
          routingProbePreflightReady: true,
          routingProbeGithubSecretsReady: true,
          defaultViewsBulkAutomationSafe: true,
          currentRuleSafetyEnvSourceExplicit: false,
          staffWorkflowPermissionsReady: true,
          staffGithubConfigReady: true,
        },
        viewSafety: {
          syntaxFailedViews: [],
          manualReviewOnlyViews: ["invoice-docs"],
          bulkUnsafeViews: [],
        },
        inputs: {
          ...audit.inputs,
          ruleSafetyAuditEnv: {},
        },
        gate: {
          productionReady: true,
          p0Blockers: [],
          p1Blockers: [],
        },
        blockers: [],
      });

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("production_ready_without_rule_safety_env_source");
      expect(result.stdout).toContain("rule_safety_env_source_not_ready_without_blocker");
    });
  });

  test("rejects env-file mode that did not load an env file", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      const audit = baseReadinessAudit(dir);
      writeJson(auditPath, {
        ...audit,
        inputs: {
          ...audit.inputs,
          ruleSafetyAuditEnv: {
            envFile: ".env.local",
            envFileLoaded: false,
            envFileMode: "env_file",
          },
        },
      });

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("rule_safety_env_file_mode_not_loaded");
    });
  });

  test("rejects non-production rule config source without blocker evidence", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      const audit = baseReadinessAudit(dir);
      writeJson(auditPath, {
        ...audit,
        requirements: {
          ...audit.requirements,
          currentRuleConfigSourceProductionReady: false,
        },
      });

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("rule_config_source_not_ready_without_blocker");
      expect(result.stdout).toContain("rule_config_source_blocker_missing_detail");
    });
  });

  test("accepts non-production rule config source when explicit blocker evidence is present", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      const audit = baseReadinessAudit(dir);
      writeJson(auditPath, {
        ...audit,
        requirements: {
          ...audit.requirements,
          currentRuleConfigSourceProductionReady: false,
        },
        gate: {
          ...audit.gate,
          p1Blockers: ["staff_workflow_permissions", "staff_github_config_not_ready", "rule_config_source_not_production"],
        },
        blockers: [
          ...audit.blockers,
          {
            id: "rule_config_source_not_production",
            severity: "P1",
            evidence: {
              ruleConfigSource: {
                requestedSource: "file",
                resolvedSource: "file",
                warnings: [],
              },
              ruleSetFingerprint: "sha256:abc123",
            },
          },
        ],
      });

      const result = runContract(auditPath);
      expect(result.status).toBe(0);
    });
  });

  test("rejects missing staff GitHub config gate", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      const audit = baseReadinessAudit(dir);
      const requirements = { ...audit.requirements };
      delete (requirements as Record<string, unknown>).staffGithubConfigReady;
      writeJson(auditPath, {
        ...audit,
        requirements,
      });

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("staff_github_config_gate_missing");
    });
  });

  test("rejects staff GitHub config gaps without blocker evidence", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      const audit = baseReadinessAudit(dir);
      writeJson(auditPath, {
        ...audit,
        gate: {
          ...audit.gate,
          p1Blockers: ["staff_workflow_permissions"],
        },
        blockers: audit.blockers.filter((blocker) => blocker.id !== "staff_github_config_not_ready"),
      });

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("staff_github_config_not_ready_without_blocker");
      expect(result.stdout).toContain("staff_github_config_blocker_missing_detail");
    });
  });

  test("aggregate readiness rejects staff GitHub semantic config sources that are not variables", () => {
    withTempDir((dir) => {
      const sourceAuditPath = join(dir, "source.json");
      const opsAuditPath = join(dir, "ops.json");
      const gwsRoutingPath = join(dir, "gws.json");
      const viewsPath = join(dir, "views.json");
      const rulesPath = join(dir, "rules.json");
      const staffWorkflowPath = join(dir, "staff-workflow.json");
      const staffGithubPath = join(dir, "github-staff-secrets-readiness.json");
      const outPath = join(dir, "readiness.json");
      const repoHead = gitRevParse("HEAD");

      writeJson(sourceAuditPath, {
        zeroEstimateAnalysis: {
          knownCodeGaps: [],
          coverageGate: { codeCoveragePass: true },
        },
      });
      writeJson(opsAuditPath, {
        gate: {
          sourceInventoryMissing: [],
          currentSharedGmailRoutingUnconfirmed: [],
          noSharedInboxEvidence: [],
          routingConfirmationRequired: [],
        },
      });
      writeJson(gwsRoutingPath, { gate: {}, dns: { mxRecords: [] } });
      writeJson(viewsPath, {
        gate: {
          syntaxReady: true,
          manualReviewOnly: false,
          bulkAutomationSafe: true,
          syntaxFailedViews: [],
          manualReviewOnlyViews: [],
          bulkUnsafeViews: [],
        },
        views: [],
      });
      writeJson(rulesPath, {
        inputs: {
          envFileMode: "process_env_only",
          valuePolicy: "present",
        },
        config: {
          ruleSetFingerprint: "sha256:abc123",
          requestedSource: "sheets",
          resolvedSource: "sheets",
          ruleSheets: {
            labelRules: "ConfigRules",
            assigneeRules: "ConfigAssigneeRules",
          },
          warnings: [],
        },
        ruleSafetyGate: {
          realDataRuleRiskPass: true,
        },
      });
      writeJson(staffWorkflowPath, {
        gate: {
          staffWorkflowPermissionsReady: true,
          readOnlyRolloutReady: true,
          controlledWritePilotReady: true,
        },
        requirements: {
          staffWorkflowPermissionsReady: true,
        },
        blockers: [],
      });
      writeJson(staffGithubPath, {
        source: "github_actions_config",
        checkedAt: "2026-06-17T00:00:00.000Z",
        repoHead,
        secretCount: 12,
        variableCount: 12,
        readyForProductionStaffPreflight: true,
        readyForSecretBackedStaffConfig: true,
        missingProductionStaffConfig: [],
        missingSecretConfig: [],
        semanticIssues: [],
        setupCommands: [],
        presentRequiredConfigSources: {
          MAILHUB_ENV: "secret",
          MAILHUB_CONFIG_STORE: "secret",
          MAILHUB_ACTIVITY_STORE: "secret",
          MAILHUB_READ_ONLY: "secret",
        },
      });

      const result = runAudit([
        "--source-audit",
        sourceAuditPath,
        "--ops-audit",
        opsAuditPath,
        "--gws-routing-audit",
        gwsRoutingPath,
        "--github-staff-secrets",
        staffGithubPath,
        "--views-audit",
        viewsPath,
        "--rules-audit",
        rulesPath,
        "--staff-workflow-audit",
        staffWorkflowPath,
        "--out",
        outPath,
      ]);

      expect(result.status).toBe(0);
      const out = readJson<{
        requirements: { staffGithubConfigReady: boolean };
        blockers: Array<{ id: string; evidence: { staffGithubConfig?: { semanticSourceIssues?: string[] } } }>;
      }>(outPath);
      expect(out.requirements.staffGithubConfigReady).toBe(false);
      const blocker = out.blockers.find((item) => item.id === "staff_github_config_not_ready");
      expect(blocker?.evidence.staffGithubConfig?.semanticSourceIssues).toEqual([
        "MAILHUB_ENV_must_be_variable",
        "MAILHUB_CONFIG_STORE_must_be_variable",
        "MAILHUB_ACTIVITY_STORE_must_be_variable",
        "MAILHUB_READ_ONLY_must_be_variable",
      ]);
    });
  });

  test("readiness contract rejects staff GitHub semantic config sources that are not variables", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      const staffGithubPath = join(dir, "github-staff-secrets-readiness.json");
      writeJson(staffGithubPath, {
        source: "github_actions_config",
        repoHead: "head123",
        readyForProductionStaffPreflight: true,
        readyForSecretBackedStaffConfig: true,
        missingProductionStaffConfig: [],
        missingSecretConfig: [],
        semanticIssues: [],
        presentRequiredConfigSources: {
          MAILHUB_ENV: "secret",
          MAILHUB_CONFIG_STORE: "secret",
          MAILHUB_ACTIVITY_STORE: "secret",
          MAILHUB_READ_ONLY: "secret",
        },
      });
      const audit = baseReadinessAudit(dir);
      writeJson(auditPath, {
        ...audit,
        requirements: {
          ...audit.requirements,
          staffGithubConfigReady: true,
        },
        inputs: {
          ...audit.inputs,
          githubStaffSecrets: staffGithubPath,
        },
      });

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("staff_github_config_semantic_non_variable_source:MAILHUB_ENV");
      expect(result.stdout).toContain("staff_github_config_semantic_non_variable_source:MAILHUB_CONFIG_STORE");
      expect(result.stdout).toContain("staff_github_config_semantic_non_variable_source:MAILHUB_ACTIVITY_STORE");
      expect(result.stdout).toContain("staff_github_config_semantic_non_variable_source:MAILHUB_READ_ONLY");
      expect(result.stdout).toContain("staff_github_config_ready_without_semantic_variable_sources");
    });
  });

  test("rejects production-ready staff GitHub claims that contradict the referenced artifact", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      const staffGithubPath = join(dir, "github-staff-secrets-readiness.json");
      writeJson(staffGithubPath, {
        readyForProductionStaffPreflight: false,
        readyForSecretBackedStaffConfig: false,
        missingProductionStaffConfig: ["MAILHUB_ENV"],
        missingSecretConfig: ["NEXTAUTH_SECRET"],
      });
      const audit = baseReadinessAudit(dir);
      writeJson(auditPath, {
        ...audit,
        requirements: {
          ...audit.requirements,
          currentSharedGmailRoutingReady: true,
          routingProbeReady: true,
          routingProbePreflightReady: true,
          routingProbeGithubSecretsReady: true,
          staffWorkflowPermissionsReady: true,
          staffGithubConfigReady: true,
          staffReadOnlyRolloutReady: true,
          staffControlledWritePilotReady: true,
        },
        inputs: {
          ...audit.inputs,
          githubStaffSecrets: staffGithubPath,
        },
        gate: {
          productionReady: true,
          p0Blockers: [],
          p1Blockers: [],
        },
        blockers: [],
      });

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("staff_github_config_gate_mismatch");
      expect(result.stdout).toContain("staff_github_config_ready_without_ready_artifact");
      expect(result.stdout).toContain("staff_github_config_ready_without_secret_artifact");
    });
  });

  test("rejects production-ready staff GitHub claims backed by a non-fresh referenced artifact", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      const staffGithubPath = join(dir, "github-staff-secrets-readiness.json");
      writeJson(staffGithubPath, {
        source: "github_actions_config",
        repoHead: "parent123",
        readyForProductionStaffPreflight: true,
        readyForSecretBackedStaffConfig: true,
        missingProductionStaffConfig: [],
        missingSecretConfig: [],
        semanticIssues: [],
      });
      const audit = baseReadinessAudit(dir);
      writeJson(auditPath, {
        ...audit,
        requirements: {
          ...audit.requirements,
          currentSharedGmailRoutingReady: true,
          routingProbeReady: true,
          routingProbePreflightReady: true,
          routingProbeGithubSecretsReady: true,
          staffWorkflowPermissionsReady: true,
          staffGithubConfigReady: true,
          staffReadOnlyRolloutReady: true,
          staffControlledWritePilotReady: true,
        },
        inputs: {
          ...audit.inputs,
          githubStaffSecrets: staffGithubPath,
        },
        gate: {
          productionReady: true,
          p0Blockers: [],
          p1Blockers: [],
        },
        blockers: [],
      });

      const result = runContract(auditPath, "head123", "parent123");
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("staff_github_config_artifact_stale_repo_head");
    });
  });

  test("rejects bulk-unsafe default views without unsafe view evidence", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      writeJson(auditPath, baseReadinessAudit(dir, {
        viewSafety: {
          syntaxFailedViews: [],
          manualReviewOnlyViews: ["customer-inquiries"],
          bulkUnsafeViews: [],
        },
      }));

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("bulk_unsafe_views_missing");
    });
  });

  test("rejects bulk-unsafe default views that are not marked manual-review only", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      const audit = baseReadinessAudit(dir);
      writeJson(auditPath, {
        ...audit,
        requirements: {
          ...audit.requirements,
          defaultViewsManualReviewOnly: false,
        },
      });

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("bulk_unsafe_views_not_manual_review_only");
    });
  });

  test("rejects validated default views with syntax failure evidence", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      writeJson(auditPath, baseReadinessAudit(dir, {
        viewSafety: {
          syntaxFailedViews: ["invoice-docs"],
          manualReviewOnlyViews: ["invoice-docs"],
          bulkUnsafeViews: ["invoice-docs"],
        },
      }));

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("default_views_validated_with_syntax_failures");
    });
  });

  test("rejects production-ready claims missing shared routing readiness", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      writeJson(auditPath, baseReadinessAudit(dir, {
        gate: {
          productionReady: true,
          p0Blockers: [],
          p1Blockers: [],
        },
        blockers: [],
      }));

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("production_ready_without_current_shared_gmail_routing");
    });
  });

  test("rejects shared routing readiness without address-level routing probe proof", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      writeJson(auditPath, baseReadinessAudit(dir, {
        requirements: {
          sourceCodeCoverageReady: true,
          sourceInventoryReady: true,
          currentSharedGmailRoutingReady: true,
          routingProbeReady: false,
          routingProbePreflightReady: true,
          routingProbeGithubSecretsReady: true,
          defaultViewsRealDataValidated: true,
          defaultViewsManualReviewOnly: true,
          defaultViewsBulkAutomationSafe: false,
          currentRuleConfigRealDataSafetyReady: true,
          currentRuleConfigFingerprintPresent: true,
          currentRuleConfigSourceProductionReady: true,
        },
        gate: {
          productionReady: true,
          p0Blockers: [],
          p1Blockers: [],
        },
        blockers: [],
      }));

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("production_ready_without_routing_probe_proof");
      expect(result.stdout).toContain("shared_routing_ready_without_routing_probe_proof");
    });
  });

  test("rejects shared routing readiness without sent artifact proof chain", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "readiness.json");
      const audit = baseReadinessAudit(dir);
      writeJson(auditPath, {
        ...audit,
        requirements: {
          ...audit.requirements,
          currentSharedGmailRoutingReady: true,
          routingProbeReady: true,
          routingProbeSendReady: false,
          routingProofChainReady: false,
          routingProbePreflightReady: true,
          routingProbeGithubSecretsReady: true,
          defaultViewsBulkAutomationSafe: true,
          staffWorkflowPermissionsReady: true,
          staffGithubConfigReady: true,
        },
        viewSafety: {
          syntaxFailedViews: [],
          manualReviewOnlyViews: [],
          bulkUnsafeViews: [],
        },
        gate: {
          productionReady: true,
          p0Blockers: [],
          p1Blockers: [],
        },
        blockers: [],
      });

      const result = runContract(auditPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("production_ready_without_routing_probe_send_artifact");
      expect(result.stdout).toContain("production_ready_without_routing_proof_chain");
      expect(result.stdout).toContain("shared_routing_ready_without_send_artifact");
      expect(result.stdout).toContain("shared_routing_ready_without_routing_proof_chain");
    });
  });
});
