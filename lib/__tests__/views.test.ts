import { describe, expect, test } from "vitest";
import { DEFAULT_VIEWS, buildViewQuery, type View } from "@/lib/views";

describe("views", () => {
  test("DEFAULT_VIEWS has basic entries", () => {
    expect(DEFAULT_VIEWS.length).toBeGreaterThan(0);
    expect(DEFAULT_VIEWS.some((v) => v.id === "inbox")).toBe(true);
    expect(DEFAULT_VIEWS.some((v) => v.id === "mine")).toBe(true);
  });

  test("buildViewQuery returns normalized fields", () => {
    const v: View = {
      id: "x",
      name: "X",
      labelId: "todo",
      q: "older_than:1d",
      assignee: "mine",
      statusType: null,
      pinned: false,
      order: 1,
      createdAt: new Date().toISOString(),
    };
    const q = buildViewQuery(v);
    expect(q.q).toBe("older_than:1d");
    expect(q.assignee).toBe("mine");
    expect(q.statusType).toBeNull();
  });

  test("buildViewQuery fills nulls", () => {
    const v: View = {
      id: "x",
      name: "X",
      labelId: "todo",
      pinned: false,
      order: 1,
      createdAt: new Date().toISOString(),
      assignee: undefined,
      statusType: undefined,
    };
    const q = buildViewQuery(v);
    expect(q.assignee).toBeNull();
    expect(q.statusType).toBeNull();
  });
});

