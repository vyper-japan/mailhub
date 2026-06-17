import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { assigneeSlug } from "@/lib/assignee";

const routeMocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  isReadOnlyMode: vi.fn(),
  writeForbiddenResponse: vi.fn(),
  isTestMode: vi.fn(),
  isAdminEmail: vi.fn(),
  assignMessage: vi.fn(),
  unassignMessage: vi.fn(),
  logAction: vi.fn(),
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
  writeForbiddenResponse: routeMocks.writeForbiddenResponse,
}));

vi.mock("@/lib/test-mode", () => ({
  isTestMode: routeMocks.isTestMode,
}));

vi.mock("@/lib/admin", () => ({
  isAdminEmail: routeMocks.isAdminEmail,
}));

vi.mock("@/lib/gmail", () => ({
  assignMessage: routeMocks.assignMessage,
  unassignMessage: routeMocks.unassignMessage,
}));

vi.mock("@/lib/audit-log", () => ({
  logAction: routeMocks.logAction,
}));

async function importPost() {
  vi.resetModules();
  const mod = await import("@/app/api/mailhub/assign/route");
  return mod.POST;
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/mailhub/assign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("assign route assigneeSlug", () => {
  beforeEach(() => {
    routeMocks.requireUser.mockReset().mockResolvedValue({
      ok: true,
      user: { email: "test@vtj.co.jp", name: "Test" },
    });
    routeMocks.isReadOnlyMode.mockReset().mockReturnValue(false);
    routeMocks.writeForbiddenResponse.mockReset().mockReturnValue(
      Response.json({ error: "read_only", reason: "assign" }, { status: 403 }),
    );
    routeMocks.isTestMode.mockReset().mockReturnValue(false);
    routeMocks.isAdminEmail.mockReset().mockReturnValue(true);
    routeMocks.assignMessage.mockReset().mockResolvedValue({ currentAssigneeSlug: null });
    routeMocks.unassignMessage.mockReset().mockResolvedValue(undefined);
    routeMocks.logAction.mockReset().mockResolvedValue(undefined);
  });

  it("returns normalized success assigneeSlug in production mode", async () => {
    const POST = await importPost();

    const res = await POST(makeRequest({
      id: "msg-1",
      action: "assign",
      assigneeEmail: "First.Last+Tag@VTJ.CO.JP",
    }));

    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({
      success: true,
      id: "msg-1",
      action: "assign",
      assigneeEmail: "first.last+tag@vtj.co.jp",
      assigneeSlug: assigneeSlug("first.last+tag@vtj.co.jp"),
    });
    expect(routeMocks.assignMessage).toHaveBeenCalledWith("msg-1", "first.last+tag@vtj.co.jp", { force: false });
  });

  it("returns normalized success assigneeSlug in TEST_MODE", async () => {
    routeMocks.isTestMode.mockReturnValueOnce(true);
    const POST = await importPost();

    const res = await POST(makeRequest({
      id: "msg-2",
      action: "assign",
      assigneeEmail: "Member.One@VTJ.CO.JP",
    }));

    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({
      ok: true,
      assigneeEmail: "member.one@vtj.co.jp",
      assigneeSlug: assigneeSlug("member.one@vtj.co.jp"),
    });
  });

  it("keeps unassign assigneeSlug null", async () => {
    const POST = await importPost();

    const res = await POST(makeRequest({ id: "msg-3", action: "unassign" }));

    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({
      success: true,
      id: "msg-3",
      action: "unassign",
      assigneeSlug: null,
    });
    expect(routeMocks.unassignMessage).toHaveBeenCalledWith("msg-3");
  });

  it("returns normalized currentAssigneeSlug for already_assigned", async () => {
    const currentAssigneeSlug = assigneeSlug("Owner.One+Tag@vtj.co.jp");
    routeMocks.assignMessage.mockResolvedValueOnce({ currentAssigneeSlug });
    const POST = await importPost();

    const res = await POST(makeRequest({
      id: "msg-4",
      action: "assign",
      assigneeEmail: "member@vtj.co.jp",
    }));

    expect(res.status).toBe(409);
    expect(await readJson(res)).toEqual({
      error: "already_assigned",
      currentAssigneeSlug,
    });
  });

  it("rejects unauthenticated and read-only mutations before parsing assignment details", async () => {
    const POST = await importPost();

    routeMocks.requireUser.mockResolvedValueOnce({
      ok: false,
      status: 401,
      message: "Unauthorized",
    });
    const authRes = await POST(makeRequest({ id: "msg-unauth", action: "assign" }));
    expect(authRes.status).toBe(401);
    expect(await readJson(authRes)).toEqual({ error: "unauthorized", message: "Unauthorized" });

    routeMocks.isReadOnlyMode.mockReturnValueOnce(true);
    const readOnlyRes = await POST(makeRequest({ id: "msg-ro", action: "assign" }));
    expect(readOnlyRes.status).toBe(403);
    expect(await readJson(readOnlyRes)).toEqual({ error: "read_only", reason: "assign" });
    expect(routeMocks.assignMessage).not.toHaveBeenCalled();
  });

  it("validates JSON body, id, action, and assignee email domain", async () => {
    const POST = await importPost();

    const invalidJson = await POST(new NextRequest("http://localhost/api/mailhub/assign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    }));
    expect(invalidJson.status).toBe(400);
    expect(await readJson(invalidJson)).toEqual({ error: "invalid_json" });

    const invalidId = await POST(makeRequest({ action: "assign" }));
    expect(invalidId.status).toBe(400);
    expect(await readJson(invalidId)).toEqual({ error: "invalid_id" });

    const invalidAction = await POST(makeRequest({ id: "msg-invalid", action: "archive" }));
    expect(invalidAction.status).toBe(400);
    expect(await readJson(invalidAction)).toEqual({ error: "invalid_action" });

    const invalidDomain = await POST(makeRequest({
      id: "msg-domain",
      action: "assign",
      assigneeEmail: "member@example.com",
    }));
    expect(invalidDomain.status).toBe(400);
    expect(await readJson(invalidDomain)).toEqual({
      error: "invalid_domain",
      message: "@vtj.co.jp ドメインのみ許可されています",
    });
    expect(routeMocks.assignMessage).not.toHaveBeenCalled();
  });

  it("rejects non-admin assignment to other people and force takeover", async () => {
    routeMocks.isAdminEmail.mockReturnValue(false);
    const POST = await importPost();

    const otherRes = await POST(makeRequest({
      id: "msg-other",
      action: "assign",
      assigneeEmail: "other@vtj.co.jp",
    }));
    expect(otherRes.status).toBe(403);
    expect(await readJson(otherRes)).toEqual({ error: "forbidden_admin_only" });

    const forceRes = await POST(makeRequest({
      id: "msg-force-denied",
      action: "assign",
      force: true,
    }));
    expect(forceRes.status).toBe(403);
    expect(await readJson(forceRes)).toEqual({ error: "forbidden_admin_only" });

    expect(routeMocks.assignMessage).not.toHaveBeenCalled();
  });

  it("allows non-admin assignment to self", async () => {
    routeMocks.isAdminEmail.mockReturnValue(false);
    const POST = await importPost();

    const res = await POST(makeRequest({ id: "msg-self", action: "assign" }));

    expect(res.status).toBe(200);
    expect(routeMocks.assignMessage).toHaveBeenCalledWith("msg-self", "test@vtj.co.jp", { force: false });
  });

  it("allows force takeover despite an existing assignee and logs the reason", async () => {
    const currentAssigneeSlug = assigneeSlug("owner@vtj.co.jp");
    routeMocks.assignMessage.mockResolvedValueOnce({ currentAssigneeSlug });
    const POST = await importPost();

    const res = await POST(makeRequest({
      id: "msg-force",
      action: "assign",
      assigneeEmail: "member@vtj.co.jp",
      force: true,
      reason: "handoff",
    }));

    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({
      success: true,
      action: "assign",
      assigneeEmail: "member@vtj.co.jp",
      assigneeSlug: assigneeSlug("member@vtj.co.jp"),
    });
    expect(routeMocks.assignMessage).toHaveBeenCalledWith("msg-force", "member@vtj.co.jp", { force: true });
    expect(routeMocks.logAction).toHaveBeenCalledWith(expect.objectContaining({
      action: "takeover",
      messageId: "msg-force",
      reason: "handoff",
    }));
  });

  it("maps Gmail failures through the route error response", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    routeMocks.assignMessage.mockRejectedValueOnce(Object.assign(new Error("gmail failed"), {
      code: 403,
      errors: [{ reason: "insufficientPermissions" }],
    }));
    const POST = await importPost();

    const res = await POST(makeRequest({ id: "msg-gmail", action: "assign" }));

    expect(res.status).toBe(403);
    expect(await readJson(res)).toMatchObject({
      error: "gmail_api_error",
      error_code: "insufficient_permissions",
    });
    errorSpy.mockRestore();
  });
});
