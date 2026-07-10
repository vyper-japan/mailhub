import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GmailClient, Target } from "../mailhub-archive-backfill";

type MockOverrides = {
  modify?: (args: { userId: string; id: string; requestBody: { addLabelIds?: string[]; removeLabelIds?: string[] } }) => Promise<unknown>;
  labelsList?: (args: { userId: string }) => Promise<{ data: { labels?: Array<{ id?: string | null; name?: string | null }> | null } }>;
  labelsCreate?: (args: { userId: string; requestBody: { name: string; labelListVisibility: string; messageListVisibility: string } }) => Promise<{ data: { id?: string | null } }>;
  getProfile?: (args: { userId: string }) => Promise<{ data: { emailAddress?: string | null } }>;
};

function createMockGmail(overrides: MockOverrides = {}): GmailClient {
  return {
    users: {
      messages: { modify: overrides.modify ?? (async () => ({})) },
      labels: {
        list: overrides.labelsList ?? (async () => ({ data: { labels: [] } })),
        create: overrides.labelsCreate ?? (async () => ({ data: { id: "created-id" } })),
      },
      getProfile: overrides.getProfile ?? (async () => ({ data: { emailAddress: "inbox@vtj.co.jp" } })),
    },
  };
}

async function loadModule() {
  vi.resetModules();
  return import("../mailhub-archive-backfill");
}

function readProgressEntries(baseDir: string): Array<Record<string, unknown>> {
  const dir = join(baseDir, ".ai-runs", "mailhub-archive-backfill");
  const files = readdirSync(dir).filter((f) => f.startsWith("apply-progress-") && f.endsWith(".jsonl"));
  return files.flatMap((f) =>
    readFileSync(join(dir, f), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  );
}

describe("mailhub-archive-backfill", () => {
  let cwdDir: string;

  beforeEach(() => {
    cwdDir = mkdtempSync(join(tmpdir(), "mailhub-archive-backfill-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(cwdDir);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    rmSync(cwdDir, { recursive: true, force: true });
  });

  it("P1-1: retries once on 429 then succeeds", async () => {
    vi.useFakeTimers();
    const mod = await loadModule();
    let calls = 0;
    const gmail = createMockGmail({
      modify: async () => {
        calls += 1;
        if (calls === 1) {
          const err = Object.assign(new Error("Rate Limit Exceeded"), { code: 429 });
          throw err;
        }
        return {};
      },
    });
    const targets: Target[] = [{ id: "m1", labels: [] }];
    const promise = mod.applyTargets(gmail, "me", targets, true);
    await vi.advanceTimersByTimeAsync(5000);
    await promise;
    expect(calls).toBe(2);
    const entries = readProgressEntries(cwdDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].succeeded).toEqual(["m1"]);
    expect(entries[0].failed).toEqual([]);
  });

  it("P1-1: non-429 failure is recorded once and does not block remaining items in the batch", async () => {
    const mod = await loadModule();
    const gmail = createMockGmail({
      modify: async (args) => {
        if (args.id === "m2") {
          const err = Object.assign(new Error("Internal Error"), { code: 500 });
          throw err;
        }
        return {};
      },
    });
    const targets: Target[] = [{ id: "m1", labels: [] }, { id: "m2", labels: [] }, { id: "m3", labels: [] }];
    await mod.applyTargets(gmail, "me", targets, true);
    const entries = readProgressEntries(cwdDir);
    expect(entries).toHaveLength(1);
    expect((entries[0].succeeded as string[]).sort()).toEqual(["m1", "m3"]);
    expect(entries[0].failed).toEqual([{ id: "m2", status: 500, reason: "Internal Error", retryAttempt: 0 }]);
  });

  it("P1-1: progress entries follow the documented jsonl schema", async () => {
    const mod = await loadModule();
    const gmail = createMockGmail();
    const targets: Target[] = [{ id: "m1", labels: [] }, { id: "m2", labels: [] }];
    await mod.applyTargets(gmail, "me", targets, false);
    const entries = readProgressEntries(cwdDir);
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(typeof entry.ts).toBe("string");
    expect(new Date(entry.ts as string).toString()).not.toBe("Invalid Date");
    expect(entry.batchIndex).toBe(0);
    expect(entry.mode).toBe("label");
    expect(entry.attempted).toBe(2);
    expect((entry.succeeded as string[]).sort()).toEqual(["m1", "m2"]);
    expect(entry.failed).toEqual([]);
    expect(typeof entry.elapsedMs).toBe("number");
  });

  it("P2-3: maskEmail masks the local part per the documented cases", async () => {
    const mod = await loadModule();
    expect(mod.maskEmail("mailhub@vyper.jp")).toBe("mai***@vyper.jp");
    expect(mod.maskEmail("ab@vyper.jp")).toBe("***@vyper.jp");
    expect(mod.maskEmail("not-an-email")).toBe("***");
  });

  it("P2-5: 409 conflict on labels.create resolves via labels.list refetch", async () => {
    const mod = await loadModule();
    let listCalls = 0;
    const gmail = createMockGmail({
      labelsList: async () => {
        listCalls += 1;
        return listCalls === 1 ? { data: { labels: [] } } : { data: { labels: [{ id: "label-1", name: "MailHub/Archived" }] } };
      },
      labelsCreate: async () => {
        throw Object.assign(new Error("conflict"), { code: 409 });
      },
    });
    const ids = await mod.ensureLabelIds(gmail, "me", ["MailHub/Archived"]);
    expect(ids).toEqual(["label-1"]);
    expect(listCalls).toBe(2);
  });

  it("P2-5: 409 conflict with label missing from refetch throws a fatal error", async () => {
    const mod = await loadModule();
    const gmail = createMockGmail({
      labelsList: async () => ({ data: { labels: [] } }),
      labelsCreate: async () => {
        throw Object.assign(new Error("conflict"), { code: 409 });
      },
    });
    await expect(mod.ensureLabelIds(gmail, "me", ["MailHub/Archived"])).rejects.toThrow(
      "label_conflict_but_not_found:MailHub/Archived",
    );
  });
});
