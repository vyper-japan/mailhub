import { beforeEach, describe, expect, it, vi } from "vitest";

const gmailMockState = vi.hoisted(() => ({
  listCalls: [] as Array<{ userId?: string }>,
  messageListCalls: [] as Array<{
    userId?: string;
    maxResults?: number;
    q?: string;
    pageToken?: string;
    labelIds?: string[];
  }>,
  messageGetCalls: [] as Array<{ userId?: string; id?: string }>,
  labelGetCalls: [] as Array<{ userId?: string; id?: string }>,
  createCalls: [] as Array<{
    userId?: string;
    requestBody?: {
      name?: string;
      labelListVisibility?: string;
      messageListVisibility?: string;
    };
  }>,
  listResponses: [] as Array<Array<{ id: string; name: string }>>,
  messageListResponses: [] as Array<{
    messages?: Array<{ id?: string; threadId?: string }>;
    nextPageToken?: string;
    resultSizeEstimate?: number;
  }>,
  labelTotals: {} as Record<string, number>,
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
        messages: {
          list: async (args: {
            userId?: string;
            maxResults?: number;
            q?: string;
            pageToken?: string;
            labelIds?: string[];
          }) => {
            gmailMockState.messageListCalls.push(args);
            const response = gmailMockState.messageListResponses.shift() ?? { messages: [] };
            return { data: response };
          },
          get: async (args: { userId?: string; id?: string }) => {
            gmailMockState.messageGetCalls.push(args);
            return {
              data: {
                id: args.id,
                threadId: `thread-${args.id}`,
                internalDate: "1767139200000",
                snippet: `snippet-${args.id}`,
                labelIds: [],
                payload: {
                  headers: [
                    { name: "Subject", value: `Subject ${args.id}` },
                    { name: "From", value: "Customer <customer@example.com>" },
                    { name: "Message-ID", value: `<${args.id}@example.com>` },
                  ],
                },
              },
            };
          },
        },
        labels: {
          list: async (args: { userId?: string }) => {
            gmailMockState.listCalls.push(args);
            const labels = gmailMockState.listResponses.shift() ?? [];
            return { data: { labels } };
          },
          get: async (args: { userId?: string; id?: string }) => {
            gmailMockState.labelGetCalls.push(args);
            return { data: { messagesTotal: args.id ? (gmailMockState.labelTotals[args.id] ?? 0) : 0 } };
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

import {
  ensureLabelId,
  getMessageCounts,
  listLatestInboxMessages,
  MAILHUB_LABEL_ASSIGNEE_PREFIX,
  MAILHUB_LABEL_DONE,
  MAILHUB_LABEL_MUTED,
  MAILHUB_LABEL_SNOOZED,
  MAILHUB_LABEL_WAITING,
} from "@/lib/gmail";

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
    gmailMockState.messageListCalls = [];
    gmailMockState.messageGetCalls = [];
    gmailMockState.labelGetCalls = [];
    gmailMockState.createCalls = [];
    gmailMockState.listResponses = [];
    gmailMockState.messageListResponses = [];
    gmailMockState.labelTotals = {};
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

  it("preserves nextPageToken when a Gmail list response is served from cache", async () => {
    gmailMockState.messageListResponses = [
      {
        messages: [{ id: "msg-cache-1", threadId: "thread-cache-1" }],
        nextPageToken: "token-next-page",
      },
    ];

    const first = await listLatestInboxMessages({ max: 1, q: "from:customer@example.com" });
    const second = await listLatestInboxMessages({ max: 1, q: "from:customer@example.com" });

    expect(first.nextPageToken).toBe("token-next-page");
    expect(second.nextPageToken).toBe("token-next-page");
    expect(second.messages.map((m) => m.id)).toEqual(["msg-cache-1"]);
    expect(gmailMockState.messageListCalls).toHaveLength(1);
  });

  it("counts production assignee load across every MailHub assignee label", async () => {
    const labels = [
      { id: "waiting-id", name: MAILHUB_LABEL_WAITING },
      { id: "done-id", name: MAILHUB_LABEL_DONE },
      { id: "muted-id", name: MAILHUB_LABEL_MUTED },
      { id: "snoozed-id", name: MAILHUB_LABEL_SNOOZED },
      { id: "assignee-mine-id", name: `${MAILHUB_LABEL_ASSIGNEE_PREFIX}me_at_vtj_co_jp` },
      { id: "assignee-other-id", name: `${MAILHUB_LABEL_ASSIGNEE_PREFIX}other_at_vtj_co_jp` },
    ];
    gmailMockState.listResponses = [labels];
    gmailMockState.labelTotals = {
      INBOX: 10,
      "waiting-id": 4,
      "done-id": 3,
      "muted-id": 2,
      "snoozed-id": 1,
      "assignee-mine-id": 7,
    };
    gmailMockState.messageListResponses = [
      { resultSizeEstimate: 3 },
      { resultSizeEstimate: 1 },
      { resultSizeEstimate: 2 },
      { resultSizeEstimate: 2 },
    ];

    const counts = await getMessageCounts("me@vtj.co.jp");

    expect(counts).toMatchObject({
      todo: 10,
      waiting: 4,
      done: 3,
      muted: 2,
      snoozed: 1,
      assignedMine: 7,
      assigneeLoadBySlug: {
        me_at_vtj_co_jp: 4,
        other_at_vtj_co_jp: 4,
      },
      unassignedLoad: 6,
    });
    expect(gmailMockState.messageListCalls.map((call) => call.labelIds)).toEqual([
      ["INBOX", "assignee-mine-id"],
      ["waiting-id", "assignee-mine-id"],
      ["INBOX", "assignee-other-id"],
      ["waiting-id", "assignee-other-id"],
    ]);
  });
});
