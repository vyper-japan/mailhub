import { describe, expect, test, vi, beforeEach } from "vitest";
import type { AuditLogEntry } from "@/lib/audit-log";
import { generateRuleSuggestions } from "@/lib/ruleSuggestions";
import { getActivityLogs } from "@/lib/audit-log";
import { getMessageMetadataForRules } from "@/lib/gmail";

// Mock modules
vi.mock("@/lib/audit-log", async () => {
  const actual = await vi.importActual("@/lib/audit-log");
  return {
    ...actual,
    getActivityLogs: vi.fn(),
  };
});

vi.mock("@/lib/gmail", async () => {
  const actual = await vi.importActual<typeof import("@/lib/gmail")>("@/lib/gmail");
  return {
    ...actual,
    getMessageMetadataForRules: vi.fn(),
  };
});

// Create singleton mock instances
const mockLabelRulesStore = {
  getRules: vi.fn(),
};

const mockAssigneeRulesStore = {
  getRules: vi.fn(),
};

vi.mock("@/lib/labelRulesStore", () => {
  return {
    getLabelRulesStore: () => mockLabelRulesStore,
  };
});

vi.mock("@/lib/assigneeRulesStore", () => {
  return {
    getAssigneeRulesStore: () => mockAssigneeRulesStore,
  };
});

describe("ruleSuggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLabelRulesStore.getRules.mockReset();
    mockAssigneeRulesStore.getRules.mockReset();
  });

  test("should generate auto mute suggestions from mute actions", async () => {
    const logs: AuditLogEntry[] = [
      {
        timestamp: new Date().toISOString(),
        actorEmail: "user1@vtj.co.jp",
        action: "mute",
        messageId: "msg1",
      },
      {
        timestamp: new Date().toISOString(),
        actorEmail: "user2@vtj.co.jp",
        action: "mute",
        messageId: "msg2",
      },
      {
        timestamp: new Date().toISOString(),
        actorEmail: "user1@vtj.co.jp",
        action: "mute",
        messageId: "msg3",
      },
    ];

    vi.mocked(getActivityLogs).mockResolvedValue(logs);
    vi.mocked(getMessageMetadataForRules)
      .mockResolvedValueOnce({ fromEmail: "test@example.com", labelIds: [] })
      .mockResolvedValueOnce({ fromEmail: "test@example.com", labelIds: [] })
      .mockResolvedValueOnce({ fromEmail: "test@example.com", labelIds: [] });
    mockLabelRulesStore.getRules.mockResolvedValue([]);
    mockAssigneeRulesStore.getRules.mockResolvedValue([]);

    const result = await generateRuleSuggestions({ days: 14, minActions: 2, minActors: 2 });

    expect(result.suggestions.length).toBeGreaterThan(0);
    const muteSuggestion = result.suggestions.find((s) => s.type === "auto_mute");
    expect(muteSuggestion).toBeDefined();
    expect(muteSuggestion?.evidenceCount).toBeGreaterThanOrEqual(2);
    expect(muteSuggestion?.actorCount).toBeGreaterThanOrEqual(2);
  });

  test("should exclude suggestions covered by existing rules", async () => {
    const logs: AuditLogEntry[] = [
      {
        timestamp: new Date().toISOString(),
        actorEmail: "user1@vtj.co.jp",
        action: "mute",
        messageId: "msg1",
      },
    ];

    vi.mocked(getActivityLogs).mockResolvedValue(logs);
    vi.mocked(getMessageMetadataForRules).mockResolvedValue({ fromEmail: "test@example.com", labelIds: [] });
    mockLabelRulesStore.getRules.mockResolvedValue([
      {
        id: "r1",
        match: { fromEmail: "test@example.com" },
        labelName: "MailHub/Muted",
        enabled: true,
        createdAt: new Date().toISOString(),
      },
    ]);
    mockAssigneeRulesStore.getRules.mockResolvedValue([]);

    const result = await generateRuleSuggestions({ days: 14, minActions: 1, minActors: 1 });

    // 既存ルールでカバーされているため、提案は出ない
    const muteSuggestion = result.suggestions.find((s) => s.type === "auto_mute" && s.sender.fromEmail === "test@example.com");
    expect(muteSuggestion).toBeUndefined();
  });

  test("should detect dangerous domain warnings", async () => {
    const logs: AuditLogEntry[] = [
      {
        timestamp: new Date().toISOString(),
        actorEmail: "user1@vtj.co.jp",
        action: "mute",
        messageId: "msg1",
      },
      {
        timestamp: new Date().toISOString(),
        actorEmail: "user2@vtj.co.jp",
        action: "mute",
        messageId: "msg2",
      },
      {
        timestamp: new Date().toISOString(),
        actorEmail: "user1@vtj.co.jp",
        action: "mute",
        messageId: "msg3",
      },
    ];

    vi.mocked(getActivityLogs).mockResolvedValue(logs);
    vi.mocked(getMessageMetadataForRules)
      .mockResolvedValueOnce({ fromEmail: "test@gmail.com", labelIds: [] })
      .mockResolvedValueOnce({ fromEmail: "test@gmail.com", labelIds: [] })
      .mockResolvedValueOnce({ fromEmail: "test@gmail.com", labelIds: [] });
    mockLabelRulesStore.getRules.mockResolvedValue([]);
    mockAssigneeRulesStore.getRules.mockResolvedValue([]);

    const result = await generateRuleSuggestions({ days: 14, minActions: 2, minActors: 2 });

    const muteSuggestion = result.suggestions.find((s) => s.type === "auto_mute");
    expect(muteSuggestion).toBeDefined();
    expect(muteSuggestion?.warnings.some((w) => w.type === "broad_domain")).toBe(true);
  });

  test("should filter by minActions and minActors", async () => {
    const logs: AuditLogEntry[] = [
      {
        timestamp: new Date().toISOString(),
        actorEmail: "user1@vtj.co.jp",
        action: "mute",
        messageId: "msg1",
      },
    ];

    vi.mocked(getActivityLogs).mockResolvedValue(logs);
    vi.mocked(getMessageMetadataForRules).mockResolvedValue({ fromEmail: "test@example.com", labelIds: [] });
    mockLabelRulesStore.getRules.mockResolvedValue([]);
    mockAssigneeRulesStore.getRules.mockResolvedValue([]);

    // minActions=3, minActors=2 の場合、提案は出ない
    const result = await generateRuleSuggestions({ days: 14, minActions: 3, minActors: 2 });

    expect(result.suggestions.length).toBe(0);
  });

  test("should filter logs by date range", async () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 20); // 20日前

    const logs: AuditLogEntry[] = [
      {
        timestamp: oldDate.toISOString(),
        actorEmail: "user1@vtj.co.jp",
        action: "mute",
        messageId: "msg1",
      },
      {
        timestamp: new Date().toISOString(),
        actorEmail: "user2@vtj.co.jp",
        action: "mute",
        messageId: "msg2",
      },
    ];

    vi.mocked(getActivityLogs).mockResolvedValue(logs);
    vi.mocked(getMessageMetadataForRules)
      .mockResolvedValueOnce({ fromEmail: "test@example.com", labelIds: [] })
      .mockResolvedValueOnce({ fromEmail: "test@example.com", labelIds: [] });
    mockLabelRulesStore.getRules.mockResolvedValue([]);
    mockAssigneeRulesStore.getRules.mockResolvedValue([]);

    // days=14の場合、20日前のログは除外される
    const result = await generateRuleSuggestions({ days: 14, minActions: 1, minActors: 1 });

    // 20日前のログは除外されるため、提案は1件のみ（または0件）
    expect(result.suggestions.length).toBeLessThanOrEqual(1);
  });
});
