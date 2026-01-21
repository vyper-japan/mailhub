import "server-only";

import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { logAction } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

/**
 * ルール提案のPreviewアクションを記録（Activityログ）
 * POST /api/mailhub/rules/suggestions/preview
 */
export async function POST(req: Request): Promise<NextResponse> {
  const authResult = await requireUser();
  if (!authResult.ok) {
    return authErrorResponse(authResult);
  }

  const body = (await req.json().catch(() => ({}))) as { suggestionId?: string; type?: string };
  const suggestionId = typeof body.suggestionId === "string" ? body.suggestionId : null;
  const type = typeof body.type === "string" ? body.type : null;

  if (suggestionId) {
    try {
      await logAction({
        actorEmail: authResult.user.email,
        action: "suggestion_preview",
        messageId: "",
        metadata: { suggestionId, type },
      });
    } catch {
      // Activityログの記録失敗は無視（best-effort）
    }
  }

  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
