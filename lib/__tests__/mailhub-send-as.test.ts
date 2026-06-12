import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gmailMockState = vi.hoisted(() => ({
  listCalls: [] as Array<{ userId?: string }>,
  sendAs: [] as Array<{
    sendAsEmail?: string | null;
    verificationStatus?: string | null;
    isPrimary?: boolean | null;
  }>,
  throwList: false,
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
        settings: {
          sendAs: {
            list: async (args: { userId?: string }) => {
              gmailMockState.listCalls.push(args);
              if (gmailMockState.throwList) throw new Error("send_as_list_failed");
              return { data: { sendAs: gmailMockState.sendAs } };
            },
          },
        },
      },
    }),
  };
  return { google };
});

import { POST as resetTestStateRoute } from "@/app/api/mailhub/test/reset/route";
import {
  assertSendAsAccepted,
  getRequiredGmailSendAsAliases,
  getTestSendAsOverride,
  resetTestSendAsOverride,
} from "@/lib/mailhub-send-as";

describe("mailhub-send-as", () => {
  const originalEnv = { ...process.env };
  const g = globalThis as unknown as Record<string, unknown>;

  function setGmailEnv() {
    process.env.GOOGLE_SHARED_INBOX_REFRESH_TOKEN = "refresh-token";
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  }

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete g.window;
    delete globalThis.__mailhubSendAsCache;
    resetTestSendAsOverride();
    gmailMockState.listCalls = [];
    gmailMockState.sendAs = [];
    gmailMockState.throwList = false;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    delete g.window;
    delete globalThis.__mailhubSendAsCache;
    resetTestSendAsOverride();
  });

  it("accepts an API-accepted send-as alias and treats primary address as accepted", async () => {
    setGmailEnv();
    gmailMockState.sendAs = [
      { sendAsEmail: "mailhub@vtj.co.jp", isPrimary: true },
      { sendAsEmail: "VYPER_SC@vtj.co.jp", verificationStatus: "accepted" },
      { sendAsEmail: "pending@vtj.co.jp", verificationStatus: "pending" },
    ];

    const result = await assertSendAsAccepted({
      fromAlias: "VYPER SC <VYPER_SC@vtj.co.jp>",
      sharedInboxEmail: "mailhub@vtj.co.jp",
      testMode: false,
    });

    expect(result).toMatchObject({
      ok: true,
      fromAlias: "vyper_sc@vtj.co.jp",
      acceptedAliases: ["mailhub@vtj.co.jp", "vyper_sc@vtj.co.jp"],
      cache: "miss",
    });
    expect(gmailMockState.listCalls).toEqual([{ userId: "mailhub@vtj.co.jp" }]);
  });

  it("returns send_as_unaccepted when the alias is not accepted", async () => {
    setGmailEnv();
    gmailMockState.sendAs = [
      { sendAsEmail: "mailhub@vtj.co.jp", isPrimary: true },
      { sendAsEmail: "vyper_sc@vtj.co.jp", verificationStatus: "pending" },
    ];

    const result = await assertSendAsAccepted({
      fromAlias: "vyper_sc@vtj.co.jp",
      sharedInboxEmail: "mailhub@vtj.co.jp",
      testMode: false,
    });

    expect(result).toMatchObject({
      ok: false,
      error: "send_as_unaccepted",
      fromAlias: "vyper_sc@vtj.co.jp",
      acceptedAliases: ["mailhub@vtj.co.jp"],
    });
  });

  it("fails closed as send_as_check_failed when sendAs.list fails", async () => {
    setGmailEnv();
    gmailMockState.throwList = true;

    const result = await assertSendAsAccepted({
      fromAlias: "vyper_sc@vtj.co.jp",
      sharedInboxEmail: "mailhub@vtj.co.jp",
      testMode: false,
    });

    expect(result).toMatchObject({
      ok: false,
      error: "send_as_check_failed",
      fromAlias: "vyper_sc@vtj.co.jp",
      acceptedAliases: [],
    });
  });

  it("uses the prod Gmail 15 aliases in TEST_MODE and excludes TEST Rakuten aliases", async () => {
    process.env.MAILHUB_TEST_MODE = "1";

    const required = getRequiredGmailSendAsAliases();
    const result = await assertSendAsAccepted({
      fromAlias: "vyper_sc@vtj.co.jp",
      sharedInboxEmail: "mailhub@vtj.co.jp",
      testMode: true,
    });

    expect(required).toHaveLength(15);
    expect(required).not.toContain("shop-a@vtj.co.jp");
    expect(result).toMatchObject({
      ok: true,
      fromAlias: "vyper_sc@vtj.co.jp",
      acceptedAliases: required,
      cache: "test",
    });
  });

  it("applies sendAsOverride from test/reset and filters it to prod Gmail aliases", async () => {
    process.env.MAILHUB_TEST_MODE = "1";

    const response = await resetTestStateRoute(
      new Request("http://localhost/api/mailhub/test/reset", {
        method: "POST",
        body: JSON.stringify({
          sendAsOverride: {
            unaccepted: ["VYPER_SC@vtj.co.jp", "shop-a@vtj.co.jp", "unknown@example.com"],
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(getTestSendAsOverride()).toEqual({ unaccepted: ["vyper_sc@vtj.co.jp"] });

    const result = await assertSendAsAccepted({
      fromAlias: "vyper_sc@vtj.co.jp",
      sharedInboxEmail: "mailhub@vtj.co.jp",
      testMode: true,
    });

    expect(result).toMatchObject({
      ok: false,
      error: "send_as_unaccepted",
      fromAlias: "vyper_sc@vtj.co.jp",
    });
    expect(result.acceptedAliases).not.toContain("vyper_sc@vtj.co.jp");
  });

  it("clears sendAsOverride when test/reset receives no override", async () => {
    process.env.MAILHUB_TEST_MODE = "1";
    await resetTestStateRoute(
      new Request("http://localhost/api/mailhub/test/reset", {
        method: "POST",
        body: JSON.stringify({ sendAsOverride: { unaccepted: ["vyper_sc@vtj.co.jp"] } }),
      }),
    );
    expect(getTestSendAsOverride()).toEqual({ unaccepted: ["vyper_sc@vtj.co.jp"] });

    const response = await resetTestStateRoute(
      new Request("http://localhost/api/mailhub/test/reset", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(200);
    expect(getTestSendAsOverride()).toBeNull();
  });

  it("caches non-TEST_MODE sendAs.list results and bypasses cache on forceRefresh", async () => {
    setGmailEnv();
    gmailMockState.sendAs = [{ sendAsEmail: "vyper_sc@vtj.co.jp", verificationStatus: "accepted" }];

    const first = await assertSendAsAccepted({
      fromAlias: "vyper_sc@vtj.co.jp",
      sharedInboxEmail: "mailhub@vtj.co.jp",
      testMode: false,
    });
    const second = await assertSendAsAccepted({
      fromAlias: "vyper_sc@vtj.co.jp",
      sharedInboxEmail: "MAILHUB@vtj.co.jp",
      testMode: false,
    });
    const third = await assertSendAsAccepted({
      fromAlias: "vyper_sc@vtj.co.jp",
      sharedInboxEmail: "mailhub@vtj.co.jp",
      testMode: false,
      forceRefresh: true,
    });

    expect(first).toMatchObject({ ok: true, cache: "miss" });
    expect(second).toMatchObject({ ok: true, cache: "hit" });
    expect(third).toMatchObject({ ok: true, cache: "miss" });
    expect(gmailMockState.listCalls).toEqual([
      { userId: "mailhub@vtj.co.jp" },
      { userId: "mailhub@vtj.co.jp" },
    ]);
  });
});
