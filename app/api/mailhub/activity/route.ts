import "server-only";
import { NextResponse } from "next/server";
import { getActivityLogs, isAuditAction, type AuditAction } from "@/lib/audit-log";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { listLatestInboxMessages } from "@/lib/gmail";
import { getLabelById } from "@/lib/labels";

export const dynamic = "force-dynamic";

/**
 * Activityログを取得するAPI
 * GET /api/mailhub/activity?actor=me&action=archive&limit=50
 */
export async function GET(req: Request) {
  // 認証チェック
  const authResult = await requireUser();
  if (!authResult.ok) {
    return authErrorResponse(authResult);
  }

  const url = new URL(req.url);
  const actorFilter = url.searchParams.get("actor");
  const actionFilter = url.searchParams.get("action");
  const ruleIdFilter = url.searchParams.get("ruleId");
  const messageIdFilter = url.searchParams.get("messageId");
  const subjectFilter = url.searchParams.get("subject");
  const periodFilter = url.searchParams.get("period");
  const limitParam = url.searchParams.get("limit");

  // フィルタ構築
  const filters: {
    actorEmail?: string;
    action?: AuditAction;
    ruleId?: string;
    limit?: number;
  } = {};

  if (actorFilter === "me") {
    filters.actorEmail = authResult.user.email;
  } else if (actorFilter && actorFilter.trim()) {
    // 任意actor（email想定）
    filters.actorEmail = actorFilter.trim();
  }
  if (actionFilter) {
    if (isAuditAction(actionFilter)) {
      filters.action = actionFilter;
    }
  }
  if (ruleIdFilter) {
    filters.ruleId = ruleIdFilter;
  }
  if (limitParam) {
    const limit = parseInt(limitParam, 10);
    if (!isNaN(limit) && limit > 0) {
      filters.limit = Math.min(limit, 200); // 最大200件
    }
  }

  // ログを取得（永続ストア優先）
  let logs = await getActivityLogs(filters);

  // Step 99: messageId / 期間での追加フィルタ（subjectはenrich後に適用）
  if (messageIdFilter && messageIdFilter.trim()) {
    const q = messageIdFilter.trim();
    logs = logs.filter((l) => (l.messageId || "").includes(q));
  }
  if (periodFilter === "24h" || periodFilter === "7d" || periodFilter === "30d") {
    const now = Date.now();
    const ms =
      periodFilter === "24h"
        ? 24 * 60 * 60 * 1000
        : periodFilter === "7d"
          ? 7 * 24 * 60 * 60 * 1000
          : 30 * 24 * 60 * 60 * 1000;
    const since = now - ms;
    logs = logs.filter((l) => {
      const t = Date.parse(l.timestamp);
      return Number.isFinite(t) && t >= since;
    });
  }

  // メッセージ情報を取得してログに追加（subject/channel/status）
  let messageMap = new Map<string, { subject: string | null; receivedAt: string | null }>();
  try {
    const { messages } = await listLatestInboxMessages({ max: 200 });
    messageMap = new Map(messages.map((m) => [m.id, { subject: m.subject ?? null, receivedAt: m.receivedAt ?? null }]));
  } catch {
    // ignore
  }
  let enrichedLogs = logs.map((log) => {
    const msg = messageMap.get(log.messageId);
    const label = log.label ? getLabelById(log.label) : null;
    const channel = label?.type === "channel" ? label.id : undefined;
    const status = label?.statusType || undefined;
    return {
      ...log,
      subject: msg?.subject ?? null,
      receivedAt: msg?.receivedAt ?? null,
      channel,
      status,
    };
  });

  if (subjectFilter && subjectFilter.trim()) {
    const q = subjectFilter.trim().toLowerCase();
    enrichedLogs = enrichedLogs.filter((l) => (l.subject || "").toLowerCase().includes(q));
  }

  return NextResponse.json(
    { logs: enrichedLogs },
    { headers: { "cache-control": "no-store" } }
  );
}

