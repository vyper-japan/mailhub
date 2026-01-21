import "server-only";

import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { getMessageNotesStore } from "@/lib/messageNotesStore";
import { isReadOnlyMode } from "@/lib/read-only";
import { logAction } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  // 認証必須、全員OK
  const authResult = await requireUser();
  if (!authResult.ok) {
    return authErrorResponse(authResult);
  }

  try {
    const url = new URL(req.url);
    const messageId = url.searchParams.get("messageId");
    const hasNote = url.searchParams.get("hasNote") === "1";
    const qRaw = url.searchParams.get("q");
    const q = typeof qRaw === "string" ? qRaw.trim() : "";
    if (!messageId) {
      if (!hasNote && !q) {
        return NextResponse.json({ error: "missing_messageId" }, { status: 400 });
      }
      const store = getMessageNotesStore();
      const notes = await store.list();
      const ids = Object.entries(notes)
        .filter(([, note]) => {
          const body = note?.body ?? "";
          if (!body.trim()) return false;
          if (q) {
            return body.toLowerCase().includes(q.toLowerCase());
          }
          return true;
        })
        .map(([id]) => id);
      return NextResponse.json({ ids }, { headers: { "cache-control": "no-store" } });
    }
    const store = getMessageNotesStore();
    const note = await store.get(messageId);
    return NextResponse.json({ note }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: "failed_to_load_note", message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request): Promise<NextResponse> {
  // 認証必須、READ ONLYは403
  const authResult = await requireUser();
  if (!authResult.ok) {
    return authErrorResponse(authResult);
  }
  if (isReadOnlyMode()) {
    return NextResponse.json({ error: "read_only", message: "READ ONLYのため実行できません", reason: "notes_write" }, { status: 403 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const messageId = typeof body.messageId === "string" ? body.messageId.trim() : "";
    const noteBody = typeof body.body === "string" ? body.body : "";
    const isHandoffNote = body.isHandoffNote === true; // 引き継ぎメモかどうか
    if (!messageId) {
      return NextResponse.json({ error: "missing_messageId" }, { status: 400 });
    }

    const store = getMessageNotesStore();
    await store.set(messageId, noteBody, authResult.user.email);

    // Activity記録（note本文は含めない）
    const action: "note_set" | "note_clear" | "handoff_note_set" = noteBody.trim() 
      ? (isHandoffNote ? "handoff_note_set" : "note_set")
      : "note_clear";
    await logAction({
      actorEmail: authResult.user.email,
      action,
      messageId,
      metadata: {
        hasNote: !!noteBody.trim(),
        noteLength: noteBody.trim().length,
        isHandoffNote: isHandoffNote && !!noteBody.trim(),
        // bodyは含めない（security:scan対策）
      },
    });

    const note = await store.get(messageId);
    return NextResponse.json({ note }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("too_long")) {
      return NextResponse.json({ error: "note_body_too_long", message }, { status: 400 });
    }
    return NextResponse.json({ error: "failed_to_save_note", message }, { status: 500 });
  }
}

export async function DELETE(req: Request): Promise<NextResponse> {
  // 認証必須、READ ONLYは403
  const authResult = await requireUser();
  if (!authResult.ok) {
    return authErrorResponse(authResult);
  }
  if (isReadOnlyMode()) {
    return NextResponse.json({ error: "read_only", message: "READ ONLYのため実行できません", reason: "notes_write" }, { status: 403 });
  }

  try {
    const url = new URL(req.url);
    const messageId = url.searchParams.get("messageId");
    if (!messageId) {
      return NextResponse.json({ error: "missing_messageId" }, { status: 400 });
    }

    const store = getMessageNotesStore();
    await store.delete(messageId);

    // Activity記録
    await logAction({
      actorEmail: authResult.user.email,
      action: "note_clear",
      messageId,
      metadata: {
        hasNote: false,
      },
    });

    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: "failed_to_delete_note", message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
