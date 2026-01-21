import { describe, expect, test, beforeEach } from "vitest";
import { getReplyTemplatesStore } from "@/lib/replyTemplatesStore";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

describe("replyTemplatesStore", () => {
  const store = getReplyTemplatesStore("memory");

  beforeEach(async () => {
    await store.clear();
  });

  test("list returns defaults", async () => {
    const templates = await store.list();
    expect(Array.isArray(templates)).toBe(true);
    expect(templates.length).toBeGreaterThan(0);
  });

  test("CRUD works", async () => {
    const created = await store.create({ id: "t1", title: "T", body: "B" }, "admin@example.com");
    expect(created.id).toBe("t1");

    const got = await store.get("t1");
    expect(got?.title).toBe("T");

    const updated = await store.update("t1", { body: "B2" }, "admin2@example.com");
    expect(updated.body).toBe("B2");
    expect(updated.updatedBy).toBe("admin2@example.com");

    await store.delete("t1");
    const after = await store.get("t1");
    expect(after).toBeNull();
  });

  test("too long throws", async () => {
    const long = "a".repeat(10001);
    await expect(store.create({ id: "tlong", title: "T", body: long }, "admin@example.com")).rejects.toThrow(/too_long/i);
  });

  test("html body throws", async () => {
    await expect(
      store.create({ id: "thtml", title: "T", body: "hello <b>world</b>" }, "admin@example.com"),
    ).rejects.toThrow(/html_not_allowed/i);
  });
});

describe("replyTemplatesStore (file parse/validation)", () => {
  const storeFile = getReplyTemplatesStore("file");
  const path = join(process.cwd(), ".mailhub", "replyTemplates.json");

  beforeEach(async () => {
    await mkdir(join(process.cwd(), ".mailhub"), { recursive: true });
    await writeFile(path, "", "utf-8");
  });

  test("empty file returns defaults", async () => {
    const list = await storeFile.list();
    expect(list.length).toBeGreaterThan(0);
  });

  test("parseTemplates filters invalid entries", async () => {
    const raw = JSON.stringify([
      { id: "ok", title: "OK", body: "BODY", updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "user@example.com" },
      { id: "", title: "NG", body: "x" },
      { id: "ng2", title: "", body: "x" },
      { id: "ng3", title: "x", body: "" },
    ]);
    await writeFile(path, raw, "utf-8");
    const list = await storeFile.list();
    expect(list.some((t) => t.id === "ok")).toBe(true);
    expect(list.some((t) => t.id === "ng2")).toBe(false);
  });

  test("corrupt json throws (not swallowed)", async () => {
    await writeFile(path, "[bad", "utf-8");
    await expect(storeFile.list()).rejects.toThrow(/config_json_corrupt_templates/i);
  });
});

