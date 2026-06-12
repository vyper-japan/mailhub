import { describe, expect, it } from "vitest";
import { buildReplyMime } from "@/lib/mailhub-send-mime";

function decodeRaw(raw: string): string {
  return Buffer.from(raw, "base64url").toString("utf8");
}

function bodyPart(rfc822: string): string {
  return rfc822.split(/\r\n\r\n/).at(-1) ?? "";
}

describe("mailhub-send-mime", () => {
  it("encodes Japanese Subject and From display name with RFC2047", async () => {
    const result = await buildReplyMime({
      fromAlias: "vyper_sc@vtj.co.jp",
      fromDisplayName: "日本語担当",
      to: "customer@example.com",
      originalSubject: "注文について",
      bodyText: "返信本文",
      threadId: "thread-001",
      originalMessageId: "<original@example.com>",
      originalReferences: [],
      date: new Date("2026-06-12T00:00:00.000Z"),
    });

    expect(result.subject).toBe("Re: 注文について");
    expect(result.rfc822).toContain("Subject: =?UTF-8?");
    expect(result.rfc822).toContain("From: =?UTF-8?");
    expect(result.headers.from).toContain("<vyper_sc@vtj.co.jp>");
  });

  it("preserves an existing Re: prefix", async () => {
    const result = await buildReplyMime({
      fromAlias: "support@vtj.co.jp",
      fromDisplayName: "Support",
      to: "customer@example.com",
      originalSubject: " re : Existing",
      bodyText: "Reply",
      threadId: "thread-001",
      originalMessageId: "<original@example.com>",
      originalReferences: [],
    });

    expect(result.subject).toBe("re : Existing");
  });

  it("sets In-Reply-To and deduplicated References in original order", async () => {
    const result = await buildReplyMime({
      fromAlias: "support@vtj.co.jp",
      fromDisplayName: "Support",
      to: "customer@example.com",
      originalSubject: "Question",
      bodyText: "Reply",
      threadId: "thread-001",
      originalMessageId: "<b@example.com>",
      originalReferences: ["<a@example.com>", "<b@example.com>", "<a@example.com>"],
    });

    expect(result.headers.inReplyTo).toBe("<b@example.com>");
    expect(result.headers.references).toBe("<a@example.com> <b@example.com>");
    expect(result.rfc822).toContain("In-Reply-To: <b@example.com>");
    expect(result.rfc822).toContain("References: <a@example.com> <b@example.com>");
  });

  it("normalizes body CRLF, base64-encodes text, and emits base64url raw", async () => {
    const result = await buildReplyMime({
      fromAlias: "support@vtj.co.jp",
      fromDisplayName: "Support",
      to: "customer@example.com",
      originalSubject: null,
      bodyText: "line1\rline2\nline3\r\nline4",
      threadId: "thread-001",
      originalMessageId: "<original@example.com>",
      originalReferences: [],
    });

    expect(result.subject).toBe("Re: (no subject)");
    expect(result.raw).not.toMatch(/[+/=]/);
    expect(decodeRaw(result.raw)).toBe(result.rfc822);
    expect(result.rfc822).toContain("Content-Transfer-Encoding: base64");
    expect(Buffer.from(bodyPart(result.rfc822), "base64").toString("utf8")).toBe(
      "line1\r\nline2\r\nline3\r\nline4",
    );
  });
});
