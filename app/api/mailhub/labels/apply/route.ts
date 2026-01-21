import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { getLabelRegistryStore } from "@/lib/labelRegistryStore";
import { applyLabelsToMessages, applyTestActionDelay } from "@/lib/gmail";
import { isReadOnlyMode, writeForbiddenResponse } from "@/lib/read-only";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);
  if (isReadOnlyMode()) return writeForbiddenResponse("labels_apply");

  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body?.ids) ? (body.ids as unknown[]).filter((v): v is string => typeof v === "string") : [];
  const add = Array.isArray(body?.add) ? (body.add as unknown[]).filter((v): v is string => typeof v === "string") : [];
  const remove = Array.isArray(body?.remove) ? (body.remove as unknown[]).filter((v): v is string => typeof v === "string") : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: "missing_ids" }, { status: 400 });
  }

  // UIで扱うのは「登録済みラベルのみ」
  const registered = new Set((await getLabelRegistryStore().list()).map((l) => l.labelName));
  const unknown = [...new Set([...add, ...remove])].filter((n) => !registered.has(n));
  if (unknown.length > 0) {
    return NextResponse.json({ error: "unknown_labels", unknown }, { status: 400 });
  }

  // テストモードでのアクション遅延を適用
  await applyTestActionDelay();

  const result = await applyLabelsToMessages(ids, { addLabelNames: add, removeLabelNames: remove });
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}




