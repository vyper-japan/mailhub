import { NextResponse } from "next/server";
import { getMessageDetail } from "@/lib/gmail";
import { requireUser, authErrorResponse } from "@/lib/require-user";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // 認証チェック（テストモードではテストユーザー）
  const authResult = await requireUser();
  if (!authResult.ok) {
    return authErrorResponse(authResult);
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  try {
    const detail = await getMessageDetail(id);
    return NextResponse.json({ detail }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "gmail_api_error", message: msg },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
