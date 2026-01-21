import "server-only";

import { NextResponse } from "next/server";
import { releaseSnoozed } from "@/lib/gmail";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { logAction } from "@/lib/audit-log";
import { parseGmailError } from "@/lib/gmail-error";
import { isReadOnlyMode, writeForbiddenResponse } from "@/lib/read-only";
import { isTestMode } from "@/lib/test-mode";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // 認証チェック（テストモードではテストユーザー）
  const authResult = await requireUser();
  if (!authResult.ok) {
    return authErrorResponse(authResult);
  }
  if (isReadOnlyMode()) return writeForbiddenResponse("snooze_release");

  // productionではsecret必須（TEST_MODEは不要）
  if (!isTestMode()) {
    const authHeader = req.headers.get("authorization");
    const secret = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const expectedSecret = process.env.MAILHUB_SNOOZE_SECRET;
    if (!expectedSecret || secret !== expectedSecret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const body = (await req.json().catch(() => null)) as unknown;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const until = typeof b.until === "string" ? b.until : null;

  if (!until) {
    return NextResponse.json({ error: "missing_until" }, { status: 400 });
  }

  // untilの形式検証（YYYY-MM-DD）
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    return NextResponse.json({ error: "invalid_until_format" }, { status: 400 });
  }

  try {
    const result = await releaseSnoozed(until);

    // 操作ログを出力（非同期、エラーは無視）
    logAction({
      actorEmail: authResult.user.email,
      action: "snooze_release",
      messageId: "", // 複数件のため空
      metadata: {
        until,
        releasedCount: result.releasedCount,
        truncated: result.truncated,
      },
    }).catch(() => {
      // ログ失敗は無視
    });

    return NextResponse.json(
      {
        success: true,
        until,
        releasedCount: result.releasedCount,
        releasedIds: result.releasedIds,
        truncated: result.truncated,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    // サーバーログに詳細を出力（トークン等の秘密情報は出さない）
    console.error(`[Snooze Release API Error] until=${until}, user=${authResult.user.email}`, e);
    
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
