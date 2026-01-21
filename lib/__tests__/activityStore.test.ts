import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { appendFile, unlink } from "fs/promises";
import type { AuditLogEntry, AuditAction } from "@/lib/audit-log";

function makeEntry(i: number): AuditLogEntry {
  return {
    timestamp: new Date(1700000000000 + i * 1000).toISOString(),
    actorEmail: i % 2 === 0 ? "a@vtj.co.jp" : "b@vtj.co.jp",
    action: (i % 2 === 0 ? "assign" : "unassign") as AuditAction,
    messageId: `msg-${i}`,
    label: i % 3 === 0 ? "MailHub/Todo" : undefined,
    metadata: { i },
  };
}

describe("activityStore", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("MemoryStore: append/list/clear + ring buffer limit", async () => {
    const mod = await import("@/lib/activityStore");
    const store = new mod.MemoryStore();
    await store.clear();

    // 200件上限（リングバッファ）を超えて投入
    for (let i = 0; i < 205; i++) {
      await store.append(makeEntry(i));
    }

    const all = await store.list();
    expect(all.length).toBe(200);
    // 新しい順で返る
    expect(all[0]?.messageId).toBe("msg-204");

    const onlyA = await store.list({ actorEmail: "a@vtj.co.jp" });
    expect(onlyA.every((x) => x.actorEmail === "a@vtj.co.jp")).toBe(true);

    const onlyAssign = await store.list({ action: "assign" });
    expect(onlyAssign.every((x) => x.action === "assign")).toBe(true);

    const limited = await store.list({ limit: 3 });
    expect(limited.length).toBe(3);

    await store.clear();
    expect((await store.list()).length).toBe(0);
  });

  it("FileStore: append/list/clear + invalid JSON line is ignored", async () => {
    const mod = await import("@/lib/activityStore");
    const store = new mod.FileStore();
    await store.clear();

    await store.append(makeEntry(1));
    await store.append(makeEntry(2));

    // 破損行を混ぜても落ちないこと
    await appendFile(".mailhub/activity.jsonl", "{not-json}\n");

    const logs = await store.list();
    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(logs[0]?.messageId).toBe("msg-2"); // 新しい順

    const filtered = await store.list({ actorEmail: "a@vtj.co.jp" });
    expect(filtered.every((x) => x.actorEmail === "a@vtj.co.jp")).toBe(true);

    const filteredByAction = await store.list({ action: "assign" });
    expect(filteredByAction.every((x) => x.action === "assign")).toBe(true);

    await store.clear();
    expect((await store.list()).length).toBe(0);
  });

  it("FileStore: list returns [] when file does not exist", async () => {
    const mod = await import("@/lib/activityStore");
    const store = new mod.FileStore();
    // ファイルが無い状態を作る（存在しても消す）
    await unlink(".mailhub/activity.jsonl").catch(() => {});
    const logs = await store.list();
    expect(logs).toEqual([]);
  });

  it("getResolvedActivityStoreType: sheets requested but incomplete config falls back to memory", async () => {
    const mod = await import("@/lib/activityStore");
    process.env.MAILHUB_ACTIVITY_STORE = "sheets";
    delete process.env.MAILHUB_SHEETS_SPREADSHEET_ID;
    delete process.env.MAILHUB_SHEETS_CLIENT_EMAIL;
    delete process.env.MAILHUB_SHEETS_PRIVATE_KEY;

    expect(mod.getResolvedActivityStoreType()).toBe("memory");
    expect(mod.getActivitySheetsConfigured()).toBe(false);
  });

  it("getResolvedActivityStoreType: sheets requested and configured resolves to sheets", async () => {
    const mod = await import("@/lib/activityStore");
    process.env.MAILHUB_ACTIVITY_STORE = "sheets";
    process.env.MAILHUB_SHEETS_SPREADSHEET_ID = "spreadsheet";
    process.env.MAILHUB_SHEETS_CLIENT_EMAIL = "client@example.com";
    process.env.MAILHUB_SHEETS_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nX\\n-----END PRIVATE KEY-----";

    expect(mod.getRequestedActivityStoreType()).toBe("sheets");
    expect(mod.getResolvedActivityStoreType()).toBe("sheets");
    expect(mod.getActivitySheetsConfigured()).toBe(true);
  });

  it("getRequestedActivityStoreType trims whitespace", async () => {
    const mod = await import("@/lib/activityStore");
    process.env.MAILHUB_ACTIVITY_STORE = "  file  ";
    expect(mod.getRequestedActivityStoreType()).toBe("file");
  });

  it("getActivityStore: file -> FileStore + cached instance", async () => {
    vi.resetModules();
    process.env.MAILHUB_ACTIVITY_STORE = "file";
    const mod = await import("@/lib/activityStore");
    const s1 = mod.getActivityStore();
    const s2 = mod.getActivityStore();
    expect(s1).toBeInstanceOf(mod.FileStore);
    expect(s1).toBe(s2); // cache hit
  });

  it("getActivityStore: sheets configured -> SheetsStore", async () => {
    vi.resetModules();
    process.env.MAILHUB_ACTIVITY_STORE = "sheets";
    process.env.MAILHUB_SHEETS_SPREADSHEET_ID = "spreadsheet";
    process.env.MAILHUB_SHEETS_CLIENT_EMAIL = "client@example.com";
    process.env.MAILHUB_SHEETS_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nX\\n-----END PRIVATE KEY-----";
    process.env.MAILHUB_SHEETS_SHEET_NAME = "Activity";

    const mod = await import("@/lib/activityStore");
    const store = mod.getActivityStore();
    expect(store).toBeInstanceOf(mod.SheetsStore);
  });

  it("getActivityStore: default -> MemoryStore", async () => {
    vi.resetModules();
    delete process.env.MAILHUB_ACTIVITY_STORE;
    const mod = await import("@/lib/activityStore");
    const store = mod.getActivityStore();
    expect(store).toBeInstanceOf(mod.MemoryStore);
  });

  it("getActivityStore: sheets requested but incomplete config -> warns + MemoryStore", async () => {
    vi.resetModules();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    process.env.MAILHUB_ACTIVITY_STORE = "sheets";
    delete process.env.MAILHUB_SHEETS_SPREADSHEET_ID;
    delete process.env.MAILHUB_SHEETS_CLIENT_EMAIL;
    delete process.env.MAILHUB_SHEETS_PRIVATE_KEY;

    const mod = await import("@/lib/activityStore");
    const store = mod.getActivityStore();
    expect(store).toBeInstanceOf(mod.MemoryStore);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("SheetsStore: append/list swallow errors (best-effort)", async () => {
    const mod = await import("@/lib/activityStore");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = new mod.SheetsStore("spreadsheet", "client@example.com", "key", "Activity");

    // private method を潰して必ず失敗させる（catch分岐を通す）
    (store as unknown as { getSheetsClient: () => Promise<unknown> }).getSheetsClient = async () => {
      throw new Error("boom");
    };

    await expect(store.append(makeEntry(1))).resolves.toBeUndefined();
    await expect(store.list()).resolves.toEqual([]);
    expect(errSpy).toHaveBeenCalled();
  });

  it("SheetsStore: list parses rows and filters (happy path via mocked client)", async () => {
    const mod = await import("@/lib/activityStore");
    const store = new mod.SheetsStore("spreadsheet", "client@example.com", "key", "Activity");

    const fakeSheets = {
      spreadsheets: {
        values: {
          get: vi.fn().mockResolvedValue({
            data: {
              values: [
                // header
                ["timeISO", "actor", "action", "messageId", "label", "metaJSON"],
                // valid row
                ["2026-01-01T00:00:00.000Z", "a@vtj.co.jp", "assign", "msg-1", "MailHub/Todo", "{\"x\":1}"],
                // invalid action -> skipped
                ["2026-01-01T00:00:01.000Z", "a@vtj.co.jp", "not-an-action", "msg-2", "", "{}"],
                // short row -> skipped
                ["too", "short"],
              ],
            },
          }),
          append: vi.fn().mockResolvedValue({}),
          update: vi.fn().mockResolvedValue({}),
        },
      },
    };

    (store as unknown as { getSheetsClient: () => Promise<unknown> }).getSheetsClient = async () => fakeSheets;

    const logs = await store.list({ actorEmail: "a@vtj.co.jp", action: "assign", limit: 10 });
    expect(logs.length).toBe(1);
    expect(logs[0]?.messageId).toBe("msg-1");
    expect(logs[0]?.metadata).toEqual({ x: 1 });
  });

  it("SheetsStore: append initializes header when empty (happy path via mocked client)", async () => {
    const mod = await import("@/lib/activityStore");
    const store = new mod.SheetsStore("spreadsheet", "client@example.com", "key", "Activity");

    const get = vi.fn().mockResolvedValue({ data: { values: [] } });
    const update = vi.fn().mockResolvedValue({});
    const append = vi.fn().mockResolvedValue({});

    const fakeSheets = {
      spreadsheets: {
        values: { get, update, append },
      },
    };
    (store as unknown as { getSheetsClient: () => Promise<unknown> }).getSheetsClient = async () => fakeSheets;

    await store.append(makeEntry(10));
    expect(get).toHaveBeenCalled();
    expect(update).toHaveBeenCalled(); // header init attempted
    expect(append).toHaveBeenCalled();
  });
});

