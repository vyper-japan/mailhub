import { describe, expect, test } from "vitest";
import { extractFromDomain, extractFromEmail, matchRules, normalizeFromEmail } from "@/lib/labelRules";

describe("labelRules", () => {
  test("extractFromEmail: 日本語名 + <email> から抽出できる（楽天想定）", () => {
    expect(extractFromEmail('"楽天市場" <info@rakuten.co.jp>')).toBe("info@rakuten.co.jp");
  });

  test("extractFromEmail: 角括弧なし（生email）でも抽出できる", () => {
    expect(extractFromEmail("info@rakuten.co.jp")).toBe("info@rakuten.co.jp");
  });

  test("extractFromEmail: encoded name (=?:?=) + <email> から抽出できる", () => {
    expect(extractFromEmail("=?UTF-8?B?44OG44K544OI?= <support@rakuten.co.jp>")).toBe("support@rakuten.co.jp");
  });

  test("extractFromEmail: Name <email> から抽出できる", () => {
    expect(extractFromEmail('Foo Bar <Foo.Bar+test@Example.COM>')).toBe("foo.bar+test@example.com");
  });

  test("extractFromEmail: 生email文字列から抽出できる", () => {
    expect(extractFromEmail("a@example.com")).toBe("a@example.com");
  });

  test("extractFromEmail: emailが無い場合はnull", () => {
    expect(extractFromEmail("no-email-here")).toBe(null);
    expect(extractFromEmail("   ")).toBe(null);
    expect(extractFromEmail(null)).toBe(null);
  });

  test("normalizeFromEmail / extractFromDomain: 正規化とドメイン抽出", () => {
    expect(normalizeFromEmail(" A@Example.COM ")).toBe("a@example.com");
    expect(normalizeFromEmail("not-an-email")).toBe(null);
    expect(normalizeFromEmail(null)).toBe(null);
    expect(normalizeFromEmail("   ")).toBe(null);
    expect(extractFromDomain("a@example.com")).toBe("example.com");
    expect(extractFromDomain("a@")).toBe(null);
  });

  test("matchRules: fromEmail完全一致", () => {
    const labels = matchRules("a@example.com", [
      {
        id: "r1",
        match: { fromEmail: "a@example.com" },
        labelName: "VIP",
        enabled: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: "r2",
        match: { fromEmail: "b@example.com" },
        labelName: "Other",
        enabled: true,
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(labels).toEqual(["VIP"]);
  });

  test("matchRules: fromDomain一致", () => {
    const labels = matchRules("a@example.com", [
      {
        id: "r1",
        match: { fromDomain: "example.com" },
        labelName: "Domain",
        enabled: true,
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(labels).toEqual(["Domain"]);
  });

  test("matchRules: disabledは無視、重複はユニーク化", () => {
    const labels = matchRules("a@example.com", [
      {
        id: "r1",
        match: { fromDomain: "example.com" },
        labelName: "X",
        enabled: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: "r2",
        match: { fromDomain: "example.com" },
        labelName: "X",
        enabled: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: "r3",
        match: { fromEmail: "a@example.com" },
        labelName: "X",
        enabled: true,
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(labels).toEqual(["X"]);
  });

  test("matchRules: invalid/emptyは[]", () => {
    expect(matchRules("not-an-email", [])).toEqual([]);
    expect(matchRules("a@", [
      {
        id: "r1",
        match: { fromDomain: "example.com" },
        labelName: "Domain",
        enabled: true,
        createdAt: new Date().toISOString(),
      },
    ])).toEqual([]);
  });
});


