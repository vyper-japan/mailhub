import { NextResponse } from "next/server";
import { archiveMessage, unarchiveMessage } from "@/lib/gmail";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { logAction } from "@/lib/audit-log";
import { parseGmailError } from "@/lib/gmail-error";
import { isReadOnlyMode, writeForbiddenResponse } from "@/lib/read-only";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // 認証チェック（テストモードではテストユーザー）
  const authResult = await requireUser();
  if (!authResult.ok) {
    return authErrorResponse(authResult);
  }
  if (isReadOnlyMode()) return writeForbiddenResponse("archive");

  const body = (await req.json().catch(() => null)) as unknown;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const id = typeof b.id === "string" ? b.id : null;
  const action = typeof b.action === "string" ? b.action : null;

  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  if (action !== "archive" && action !== "unarchive") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  try {
    if (action === "archive") {
      await archiveMessage(id);
    } else {
      await unarchiveMessage(id);
    }

    // 操作ログを出力（非同期、エラーは無視）
    logAction({
      actorEmail: authResult.user.email,
      action,
      messageId: id,
    }).catch(() => {
      // ログ失敗は無視
    });

    return NextResponse.json(
      { success: true, id, action },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    // サーバーログに詳細を出力（トークン等の秘密情報は出さない）
    console.error(`[Archive API Error] action=${action}, messageId=${id}, user=${authResult.user.email}`, e);
    
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
