import { describe, expect, it } from "vitest";
import { evaluateNoiseSafety } from "@/lib/noiseSafety";

describe("noiseSafety", () => {
  it("allows only explicit noise to be suppressed", () => {
    const result = evaluateNoiseSafety({
      id: "m-news",
      subject: "Weekly newsletter",
      from: "no-reply@example.com",
      snippet: "unsubscribe here",
    });

    expect(result.status).toBe("safe_to_suppress");
    expect(result.classification).toMatchObject({
      purpose: "noise",
      suppressible: true,
    });
  });

  it("protects important, invoice, and inquiry purposes", () => {
    const invoice = evaluateNoiseSafety({
      id: "m-invoice",
      subject: "6月分 請求書",
      from: "billing@example.com",
      snippet: "添付をご確認ください",
    });
    const inquiry = evaluateNoiseSafety({
      id: "m-inquiry",
      subject: "お問い合わせ",
      from: "customer@example.com",
      snippet: "キャンペーンについて質問です",
    });

    expect(invoice.status).toBe("protected");
    expect(invoice.classification.blockedReasons).toContain("protected_invoice");
    expect(inquiry.status).toBe("protected");
    expect(inquiry.classification.suppressible).toBe(false);
  });

  it("fails closed when summary text is missing even if the sender looks noisy", () => {
    const result = evaluateNoiseSafety({
      id: "m-empty",
      subject: null,
      from: "no-reply@example.com",
      snippet: "",
    });

    expect(result.status).toBe("missing_summary");
    expect(result.classification).toMatchObject({
      suppressible: false,
      blockedReasons: ["missing_summary"],
    });
  });

  it("treats unknown purpose as not suppressible", () => {
    const result = evaluateNoiseSafety({
      id: "m-other",
      subject: "ご確認ください",
      from: "partner@example.com",
      snippet: "明日の件です",
    });

    expect(result.status).toBe("not_noise");
    expect(result.classification).toMatchObject({
      purpose: "other",
      suppressible: false,
      blockedReasons: ["not_noise"],
    });
  });

  it("protects invoice-like attachment filenames", () => {
    const result = evaluateNoiseSafety({
      id: "m-attachment",
      subject: "資料送付",
      from: "no-reply@example.com",
      snippet: "ご確認ください",
      attachmentNames: ["invoice-2026-06.pdf"],
    });

    expect(result.status).toBe("protected");
    expect(result.classification).toMatchObject({
      purpose: "invoice",
      suppressible: false,
    });
    expect(result.classification.evidence).toContainEqual({ field: "attachment", keyword: "invoice" });
  });

  it("fails closed when attachments exist but filenames are unknown", () => {
    const result = evaluateNoiseSafety({
      id: "m-unknown-attachment",
      subject: "Weekly newsletter",
      from: "no-reply@example.com",
      snippet: "unsubscribe here",
      attachmentCount: 1,
    });

    expect(result.status).toBe("missing_summary");
    expect(result.classification.suppressible).toBe(false);
    expect(result.classification.blockedReasons).toContain("unknown_attachment_names");
  });
});
