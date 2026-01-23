import "server-only";
import { NextResponse } from "next/server";
import { isTestMode, assertTestMode } from "@/lib/test-mode";
import { resetTestState, setTestFailConfig, setTestActionDelayMs } from "@/lib/gmail";
import { resetLabelRulesForTest } from "@/lib/labelRulesStore";
import { resetRegisteredLabelsForTest } from "@/lib/labelRegistryStore";
import { resetAssigneeRulesForTest } from "@/lib/assigneeRulesStore";
import { clearActivityLogs, type AuditLogEntry } from "@/lib/audit-log";
import { setTestReadOnlyMode } from "@/lib/read-only";
import { getTeamStore } from "@/lib/teamStore";
import { getAssigneeRegistryStore } from "@/lib/assigneeRegistryStore";

export const dynamic = "force-dynamic";

/**
 * テストモードの状態をリセットするAPI（テストモード限定）
 * E2EテストのbeforeEachで呼び出して、毎回同じ初期状態から開始する
 * 
 * リクエストボディ（オプション）:
 * {
 *   fail?: {
 *     endpoint: "mute" | "archive" | "assign" | "status";
 *     ids: string[];
 *   }
 * }
 */
export async function POST(req: Request) {
  // テストモードでない場合は403を返す
  if (!isTestMode()) {
    return NextResponse.json({ error: "test_mode_only" }, { status: 403 });
  }

  try {
    assertTestMode("test/reset");
    
    // リクエストボディを解析（オプション）
    let failConfig: { endpoint: string; ids: string[] } | null = null;
    let seedActivityLogs: AuditLogEntry[] | null = null;
    let actionDelayMs: number | null = null;
    let readOnly: boolean | null = null;
    try {
      const body = await req.json();
      if (body.fail) {
        failConfig = body.fail;
      }
      if (Array.isArray(body.seedActivityLogs)) {
        seedActivityLogs = body.seedActivityLogs.filter(
          (entry: unknown): entry is AuditLogEntry =>
            entry !== null &&
            typeof entry === "object" &&
            "timestamp" in entry &&
            "actorEmail" in entry &&
            "action" in entry &&
            "messageId" in entry &&
            typeof (entry as Record<string, unknown>).timestamp === "string" &&
            typeof (entry as Record<string, unknown>).actorEmail === "string" &&
            typeof (entry as Record<string, unknown>).action === "string" &&
            typeof (entry as Record<string, unknown>).messageId === "string",
        );
      }
      if (typeof body.actionDelayMs === "number" && body.actionDelayMs >= 0) {
        actionDelayMs = body.actionDelayMs;
      }
      if (typeof body.readOnly === "boolean") {
        readOnly = body.readOnly;
      }
    } catch {
      // ボディがない場合は無視
    }
    
    await resetTestState();
    // Step 23: ラベル/ルールも初期化（E2Eで毎回同じ状態）
    await resetRegisteredLabelsForTest();
    await resetLabelRulesForTest();
    await resetAssigneeRulesForTest();

    // Step 61: Teamメンバーをseed（E2E用固定候補）
    const teamStore = getTeamStore("memory");
    // 既存をクリアして固定メンバーを追加
    const existingTeam = await teamStore.list();
    for (const member of existingTeam) {
      await teamStore.delete(member.email).catch(() => {});
    }
    await teamStore.create({ email: "other@vtj.co.jp", name: "Other User" }).catch(() => {});
    await teamStore.create({ email: "member2@vtj.co.jp", name: "Member Two" }).catch(() => {});

    // Step 113: AssigneeRegistryにもseed（サイドバーTeam表示用）
    const assigneeStore = getAssigneeRegistryStore("memory");
    await assigneeStore.replaceAll([
      { email: "taka@vtj.co.jp", displayName: "Taka" },
      { email: "maki@vtj.co.jp", displayName: "Maki" },
      { email: "yuka@vtj.co.jp", displayName: "Yuka" },
      { email: "eri_s@vtj.co.jp", displayName: "Eri" },
      { email: "kumiko@vtj.co.jp", displayName: "Kumiko" },
    ]).catch(() => {});
    
    // Activityログをクリアしてからseedを投入
    await clearActivityLogs();
    if (seedActivityLogs && seedActivityLogs.length > 0) {
      const store = (await import("@/lib/activityStore")).getActivityStore();
      for (const entry of seedActivityLogs) {
        try {
          await store.append(entry);
        } catch {
          // 個別のエラーは無視（best-effort）
        }
      }
    }
    
    // 失敗設定を適用
    if (failConfig) {
      setTestFailConfig(failConfig.endpoint, failConfig.ids);
    } else {
      setTestFailConfig(null, []); // クリア
    }
    
    // アクション遅延設定を適用
    setTestActionDelayMs(actionDelayMs);

    // READ ONLY（TEST_MODE限定の上書き）
    setTestReadOnlyMode(readOnly);
    
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "reset_failed", message: msg },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

