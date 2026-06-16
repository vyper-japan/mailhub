import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageDetail } from "@/lib/mailhub-types";

const routeMocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getMessageDetail: vi.fn(),
  isTestMode: vi.fn(),
}));

vi.mock("@/lib/require-user", () => ({
  requireUser: routeMocks.requireUser,
  authErrorResponse: (result: { status: number; message: string }) =>
    Response.json({ error: "unauthorized", message: result.message }, { status: result.status }),
}));

vi.mock("@/lib/gmail", () => ({
  getMessageDetail: routeMocks.getMessageDetail,
}));

vi.mock("@/lib/test-mode", () => ({
  isTestMode: routeMocks.isTestMode,
}));

async function importGet() {
  vi.resetModules();
  const mod = await import("@/app/api/mailhub/brain/route");
  return mod.GET;
}

function message(overrides: Partial<MessageDetail> = {}): MessageDetail {
  return {
    id: "m-brain",
    threadId: "t-brain",
    subject: "お問い合わせ: 商品について",
    from: "customer@example.com",
    messageId: "<m-brain@example.com>",
    receivedAt: "2026-06-17T00:00:00.000Z",
    snippet: "質問があります",
    gmailLink: "https://mail.google.com/mail/u/0/#inbox/m-brain",
    plainTextBody: "商品について質問があります",
    htmlBody: null,
    bodySource: "plain",
    bodyNotice: null,
    attachments: [],
    assigneeSlug: null,
    userLabels: [],
    snoozeUntil: null,
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

describe("mailhub brain route", () => {
  beforeEach(() => {
    routeMocks.requireUser.mockReset().mockResolvedValue({
      ok: true,
      user: { email: "test@vtj.co.jp", name: "Test" },
    });
    routeMocks.getMessageDetail.mockReset().mockResolvedValue(message());
    routeMocks.isTestMode.mockReset().mockReturnValue(false);
  });

  it("returns a read-only deterministic decision for one message", async () => {
    const GET = await importGet();

    const res = await GET(new Request("http://localhost/api/mailhub/brain?messageId=m-brain&channel=stores"));
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(routeMocks.getMessageDetail).toHaveBeenCalledWith("m-brain");
    expect(json).toMatchObject({
      decision: {
        messageId: "m-brain",
        source: "deterministic_v1",
        purpose: "inquiry",
        discardCandidate: false,
        humanRequired: true,
      },
    });
    expect(JSON.stringify(json)).not.toContain("商品について質問があります");
  });

  it("rejects missing messageId", async () => {
    const GET = await importGet();

    const res = await GET(new Request("http://localhost/api/mailhub/brain"));

    expect(res.status).toBe(400);
    expect(routeMocks.getMessageDetail).not.toHaveBeenCalled();
  });
});
