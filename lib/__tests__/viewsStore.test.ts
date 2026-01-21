import { describe, expect, test, beforeEach } from "vitest";
import { getViewsStore } from "@/lib/viewsStore";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

describe("viewsStore", () => {
  const store = getViewsStore("memory");

  beforeEach(async () => {
    await store.clear();
  });

  test("list returns defaults", async () => {
    const views = await store.list();
    expect(views.length).toBeGreaterThan(0);
    // order sorted
    for (let i = 1; i < views.length; i++) {
      expect(views[i - 1]!.order).toBeLessThanOrEqual(views[i]!.order);
    }
  });

  test("CRUD + reorder works", async () => {
    const created = await store.create({
      id: "v1",
      name: "V1",
      labelId: "todo",
      q: "older_than:1d",
      pinned: false,
      order: 10,
      assignee: null,
      statusType: null,
    });
    expect(created.id).toBe("v1");

    const updated = await store.update("v1", { pinned: true, order: 0 });
    expect(updated.pinned).toBe(true);
    expect(typeof updated.updatedAt).toBe("string");

    const list = await store.list();
    expect(list.some((v) => v.id === "v1")).toBe(true);

    const ids = list.map((v) => v.id);
    const reversed = [...ids].reverse();
    await store.reorder(reversed);
    const after = await store.list();
    expect(after.map((v) => v.id)[0]).toBe(reversed[0]);

    await store.delete("v1");
    expect(await store.get("v1")).toBeNull();
  });

  test("create: duplicate id throws", async () => {
    await store.create({
      id: "dup",
      name: "DUP",
      labelId: "todo",
      pinned: false,
      order: 1,
      assignee: null,
      statusType: null,
    });
    await expect(
      store.create({
        id: "dup",
        name: "DUP2",
        labelId: "todo",
        pinned: false,
        order: 2,
        assignee: null,
        statusType: null,
      }),
    ).rejects.toThrow(/already_exists/i);
  });

  test("update/delete: not found throws", async () => {
    await expect(store.update("nope", { name: "x" })).rejects.toThrow(/not_found/i);
    await expect(store.delete("nope")).rejects.toThrow(/not_found/i);
  });

  test("reorder: unknown ids are ignored, remaining views are appended", async () => {
    const cur = await store.list();
    const firstTwo = cur.slice(0, 2).map((v) => v.id);
    await store.reorder(["unknown", ...firstTwo]);
    const after = await store.list();
    expect(after[0]!.id).toBe(firstTwo[0]); // unknown is ignored
    expect(after[1]!.id).toBe(firstTwo[1]);
    // some other view still exists
    expect(after.length).toBe(cur.length);
  });
});

describe("viewsStore (file parse/validation)", () => {
  const storeFile = getViewsStore("file");
  const path = join(process.cwd(), ".mailhub", "views.json");

  beforeEach(async () => {
    await mkdir(join(process.cwd(), ".mailhub"), { recursive: true });
    await writeFile(path, "", "utf-8");
  });

  test("empty file returns defaults", async () => {
    const list = await storeFile.list();
    expect(list.length).toBeGreaterThan(0);
  });

  test("non-array json returns defaults", async () => {
    await writeFile(path, JSON.stringify({ hello: "world" }), "utf-8");
    const list = await storeFile.list();
    expect(list.length).toBeGreaterThan(0);
  });

  test("parseViews normalizes fields and filters invalid rows", async () => {
    const raw = JSON.stringify([
      { id: "ok", name: "OK", icon: "📧", labelId: "todo", q: "older_than:1d", assignee: "mine", statusType: "todo", pinned: true, order: 1, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "bad-assignee", name: "BAD", labelId: "todo", assignee: "someone", pinned: false, order: 2, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "bad-status", name: "BAD2", labelId: "todo", statusType: "done", pinned: false, order: 3, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "", name: "NOID", labelId: "todo", pinned: false, order: 4, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "noname", name: "", labelId: "todo", pinned: false, order: 5, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "defaults", name: "DEFAULTS", pinned: true }, // labelId/order defaults path
    ]);
    await writeFile(path, raw, "utf-8");
    const list = await storeFile.list();
    const ok = list.find((v) => v.id === "ok");
    expect(ok?.assignee).toBe("mine");
    expect(ok?.statusType).toBe("todo");
    const badAssignee = list.find((v) => v.id === "bad-assignee");
    expect(badAssignee?.assignee).toBeNull();
    const badStatus = list.find((v) => v.id === "bad-status");
    expect(badStatus?.statusType).toBeNull();
    expect(list.some((v) => v.id === "")).toBe(false);
    expect(list.some((v) => v.id === "noname")).toBe(false);
    const defaults = list.find((v) => v.id === "defaults");
    expect(defaults?.labelId).toBe("all");
    expect(typeof defaults?.order).toBe("number");
  });

  test("corrupt json throws", async () => {
    await writeFile(path, "{bad", "utf-8");
    await expect(storeFile.list()).rejects.toThrow(/config_json_corrupt_views/i);
  });
});

