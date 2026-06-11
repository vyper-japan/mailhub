import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  isReadOnlyMode: vi.fn(),
  isAdminEmail: vi.fn(),
  listTeam: vi.fn(),
  createTeamMember: vi.fn(),
  getRoster: vi.fn(),
  setRoster: vi.fn(),
}));

vi.mock("@/lib/require-user", () => ({
  requireUser: routeMocks.requireUser,
  authErrorResponse: (result: { status: 401 | 403; message: string }) =>
    Response.json(
      { error: result.status === 401 ? "unauthorized" : "forbidden", message: result.message },
      { status: result.status },
    ),
}));

vi.mock("@/lib/teamStore", () => ({
  getTeamStore: () => ({
    list: routeMocks.listTeam,
    create: routeMocks.createTeamMember,
  }),
}));

vi.mock("@/lib/rosterStore", () => ({
  getRosterStore: () => ({
    get: routeMocks.getRoster,
    set: routeMocks.setRoster,
  }),
}));

vi.mock("@/lib/read-only", () => ({
  isReadOnlyMode: routeMocks.isReadOnlyMode,
}));

vi.mock("@/lib/admin", () => ({
  isAdminEmail: routeMocks.isAdminEmail,
}));

async function importGet() {
  vi.resetModules();
  const mod = await import("@/app/api/mailhub/team/route");
  return mod.GET;
}

async function importRoute() {
  vi.resetModules();
  return import("@/app/api/mailhub/team/route");
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/mailhub/team", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("team route GET auth", () => {
  beforeEach(() => {
    routeMocks.requireUser.mockReset().mockResolvedValue({
      ok: true,
      user: { email: "test@vtj.co.jp", name: "Test" },
    });
    routeMocks.isReadOnlyMode.mockReset().mockReturnValue(false);
    routeMocks.isAdminEmail.mockReset().mockReturnValue(true);
    routeMocks.listTeam.mockReset().mockResolvedValue([
      { email: "test@vtj.co.jp", name: "Test" },
      { email: "member@vtj.co.jp", name: "Member" },
    ]);
    routeMocks.createTeamMember.mockReset().mockImplementation(async (member) => member);
    routeMocks.getRoster.mockReset().mockResolvedValue(["test@vtj.co.jp", "member@vtj.co.jp"]);
    routeMocks.setRoster.mockReset().mockResolvedValue(undefined);
  });

  it("returns 401 when authentication fails", async () => {
    routeMocks.requireUser.mockResolvedValueOnce({
      ok: false,
      status: 401,
      message: "Unauthorized: Please sign in",
    });
    const GET = await importGet();

    const res = await GET();

    expect(res.status).toBe(401);
    expect(await readJson(res)).toEqual({
      error: "unauthorized",
      message: "Unauthorized: Please sign in",
    });
    expect(routeMocks.listTeam).not.toHaveBeenCalled();
  });

  it("returns 403 for non-vtj users", async () => {
    routeMocks.requireUser.mockResolvedValueOnce({
      ok: false,
      status: 403,
      message: "Forbidden: Only vtj.co.jp users are allowed",
    });
    const GET = await importGet();

    const res = await GET();

    expect(res.status).toBe(403);
    expect(await readJson(res)).toEqual({
      error: "forbidden",
      message: "Forbidden: Only vtj.co.jp users are allowed",
    });
    expect(routeMocks.listTeam).not.toHaveBeenCalled();
  });

  it("returns the existing team body with no-store for authenticated users", async () => {
    const GET = await importGet();

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await readJson(res)).toEqual({
      team: [
        { email: "test@vtj.co.jp", name: "Test" },
        { email: "member@vtj.co.jp", name: "Member" },
      ],
      roster: ["test@vtj.co.jp", "member@vtj.co.jp"],
    });
  });

  it("allows authenticated GET in READ ONLY mode", async () => {
    routeMocks.isReadOnlyMode.mockReturnValueOnce(true);
    const GET = await importGet();

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({
      roster: ["test@vtj.co.jp", "member@vtj.co.jp"],
    });
  });

  it("blocks POST before mutation when auth, admin, or read-only checks fail", async () => {
    const { POST } = await importRoute();

    routeMocks.requireUser.mockResolvedValueOnce({
      ok: false,
      status: 401,
      message: "Unauthorized",
    });
    const authRes = await POST(makeRequest({ email: "new@vtj.co.jp" }));
    expect(authRes.status).toBe(401);
    expect(await readJson(authRes)).toEqual({ error: "unauthorized", message: "Unauthorized" });

    routeMocks.isAdminEmail.mockReturnValueOnce(false);
    const adminRes = await POST(makeRequest({ email: "new@vtj.co.jp" }));
    expect(adminRes.status).toBe(403);
    expect(await readJson(adminRes)).toEqual({ error: "forbidden_admin_only" });

    routeMocks.isReadOnlyMode.mockReturnValueOnce(true);
    const readOnlyRes = await POST(makeRequest({ email: "new@vtj.co.jp" }));
    expect(readOnlyRes.status).toBe(403);
    expect(await readJson(readOnlyRes)).toEqual({ error: "read_only_mode" });

    expect(routeMocks.createTeamMember).not.toHaveBeenCalled();
  });

  it("creates a team member and maps store validation errors", async () => {
    const { POST } = await importRoute();

    const okRes = await POST(makeRequest({ email: "new@vtj.co.jp", name: "New Member" }));
    expect(okRes.status).toBe(200);
    expect(okRes.headers.get("cache-control")).toBe("no-store");
    expect(await readJson(okRes)).toEqual({
      member: { email: "new@vtj.co.jp", name: "New Member" },
    });
    expect(routeMocks.createTeamMember).toHaveBeenCalledWith({
      email: "new@vtj.co.jp",
      name: "New Member",
    });

    routeMocks.createTeamMember.mockRejectedValueOnce(new Error("already_exists:new@vtj.co.jp"));
    const duplicateRes = await POST(makeRequest({ email: "new@vtj.co.jp" }));
    expect(duplicateRes.status).toBe(409);
    expect(await readJson(duplicateRes)).toMatchObject({ error: "team_member_already_exists" });

    routeMocks.createTeamMember.mockRejectedValueOnce(new Error("invalid_email"));
    const invalidRes = await POST(makeRequest({ email: 123, name: 456 }));
    expect(invalidRes.status).toBe(400);
    expect(await readJson(invalidRes)).toMatchObject({ error: "failed_to_create_team_member", message: "invalid_email" });
  });

  it("blocks PUT mutations before roster validation when auth, admin, or read-only checks fail", async () => {
    const { PUT } = await importRoute();

    routeMocks.requireUser.mockResolvedValueOnce({
      ok: false,
      status: 403,
      message: "Forbidden",
    });
    const authRes = await PUT(makeRequest({ roster: ["member@vtj.co.jp"] }));
    expect(authRes.status).toBe(403);
    expect(await readJson(authRes)).toEqual({ error: "forbidden", message: "Forbidden" });

    routeMocks.isAdminEmail.mockReturnValueOnce(false);
    const adminRes = await PUT(makeRequest({ roster: ["member@vtj.co.jp"] }));
    expect(adminRes.status).toBe(403);
    expect(await readJson(adminRes)).toEqual({ error: "forbidden_admin_only" });

    routeMocks.isReadOnlyMode.mockReturnValueOnce(true);
    const readOnlyRes = await PUT(makeRequest({ roster: ["member@vtj.co.jp"] }));
    expect(readOnlyRes.status).toBe(403);
    expect(await readJson(readOnlyRes)).toEqual({ error: "read_only_mode" });

    expect(routeMocks.setRoster).not.toHaveBeenCalled();
  });

  it("validates and updates roster through PUT", async () => {
    const { PUT } = await importRoute();

    const invalidRes = await PUT(makeRequest({ roster: "member@vtj.co.jp" }));
    expect(invalidRes.status).toBe(400);
    expect(await readJson(invalidRes)).toEqual({
      error: "invalid_roster_format",
      message: "roster must be an array",
    });

    routeMocks.getRoster.mockResolvedValueOnce(["member@vtj.co.jp"]);
    const okRes = await PUT(makeRequest({ roster: ["member@vtj.co.jp", 1, null, "admin@vtj.co.jp"] }));
    expect(okRes.status).toBe(200);
    expect(okRes.headers.get("cache-control")).toBe("no-store");
    expect(routeMocks.setRoster).toHaveBeenCalledWith(["member@vtj.co.jp", "admin@vtj.co.jp"]);
    expect(await readJson(okRes)).toEqual({ roster: ["member@vtj.co.jp"] });

    routeMocks.setRoster.mockRejectedValueOnce(new Error("store_down"));
    const failedRes = await PUT(makeRequest({ roster: ["member@vtj.co.jp"] }));
    expect(failedRes.status).toBe(400);
    expect(await readJson(failedRes)).toEqual({
      error: "failed_to_update_roster",
      message: "store_down",
    });
  });
});
