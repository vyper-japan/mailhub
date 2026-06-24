import { describe, expect, it } from "vitest";
import { buildAiDraftSuggestion } from "@/lib/aiDraftSuggestion";
import type { ChannelDef } from "@/lib/channels";
import type { MessageDetail } from "@/lib/mailhub-types";

const gmailChannels: ChannelDef[] = [
  {
    id: "vyper-amazon",
    label: "VYPER Amazon",
    addresses: ["support@vtj.co.jp"],
    replyKind: "gmail",
  },
];

function message(overrides: Partial<MessageDetail> = {}): MessageDetail {
  return {
    id: "m-draft",
    threadId: "t-draft",
    subject: "お問い合わせ: 商品について",
    from: "customer@example.com",
    messageId: "<m-draft@example.com>",
    receivedAt: "2026-06-24T00:00:00.000Z",
    snippet: "質問があります UNIQUE_SNIPPET_SHOULD_NOT_LEAK",
    gmailLink: "https://mail.google.com/mail/u/0/#inbox/m-draft",
    plainTextBody: "商品について質問があります UNIQUE_BODY_SHOULD_NOT_LEAK",
    htmlBody: null,
    bodySource: "plain",
    bodyNotice: null,
    attachments: [],
    assigneeSlug: null,
    userLabels: [],
    snoozeUntil: null,
    to: "support@vtj.co.jp",
    cc: null,
    bcc: null,
    replyTo: null,
    deliveredTo: ["support@vtj.co.jp"],
    xOriginalTo: null,
    references: null,
    inReplyTo: null,
    listId: null,
    listPost: null,
    ...overrides,
  };
}

describe("buildAiDraftSuggestion", () => {
  it("returns a deterministic Gmail skeleton without leaking the original body or snippet", () => {
    const input = message();
    const first = buildAiDraftSuggestion({
      message: input,
      channelId: "vyper-amazon",
      testMode: false,
      channels: gmailChannels,
      sharedInboxEmail: "mailhub@vtj.co.jp",
    });
    const second = buildAiDraftSuggestion({
      message: input,
      channelId: "vyper-amazon",
      testMode: false,
      channels: gmailChannels,
      sharedInboxEmail: "mailhub@vtj.co.jp",
    });

    expect(first.status).toBe("ready");
    expect(second).toEqual(first);
    if (first.status !== "ready") throw new Error("expected ready draft");
    expect(first.suggestion).toMatchObject({
      source: "deterministic_draft_v1",
      route: "gmail",
      requiresHumanReview: true,
      unresolvedVars: [],
    });
    expect(first.suggestion.body).toContain("ご連絡ありがとうございます。");
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain("UNIQUE_BODY_SHOULD_NOT_LEAK");
    expect(serialized).not.toContain("UNIQUE_SNIPPET_SHOULD_NOT_LEAK");
  });

  it("does not draft invoice or noise messages", () => {
    const invoice = buildAiDraftSuggestion({
      message: message({
        subject: "6月分 請求書を送付します",
        snippet: "添付をご確認ください",
        attachments: [{ id: "a1", filename: "invoice.pdf", mimeType: "application/pdf", size: 1000 }],
      }),
      channelId: "vyper-amazon",
      testMode: false,
      channels: gmailChannels,
    });
    const noise = buildAiDraftSuggestion({
      message: message({
        subject: "Weekly newsletter",
        from: "no-reply@example.com",
        snippet: "unsubscribe here",
        plainTextBody: "unsubscribe from this newsletter",
      }),
      channelId: "vyper-amazon",
      testMode: false,
      channels: gmailChannels,
    });

    expect(invoice).toMatchObject({ status: "not_needed", suggestion: null, blockedReason: "purpose_invoice" });
    expect(noise).toMatchObject({ status: "not_needed", suggestion: null, blockedReason: "purpose_noise" });
  });

  it("blocks Rakuten and unsafe Gmail reply contexts", () => {
    const rakuten = buildAiDraftSuggestion({
      message: message({
        subject: "【楽天RMS】お問い合わせが届きました",
        from: "楽天市場 <rms@rakuten.co.jp>",
        plainTextBody: "問い合わせ番号: 12345678\n質問があります",
      }),
      channelId: "cricut-rakuten",
      testMode: false,
      channels: gmailChannels,
    });
    const internalReply = buildAiDraftSuggestion({
      message: message({
        from: "staff@vtj.co.jp",
      }),
      channelId: "vyper-amazon",
      testMode: false,
      channels: gmailChannels,
    });

    expect(rakuten).toMatchObject({ status: "blocked", suggestion: null, blockedReason: "reply_route_rakuten_rms" });
    expect(internalReply).toMatchObject({ status: "blocked", suggestion: null, blockedReason: "gmail_reply_to_internal_blocked" });
  });
});
