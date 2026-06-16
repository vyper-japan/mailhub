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
        q: "(deliveredto:cricut_r@vtj.co.jp OR to:cricut_r@vtj.co.jp OR cc:cricut_r@vtj.co.jp)",
      }),
    );
    expect(routeMocks.listLatestInboxMessages.mock.calls[0]?.[0].labelIds).toBeUndefined();
    expect(await readJson(res)).toMatchObject({ label: "cricut-rakuten" });
  });

  it("uses the aggregate stores query for all known store addresses", async () => {
    const GET = await importGet();

    const res = await GET(new Request("http://localhost/api/mailhub/list?label=stores"));

    expect(res.status).toBe(200);
    expect(routeMocks.listLatestInboxMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        q: expect.stringContaining("deliveredto:cricut_r@vtj.co.jp"),
      }),
    );
    expect(routeMocks.listLatestInboxMessages.mock.calls[0]?.[0].labelIds).toBeUndefined();
    expect(routeMocks.listLatestInboxMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        q: expect.stringContaining("deliveredto:gopro_order_yahoo@vtj.co.jp"),
      }),
    );
    expect(routeMocks.listLatestInboxMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        q: expect.stringContaining("deliveredto:ams_vyper@vtj.co.jp"),
      }),
    );
    expect(routeMocks.listLatestInboxMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        q: expect.stringContaining("from:datacolor_shopify@vtj.co.jp"),
      }),
    );
    expect(routeMocks.listLatestInboxMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        q: expect.stringContaining("deliveredto:ebay@vtj.co.jp"),
      }),
    );
    expect(await readJson(res)).toMatchObject({
      label: "stores",
      meta: {
        loadedCount: 0,
        max: 20,
        hasMore: false,
        pageTokenApplied: false,
        sourceScope: {
          isAggregate: true,
          sourceAddresses: expect.arrayContaining(["cricut_r@vtj.co.jp", "ams_vyper@vtj.co.jp", "ebay@vtj.co.jp"]),
        },
      },
    });
  });

  it("returns pagination metadata without exposing the Gmail page token", async () => {
    routeMocks.listLatestInboxMessages.mockResolvedValueOnce({
      messages: [{ id: "m1" }],
      nextPageToken: "secret-next-token",
    });
    const GET = await importGet();

    const res = await GET(new Request("http://localhost/api/mailhub/list?label=cricut-rakuten&max=50&pageToken=secret-current-token"));
    const json = await readJson(res);

    expect(json).toMatchObject({
      label: "cricut-rakuten",
      nextPageToken: "secret-next-token",
      meta: {
        loadedCount: 1,
        max: 50,
        hasMore: true,
        pageTokenApplied: true,
        sourceScope: {
          isAggregate: false,
          sourceAddresses: ["cricut_r@vtj.co.jp"],
        },
      },
    });
    expect(JSON.stringify(json.meta)).not.toContain("secret-current-token");
    expect(JSON.stringify(json.meta)).not.toContain("secret-next-token");
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
