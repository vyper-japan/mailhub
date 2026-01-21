import "server-only";

import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { isAdminEmail } from "@/lib/admin";
import { isReadOnlyMode, writeForbiddenResponse } from "@/lib/read-only";
import { getSavedSearchesStore } from "@/lib/savedSearchesStore";

export const dynamic = "force-dynamic";

export async function GET() {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);

  try {
    const searches = await getSavedSearchesStore().list();
    return NextResponse.json({ searches }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "config_read_failed", message: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);
  if (!isAdminEmail(authResult.user.email)) {
    return NextResponse.json({ error: "forbidden_admin_only" }, { status: 403 });
  }
  if (isReadOnlyMode()) return writeForbiddenResponse("queues_write");

  const raw = (await req.json().catch(() => ({}))) as unknown;
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const name = typeof body.name === "string" ? body.name : "";
  const query = typeof body.query === "string" ? body.query : "";
  const baseLabelId = typeof body.baseLabelId === "string" ? body.baseLabelId : body.baseLabelId === null ? null : undefined;

  if (!name || !query) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }

  try {
    const search = await getSavedSearchesStore().create({ name, query, baseLabelId });
    return NextResponse.json({ search }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("invalid_name_length") || msg.includes("invalid_query_length")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    if (msg.includes("max_searches_exceeded")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: "config_write_failed", message: msg }, { status: 500 });
  }
}
