import "server-only";

import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { isAdminEmail } from "@/lib/admin";
import { getReplyTemplatesStore } from "@/lib/replyTemplatesStore";
import { isReadOnlyMode } from "@/lib/read-only";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
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
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const store = getReplyTemplatesStore();
    const updates: Partial<{ title: string; body: string; tags?: string[]; route?: "rakuten_rms" | "gmail" | "any" }> = {};
    if (typeof body.title === "string") updates.title = body.title;
    if (typeof body.body === "string") updates.body = body.body;
    if (typeof body.route === "string") {
      const r = body.route;
      updates.route = r === "rakuten_rms" || r === "gmail" || r === "any" ? r : "any";
    }
    if (body.tags !== undefined) {
      if (Array.isArray(body.tags)) {
        updates.tags = body.tags.filter((t): t is string => typeof t === "string");
      } else if (body.tags === null) {
        updates.tags = undefined;
      }
    }
    const template = await store.update(id, updates, authResult.user.email);
    return NextResponse.json({ template }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("not_found")) {
      return NextResponse.json({ error: "template_not_found", message }, { status: 404 });
    }
    if (message.includes("too_long")) {
      return NextResponse.json({ error: "template_body_too_long", message }, { status: 400 });
    }
    if (message.includes("html_not_allowed")) {
      return NextResponse.json({ error: "template_body_html_not_allowed", message }, { status: 400 });
    }
    return NextResponse.json({ error: "failed_to_update_template", message }, { status: 400 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
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
    const { id } = await params;
    const store = getReplyTemplatesStore();
    await store.delete(id);
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("not_found")) {
      return NextResponse.json({ error: "template_not_found", message }, { status: 404 });
    }
    return NextResponse.json({ error: "failed_to_delete_template", message }, { status: 400 });
  }
}
