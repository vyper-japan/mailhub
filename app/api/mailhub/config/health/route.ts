import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { getResolvedConfigStoreType, getResolvedSheetsConfig } from "@/lib/configStore";
import { getLabelRegistryStore } from "@/lib/labelRegistryStore";
import { getLabelRulesStore } from "@/lib/labelRulesStore";
import { getAdminDiagnostics, isAdminEmail } from "@/lib/admin";
import { isReadOnlyMode } from "@/lib/read-only";
import { isTestMode } from "@/lib/test-mode";
import { MAILHUB_USER_LABEL_PREFIX } from "@/lib/mailhub-labels";
import { getGmailScopeInfo, type GmailScopeInfo } from "@/lib/gmail";
import { getMailhubEnv } from "@/lib/mailhub-env";
import { getRequestedActivityStoreType, getResolvedActivityStoreType, getActivitySheetsConfigured } from "@/lib/activityStore";
import { getAssigneeRegistryStore } from "@/lib/assigneeRegistryStore";
import {
  assertSendAsAccepted,
  getRequiredGmailSendAsAliases,
  getTestSendAsOverride,
} from "@/lib/mailhub-send-as";

export const dynamic = "force-dynamic";

const GMAIL_SEND_AS_CACHE_TTL_MS = 300_000 as const;
const GMAIL_SEND_SCOPES = new Set([
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://mail.google.com/",
]);

type GmailSendBlockedReason =
  | null
  | "read_only"
  | "send_disabled"
  | "missing_scope"
  | "send_as_unaccepted"
  | "send_as_check_failed";

type GmailSendHealth = {
  gmailSendEnabled: boolean;
  gmailSendCapable: boolean | null;
  gmailSendReady: boolean;
  gmailSendBlockedReason: GmailSendBlockedReason;
  sendAs: {
    checkedAt: string | null;
    cacheTtlMs: typeof GMAIL_SEND_AS_CACHE_TTL_MS;
    requiredCount: number;
    acceptedCount: number;
    requiredAliases: string[];
    acceptedAliases: string[];
    missingAliases: string[];
    error: string | null;
  };
};

type SendAsHealthSnapshot = {
  acceptedAliases: string[];
  missingAliases?: string[];
  checkedAt: string | null;
  error: string | null;
};

function normalizedAliases(values: string[]): string[] {
  return values.map((value) => value.toLowerCase());
}

function gmailSendEnabledFor(testMode: boolean): boolean {
  return testMode || process.env.MAILHUB_SEND_ENABLED === "1";
}

function getGmailSendCapable(scopeInfo: GmailScopeInfo, testMode: boolean): boolean | null {
  if (testMode) return true;
  if (!scopeInfo.ok) return null;
  return scopeInfo.scopes.some((scope) => GMAIL_SEND_SCOPES.has(scope));
}

function getGmailSendBlockedReason(input: {
  testMode: boolean;
  gmailSendEnabled: boolean;
  readOnly: boolean;
  gmailSendCapable: boolean | null;
  missingAliases: string[];
  sendAsError: string | null;
}): GmailSendBlockedReason {
  if (input.testMode) {
    if (input.sendAsError) return "send_as_check_failed";
    return input.missingAliases.length > 0 ? "send_as_unaccepted" : null;
  }
  if (input.readOnly) return "read_only";
  if (!input.gmailSendEnabled) return "send_disabled";
  if (input.gmailSendCapable !== true) return "missing_scope";
  if (input.sendAsError) return "send_as_check_failed";
  if (input.missingAliases.length > 0) return "send_as_unaccepted";
  return null;
}

function buildGmailSendHealth(input: {
  testMode: boolean;
  readOnly: boolean;
  gmailSendEnabled: boolean;
  scopeInfo: GmailScopeInfo;
  requiredAliases: string[];
  acceptedAliases: string[];
  missingAliases?: string[];
  checkedAt: string | null;
  sendAsError: string | null;
}): GmailSendHealth {
  const requiredAliases = normalizedAliases(input.requiredAliases);
  const requiredSet = new Set(requiredAliases);
  const acceptedSet = new Set(normalizedAliases(input.acceptedAliases));
  const acceptedAliases = requiredAliases.filter((alias) => acceptedSet.has(alias));
  const missingAliases =
    input.missingAliases !== undefined
      ? normalizedAliases(input.missingAliases).filter((alias) => requiredSet.has(alias))
      : requiredAliases.filter((alias) => !acceptedSet.has(alias));
  const gmailSendEnabled = input.testMode ? true : input.gmailSendEnabled;
  const gmailSendCapable = getGmailSendCapable(input.scopeInfo, input.testMode);
  const gmailSendReady = input.testMode
    ? missingAliases.length === 0 && !input.sendAsError
    : gmailSendEnabled &&
      !input.readOnly &&
      gmailSendCapable === true &&
      missingAliases.length === 0 &&
      !input.sendAsError;

  return {
    gmailSendEnabled,
    gmailSendCapable,
    gmailSendReady,
    gmailSendBlockedReason: getGmailSendBlockedReason({
      testMode: input.testMode,
      gmailSendEnabled,
      readOnly: input.readOnly,
      gmailSendCapable,
      missingAliases,
      sendAsError: input.sendAsError,
    }),
    sendAs: {
      checkedAt: input.checkedAt,
      cacheTtlMs: GMAIL_SEND_AS_CACHE_TTL_MS,
      requiredCount: requiredAliases.length,
      acceptedCount: acceptedAliases.length,
      requiredAliases,
      acceptedAliases,
      missingAliases,
      error: input.sendAsError,
    },
  };
}

function getTestModeSendAsSnapshot(requiredAliases: string[]): SendAsHealthSnapshot {
  const requiredSet = new Set(requiredAliases);
  const override = getTestSendAsOverride();
  const unaccepted = override?.unaccepted ?? [];
  const unacceptedSet = new Set(unaccepted);
  return {
    acceptedAliases: requiredAliases.filter((alias) => !unacceptedSet.has(alias)),
    missingAliases: unaccepted.filter((alias) => requiredSet.has(alias)),
    checkedAt: new Date().toISOString(),
    error: null,
  };
}

async function getSendAsHealthSnapshot(input: {
  testMode: boolean;
  requiredAliases: string[];
  sharedInboxEmail: string;
}): Promise<SendAsHealthSnapshot> {
  if (input.testMode) {
    return getTestModeSendAsSnapshot(input.requiredAliases);
  }

  const result = await assertSendAsAccepted({
    fromAlias: input.requiredAliases[0] ?? input.sharedInboxEmail,
    sharedInboxEmail: input.sharedInboxEmail,
    testMode: false,
  });

  return {
    acceptedAliases: result.acceptedAliases,
    checkedAt: result.checkedAt,
    error: !result.ok && result.error === "send_as_check_failed" ? result.message : null,
  };
}

async function getGmailSendHealth(input: {
  testMode: boolean;
  readOnly: boolean;
  scopeInfo: GmailScopeInfo;
  sharedInboxEmail: string;
}): Promise<GmailSendHealth> {
  const requiredAliases = getRequiredGmailSendAsAliases();
  const sendAs = await getSendAsHealthSnapshot({
    testMode: input.testMode,
    requiredAliases,
    sharedInboxEmail: input.sharedInboxEmail,
  });
  return buildGmailSendHealth({
    testMode: input.testMode,
    readOnly: input.readOnly,
    gmailSendEnabled: gmailSendEnabledFor(input.testMode),
    scopeInfo: input.scopeInfo,
    requiredAliases,
    acceptedAliases: sendAs.acceptedAliases,
    missingAliases: sendAs.missingAliases,
    checkedAt: sendAs.checkedAt,
    sendAsError: sendAs.error,
  });
}

export async function GET() {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);

  const env = getMailhubEnv();
  const configStoreType = getResolvedConfigStoreType();
  const activityStoreType = getResolvedActivityStoreType();
  const isAdmin = isAdminEmail(authResult.user.email);
  const readOnly = isReadOnlyMode();
  const testMode = isTestMode();

  const adminDiag = getAdminDiagnostics();

  let labelsCount = 0;
  let rulesCount = 0;
  let assigneesCount = 0;
  let readOk = true;
  let readError: string | null = null;
  try {
    const [labels, rules, assignees] = await Promise.all([
      getLabelRegistryStore().list(),
      getLabelRulesStore().getRules(),
      getAssigneeRegistryStore().list().catch(() => []), // Step 79: assigneesCount
    ]);
    labelsCount = labels.length;
    rulesCount = rules.length;
    assigneesCount = assignees.length;
  } catch (e) {
    readOk = false;
    readError = e instanceof Error ? e.message : String(e);
  }

  const sheetsCfg = getResolvedSheetsConfig();
  const sheetsConfigured = Boolean(sheetsCfg.spreadsheetId && sheetsCfg.clientEmail && sheetsCfg.privateKey);

  // sheets疎通（timeout付き、readのみ）
  let sheetsOk: boolean | null = null;
  let sheetsDetail: string | null = null;
  if (configStoreType === "sheets") {
    if (!sheetsConfigured) {
      sheetsOk = false;
      sheetsDetail = "sheets_config_incomplete";
    } else {
      try {
        const { createConfigStore } = await import("@/lib/configStore");
        const probe = createConfigStore<string[]>({
          key: "__mailhub_probe",
          empty: [],
          forceType: "sheets",
          sheets: {
            sheetName: process.env.MAILHUB_SHEETS_TAB_LABELS || "ConfigLabels",
            mode: "json_blob",
            headers: ["probe"],
            toRows: () => [],
            fromRows: () => [],
          },
        });
        const h = await probe.health();
        sheetsOk = h.ok;
        sheetsDetail = h.detail ?? null;
      } catch (e) {
        sheetsOk = false;
        sheetsDetail = e instanceof Error ? e.message : String(e);
      }
    }
  }

  const shared = process.env.GOOGLE_SHARED_INBOX_EMAIL ?? "";
  const sharedInboxEmailMasked = shared
    ? shared.replace(/^(.{0,3}).*(@.*)$/, (_m, a: string, b: string) => `${a}***${b}`)
    : null;

  // Gmail scopes（tokeninfoで推定）
  const scopeInfo = await getGmailScopeInfo();
  const gmailScopes = scopeInfo.ok ? scopeInfo.scopes : null;
  const gmailModifyEnabled = scopeInfo.ok ? scopeInfo.gmailModifyEnabled : null;
  const gmailScopeError = scopeInfo.ok ? null : scopeInfo.error;
  const gmailSendHealth = await getGmailSendHealth({
    testMode,
    readOnly,
    scopeInfo,
    sharedInboxEmail: shared,
  });

  // Step 61: Team候補一覧（TEST_MODEでは固定候補）
  let teamMembers: Array<{ email: string; name: string | null }> = [];
  if (testMode) {
    // TEST_MODE: 固定のE2E用候補を返す
    teamMembers = [
      { email: "other@vtj.co.jp", name: "Other User" },
      { email: "member2@vtj.co.jp", name: "Member Two" },
    ];
  } else {
    // 本番: MAILHUB_TEAM_MEMBERS から読み込む
    const raw = process.env.MAILHUB_TEAM_MEMBERS ?? "";
    if (raw.trim()) {
      const entries = raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
      for (const entry of entries) {
        // "Display Name <email>" または "email" 形式を許容
        const match = entry.match(/^(.+?)\s*<(.+?)>$/) || entry.match(/^(\S+@\S+)$/);
        if (match) {
          const email = (match[2] ?? match[1]).toLowerCase().trim();
          const name = match[2] ? match[1].trim() : null;
          // @vtj.co.jp 以外は除外（安全）
          if (email.endsWith("@vtj.co.jp")) {
            teamMembers.push({ email, name });
          }
        }
      }
    }
  }

  return NextResponse.json(
    {
      env,
      // backward-compat: storeType はConfig Storeのresolved値
      storeType: configStoreType,
      configStore: {
        requested: (process.env.MAILHUB_CONFIG_STORE ?? "").trim() || null,
        resolved: configStoreType,
        sheetsConfigured,
        sheetsOk,
        sheetsDetail,
      },
      activityStore: {
        requested: getRequestedActivityStoreType(),
        resolved: activityStoreType,
        sheetsConfigured: getActivitySheetsConfigured(),
      },
      isAdmin,
      readOnly,
      gmailScopes,
      gmailModifyEnabled,
      gmailScopeError,
      ...gmailSendHealth,
      sharedInboxEmailMasked,
      labelPrefix: MAILHUB_USER_LABEL_PREFIX,
      writeGuards: {
        readOnly,
        isAdmin,
        testMode,
        productionTestModeForcedOff: process.env.NODE_ENV === "production",
      },
      adminsConfigured: Boolean(adminDiag.raw),
      adminInvalidCount: adminDiag.invalid.length,
      adminNonVtjCount: adminDiag.nonVtj.length,
      readOk,
      readError,
      labelsCount,
      rulesCount,
      assigneesCount, // Step 79: 担当者名簿の件数
      sheets: configStoreType === "sheets" ? { configured: sheetsConfigured, ok: sheetsOk, detail: sheetsDetail } : null,
      teamMembers,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
