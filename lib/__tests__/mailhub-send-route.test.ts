import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageDetail } from "@/lib/mailhub-types";
import { assigneeSlug } from "@/lib/assignee";
import { clearActivityLogs, getActivityLogs, logAction } from "@/lib/audit-log";
import {
  buildMailhubSendDuplicateKeys,
  clearMailhubSendDuplicateGuard,
} from "@/lib/mailhub-send-duplicate-guard";
import { clearTestSentReplyCaptures, listTestSentReplyCaptures } from "@/lib/mailhub-send-test-capture";

const routeMocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  isReadOnlyMode: vi.fn(),
  getMessageDetail: vi.fn(),
  sendGmailReply: vi.fn(),
  archiveMessage: vi.fn(),
  assertSendAsAccepted: vi.fn(),
}));

const TEST_ASSIGNEE_SLUG = assigneeSlug("test@vtj.co.jp");

vi.mock("@/lib/require-user", () => ({
  requireUser: routeMocks.requireUser,
}));

vi.mock("@/lib/read-only", () => ({
  isReadOnlyMode: routeMocks.isReadOnlyMode,
}));

vi.mock("@/lib/gmail", () => ({
  getMessageDetail: routeMocks.getMessageDetail,
  sendGmailReply: routeMocks.sendGmailReply,
  archiveMessage: routeMocks.archiveMessage,
}));

vi.mock("@/lib/mailhub-send-as", () => ({
  assertSendAsAccepted: routeMocks.assertSendAsAccepted,
}));

async function importSendPost() {
  const mod = await import("@/app/api/mailhub/send/route");
  return mod.POST;
}

async function importSentGet() {
  const mod = await import("@/app/api/mailhub/test/sent/route");
  return mod.GET;
}

function createDetail(overrides: Partial<MessageDetail> = {}): MessageDetail {
  return {
    id: "msg-001",
    threadId: "thread-001",
    subject: "Order question",
    from: "Customer <customer@example.com>",
    messageId: "<original@example.com>",
    receivedAt: "2026-06-12T00:00:00.000Z",
    snippet: "Question",
    gmailLink: "https://mail.google.com/mail/u/0/#inbox/msg-001",
    plainTextBody: "Question",
    htmlBody: null,
    bodySource: "plain",
    bodyNotice: null,
    assigneeSlug: TEST_ASSIGNEE_SLUG,
    to: "VYPER SC <vyper_sc@vtj.co.jp>",
    cc: null,
    bcc: null,
    replyTo: null,
    deliveredTo: ["mailhub@vtj.co.jp", "vyper_sc@vtj.co.jp"],
    xOriginalTo: null,
    references: "<parent@example.com>",
    inReplyTo: null,
    listId: null,
    listPost: null,
    ...overrides,
    attachments: overrides.attachments ?? [],
  };
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/mailhub/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    messageId: "msg-001",
    bodyText: "返信本文です",
    clientRequestId: "client-001",
    postSendAction: "none",
    ...overrides,
  };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function mockSendAsOk() {
  routeMocks.assertSendAsAccepted.mockResolvedValue({
    ok: true,
    fromAlias: "vyper_sc@vtj.co.jp",
    acceptedAliases: ["vyper_sc@vtj.co.jp"],
    cache: "test",
    checkedAt: "2026-06-12T00:00:00.000Z",
  });
}

describe("POST /api/mailhub/send", () => {
  beforeEach(async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("MAILHUB_TEST_MODE", "1");
    vi.stubEnv("MAILHUB_READ_ONLY", "0");
    vi.stubEnv("GOOGLE_SHARED_INBOX_EMAIL", "mailhub@vtj.co.jp");
    routeMocks.requireUser.mockReset().mockResolvedValue({
      ok: true,
      user: { email: "test@vtj.co.jp", name: "Test" },
    });
    routeMocks.isReadOnlyMode.mockReset().mockReturnValue(false);
    routeMocks.getMessageDetail.mockReset().mockResolvedValue(createDetail());
    routeMocks.sendGmailReply.mockReset().mockResolvedValue({
      sentMessageId: "sent-real-001",
      threadId: "thread-001",
    });
    routeMocks.archiveMessage.mockReset().mockResolvedValue(undefined);
    routeMocks.assertSendAsAccepted.mockReset();
    mockSendAsOk();
    clearMailhubSendDuplicateGuard();
    clearTestSentReplyCaptures();
    await clearActivityLogs();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    clearMailhubSendDuplicateGuard();
    clearTestSentReplyCaptures();
    await clearActivityLogs();
  });

  it("applies guard order through auth, read-only, send flag, validation, and duplicate reserve", async () => {
    routeMocks.requireUser.mockResolvedValueOnce({ ok: false, status: 401, message: "no session" });
    let POST = await importSendPost();
    let res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(401);
    expect(await readJson(res)).toMatchObject({ ok: false, error: "unauthorized", message: "ログインが必要です" });
    expect(routeMocks.isReadOnlyMode).not.toHaveBeenCalled();

    routeMocks.requireUser.mockResolvedValue({ ok: true, user: { email: "test@vtj.co.jp" } });
    routeMocks.isReadOnlyMode.mockReturnValueOnce(true);
    POST = await importSendPost();
    res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(403);
    expect(await readJson(res)).toMatchObject({ error: "read_only", message: "READ ONLYのため送信できません" });
    expect(routeMocks.getMessageDetail).not.toHaveBeenCalled();

    vi.stubEnv("MAILHUB_TEST_MODE", "0");
    delete process.env.MAILHUB_SEND_ENABLED;
    POST = await importSendPost();
    res = await POST(makeRequest("{broken"));
    expect(res.status).toBe(403);
    expect(await readJson(res)).toMatchObject({ error: "send_disabled" });

    vi.stubEnv("MAILHUB_TEST_MODE", "1");
    POST = await importSendPost();
    res = await POST(makeRequest(validBody({ bodyText: "" })));
    expect(res.status).toBe(400);
    expect(await readJson(res)).toMatchObject({ error: "missing_body" });
    expect(routeMocks.getMessageDetail).not.toHaveBeenCalled();

    res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(200);
    res = await POST(makeRequest(validBody({ bodyText: "別本文" })));
    expect(res.status).toBe(409);
    expect(await readJson(res)).toMatchObject({
      error: "duplicate_send",
      duplicateKey: "clientRequestId",
      messageId: "msg-001",
      clientRequestId: "client-001",
    });
  });

  it("returns send_disabled outside TEST_MODE when the send flag is off", async () => {
    vi.stubEnv("MAILHUB_TEST_MODE", "0");
    delete process.env.MAILHUB_SEND_ENABLED;
    const POST = await importSendPost();

    const res = await POST(makeRequest(validBody()));

    expect(res.status).toBe(403);
    expect(await readJson(res)).toMatchObject({
      ok: false,
      error: "send_disabled",
      message: "Gmail送信はまだ有効化されていません",
    });
  });

  it("requires a durable Sheets send guard in production runtime", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MAILHUB_TEST_MODE", "0");
    vi.stubEnv("MAILHUB_SEND_ENABLED", "1");
    delete process.env.MAILHUB_ACTIVITY_STORE;
    delete process.env.MAILHUB_SHEETS_SPREADSHEET_ID;
    delete process.env.MAILHUB_SHEETS_CLIENT_EMAIL;
    delete process.env.MAILHUB_SHEETS_PRIVATE_KEY;
    const POST = await importSendPost();

    const res = await POST(makeRequest(validBody({ clientRequestId: "client-prod-guard" })));

    expect(res.status).toBe(503);
    expect(await readJson(res)).toMatchObject({
      error: "send_guard_unavailable",
      activityStore: "memory",
    });
    expect(routeMocks.getMessageDetail).not.toHaveBeenCalled();
  });

  it("captures TEST_MODE success and records reply_send activity", async () => {
    const POST = await importSendPost();

    const res = await POST(makeRequest(validBody({ clientRequestId: "client-success-001" })));

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await readJson(res)).toMatchObject({
      ok: true,
      status: "sent",
      action: "reply_send",
      sentMessageId: "sent-client-success-001",
      fromAlias: "vyper_sc@vtj.co.jp",
      fromChannelId: "vyper-amazon",
      to: "customer@example.com",
    });
    expect(routeMocks.sendGmailReply).not.toHaveBeenCalled();
    expect(listTestSentReplyCaptures()).toHaveLength(1);

    const logs = await getActivityLogs({ action: "reply_send" });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: "reply_send",
      messageId: "msg-001",
      metadata: expect.objectContaining({
        route: "gmail",
        status: "sent",
        toDomain: "example.com",
        bodyLength: 5,
        sendAsAccepted: true,
      }),
    });
    expect(JSON.stringify(logs[0]?.metadata)).not.toContain("customer@example.com");
    expect(JSON.stringify(logs[0]?.metadata)).not.toContain("返信本文です");
  });

  it("blocks unassigned replies before send-as and releases the duplicate reservation", async () => {
    routeMocks.getMessageDetail
      .mockResolvedValueOnce(createDetail({ assigneeSlug: null }))
      .mockResolvedValueOnce(createDetail({ assigneeSlug: TEST_ASSIGNEE_SLUG }));
    const POST = await importSendPost();

    let res = await POST(makeRequest(validBody({ clientRequestId: "client-owner-required" })));
    expect(res.status).toBe(409);
    expect(await readJson(res)).toMatchObject({
      error: "reply_lock_required",
      message: "担当してから送信してください",
      messageId: "msg-001",
      actorSlug: TEST_ASSIGNEE_SLUG,
      ownerSlug: null,
    });
    expect(routeMocks.assertSendAsAccepted).not.toHaveBeenCalled();
    expect(routeMocks.sendGmailReply).not.toHaveBeenCalled();
    expect(listTestSentReplyCaptures()).toHaveLength(0);

    res = await POST(makeRequest(validBody({ clientRequestId: "client-owner-required" })));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({ ok: true, clientRequestId: "client-owner-required" });
  });

  it("blocks replies assigned to another staff member before send-as", async () => {
    routeMocks.getMessageDetail.mockResolvedValueOnce(createDetail({
      assigneeSlug: assigneeSlug("other@vtj.co.jp"),
    }));
    const POST = await importSendPost();

    const res = await POST(makeRequest(validBody({ clientRequestId: "client-owner-other" })));

    expect(res.status).toBe(409);
    expect(await readJson(res)).toMatchObject({
      error: "reply_locked_by_other",
      message: "他の担当者が対応中です",
      messageId: "msg-001",
      actorSlug: TEST_ASSIGNEE_SLUG,
      ownerSlug: "other_at_vtj_co_jp",
    });
    expect(routeMocks.assertSendAsAccepted).not.toHaveBeenCalled();
    expect(routeMocks.sendGmailReply).not.toHaveBeenCalled();
    expect(listTestSentReplyCaptures()).toHaveLength(0);
  });

  it.each([
    ["TEST store-a", "shop-a@vtj.co.jp"],
    ["prod cricut-rakuten", "cricut_r@vtj.co.jp"],
    ["prod gopro-rakuten", "gopro_r@vtj.co.jp"],
    ["prod vyperglobal-rakuten", "vyper_r@vtj.co.jp"],
  ])("rejects Rakuten aliases before Gmail send: %s", async (_label, alias) => {
    routeMocks.getMessageDetail.mockResolvedValueOnce(createDetail({ cc: alias }));
    const POST = await importSendPost();

    const res = await POST(makeRequest(validBody({ clientRequestId: `client-rakuten-${alias.split("@")[0]}` })));

    expect(res.status).toBe(403);
    expect(await readJson(res)).toMatchObject({ error: "rakuten_reply_blocked" });
    expect(routeMocks.assertSendAsAccepted).not.toHaveBeenCalled();
  });

  it("allows a Gmail alias resolved from the incoming headers", async () => {
    routeMocks.getMessageDetail.mockResolvedValueOnce(createDetail({
      to: null,
      deliveredTo: ["mailhub@vtj.co.jp"],
      bcc: "VYPER SC <vyper_sc@vtj.co.jp>",
    }));
    const POST = await importSendPost();

    const res = await POST(makeRequest(validBody({ clientRequestId: "client-gmail-ok" })));

    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({ fromAlias: "vyper_sc@vtj.co.jp" });
  });

  it("returns sent_but_not_done when Done fails after send and does not fail the send response", async () => {
    routeMocks.archiveMessage.mockRejectedValueOnce(new Error("archive failed"));
    const POST = await importSendPost();

    const res = await POST(makeRequest(validBody({
      clientRequestId: "client-done-fail",
      postSendAction: "done",
    })));

    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({
      ok: true,
      status: "sent_but_not_done",
      done: {
        ok: false,
        error: "gmail_api_error",
        error_code: "unknown",
      },
    });
    expect(listTestSentReplyCaptures()[0]?.status).toBe("sent_but_not_done");
  });

  it("does not run Done when production Gmail send fails", async () => {
    vi.stubEnv("MAILHUB_TEST_MODE", "0");
    vi.stubEnv("MAILHUB_SEND_ENABLED", "1");
    routeMocks.assertSendAsAccepted.mockResolvedValueOnce({
      ok: true,
      fromAlias: "vyper_sc@vtj.co.jp",
      acceptedAliases: ["vyper_sc@vtj.co.jp"],
      cache: "miss",
      checkedAt: "2026-06-12T00:00:00.000Z",
    });
    routeMocks.sendGmailReply.mockRejectedValueOnce(Object.assign(new Error("send failed"), { code: 500 }));
    const POST = await importSendPost();

    const res = await POST(makeRequest(validBody({
      clientRequestId: "client-send-fail",
      postSendAction: "done",
    })));

    expect(res.status).toBe(500);
    expect(await readJson(res)).toMatchObject({ error: "gmail_api_error", error_code: "unknown" });
    expect(routeMocks.archiveMessage).not.toHaveBeenCalled();
  });

  it("keeps the duplicate reservation after a 429 send attempt and does not run Done", async () => {
    vi.stubEnv("MAILHUB_TEST_MODE", "0");
    vi.stubEnv("MAILHUB_SEND_ENABLED", "1");
    routeMocks.assertSendAsAccepted.mockResolvedValue({
      ok: true,
      fromAlias: "vyper_sc@vtj.co.jp",
      acceptedAliases: ["vyper_sc@vtj.co.jp"],
      cache: "miss",
      checkedAt: "2026-06-12T00:00:00.000Z",
    });
    routeMocks.sendGmailReply.mockRejectedValueOnce(Object.assign(new Error("rate limit 429"), { code: 429 }));
    const POST = await importSendPost();

    let res = await POST(makeRequest(validBody({
      clientRequestId: "client-429",
      postSendAction: "done",
    })));
    expect(res.status).toBe(429);
    expect(await readJson(res)).toMatchObject({ error: "gmail_api_error", error_code: "rate_limit_exceeded" });
    expect(routeMocks.archiveMessage).not.toHaveBeenCalled();

    res = await POST(makeRequest(validBody({
      clientRequestId: "client-429",
      postSendAction: "done",
    })));
    expect(res.status).toBe(409);
    expect(await readJson(res)).toMatchObject({ error: "duplicate_send", duplicateKey: "clientRequestId" });
    expect(routeMocks.sendGmailReply).toHaveBeenCalledTimes(1);
  });

  it("blocks cold-start duplicate sends from persisted send guard activity", async () => {
    vi.stubEnv("MAILHUB_TEST_MODE", "0");
    vi.stubEnv("MAILHUB_SEND_ENABLED", "1");
    const keys = buildMailhubSendDuplicateKeys({
      actorEmail: "test@vtj.co.jp",
      messageId: "msg-001",
      clientRequestId: "client-history",
      bodyText: "返信本文です",
    });
    await logAction({
      actorEmail: "test@vtj.co.jp",
      action: "reply_send_guard",
      messageId: "msg-001",
      label: "send_boundary",
      metadata: {
        clientRequestId: "client-history",
        requestKey: keys.requestKey,
        bodyKey: keys.bodyKey,
        bodyHash: keys.bodyHash,
      },
    });
    clearMailhubSendDuplicateGuard();
    const POST = await importSendPost();

    const res = await POST(makeRequest(validBody({ clientRequestId: "client-history" })));

    expect(res.status).toBe(409);
    expect(await readJson(res)).toMatchObject({
      error: "duplicate_send",
      duplicateKey: "clientRequestId",
    });
    expect(routeMocks.getMessageDetail).not.toHaveBeenCalled();
    expect(routeMocks.sendGmailReply).not.toHaveBeenCalled();
  });

  it("maps detail lookup failures to message_not_found in TEST_MODE", async () => {
    routeMocks.getMessageDetail.mockRejectedValueOnce(new Error("[TEST MODE] Detail not found for id: missing"));
    const POST = await importSendPost();

    const res = await POST(makeRequest(validBody({ messageId: "missing", clientRequestId: "client-missing" })));

    expect(res.status).toBe(404);
    expect(await readJson(res)).toMatchObject({
      error: "message_not_found",
      message: "メールが見つかりませんでした",
    });
  });

  it("returns send_as_unaccepted and releases the pre-send duplicate reservation", async () => {
    routeMocks.assertSendAsAccepted.mockResolvedValue({
      ok: false,
      error: "send_as_unaccepted",
      fromAlias: "vyper_sc@vtj.co.jp",
      acceptedAliases: [],
      message: "このFromはGmail send-asで未承認です",
      checkedAt: "2026-06-12T00:00:00.000Z",
    });
    const POST = await importSendPost();

    let res = await POST(makeRequest(validBody({ clientRequestId: "client-unaccepted" })));
    expect(res.status).toBe(403);
    expect(await readJson(res)).toMatchObject({ error: "send_as_unaccepted" });

    mockSendAsOk();
    res = await POST(makeRequest(validBody({ clientRequestId: "client-unaccepted" })));
    expect(res.status).toBe(200);
  });

  it("returns send_as_check_failed as 503", async () => {
    routeMocks.assertSendAsAccepted.mockResolvedValue({
      ok: false,
      error: "send_as_check_failed",
      fromAlias: "vyper_sc@vtj.co.jp",
      acceptedAliases: [],
      message: "Gmail send-as状態を確認できません",
      checkedAt: "2026-06-12T00:00:00.000Z",
    });
    const POST = await importSendPost();

    const res = await POST(makeRequest(validBody({ clientRequestId: "client-send-as-503" })));

    expect(res.status).toBe(503);
    expect(await readJson(res)).toMatchObject({
      error: "send_as_check_failed",
      message: "Gmail send-as状態を確認できません",
    });
  });

  it("returns duplicate_send for repeated requestKey and bodyKey", async () => {
    const POST = await importSendPost();

    let res = await POST(makeRequest(validBody({ clientRequestId: "client-dup-001", bodyText: "同一本文" })));
    expect(res.status).toBe(200);

    res = await POST(makeRequest(validBody({ clientRequestId: "client-dup-001", bodyText: "別本文" })));
    expect(res.status).toBe(409);
    expect(await readJson(res)).toMatchObject({ duplicateKey: "clientRequestId" });

    routeMocks.requireUser.mockResolvedValue({ ok: true, user: { email: "other@vtj.co.jp" } });
    res = await POST(makeRequest(validBody({ clientRequestId: "client-dup-002", bodyText: "同一本文" })));
    expect(res.status).toBe(409);
    expect(await readJson(res)).toMatchObject({ duplicateKey: "bodyHash" });
  });
});

describe("GET /api/mailhub/test/sent", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("MAILHUB_TEST_MODE", "1");
    clearTestSentReplyCaptures();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    clearTestSentReplyCaptures();
  });

  it("is TEST_MODE-only and filters captures with no-store", async () => {
    const POST = await importSendPost();
    routeMocks.requireUser.mockResolvedValue({ ok: true, user: { email: "test@vtj.co.jp" } });
    routeMocks.isReadOnlyMode.mockReturnValue(false);
    routeMocks.getMessageDetail.mockResolvedValue(createDetail());
    mockSendAsOk();
    await POST(makeRequest(validBody({ clientRequestId: "client-filter-001" })));
    await POST(makeRequest(validBody({ messageId: "msg-002", clientRequestId: "client-filter-002" })));

    const GET = await importSentGet();
    const res = await GET(new Request("http://localhost/api/mailhub/test/sent?clientRequestId=client-filter-001"));

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const json = await readJson(res);
    expect((json.captures as Array<{ clientRequestId: string }>).map((item) => item.clientRequestId)).toEqual([
      "client-filter-001",
    ]);

    vi.stubEnv("MAILHUB_TEST_MODE", "0");
    const forbidden = await GET(new Request("http://localhost/api/mailhub/test/sent"));
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get("cache-control")).toBe("no-store");
  });
});
