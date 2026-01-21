import "server-only";
import { NextResponse } from "next/server";
import { getActivityLogs, isAuditAction, type AuditAction } from "@/lib/audit-log";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { listLatestInboxMessages } from "@/lib/gmail";
import { getLabelById } from "@/lib/labels";

export const dynamic = "force-dynamic";

/**
 * CSVエスケープ（改行/カンマ/ダブルクオートをエスケープ）
 */
function escapeCsv(value: string | null | undefined): string {
  if (!value) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * ActivityログをCSV形式でエクスポート
 * GET /api/mailhub/activity/export?actor=me&action=archive
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
  const limitParam = url.searchParams.get("limit");

  // フィルタ構築
  const filters: {
    actorEmail?: string;
    action?: AuditAction;
    limit?: number;
  } = {};

  if (actorFilter === "me") {
    filters.actorEmail = authResult.user.email;
  }
  if (actionFilter) {
    if (isAuditAction(actionFilter)) {
      filters.action = actionFilter;
    }
  }
  if (limitParam) {
    const limit = parseInt(limitParam, 10);
    if (!isNaN(limit) && limit > 0) {
      filters.limit = Math.min(limit, 10000); // CSVは最大10000件
    }
  }

  // ログを取得
  const logs = await getActivityLogs(filters);

  // メッセージ情報を取得してログに追加（subject/channel/status）
  const enrichedLogs = await Promise.all(
    logs.map(async (log) => {
      try {
        // メッセージ情報を取得（キャッシュから）
        const { messages } = await listLatestInboxMessages({ max: 200 });
        const message = messages.find((m) => m.id === log.messageId);
        
        if (message) {
          // labelからchannelを推測
          const label = log.label ? getLabelById(log.label) : null;
          const channel = label?.type === "channel" ? label.id : undefined;
          const status = label?.statusType || undefined;
          
          return {
            ...log,
            subject: message.subject,
            receivedAt: message.receivedAt,
            channel,
            status,
          };
        }
      } catch {
        // エラー時はログのみ返す
      }
      return {
        ...log,
        subject: null,
        receivedAt: null,
        channel: undefined,
        status: undefined,
      };
    })
  );

  // CSVヘッダー
  const headers = [
    "timestamp",
    "actor",
    "action",
    "messageId",
    "subject",
    "channel",
    "status",
    "label",
    "metadata",
  ];

  // CSV行を生成
  const csvRows = [
    headers.join(","),
    ...enrichedLogs.map((log) => {
      return [
        escapeCsv(log.timestamp),
        escapeCsv(log.actorEmail),
        escapeCsv(log.action),
        escapeCsv(log.messageId),
        escapeCsv(log.subject),
        escapeCsv(log.channel),
        escapeCsv(log.status),
        escapeCsv(log.label),
        escapeCsv(log.metadata ? JSON.stringify(log.metadata) : ""),
      ].join(",");
    }),
  ];

  const csvContent = csvRows.join("\n");

  // ファイル名（YYYYMMDD形式）
  const today = new Date().toISOString().split("T")[0].replace(/-/g, "");
  const filename = `mailhub-activity-${today}.csv`;

  return new NextResponse(csvContent, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}



