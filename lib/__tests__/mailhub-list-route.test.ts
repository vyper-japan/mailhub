import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  listLatestInboxMessages: vi.fn(),
  isTestMode: vi.fn(),
}));

vi.mock("@/lib/require-user", () => ({
  requireUser: routeMocks.requireUser,
  authErrorResponse: (result: { status: number; message: string }) =>
    Response.json({ error: "unauthorized", message: result.message }, { status: result.status }),
}));

vi.mock("@/lib/gmail", () => ({
  listLatestInboxMessages: routeMocks.listLatestInboxMessages,
}));

vi.mock("@/lib/test-mode", () => ({
  isTestMode: routeMocks.isTestMode,
}));

async function importGet() {
  vi.resetModules();
  const mod = await import("@/app/api/mailhub/list/route");
  return mod.GET;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("mailhub list route label mode", () => {
  beforeEach(() => {
    routeMocks.requireUser.mockReset().mockResolvedValue({
      ok: true,
      user: { email: "test@vtj.co.jp", name: "Test" },
    });
    routeMocks.listLatestInboxMessages.mockReset().mockResolvedValue({
      messages: [],
      nextPageToken: undefined,
    });
    routeMocks.isTestMode.mockReset().mockReturnValue(false);
  });

  it("uses the PROD Cricut Rakuten query when test mode is off", async () => {
    const GET = await importGet();

    const res = await GET(new Request("http://localhost/api/mailhub/list?label=cricut-rakuten"));

    expect(res.status).toBe(200);
    expect(routeMocks.listLatestInboxMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        labelIds: [],
        q: "(deliveredto:cricut_r@vtj.co.jp OR to:cricut_r@vtj.co.jp OR cc:cricut_r@vtj.co.jp)",
      }),
    );
    expect(await readJson(res)).toMatchObject({ label: "cricut-rakuten" });
  });

  it("uses the aggregate stores query for all known store addresses", async () => {
    const GET = await importGet();

    const res = await GET(new Request("http://localhost/api/mailhub/list?label=stores"));

    expect(res.status).toBe(200);
    expect(routeMocks.listLatestInboxMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        labelIds: [],
        q: expect.stringContaining("deliveredto:cricut_r@vtj.co.jp"),
      }),
    );
    expect(routeMocks.listLatestInboxMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        q: expect.stringContaining("deliveredto:gopro_order_yahoo@vtj.co.jp"),
      }),
    );
    expect(routeMocks.listLatestInboxMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        q: expect.stringContaining("deliveredto:ebay@vtj.co.jp"),
      }),
    );
    expect(await readJson(res)).toMatchObject({ label: "stores" });
  });

  it("falls back to all when TEST store-a is requested in PROD mode", async () => {
    const GET = await importGet();

    const res = await GET(new Request("http://localhost/api/mailhub/list?label=store-a"));

    expect(res.status).toBe(200);
    expect(routeMocks.listLatestInboxMessages).toHaveBeenCalledWith(
      expect.objectContaining({ q: undefined }),
    );
    expect(await readJson(res)).toMatchObject({ label: "all" });
  });

  it("uses the TEST store-a fixture query when test mode is on", async () => {
    routeMocks.isTestMode.mockReturnValue(true);
    const GET = await importGet();

    const res = await GET(new Request("http://localhost/api/mailhub/list?label=store-a"));

    expect(res.status).toBe(200);
    expect(routeMocks.listLatestInboxMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "(deliveredto:shop-a@vtj.co.jp OR to:shop-a@vtj.co.jp OR cc:shop-a@vtj.co.jp)",
      }),
    );
    expect(await readJson(res)).toMatchObject({ label: "store-a" });
  });
});
