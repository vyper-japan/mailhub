import "server-only";

import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { isAdminEmail } from "@/lib/admin";
import { isReadOnlyMode, writeForbiddenResponse } from "@/lib/read-only";
import { getSavedSearchesStore } from "@/lib/savedSearchesStore";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);
  if (!isAdminEmail(authResult.user.email)) {
    return NextResponse.json({ error: "forbidden_admin_only" }, { status: 403 });
  }
  if (isReadOnlyMode()) return writeForbiddenResponse("queues_write");

  const { id } = await params;
  const raw = (await req.json().catch(() => ({}))) as unknown;
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const updates: Partial<{ name: string; query: string; baseLabelId: string | null }> = {};
  if (typeof body.name === "string") updates.name = body.name;
  if (typeof body.query === "string") updates.query = body.query;
  if (body.baseLabelId === null || typeof body.baseLabelId === "string") {
    updates.baseLabelId = body.baseLabelId ?? null;
  }

  try {
    const search = await getSavedSearchesStore().update(id, updates);
    return NextResponse.json({ search }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("search_not_found")) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    if (msg.includes("invalid_name_length") || msg.includes("invalid_query_length")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: "config_write_failed", message: msg }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);
  if (!isAdminEmail(authResult.user.email)) {
    return NextResponse.json({ error: "forbidden_admin_only" }, { status: 403 });
  }
  if (isReadOnlyMode()) return writeForbiddenResponse("queues_write");

  const { id } = await params;

  try {
    await getSavedSearchesStore().delete(id);
    return NextResponse.json({ success: true }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("search_not_found")) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    return NextResponse.json({ error: "config_write_failed", message: msg }, { status: 500 });
  }
}
