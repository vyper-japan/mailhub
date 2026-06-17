import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  isReadOnlyMode: vi.fn(),
  isTestMode: vi.fn(),
  releaseSnoozed: vi.fn(),
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

vi.mock("@/lib/test-mode", () => ({
  isTestMode: routeMocks.isTestMode,
}));

vi.mock("@/lib/gmail", () => ({
  releaseSnoozed: routeMocks.releaseSnoozed,
}));

vi.mock("@/lib/audit-log", () => ({
  logAction: routeMocks.logAction,
}));

async function importPost() {
  vi.resetModules();
  const mod = await import("@/app/api/mailhub/snooze/release/route");
  return mod.POST;
}

function post(body: Record<string, unknown>, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/mailhub/snooze/release", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("mailhub snooze release route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MAILHUB_SNOOZE_SECRET;
    routeMocks.requireUser.mockReset().mockResolvedValue({
      ok: true,
      user: { email: "admin@vtj.co.jp", name: "Admin" },
    });
    routeMocks.isReadOnlyMode.mockReset().mockReturnValue(false);
    routeMocks.isTestMode.mockReset().mockReturnValue(false);
    routeMocks.releaseSnoozed.mockReset().mockResolvedValue({
      releasedCount: 2,
      releasedIds: ["m1", "m2"],
      truncated: false,
    });
    routeMocks.logAction.mockReset().mockResolvedValue(undefined);
  });

  it("allows a valid Bearer service secret without requiring a user session", async () => {
    process.env.MAILHUB_SNOOZE_SECRET = "secret-1";
    routeMocks.requireUser.mockResolvedValueOnce({ ok: false, status: 401, message: "no session" });
    const POST = await importPost();

    const res = await POST(post({ until: "2026-06-17" }, { authorization: "Bearer secret-1" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ success: true, releasedCount: 2 });
    expect(routeMocks.requireUser).not.toHaveBeenCalled();
    expect(routeMocks.releaseSnoozed).toHaveBeenCalledWith("2026-06-17");
    expect(routeMocks.logAction).toHaveBeenCalledWith(expect.objectContaining({ actorEmail: "system@mailhub" }));
  });

  it("rejects non-test requests without a Bearer service secret", async () => {
    const POST = await importPost();

    const res = await POST(post({ until: "2026-06-17" }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(routeMocks.releaseSnoozed).not.toHaveBeenCalled();
  });
});
