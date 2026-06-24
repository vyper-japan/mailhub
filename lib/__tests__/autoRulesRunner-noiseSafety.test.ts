import { beforeEach, describe, expect, it, vi } from "vitest";

const runnerMocks = vi.hoisted(() => ({
  getRules: vi.fn(),
  listRegisteredLabels: vi.fn(),
  listLatestInboxMessages: vi.fn(),
  getMessageMetadataForRules: vi.fn(),
  applyLabelsToMessages: vi.fn(),
  ensureLabelId: vi.fn(),
  getTestUserLabelNames: vi.fn(),
  isTestMode: vi.fn(),
}));

vi.mock("@/lib/labelRulesStore", () => ({
  getLabelRulesStore: () => ({
    getRules: runnerMocks.getRules,
  }),
}));

vi.mock("@/lib/labelRegistryStore", () => ({
  getLabelRegistryStore: () => ({
    list: runnerMocks.listRegisteredLabels,
  }),
}));

vi.mock("@/lib/gmail", () => ({
  listLatestInboxMessages: runnerMocks.listLatestInboxMessages,
  getMessageMetadataForRules: runnerMocks.getMessageMetadataForRules,
  applyLabelsToMessages: runnerMocks.applyLabelsToMessages,
  ensureLabelId: runnerMocks.ensureLabelId,
  getTestUserLabelNames: runnerMocks.getTestUserLabelNames,
}));

vi.mock("@/lib/test-mode", () => ({
  isTestMode: runnerMocks.isTestMode,
}));

async function importRunner() {
  vi.resetModules();
  return await import("@/lib/autoRulesRunner");
}

function message(overrides: Record<string, unknown>) {
  return {
    id: "m1",
    threadId: "t1",
    subject: "Weekly newsletter",
    from: "no-reply@example.com",
    messageId: "msg1",
    receivedAt: new Date().toISOString(),
    snippet: "unsubscribe here",
    gmailLink: "",
    assigneeSlug: null,
    ...overrides,
  };
}

describe("autoRulesRunner noise safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runnerMocks.getRules.mockResolvedValue([
      {
        id: "mute-partner",
        match: { fromEmail: "partner@example.com" },
        labelNames: ["MailHub/Label/Muted"],
        enabled: true,
        createdAt: new Date().toISOString(),
      },
    ]);
    runnerMocks.listRegisteredLabels.mockResolvedValue([{ labelName: "MailHub/Label/Muted" }]);
    runnerMocks.getMessageMetadataForRules.mockResolvedValue({ fromEmail: "partner@example.com", labelIds: [] });
    runnerMocks.ensureLabelId.mockResolvedValue("Label_Muted");
    runnerMocks.applyLabelsToMessages.mockResolvedValue({ applied: ["m1"], failed: [] });
    runnerMocks.getTestUserLabelNames.mockReturnValue([]);
    runnerMocks.isTestMode.mockReturnValue(false);
  });

  it("does not dry-run suppressive rules for unknown non-noise messages", async () => {
    runnerMocks.listLatestInboxMessages.mockResolvedValue({
      messages: [message({ id: "m-other", subject: "ご確認ください", from: "partner@example.com", snippet: "明日の件です" })],
      nextPageToken: undefined,
    });
    const { runAutoRules } = await importRunner();

    const result = await runAutoRules({ dryRun: true, maxTotal: 10, maxPerRule: 10 });

    expect(result).toMatchObject({
      totalCandidates: 1,
      totalApplied: 0,
      totalSkipped: 1,
      totalFailed: 0,
    });
    expect(runnerMocks.applyLabelsToMessages).not.toHaveBeenCalled();
  });

  it("dry-runs suppressive rules for explicit newsletter noise", async () => {
    runnerMocks.listLatestInboxMessages.mockResolvedValue({
      messages: [message({ id: "m-noise" })],
      nextPageToken: undefined,
    });
    const { runAutoRules } = await importRunner();

    const result = await runAutoRules({ dryRun: true, maxTotal: 10, maxPerRule: 10 });

    expect(result).toMatchObject({
      totalCandidates: 1,
      totalApplied: 1,
      totalSkipped: 0,
      totalFailed: 0,
    });
  });

  it("fails closed when list data says attachments exist but names are unavailable", async () => {
    runnerMocks.listLatestInboxMessages.mockResolvedValue({
      messages: [message({ id: "m-attachment", attachmentCount: 1 })],
      nextPageToken: undefined,
    });
    const { runAutoRules } = await importRunner();

    const result = await runAutoRules({ dryRun: true, maxTotal: 10, maxPerRule: 10 });

    expect(result).toMatchObject({
      totalCandidates: 1,
      totalApplied: 0,
      totalSkipped: 1,
      totalFailed: 0,
    });
  });
});
