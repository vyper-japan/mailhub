import "server-only";

import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { isAdminEmail } from "@/lib/admin";
import { getTeamStore } from "@/lib/teamStore";
import { isReadOnlyMode } from "@/lib/read-only";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ email: string }> }): Promise<NextResponse> {
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
    const { email } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const store = getTeamStore();
    const updates: Partial<{ name: string | null }> = {};
    if (body.name === null || typeof body.name === "string") {
      updates.name = body.name === null ? null : body.name.trim() || null;
    }
    const member = await store.update(email, updates);
    return NextResponse.json({ member }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("not_found")) {
      return NextResponse.json({ error: "team_member_not_found", message }, { status: 404 });
    }
    return NextResponse.json({ error: "failed_to_update_team_member", message }, { status: 400 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ email: string }> }): Promise<NextResponse> {
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
    const { email } = await params;
    const store = getTeamStore();
    await store.delete(email);
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("not_found")) {
      return NextResponse.json({ error: "team_member_not_found", message }, { status: 404 });
    }
    return NextResponse.json({ error: "failed_to_delete_team_member", message }, { status: 400 });
  }
}
