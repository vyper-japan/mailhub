import { describe, it, expect } from "vitest";
import { evaluateTriage, TRIAGE_RULES, type TriageContext } from "@/lib/triageRules";
import type { InboxListMessage } from "@/lib/mailhub-types";

describe("triageRules", () => {
  const createMessage = (
    subject: string,
    from: string,
    snippet: string = "",
  ): InboxListMessage => ({
    id: `msg-${Math.random()}`,
    threadId: `thread-${Math.random()}`,
    subject,
    from,
    messageId: `<msg@example.com>`,
    receivedAt: "2025/12/31 10:00:00",
    snippet,
    gmailLink: "https://mail.google.com/mail/u/0/#inbox/msg",
    assigneeSlug: null,
  });

  const createContext = (statusType: TriageContext["statusType"] = null): TriageContext => ({
    channelId: "all",
    statusType,
  });

  describe("evaluateTriage", () => {
    it("楽天のお知らせメールは候補になる", () => {
      const msg = createMessage(
        "楽天市場からのお知らせ",
        "楽天市場 <info@rakuten.co.jp>",
        "本日のお買い得情報をお届けします。",
      );
      const result = evaluateTriage(msg, createContext());
      expect(result).toBe("suggest_muted");
    });

    it("楽天のメンテナンス通知は候補になる", () => {
      const msg = createMessage(
        "楽天市場メンテナンスのお知らせ",
        "楽天市場 <info@rakuten.co.jp>",
        "システムメンテナンスを実施いたします。",
      );
      const result = evaluateTriage(msg, createContext());
      expect(result).toBe("suggest_muted");
    });

    it("楽天のキャンペーン通知は候補になる", () => {
      const msg = createMessage(
        "楽天ポイントキャンペーンのご案内",
        "楽天市場 <campaign@rakuten.co.jp>",
        "期間限定でポイントが2倍になるキャンペーンを実施中です。",
      );
      const result = evaluateTriage(msg, createContext());
      expect(result).toBe("suggest_muted");
    });

    it("楽天の利用規約変更は候補になる", () => {
      const msg = createMessage(
        "利用規約の変更について",
        "楽天市場 <legal@rakuten.co.jp>",
        "利用規約が変更されました。",
      );
      const result = evaluateTriage(msg, createContext());
      expect(result).toBe("suggest_muted");
    });

    it("重要キーワードが含まれる場合は候補にならない", () => {
      const msg = createMessage(
        "【重要】楽天市場からのお問い合わせ対応のお願い",
        "楽天市場 <support@rakuten.co.jp>",
        "お客様からのお問い合わせがございます。至急ご対応をお願いいたします。",
      );
      const result = evaluateTriage(msg, createContext());
      expect(result).toBe("none");
    });

    it("至急キーワードが含まれる場合は候補にならない", () => {
      const msg = createMessage(
        "楽天市場からの至急対応依頼",
        "楽天市場 <support@rakuten.co.jp>",
        "至急ご対応をお願いいたします。",
      );
      const result = evaluateTriage(msg, createContext());
      expect(result).toBe("none");
    });

    it("問い合わせキーワードが含まれる場合は候補にならない", () => {
      const msg = createMessage(
        "楽天市場からのお問い合わせ",
        "楽天市場 <support@rakuten.co.jp>",
        "お問い合わせがございます。",
      );
      const result = evaluateTriage(msg, createContext());
      expect(result).toBe("none");
    });

    it("一般的なお知らせメールは候補になる", () => {
      const msg = createMessage(
        "サービスメンテナンスのお知らせ",
        "サービス <info@example.com>",
        "メンテナンスを実施いたします。",
      );
      const result = evaluateTriage(msg, createContext());
      expect(result).toBe("suggest_muted");
    });

    it("注文関連のメールは候補にならない", () => {
      const msg = createMessage(
        "注文確認のお知らせ",
        "Amazon.co.jp <auto-confirm@amazon.co.jp>",
        "ご注文ありがとうございます。",
      );
      const result = evaluateTriage(msg, createContext());
      expect(result).toBe("none");
    });

    it("配送関連のメールは候補にならない", () => {
      const msg = createMessage(
        "配送完了のお知らせ",
        "ヤマト運輸 <info@kuronekoyamato.co.jp>",
        "お届けが完了しました。",
      );
      const result = evaluateTriage(msg, createContext());
      expect(result).toBe("none");
    });

    it("既にMutedの場合は候補にならない", () => {
      const msg = createMessage(
        "楽天市場からのお知らせ",
        "楽天市場 <info@rakuten.co.jp>",
        "本日のお買い得情報をお届けします。",
      );
      const result = evaluateTriage(msg, createContext("muted"));
      expect(result).toBe("none");
    });

    it("通常のメールは候補にならない", () => {
      const msg = createMessage(
        "【StoreA】本日の売上速報",
        "StoreA通知 <notify@store-a.example.com>",
        "本日の売上合計: ¥123,456",
      );
      const result = evaluateTriage(msg, createContext());
      expect(result).toBe("none");
    });
  });

  describe("TRIAGE_RULES", () => {
    it("ルールが定義されている", () => {
      expect(TRIAGE_RULES.length).toBeGreaterThan(0);
    });

    it("各ルールにidとlabelがある", () => {
      TRIAGE_RULES.forEach((rule) => {
        expect(rule.id).toBeTruthy();
        expect(rule.label).toBeTruthy();
        expect(typeof rule.match).toBe("function");
      });
    });
  });
});

