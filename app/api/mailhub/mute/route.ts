import "server-only";
import { NextResponse } from "next/server";
import { muteMessage, unmuteMessage, shouldFailInTestMode } from "@/lib/gmail";
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
  if (isReadOnlyMode()) return writeForbiddenResponse("mute");

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

  if (action !== "mute" && action !== "unmute") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  try {
    // テストモードでの意図的失敗チェック
    if (shouldFailInTestMode("mute", id)) {
      return NextResponse.json(
        { error: "test_mode_fail", message: "意図的な失敗（テスト用）" },
        { status: 500, headers: { "cache-control": "no-store" } },
      );
    }
    
    if (action === "mute") {
      await muteMessage(id);
    } else {
      await unmuteMessage(id);
    }

    // 操作ログを出力（E2E/可観測性のために完了を待つ。失敗は無視）
    await logAction({
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
    console.error(`[Mute API Error] action=${action}, messageId=${id}, user=${authResult.user.email}`, e);
    
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

