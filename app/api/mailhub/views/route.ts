import "server-only";

import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { isAdminEmail } from "@/lib/admin";
import { getViewsStore } from "@/lib/viewsStore";
import { isReadOnlyMode } from "@/lib/read-only";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  // 全員OK（READ ONLYでも閲覧可）
  try {
    const store = getViewsStore();
    const views = await store.list();
    return NextResponse.json({ views }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: "failed_to_load_views", message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  // adminのみ、READ ONLYは403
  const authResult = await requireUser();
  if (!authResult.ok) {
    return authErrorResponse(authResult);
  }
  if (!isAdminEmail(authResult.user.email)) {
    return NextResponse.json({ error: "forbidden_admin_only" }, { status: 403 });
  }
  if (isReadOnlyMode()) {
    return NextResponse.json({ error: "read_only_mode" }, { status: 403 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    
    // reorderリクエストの場合は別処理
    if (body.action === "reorder" && Array.isArray(body.ids)) {
      const ids = body.ids.filter((id): id is string => typeof id === "string");
      const store = getViewsStore();
      await store.reorder(ids);
      const views = await store.list();
      return NextResponse.json({ views }, { headers: { "cache-control": "no-store" } });
    }
    
    // 通常のcreate
    const store = getViewsStore();
    const view = await store.create({
      id: typeof body.id === "string" ? body.id : undefined,
      name: typeof body.name === "string" ? body.name : "",
      icon: typeof body.icon === "string" ? body.icon : undefined,
      labelId: typeof body.labelId === "string" ? body.labelId : "all",
      q: typeof body.q === "string" ? body.q : undefined,
      assignee: body.assignee === "mine" || body.assignee === "unassigned" ? body.assignee : null,
      statusType: body.statusType === "todo" || body.statusType === "waiting" || body.statusType === "muted" ? body.statusType : null,
      pinned: typeof body.pinned === "boolean" ? body.pinned : false,
      order: typeof body.order === "number" ? body.order : 999,
    });
    return NextResponse.json({ view }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: "failed_to_create_view", message: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
