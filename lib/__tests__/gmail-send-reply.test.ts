import { beforeEach, describe, expect, it, vi } from "vitest";

const gmailMockState = vi.hoisted(() => ({
  sendCalls: [] as Array<{
    userId?: string;
    requestBody?: { raw?: string; threadId?: string };
  }>,
  response: { data: { id: "sent-001", threadId: "thread-001" } } as {
    data: { id: string; threadId?: string };
  },
}));

vi.mock("googleapis", () => {
  const google = {
    auth: {
      OAuth2: class OAuth2 {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        constructor(_args: { clientId: string; clientSecret: string }) {}
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        setCredentials(_credentials: { refresh_token: string }) {}
      },
    },
    gmail: () => ({
      users: {
        messages: {
          send: async (args: {
            userId?: string;
            requestBody?: { raw?: string; threadId?: string };
          }) => {
            gmailMockState.sendCalls.push(args);
            return gmailMockState.response;
          },
        },
      },
    }),
  };
  return { google };
});

import { sendGmailReply } from "@/lib/gmail";

describe("sendGmailReply", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.GOOGLE_SHARED_INBOX_EMAIL = "mailhub@vtj.co.jp";
    process.env.GOOGLE_SHARED_INBOX_REFRESH_TOKEN = "refresh-token";
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    gmailMockState.sendCalls = [];
    gmailMockState.response = { data: { id: "sent-001", threadId: "thread-001" } };
  });

  it("sends raw Gmail reply on the shared inbox thread", async () => {
    const result = await sendGmailReply({
      raw: "raw-base64url",
      threadId: "thread-001",
    });

    expect(gmailMockState.sendCalls).toEqual([
      {
        userId: "mailhub@vtj.co.jp",
        requestBody: {
          raw: "raw-base64url",
          threadId: "thread-001",
        },
      },
    ]);
    expect(result).toEqual({ sentMessageId: "sent-001", threadId: "thread-001" });
  });

  it("falls back to input threadId when Gmail response omits threadId", async () => {
    gmailMockState.response = { data: { id: "sent-002" } };

    await expect(sendGmailReply({ raw: "raw-base64url", threadId: "thread-input" })).resolves.toEqual({
      sentMessageId: "sent-002",
      threadId: "thread-input",
    });
  });
});
