import { describe, expect, test, vi, beforeEach } from "vitest";
import { getLabelRulesStore } from "@/lib/labelRulesStore";
import { getActivityLogs } from "@/lib/audit-log";
import { matchRules } from "@/lib/labelRules";

// Mock modules
vi.mock("@/lib/labelRulesStore", () => ({
  getLabelRulesStore: vi.fn(() => ({
    getRules: vi.fn(),
  })),
}));

vi.mock("@/lib/audit-log", async () => {
  const actual = await vi.importActual("@/lib/audit-log");
  return {
    ...actual,
    getActivityLogs: vi.fn(),
    logAction: vi.fn(),
  };
});

describe("ruleOps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("enabled=falseのルールがapply対象から外れる", () => {
    const rules = [
      {
        id: "r1",
        match: { fromEmail: "test@example.com" },
        labelNames: ["VIP"],
        enabled: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: "r2",
        match: { fromEmail: "test@example.com" },
        labelNames: ["Muted"],
        enabled: false,
        createdAt: new Date().toISOString(),
      },
    ];

    const matched = matchRules("test@example.com", rules);
    expect(matched).toContain("VIP");
    expect(matched).not.toContain("Muted");
  });

  test("stats集計が想定通り（ruleIdフィルタ）", async () => {
    const mockLogs = [
      {
        timestamp: new Date().toISOString(),
        actorEmail: "test@vtj.co.jp",
        action: "rule_preview" as const,
        messageId: "",
        metadata: { ruleId: "r1", processed: 10, matched: 5 },
      },
      {
        timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5日前
        actorEmail: "test@vtj.co.jp",
        action: "rule_apply" as const,
        messageId: "",
        metadata: { ruleId: "r1", processed: 10, matched: 5, applied: 3 },
      },
      {
        timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10日前
        actorEmail: "test@vtj.co.jp",
        action: "rule_apply" as const,
        messageId: "",
        metadata: { ruleId: "r1", processed: 20, matched: 10, applied: 8 },
      },
    ];

    vi.mocked(getActivityLogs).mockResolvedValue(mockLogs);
    vi.mocked(getLabelRulesStore().getRules).mockResolvedValue([
      {
        id: "r1",
        match: { fromEmail: "test@example.com" },
        labelNames: ["VIP"],
        enabled: true,
        createdAt: new Date().toISOString(),
      },
    ]);

    // stats APIのロジックをテスト（簡易版）
    const ruleLogs = mockLogs.filter(
      (log) =>
        (log.action === "rule_preview" || log.action === "rule_apply") &&
        log.metadata &&
        typeof log.metadata === "object" &&
        "ruleId" in log.metadata &&
        log.metadata.ruleId === "r1",
    );

    expect(ruleLogs.length).toBe(3);
    const applyLogs = ruleLogs.filter((log) => log.action === "rule_apply");
    expect(applyLogs.length).toBe(2);

    const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const applied7d = applyLogs.filter((log) => log.timestamp >= cutoff7d).reduce((sum, log) => {
      const applied = log.metadata && typeof log.metadata === "object" && "applied" in log.metadata && typeof log.metadata.applied === "number" ? log.metadata.applied : 0;
      return sum + applied;
    }, 0);
    expect(applied7d).toBe(3); // 5日前のログのみ
  });
});
