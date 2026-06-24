import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getMessageDetail: vi.fn(),
  listCandidatesByQuery: vi.fn(),
}));

vi.mock("@/lib/require-user", () => ({
  requireUser: routeMocks.requireUser,
  authErrorResponse: (result: { status: number; message: string }) =>
    Response.json({ error: "unauthorized", message: result.message }, { status: result.status }),
}));

vi.mock("@/lib/gmail", () => ({
  getMessageDetail: routeMocks.getMessageDetail,
}));

vi.mock("@/lib/gmail-alerts", () => ({
  listCandidatesByQuery: routeMocks.listCandidatesByQuery,
}));

async function importPost() {
  vi.resetModules();
  const mod = await import("@/app/api/mailhub/noise/preview/route");
  return mod.POST;
}

function post(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/mailhub/noise/preview", {
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

describe("mailhub noise preview route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeMocks.requireUser.mockResolvedValue({
      ok: true,
      user: { email: "user@vtj.co.jp", name: "User" },
    });
    routeMocks.listCandidatesByQuery.mockResolvedValue({ messages: [], truncated: false });
  });

  it("splits exact messageIds into safe and protected buckets without mutating Gmail", async () => {
    routeMocks.getMessageDetail.mockImplementation((id: string) => {
      if (id === "noise") {
        return Promise.resolve(detail({ id, subject: "Weekly newsletter", snippet: "unsubscribe here" }));
      }
      return Promise.resolve(detail({ id, subject: "6月分 請求書", from: "billing@example.com", snippet: "添付をご確認ください" }));
    });
    const POST = await importPost();

    const res = await POST(post({ messageIds: ["noise", "invoice"] }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.safeCandidates).toHaveLength(1);
    expect(json.safeCandidates[0]).toMatchObject({
      id: "noise",
      status: "safe_to_suppress",
      classification: { purpose: "noise", suppressible: true },
    });
    expect(json.protected).toHaveLength(1);
    expect(json.protected[0]).toMatchObject({
      id: "invoice",
      status: "protected",
      classification: { purpose: "invoice", suppressible: false },
    });
    expect(json.missingSummary).toEqual([]);
  });

  it("fails closed when a detail fetch fails", async () => {
    routeMocks.getMessageDetail.mockRejectedValue(new Error("not found"));
    const POST = await importPost();

    const res = await POST(post({ messageIds: ["missing"] }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.safeCandidates).toEqual([]);
    expect(json.missingSummary).toEqual([
      expect.objectContaining({
        id: "missing",
        status: "missing_summary",
        classification: expect.objectContaining({ blockedReasons: ["detail_fetch_failed"] }),
      }),
    ]);
    expect(json.warnings).toEqual([
      expect.objectContaining({ type: "detail_fetch_failed", id: "missing" }),
    ]);
  });

  it("uses exact fromEmail search and evaluates fetched details", async () => {
    routeMocks.listCandidatesByQuery.mockResolvedValue({
      messages: [{ id: "m-news" }, { id: "m-invoice" }],
      truncated: false,
    });
    routeMocks.getMessageDetail.mockImplementation((id: string) => {
      if (id === "m-news") return Promise.resolve(detail({ id }));
      return Promise.resolve(detail({ id, subject: "領収書", snippet: "receipt attached" }));
    });
    const POST = await importPost();

    const res = await POST(post({ fromEmail: "No Reply <no-reply@example.com>", max: 10 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(routeMocks.listCandidatesByQuery).toHaveBeenCalledWith({
      q: "from:no-reply@example.com",
      maxTotal: 11,
      maxPages: 5,
    });
    expect(json.source).toMatchObject({
      type: "fromEmail",
      value: "no-reply@example.com",
      query: "from:no-reply@example.com",
    });
    expect(json.safeCandidates.map((item: { id: string }) => item.id)).toEqual(["m-news"]);
    expect(json.protected.map((item: { id: string }) => item.id)).toEqual(["m-invoice"]);
  });

  it("rejects broad sources for Tier1", async () => {
    const POST = await importPost();

    const res = await POST(post({ fromDomain: "example.com" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("unsupported_source");
    expect(routeMocks.listCandidatesByQuery).not.toHaveBeenCalled();
    expect(routeMocks.getMessageDetail).not.toHaveBeenCalled();
  });
});
