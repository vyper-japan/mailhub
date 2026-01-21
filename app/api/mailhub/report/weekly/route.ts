import "server-only";

import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { isAdminEmail } from "@/lib/admin";
import { getActivityLogs } from "@/lib/audit-log";
import { getMessageCounts } from "@/lib/gmail";

export const dynamic = "force-dynamic";

/**
 * CSVエスケープ（改行/カンマ/ダブルクオートをエスケープ）
 */
function escapeCsv(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function parseSinceOrNull(raw: string | null): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  // YYYY-MM-DD or ISO
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * adminのみ: 週次CSVレポート
 * GET /api/mailhub/report/weekly?since=2026-01-01
 *
 * CSV format:
 * section,key,value
 * summary,period_since,...
 * actions,<action>,<count>
 * actors,<actorEmail>,<count>
 * counts,unassignedLoad,<count>
 */
export async function GET(req: Request) {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);

  if (!isAdminEmail(authResult.user.email)) {
    return NextResponse.json({ error: "forbidden_admin_only" }, { status: 403 });
  }

  const url = new URL(req.url);
  const sinceRaw = url.searchParams.get("since");
  const since = parseSinceOrNull(sinceRaw);
  if (!since) {
    return NextResponse.json({ error: "missing_or_invalid_since" }, { status: 400 });
  }

  // Activity取得（最大件数に依存。週次用途のため上限を設ける）
  // TODO: 週次で1万件を超える場合、store側に期間フィルタ/ページングを追加
  const logs = await getActivityLogs({ limit: 10000 });
  const sinceMs = since.getTime();
  const inRange = logs.filter((l) => new Date(l.timestamp).getTime() >= sinceMs);

  const actionCounts = new Map<string, number>();
  const actorCounts = new Map<string, number>();

  for (const l of inRange) {
    actionCounts.set(l.action, (actionCounts.get(l.action) ?? 0) + 1);
    actorCounts.set(l.actorEmail, (actorCounts.get(l.actorEmail) ?? 0) + 1);
  }

  const actionsSorted = Array.from(actionCounts.entries()).sort((a, b) => b[1] - a[1]);
  const actorsSorted = Array.from(actorCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);

  const counts = await getMessageCounts(authResult.user.email);
  const unassignedLoad = counts.unassignedLoad ?? 0;

  const header = ["section", "key", "value"].join(",");
  const rows: string[] = [header];

  rows.push(["summary", "period_since", since.toISOString()].map(escapeCsv).join(","));
  rows.push(["summary", "period_until", new Date().toISOString()].map(escapeCsv).join(","));
  rows.push(["summary", "total_events", inRange.length].map(escapeCsv).join(","));

  for (const [action, count] of actionsSorted) {
    rows.push(["actions", action, count].map(escapeCsv).join(","));
  }
  for (const [actor, count] of actorsSorted) {
    rows.push(["actors", actor, count].map(escapeCsv).join(","));
  }
  rows.push(["counts", "unassignedLoad", unassignedLoad].map(escapeCsv).join(","));

  const csv = rows.join("\n");

  const today = new Date().toISOString().split("T")[0].replace(/-/g, "");
  const sinceDay = since.toISOString().split("T")[0].replace(/-/g, "");
  const filename = `mailhub-weekly-${sinceDay}-${today}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

