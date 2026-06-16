import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getMessageAttachment: vi.fn(),
}));

vi.mock("@/lib/require-user", () => ({
  requireUser: routeMocks.requireUser,
  authErrorResponse: (result: { status: number; message: string }) =>
    Response.json({ error: "unauthorized", message: result.message }, { status: result.status }),
}));

vi.mock("@/lib/gmail", () => ({
  getMessageAttachment: routeMocks.getMessageAttachment,
}));

vi.mock("@/lib/gmail-error", () => ({
  parseGmailError: (error: unknown) => ({
    error_code: "gmail_error",
    httpStatus: 500,
    message: error instanceof Error ? error.message : "gmail_error",
    debug: null,
  }),
}));

async function importGet() {
  vi.resetModules();
  const mod = await import("@/app/api/mailhub/attachment/route");
  return mod.GET;
}

describe("mailhub attachment route", () => {
  beforeEach(() => {
    routeMocks.requireUser.mockReset().mockResolvedValue({
      ok: true,
      user: { email: "test@vtj.co.jp", name: "Test" },
    });
    routeMocks.getMessageAttachment.mockReset().mockResolvedValue({
      data: Buffer.from("attachment body"),
      filename: "注文確認.html",
      mimeType: "text/html; charset=utf-8",
      size: 15,
    });
  });

  it("requires messageId and attachmentId", async () => {
    const GET = await importGet();

    const res = await GET(new Request("http://localhost/api/mailhub/attachment?messageId=msg-001"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing_attachment_params" });
    expect(routeMocks.getMessageAttachment).not.toHaveBeenCalled();
  });

  it("allows safe PDF inline responses with hardening headers", async () => {
    routeMocks.getMessageAttachment.mockResolvedValueOnce({
      data: Buffer.from("%PDF-test"),
      filename: "invoice.pdf",
      mimeType: "application/pdf",
      size: 9,
    });
    const GET = await importGet();

    const res = await GET(
      new Request(
        "http://localhost/api/mailhub/attachment?messageId=msg-001&attachmentId=att-001&disposition=inline",
      ),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("inline;");
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
  });

  it("forces unsafe inline mime types to download", async () => {
    const GET = await importGet();

    const res = await GET(
      new Request(
        "http://localhost/api/mailhub/attachment?messageId=msg-001&attachmentId=att-html&disposition=inline",
      ),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment;");
    expect(res.headers.get("content-disposition")).toContain("filename=\"attachment.html\"");
    expect(res.headers.get("content-type")).toBe("text/html");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
  });
});
