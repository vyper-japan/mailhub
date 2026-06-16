import { describe, expect, test, vi, beforeEach } from "vitest";
import type { LabelRule } from "@/lib/labelRules";
import type { AssigneeRule } from "@/lib/assigneeRules";
import type { InboxListMessage } from "@/lib/mailhub-types";
import { inspectRules, explainRulesForMessage } from "@/lib/ruleInspector";
import { listLatestInboxMessages } from "@/lib/gmail";

// Mock gmail module
vi.mock("@/lib/gmail", () => ({
  listLatestInboxMessages: vi.fn(),
}));

function makeMessages(total: number, matching: number, domain: string = "example.com"): InboxListMessage[] {
  return Array.from({ length: total }, (_, i) => {
    const isMatch = i < matching;
    return {
      id: `msg${i + 1}`,
      threadId: `thread${i + 1}`,
      from: isMatch ? `sender${i + 1}@${domain}` : `sender${i + 1}@other.test`,
      subject: `Test ${i + 1}`,
      messageId: `msg${i + 1}`,
      receivedAt: new Date().toISOString(),
      snippet: "",
      gmailLink: "",
      assigneeSlug: null,
    };
  });
}

describe("ruleInspector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("inspectRules - conflicts", () => {
    test("should detect label rule conflicts (same fromEmail, different labels)", async () => {
      const labelRules: LabelRule[] = [
        {
          id: "r1",
          match: { fromEmail: "test@example.com" },
          labelName: "VIP",
          enabled: true,
          createdAt: new Date().toISOString(),
        },
        {
          id: "r2",
          match: { fromEmail: "test@example.com" },
          labelName: "Important",
          enabled: true,
          createdAt: new Date().toISOString(),
        },
      ];

      vi.mocked(listLatestInboxMessages).mockResolvedValue({ messages: [], nextPageToken: undefined });

      const result = await inspectRules(labelRules, [], 50);

      expect(result.conflicts.length).toBeGreaterThan(0);
      expect(result.conflicts[0].type).toBe("label_label");
      expect(result.conflicts[0].ruleIds).toContain("r1");
      expect(result.conflicts[0].ruleIds).toContain("r2");
    });

    test("should detect assignee rule conflicts (same priority, same condition, different assignee)", async () => {
      const assigneeRules: AssigneeRule[] = [
        {
          id: "ar1",
          match: { fromEmail: "test@example.com" },
          assigneeEmail: "user1@vtj.co.jp",
          priority: 0,
          enabled: true,
          when: { unassignedOnly: true },
          safety: { dangerousDomainConfirm: false },
          createdAt: new Date().toISOString(),
        },
        {
          id: "ar2",
          match: { fromEmail: "test@example.com" },
          assigneeEmail: "user2@vtj.co.jp",
          priority: 0,
          enabled: true,
          when: { unassignedOnly: true },
          safety: { dangerousDomainConfirm: false },
          createdAt: new Date().toISOString(),
        },
      ];

      vi.mocked(listLatestInboxMessages).mockResolvedValue({ messages: [], nextPageToken: undefined });

      const result = await inspectRules([], assigneeRules, 50);

      expect(result.conflicts.length).toBeGreaterThan(0);
      expect(result.conflicts[0].type).toBe("assignee_assignee");
      expect(result.conflicts[0].ruleIds).toContain("ar1");
      expect(result.conflicts[0].ruleIds).toContain("ar2");
    });

    test("should not detect conflicts if results are the same", async () => {
      const labelRules: LabelRule[] = [
        {
          id: "r1",
          match: { fromEmail: "test@example.com" },
          labelName: "VIP",
          enabled: true,
          createdAt: new Date().toISOString(),
        },
        {
          id: "r2",
          match: { fromEmail: "test@example.com" },
          labelName: "VIP",
          enabled: true,
          createdAt: new Date().toISOString(),
        },
      ];

      vi.mocked(listLatestInboxMessages).mockResolvedValue({ messages: [], nextPageToken: undefined });

      const result = await inspectRules(labelRules, [], 50);

      expect(result.conflicts.length).toBe(0);
    });
  });

  describe("inspectRules - dangerous rules", () => {
    test("should detect dangerous rules with broad domain", async () => {
      const labelRules: LabelRule[] = [
        {
          id: "r1",
          match: { fromDomain: "gmail.com" },
          labelName: "Broad",
          enabled: true,
          createdAt: new Date().toISOString(),
        },
      ];

      vi.mocked(listLatestInboxMessages).mockResolvedValue({ messages: [], nextPageToken: undefined });

      const result = await inspectRules(labelRules, [], 50);

      expect(result.dangerous.length).toBeGreaterThan(0);
      expect(result.dangerous[0].ruleId).toBe("r1");
      expect(result.dangerous[0].reason).toBe("broad_domain");
    });

    test("should detect dangerous assignee rules with broad domain", async () => {
      const assigneeRules: AssigneeRule[] = [
        {
          id: "ar1",
          match: { fromDomain: "gmail.com" },
          assigneeEmail: "user@vtj.co.jp",
          priority: 0,
          enabled: true,
          when: { unassignedOnly: true },
          safety: { dangerousDomainConfirm: true },
          createdAt: new Date().toISOString(),
        },
      ];

      vi.mocked(listLatestInboxMessages).mockResolvedValue({ messages: [], nextPageToken: undefined });

      const result = await inspectRules([], assigneeRules, 50);

      expect(result.dangerous.length).toBeGreaterThan(0);
      expect(result.dangerous[0].ruleId).toBe("ar1");
      expect(result.dangerous[0].reason).toBe("broad_domain");
    });

    test("should detect label rules that match most of the inspected sample", async () => {
      const labelRules: LabelRule[] = [
        {
          id: "r1",
          match: { fromDomain: "example.com" },
          labelName: "Broad",
          enabled: true,
          createdAt: new Date().toISOString(),
        },
      ];

      vi.mocked(listLatestInboxMessages).mockResolvedValue({
        messages: makeMessages(50, 40),
        nextPageToken: undefined,
      });

      const result = await inspectRules(labelRules, [], 50);

      expect(result.dangerous).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: "r1",
            ruleType: "label",
            reason: "too_many_matches",
            previewCount: 40,
          }),
        ]),
      );
    });

    test("should not flag label rules below the broad-match ratio threshold", async () => {
      const labelRules: LabelRule[] = [
        {
          id: "r1",
          match: { fromDomain: "example.com" },
          labelName: "Focused",
          enabled: true,
          createdAt: new Date().toISOString(),
        },
      ];

      vi.mocked(listLatestInboxMessages).mockResolvedValue({
        messages: makeMessages(50, 39),
        nextPageToken: undefined,
      });

      const result = await inspectRules(labelRules, [], 50);

      expect(result.dangerous.find((rule) => rule.ruleId === "r1" && rule.reason === "too_many_matches")).toBeUndefined();
    });

    test("should detect assignee rules that match most of the inspected unassigned sample", async () => {
      const assigneeRules: AssigneeRule[] = [
        {
          id: "ar1",
          match: { fromDomain: "example.com" },
          assigneeEmail: "user@vtj.co.jp",
          priority: 0,
          enabled: true,
          when: { unassignedOnly: true },
          safety: { dangerousDomainConfirm: false },
          createdAt: new Date().toISOString(),
        },
      ];

      vi.mocked(listLatestInboxMessages).mockResolvedValue({
        messages: makeMessages(50, 40),
        nextPageToken: undefined,
      });

      const result = await inspectRules([], assigneeRules, 50);

      expect(result.dangerous).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: "ar1",
            ruleType: "assignee",
            reason: "too_many_matches",
            previewCount: 40,
          }),
        ]),
      );
    });
  });

  describe("inspectRules - inactive rules", () => {
    test("should detect inactive rules (enabled but no hits)", async () => {
      const labelRules: LabelRule[] = [
        {
          id: "r1",
          match: { fromEmail: "never@example.com" },
          labelName: "Never",
          enabled: true,
          createdAt: new Date().toISOString(),
        },
      ];

      // Mock sample messages that don't match
      vi.mocked(listLatestInboxMessages).mockResolvedValue({
        messages: [
          {
            id: "msg1",
            threadId: "thread1",
            from: "other@example.com",
            subject: "Test",
            messageId: "msg1",
            receivedAt: new Date().toISOString(),
            snippet: "",
            gmailLink: "",
            assigneeSlug: null,
          },
        ],
        nextPageToken: undefined,
      });

      const result = await inspectRules(labelRules, [], 50);

      expect(result.inactive.length).toBeGreaterThan(0);
      expect(result.inactive[0].ruleId).toBe("r1");
    });
  });

  describe("inspectRules - hit stats", () => {
    test("should calculate hit stats for matching rules", async () => {
      const labelRules: LabelRule[] = [
        {
          id: "r1",
          match: { fromEmail: "test@example.com" },
          labelName: "VIP",
          enabled: true,
          createdAt: new Date().toISOString(),
        },
      ];

      vi.mocked(listLatestInboxMessages).mockResolvedValue({
        messages: [
          {
            id: "msg1",
            threadId: "thread1",
            from: "test@example.com",
            subject: "Test 1",
            messageId: "msg1",
            receivedAt: new Date().toISOString(),
            snippet: "",
            gmailLink: "",
            assigneeSlug: null,
          },
          {
            id: "msg2",
            threadId: "thread2",
            from: "test@example.com",
            subject: "Test 2",
            messageId: "msg2",
            receivedAt: new Date().toISOString(),
            snippet: "",
            gmailLink: "",
            assigneeSlug: null,
          },
        ],
        nextPageToken: undefined,
      });

      const result = await inspectRules(labelRules, [], 50);

      expect(result.hitStats.length).toBeGreaterThan(0);
      const stat = result.hitStats.find((s) => s.ruleId === "r1");
      expect(stat).toBeDefined();
      expect(stat?.hitCount).toBe(2);
      expect(stat?.sampleMessages.length).toBeGreaterThan(0);
    });
  });

  describe("explainRulesForMessage", () => {
    test("should explain matching label rules", async () => {
      const labelRules: LabelRule[] = [
        {
          id: "r1",
          match: { fromEmail: "test@example.com" },
          labelName: "VIP",
          enabled: true,
          createdAt: new Date().toISOString(),
        },
      ];

      const result = await explainRulesForMessage("msg1", "test@example.com", labelRules, []);

      expect(result.messageId).toBe("msg1");
      expect(result.fromEmail).toBe("test@example.com");
      expect(result.labelRules.length).toBeGreaterThan(0);
      const matchingRule = result.labelRules.find((r) => r.ruleId === "r1");
      expect(matchingRule).toBeDefined();
      expect(matchingRule?.matchReason).toBe("fromEmail");
      expect(matchingRule?.result).toContain("VIP");
    });

    test("should explain matching assignee rules", async () => {
      const assigneeRules: AssigneeRule[] = [
        {
          id: "ar1",
          match: { fromEmail: "test@example.com" },
          assigneeEmail: "user@vtj.co.jp",
          priority: 0,
          enabled: true,
          when: { unassignedOnly: true },
          safety: { dangerousDomainConfirm: false },
          createdAt: new Date().toISOString(),
        },
      ];

      const result = await explainRulesForMessage("msg1", "test@example.com", [], assigneeRules);

      expect(result.assigneeRules.length).toBeGreaterThan(0);
      const matchingRule = result.assigneeRules.find((r) => r.ruleId === "ar1");
      expect(matchingRule).toBeDefined();
      expect(matchingRule?.matchReason).toBe("fromEmail");
      expect(matchingRule?.result).toBe("user@vtj.co.jp");
    });

    test("should return no_match for non-matching rules", async () => {
      const labelRules: LabelRule[] = [
        {
          id: "r1",
          match: { fromEmail: "other@example.com" },
          labelName: "VIP",
          enabled: true,
          createdAt: new Date().toISOString(),
        },
      ];

      const result = await explainRulesForMessage("msg1", "test@example.com", labelRules, []);

      const rule = result.labelRules.find((r) => r.ruleId === "r1");
      expect(rule).toBeDefined();
      expect(rule?.matchReason).toBe("no_match");
      expect(rule?.result).toEqual([]);
    });

    test("should handle null fromEmail", async () => {
      const result = await explainRulesForMessage("msg1", null, [], []);

      expect(result.fromEmail).toBe(null);
      expect(result.labelRules.length).toBe(0);
      expect(result.assigneeRules.length).toBe(0);
    });
  });
});
