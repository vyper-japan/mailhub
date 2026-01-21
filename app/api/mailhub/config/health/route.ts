import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { getResolvedConfigStoreType, getResolvedSheetsConfig } from "@/lib/configStore";
import { getLabelRegistryStore } from "@/lib/labelRegistryStore";
import { getLabelRulesStore } from "@/lib/labelRulesStore";
import { getAdminDiagnostics, isAdminEmail } from "@/lib/admin";
import { isReadOnlyMode } from "@/lib/read-only";
import { isTestMode } from "@/lib/test-mode";
import { MAILHUB_USER_LABEL_PREFIX } from "@/lib/mailhub-labels";
import { getGmailScopeInfo } from "@/lib/gmail";
import { getMailhubEnv } from "@/lib/mailhub-env";
import { getRequestedActivityStoreType, getResolvedActivityStoreType, getActivitySheetsConfigured } from "@/lib/activityStore";
import { getAssigneeRegistryStore } from "@/lib/assigneeRegistryStore";

export const dynamic = "force-dynamic";

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


