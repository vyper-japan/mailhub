import { describe, expect, it } from "vitest";
import { getSendResolverChannels, resolveReplyContext } from "@/lib/mailhub-send-resolver";
import type { MessageDetail } from "@/lib/mailhub-types";

function createDetail(overrides: Partial<MessageDetail> = {}): MessageDetail {
  return {
    id: "msg-001",
    threadId: "thread-001",
    subject: "Original subject",
    from: "Customer <customer@example.com>",
    messageId: "<original@example.com>",
    receivedAt: "2026/06/12 10:00:00",
    snippet: "snippet",
    gmailLink: "https://mail.google.com/mail/u/0/#inbox/msg-001",
    plainTextBody: "body",
    htmlBody: null,
    bodySource: "plain",
    bodyNotice: null,
    assigneeSlug: null,
    to: null,
    cc: null,
    bcc: null,
    replyTo: null,
    deliveredTo: ["mailhub@vtj.co.jp", "vyper_sc@vtj.co.jp"],
    xOriginalTo: null,
    references: "<root@example.com>",
    inReplyTo: null,
    listId: null,
    listPost: null,
    ...overrides,
  };
}

const channels = getSendResolverChannels(true);

describe("resolveReplyContext", () => {
  it("resolves From from production-shaped Delivered-To arrays", () => {
    const result = resolveReplyContext(createDetail(), channels);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.fromAlias).toBe("vyper_sc@vtj.co.jp");
    expect(result.context.fromChannelId).toBe("vyper-amazon");
    expect(result.context.matchedHeader).toBe("deliveredTo");
    expect(result.context.matchedHeaderValue).toBe("vyper_sc@vtj.co.jp");
  });

  it("prefers Reply-To over From for the reply target", () => {
    const result = resolveReplyContext(
      createDetail({
        from: "Fallback <fallback@example.com>",
        replyTo: "Preferred <preferred@example.com>",
      }),
      channels,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.to).toBe("preferred@example.com");
    expect(result.context.replyToSource).toBe("replyTo");
  });

  it("fails closed when Gmail aliases from multiple channels are present", () => {
    const result = resolveReplyContext(
      createDetail({
        deliveredTo: ["vyper_sc@vtj.co.jp"],
        cc: "Cricut Amazon <cricut_sc@vtj.co.jp>",
      }),
      channels,
    );

    expect(result).toEqual({
      ok: false,
      error: "from_alias_ambiguous",
      message: "送信元グループアドレス候補が複数あります",
      candidates: ["vyper_sc@vtj.co.jp", "cricut_sc@vtj.co.jp"],
    });
  });

  it("does not treat direct mailhub delivery as a resolvable From alias", () => {
    const result = resolveReplyContext(
      createDetail({
        deliveredTo: ["mailhub@vtj.co.jp"],
        to: "mailhub@vtj.co.jp",
      }),
      channels,
    );

    expect(result).toEqual({
      ok: false,
      error: "from_alias_unresolved",
      message: "送信元グループアドレスを一意に解決できません",
    });
  });

  it("blocks Rakuten aliases before Gmail alias selection even when Rakuten is later in Cc", () => {
    const result = resolveReplyContext(
      createDetail({
        deliveredTo: ["mailhub@vtj.co.jp"],
        to: "VYPER SC <vyper_sc@vtj.co.jp>",
        cc: "Store A <shop-a@vtj.co.jp>",
      }),
      channels,
    );

    expect(result).toMatchObject({
      ok: false,
      error: "rakuten_reply_blocked",
      message: "楽天RMS宛のメールはGmail送信できません",
      candidates: ["shop-a@vtj.co.jp"],
      matchedHeader: "cc",
    });
  });

  it("blocks internal individual reply targets", () => {
    const result = resolveReplyContext(
      createDetail({ replyTo: "Staff <staff@vtj.co.jp>" }),
      channels,
    );

    expect(result).toEqual({
      ok: false,
      error: "reply_to_internal_blocked",
      message: "社内アドレスにはGmail返信できません",
    });
  });

  it("chooses a deterministic alias when several addresses from the same channel hit", () => {
    const result = resolveReplyContext(
      createDetail({
        deliveredTo: ["mailhub@vtj.co.jp", "GoPro Order <gopro_order_yahoo@vtj.co.jp>"],
        xOriginalTo: "gopro_y@vtj.co.jp",
      }),
      channels,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.fromAlias).toBe("gopro_order_yahoo@vtj.co.jp");
    expect(result.context.fromChannelId).toBe("gopro-yahoo");
    expect(result.context.matchedHeader).toBe("deliveredTo");
  });

  it("blocks mailing list replies even when Reply-To is valid", () => {
    const result = resolveReplyContext(
      createDetail({
        replyTo: "Customer <customer@example.com>",
        listId: "<support-list.example.com>",
      }),
      channels,
    );

    expect(result).toEqual({
      ok: false,
      error: "mailing_list_reply_blocked",
      message: "メーリングリスト宛のメールにはGmail返信できません",
    });
  });

  it("blocks self loops against the selected From alias", () => {
    const result = resolveReplyContext(
      createDetail({ replyTo: "VYPER SC <vyper_sc@vtj.co.jp>" }),
      channels,
    );

    expect(result).toEqual({
      ok: false,
      error: "reply_to_self_loop",
      message: "自分自身には返信できません",
    });
  });

  it("blocks self loops against the shared inbox", () => {
    const result = resolveReplyContext(
      createDetail({ replyTo: "MailHub <mailhub@vtj.co.jp>" }),
      channels,
      { sharedInboxEmail: "mailhub@vtj.co.jp" },
    );

    expect(result).toEqual({
      ok: false,
      error: "reply_to_self_loop",
      message: "自分自身には返信できません",
    });
  });

  it("blocks replies to channel group aliases", () => {
    const result = resolveReplyContext(
      createDetail({ replyTo: "Cricut Yahoo <cricut_y@vtj.co.jp>" }),
      channels,
    );

    expect(result).toEqual({
      ok: false,
      error: "reply_to_group_blocked",
      message: "グループアドレスにはGmail返信できません",
    });
  });
});
