import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  providerSend: vi.fn(),
  shouldSkipAlert: vi.fn(),
  listCandidatesByQuery: vi.fn(),
  logAction: vi.fn(),
  isTestMode: vi.fn(),
  isReadOnlyMode: vi.fn(),
}));

vi.mock("@/lib/require-user", () => ({
  requireUser: vi.fn(),
}));

vi.mock("@/lib/alerts", () => ({
  getAlertProvider: () => ({ send: routeMocks.providerSend }),
  shouldSkipAlert: routeMocks.shouldSkipAlert,
}));

vi.mock("@/lib/slaRules", () => ({
  SLA_RULES: [
    {
      type: "todo",
      warnThresholdMs: 1,
      criticalThresholdMs: 2,
      gmailQuery: "label:inbox older_than:1d",
    },
  ],
  getSLAStatus: () => "critical",
  getSLAActionName: () => "sla_todo_critical",
}));

vi.mock("@/lib/gmail-alerts", () => ({
  listCandidatesByQuery: routeMocks.listCandidatesByQuery,
}));

vi.mock("@/lib/gmail", () => ({
  buildGmailLink: (_sharedInboxEmail: string, _messageId: string | null, threadId: string) =>
    `https://mail.example/${threadId}`,
}));

vi.mock("@/lib/audit-log", () => ({
  logAction: routeMocks.logAction,
}));

vi.mock("@/lib/test-mode", () => ({
  isTestMode: routeMocks.isTestMode,
}));

vi.mock("@/lib/read-only", () => ({
  isReadOnlyMode: routeMocks.isReadOnlyMode,
}));

async function importRoute() {
  vi.resetModules();
  return await import("@/app/api/mailhub/alerts/run/route");
}

describe("mailhub alerts run route", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.GOOGLE_SHARED_INBOX_EMAIL = "inbox@vtj.co.jp";
    routeMocks.providerSend.mockResolvedValue(undefined);
    routeMocks.shouldSkipAlert.mockResolvedValue(false);
    routeMocks.isTestMode.mockReturnValue(true);
    routeMocks.isReadOnlyMode.mockReturnValue(false);
    routeMocks.logAction.mockResolvedValue(undefined);
    routeMocks.listCandidatesByQuery.mockResolvedValue({
      truncated: false,
      messages: [
        {
          id: "m-alert",
          threadId: "t-alert",
          subject: "至急確認",
          from: "sender@example.com",
          messageId: "<m-alert@example.com>",
          receivedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
          snippet: "body",
          gmailLink: "",
          assigneeSlug: null,
        },
      ],
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("does not write SLA activity when provider send fails", async () => {
    routeMocks.providerSend.mockRejectedValueOnce(new Error("provider failed"));
    const { GET } = await importRoute();

    const res = await GET(new Request("http://localhost/api/mailhub/alerts/run?scope=todo"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toMatchObject({ error: "alert_failed" });
    expect(routeMocks.logAction).not.toHaveBeenCalled();
  });

  it("writes SLA activity only after provider send succeeds", async () => {
    const { GET } = await importRoute();

    const res = await GET(new Request("http://localhost/api/mailhub/alerts/run?scope=todo"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ sent: 1, candidates: 1 });
    expect(routeMocks.providerSend).toHaveBeenCalledTimes(1);
    expect(routeMocks.providerSend).toHaveBeenCalledWith(
      expect.objectContaining({
        openUrl: expect.stringContaining("sla=1"),
        openCriticalUrl: expect.stringContaining("slaLevel=critical"),
      }),
    );
    expect(routeMocks.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actorEmail: "system@mailhub",
        action: "sla_todo_critical",
        messageId: "m-alert",
      }),
    );
    expect(routeMocks.providerSend.mock.invocationCallOrder[0]).toBeLessThan(
      routeMocks.logAction.mock.invocationCallOrder[0],
    );
  });
});
