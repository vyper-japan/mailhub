import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatworkProvider, getAlertProvider } from "@/lib/alerts";
import type { AlertPayload } from "@/lib/alerts";

const payload: AlertPayload = {
  title: "MailHub SLA Alert",
  text: "Todo超過: warn 1件 / critical 1件",
  openUrl: "https://mailhub.example/?sla=1",
  openCriticalUrl: "https://mailhub.example/?sla=1&slaLevel=critical",
  items: [
    {
      subject: "請求書の確認",
      age: "3日",
      assignee: "tanaka",
      gmailLink: "https://mail.google.com/mail/u/0/#inbox/1",
      status: "critical",
      url: "https://mailhub.example/?id=m1",
      takeUrl: "https://mailhub.example/?id=m1&take=1",
    },
  ],
};

describe("alerts providers", () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    global.fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it("sends Chatwork messages with token header and urlencoded body", async () => {
    const provider = new ChatworkProvider("token-1", "12345", "https://chatwork.example/v2");

    await provider.send(payload);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://chatwork.example/v2/rooms/12345/messages",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-ChatWorkToken": "token-1",
        },
      }),
    );
    const body = vi.mocked(global.fetch).mock.calls[0]?.[1]?.body;
    expect(typeof body).toBe("string");
    const parsed = new URLSearchParams(body as string);
    expect(parsed.get("body")).toContain("[info][title]MailHub SLA Alert[/title]");
    expect(parsed.get("body")).toContain("請求書の確認");
    expect(parsed.get("body")).toContain("https://mailhub.example/?id=m1&take=1");
    expect(parsed.get("self_unread")).toBe("0");
  });

  it("uses log provider in test mode before Chatwork config is evaluated", async () => {
    process.env.MAILHUB_TEST_MODE = "1";
    process.env.MAILHUB_ALERTS_PROVIDER = "chatwork";
    delete process.env.MAILHUB_CHATWORK_API_TOKEN;
    delete process.env.MAILHUB_CHATWORK_ROOM_ID;

    await getAlertProvider().send(payload);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fails closed when Chatwork provider is selected without required config", async () => {
    process.env.MAILHUB_ALERTS_PROVIDER = "chatwork";
    delete process.env.MAILHUB_TEST_MODE;
    delete process.env.MAILHUB_CHATWORK_API_TOKEN;
    delete process.env.MAILHUB_CHATWORK_ROOM_ID;

    await expect(getAlertProvider().send(payload)).rejects.toThrow("chatwork_config_missing");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
