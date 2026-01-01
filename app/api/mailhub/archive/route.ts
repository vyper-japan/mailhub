import { NextResponse } from "next/server";
import { archiveMessage, unarchiveMessage } from "@/lib/gmail";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { logAction } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // 認証チェック（テストモードではテストユーザー）
  const authResult = await requireUser();
  if (!authResult.ok) {
    return authErrorResponse(authResult);
  }

  const body = await req.json();
  const { id, action } = body as { id?: string; action?: "archive" | "unarchive" };

  if (!id || typeof id !== "string") {
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

    // 操作ログを出力
    logAction({
      actorEmail: authResult.user.email,
      action,
      messageId: id,
    });

    return NextResponse.json(
      { success: true, id, action },
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
