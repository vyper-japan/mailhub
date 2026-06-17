import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  isReadOnlyMode: vi.fn(),
  isAdminEmail: vi.fn(),
  runAutoRules: vi.fn(),
  logAction: vi.fn(),
}));

vi.mock("@/lib/require-user", () => ({
  requireUser: routeMocks.requireUser,
  authErrorResponse: (result: { status: number; message: string }) =>
    Response.json({ error: "unauthorized", message: result.message }, { status: result.status }),
}));

vi.mock("@/lib/admin", () => ({
  isAdminEmail: routeMocks.isAdminEmail,
}));

vi.mock("@/lib/read-only", () => ({
  isReadOnlyMode: routeMocks.isReadOnlyMode,
  writeForbiddenResponse: (action: string) => Response.json({ error: "read_only", action }, { status: 403 }),
}));

vi.mock("@/lib/autoRulesRunner", () => ({
  runAutoRules: routeMocks.runAutoRules,
}));

vi.mock("@/lib/audit-log", () => ({
  logAction: routeMocks.logAction,
}));

async function importPost() {
  vi.resetModules();
  const mod = await import("@/app/api/mailhub/rules/run-all/route");
  return mod.POST;
}

function post(body: Record<string, unknown>, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/mailhub/rules/run-all", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("mailhub rules run-all route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MAILHUB_RULES_SECRET;
    routeMocks.requireUser.mockReset().mockResolvedValue({
      ok: true,
      user: { email: "admin@vtj.co.jp", name: "Admin" },
    });
    routeMocks.isReadOnlyMode.mockReset().mockReturnValue(false);
    routeMocks.isAdminEmail.mockReset().mockReturnValue(true);
    routeMocks.runAutoRules.mockReset().mockResolvedValue({
      mode: "apply",
      totalCandidates: 1,
      totalApplied: 1,
      totalSkipped: 0,
      totalFailed: 0,
      truncated: false,
      perRule: [],
    });
    routeMocks.logAction.mockReset().mockResolvedValue(undefined);
  });

  it("allows a valid Bearer service secret without requiring a user session", async () => {
    process.env.MAILHUB_RULES_SECRET = "secret-1";
    routeMocks.requireUser.mockResolvedValueOnce({ ok: false, status: 401, message: "no session" });
    const POST = await importPost();

    const res = await POST(post({ dryRun: false, log: true }, { authorization: "Bearer secret-1" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ totalApplied: 1 });
    expect(routeMocks.requireUser).not.toHaveBeenCalled();
    expect(routeMocks.runAutoRules).toHaveBeenCalledWith(expect.objectContaining({ dryRun: false }));
    expect(routeMocks.logAction).toHaveBeenCalledWith(expect.objectContaining({ actorEmail: "system@mailhub" }));
  });

  it("rejects non-admin session apply without a Bearer service secret", async () => {
    routeMocks.isAdminEmail.mockReturnValue(false);
    const POST = await importPost();

    const res = await POST(post({ dryRun: false }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_admin_only" });
    expect(routeMocks.runAutoRules).not.toHaveBeenCalled();
  });
});
