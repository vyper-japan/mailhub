import { NextResponse } from "next/server";
import { getMessageDetail } from "@/lib/gmail";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { parseGmailError } from "@/lib/gmail-error";

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
    // サーバーログに詳細を出力（トークン等の秘密情報は出さない）
    console.error(`[Detail API Error] messageId=${id}, user=${authResult.user.email}`, e);
    
    const errorInfo = parseGmailError(e);
    return NextResponse.json(
      {
        error: "gmail_api_error",
        error_code: errorInfo.error_code,
        message: errorInfo.message,
        debug: process.env.NODE_ENV === "development" ? errorInfo.debug : undefined,
      },
      { status: errorInfo.httpStatus, headers: { "cache-control": "no-store" } },
    );
  }
}
