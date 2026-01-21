import { describe, expect, it } from "vitest";
import { extractTemplateVariables, renderTemplate, buildVariablesFromContext } from "../replyTemplates";

describe("replyTemplates", () => {
  describe("extractTemplateVariables", () => {
    it("should extract variables from template body", () => {
      const body = "お問い合わせありがとうございます。\n問い合わせ番号: {{inquiryId}}\n担当: {{assignee}}";
      const vars = extractTemplateVariables(body);
      expect(vars).toEqual(["inquiryId", "assignee"]);
    });

    it("should handle duplicate variables", () => {
      const body = "{{inquiryId}} と {{inquiryId}} は同じです";
      const vars = extractTemplateVariables(body);
      expect(vars).toEqual(["inquiryId"]);
    });

    it("should return empty array for no variables", () => {
      const body = "お問い合わせありがとうございます。";
      const vars = extractTemplateVariables(body);
      expect(vars).toEqual([]);
    });
  });

  describe("renderTemplate", () => {
    it("should replace variables with values", () => {
      const body = "問い合わせ番号: {{inquiryId}}\n担当: {{assignee}}";
      const variables = {
        inquiryId: "12345678",
        assignee: "田中",
      };
      const result = renderTemplate(body, variables);
      expect(result.rendered).toBe("問い合わせ番号: 12345678\n担当: 田中");
      expect(result.unresolved).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it("should detect unresolved variables", () => {
      const body = "問い合わせ番号: {{inquiryId}}\n注文番号: {{orderId}}";
      const variables = {
        inquiryId: "12345678",
        orderId: null, // 未解決
      };
      const result = renderTemplate(body, variables);
      expect(result.rendered).toBe("問い合わせ番号: 12345678\n注文番号: {{orderId}}");
      expect(result.unresolved).toEqual(["{{orderId}}"]);
      expect(result.warnings).toContain("{{orderId}} が未解決です");
      expect(result.warnings).toContain("未解決のプレースホルダ: {{orderId}}");
    });

    it("should handle missing variables", () => {
      const body = "問い合わせ番号: {{inquiryId}}\n注文番号: {{orderId}}";
      const variables = {
        inquiryId: "12345678",
        // orderId が存在しない
      };
      const result = renderTemplate(body, variables);
      expect(result.unresolved).toEqual(["{{orderId}}"]);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("should replace all occurrences of the same variable", () => {
      const body = "{{inquiryId}} と {{inquiryId}} は同じです";
      const variables = {
        inquiryId: "12345678",
      };
      const result = renderTemplate(body, variables);
      expect(result.rendered).toBe("12345678 と 12345678 は同じです");
      expect(result.unresolved).toEqual([]);
    });
  });

  describe("buildVariablesFromContext", () => {
    it("should build variables from context", () => {
      const context = {
        inquiryId: "12345678",
        orderId: "ORD-001",
        customerEmail: "customer@example.com",
        fromName: "山田 太郎",
        fromEmail: "from@example.com",
        subject: "件名テスト",
        store: "StoreA",
        assignee: "田中",
        agent: "agent@vtj.co.jp",
        today: "2026-01-13",
      };
      const variables = buildVariablesFromContext(context);
      expect(variables.inquiryId).toBe("12345678");
      expect(variables.orderId).toBe("ORD-001");
      expect(variables.customerEmail).toBe("customer@example.com");
      expect(variables.fromName).toBe("山田 太郎");
      expect(variables.fromEmail).toBe("from@example.com");
      expect(variables.subject).toBe("件名テスト");
      expect(variables.store).toBe("StoreA");
      expect(variables.assignee).toBe("田中");
      expect(variables.agent).toBe("agent@vtj.co.jp");
      expect(variables.today).toBe("2026-01-13");
    });

    it("should use default today if not provided", () => {
      const context = {};
      const variables = buildVariablesFromContext(context);
      expect(variables.today).toMatch(/^\d{4}-\d{2}-\d{2}$/); // YYYY-MM-DD形式
    });

    it("should handle null values", () => {
      const context = {
        inquiryId: null,
        orderId: null,
      };
      const variables = buildVariablesFromContext(context);
      expect(variables.inquiryId).toBeNull();
      expect(variables.orderId).toBeNull();
    });
  });
});
