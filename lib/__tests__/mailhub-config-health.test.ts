import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const requiredAliases = [
    "cricut_y@vtj.co.jp",
    "cricut_sc@vtj.co.jp",
    "cricut_makeshop@vtj.co.jp",
    "gopro_y@vtj.co.jp",
    "gopro_order_yahoo@vtj.co.jp",
    "gopro_mp@vtj.co.jp",
    "vyperglobal_y@vtj.co.jp",
    "vyperglobal_sc@vtj.co.jp",
    "vyper_sc@vtj.co.jp",
    "datacolor_shopify@vtj.co.jp",
    "akgstore@vtj.co.jp",
    "sbd@vtj.co.jp",
    "secondhand@vtj.co.jp",
    "steiner-optics_sc@vtj.co.jp",
    "ebay@vtj.co.jp",
  ];
  return {
    requiredAliases,
    acceptedAliases: [...requiredAliases],
    checkedAt: "2026-06-12T00:00:00.000Z",
    readOnly: false,
    testMode: false,
    scopeInfo: {
      ok: true as const,
      scopes: ["https://www.googleapis.com/auth/gmail.send"],
      gmailModifyEnabled: false,
    } as
      | { ok: true; scopes: string[]; gmailModifyEnabled: boolean }
      | { ok: false; error: string },
    sendAsError: null as string | null,
    sendAsOverride: null as { unaccepted: string[] } | null,
    activityStoreType: "sheets" as "memory" | "file" | "sheets",
  };
});

vi.mock("@/lib/require-user", () => ({
  requireUser: async () => ({ ok: true, user: { email: "test@vtj.co.jp" } }),
  authErrorResponse: () => new Response(null, { status: 401 }),
}));

vi.mock("@/lib/configStore", () => ({
  getResolvedConfigStoreType: () => "memory",
  getResolvedSheetsConfig: () => ({ spreadsheetId: null, clientEmail: null, privateKey: null }),
}));

vi.mock("@/lib/labelRegistryStore", () => ({
  getLabelRegistryStore: () => ({ list: async () => [] }),
}));

vi.mock("@/lib/labelRulesStore", () => ({
  getLabelRulesStore: () => ({ getRules: async () => [] }),
}));

vi.mock("@/lib/assigneeRegistryStore", () => ({
  getAssigneeRegistryStore: () => ({ list: async () => [] }),
}));

vi.mock("@/lib/admin", () => ({
  getAdminDiagnostics: () => ({ raw: "", normalized: [], invalid: [], nonVtj: [] }),
  isAdminEmail: () => true,
}));

vi.mock("@/lib/read-only", () => ({
  isReadOnlyMode: () => state.readOnly,
}));

vi.mock("@/lib/test-mode", () => ({
  isTestMode: () => state.testMode,
}));

vi.mock("@/lib/mailhub-labels", () => ({
  MAILHUB_USER_LABEL_PREFIX: "MailHub/",
}));

vi.mock("@/lib/mailhub-env", () => ({
  getMailhubEnv: () => "local",
}));

vi.mock("@/lib/activityStore", () => ({
  getActivitySheetsConfigured: () => state.activityStoreType === "sheets",
  getRequestedActivityStoreType: () => state.activityStoreType,
  getResolvedActivityStoreType: () => state.activityStoreType,
}));

vi.mock("@/lib/gmail", () => ({
  getGmailScopeInfo: async () => state.scopeInfo,
}));

vi.mock("@/lib/mailhub-send-as", () => ({
  getRequiredGmailSendAsAliases: () => state.requiredAliases,
  getTestSendAsOverride: () => state.sendAsOverride,
  assertSendAsAccepted: async (input: { fromAlias: string }) => {
    if (state.sendAsError) {
      return {
        ok: false,
        error: "send_as_check_failed",
        fromAlias: input.fromAlias,
        acceptedAliases: [],
        message: state.sendAsError,
        checkedAt: state.checkedAt,
      };
    }
    const accepted = new Set(state.acceptedAliases);
    return {
      ok: accepted.has(input.fromAlias),
      error: accepted.has(input.fromAlias) ? undefined : "send_as_unaccepted",
      fromAlias: input.fromAlias,
      acceptedAliases: state.acceptedAliases,
      message: "このFromはGmail send-asで未承認です",
      checkedAt: state.checkedAt,
    };
  },
}));

import { GET } from "@/app/api/mailhub/config/health/route";

type HealthResponse = {
  gmailSendEnabled: boolean;
  gmailSendCapable: boolean | null;
  gmailSendReady: boolean;
  gmailSendBlockedReason:
    | null
    | "read_only"
    | "send_disabled"
    | "send_guard_unavailable"
    | "missing_scope"
    | "send_as_unaccepted"
    | "send_as_check_failed";
  sendAs: {
    checkedAt: string | null;
    cacheTtlMs: 300000;
    requiredCount: number;
    acceptedCount: number;
    requiredAliases: string[];
    acceptedAliases: string[];
    missingAliases: string[];
    error: string | null;
  };
  brainLedger: {
    requested: string;
    resolved: "memory" | "file" | "sheets";
    secretConfigured: boolean;
    sheetsConfigured: boolean;
  };
};

async function readHealth(): Promise<HealthResponse> {
  const response = await GET();
  expect(response.status).toBe(200);
  return (await response.json()) as HealthResponse;
}

describe("mailhub config health Gmail send", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.MAILHUB_SEND_ENABLED = "1";
    delete process.env.MAILHUB_BRAIN_LEDGER_STORE;
    delete process.env.MAILHUB_BRAIN_SECRET;
    delete process.env.MAILHUB_SHEETS_ID;
    delete process.env.MAILHUB_SHEETS_SPREADSHEET_ID;
    delete process.env.MAILHUB_SHEETS_CLIENT_EMAIL;
    delete process.env.MAILHUB_SHEETS_PRIVATE_KEY;
    state.acceptedAliases = [...state.requiredAliases];
    state.checkedAt = "2026-06-12T00:00:00.000Z";
    state.readOnly = false;
    state.testMode = false;
    state.scopeInfo = {
      ok: true,
      scopes: ["https://www.googleapis.com/auth/gmail.send"],
      gmailModifyEnabled: false,
    };
    state.sendAsError = null;
    state.sendAsOverride = null;
    state.activityStoreType = "sheets";
  });

  it("treats gmail.send scope as send-capable and ready when all gates pass", async () => {
    const health = await readHealth();

    expect(health.gmailSendCapable).toBe(true);
    expect(health.gmailSendReady).toBe(true);
    expect(health.gmailSendBlockedReason).toBeNull();
    expect(health.sendAs.requiredCount).toBe(15);
    expect(health.sendAs.acceptedCount).toBe(15);
    expect(health.brainLedger).toMatchObject({
      requested: "memory",
      resolved: "memory",
      secretConfigured: false,
      sheetsConfigured: false,
    });
  });

  it("reports Brain ledger store and worker secret visibility", async () => {
    process.env.MAILHUB_BRAIN_LEDGER_STORE = "file";
    process.env.MAILHUB_BRAIN_SECRET = "secret-1";

    const health = await readHealth();

    expect(health.brainLedger).toEqual({
      requested: "file",
      resolved: "file",
      secretConfigured: true,
      sheetsConfigured: false,
    });
  });

  it("reports Sheets-backed Brain ledger readiness", async () => {
    process.env.MAILHUB_BRAIN_LEDGER_STORE = "sheets";
    process.env.MAILHUB_SHEETS_SPREADSHEET_ID = "sheet-1";
    process.env.MAILHUB_SHEETS_CLIENT_EMAIL = "svc@example.com";
    process.env.MAILHUB_SHEETS_PRIVATE_KEY = "private-key";

    const health = await readHealth();

    expect(health.brainLedger).toMatchObject({
      requested: "sheets",
      resolved: "sheets",
      sheetsConfigured: true,
    });
  });

  it("returns fixed TEST_MODE health when no send-as override is missing", async () => {
    delete process.env.MAILHUB_SEND_ENABLED;
    state.testMode = true;
    state.readOnly = true;
    state.scopeInfo = { ok: false, error: "ignored_in_test_mode" };

    const health = await readHealth();

    expect(health.gmailSendEnabled).toBe(true);
    expect(health.gmailSendCapable).toBe(true);
    expect(health.gmailSendReady).toBe(true);
    expect(health.gmailSendBlockedReason).toBeNull();
    expect(health.sendAs.requiredAliases).toEqual(state.requiredAliases);
    expect(health.sendAs.acceptedAliases).toEqual(state.requiredAliases);
    expect(health.sendAs.missingAliases).toEqual([]);
  });

  it("reports TEST_MODE send-as override as missing aliases", async () => {
    state.testMode = true;
    state.sendAsOverride = { unaccepted: ["vyper_sc@vtj.co.jp"] };

    const health = await readHealth();

    expect(health.gmailSendReady).toBe(false);
    expect(health.gmailSendBlockedReason).toBe("send_as_unaccepted");
    expect(health.sendAs.missingAliases).toEqual(["vyper_sc@vtj.co.jp"]);
    expect(health.sendAs.acceptedAliases).not.toContain("vyper_sc@vtj.co.jp");
  });

  it("blocks non-TEST_MODE readiness when the durable Sheets send guard is unavailable", async () => {
    state.activityStoreType = "memory";

    const health = await readHealth();

    expect(health.gmailSendReady).toBe(false);
    expect(health.gmailSendBlockedReason).toBe("send_guard_unavailable");
  });

  it.each([
    {
      name: "read only",
      setup: () => {
        state.readOnly = true;
      },
      reason: "read_only",
    },
    {
      name: "send disabled",
      setup: () => {
        process.env.MAILHUB_SEND_ENABLED = "0";
      },
      reason: "send_disabled",
    },
    {
      name: "missing scope",
      setup: () => {
        state.scopeInfo = {
          ok: true,
          scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
          gmailModifyEnabled: false,
        };
      },
      reason: "missing_scope",
    },
    {
      name: "send-as unaccepted",
      setup: () => {
        state.acceptedAliases = state.requiredAliases.filter((alias) => alias !== "vyper_sc@vtj.co.jp");
      },
      reason: "send_as_unaccepted",
    },
    {
      name: "send-as check failed",
      setup: () => {
        state.sendAsError = "Gmail send-as状態を確認できません";
      },
      reason: "send_as_check_failed",
    },
  ] satisfies Array<{ name: string; setup: () => void; reason: HealthResponse["gmailSendBlockedReason"] }>)(
    "blocks non-TEST_MODE readiness for $name",
    async ({ setup, reason }) => {
      setup();

      const health = await readHealth();

      expect(health.gmailSendReady).toBe(false);
      expect(health.gmailSendBlockedReason).toBe(reason);
    },
  );
});
