import { NextResponse } from "next/server";
import {
  archiveMessage,
  unarchiveMessage,
  setWaiting,
  unsetWaiting,
  toggleInProgress,
} from "@/lib/gmail";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { logAction, type AuditAction } from "@/lib/audit-log";
import { parseGmailError } from "@/lib/gmail-error";
import { isReadOnlyMode, writeForbiddenResponse } from "@/lib/read-only";

export const dynamic = "force-dynamic";

type StatusAction = "archive" | "unarchive" | "setWaiting" | "unsetWaiting" | "toggleInProgress";

export async function POST(req: Request) {
  // 認証チェック（テストモードではテストユーザー）
  const authResult = await requireUser();
  if (!authResult.ok) {
    return authErrorResponse(authResult);
  }
  if (isReadOnlyMode()) return writeForbiddenResponse("status");

  const body = await req.json();
  const { id, action, label } = body as { id?: string; action?: StatusAction; label?: string };

  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  const validActions: StatusAction[] = [
    "archive",
    "unarchive",
    "setWaiting",
    "unsetWaiting",
    "toggleInProgress",
  ];
  if (!action || !validActions.includes(action)) {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  try {
    switch (action) {
      case "archive":
        await archiveMessage(id);
        break;
      case "unarchive":
        await unarchiveMessage(id);
        break;
      case "setWaiting":
        await setWaiting(id);
        break;
      case "unsetWaiting":
        await unsetWaiting(id);
        break;
      case "toggleInProgress":
        await toggleInProgress(id);
        break;
    }

    // 操作ログを出力（非同期、エラーは無視）
    logAction({
      actorEmail: authResult.user.email,
      action: action as AuditAction,
      messageId: id,
      label,
    }).catch(() => {
      // ログ失敗は無視
    });

    return NextResponse.json(
      { success: true, id, action },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    // サーバーログに詳細を出力（トークン等の秘密情報は出さない）
    console.error(`[Status API Error] action=${action}, messageId=${id}, user=${authResult.user.email}`, e);
    
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
