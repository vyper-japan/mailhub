import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  isReadOnlyMode: vi.fn(),
  logAction: vi.fn(),
  getActivityLogs: vi.fn(),
  listLatestInboxMessages: vi.fn(),
  getLabelById: vi.fn(),
}));

vi.mock("@/lib/require-user", () => ({
  requireUser: routeMocks.requireUser,
  authErrorResponse: (result: { status: 401 | 403; message: string }) =>
    Response.json(
      { error: result.status === 401 ? "unauthorized" : "forbidden", message: result.message },
      { status: result.status },
    ),
}));

vi.mock("@/lib/read-only", () => ({
  isReadOnlyMode: routeMocks.isReadOnlyMode,
}));

vi.mock("@/lib/audit-log", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit-log")>("@/lib/audit-log");
  return {
    ...actual,
    getActivityLogs: routeMocks.getActivityLogs,
    logAction: routeMocks.logAction,
  };
});

vi.mock("@/lib/gmail", () => ({
  listLatestInboxMessages: routeMocks.listLatestInboxMessages,
}));

vi.mock("@/lib/labels", () => ({
  getLabelById: routeMocks.getLabelById,
}));

async function importPost() {
  vi.resetModules();
  const mod = await import("@/app/api/mailhub/activity/route");
  return mod.POST;
}

async function importGet() {
  vi.resetModules();
  const mod = await import("@/app/api/mailhub/activity/route");
  return mod.GET;
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/mailhub/activity", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeRawRequest(body: string): Request {
  return new Request("http://localhost/api/mailhub/activity", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("activity route POST", () => {
  beforeEach(() => {
    routeMocks.requireUser.mockReset().mockResolvedValue({
      ok: true,
      user: { email: "test@vtj.co.jp", name: "Test" },
    });
    routeMocks.isReadOnlyMode.mockReset().mockReturnValue(false);
    routeMocks.logAction.mockReset().mockResolvedValue(undefined);
    routeMocks.getActivityLogs.mockReset().mockResolvedValue([]);
    routeMocks.listLatestInboxMessages.mockReset().mockResolvedValue({ messages: [] });
    routeMocks.getLabelById.mockReset().mockReturnValue(null);
  });

  it("returns 401 when authentication fails", async () => {
    routeMocks.requireUser.mockResolvedValueOnce({
      ok: false,
      status: 401,
      message: "Unauthorized: Please sign in",
    });
    const POST = await importPost();

    const res = await POST(makeRequest({ action: "assign" }));

    expect(res.status).toBe(401);
    expect(await readJson(res)).toMatchObject({ error: "unauthorized" });
    expect(routeMocks.logAction).not.toHaveBeenCalled();
  });

  it("returns 403 with activity_write reason in READ ONLY mode", async () => {
    routeMocks.isReadOnlyMode.mockReturnValueOnce(true);
    const POST = await importPost();

    const res = await POST(makeRequest({ action: "assign" }));

    expect(res.status).toBe(403);
    expect(await readJson(res)).toMatchObject({
      error: "read_only",
      reason: "activity_write",
    });
    expect(routeMocks.logAction).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid action and invalid input contracts", async () => {
    const POST = await importPost();

    const invalidJson = await POST(makeRawRequest("{"));
    expect(invalidJson.status).toBe(400);
    expect(await readJson(invalidJson)).toMatchObject({ error: "invalid_json" });

    const nullBody = await POST(makeRequest(null));
    expect(nullBody.status).toBe(400);
    expect(await readJson(nullBody)).toMatchObject({ error: "invalid_json" });

    const arrayBody = await POST(makeRequest([]));
    expect(arrayBody.status).toBe(400);
    expect(await readJson(arrayBody)).toMatchObject({ error: "invalid_action" });

    const typedAction = await POST(makeRequest({ action: 1 }));
    expect(typedAction.status).toBe(400);
    expect(await readJson(typedAction)).toMatchObject({ error: "invalid_action" });

    const invalidAction = await POST(makeRequest({ action: "not-an-action" }));
    expect(invalidAction.status).toBe(400);
    expect(await readJson(invalidAction)).toMatchObject({ error: "invalid_action" });

    const typedMessageId = await POST(makeRequest({ action: "assign", messageId: 123 }));
    expect(typedMessageId.status).toBe(400);
    expect(await readJson(typedMessageId)).toMatchObject({ error: "invalid_input" });

    const tooLongMessageId = await POST(makeRequest({ action: "assign", messageId: "x".repeat(513) }));
    expect(tooLongMessageId.status).toBe(400);
    expect(await readJson(tooLongMessageId)).toMatchObject({ error: "invalid_input" });

    const typedLabel = await POST(makeRequest({ action: "assign", label: 123 }));
    expect(typedLabel.status).toBe(400);
    expect(await readJson(typedLabel)).toMatchObject({ error: "invalid_input" });

    const tooLongLabel = await POST(makeRequest({ action: "assign", label: "x".repeat(257) }));
    expect(tooLongLabel.status).toBe(400);
    expect(await readJson(tooLongLabel)).toMatchObject({ error: "invalid_input" });

    const typedReason = await POST(makeRequest({ action: "assign", reason: 123 }));
    expect(typedReason.status).toBe(400);
    expect(await readJson(typedReason)).toMatchObject({ error: "invalid_input" });

    const tooLongReason = await POST(makeRequest({ action: "assign", reason: "x".repeat(1001) }));
    expect(tooLongReason.status).toBe(400);
    expect(await readJson(tooLongReason)).toMatchObject({ error: "invalid_input" });

    const tooLargeMetadata = await POST(makeRequest({ action: "assign", metadata: { payload: "x".repeat(8200) } }));
    expect(tooLargeMetadata.status).toBe(400);
    expect(await readJson(tooLargeMetadata)).toMatchObject({ error: "invalid_input" });

    const arrayMetadata = await POST(makeRequest({ action: "assign", metadata: [] }));
    expect(arrayMetadata.status).toBe(400);
    expect(await readJson(arrayMetadata)).toMatchObject({ error: "invalid_input" });
    expect(routeMocks.logAction).not.toHaveBeenCalled();
  });

  it("returns 200 and logs trimmed messageId label reason with metadata", async () => {
    const POST = await importPost();

    const res = await POST(
      makeRequest({
        action: "assign",
        messageId: " msg-1 ",
        label: " MailHub/Todo ",
        reason: " handoff ",
        metadata: { source: "unit" },
      }),
    );

    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ ok: true });
    expect(routeMocks.logAction).toHaveBeenCalledWith({
      actorEmail: "test@vtj.co.jp",
      action: "assign",
      messageId: "msg-1",
      label: "MailHub/Todo",
      reason: "handoff",
      metadata: { source: "unit" },
    });
  });
});

describe("activity route GET", () => {
  beforeEach(() => {
    routeMocks.requireUser.mockReset().mockResolvedValue({
      ok: true,
      user: { email: "test@vtj.co.jp", name: "Test" },
    });
    routeMocks.isReadOnlyMode.mockReset().mockReturnValue(false);
    routeMocks.logAction.mockReset().mockResolvedValue(undefined);
    routeMocks.getActivityLogs.mockReset().mockResolvedValue([]);
    routeMocks.listLatestInboxMessages.mockReset().mockResolvedValue({ messages: [] });
    routeMocks.getLabelById.mockReset().mockReturnValue(null);
  });

  it("returns 401 when authentication fails", async () => {
    routeMocks.requireUser.mockResolvedValueOnce({
      ok: false,
      status: 401,
      message: "Unauthorized: Please sign in",
    });
    const GET = await importGet();

    const res = await GET(new Request("http://localhost/api/mailhub/activity"));

    expect(res.status).toBe(401);
    expect(await readJson(res)).toMatchObject({ error: "unauthorized" });
    expect(routeMocks.getActivityLogs).not.toHaveBeenCalled();
  });

  it("builds filters, enriches messages, and applies messageId period subject filters", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    routeMocks.getActivityLogs.mockResolvedValueOnce([
      {
        timestamp: now.toISOString(),
        actorEmail: "test@vtj.co.jp",
        action: "assign",
        messageId: "msg-keep",
        label: "channel-rakuten",
        metadata: { ruleId: "rule-1" },
      },
      {
        timestamp: now.toISOString(),
        actorEmail: "test@vtj.co.jp",
        action: "assign",
        messageId: "msg-drop-subject",
        label: "status-waiting",
      },
      {
        timestamp: old.toISOString(),
        actorEmail: "test@vtj.co.jp",
        action: "assign",
        messageId: "msg-keep-old",
        label: "channel-rakuten",
      },
      {
        timestamp: "not-a-date",
        actorEmail: "test@vtj.co.jp",
        action: "assign",
        messageId: "msg-keep-invalid-date",
      },
    ]);
    routeMocks.listLatestInboxMessages.mockResolvedValueOnce({
      messages: [
        { id: "msg-keep", subject: "Need Follow Up", receivedAt: "2026-01-01T00:00:00.000Z" },
        { id: "msg-drop-subject", subject: "Other Subject", receivedAt: null },
      ],
    });
    routeMocks.getLabelById.mockImplementation((id: string) => {
      if (id === "channel-rakuten") return { id, type: "channel" };
      if (id === "status-waiting") return { id, statusType: "waiting" };
      return null;
    });
    const GET = await importGet();

    const res = await GET(
      new Request(
        "http://localhost/api/mailhub/activity?actor=me&action=assign&ruleId=rule-1&messageId=keep&period=7d&subject=follow&limit=500",
      ),
    );

    expect(res.status).toBe(200);
    expect(routeMocks.getActivityLogs).toHaveBeenCalledWith({
      actorEmail: "test@vtj.co.jp",
      action: "assign",
      ruleId: "rule-1",
      limit: 200,
    });
    const body = await readJson(res);
    expect(body.logs).toEqual([
      expect.objectContaining({
        messageId: "msg-keep",
        subject: "Need Follow Up",
        receivedAt: "2026-01-01T00:00:00.000Z",
        channel: "channel-rakuten",
      }),
    ]);
  });

  it("supports arbitrary actor filters and ignores invalid optional filters", async () => {
    routeMocks.getActivityLogs.mockResolvedValueOnce([
      {
        timestamp: "2026-01-01T00:00:00.000Z",
        actorEmail: "other@vtj.co.jp",
        action: "assign",
        messageId: "msg-1",
      },
    ]);
    routeMocks.listLatestInboxMessages.mockRejectedValueOnce(new Error("gmail down"));
    const GET = await importGet();

    const res = await GET(
      new Request("http://localhost/api/mailhub/activity?actor=%20other@vtj.co.jp%20&action=bogus&limit=0"),
    );

    expect(res.status).toBe(200);
    expect(routeMocks.getActivityLogs).toHaveBeenCalledWith({
      actorEmail: "other@vtj.co.jp",
    });
    const body = await readJson(res);
    expect(body.logs).toEqual([
      expect.objectContaining({
        messageId: "msg-1",
        subject: null,
        receivedAt: null,
      }),
    ]);
  });

  it("returns status enrichment and 30d period results", async () => {
    routeMocks.getActivityLogs.mockResolvedValueOnce([
      {
        timestamp: new Date().toISOString(),
        actorEmail: "test@vtj.co.jp",
        action: "assign",
        messageId: "msg-status",
        label: "status-waiting",
      },
    ]);
    routeMocks.getLabelById.mockReturnValueOnce({ id: "status-waiting", statusType: "waiting" });
    const GET = await importGet();

    const res = await GET(new Request("http://localhost/api/mailhub/activity?period=30d&limit=10"));

    expect(res.status).toBe(200);
    expect(routeMocks.getActivityLogs).toHaveBeenCalledWith({ limit: 10 });
    const body = await readJson(res);
    expect(body.logs).toEqual([
      expect.objectContaining({
        messageId: "msg-status",
        status: "waiting",
      }),
    ]);
  });
});
