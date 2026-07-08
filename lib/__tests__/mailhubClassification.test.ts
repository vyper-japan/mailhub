import { describe, expect, it } from "vitest";
import { classifyMailhubMessage, isSuppressiveLabelName } from "@/lib/mailhubClassification";

describe("mailhubClassification", () => {
  it("protects invoice-like messages from suppressive rules", () => {
    const result = classifyMailhubMessage({
      subject: "6月分 請求書を送付します",
      from: "billing@example.com",
      snippet: "添付をご確認ください",
    });

    expect(result).toMatchObject({
      purpose: "invoice",
      suppressible: false,
      blockedReasons: ["protected_invoice"],
    });
    expect(result.evidence).toContainEqual({ field: "subject", keyword: "請求書" });
  });

  it("protects inquiries before treating campaign-like text as noise", () => {
    const result = classifyMailhubMessage({
      subject: "お問い合わせ: キャンペーン商品の交換について",
      from: "customer@example.com",
      snippet: "セール品について質問があります",
    });

    expect(result.purpose).toBe("important");
    expect(result.suppressible).toBe(false);
  });

  it("marks newsletter-like messages as suppressible noise", () => {
    const result = classifyMailhubMessage({
      subject: "Weekly newsletter",
      from: "no-reply@example.com",
      snippet: "unsubscribe here",
    });

    expect(result.purpose).toBe("noise");
    expect(result.suppressible).toBe(true);
  });

  it("does not treat unknown purpose as suppressible", () => {
    const result = classifyMailhubMessage({
      subject: "ご確認ください",
      from: "partner@example.com",
      snippet: "明日の件です",
    });

    expect(result).toMatchObject({
      purpose: "other",
      suppressible: false,
      blockedReasons: ["not_noise"],
    });
  });

  it("recognizes suppressive label names", () => {
    expect(isSuppressiveLabelName("MailHub/Muted")).toBe(true);
    expect(isSuppressiveLabelName("処理不要")).toBe(true);
    expect(isSuppressiveLabelName("MailHub/Important")).toBe(false);
  });

  describe("marketplace notification noise", () => {
    it.each([
      {
        label: "Amazon seller notification sender and shipping date subject",
        message: { from: "seller-notification@amazon.co.jp", subject: "ご注文の発送予定日", snippet: "" },
      },
      {
        label: "Amazon order confirmation snippet",
        message: { from: "seller-notification@amazon.co.jp", subject: "", snippet: "注文確定のお知らせ" },
      },
      {
        label: "Amazon shipping date keyword",
        message: { from: "any@example.com", subject: "出荷予定日のご連絡", snippet: "" },
      },
      {
        label: "Rakuten order confirmation sender and subject",
        message: { from: "order-confirm@mail.rms.rakuten.co.jp", subject: "ご注文内容ご確認", snippet: "" },
      },
      {
        label: "Rakuten order sender",
        message: { from: "order@rakuten.co.jp", subject: "", snippet: "" },
      },
      {
        label: "Rakuten shipping completion report",
        message: { from: "any@example.com", subject: "【楽天】発送完了報告", snippet: "" },
      },
      {
        label: "Rakuten order confirmation snippet",
        message: { from: "any@example.com", subject: "", snippet: "ご注文内容ご確認のお願い" },
      },
      {
        label: "Yahoo shopping order morning report",
        message: { from: "store-shopping-order-master@mail.yahoo.co.jp", subject: "本日の朝レポ", snippet: "" },
      },
      {
        label: "Yahoo shopping editor reflected",
        message: { from: "shopping-editor-master@mail.yahoo.co.jp", subject: "エディター反映のお知らせ", snippet: "" },
      },
    ])("marks $label as suppressible noise", ({ message }) => {
      expect(classifyMailhubMessage(message)).toMatchObject({
        purpose: "noise",
        suppressible: true,
        blockedReasons: [],
      });
    });

    it.each([
      {
        label: "Amazon returns request",
        message: { from: "seller-notification@amazon.co.jp", subject: "返品リクエスト", snippet: "" },
      },
      {
        label: "Rakuten cancellation request",
        message: { from: "order-confirm@mail.rms.rakuten.co.jp", subject: "キャンセルのお願い", snippet: "" },
      },
      {
        label: "Yahoo urgent request",
        message: { from: "store-shopping-order-master@mail.yahoo.co.jp", subject: "至急ご対応ください", snippet: "" },
      },
    ])("keeps $label protected as important", ({ message }) => {
      expect(classifyMailhubMessage(message)).toMatchObject({
        purpose: "important",
        suppressible: false,
        blockedReasons: ["protected_important"],
      });
    });
  });
});
