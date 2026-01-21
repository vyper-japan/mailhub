import "server-only";

import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { isReadOnlyMode } from "@/lib/read-only";
import { logAction } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  // 認証必須（Activity記録用）、READ ONLYは403
  const authResult = await requireUser();
  if (!authResult.ok) {
    return authErrorResponse(authResult);
  }
  if (isReadOnlyMode()) {
    return NextResponse.json(
      { error: "read_only", message: "READ ONLYのため実行できません", reason: "template_insert" },
      { status: 403 },
    );
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const messageId = typeof body.messageId === "string" ? body.messageId.trim() : "";
    const templateId = typeof body.templateId === "string" ? body.templateId.trim() : "";
    if (!messageId) return NextResponse.json({ error: "missing_messageId" }, { status: 400 });
    if (!templateId) return NextResponse.json({ error: "missing_templateId" }, { status: 400 });

    await logAction({
      actorEmail: authResult.user.email,
      action: "template_insert",
      messageId,
      metadata: { templateId },
    });

    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: "failed_to_log_template_insert", message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

