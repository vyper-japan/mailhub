import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getRules: vi.fn(),
  listRegisteredLabels: vi.fn(),
  listLatestInboxMessages: vi.fn(),
  getMessageDetail: vi.fn(),
  getMessageMetadataForRules: vi.fn(),
  ensureLabelId: vi.fn(),
  applyLabelsToMessages: vi.fn(),
  archiveMessagesForRules: vi.fn(),
  assignMessage: vi.fn(),
  applyTestActionDelay: vi.fn(),
  getTestUserLabelNames: vi.fn(),
  getTestAssigneeMap: vi.fn(),
  isTestMode: vi.fn(),
  isReadOnlyMode: vi.fn(),
  isAdminEmail: vi.fn(),
  logAction: vi.fn(),
}));

vi.mock("@/lib/require-user", () => ({
  requireUser: routeMocks.requireUser,
  authErrorResponse: (result: { status: number; message: string }) =>
    Response.json({ error: "unauthorized", message: result.message }, { status: result.status }),
}));

vi.mock("@/lib/labelRulesStore", () => ({
  getLabelRulesStore: () => ({
    getRules: routeMocks.getRules,
  }),
}));

vi.mock("@/lib/labelRegistryStore", () => ({
  getLabelRegistryStore: () => ({
    list: routeMocks.listRegisteredLabels,
  }),
}));

vi.mock("@/lib/gmail", () => ({
  listLatestInboxMessages: routeMocks.listLatestInboxMessages,
  getMessageDetail: routeMocks.getMessageDetail,
  getMessageMetadataForRules: routeMocks.getMessageMetadataForRules,
  ensureLabelId: routeMocks.ensureLabelId,
  applyLabelsToMessages: routeMocks.applyLabelsToMessages,
  archiveMessagesForRules: routeMocks.archiveMessagesForRules,
  assignMessage: routeMocks.assignMessage,
  applyTestActionDelay: routeMocks.applyTestActionDelay,
  getTestUserLabelNames: routeMocks.getTestUserLabelNames,
  getTestAssigneeMap: routeMocks.getTestAssigneeMap,
}));

vi.mock("@/lib/test-mode", () => ({
  isTestMode: routeMocks.isTestMode,
}));

vi.mock("@/lib/read-only", () => ({
  isReadOnlyMode: routeMocks.isReadOnlyMode,
  writeForbiddenResponse: (action: string) => Response.json({ error: "read_only", action }, { status: 403 }),
}));

vi.mock("@/lib/admin", () => ({
  isAdminEmail: routeMocks.isAdminEmail,
}));

vi.mock("@/lib/audit-log", () => ({
  logAction: routeMocks.logAction,
}));

async function importPost() {
  vi.resetModules();
  const mod = await import("@/app/api/mailhub/rules/apply/route");
  return mod.POST;
}

function post(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/mailhub/rules/apply", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function detail(overrides: Record<string, unknown>) {
  return {
    id: "m1",
    threadId: "t1",
    subject: "Weekly newsletter",
    from: "no-reply@example.com",
    messageId: "msg1",
    receivedAt: new Date().toISOString(),
    snippet: "unsubscribe here",
    gmailLink: "",
    plainTextBody: null,
    htmlBody: null,
    bodySource: null,
    bodyNotice: null,
    attachments: [],
    assigneeSlug: null,
    to: null,
    cc: null,
    bcc: null,
    replyTo: null,
    deliveredTo: [],
    xOriginalTo: null,
    references: null,
    inReplyTo: null,
    listId: null,
    listPost: null,
    ...overrides,
  };
}

describe("mailhub rules apply route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeMocks.requireUser.mockResolvedValue({
      ok: true,
      user: { email: "admin@vtj.co.jp", name: "Admin" },
    });
    routeMocks.getRules.mockResolvedValue([
      {
        id: "mute-billing",
        match: { fromDomain: "example.com" },
        labelNames: ["MailHub/Muted"],
        enabled: true,
        createdAt: new Date().toISOString(),
      },
    ]);
    routeMocks.listRegisteredLabels.mockResolvedValue([{ labelName: "MailHub/Muted" }]);
    routeMocks.listLatestInboxMessages.mockResolvedValue({
      messages: [
        {
          id: "m1",
          threadId: "t1",
          subject: "6月分 請求書",
          from: "no-reply@example.com",
          messageId: "msg1",
          receivedAt: new Date().toISOString(),
          snippet: "添付をご確認ください",
          gmailLink: "",
          assigneeSlug: null,
        },
      ],
      nextPageToken: undefined,
    });
    routeMocks.getMessageDetail.mockImplementation((id: string) => Promise.resolve(detail({ id })));
    routeMocks.getMessageMetadataForRules.mockResolvedValue({ fromEmail: "billing@example.com", labelIds: [] });
    routeMocks.ensureLabelId.mockResolvedValue("Label_Muted");
    routeMocks.applyLabelsToMessages.mockResolvedValue({ applied: ["m1"], failed: [] });
    routeMocks.archiveMessagesForRules.mockResolvedValue({ successIds: ["m1"], failed: [] });
    routeMocks.applyTestActionDelay.mockResolvedValue(undefined);
    routeMocks.getTestUserLabelNames.mockReturnValue([]);
    routeMocks.getTestAssigneeMap.mockReturnValue(new Map());
    routeMocks.isTestMode.mockReturnValue(false);
    routeMocks.isReadOnlyMode.mockReturnValue(false);
    routeMocks.isAdminEmail.mockReturnValue(true);
  });

  it("requires admin for rule previews and apply", async () => {
    routeMocks.isAdminEmail.mockReturnValue(false);
    const POST = await importPost();

    const res = await POST(post({ dryRun: true, ruleId: "mute-billing", max: 10 }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_admin_only" });
    expect(routeMocks.getRules).not.toHaveBeenCalled();
    expect(routeMocks.applyLabelsToMessages).not.toHaveBeenCalled();
  });

  it("protects invoice messages from suppressive label rules in dry-run", async () => {
    routeMocks.getMessageMetadataForRules.mockResolvedValueOnce({ fromEmail: "no-reply@example.com", labelIds: [] });
    const POST = await importPost();

    const res = await POST(post({ dryRun: true, ruleId: "mute-billing", max: 10 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.preview).toMatchObject({
      matchedCount: 0,
      protectedCount: 1,
      protectedSamples: [
        {
          id: "m1",
          classification: {
            purpose: "invoice",
            suppressible: false,
            blockedReasons: ["protected_invoice"],
          },
        },
      ],
    });
    expect(json.skippedDetails).toContainEqual(
      expect.objectContaining({
        id: "m1",
        reason: "protected_classification",
      }),
    );
    expect(routeMocks.applyLabelsToMessages).not.toHaveBeenCalled();
  });

  it("allows suppressive label rules for newsletter-like noise", async () => {
    routeMocks.listLatestInboxMessages.mockReset();
    routeMocks.listLatestInboxMessages.mockResolvedValueOnce({
      messages: [
        {
          id: "m2",
          threadId: "t2",
          subject: "Weekly newsletter",
          from: "no-reply@example.com",
          messageId: "msg2",
          receivedAt: new Date().toISOString(),
          snippet: "unsubscribe here",
          gmailLink: "",
          assigneeSlug: null,
        },
      ],
      nextPageToken: undefined,
    });
    routeMocks.getMessageMetadataForRules.mockReset();
    routeMocks.getMessageMetadataForRules.mockResolvedValueOnce({ fromEmail: "no-reply@example.com", labelIds: [] });
    const POST = await importPost();

    const res = await POST(post({ dryRun: true, ruleId: "mute-billing", max: 10 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.preview).toMatchObject({
      matchedCount: 1,
      protectedCount: 0,
      samples: [
        {
          id: "m2",
          classification: {
            purpose: "noise",
            suppressible: true,
          },
        },
      ],
    });
  });

  it("does not apply suppressive label rules to unknown non-noise messages", async () => {
    routeMocks.listLatestInboxMessages.mockReset();
    routeMocks.listLatestInboxMessages.mockResolvedValueOnce({
      messages: [
        {
          id: "m-other",
          threadId: "t-other",
          subject: "ご確認ください",
          from: "partner@example.com",
          messageId: "msg-other",
          receivedAt: new Date().toISOString(),
          snippet: "明日の件です",
          gmailLink: "",
          assigneeSlug: null,
        },
      ],
      nextPageToken: undefined,
    });
    routeMocks.getMessageMetadataForRules.mockReset();
    routeMocks.getMessageMetadataForRules.mockResolvedValueOnce({ fromEmail: "partner@example.com", labelIds: [] });
    const POST = await importPost();

    const res = await POST(post({ dryRun: true, ruleId: "mute-billing", max: 10 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.preview).toMatchObject({
      matchedCount: 0,
      protectedCount: 0,
    });
    expect(json.skippedDetails).toContainEqual(
      expect.objectContaining({
        id: "m-other",
        reason: "not_noise_classification",
        classification: expect.objectContaining({
          purpose: "other",
          suppressible: false,
        }),
      }),
    );
    expect(routeMocks.applyLabelsToMessages).not.toHaveBeenCalled();
  });

  it("uses client-provided summaries to protect explicit messageIds", async () => {
    routeMocks.listLatestInboxMessages.mockReset();
    routeMocks.getMessageDetail.mockResolvedValueOnce(detail({
      id: "m-explicit",
      subject: "請求書を送付します",
      from: "no-reply@example.com",
      snippet: "添付をご確認ください",
    }));
    routeMocks.getMessageMetadataForRules.mockReset();
    routeMocks.getMessageMetadataForRules.mockResolvedValueOnce({ fromEmail: "no-reply@example.com", labelIds: [] });
    const POST = await importPost();

    const res = await POST(
      post({
        dryRun: true,
        ruleId: "mute-billing",
        messageIds: ["m-explicit"],
        messageSummaries: [
          {
            id: "m-explicit",
            subject: "請求書を送付します",
            from: "no-reply@example.com",
            snippet: "添付をご確認ください",
          },
        ],
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(routeMocks.listLatestInboxMessages).not.toHaveBeenCalled();
    expect(json.preview).toMatchObject({
      matchedCount: 0,
      protectedCount: 1,
      protectedSamples: [
        {
          id: "m-explicit",
          classification: {
            purpose: "invoice",
            suppressible: false,
          },
        },
      ],
    });
    expect(json.skippedDetails).toContainEqual(
      expect.objectContaining({
        id: "m-explicit",
        reason: "protected_classification",
      }),
    );
  });

  it("rechecks explicit messageIds with full detail before suppressive rules", async () => {
    routeMocks.listLatestInboxMessages.mockReset();
    routeMocks.getMessageDetail.mockReset();
    routeMocks.getMessageDetail.mockResolvedValueOnce(detail({
      id: "m-explicit-attachment",
      subject: "Weekly newsletter",
      from: "no-reply@example.com",
      snippet: "unsubscribe here",
      attachments: [{ id: "a1", filename: "invoice-2026-06.pdf", mimeType: "application/pdf", size: 1234 }],
    }));
    routeMocks.getMessageMetadataForRules.mockReset();
    routeMocks.getMessageMetadataForRules.mockResolvedValueOnce({ fromEmail: "no-reply@example.com", labelIds: [] });
    const POST = await importPost();

    const res = await POST(
      post({
        dryRun: true,
        ruleId: "mute-billing",
        messageIds: ["m-explicit-attachment"],
        messageSummaries: [
          {
            id: "m-explicit-attachment",
            subject: "Weekly newsletter",
            from: "no-reply@example.com",
            snippet: "unsubscribe here",
          },
        ],
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(routeMocks.getMessageDetail).toHaveBeenCalledWith("m-explicit-attachment");
    expect(json.preview).toMatchObject({
      matchedCount: 0,
      protectedCount: 1,
    });
    expect(json.skippedDetails).toContainEqual(
      expect.objectContaining({
        id: "m-explicit-attachment",
        reason: "protected_classification",
        classification: expect.objectContaining({ purpose: "invoice", suppressible: false }),
      }),
    );
    expect(routeMocks.applyLabelsToMessages).not.toHaveBeenCalled();
  });

  it("fails closed for explicit messageIds without classification summaries", async () => {
    routeMocks.listLatestInboxMessages.mockReset();
    routeMocks.getMessageMetadataForRules.mockReset();
    routeMocks.getMessageMetadataForRules.mockResolvedValueOnce({ fromEmail: "no-reply@example.com", labelIds: [] });
    const POST = await importPost();

    const res = await POST(
      post({
        dryRun: true,
        ruleId: "mute-billing",
        messageIds: ["m-no-summary"],
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(routeMocks.listLatestInboxMessages).not.toHaveBeenCalled();
    expect(json.preview).toMatchObject({
      matchedCount: 0,
      protectedCount: 0,
    });
    expect(json.skippedDetails).toContainEqual(
      expect.objectContaining({
        id: "m-no-summary",
        reason: "missing_classification_summary",
      }),
    );
    expect(routeMocks.applyLabelsToMessages).not.toHaveBeenCalled();
  });
});
