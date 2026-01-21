import "server-only";

import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { isAdminEmail } from "@/lib/admin";
import { getTeamStore } from "@/lib/teamStore";
import { getRosterStore } from "@/lib/rosterStore";
import { isReadOnlyMode } from "@/lib/read-only";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  // 全員OK（READ ONLYでも閲覧可）
  try {
    const teamStore = getTeamStore();
    const team = await teamStore.list();
    const rosterStore = getRosterStore();
    const roster = await rosterStore.get();
    return NextResponse.json({ team, roster }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: "failed_to_load_team", message: e instanceof Error ? e.message : String(e) },
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
    const store = getTeamStore();
    const member = await store.create({
      email: typeof body.email === "string" ? body.email : "",
      name: typeof body.name === "string" ? body.name : null,
    });
    return NextResponse.json({ member }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("already_exists")) {
      return NextResponse.json({ error: "team_member_already_exists", message }, { status: 409 });
    }
    return NextResponse.json({ error: "failed_to_create_team_member", message }, { status: 400 });
  }
}

export async function PUT(req: Request): Promise<NextResponse> {
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
    const body = (await req.json().catch(() => ({}))) as { roster?: unknown };
    if (!body.roster || !Array.isArray(body.roster)) {
      return NextResponse.json({ error: "invalid_roster_format", message: "roster must be an array" }, { status: 400 });
    }
    const emails = body.roster.filter((x): x is string => typeof x === "string");
    const store = getRosterStore();
    await store.set(emails);
    const roster = await store.get();
    return NextResponse.json({ roster }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "failed_to_update_roster", message }, { status: 400 });
  }
}
