import { describe, expect, it } from "vitest";
import { buildBrainDecision } from "@/lib/brainDecision";
import type { MessageDetail } from "@/lib/mailhub-types";

function message(overrides: Partial<MessageDetail>): MessageDetail {
  return {
    id: "m-1",
    threadId: "t-1",
    subject: "Test",
    from: "customer@example.com",
    messageId: "<m-1@example.com>",
    receivedAt: "2026-06-17T00:00:00.000Z",
    snippet: "Test snippet",
    gmailLink: "https://mail.google.com/mail/u/0/#inbox/m-1",
    plainTextBody: "Test body",
    htmlBody: null,
    bodySource: "plain",
    bodyNotice: null,
    attachments: [],
    assigneeSlug: null,
    userLabels: [],
    snoozeUntil: null,
    to: null,
    cc: null,
    bcc: null,
    replyTo: null,
    deliveredTo: [],
    xOriginalTo: null,
    references: null,
    inReplyTo: null,
    listId: null,
    listPost: null,
    ...overrides,
  };
}

describe("buildBrainDecision", () => {
  it("marks invoice-like messages as document work and not discard candidates", () => {
    const decision = buildBrainDecision({
      message: message({
        subject: "6月分 請求書を送付します",
        snippet: "添付をご確認ください",
        attachments: [{ id: "a1", filename: "invoice.pdf", mimeType: "application/pdf", size: 1000 }],
      }),
      channelId: "stores",
      testMode: false,
      now: new Date("2026-06-17T00:00:00.000Z"),
    });

    expect(decision).toMatchObject({
      source: "deterministic_v1",
      purpose: "invoice",
      disposition: "save_document",
      discardCandidate: false,
      humanRequired: true,
      draftNeeded: false,
      confidence: "high",
    });
    expect(decision.evidence).toContainEqual({ source: "classification", label: "subject", detail: "請求書" });
    expect(decision.warnings).toContain("protected_invoice");
  });

  it("keeps noise-like messages as human-reviewed candidates only", () => {
    const decision = buildBrainDecision({
      message: message({
        subject: "Weekly newsletter",
        from: "no-reply@example.com",
        snippet: "unsubscribe here",
      }),
      channelId: "stores",
      testMode: false,
      now: new Date("2026-06-17T00:00:00.000Z"),
    });

    expect(decision).toMatchObject({
      purpose: "noise",
      disposition: "noise_candidate",
      discardCandidate: true,
      humanRequired: true,
      draftNeeded: false,
    });
    expect(decision.warnings).toEqual(expect.arrayContaining(["suggestion_only", "no_auto_discard_without_human_review"]));
  });

  it("detects Rakuten route when channel and message indicate RMS work", () => {
    const decision = buildBrainDecision({
      message: message({
        subject: "【楽天RMS】お問い合わせが届きました",
        from: "楽天市場 <rms@rakuten.co.jp>",
        plainTextBody: "問い合わせ番号: 12345678\n質問があります",
      }),
      channelId: "cricut-rakuten",
      testMode: false,
      now: new Date("2026-06-17T00:00:00.000Z"),
    });

    expect(decision).toMatchObject({
      purpose: "inquiry",
      disposition: "external_route",
      replyRoute: "rakuten_rms",
      draftNeeded: true,
      discardCandidate: false,
    });
    expect(decision.evidence).toContainEqual({
      source: "reply_route",
      label: "rakuten_rms",
      detail: "楽天RMS / 12345678",
    });
  });
});
