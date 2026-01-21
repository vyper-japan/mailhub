import "server-only";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-user";
import { SLA_RULES, getSLAStatus, getSLAActionName } from "@/lib/slaRules";
import { getAlertProvider, shouldSkipAlert, type AlertPayload } from "@/lib/alerts";
import { buildGmailLink } from "@/lib/gmail";
import { listCandidatesByQuery } from "@/lib/gmail-alerts";
import { formatElapsedTime, getElapsedMs } from "@/lib/time-utils";
import { logAction } from "@/lib/audit-log";
import { mustGetEnv } from "@/lib/env";
import { isTestMode } from "@/lib/test-mode";
import { isReadOnlyMode } from "@/lib/read-only";
import type { InboxListMessage } from "@/lib/mailhub-types";

export const dynamic = "force-dynamic";

// Step 68: MailHub直リンク用ベースURL取得
function getMailhubBaseUrl(): string {
  // 優先順位: MAILHUB_PUBLIC_BASE_URL > NEXTAUTH_URL > localhost(dev/test)
  const publicUrl = process.env.MAILHUB_PUBLIC_BASE_URL;
  if (publicUrl) return publicUrl.replace(/\/$/, "");
  
  const nextAuthUrl = process.env.NEXTAUTH_URL;
  if (nextAuthUrl) return nextAuthUrl.replace(/\/$/, "");
  
  // productionでは未設定の場合、空文字を返してURL生成をスキップ
  if (process.env.NODE_ENV === "production") {
    // TODO: MAILHUB_PUBLIC_BASE_URL または NEXTAUTH_URL を設定してください
    return "";
  }
  
  return "http://localhost:3000";
}

// Step 68: SLA Focus直リンクを生成
// Step 71: take オプション追加（担当UIを開く）
function buildMailhubSlaUrl(baseUrl: string, options?: { criticalOnly?: boolean; label?: string; messageId?: string; unassigned?: boolean; take?: boolean }): string {
  if (!baseUrl) return "";
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("sla", "1");
    if (options?.criticalOnly) {
      url.searchParams.set("slaLevel", "critical");
    }
    // Step 69: unassignedの場合はlabelをunassignedに
    if (options?.unassigned) {
      url.searchParams.set("label", "unassigned");
    } else if (options?.label) {
      url.searchParams.set("label", options.label);
    }
    if (options?.messageId) {
      url.searchParams.set("id", options.messageId);
    }
    // Step 71: take=1 で担当UIを開く
    if (options?.take) {
      url.searchParams.set("take", "1");
    }
    return url.toString();
  } catch {
    return "";
  }
}

/**
 * SLAアラート実行API
 * POST /api/mailhub/alerts/run
 * GET /api/mailhub/alerts/run?dryRun=1&scope=todo
 */
export async function GET(req: Request): Promise<NextResponse> {
  return handleRequest(req, true);
}

export async function POST(req: Request): Promise<NextResponse> {
  return handleRequest(req, false);
}

async function handleRequest(req: Request, isGet: boolean): Promise<NextResponse> {
  // POST時だけbodyを1回だけ読む（Request bodyは複数回読めない）
  const rawBody = !isGet ? ((await req.json().catch(() => null)) as unknown) : null;
  const body = rawBody && typeof rawBody === "object" ? (rawBody as Record<string, unknown>) : {};

  // test modeでは認可をスキップ（E2Eテスト用）
  if (!isTestMode()) {
    // 認可チェック（MAILHUB_ALERTS_SECRET）
    const authHeader = req.headers.get("authorization");
    const secret = process.env.MAILHUB_ALERTS_SECRET;
    const isProduction = process.env.NODE_ENV === "production";

    // productionではsecret必須
    if (isProduction) {
      if (!secret) {
        return NextResponse.json(
          { error: "unauthorized", message: "MAILHUB_ALERTS_SECRET not configured" },
          { status: 401 }
        );
      }
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return NextResponse.json(
          { error: "unauthorized", message: "Authorization header required" },
          { status: 401 }
        );
      }
      const providedSecret = authHeader.substring(7);
      if (providedSecret !== secret) {
        return NextResponse.json(
          { error: "unauthorized", message: "Invalid secret" },
          { status: 401 }
        );
      }
    } else {
      // dev/staging: secretがあればチェック、なければ認証ユーザーでdryRunのみ許可
      if (secret) {
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          return NextResponse.json(
            { error: "unauthorized", message: "Authorization header required" },
            { status: 401 }
          );
        }
        const providedSecret = authHeader.substring(7);
        if (providedSecret !== secret) {
          return NextResponse.json(
            { error: "unauthorized", message: "Invalid secret" },
            { status: 401 }
          );
        }
      } else {
        // secretが無い場合は認証ユーザーでdryRunのみ許可
        const authResult = await requireUser();
        if (!authResult.ok) {
          return NextResponse.json(
            { error: authResult.status === 401 ? "unauthorized" : "forbidden", message: authResult.message },
            { status: authResult.status }
          );
        }
        // dryRunでない場合は認証ユーザーでも拒否（secret必須）
        const url = new URL(req.url);
        const dryRun = url.searchParams.get("dryRun") === "1";
        if (!dryRun && !isGet) {
          if (body.dryRun !== true) {
            return NextResponse.json(
              { error: "unauthorized", message: "dryRun=true required when MAILHUB_ALERTS_SECRET is not set" },
              { status: 401 }
            );
          }
        }
      }
    }
  }

  const url = new URL(req.url);
  let dryRun = url.searchParams.get("dryRun") === "1";
  let scopeParam = url.searchParams.get("scope") || "all";
  let assigneeParam = url.searchParams.get("assignee") || "any"; // Step 69
  
  if (!isGet) {
    if (body.dryRun === true) {
      dryRun = true;
    }
    if (typeof body.scope === "string") {
      scopeParam = body.scope;
    }
    if (typeof body.assignee === "string") {
      assigneeParam = body.assignee;
    }
  }

  const scope = scopeParam === "todo" || scopeParam === "waiting" || scopeParam === "all" 
    ? scopeParam 
    : "all";
  
  // Step 69: assignee フィルタ（any | unassigned）
  const assigneeFilter = assigneeParam === "unassigned" ? "unassigned" : "any";

  // READ ONLY: dryRunのみ許可（通知送信などの副作用を防ぐ）
  if (isReadOnlyMode() && !dryRun) {
    return NextResponse.json(
      { error: "read_only", message: "READ ONLYのため実行できません（dryRunのみ）" },
      { status: 403 },
    );
  }

  try {
    const result = await runSLAAlerts(scope, dryRun, assigneeFilter);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "alert_failed", message: msg },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

async function runSLAAlerts(
  scope: "todo" | "waiting" | "all",
  dryRun: boolean,
  assigneeFilter: "any" | "unassigned" = "any" // Step 69
): Promise<{
  sent: number;
  skipped: number;
  candidates: number;
  truncated: boolean;
  preview?: AlertPayload;
  openUrl?: string;
  openCriticalUrl?: string;
  openUnassignedUrl?: string; // Step 69
}> {
  const baseUrl = getMailhubBaseUrl();
  const rules = scope === "all" 
    ? SLA_RULES 
    : SLA_RULES.filter((r) => r.type === scope);

  const sharedInboxEmail = mustGetEnv("GOOGLE_SHARED_INBOX_EMAIL");
  
  let totalCandidates = 0;
  let totalSent = 0;
  let totalSkipped = 0;
  let anyTruncated = false;
  const allItems: AlertPayload["items"] = [];

  for (const rule of rules) {
    // Gmail検索で候補を絞る（ページング対応、古いメールが漏れない）
    const result = await listCandidatesByQuery({
      q: rule.gmailQuery,
      maxPages: 10,
      maxTotal: 1500,
    });

    const candidates = result.messages;
    if (result.truncated) {
      anyTruncated = true;
    }

    totalCandidates += candidates.length;

    // SLAステータスを判定
    const violations: Array<{
      message: InboxListMessage;
      status: "warn" | "critical";
    }> = [];

    for (const msg of candidates) {
      const status = getSLAStatus(msg.receivedAt, rule);
      if (status === "warn" || status === "critical") {
        violations.push({
          message: msg,
          status,
        });
      }
    }

    // 重複防止チェック
    const toSend: typeof violations = [];
    for (const violation of violations) {
      const actionName = getSLAActionName(rule.type, violation.status);
      const shouldSkip = await shouldSkipAlert(violation.message.id, actionName);
      
      if (shouldSkip) {
        totalSkipped++;
      } else {
        toSend.push(violation);
      }
    }

    // AlertPayloadに追加
    for (const violation of toSend) {
      // Step 69: assigneeFilter による絞り込み
      const isUnassigned = !violation.message.assigneeSlug;
      if (assigneeFilter === "unassigned" && !isUnassigned) {
        continue; // 割当済みはスキップ
      }
      
      const elapsedMs = getElapsedMs(violation.message.receivedAt);
      const age = formatElapsedTime(elapsedMs);
      
      allItems.push({
        subject: violation.message.subject || "(no subject)",
        age,
        assignee: violation.message.assigneeSlug 
          ? violation.message.assigneeSlug.split("_")[0] 
          : undefined,
        gmailLink: buildGmailLink(sharedInboxEmail, violation.message.messageId, violation.message.threadId),
        status: violation.status,
        // Step 68: MailHub直リンク
        url: buildMailhubSlaUrl(baseUrl, {
          criticalOnly: violation.status === "critical",
          label: rule.type,
          messageId: violation.message.id,
        }),
        // Step 71: Take導線（担当UIを開く）
        takeUrl: buildMailhubSlaUrl(baseUrl, {
          criticalOnly: violation.status === "critical",
          label: rule.type,
          messageId: violation.message.id,
          take: true,
        }),
      });

      // Activityログに記録（dryRun=falseの場合のみ）
      if (!dryRun) {
        const actionName = getSLAActionName(rule.type, violation.status);
        await logAction({
          actorEmail: "system@mailhub",
          action: actionName,
          messageId: violation.message.id,
          metadata: {
            ruleType: rule.type,
            status: violation.status,
            age,
          },
        }).catch(() => {
          // ログ失敗は無視
        });
        totalSent++;
      }
    }

    // dryRunの場合はここでカウント
    if (dryRun) {
      totalSent += toSend.length;
    }
  }

  // アラート送信（dryRun=falseの場合のみ）
  const warnCount = allItems.filter((i) => i.status === "warn").length;
  const criticalCount = allItems.filter((i) => i.status === "critical").length;
  
  let alertText = `Todo超過: warn ${warnCount}件 / critical ${criticalCount}件`;
  // Step 69: 未割当フィルタの場合はその旨を明記
  if (assigneeFilter === "unassigned") {
    alertText += "\n📋 表示: 未割当のみ";
  }
  if (anyTruncated) {
    alertText += "\n⚠️ 対象が多すぎて上限に達しました（取りこぼしの可能性）";
  }
  
  const payload: AlertPayload = {
    title: "🚨 MailHub SLA Alert",
    text: alertText,
    items: allItems.slice(0, 5), // 上位5件のみ
  };

  if (!dryRun && totalSent > 0) {
    const provider = getAlertProvider();
    await provider.send(payload);
    
    // 上限到達をActivityログに記録
    if (anyTruncated) {
      await logAction({
        actorEmail: "system@mailhub",
        action: "sla_alert_truncated",
        messageId: "",
        metadata: {
          scope,
          candidates: totalCandidates,
          sent: totalSent,
          skipped: totalSkipped,
        },
      }).catch(() => {
        // ログ失敗は無視
      });
    }
  }

  // Step 68: SLA Focus直リンクを生成
  const openUrl = buildMailhubSlaUrl(baseUrl);
  const openCriticalUrl = buildMailhubSlaUrl(baseUrl, { criticalOnly: true });
  // Step 69: Open Unassignedリンク
  const openUnassignedUrl = buildMailhubSlaUrl(baseUrl, { criticalOnly: true, unassigned: true });

  return {
    sent: totalSent,
    skipped: totalSkipped,
    candidates: totalCandidates,
    truncated: anyTruncated,
    preview: dryRun ? payload : undefined,
    openUrl: openUrl || undefined,
    openCriticalUrl: openCriticalUrl || undefined,
    openUnassignedUrl: openUnassignedUrl || undefined,
  };
}
