import { describe, expect, test } from "vitest";
import { DEFAULT_VIEWS, buildViewQuery, type View } from "@/lib/views";

describe("views", () => {
  test("DEFAULT_VIEWS has stable operational ordering", () => {
    const ids = DEFAULT_VIEWS.map((v) => v.id);
    expect(ids).toEqual([
      "inbox",
      "unassigned",
      "mine",
      "waiting",
      "invoice-docs",
      "customer-inquiries",
      "noise-candidates",
      "muted",
      "overdue",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DEFAULT_VIEWS.map((v) => v.order)).toEqual(ids.map((_, index) => index));
  });

  test("DEFAULT_VIEWS includes operational category queries", () => {
    expect(DEFAULT_VIEWS.find((v) => v.id === "invoice-docs")).toMatchObject({
      name: "請求/書類",
      labelId: "todo",
      q: "has:attachment (invoice OR receipt OR statement OR 請求書 OR 領収書 OR 見積書 OR 納品書 OR 支払明細)",
      pinned: true,
    });
    expect(DEFAULT_VIEWS.find((v) => v.id === "customer-inquiries")).toMatchObject({
      name: "問い合わせ",
      labelId: "todo",
      q: "(問い合わせ OR お問い合わせ OR \"返信がありました\" OR \"お客様から\" OR inquiry OR question OR 質問 OR 相談 OR from:ichiba-inquiry@rakuten.co.jp OR from:shopping-proorder-master@mail.yahoo.co.jp)",
      pinned: true,
    });
    expect(DEFAULT_VIEWS.find((v) => v.id === "noise-candidates")).toMatchObject({
      name: "処理不要候補",
      labelId: "todo",
      q: "(from:no-reply OR from:noreply OR unsubscribe OR newsletter OR メルマガ OR 配信停止 OR 広告 OR セール) -問い合わせ -お問い合わせ -至急 -重要",
      pinned: true,
    });
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
