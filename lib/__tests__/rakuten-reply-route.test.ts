import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const routeMocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  isReadOnlyMode: vi.fn(),
  writeForbiddenResponse: vi.fn(),
  logAction: vi.fn(),
}));

vi.mock("@/lib/require-user", () => ({
  requireUser: routeMocks.requireUser,
}));

vi.mock("@/lib/read-only", () => ({
  isReadOnlyMode: routeMocks.isReadOnlyMode,
  writeForbiddenResponse: routeMocks.writeForbiddenResponse,
}));

vi.mock("@/lib/audit-log", () => ({
  logAction: routeMocks.logAction,
}));

async function importPost() {
  vi.resetModules();
  const mod = await import("@/app/api/mailhub/rakuten/reply/route");
  return mod.POST;
}

function makeRequest(storeId: string, overrides: Partial<{
  inquiryNumber: string;
  message: string;
  emailId: string;
}> = {}): NextRequest {
  return new NextRequest("http://localhost/api/mailhub/rakuten/reply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      storeId,
      inquiryNumber: "12345678",
      message: "返信本文",
      emailId: "msg-1",
      ...overrides,
    }),
  });
}

function makeRawRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/mailhub/rakuten/reply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function setRmsCredentials(prefix: string) {
  process.env[`${prefix}_SHOP_ID`] = "shop-id";
  process.env[`${prefix}_SERVICE_SECRET`] = "test-service-value";
  process.env[`${prefix}_LICENSE_KEY`] = "license-key";
}

function clearRmsCredentials() {
  for (const prefix of [
    "RMS_STORE_A",
    "RMS_STORE_B",
    "RMS_STORE_C",
    "RMS_CRICUT_RAKUTEN",
    "RMS_GOPRO_RAKUTEN",
    "RMS_VYPERGLOBAL_RAKUTEN",
  ]) {
    delete process.env[`${prefix}_SHOP_ID`];
    delete process.env[`${prefix}_SERVICE_SECRET`];
    delete process.env[`${prefix}_LICENSE_KEY`];
  }
}

describe("rakuten reply route RMS env prefix", () => {
  beforeEach(() => {
    routeMocks.requireUser.mockReset().mockResolvedValue({
      ok: true,
      user: { email: "test@vtj.co.jp", name: "Test" },
    });
    routeMocks.isReadOnlyMode.mockReset().mockReturnValue(false);
    routeMocks.writeForbiddenResponse.mockReset().mockReturnValue(
      Response.json({ error: "read_only", reason: "rakuten_reply" }, { status: 403 }),
    );
    routeMocks.logAction.mockReset().mockResolvedValue(undefined);
    delete process.env.MAILHUB_TEST_MODE;
    clearRmsCredentials();
  });

  it.each([
    ["cricut-rakuten", "RMS_STORE_A"],
    ["gopro-rakuten", "RMS_STORE_B"],
    ["vyperglobal-rakuten", "RMS_STORE_C"],
  ])("uses %s mapped credentials from %s", async (storeId, prefix) => {
    setRmsCredentials(prefix);
    const POST = await importPost();

    const res = await POST(makeRequest(storeId));

    expect(res.status).toBe(501);
    expect(await readJson(res)).toEqual({
      ok: false,
      error: "rms_api_not_implemented",
      message: "RMS API direct send is not implemented. Open RMS and complete the reply manually.",
      fallback: true,
    });
    expect(routeMocks.logAction).not.toHaveBeenCalled();
  });

  it("does not derive credentials from the hyphenated channel id", async () => {
    setRmsCredentials("RMS_VYPERGLOBAL_RAKUTEN");
    const POST = await importPost();

    const res = await POST(makeRequest("vyperglobal-rakuten"));

    expect(res.status).toBe(400);
    expect(await readJson(res)).toEqual({
      ok: false,
      error: "RMS API credentials not configured for vyperglobal-rakuten",
      fallback: true,
    });
  });

  it("returns validation error before env lookup when required fields are missing", async () => {
    const POST = await importPost();

    const res = await POST(makeRawRequest({
      storeId: "cricut-rakuten",
      inquiryNumber: "",
      message: "返信本文",
    }));

    expect(res.status).toBe(400);
    expect(await readJson(res)).toEqual({
      ok: false,
      error: "storeId, inquiryNumber, message are required",
    });
    expect(routeMocks.logAction).not.toHaveBeenCalled();
  });

  it("returns fallback for non-Rakuten channels without an RMS env prefix", async () => {
    setRmsCredentials("RMS_STORE_A");
    const POST = await importPost();

    const res = await POST(makeRequest("cricut-yahoo"));

    expect(res.status).toBe(400);
    expect(await readJson(res)).toEqual({
      ok: false,
      error: "RMS API credentials not configured for cricut-yahoo",
      fallback: true,
    });
    expect(routeMocks.logAction).not.toHaveBeenCalled();
  });

  it("does not use TEST store-a prefix in PROD even when RMS_STORE_A credentials exist", async () => {
    setRmsCredentials("RMS_STORE_A");
    const POST = await importPost();

    const res = await POST(makeRequest("store-a"));

    expect(res.status).toBe(400);
    expect(await readJson(res)).toEqual({
      ok: false,
      error: "RMS API credentials not configured for store-a",
      fallback: true,
    });
    expect(routeMocks.logAction).not.toHaveBeenCalled();
  });

  it("short-circuits in MAILHUB_TEST_MODE and logs without requiring RMS credentials", async () => {
    vi.stubEnv("MAILHUB_TEST_MODE", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const POST = await importPost();

    const res = await POST(makeRequest("cricut-rakuten", { emailId: "" }));

    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ ok: true });
    expect(routeMocks.logAction).toHaveBeenCalledWith(expect.objectContaining({
      actorEmail: "test@vtj.co.jp",
      action: "rakutenReply",
      messageId: "unknown",
      metadata: { storeId: "cricut-rakuten", inquiryNumber: "12345678" },
    }));
    logSpy.mockRestore();
  });
});
