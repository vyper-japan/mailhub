import { beforeEach, describe, expect, it, vi } from "vitest";

const gmailApiMock = vi.hoisted(() => ({
  users: {
    messages: {
      list: vi.fn(),
      get: vi.fn(),
    },
  },
}));

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: vi.fn(function OAuth2() {
        return { setCredentials: vi.fn() };
      }),
    },
    gmail: vi.fn(() => gmailApiMock),
  },
}));

vi.mock("@/lib/test-mode", () => ({
  isTestMode: () => false,
}));

vi.mock("@/lib/gmail", () => ({
  buildGmailLink: (_sharedInboxEmail: string, messageId: string | null, threadId: string) =>
    `https://mail.example/${threadId}/${messageId ?? ""}`,
}));

async function importListCandidatesByQuery() {
  vi.resetModules();
  return await import("@/lib/gmail-alerts");
}

describe("listCandidatesByQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GOOGLE_SHARED_INBOX_EMAIL", "inbox@vtj.co.jp");
    vi.stubEnv("GOOGLE_SHARED_INBOX_REFRESH_TOKEN", "refresh-token");
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
  });

  it("fetches every message returned on a Gmail page instead of silently keeping only the first 100", async () => {
    const ids = Array.from({ length: 250 }, (_, index) => ({ id: `msg-${index + 1}` }));
    gmailApiMock.users.messages.list.mockResolvedValueOnce({
      data: {
        messages: ids,
        nextPageToken: undefined,
      },
    });
    gmailApiMock.users.messages.get.mockImplementation(async ({ id }: { id: string }) => ({
      data: {
        threadId: `thread-${id}`,
        internalDate: "1767225600000",
        snippet: `snippet-${id}`,
        payload: {
          headers: [
            { name: "Subject", value: `Subject ${id}` },
            { name: "From", value: `Sender <sender-${id}@example.com>` },
            { name: "Message-ID", value: `<${id}@example.com>` },
          ],
        },
      },
    }));

    const { listCandidatesByQuery } = await importListCandidatesByQuery();
    const result = await listCandidatesByQuery({ q: "older_than:1d", maxPages: 1, maxTotal: 500 });

    expect(result.truncated).toBe(false);
    expect(result.messages).toHaveLength(250);
    expect(gmailApiMock.users.messages.get).toHaveBeenCalledTimes(250);
    expect(result.messages.at(-1)).toMatchObject({
      id: "msg-250",
      threadId: "thread-msg-250",
      subject: "Subject msg-250",
    });
  });
});
