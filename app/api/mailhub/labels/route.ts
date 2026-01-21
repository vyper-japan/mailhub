import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { getLabelRegistryStore } from "@/lib/labelRegistryStore";
import { ensureLabelId } from "@/lib/gmail";
import { MAILHUB_USER_LABEL_PREFIX } from "@/lib/mailhub-labels";
import { isAdminEmail } from "@/lib/admin";
import { isReadOnlyMode, writeForbiddenResponse } from "@/lib/read-only";

export const dynamic = "force-dynamic";

export async function GET() {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);

  try {
    const labels = await getLabelRegistryStore().list();
    return NextResponse.json({ labels }, { headers: { "cache-control": "no-store" } });
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
  if (isReadOnlyMode()) return writeForbiddenResponse("labels_write");

  const body = (await req.json().catch(() => ({} as Record<string, unknown>))) as Record<string, unknown>;
  const labelName = typeof body.labelName === "string" ? body.labelName.trim() : "";
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : undefined;
  if (!labelName) {
    return NextResponse.json({ error: "missing_labelName" }, { status: 400 });
  }
  if (!labelName.startsWith(MAILHUB_USER_LABEL_PREFIX)) {
    return NextResponse.json({ error: "label_not_mailhub_managed", labelName }, { status: 400 });
  }

  // Gmail側に存在しない場合は作成（SoTはGmail）
  await ensureLabelId(labelName);

  const labels = await getLabelRegistryStore().add(labelName, displayName);
  return NextResponse.json({ labels }, { headers: { "cache-control": "no-store" } });
}

export async function PATCH(req: Request) {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);
  if (!isAdminEmail(authResult.user.email)) {
    return NextResponse.json({ error: "forbidden_admin_only" }, { status: 403 });
  }
  if (isReadOnlyMode()) return writeForbiddenResponse("labels_write");

  const body = (await req.json().catch(() => ({} as Record<string, unknown>))) as Record<string, unknown>;
  const labelName = typeof body.labelName === "string" ? body.labelName.trim() : "";
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";

  if (!labelName) return NextResponse.json({ error: "missing_labelName" }, { status: 400 });
  if (!labelName.startsWith(MAILHUB_USER_LABEL_PREFIX)) {
    return NextResponse.json({ error: "label_not_mailhub_managed", labelName }, { status: 400 });
  }
  const labels = await getLabelRegistryStore().updateDisplayName(labelName, displayName);
  return NextResponse.json({ labels }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(req: Request) {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);
  if (!isAdminEmail(authResult.user.email)) {
    return NextResponse.json({ error: "forbidden_admin_only" }, { status: 403 });
  }
  if (isReadOnlyMode()) return writeForbiddenResponse("labels_write");

  const url = new URL(req.url);
  const labelName = (url.searchParams.get("labelName") ?? "").trim();
  if (!labelName) {
    return NextResponse.json({ error: "missing_labelName" }, { status: 400 });
  }
  if (!labelName.startsWith(MAILHUB_USER_LABEL_PREFIX)) {
    return NextResponse.json({ error: "label_not_mailhub_managed", labelName }, { status: 400 });
  }

  const labels = await getLabelRegistryStore().remove(labelName);
  return NextResponse.json({ labels }, { headers: { "cache-control": "no-store" } });
}


