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
  threadGetCalls: [] as Array<{ userId?: string; id?: string }>,
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
  threadGetResponses: [] as Array<{
    messages?: Array<{
      id?: string;
      labelIds?: string[];
      internalDate?: string;
      snippet?: string;
      payload?: { headers?: Array<{ name?: string; value?: string }> };
    }>;
  }>,
  labelTotals: {} as Record<string, number>,
  labelIdsByMessageId: {} as Record<string, string[]>,
  createConflict: false,
}));

const labelRegistryMockState = vi.hoisted(() => ({
  list: vi.fn(async () => [] as Array<{ labelName: string }>),
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
                labelIds: args.id ? (gmailMockState.labelIdsByMessageId[args.id] ?? []) : [],
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
        threads: {
          get: async (args: { userId?: string; id?: string }) => {
            gmailMockState.threadGetCalls.push(args);
            const response = gmailMockState.threadGetResponses.shift() ?? { messages: [] };
            return { data: response };
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

vi.mock("@/lib/labelRegistryStore", () => ({
  getLabelRegistryStore: () => ({
    list: labelRegistryMockState.list,
  }),
}));

import {
  ensureLabelId,
  getThreadSummaryByMessageId,
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
    gmailMockState.threadGetCalls = [];
    gmailMockState.labelGetCalls = [];
    gmailMockState.createCalls = [];
    gmailMockState.listResponses = [];
    gmailMockState.messageListResponses = [];
    gmailMockState.threadGetResponses = [];
    gmailMockState.labelTotals = {};
    gmailMockState.labelIdsByMessageId = {};
    gmailMockState.createConflict = false;
    labelRegistryMockState.list.mockReset();
    labelRegistryMockState.list.mockResolvedValue([]);
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

  it("continues paging when unassigned messages are hidden behind assigned messages", async () => {
    gmailMockState.listResponses = [[
      { id: "assignee-other-id", name: `${MAILHUB_LABEL_ASSIGNEE_PREFIX}other_at_vtj_co_jp` },
    ]];
    gmailMockState.messageListResponses = [
      {
        messages: [
          { id: "msg-assigned-1", threadId: "thread-assigned-1" },
          { id: "msg-assigned-2", threadId: "thread-assigned-2" },
        ],
        nextPageToken: "page-2",
      },
      {
        messages: [
          { id: "msg-unassigned-1", threadId: "thread-unassigned-1" },
          { id: "msg-unassigned-2", threadId: "thread-unassigned-2" },
        ],
        nextPageToken: "page-3",
      },
    ];
    gmailMockState.labelIdsByMessageId = {
      "msg-assigned-1": ["assignee-other-id"],
      "msg-assigned-2": ["assignee-other-id"],
      "msg-unassigned-1": [],
      "msg-unassigned-2": [],
    };

    const result = await listLatestInboxMessages({ max: 2, unassigned: true });

    expect(result.messages.map((m) => m.id)).toEqual(["msg-unassigned-1", "msg-unassigned-2"]);
    expect(result.nextPageToken).toBe("page-3");
    expect(gmailMockState.messageListCalls).toMatchObject([
      { maxResults: 2, pageToken: undefined, labelIds: ["INBOX"] },
      { maxResults: 2, pageToken: "page-2", labelIds: ["INBOX"] },
    ]);
    expect(gmailMockState.messageGetCalls.map((call) => call.id)).toEqual([
      "msg-assigned-1",
      "msg-assigned-2",
      "msg-unassigned-1",
      "msg-unassigned-2",
    ]);
  });

  describe("registered label degradation", () => {
    it("continues listLatestInboxMessages when registered label store read fails", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        labelRegistryMockState.list.mockRejectedValueOnce(new Error("sheets 429"));
        gmailMockState.listResponses = [[
          { id: "user-label-id", name: "MailHub/Label/VIP" },
        ]];
        gmailMockState.messageListResponses = [
          {
            messages: [{ id: "msg-label-degraded", threadId: "thread-label-degraded" }],
          },
        ];
        gmailMockState.labelIdsByMessageId = {
          "msg-label-degraded": ["user-label-id"],
        };

        const result = await listLatestInboxMessages({ max: 1 });

        expect(result.messages).toHaveLength(1);
        expect(result.messages[0]?.id).toBe("msg-label-degraded");
        expect(result.messages[0]?.userLabels).toBeUndefined();
        expect(errorSpy).toHaveBeenCalledWith(
          "[gmail] getRegisteredLabelNameSet failed; continuing without registered user labels",
          expect.any(Error),
        );
      } finally {
        errorSpy.mockRestore();
      }
    });

    it("continues getThreadSummaryByMessageId when registered label store read fails", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        labelRegistryMockState.list.mockRejectedValueOnce(new Error("sheets 429"));
        gmailMockState.listResponses = [[
          { id: "user-label-id", name: "MailHub/Label/VIP" },
        ]];
        gmailMockState.threadGetResponses = [
          {
            messages: [
              {
                id: "msg-thread-degraded",
                labelIds: ["user-label-id"],
                internalDate: "1767139200000",
                snippet: "thread snippet",
                payload: {
                  headers: [
                    { name: "Subject", value: "Thread subject" },
                    { name: "From", value: "Customer <customer@example.com>" },
                    { name: "Message-ID", value: "<msg-thread-degraded@example.com>" },
                  ],
                },
              },
            ],
          },
        ];

        const result = await getThreadSummaryByMessageId("msg-thread-degraded");

        expect(result.threadId).toBe("thread-msg-thread-degraded");
        expect(result.messages).toHaveLength(1);
        expect(result.messages[0]?.labels).toEqual([]);
        expect(errorSpy).toHaveBeenCalledWith(
          "[gmail] getRegisteredLabelNameSet failed; continuing without registered user labels",
          expect.any(Error),
        );
      } finally {
        errorSpy.mockRestore();
      }
    });
  });
});
