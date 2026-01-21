import "server-only";

import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { isAdminEmail } from "@/lib/admin";
import { getReplyTemplatesStore } from "@/lib/replyTemplatesStore";
import { isReadOnlyMode } from "@/lib/read-only";
import { logAction } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  // 認証必須、全員OK
  const authResult = await requireUser();
  if (!authResult.ok) {
    return authErrorResponse(authResult);
  }

  try {
    const store = getReplyTemplatesStore();
    const templates = await store.list();
    return NextResponse.json({ templates }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: "failed_to_load_templates", message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  // admin必須、READ ONLYは403
  const authResult = await requireUser();
  if (!authResult.ok) {
    return authErrorResponse(authResult);
  }
  if (!isAdminEmail(authResult.user.email)) {
    return NextResponse.json({ error: "forbidden_admin_only" }, { status: 403 });
  }
  if (isReadOnlyMode()) {
    return NextResponse.json({ error: "read_only", message: "READ ONLYのため実行できません", reason: "templates_write" }, { status: 403 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const store = getReplyTemplatesStore();
    const tags = body.tags && Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : undefined;
    const routeRaw = typeof body.route === "string" ? body.route : "any";
    const route = routeRaw === "rakuten_rms" || routeRaw === "gmail" || routeRaw === "any" ? routeRaw : "any";
    const template = await store.create(
      {
        id: typeof body.id === "string" ? body.id : undefined,
        title: typeof body.title === "string" ? body.title : "",
        body: typeof body.body === "string" ? body.body : "",
        route,
        ...(tags && tags.length > 0 ? { tags } : {}),
      },
      authResult.user.email,
    );
    
    // Activity記録（best-effort）
    try {
      await logAction({
        actorEmail: authResult.user.email,
        action: "template_create",
        messageId: "", // テンプレ作成なのでメッセージIDはなし
        metadata: {
          templateId: template.id,
          title: template.title,
          hasTags: !!tags && tags.length > 0,
        },
      });
    } catch {
      // ignore
    }
    
    return NextResponse.json({ template }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("too_long")) {
      return NextResponse.json({ error: "template_body_too_long", message }, { status: 400 });
    }
    if (message.includes("html_not_allowed")) {
      return NextResponse.json({ error: "template_body_html_not_allowed", message }, { status: 400 });
    }
    if (message.includes("already_exists")) {
      return NextResponse.json({ error: "template_already_exists", message }, { status: 400 });
    }
    return NextResponse.json({ error: "failed_to_create_template", message }, { status: 400 });
  }
}
