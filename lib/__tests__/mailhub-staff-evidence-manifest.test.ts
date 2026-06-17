import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawnSync } from "child_process";
import { describe, expect, test } from "vitest";

const manifestWriterPath = resolve(process.cwd(), "scripts/write-mailhub-staff-evidence-manifest.mjs");

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "mailhub-staff-manifest-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runManifestWriter(args: string[]) {
  return spawnSync(process.execPath, [manifestWriterPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

describe("MailHub staff evidence manifest writer", () => {
  test("writes the exact production staff workflow manifest shape", () => {
    withTempDir((dir) => {
      const outPath = join(dir, "staff-workflow-evidence-manifest.json");
      const result = runManifestWriter([
        "--out",
        outPath,
        "--captured-at",
        "2026-06-17T12:00:00.000Z",
        "--captured-by",
        "Admin@vtj.co.jp",
        "--staff-email",
        "Maki@vtj.co.jp",
        "--actor-email",
        "Ops@vtj.co.jp",
        "--message-id",
        "msg-001",
        "--action",
        "assign",
        "--date",
        "20260617",
      ]);

      expect(result.status).toBe(0);
      const summary = JSON.parse(result.stdout) as {
        ok: boolean;
        requiredFiles: string[];
      };
      expect(summary.ok).toBe(true);
      expect(summary.requiredFiles).toEqual([
        "mailhub-meta-topbar-readonly.png",
        "mailhub-meta-health-readonly.png",
        "mailhub-meta-topbar-write.png",
        "mailhub-meta-topbar-back-to-readonly.png",
        "activity-20260617-prod.csv",
        "gmail-msg-001-assign.png",
        "mailhub-msg-001-assign.png",
      ]);

      const manifest = JSON.parse(readFileSync(outPath, "utf8")) as {
        schema: string;
        capturedBy: string;
        readOnlyRollout: { verifiedStaffEmails: string[] };
        controlledWritePilot: {
          actorEmail: string;
          messageId: string;
          action: string;
          gmailProof: string;
          returnedToReadOnly: boolean;
        };
      };
      expect(manifest.schema).toBe("mailhub.staff-workflow-evidence.v1");
      expect(manifest.capturedBy).toBe("admin@vtj.co.jp");
      expect(manifest.readOnlyRollout.verifiedStaffEmails).toEqual(["maki@vtj.co.jp"]);
      expect(manifest.controlledWritePilot).toMatchObject({
        actorEmail: "ops@vtj.co.jp",
        messageId: "msg-001",
        action: "assign",
        gmailProof: "gmail-msg-001-assign.png",
        returnedToReadOnly: true,
      });
    });
  });

  test("writes proof filenames that include the requested message id and action", () => {
    withTempDir((dir) => {
      const outPath = join(dir, "staff-workflow-evidence-manifest.json");
      const result = runManifestWriter([
        "--out",
        outPath,
        "--captured-at",
        "2026-06-17T12:00:00.000Z",
        "--captured-by",
        "Admin@vtj.co.jp",
        "--staff-email",
        "Maki@vtj.co.jp",
        "--actor-email",
        "Ops@vtj.co.jp",
        "--message-id",
        "msg-002",
        "--action",
        "setWaiting",
        "--date",
        "20260618",
      ]);

      expect(result.status).toBe(0);
      const manifest = JSON.parse(readFileSync(outPath, "utf8")) as {
        controlledWritePilot: {
          messageId: string;
          action: string;
          gmailProof: string;
          mailhubProof: string;
          activityCsv: string;
        };
      };
      expect(manifest.controlledWritePilot).toMatchObject({
        messageId: "msg-002",
        action: "setWaiting",
        gmailProof: "gmail-msg-002-setWaiting.png",
        mailhubProof: "mailhub-msg-002-setWaiting.png",
        activityCsv: "activity-20260618-prod.csv",
      });
    });
  });

  test("rejects invalid production manifest inputs", () => {
    withTempDir((dir) => {
      const result = runManifestWriter([
        "--out",
        join(dir, "manifest.json"),
        "--captured-by",
        "outside@example.com",
        "--staff-email",
        "staff@vtj.co.jp",
        "--actor-email",
        "ops@vtj.co.jp",
        "--message-id",
        "msg-001",
        "--action",
        "done",
        "--date",
        "2026-06-17",
      ]);

      expect(result.status).toBe(1);
      const summary = JSON.parse(result.stderr) as { ok: boolean; errors: string[] };
      expect(summary.ok).toBe(false);
      expect(summary.errors).toEqual(expect.arrayContaining([
        "invalid_captured_by",
        "invalid_action:done",
        "invalid_date",
      ]));
    });
  });
});
