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
});
