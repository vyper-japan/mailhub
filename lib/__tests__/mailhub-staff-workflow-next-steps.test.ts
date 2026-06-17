import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawnSync } from "child_process";
import { describe, expect, test } from "vitest";

const staffNextPath = resolve(process.cwd(), "scripts/write-mailhub-staff-workflow-next-steps.mjs");
const staffNextContractPath = resolve(process.cwd(), "scripts/check-mailhub-staff-next-contract.mjs");

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "mailhub-staff-next-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runStaffNext(args: string[]) {
  return spawnSync(process.execPath, [staffNextPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function runStaffNextContract(args: string[]) {
  return spawnSync(process.execPath, [staffNextContractPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function blockedAudit() {
  return {
    generatedAt: "2026-06-17T00:00:00.000Z",
    repoHead: "HEAD",
    environment: {
      mailhubEnv: "local",
      readOnly: false,
    },
    config: {
      configStore: "file",
      activityStore: "memory",
      missingProductionEnv: ["NEXTAUTH_URL", "GOOGLE_CLIENT_ID"],
    },
    staff: {
      adminCount: 0,
      teamMemberCount: 0,
      assigneeRegistry: { validCount: 1 },
    },
    evidence: {
      readonlyMissing: ["mailhub-meta-topbar-readonly.png"],
      writeMissing: ["mailhub-meta-topbar-write.png"],
      activityCsvCount: 0,
      gmailProofCount: 0,
      mailhubProofCount: 0,
    },
    requirements: {
      productionEnvReady: false,
      adminsReady: false,
      staffAccessAllowlistReady: false,
      assigneeRosterReady: true,
      durableConfigReady: false,
      durableActivityReady: false,
      readOnlyRolloutEvidenceReady: false,
      writePilotEvidenceReady: false,
      readOnlyRolloutReady: false,
      controlledWritePilotReady: false,
      staffWorkflowPermissionsReady: false,
    },
    gate: {
      readOnlyRolloutReady: false,
      controlledWritePilotReady: false,
      staffWorkflowPermissionsReady: false,
      p1Blockers: ["not_production_env", "staff_access_allowlist_not_ready"],
    },
  };
}

function readyAudit() {
  return {
    generatedAt: "2026-06-17T00:00:00.000Z",
    repoHead: "HEAD",
    environment: {
      mailhubEnv: "production",
      readOnly: true,
    },
    config: {
      configStore: "sheets",
      activityStore: "sheets",
      missingProductionEnv: [],
    },
    staff: {
      adminCount: 1,
      teamMemberCount: 1,
      assigneeRegistry: { validCount: 1 },
    },
    evidence: {
      readonlyMissing: [],
      writeMissing: [],
      activityCsvCount: 1,
      gmailProofCount: 1,
      mailhubProofCount: 1,
    },
    requirements: {
      productionEnvReady: true,
      adminsReady: true,
      staffAccessAllowlistReady: true,
      assigneeRosterReady: true,
      durableConfigReady: true,
      durableActivityReady: true,
      readOnlyRolloutEvidenceReady: true,
      writePilotEvidenceReady: true,
      readOnlyRolloutReady: true,
      controlledWritePilotReady: true,
      staffWorkflowPermissionsReady: true,
    },
    gate: {
      readOnlyRolloutReady: true,
      controlledWritePilotReady: true,
      staffWorkflowPermissionsReady: true,
      p0Blockers: [],
      p1Blockers: [],
    },
  };
}

describe("MailHub staff workflow next steps", () => {
  test("turns an incomplete staff audit into concrete non-secret next actions", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "staff-audit.json");
      const outPath = join(dir, "staff-next.json");
      writeJson(auditPath, blockedAudit());

      const result = runStaffNext(["--audit", auditPath, "--out", outPath]);

      expect(result.status).toBe(0);
      const out = JSON.parse(readFileSync(outPath, "utf8")) as {
        state: Record<string, boolean>;
        missing: Record<string, string[]>;
        nextActions: Array<{ id: string; status: string; requiredEnv?: string[]; requiredEvidence?: string[] }>;
      };
      expect(out.state.staffWorkflowPermissionsReady).toBe(false);
      expect(out.state.canCaptureReadOnlyRolloutEvidence).toBe(false);
      expect(out.missing.productionEnv).toEqual(["NEXTAUTH_URL", "GOOGLE_CLIENT_ID"]);
      expect(out.missing.staffAdmins).toEqual(["MAILHUB_ADMINS"]);
      expect(out.missing.staffTeamMembers).toEqual(["MAILHUB_TEAM_MEMBERS"]);
      expect(out.missing.readOnlyEvidence).toEqual(["mailhub-meta-topbar-readonly.png"]);
      expect(out.missing.writePilotEvidence).toEqual([
        "mailhub-meta-topbar-write.png",
        "activity-YYYYMMDD-prod.csv",
        "gmail-*-*.png",
        "mailhub-*-*.png",
      ]);
      expect(out.nextActions.find((action) => action.id === "capture_readonly_rollout_evidence")?.status).toBe("blocked");
      expect(JSON.stringify(out)).not.toContain("refresh_token");
      expect(JSON.stringify(out)).not.toContain("PRIVATE KEY");

      const contract = runStaffNextContract([
        "--next",
        outPath,
        "--audit",
        auditPath,
        "--repo-head",
        "HEAD",
        "--repo-parent-head",
        "HEAD^",
      ]);
      expect(contract.status).toBe(0);
    });
  });

  test("marks every staff next action done when the audit is ready", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "staff-audit.json");
      const outPath = join(dir, "staff-next.json");
      writeJson(auditPath, readyAudit());

      const result = runStaffNext(["--audit", auditPath, "--out", outPath, "--strict"]);

      expect(result.status).toBe(0);
      const out = JSON.parse(readFileSync(outPath, "utf8")) as {
        state: Record<string, boolean>;
        missing: Record<string, string[]>;
        nextActions: Array<{ status: string }>;
      };
      expect(out.state.staffWorkflowPermissionsReady).toBe(true);
      expect(out.state.canCaptureReadOnlyRolloutEvidence).toBe(true);
      expect(out.state.canCaptureControlledWritePilotEvidence).toBe(true);
      expect(Object.values(out.missing).flat()).toEqual([]);
      expect(out.nextActions.every((action) => action.status === "done")).toBe(true);
    });
  });

  test("strict mode rejects a missing staff audit artifact", () => {
    withTempDir((dir) => {
      const result = runStaffNext(["--audit", join(dir, "missing.json"), "--out", join(dir, "out.json"), "--strict"]);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("missing_staff_workflow_audit");
    });
  });

  test("contract rejects contradictory next-action status", () => {
    withTempDir((dir) => {
      const auditPath = join(dir, "staff-audit.json");
      const outPath = join(dir, "staff-next.json");
      writeJson(auditPath, blockedAudit());
      expect(runStaffNext(["--audit", auditPath, "--out", outPath]).status).toBe(0);

      const artifact = JSON.parse(readFileSync(outPath, "utf8")) as {
        nextActions: Array<{ id: string; status: string }>;
      };
      const action = artifact.nextActions.find((item) => item.id === "capture_readonly_rollout_evidence");
      expect(action).toBeTruthy();
      action!.status = "done";
      writeJson(outPath, artifact);

      const contract = runStaffNextContract([
        "--next",
        outPath,
        "--audit",
        auditPath,
        "--repo-head",
        "HEAD",
        "--repo-parent-head",
        "HEAD^",
      ]);
      expect(contract.status).toBe(1);
      expect(contract.stdout).toContain("next_action_status_mismatch:capture_readonly_rollout_evidence");
    });
  });
});
