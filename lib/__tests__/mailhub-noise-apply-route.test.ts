import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  isReadOnlyMode: vi.fn(),
  getMessageDetail: vi.fn(),
  muteMessage: vi.fn(),
  shouldFailInTestMode: vi.fn(),
  logAction: vi.fn(),
}));

vi.mock("@/lib/require-user", () => ({
  requireUser: routeMocks.requireUser,
  authErrorResponse: (result: { status: number; message: string }) =>
    Response.json({ error: "unauthorized", message: result.message }, { status: result.status }),
}));

vi.mock("@/lib/read-only", () => ({
  isReadOnlyMode: routeMocks.isReadOnlyMode,
  writeForbiddenResponse: (action: string) => Response.json({ error: "read_only", action }, { status: 403 }),
}));

vi.mock("@/lib/gmail", () => ({
  getMessageDetail: routeMocks.getMessageDetail,
  muteMessage: routeMocks.muteMessage,
  shouldFailInTestMode: routeMocks.shouldFailInTestMode,
}));

vi.mock("@/lib/audit-log", () => ({
  logAction: routeMocks.logAction,
}));

async function importPost() {
  vi.resetModules();
  const mod = await import("@/app/api/mailhub/noise/apply/route");
  return mod.POST;
}

function post(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/mailhub/noise/apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function detail(overrides: Record<string, unknown>) {
  return {
    id: "m1",
    threadId: "t1",
    subject: "Weekly newsletter",
    from: "No Reply <no-reply@example.com>",
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

describe("mailhub noise apply route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeMocks.requireUser.mockResolvedValue({
      ok: true,
      user: { email: "user@vtj.co.jp", name: "User" },
    });
    routeMocks.isReadOnlyMode.mockReturnValue(false);
    routeMocks.shouldFailInTestMode.mockReturnValue(false);
    routeMocks.muteMessage.mockResolvedValue(undefined);
    routeMocks.logAction.mockResolvedValue(undefined);
  });

  it("mutes only messages that are still safe at execution time", async () => {
    routeMocks.getMessageDetail.mockImplementation((id: string) => {
      if (id === "noise") return Promise.resolve(detail({ id }));
      return Promise.resolve(detail({ id, subject: "請求書", snippet: "invoice attached" }));
    });
    const POST = await importPost();

    const res = await POST(post({ messageIds: ["noise", "invoice"], fromEmail: "no-reply@example.com" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      processed: 2,
      mutedCount: 1,
      skippedCount: 1,
      failedCount: 0,
    });
    expect(json.skipped[0]).toMatchObject({ id: "invoice", reason: "protected" });
    expect(routeMocks.muteMessage).toHaveBeenCalledTimes(1);
    expect(routeMocks.muteMessage).toHaveBeenCalledWith("noise");
  });

  it("skips safe-looking messages when the sender changed since preview", async () => {
    routeMocks.getMessageDetail.mockResolvedValue(
      detail({ id: "noise", from: "No Reply <other@example.com>" }),
    );
    const POST = await importPost();

    const res = await POST(post({ messageIds: ["noise"], fromEmail: "no-reply@example.com" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.skipped).toEqual([
      expect.objectContaining({ id: "noise", reason: "sender_mismatch" }),
    ]);
    expect(routeMocks.muteMessage).not.toHaveBeenCalled();
  });

  it("respects read-only mode", async () => {
    routeMocks.isReadOnlyMode.mockReturnValue(true);
    const POST = await importPost();

    const res = await POST(post({ messageIds: ["noise"] }));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json).toEqual({ error: "read_only", action: "noise_apply" });
    expect(routeMocks.muteMessage).not.toHaveBeenCalled();
  });
});
