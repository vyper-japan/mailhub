import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  store: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    reorder: vi.fn(),
  },
}));

vi.mock("@/lib/require-user", () => ({
  requireUser: routeMocks.requireUser,
  authErrorResponse: (result: { status: number; message: string }) =>
    Response.json({ error: "unauthorized", message: result.message }, { status: result.status }),
}));

vi.mock("@/lib/viewsStore", () => ({
  getViewsStore: () => routeMocks.store,
}));

async function importViewsRoute() {
  vi.resetModules();
  return await import("@/app/api/mailhub/views/route");
}

async function importViewByIdRoute() {
  vi.resetModules();
  return await import("@/app/api/mailhub/views/[id]/route");
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("mailhub views route label validation", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.MAILHUB_TEST_MODE = "0";
    process.env.MAILHUB_ADMINS = "admin@vtj.co.jp";
    routeMocks.requireUser.mockReset().mockResolvedValue({
      ok: true,
      user: { email: "admin@vtj.co.jp", name: "Admin" },
    });
    routeMocks.store.list.mockReset().mockResolvedValue([]);
    routeMocks.store.create.mockReset().mockImplementation(async (input: Record<string, unknown>) => ({
      ...input,
      id: input.id ?? "created",
      createdAt: "2026-01-01T00:00:00.000Z",
    }));
    routeMocks.store.update.mockReset().mockImplementation(async (id: string, input: Record<string, unknown>) => ({
      id,
      name: "Updated",
      labelId: "todo",
      pinned: false,
      order: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      ...input,
    }));
    routeMocks.store.delete.mockReset().mockResolvedValue(undefined);
    routeMocks.store.reorder.mockReset().mockResolvedValue(undefined);
  });

  it("rejects invalid production label ids on create instead of saving an all-fallback view", async () => {
    const { POST } = await importViewsRoute();

    const res = await POST(
      new Request("http://localhost/api/mailhub/views", {
        method: "POST",
        body: JSON.stringify({ name: "Old test store", labelId: "store-a", pinned: false }),
      }),
    );

    expect(res.status).toBe(400);
    expect(await readJson(res)).toMatchObject({ error: "failed_to_create_view" });
    expect(routeMocks.store.create).not.toHaveBeenCalled();
  });

  it("allows valid aggregate store view labels", async () => {
    const { POST } = await importViewsRoute();

    const res = await POST(
      new Request("http://localhost/api/mailhub/views", {
        method: "POST",
        body: JSON.stringify({ name: "Stores", labelId: "stores", pinned: false }),
      }),
    );

    expect(res.status).toBe(200);
    expect(routeMocks.store.create).toHaveBeenCalledWith(
      expect.objectContaining({ labelId: "stores" }),
    );
  });

  it("rejects invalid production label ids on update", async () => {
    const { PATCH } = await importViewByIdRoute();

    const res = await PATCH(
      new Request("http://localhost/api/mailhub/views/view-1", {
        method: "PATCH",
        body: JSON.stringify({ labelId: "store-a" }),
      }),
      { params: Promise.resolve({ id: "view-1" }) },
    );

    expect(res.status).toBe(400);
    expect(await readJson(res)).toMatchObject({ error: "failed_to_update_view" });
    expect(routeMocks.store.update).not.toHaveBeenCalled();
  });
});
