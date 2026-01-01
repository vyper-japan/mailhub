import { NextResponse } from "next/server";
import { getLabelById, getDefaultLabel, getLabelQuery } from "@/lib/labels";
import { listLatestInboxMessages } from "@/lib/gmail";
import { requireUser, authErrorResponse } from "@/lib/require-user";

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
  const query = getLabelQuery(label);

  const max = Number(url.searchParams.get("max") ?? "20");
  const safeMax = Number.isFinite(max) ? Math.min(Math.max(max, 1), 50) : 20;

  try {
    // Status タイプの場合は statusType を渡す
    const messages = await listLatestInboxMessages({
      max: safeMax,
      q: query,
      statusType: label.statusType,
    });
    return NextResponse.json(
      { label: label.id, messages },
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
