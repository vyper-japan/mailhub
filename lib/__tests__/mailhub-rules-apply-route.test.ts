import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getRules: vi.fn(),
  listRegisteredLabels: vi.fn(),
  listLatestInboxMessages: vi.fn(),
  getMessageMetadataForRules: vi.fn(),
  ensureLabelId: vi.fn(),
  applyLabelsToMessages: vi.fn(),
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
  getMessageMetadataForRules: routeMocks.getMessageMetadataForRules,
  ensureLabelId: routeMocks.ensureLabelId,
  applyLabelsToMessages: routeMocks.applyLabelsToMessages,
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
    routeMocks.getMessageMetadataForRules.mockResolvedValue({ fromEmail: "billing@example.com", labelIds: [] });
    routeMocks.ensureLabelId.mockResolvedValue("Label_Muted");
    routeMocks.applyLabelsToMessages.mockResolvedValue({ applied: ["m1"], failed: [] });
    routeMocks.applyTestActionDelay.mockResolvedValue(undefined);
    routeMocks.getTestUserLabelNames.mockReturnValue([]);
    routeMocks.getTestAssigneeMap.mockReturnValue(new Map());
    routeMocks.isTestMode.mockReturnValue(false);
    routeMocks.isReadOnlyMode.mockReturnValue(false);
    routeMocks.isAdminEmail.mockReturnValue(true);
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
});
