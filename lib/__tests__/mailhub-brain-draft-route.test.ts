import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelDef } from "@/lib/channels";
import type { MessageDetail } from "@/lib/mailhub-types";

const routeMocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getMessageDetail: vi.fn(),
  isTestMode: vi.fn(),
  getSendResolverChannels: vi.fn(),
  sendGmailReply: vi.fn(),
  archiveMessage: vi.fn(),
  logAction: vi.fn(),
  ledgerAppend: vi.fn(),
}));

vi.mock("@/lib/require-user", () => ({
  requireUser: routeMocks.requireUser,
  authErrorResponse: (result: { status: number; message: string }) =>
    Response.json({ error: "unauthorized", message: result.message }, { status: result.status }),
}));

vi.mock("@/lib/gmail", () => ({
  getMessageDetail: routeMocks.getMessageDetail,
  sendGmailReply: routeMocks.sendGmailReply,
  archiveMessage: routeMocks.archiveMessage,
}));

vi.mock("@/lib/test-mode", () => ({
  isTestMode: routeMocks.isTestMode,
}));

vi.mock("@/lib/mailhub-send-resolver", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mailhub-send-resolver")>();
  return {
    ...actual,
    getSendResolverChannels: routeMocks.getSendResolverChannels,
  };
});

vi.mock("@/lib/audit-log", () => ({
  logAction: routeMocks.logAction,
}));

vi.mock("@/lib/brainDecisionLedgerStore", () => ({
  getBrainDecisionLedgerStore: () => ({
    append: routeMocks.ledgerAppend,
    list: vi.fn(),
    clear: vi.fn(),
  }),
}));

async function importGet() {
  vi.resetModules();
  const mod = await import("@/app/api/mailhub/brain/draft/route");
  return mod.GET;
}

const channels: ChannelDef[] = [
  {
    id: "vyper-amazon",
    label: "VYPER Amazon",
    addresses: ["support@vtj.co.jp"],
    replyKind: "gmail",
  },
];

function message(overrides: Partial<MessageDetail> = {}): MessageDetail {
  return {
    id: "m-draft",
    threadId: "t-draft",
    subject: "お問い合わせ: 商品について",
    from: "customer@example.com",
    messageId: "<m-draft@example.com>",
    receivedAt: "2026-06-24T00:00:00.000Z",
    snippet: "質問があります ROUTE_SNIPPET_SHOULD_NOT_LEAK",
    gmailLink: "https://mail.google.com/mail/u/0/#inbox/m-draft",
    plainTextBody: "商品について質問があります ROUTE_BODY_SHOULD_NOT_LEAK",
    htmlBody: null,
    bodySource: "plain",
    bodyNotice: null,
    attachments: [],
    assigneeSlug: null,
    userLabels: [],
    snoozeUntil: null,
    to: "support@vtj.co.jp",
    cc: null,
    bcc: null,
    replyTo: null,
    deliveredTo: ["support@vtj.co.jp"],
    xOriginalTo: null,
    references: null,
    inReplyTo: null,
    listId: null,
    listPost: null,
    ...overrides,
  };
}

describe("mailhub brain draft route", () => {
  beforeEach(() => {
    routeMocks.requireUser.mockReset().mockResolvedValue({
      ok: true,
      user: { email: "test@vtj.co.jp", name: "Test" },
    });
    routeMocks.getMessageDetail.mockReset().mockResolvedValue(message());
    routeMocks.isTestMode.mockReset().mockReturnValue(false);
    routeMocks.getSendResolverChannels.mockReset().mockReturnValue(channels);
    routeMocks.sendGmailReply.mockReset();
    routeMocks.archiveMessage.mockReset();
    routeMocks.logAction.mockReset();
    routeMocks.ledgerAppend.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a no-store deterministic draft without raw message body leakage or executor calls", async () => {
    const GET = await importGet();

    const res = await GET(new Request("http://localhost/api/mailhub/brain/draft?messageId=m-draft&channel=vyper-amazon"));
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(routeMocks.getMessageDetail).toHaveBeenCalledWith("m-draft");
    expect(json).toMatchObject({
      result: {
        status: "ready",
        suggestion: {
          source: "deterministic_draft_v1",
          route: "gmail",
          requiresHumanReview: true,
        },
      },
    });
    expect(JSON.stringify(json)).not.toContain("ROUTE_BODY_SHOULD_NOT_LEAK");
    expect(JSON.stringify(json)).not.toContain("ROUTE_SNIPPET_SHOULD_NOT_LEAK");
    expect(routeMocks.sendGmailReply).not.toHaveBeenCalled();
    expect(routeMocks.archiveMessage).not.toHaveBeenCalled();
    expect(routeMocks.logAction).not.toHaveBeenCalled();
    expect(routeMocks.ledgerAppend).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects missing messageId before loading Gmail detail", async () => {
    const GET = await importGet();

    const res = await GET(new Request("http://localhost/api/mailhub/brain/draft"));

    expect(res.status).toBe(400);
    expect(routeMocks.getMessageDetail).not.toHaveBeenCalled();
  });
});
