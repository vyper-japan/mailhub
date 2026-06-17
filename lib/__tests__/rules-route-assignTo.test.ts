import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  isAdminEmail: vi.fn(),
  isReadOnlyMode: vi.fn(),
  writeForbiddenResponse: vi.fn(),
  getRules: vi.fn(),
  upsertRule: vi.fn(),
  deleteRule: vi.fn(),
  listLabels: vi.fn(),
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
  writeForbiddenResponse: routeMocks.writeForbiddenResponse,
}));

vi.mock("@/lib/audit-log", () => ({
  logAction: routeMocks.logAction,
}));

vi.mock("@/lib/labelRulesStore", () => ({
  getLabelRulesStore: () => ({
    getRules: routeMocks.getRules,
    upsertRule: routeMocks.upsertRule,
    deleteRule: routeMocks.deleteRule,
  }),
}));

vi.mock("@/lib/labelRegistryStore", () => ({
  getLabelRegistryStore: () => ({
    list: routeMocks.listLabels,
  }),
}));

function request(body: unknown): Request {
  return new Request("http://localhost/api/mailhub/rules", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("rules routes assignTo persistence", () => {
  beforeEach(() => {
    vi.resetModules();
    routeMocks.requireUser.mockReset().mockResolvedValue({
      ok: true,
      user: { email: "admin@vtj.co.jp", name: "Admin" },
    });
    routeMocks.isAdminEmail.mockReset().mockReturnValue(true);
    routeMocks.isReadOnlyMode.mockReset().mockReturnValue(false);
    routeMocks.writeForbiddenResponse.mockReset().mockReturnValue(
      Response.json({ error: "read_only", reason: "rules_write" }, { status: 403 }),
    );
    routeMocks.getRules.mockReset();
    routeMocks.upsertRule.mockReset().mockImplementation(async (input) => ({
      ...input,
      id: input.id ?? "new-rule",
      createdAt: "2026-01-01T00:00:00.000Z",
    }));
    routeMocks.deleteRule.mockReset();
    routeMocks.listLabels.mockReset().mockResolvedValue([
      { labelName: "MailHub/Label/VIP", displayName: "VIP" },
    ]);
    routeMocks.logAction.mockReset().mockResolvedValue(undefined);
  });

  it("normalizes assignTo on rule create", async () => {
    const { POST } = await import("@/app/api/mailhub/rules/route");

    const res = await POST(request({
      labelNames: ["MailHub/Label/VIP"],
      match: { fromEmail: "sender@example.com" },
      assignTo: { assigneeEmail: " Owner@VTJ.CO.JP " },
    }));

    expect(res.status).toBe(200);
    expect(routeMocks.upsertRule).toHaveBeenCalledWith(expect.objectContaining({
      assignTo: { assigneeEmail: "owner@vtj.co.jp" },
    }));
  });

  it("returns current rules on GET", async () => {
    routeMocks.getRules.mockResolvedValue([
      {
        id: "rule-1",
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        match: { fromEmail: "sender@example.com" },
        labelNames: ["MailHub/Label/VIP"],
        assignTo: "me",
      },
    ]);
    const { GET } = await import("@/app/api/mailhub/rules/route");

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({
      rules: [{ id: "rule-1", assignTo: "me" }],
    });
  });

  it("rejects non-admin rule create before writing", async () => {
    routeMocks.isAdminEmail.mockReturnValue(false);
    const { POST } = await import("@/app/api/mailhub/rules/route");

    const res = await POST(request({
      labelNames: ["MailHub/Label/VIP"],
      match: { fromEmail: "sender@example.com" },
    }));

    expect(res.status).toBe(403);
    expect(await readJson(res)).toEqual({ error: "forbidden_admin_only" });
    expect(routeMocks.upsertRule).not.toHaveBeenCalled();
  });

  it("rejects readonly rule create before validating labels", async () => {
    routeMocks.isReadOnlyMode.mockReturnValue(true);
    const { POST } = await import("@/app/api/mailhub/rules/route");

    const res = await POST(request({
      labelNames: ["MailHub/Label/Missing"],
      match: { fromEmail: "sender@example.com" },
    }));

    expect(res.status).toBe(403);
    expect(await readJson(res)).toEqual({ error: "read_only", reason: "rules_write" });
    expect(routeMocks.listLabels).not.toHaveBeenCalled();
  });

  it("rejects create with missing label, missing match, or unregistered label", async () => {
    const { POST } = await import("@/app/api/mailhub/rules/route");

    const missingLabel = await POST(request({ match: { fromEmail: "sender@example.com" } }));
    expect(missingLabel.status).toBe(400);
    expect(await readJson(missingLabel)).toEqual({ error: "missing_labelName" });

    const missingMatch = await POST(request({ labelNames: ["MailHub/Label/VIP"] }));
    expect(missingMatch.status).toBe(400);
    expect(await readJson(missingMatch)).toEqual({ error: "missing_match" });

    const unregistered = await POST(request({
      labelNames: ["MailHub/Label/Missing"],
      match: { fromDomain: "@example.com" },
    }));
    expect(unregistered.status).toBe(400);
    expect(await readJson(unregistered)).toEqual({
      error: "label_not_registered",
      labelName: "MailHub/Label/Missing",
    });
  });

  it("records suggestion metadata best-effort on create", async () => {
    const { POST } = await import("@/app/api/mailhub/rules/route");

    const res = await POST(request({
      labelName: "MailHub/Label/VIP",
      match: { fromDomain: "example.com" },
      suggestionId: "sug-1",
      suggestionType: "auto_assign",
      assignTo: "me",
    }));

    expect(res.status).toBe(200);
    expect(routeMocks.upsertRule).toHaveBeenCalledWith(expect.objectContaining({
      labelNames: ["MailHub/Label/VIP"],
      match: { fromDomain: "example.com" },
      assignTo: "me",
    }));
    expect(routeMocks.logAction).toHaveBeenCalledWith(expect.objectContaining({
      action: "suggestion_apply",
      metadata: { suggestionId: "sug-1", type: "auto_assign" },
    }));
  });

  it("preserves existing assignTo when patching labels or enabled state", async () => {
    routeMocks.getRules.mockResolvedValue([
      {
        id: "rule-1",
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        match: { fromEmail: "sender@example.com" },
        labelNames: ["MailHub/Label/VIP"],
        assignTo: { assigneeEmail: "owner@vtj.co.jp" },
      },
    ]);
    const { PATCH } = await import("@/app/api/mailhub/rules/[id]/route");

    const res = await PATCH(request({ enabled: false }), { params: Promise.resolve({ id: "rule-1" }) });

    expect(res.status).toBe(200);
    expect(routeMocks.upsertRule).toHaveBeenCalledWith(expect.objectContaining({
      id: "rule-1",
      enabled: false,
      assignTo: { assigneeEmail: "owner@vtj.co.jp" },
    }));
  });

  it("rejects patch when the rule does not exist", async () => {
    routeMocks.getRules.mockResolvedValue([]);
    const { PATCH } = await import("@/app/api/mailhub/rules/[id]/route");

    const res = await PATCH(request({ enabled: false }), { params: Promise.resolve({ id: "missing" }) });

    expect(res.status).toBe(404);
    expect(await readJson(res)).toEqual({ error: "not_found" });
    expect(routeMocks.upsertRule).not.toHaveBeenCalled();
  });

  it("rejects patch to an unregistered label", async () => {
    routeMocks.getRules.mockResolvedValue([
      {
        id: "rule-1",
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        match: { fromEmail: "sender@example.com" },
        labelNames: ["MailHub/Label/VIP"],
      },
    ]);
    const { PATCH } = await import("@/app/api/mailhub/rules/[id]/route");

    const res = await PATCH(request({ labelNames: ["MailHub/Label/Missing"] }), {
      params: Promise.resolve({ id: "rule-1" }),
    });

    expect(res.status).toBe(400);
    expect(await readJson(res)).toEqual({
      error: "label_not_registered",
      labelName: "MailHub/Label/Missing",
    });
  });

  it("clears assignTo only when patch explicitly sends assignTo null", async () => {
    routeMocks.getRules.mockResolvedValue([
      {
        id: "rule-1",
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        match: { fromEmail: "sender@example.com" },
        labelNames: ["MailHub/Label/VIP"],
        assignTo: "me",
      },
    ]);
    const { PATCH } = await import("@/app/api/mailhub/rules/[id]/route");

    const res = await PATCH(request({ assignTo: null }), { params: Promise.resolve({ id: "rule-1" }) });

    expect(res.status).toBe(200);
    expect(routeMocks.upsertRule).toHaveBeenCalledWith(expect.objectContaining({
      id: "rule-1",
      assignTo: undefined,
    }));
    expect(await readJson(res)).toMatchObject({ rule: { id: "rule-1" } });
  });

  it("deletes rules through collection and item routes", async () => {
    const collectionRoute = await import("@/app/api/mailhub/rules/route");
    const itemRoute = await import("@/app/api/mailhub/rules/[id]/route");

    const missingCollectionId = await collectionRoute.DELETE(new Request("http://localhost/api/mailhub/rules"));
    expect(missingCollectionId.status).toBe(400);
    expect(await readJson(missingCollectionId)).toEqual({ error: "missing_id" });

    const collectionDelete = await collectionRoute.DELETE(
      new Request("http://localhost/api/mailhub/rules?id=rule-collection"),
    );
    expect(collectionDelete.status).toBe(200);

    const itemDelete = await itemRoute.DELETE(new Request("http://localhost/api/mailhub/rules/rule-item"), {
      params: Promise.resolve({ id: "rule-item" }),
    });
    expect(itemDelete.status).toBe(200);

    expect(routeMocks.deleteRule).toHaveBeenCalledWith("rule-collection");
    expect(routeMocks.deleteRule).toHaveBeenCalledWith("rule-item");
  });
});
