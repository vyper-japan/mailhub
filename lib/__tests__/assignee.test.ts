import { describe, it, expect } from "vitest";
import { assigneeSlug } from "../assignee";

describe("assigneeSlug", () => {
  it("通常のメールアドレスをslugに変換", () => {
    expect(assigneeSlug("tanaka@vtj.co.jp")).toBe("tanaka_at_vtj_co_jp");
  });

  it("大文字小文字を区別せず小文字に変換", () => {
    expect(assigneeSlug("TANAKA@VTJ.CO.JP")).toBe("tanaka_at_vtj_co_jp");
    expect(assigneeSlug("Tanaka@Vtj.Co.Jp")).toBe("tanaka_at_vtj_co_jp");
  });

  it("複数のドットを含むメールアドレス", () => {
    expect(assigneeSlug("first.last@example.co.jp")).toBe("first_last_at_example_co_jp");
  });

  it("ハイフンを含むメールアドレス（ハイフンは除去される）", () => {
    expect(assigneeSlug("test-user@example.com")).toBe("testuser_at_example_com");
  });

  it("数字を含むメールアドレス", () => {
    expect(assigneeSlug("user123@example.com")).toBe("user123_at_example_com");
  });

  it("特殊文字を含むメールアドレス（除去される）", () => {
    expect(assigneeSlug("user+tag@example.com")).toBe("usertag_at_example_com");
  });

  it("日本語を含むメールアドレス（除去される）", () => {
    expect(assigneeSlug("たなか@example.com")).toBe("_at_example_com");
  });

  it("長いメールアドレス", () => {
    expect(assigneeSlug("very.long.email.address@very.long.domain.example.com")).toBe(
      "very_long_email_address_at_very_long_domain_example_com"
    );
  });

  it("サブドメインを含むメールアドレス", () => {
    expect(assigneeSlug("user@mail.example.com")).toBe("user_at_mail_example_com");
  });

  it("複数のアットマークを含むメールアドレス（全ての@が変換される）", () => {
    expect(assigneeSlug("user@example@invalid.com")).toBe("user_at_example_at_invalid_com");
  });

  it("空文字列", () => {
    expect(assigneeSlug("")).toBe("");
  });

  it("@のみ", () => {
    expect(assigneeSlug("@")).toBe("_at_");
  });

  it("ドメインのみ", () => {
    expect(assigneeSlug("@example.com")).toBe("_at_example_com");
  });

  it("ユーザー名のみ（@なし）", () => {
    expect(assigneeSlug("username")).toBe("username");
  });
});

