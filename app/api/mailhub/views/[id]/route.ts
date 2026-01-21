import "server-only";

import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { isAdminEmail } from "@/lib/admin";
import { getViewsStore } from "@/lib/viewsStore";
import { isReadOnlyMode } from "@/lib/read-only";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
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
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const store = getViewsStore();
    const updates: Partial<{
      name: string;
      icon: string | undefined;
      labelId: string;
      q: string | undefined;
      assignee: "mine" | "unassigned" | null;
      statusType: "todo" | "waiting" | "muted" | null;
      pinned: boolean;
      order: number;
    }> = {};
    if (typeof body.name === "string") updates.name = body.name;
    if (body.icon === null || typeof body.icon === "string") updates.icon = body.icon ?? undefined;
    if (typeof body.labelId === "string") updates.labelId = body.labelId;
    if (body.q === null || typeof body.q === "string") updates.q = body.q ?? undefined;
    if (body.assignee === "mine" || body.assignee === "unassigned" || body.assignee === null) updates.assignee = body.assignee;
    if (body.statusType === "todo" || body.statusType === "waiting" || body.statusType === "muted" || body.statusType === null)
      updates.statusType = body.statusType;
    if (typeof body.pinned === "boolean") updates.pinned = body.pinned;
    if (typeof body.order === "number") updates.order = body.order;
    const view = await store.update(id, updates);
    return NextResponse.json({ view }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("not_found")) {
      return NextResponse.json({ error: "view_not_found", message }, { status: 404 });
    }
    return NextResponse.json({ error: "failed_to_update_view", message }, { status: 400 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
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
    const { id } = await params;
    const store = getViewsStore();
    await store.delete(id);
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("not_found")) {
      return NextResponse.json({ error: "view_not_found", message }, { status: 404 });
    }
    return NextResponse.json({ error: "failed_to_delete_view", message }, { status: 400 });
  }
}
