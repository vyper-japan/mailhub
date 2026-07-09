import { describe, expect, test } from "vitest";
import {
  extractFromDomain,
  extractFromEmail,
  matchRules,
  matchRulesWithAssign,
  normalizeAssignToSpec,
  normalizeFromEmail,
} from "@/lib/labelRules";
import type { LabelRule } from "@/lib/labelRules";

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

  test("normalizeAssignToSpec keeps only me or vtj assignees", () => {
    expect(normalizeAssignToSpec("me")).toBe("me");
    expect(normalizeAssignToSpec({ assigneeEmail: " Owner@VTJ.CO.JP " })).toEqual({
      assigneeEmail: "owner@vtj.co.jp",
    });
    expect(normalizeAssignToSpec({ assigneeEmail: "owner@example.com" })).toBeUndefined();
    expect(normalizeAssignToSpec(null)).toBeUndefined();
  });

  test("matchRulesWithAssign returns the first matching assignTo", () => {
    const result = matchRulesWithAssign("a@example.com", [
      {
        id: "r1",
        match: { fromDomain: "example.com" },
        labelName: "Domain",
        assignTo: { assigneeEmail: "owner@vtj.co.jp" },
        enabled: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: "r2",
        match: { fromEmail: "a@example.com" },
        labelName: "Exact",
        assignTo: "me",
        enabled: true,
        createdAt: new Date().toISOString(),
      },
    ]);

    expect(result).toMatchObject({
      labels: ["Domain", "Exact"],
      assignTo: { assigneeEmail: "owner@vtj.co.jp" },
      action: "label",
      matchedRuleId: "r1",
    });
  });

  const baseRule = (overrides: Partial<LabelRule>): LabelRule => ({
    id: overrides.id ?? "rule",
    match: overrides.match ?? { fromEmail: "sender@example.com" },
    labelNames: overrides.labelNames ?? ["Hit"],
    action: overrides.action,
    enabled: overrides.enabled ?? true,
    createdAt: "2026-07-09T00:00:00.000Z",
  });

  const subjectActionCases: Array<[string, LabelRule[], string | null, string[], "label" | "archive" | null, string | null]> = [
    ["subjectContains matches case-insensitively", [baseRule({ id: "c", match: { fromEmail: "sender@example.com", subjectContains: ["invoice"] } })], "INVOICE ready", ["Hit"], "label", "c"],
    ["subjectContains rejects when absent", [baseRule({ match: { fromEmail: "sender@example.com", subjectContains: ["キャンセル"] } })], "通常通知", [], null, null],
    ["subjectNotContains passes when absent", [baseRule({ id: "a", action: "archive", labelNames: [], match: { fromEmail: "sender@example.com", subjectNotContains: ["キャンセル"] } })], "通常通知", [], "archive", "a"],
    ["subjectNotContains rejects when present", [baseRule({ action: "archive", labelNames: [], match: { fromEmail: "sender@example.com", subjectNotContains: ["キャンセル"] } })], "キャンセル通知", [], null, null],
    ["contains and notContains both pass", [baseRule({ id: "both", match: { fromEmail: "sender@example.com", subjectContains: ["請求書"], subjectNotContains: ["広告"] } })], "7月 請求書", ["Hit"], "label", "both"],
    ["contains and notContains are AND", [baseRule({ match: { fromEmail: "sender@example.com", subjectContains: ["請求書"], subjectNotContains: ["広告"] } })], "広告 請求書", [], null, null],
    ["no subject condition ignores null subject", [baseRule({ id: "plain", action: "archive", labelNames: [] })], null, [], "archive", "plain"],
    ["undefined action defaults to label", [baseRule({ id: "default" })], "anything", ["Hit"], "label", "default"],
    ["from mismatch blocks subject match", [baseRule({ match: { fromEmail: "other@example.com", subjectContains: ["請求書"] } })], "請求書", [], null, null],
    ["fromDomain and subject match together", [baseRule({ id: "domain", match: { fromDomain: "example.com", subjectContains: ["ship"] } })], "SHIP notice", ["Hit"], "label", "domain"],
  ];

  test.each(subjectActionCases)("%s", (_name, rules, subject, labels, action, matchedRuleId) => {
    const result = matchRulesWithAssign("sender@example.com", rules, subject);
    expect(result.labels).toEqual(labels);
    expect(result.action).toBe(action);
    expect(result.matchedRuleId).toBe(matchedRuleId);
  });
});
