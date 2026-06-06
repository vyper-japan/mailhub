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

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/mailhub/activity", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
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

    const invalidAction = await POST(makeRequest({ action: "not-an-action" }));
    expect(invalidAction.status).toBe(400);
    expect(await readJson(invalidAction)).toMatchObject({ error: "invalid_action" });

    const tooLongMessageId = await POST(makeRequest({ action: "assign", messageId: "x".repeat(513) }));
    expect(tooLongMessageId.status).toBe(400);
    expect(await readJson(tooLongMessageId)).toMatchObject({ error: "invalid_input" });

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
