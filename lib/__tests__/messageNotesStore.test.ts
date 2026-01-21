import { describe, expect, test, beforeEach } from "vitest";
import { getMessageNotesStore } from "@/lib/messageNotesStore";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

describe("messageNotesStore", () => {
  const store = getMessageNotesStore("memory");

  beforeEach(async () => {
    await store.clear();
  });

  test("set/get: trims and stores metadata", async () => {
    await store.set("msg-001", "  hello  ", "user@example.com");
    const note = await store.get("msg-001");
    expect(note).toBeTruthy();
    expect(note?.body).toBe("hello");
    expect(note?.updatedBy).toBe("user@example.com");
    expect(typeof note?.updatedAt).toBe("string");
  });

  test("empty body deletes", async () => {
    await store.set("msg-001", "x", "user@example.com");
    await store.set("msg-001", "   ", "user@example.com");
    const note = await store.get("msg-001");
    expect(note).toBeNull();
  });

  test("too long throws", async () => {
    const long = "a".repeat(4001);
    await expect(store.set("msg-001", long, "user@example.com")).rejects.toThrow(/too_long/i);
  });
});

describe("messageNotesStore (file parse/validation)", () => {
  const storeFile = getMessageNotesStore("file");
  const notesPath = join(process.cwd(), ".mailhub", "messageNotes.json");

  beforeEach(async () => {
    await mkdir(join(process.cwd(), ".mailhub"), { recursive: true });
    await writeFile(notesPath, "{}", "utf-8");
  });

  test("parseNotes filters invalid entries and trims body", async () => {
    const raw = JSON.stringify({
      "msg-001": { body: "  hello  ", updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "user@example.com" },
      "msg-002": { body: "", updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "user@example.com" }, // empty -> dropped
      "msg-003": { body: "x", updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "" }, // updatedBy missing -> dropped
    });
    await writeFile(notesPath, raw, "utf-8");

    const all = await storeFile.list();
    expect(Object.keys(all)).toEqual(["msg-001"]);
    expect(all["msg-001"]?.body).toBe("hello");
  });

  test("corrupt json returns empty (silent recovery)", async () => {
    await writeFile(notesPath, "{bad json", "utf-8");
    const all = await storeFile.list();
    expect(all).toEqual({});
  });
});

