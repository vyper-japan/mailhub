import { describe, it, expect } from "vitest";
import { routeReply } from "../replyRouter";
import type { MessageDetail } from "../mailhub-types";
import type { ChannelId } from "../channels";

describe("routeReply", () => {
  const createMessage = (overrides: Partial<MessageDetail>): MessageDetail => ({
    id: "msg-001",
    threadId: "thread-001",
    subject: "Test",
    from: "test@example.com",
    messageId: "<test@example.com>",
    receivedAt: "2025/01/01 10:00:00",
    snippet: "Test snippet",
    gmailLink: "https://mail.google.com/mail/u/0/#inbox/msg-001",
    plainTextBody: "Test body",
    htmlBody: null,
    bodySource: "plain",
    bodyNotice: null,
    assigneeSlug: null,
    ...overrides,
  });

  describe("Allチャンネル", () => {
    it("常にemailを返す", () => {
      const message = createMessage({
        subject: "【楽天RMS】お問い合わせ",
        from: "楽天市場 <rms@rakuten.co.jp>",
      });
      const result = routeReply(message, "all");
      expect(result.kind).toBe("gmail");
      expect(result.storeId).toBeUndefined();
    });
  });

  describe("StoreA/B/Cチャンネル", () => {
    const rakutenMessages = [
      {
        name: "件名に楽天",
        message: createMessage({
          subject: "【楽天RMS】お問い合わせが届きました",
        }),
      },
      {
        name: "送信者に楽天",
        message: createMessage({
          from: "楽天市場 <rms@rakuten.co.jp>",
        }),
      },
      {
        name: "本文に楽天",
        message: createMessage({
          plainTextBody: "楽天市場からのお問い合わせです",
        }),
      },
      {
        name: "スニペットにRMS",
        message: createMessage({
          snippet: "RMSからのお問い合わせ",
        }),
      },
      {
        name: "R-Messe",
        message: createMessage({
          subject: "R-Messeからの通知",
        }),
      },
      {
        name: "msg-021相当",
        message: createMessage({
          id: "msg-021",
          subject: "【楽天RMS】お問い合わせが届きました",
          from: "楽天市場 <rms@rakuten.co.jp>",
          plainTextBody: "問い合わせ番号: 12345678",
        }),
      },
    ];

    ["store-a", "store-b", "store-c"].forEach((channelId) => {
      rakutenMessages.forEach(({ name, message }) => {
        it(`${channelId}: ${name} → rakuten_rms`, () => {
          const result = routeReply(message, channelId as ChannelId);
          expect(result.kind).toBe("rakuten_rms");
          expect(result.storeId).toBe(channelId);
        });
      });
    });
  });

  describe("非楽天メール", () => {
    const nonRakutenMessages = [
      {
        name: "Amazonメール",
        message: createMessage({
          subject: "【重要】注文確認のお知らせ",
          from: "Amazon.co.jp <auto-confirm@amazon.co.jp>",
        }),
      },
      {
        name: "Yahoo!ショッピング",
        message: createMessage({
          subject: "Yahoo!ショッピング-朝レポ",
          from: "Yahoo!ショッピング <store-report@mail.yahoo.co.jp>",
        }),
      },
      {
        name: "通常メール",
        message: createMessage({
          subject: "会議のご案内",
          from: "田中 太郎 <tanaka@example.com>",
        }),
      },
    ];

    ["store-a", "store-b", "store-c"].forEach((channelId) => {
      nonRakutenMessages.forEach(({ name, message }) => {
        it(`${channelId}: ${name} → email`, () => {
          const result = routeReply(message, channelId as ChannelId);
          expect(result.kind).toBe("gmail");
          expect(result.storeId).toBeUndefined();
        });
      });
    });
  });

  describe("境界ケース", () => {
    it("空のメッセージ", () => {
      const message = createMessage({
        subject: undefined,
        from: undefined,
        snippet: undefined,
        plainTextBody: undefined,
      });
      const result = routeReply(message, "store-a");
      expect(result.kind).toBe("gmail");
    });

    it("大文字小文字混在の楽天キーワード", () => {
      const message = createMessage({
        subject: "RaKuTeN からのお知らせ",
      });
      const result = routeReply(message, "store-a");
      expect(result.kind).toBe("rakuten_rms");
    });
  });
});

