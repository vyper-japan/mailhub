import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  isReadOnlyMode: vi.fn(),
  isAdminEmail: vi.fn(),
  isTestMode: vi.fn(),
  buildHandoffPreview: vi.fn(),
  logAction: vi.fn(),
  fetch: vi.fn(),
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

vi.mock("@/lib/admin", () => ({
  isAdminEmail: routeMocks.isAdminEmail,
}));

vi.mock("@/lib/test-mode", () => ({
  isTestMode: routeMocks.isTestMode,
}));

vi.mock("@/lib/handoff", () => ({
  buildHandoffPreview: routeMocks.buildHandoffPreview,
}));

vi.mock("@/lib/audit-log", () => ({
  logAction: routeMocks.logAction,
}));

async function importRoute() {
  vi.resetModules();
  return await import("@/app/api/mailhub/handoff/route");
}

describe("mailhub handoff route notification provider", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    global.fetch = routeMocks.fetch;
    routeMocks.fetch.mockResolvedValue(new Response("{}", { status: 200 }));
    routeMocks.requireUser.mockResolvedValue({ ok: true, user: { email: "admin@vtj.co.jp", name: "Admin" } });
    routeMocks.isReadOnlyMode.mockReturnValue(false);
    routeMocks.isAdminEmail.mockReturnValue(true);
    routeMocks.isTestMode.mockReturnValue(false);
    routeMocks.buildHandoffPreview.mockResolvedValue({
      envLabel: "LOCAL",
      markdown: "handoff markdown",
    });
    routeMocks.logAction.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  it("sends handoff through Chatwork when configured", async () => {
    process.env.MAILHUB_ALERTS_PROVIDER = "chatwork";
    process.env.MAILHUB_CHATWORK_API_TOKEN = "token-1";
    process.env.MAILHUB_CHATWORK_ROOM_ID = "12345";
    const { POST } = await importRoute();

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(routeMocks.fetch).toHaveBeenCalledWith(
      "https://api.chatwork.com/v2/rooms/12345/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-ChatWorkToken": "token-1" }),
      }),
    );
    const body = routeMocks.fetch.mock.calls[0]?.[1]?.body;
    expect(new URLSearchParams(body as string).get("body")).toContain("handoff markdown");
    expect(routeMocks.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "handoff_send",
        metadata: expect.objectContaining({ provider: "chatwork" }),
      }),
    );
  });

  it("returns 400 when Chatwork provider is missing required config", async () => {
    process.env.MAILHUB_ALERTS_PROVIDER = "chatwork";
    delete process.env.MAILHUB_CHATWORK_API_TOKEN;
    delete process.env.MAILHUB_CHATWORK_ROOM_ID;
    const { POST } = await importRoute();

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ error: "chatwork_config_missing" });
    expect(routeMocks.fetch).not.toHaveBeenCalled();
  });

  it("blocks read-only and non-admin before provider send", async () => {
    process.env.MAILHUB_ALERTS_PROVIDER = "chatwork";
    process.env.MAILHUB_CHATWORK_API_TOKEN = "token-1";
    process.env.MAILHUB_CHATWORK_ROOM_ID = "12345";
    routeMocks.isReadOnlyMode.mockReturnValueOnce(true);
    const { POST } = await importRoute();

    const readOnlyRes = await POST();
    expect(readOnlyRes.status).toBe(403);

    routeMocks.isReadOnlyMode.mockReturnValue(false);
    routeMocks.isAdminEmail.mockReturnValue(false);
    const forbiddenRes = await POST();
    expect(forbiddenRes.status).toBe(403);
    expect(routeMocks.fetch).not.toHaveBeenCalled();
  });
});
