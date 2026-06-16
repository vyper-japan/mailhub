import { beforeEach, describe, expect, it, vi } from "vitest";

const gmailMockState = vi.hoisted(() => ({
  listCalls: [] as Array<{ userId?: string }>,
  createCalls: [] as Array<{
    userId?: string;
    requestBody?: {
      name?: string;
      labelListVisibility?: string;
      messageListVisibility?: string;
    };
  }>,
  listResponses: [] as Array<Array<{ id: string; name: string }>>,
  createConflict: false,
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
        labels: {
          list: async (args: { userId?: string }) => {
            gmailMockState.listCalls.push(args);
            const labels = gmailMockState.listResponses.shift() ?? [];
            return { data: { labels } };
          },
          create: async (args: {
            userId?: string;
            requestBody?: {
              name?: string;
              labelListVisibility?: string;
              messageListVisibility?: string;
            };
          }) => {
            gmailMockState.createCalls.push(args);
            if (gmailMockState.createConflict) {
              const error = new Error("Label name exists or conflicts") as Error & {
                code?: number;
                response?: { status?: number };
              };
              error.code = 409;
              error.response = { status: 409 };
              throw error;
            }
            return { data: { id: `created-${args.requestBody?.name ?? "label"}` } };
          },
        },
      },
    }),
  };
  return { google };
});

import { ensureLabelId, listLatestInboxMessages, MAILHUB_LABEL_WAITING } from "@/lib/gmail";

describe("ensureLabelId", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.MAILHUB_TEST_MODE = "0";
    process.env.GOOGLE_SHARED_INBOX_EMAIL = "mailhub@vtj.co.jp";
    process.env.GOOGLE_SHARED_INBOX_REFRESH_TOKEN = "refresh-token";
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    delete globalThis.__mailhubGmailCache;
    gmailMockState.listCalls = [];
    gmailMockState.createCalls = [];
    gmailMockState.listResponses = [];
    gmailMockState.createConflict = false;
  });

  it("recovers from Gmail label create 409 by refreshing labels and returning the existing id", async () => {
    gmailMockState.createConflict = true;
    gmailMockState.listResponses = [
      [],
      [{ id: "existing-waiting-id", name: MAILHUB_LABEL_WAITING }],
    ];

    await expect(ensureLabelId(MAILHUB_LABEL_WAITING)).resolves.toBe("existing-waiting-id");

    expect(gmailMockState.listCalls).toEqual([
      { userId: "mailhub@vtj.co.jp" },
      { userId: "mailhub@vtj.co.jp" },
    ]);
    expect(gmailMockState.createCalls).toEqual([
      {
        userId: "mailhub@vtj.co.jp",
        requestBody: {
          name: MAILHUB_LABEL_WAITING,
          labelListVisibility: "labelShow",
          messageListVisibility: "show",
        },
      },
    ]);
  });

  it("matches TEST_MODE address channel queries against detail headers", async () => {
    process.env.MAILHUB_TEST_MODE = "1";
    delete globalThis.__mailhubGmailCache;

    const result = await listLatestInboxMessages({
      q: "(deliveredto:shop-a@vtj.co.jp OR to:shop-a@vtj.co.jp OR cc:shop-a@vtj.co.jp)",
      max: 20,
    });

    expect(result.messages.some((m) => m.id === "msg-021")).toBe(true);
    expect(result.messages.every((m) => m.id !== "msg-012")).toBe(true);
  });
});
