import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawnSync } from "child_process";
import { describe, expect, test } from "vitest";

const staffAuditPath = resolve(process.cwd(), "scripts/audit-mailhub-staff-workflow.mjs");
const staffContractPath = resolve(process.cwd(), "scripts/check-mailhub-staff-workflow-contract.mjs");

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "mailhub-staff-workflow-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const validPng = Buffer.concat(
  [
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64",
    ),
    Buffer.alloc(1200),
  ],
);

function writePng(path: string) {
  writeFileSync(path, validPng);
}

function writeActivityCsv(path: string, overrides: Partial<{ actor: string; action: string; messageId: string }> = {}) {
  writeFileSync(path, [
    "timeISO,actor,action,messageId,subject,channel,status,label,metaJSON,reason",
    `2026-06-17T12:01:00.000Z,${overrides.actor ?? "maki@vtj.co.jp"},${overrides.action ?? "assign"},${overrides.messageId ?? "msg-001"},Pilot,stores,ok,MailHub/Todo,{},pilot`,
  ].join("\n"), "utf8");
}

function runNodeScript(scriptPath: string, args: string[], env: Partial<NodeJS.ProcessEnv> = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function runNodeScriptInCwd(scriptPath: string, args: string[], cwd: string, env: Partial<NodeJS.ProcessEnv> = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: process.env.NODE_ENV ?? "test",
      ...env,
    },
  });
}

function writeProductionEvidence(dir: string) {
  mkdirSync(dir, { recursive: true });
  for (const name of [
    "mailhub-meta-topbar-readonly.png",
    "mailhub-meta-health-readonly.png",
    "mailhub-meta-topbar-write.png",
    "mailhub-meta-topbar-back-to-readonly.png",
    "gmail-msg-001-assign.png",
    "mailhub-msg-001-assign.png",
  ]) {
    writePng(join(dir, name));
  }
  writeActivityCsv(join(dir, "activity-20260617-prod.csv"));
  writeJson(join(dir, "staff-workflow-evidence-manifest.json"), {
    schema: "mailhub.staff-workflow-evidence.v1",
    capturedAt: "2026-06-17T12:00:00.000Z",
    capturedBy: "admin@vtj.co.jp",
    environment: "production",
    readOnlyRollout: {
      readOnly: true,
      mailhubTopbar: "mailhub-meta-topbar-readonly.png",
      mailhubHealth: "mailhub-meta-health-readonly.png",
      verifiedStaffEmails: ["maki@vtj.co.jp"],
    },
    controlledWritePilot: {
      messageId: "msg-001",
      action: "assign",
      actorEmail: "maki@vtj.co.jp",
      mailhubWriteTopbar: "mailhub-meta-topbar-write.png",
      mailhubBackToReadOnlyTopbar: "mailhub-meta-topbar-back-to-readonly.png",
      activityCsv: "activity-20260617-prod.csv",
      gmailProof: "gmail-msg-001-assign.png",
      mailhubProof: "mailhub-msg-001-assign.png",
      returnedToReadOnly: true,
    },
  });
}

const productionEnv = {
  MAILHUB_ENV: "production",
  MAILHUB_READ_ONLY: "1",
  MAILHUB_CONFIG_STORE: "sheets",
  MAILHUB_ACTIVITY_STORE: "sheets",
  MAILHUB_ADMINS: "admin@vtj.co.jp",
  MAILHUB_TEAM_MEMBERS: "Maki <maki@vtj.co.jp>",
  MAILHUB_SHEETS_ID: "sheet-id",
  MAILHUB_SHEETS_CLIENT_EMAIL: "svc@example.iam.gserviceaccount.com",
  MAILHUB_SHEETS_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n",
  NEXTAUTH_URL: "https://mailhub.example.com",
  NEXTAUTH_SECRET: "secret",
  GOOGLE_CLIENT_ID: "client",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_SHARED_INBOX_EMAIL: "mailhub@vtj.co.jp",
  GOOGLE_SHARED_INBOX_REFRESH_TOKEN: "refresh",
  MAILHUB_TEST_MODE: "",
};

describe("MailHub staff workflow audit", () => {
  test("loads .env.local by default without exposing secret values", () => {
    withTempDir((dir) => {
      const outPath = join(dir, "staff.json");
      const evidenceDir = join(dir, "prod");
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(join(dir, ".env.local"), [
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

      const result = runNodeScriptInCwd(staffAuditPath, [
        "--out",
        outPath,
        "--prod-evidence-dir",
        evidenceDir,
      ], dir);

      expect(result.status).toBe(0);
      const serialized = `${result.stdout}\n${readFileSync(outPath, "utf8")}`;
      expect(serialized).not.toContain("real-nextauth-secret");
      expect(serialized).not.toContain("real-google-client-secret");
      expect(serialized).not.toContain("real-refresh-token-secret");
      expect(serialized).not.toContain("real-sheet-id-secret");
      expect(serialized).not.toContain("BEGIN PRIVATE KEY");
      const artifact = JSON.parse(readFileSync(outPath, "utf8")) as {
        inputs: { envFile: string | null };
        config: { missingProductionEnv: string[]; configStore: string; activityStore: string; sheetsConfigured: boolean };
        environment: { mailhubEnv: string; readOnly: boolean };
        staff: { adminCount: number; teamMemberCount: number; staffAccessAllowlistReady: boolean };
        requirements: { productionEnvReady: boolean; durableConfigReady: boolean; durableActivityReady: boolean };
      };
      expect(artifact.inputs.envFile).toMatch(/\.env\.local$/);
      expect(artifact.environment).toMatchObject({ mailhubEnv: "production", readOnly: true });
      expect(artifact.config).toMatchObject({
        missingProductionEnv: [],
        configStore: "sheets",
        activityStore: "sheets",
        sheetsConfigured: true,
      });
      expect(artifact.staff).toMatchObject({
        adminCount: 1,
        teamMemberCount: 1,
        staffAccessAllowlistReady: true,
      });
      expect(artifact.requirements).toMatchObject({
        productionEnvReady: true,
        durableConfigReady: true,
        durableActivityReady: true,
      });
    });
  });

  test("keeps explicit process env higher priority than default .env.local", () => {
    withTempDir((dir) => {
      const outPath = join(dir, "staff.json");
      const evidenceDir = join(dir, "prod");
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(join(dir, ".env.local"), [
        "MAILHUB_ENV=production",
        "MAILHUB_ADMINS=admin@vtj.co.jp",
      ].join("\n"), "utf8");

      const result = runNodeScriptInCwd(staffAuditPath, [
        "--out",
        outPath,
        "--prod-evidence-dir",
        evidenceDir,
      ], dir, {
        MAILHUB_ENV: "local",
        MAILHUB_ADMINS: "",
      });

      expect(result.status).toBe(0);
      const artifact = JSON.parse(readFileSync(outPath, "utf8")) as {
        environment: { mailhubEnv: string };
        staff: { adminCount: number };
        gate: { p1Blockers: string[] };
      };
      expect(artifact.environment.mailhubEnv).toBe("local");
      expect(artifact.staff.adminCount).toBe(0);
      expect(artifact.gate.p1Blockers).toEqual(expect.arrayContaining(["not_production_env", "admins_not_ready"]));
    });
  });

  test("marks production staff workflow ready when env and rollout evidence are complete", () => {
    withTempDir((dir) => {
      const outPath = join(dir, "staff.json");
      const evidenceDir = join(dir, "prod");
      const assigneesPath = join(dir, "assignees.json");
      writeProductionEvidence(evidenceDir);
      writeJson(assigneesPath, [{ email: "yuka@vtj.co.jp", displayName: "Yuka" }]);

      const result = runNodeScript(staffAuditPath, [
        "--out",
        outPath,
        "--prod-evidence-dir",
        evidenceDir,
        "--assignees",
        assigneesPath,
      ], productionEnv);

      expect(result.status).toBe(0);
      const out = JSON.parse(result.stdout) as {
        staffWorkflowPermissionsReady: boolean;
        readOnlyRolloutReady: boolean;
        controlledWritePilotReady: boolean;
        p0Blockers: string[];
        p1Blockers: string[];
      };
      expect(out).toMatchObject({
        staffWorkflowPermissionsReady: true,
        readOnlyRolloutReady: true,
        controlledWritePilotReady: true,
        p0Blockers: [],
        p1Blockers: [],
      });

      const artifact = JSON.parse(readFileSync(outPath, "utf8")) as {
        repoHead: string;
        staff: { staffAccessAllowlistReady: boolean };
        requirements: { staffAccessAllowlistReady: boolean };
      };
      expect(artifact.staff.staffAccessAllowlistReady).toBe(true);
      expect(artifact.requirements.staffAccessAllowlistReady).toBe(true);
      const contract = runNodeScript(staffContractPath, [
        "--audit",
        outPath,
        "--repo-head",
        artifact.repoHead,
      ]);
      expect(contract.status).toBe(0);
    });
  });

  test("rejects staff evidence files with invalid PNG bytes", () => {
    withTempDir((dir) => {
      const outPath = join(dir, "staff.json");
      const evidenceDir = join(dir, "prod");
      const assigneesPath = join(dir, "assignees.json");
      writeProductionEvidence(evidenceDir);
      writeFileSync(join(evidenceDir, "gmail-msg-001-assign.png"), "evidence", "utf8");
      writeJson(assigneesPath, [{ email: "yuka@vtj.co.jp", displayName: "Yuka" }]);

      const result = runNodeScript(staffAuditPath, [
        "--out",
        outPath,
        "--prod-evidence-dir",
        evidenceDir,
        "--assignees",
        assigneesPath,
      ], productionEnv);

      expect(result.status).toBe(0);
      const artifact = JSON.parse(readFileSync(outPath, "utf8")) as {
        requirements: { writePilotEvidenceReady: boolean };
        evidence: { writePilotEvidenceIssues: string[]; manifest: { writePilotManifestReady: boolean } };
        gate: { staffWorkflowPermissionsReady: boolean; p1Blockers: string[] };
        repoHead: string;
      };
      expect(artifact.requirements.writePilotEvidenceReady).toBe(false);
      expect(artifact.evidence.manifest.writePilotManifestReady).toBe(false);
      expect(artifact.evidence.writePilotEvidenceIssues).toContain("manifest:png_too_small_write_gmail_proof:gmail-msg-001-assign.png");
      expect(artifact.gate.staffWorkflowPermissionsReady).toBe(false);
      expect(artifact.gate.p1Blockers).toContain("write_pilot_evidence_missing");

      const contract = runNodeScript(staffContractPath, [
        "--audit",
        outPath,
        "--repo-head",
        artifact.repoHead,
      ]);
      expect(contract.status).toBe(0);
    });
  });

  test("rejects staff evidence manifest when Activity CSV does not contain the controlled write pilot", () => {
    withTempDir((dir) => {
      const outPath = join(dir, "staff.json");
      const evidenceDir = join(dir, "prod");
      const assigneesPath = join(dir, "assignees.json");
      writeProductionEvidence(evidenceDir);
      writeActivityCsv(join(evidenceDir, "activity-20260617-prod.csv"), {
        actor: "other@vtj.co.jp",
        action: "done",
        messageId: "msg-other",
      });
      writeJson(assigneesPath, [{ email: "yuka@vtj.co.jp", displayName: "Yuka" }]);

      const result = runNodeScript(staffAuditPath, [
        "--out",
        outPath,
        "--prod-evidence-dir",
        evidenceDir,
        "--assignees",
        assigneesPath,
      ], productionEnv);

      expect(result.status).toBe(0);
      const artifact = JSON.parse(readFileSync(outPath, "utf8")) as {
        requirements: { writePilotEvidenceReady: boolean };
        evidence: { writePilotEvidenceIssues: string[] };
        gate: { staffWorkflowPermissionsReady: boolean };
      };
      expect(artifact.requirements.writePilotEvidenceReady).toBe(false);
      expect(artifact.evidence.writePilotEvidenceIssues).toContain("manifest:activity_csv_missing_controlled_write_row:activity-20260617-prod.csv");
      expect(artifact.gate.staffWorkflowPermissionsReady).toBe(false);
    });
  });

  test("rejects staff evidence manifest when proof filenames disagree with message id or action", () => {
    withTempDir((dir) => {
      const outPath = join(dir, "staff.json");
      const evidenceDir = join(dir, "prod");
      const assigneesPath = join(dir, "assignees.json");
      writeProductionEvidence(evidenceDir);
      writePng(join(evidenceDir, "gmail-msg-001-done.png"));
      writeJson(join(evidenceDir, "staff-workflow-evidence-manifest.json"), {
        schema: "mailhub.staff-workflow-evidence.v1",
        capturedAt: "2026-06-17T12:00:00.000Z",
        capturedBy: "admin@vtj.co.jp",
        environment: "production",
        readOnlyRollout: {
          readOnly: true,
          mailhubTopbar: "mailhub-meta-topbar-readonly.png",
          mailhubHealth: "mailhub-meta-health-readonly.png",
          verifiedStaffEmails: ["maki@vtj.co.jp"],
        },
        controlledWritePilot: {
          messageId: "msg-001",
          action: "assign",
          actorEmail: "maki@vtj.co.jp",
          mailhubWriteTopbar: "mailhub-meta-topbar-write.png",
          mailhubBackToReadOnlyTopbar: "mailhub-meta-topbar-back-to-readonly.png",
          activityCsv: "activity-20260617-prod.csv",
          gmailProof: "gmail-msg-001-done.png",
          mailhubProof: "mailhub-msg-001-assign.png",
          returnedToReadOnly: true,
        },
      });
      writeJson(assigneesPath, [{ email: "yuka@vtj.co.jp", displayName: "Yuka" }]);

      const result = runNodeScript(staffAuditPath, [
        "--out",
        outPath,
        "--prod-evidence-dir",
        evidenceDir,
        "--assignees",
        assigneesPath,
      ], productionEnv);

      expect(result.status).toBe(0);
      const artifact = JSON.parse(readFileSync(outPath, "utf8")) as {
        requirements: { writePilotEvidenceReady: boolean };
        evidence: { writePilotEvidenceIssues: string[] };
        gate: { staffWorkflowPermissionsReady: boolean };
      };
      expect(artifact.requirements.writePilotEvidenceReady).toBe(false);
      expect(artifact.evidence.writePilotEvidenceIssues).toContain("manifest:unexpected_write_gmail_proof:gmail-msg-001-done.png");
      expect(artifact.gate.staffWorkflowPermissionsReady).toBe(false);
    });
  });

  test("keeps local or incomplete rollout evidence blocked with explicit reasons", () => {
    withTempDir((dir) => {
      const outPath = join(dir, "staff.json");
      const evidenceDir = join(dir, "prod");
      mkdirSync(evidenceDir, { recursive: true });

      const result = runNodeScript(staffAuditPath, [
        "--out",
        outPath,
        "--prod-evidence-dir",
        evidenceDir,
        "--assignees",
        join(dir, "missing-assignees.json"),
      ], {
        MAILHUB_ENV: "local",
        MAILHUB_ADMINS: "",
        MAILHUB_TEAM_MEMBERS: "",
        MAILHUB_TEST_MODE: "",
      });

      expect(result.status).toBe(0);
      const artifact = JSON.parse(readFileSync(outPath, "utf8")) as {
        repoHead: string;
        gate: { staffWorkflowPermissionsReady: boolean; p1Blockers: string[] };
      };
      expect(artifact.gate.staffWorkflowPermissionsReady).toBe(false);
      expect(artifact.gate.p1Blockers).toEqual(expect.arrayContaining([
        "not_production_env",
        "admins_not_ready",
        "staff_access_allowlist_not_ready",
        "assignee_roster_not_ready",
        "readonly_evidence_missing",
        "write_pilot_evidence_missing",
      ]));

      const contract = runNodeScript(staffContractPath, [
        "--audit",
        outPath,
        "--repo-head",
        artifact.repoHead,
      ]);
      expect(contract.status).toBe(0);
    });
  });

  test("does not accept production screenshots without the staff evidence manifest", () => {
    withTempDir((dir) => {
      const outPath = join(dir, "staff.json");
      const evidenceDir = join(dir, "prod");
      const assigneesPath = join(dir, "assignees.json");
      writeProductionEvidence(evidenceDir);
      rmSync(join(evidenceDir, "staff-workflow-evidence-manifest.json"), { force: true });
      writeJson(assigneesPath, [{ email: "yuka@vtj.co.jp", displayName: "Yuka" }]);

      const result = runNodeScript(staffAuditPath, [
        "--out",
        outPath,
        "--prod-evidence-dir",
        evidenceDir,
        "--assignees",
        assigneesPath,
      ], productionEnv);

      expect(result.status).toBe(0);
      const artifact = JSON.parse(readFileSync(outPath, "utf8")) as {
        requirements: {
          readOnlyRolloutEvidenceReady: boolean;
          writePilotEvidenceReady: boolean;
        };
        evidence: {
          readOnlyEvidenceIssues: string[];
          writePilotEvidenceIssues: string[];
          manifest: {
            readOnlyManifestReady: boolean;
            writePilotManifestReady: boolean;
          };
        };
        gate: { staffWorkflowPermissionsReady: boolean; p1Blockers: string[] };
        repoHead: string;
      };
      expect(artifact.requirements.readOnlyRolloutEvidenceReady).toBe(false);
      expect(artifact.requirements.writePilotEvidenceReady).toBe(false);
      expect(artifact.gate.staffWorkflowPermissionsReady).toBe(false);
      expect(artifact.gate.p1Blockers).toEqual(expect.arrayContaining([
        "readonly_evidence_missing",
        "write_pilot_evidence_missing",
      ]));
      expect(artifact.evidence.readOnlyEvidenceIssues).toEqual(expect.arrayContaining([
        "staff-workflow-evidence-manifest.json",
        "manifest:missing_staff_workflow_evidence_manifest",
      ]));
      expect(artifact.evidence.writePilotEvidenceIssues).toEqual(expect.arrayContaining([
        "staff-workflow-evidence-manifest.json",
        "manifest:missing_staff_workflow_evidence_manifest",
      ]));
      expect(artifact.evidence.manifest.readOnlyManifestReady).toBe(false);
      expect(artifact.evidence.manifest.writePilotManifestReady).toBe(false);

      const contract = runNodeScript(staffContractPath, [
        "--audit",
        outPath,
        "--repo-head",
        artifact.repoHead,
      ]);
      expect(contract.status).toBe(0);
    });
  });

  test("rejects staff evidence manifest that points at unexpected meta filenames", () => {
    withTempDir((dir) => {
      const outPath = join(dir, "staff.json");
      const evidenceDir = join(dir, "prod");
      const assigneesPath = join(dir, "assignees.json");
      writeProductionEvidence(evidenceDir);
      writeFileSync(join(evidenceDir, "wrong-readonly.png"), "evidence", "utf8");
      writeJson(join(evidenceDir, "staff-workflow-evidence-manifest.json"), {
        schema: "mailhub.staff-workflow-evidence.v1",
        capturedAt: "2026-06-17T12:00:00.000Z",
        capturedBy: "admin@vtj.co.jp",
        environment: "production",
        readOnlyRollout: {
          readOnly: true,
          mailhubTopbar: "wrong-readonly.png",
          mailhubHealth: "mailhub-meta-health-readonly.png",
          verifiedStaffEmails: ["maki@vtj.co.jp"],
        },
        controlledWritePilot: {
          messageId: "msg-001",
          action: "assign",
          actorEmail: "maki@vtj.co.jp",
          mailhubWriteTopbar: "mailhub-meta-topbar-write.png",
          mailhubBackToReadOnlyTopbar: "mailhub-meta-topbar-back-to-readonly.png",
          activityCsv: "activity-20260617-prod.csv",
          gmailProof: "gmail-msg-001-assign.png",
          mailhubProof: "mailhub-msg-001-assign.png",
          returnedToReadOnly: true,
        },
      });
      writeJson(assigneesPath, [{ email: "yuka@vtj.co.jp", displayName: "Yuka" }]);

      const result = runNodeScript(staffAuditPath, [
        "--out",
        outPath,
        "--prod-evidence-dir",
        evidenceDir,
        "--assignees",
        assigneesPath,
      ], productionEnv);

      expect(result.status).toBe(0);
      const artifact = JSON.parse(readFileSync(outPath, "utf8")) as {
        requirements: { readOnlyRolloutEvidenceReady: boolean; writePilotEvidenceReady: boolean };
        evidence: { readOnlyEvidenceIssues: string[] };
        gate: { staffWorkflowPermissionsReady: boolean };
        repoHead: string;
      };
      expect(artifact.requirements.readOnlyRolloutEvidenceReady).toBe(false);
      expect(artifact.requirements.writePilotEvidenceReady).toBe(true);
      expect(artifact.gate.staffWorkflowPermissionsReady).toBe(false);
      expect(artifact.evidence.readOnlyEvidenceIssues).toContain("manifest:unexpected_readonly_mailhub_topbar:wrong-readonly.png");

      const contract = runNodeScript(staffContractPath, [
        "--audit",
        outPath,
        "--repo-head",
        artifact.repoHead,
      ]);
      expect(contract.status).toBe(0);
    });
  });
});
