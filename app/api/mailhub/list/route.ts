import { NextResponse } from "next/server";
import { getLabelById, getDefaultLabel, getLabelQuery } from "@/lib/labels";
import { listLatestInboxMessages } from "@/lib/gmail";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { assigneeSlug } from "@/lib/assignee";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // 認証チェック（テストモードではテストユーザー）
  const authResult = await requireUser();
  if (!authResult.ok) {
    return authErrorResponse(authResult);
  }

  const url = new URL(req.url);
  // label パラメータ（channel も後方互換で対応）
  const labelId = url.searchParams.get("label") ?? url.searchParams.get("channel") ?? "all";
  const label = getLabelById(labelId) ?? getDefaultLabel();
  const baseQuery = getLabelQuery(label);
  
  // Step 51: ユーザー検索クエリ（Gmail検索式）
  const userQ = url.searchParams.get("q");
  let query = baseQuery;
  if (userQ && userQ.trim()) {
    // 防御: trim、長さ上限（500文字）、改行除去
    const cleanedQ = userQ.trim().replace(/\n/g, " ").slice(0, 500);
    if (cleanedQ.length > 0) {
      // 合成ルール: finalQ = [labelQ, userQ].filter(Boolean).map(x => (${x})).join(" ")
      const parts = [baseQuery, cleanedQ].filter(Boolean);
      query = parts.map((x) => `(${x})`).join(" ");
    }
  }

  const max = Number(url.searchParams.get("max") ?? "20");
  const safeMax = Number.isFinite(max) ? Math.min(Math.max(max, 1), 50) : 20;
  
  // Step 103: pageToken対応
  const pageToken = url.searchParams.get("pageToken") ?? undefined;
  
  // assigneeSlug パラメータ（担当タブ用）
  const assigneeSlugParam = url.searchParams.get("assigneeSlug");
  const unassignedParam = url.searchParams.get("unassigned");
  
  // label.type==="assignee" の場合の処理
  let assigneeSlugForFilter: string | undefined = undefined;
  let unassigned: boolean | undefined = undefined;
  
  if (label.type === "assignee") {
    if (label.id === "mine") {
      // mine: auth user emailから assigneeSlug を生成
      assigneeSlugForFilter = assigneeSlug(authResult.user.email);
    } else if (label.id === "unassigned") {
      // unassigned: unassigned=true を渡す
      unassigned = true;
    }
  }
  // query paramでも unassigned 指定を許可（Saved Views用）
  if (unassignedParam === "1" || unassignedParam === "true") {
    unassigned = true;
  }

  // statusType を query param で上書き（Saved Views用：todoのような明示フィルタ）
  const statusTypeParam = url.searchParams.get("statusType");
  const statusTypeOverride =
    statusTypeParam === "todo" || statusTypeParam === "waiting" || statusTypeParam === "muted" ? statusTypeParam : undefined;

  try {
    // Status タイプの場合は statusType を渡す
    // assigneeSlugが指定されている場合も渡す（担当タブ用）
    // label.type==="assignee" の場合は assigneeSlugForFilter または unassigned を使用
    const { messages, nextPageToken } = await listLatestInboxMessages({
      max: safeMax,
      q: query,
      statusType: statusTypeOverride ?? label.statusType,
      assigneeSlug: assigneeSlugParam || assigneeSlugForFilter,
      unassigned,
      pageToken, // Step 103: ページトークン
    });
    return NextResponse.json(
      { label: label.id, messages, nextPageToken }, // Step 103: nextPageToken追加
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "gmail_api_error", message: msg },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
