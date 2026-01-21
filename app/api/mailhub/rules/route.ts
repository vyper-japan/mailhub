import "server-only";

import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { getLabelRulesStore } from "@/lib/labelRulesStore";
import { getLabelRegistryStore } from "@/lib/labelRegistryStore";
import { normalizeFromEmail, type AssignToSpec } from "@/lib/labelRules";
import { isAdminEmail } from "@/lib/admin";
import { isReadOnlyMode, writeForbiddenResponse } from "@/lib/read-only";
import { logAction } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

export async function GET() {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);

  try {
    const rules = await getLabelRulesStore().getRules();
    return NextResponse.json({ rules }, { headers: { "cache-control": "no-store" } });
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
  if (isReadOnlyMode()) return writeForbiddenResponse("rules_write");

  const raw = (await req.json().catch(() => ({}))) as unknown;
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const id = typeof body.id === "string" ? body.id : undefined;
  const labelName = typeof body.labelName === "string" ? body.labelName.trim() : "";
  const labelNamesRaw = body.labelNames;
  const labelNames =
    Array.isArray(labelNamesRaw)
      ? labelNamesRaw.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      : [];
  const enabled = typeof body.enabled === "boolean" ? body.enabled : undefined;
  const matchRaw = body.match;
  const match = matchRaw && typeof matchRaw === "object" ? (matchRaw as Record<string, unknown>) : {};

  const fromEmailRaw = typeof match.fromEmail === "string" ? match.fromEmail : undefined;
  const fromDomainRaw = typeof match.fromDomain === "string" ? match.fromDomain : undefined;

  const fromEmail = fromEmailRaw ? normalizeFromEmail(fromEmailRaw) : null;
  const fromDomain = fromDomainRaw ? fromDomainRaw.trim().toLowerCase().replace(/^@/, "") : null;

  if (!labelName && labelNames.length === 0) {
    return NextResponse.json({ error: "missing_labelName" }, { status: 400 });
  }
  if (!fromEmail && !fromDomain) {
    return NextResponse.json({ error: "missing_match" }, { status: 400 });
  }

  // labelNamesは登録済みのものだけ許可（UIの爆発防止）
  const registered = new Set((await getLabelRegistryStore().list()).map((l) => l.labelName));
  const finalLabelNames = labelNames.length ? labelNames : labelName ? [labelName] : [];
  for (const n of finalLabelNames) {
    if (!registered.has(n)) {
      return NextResponse.json({ error: "label_not_registered", labelName: n }, { status: 400 });
    }
  }

  const suggestionId = typeof body.suggestionId === "string" ? body.suggestionId : null;
  const suggestionType = typeof body.suggestionType === "string" ? body.suggestionType : null;

  // Step 83: assignToを受け取る（"me" or { assigneeEmail: string }）
  let assignTo: AssignToSpec | undefined;
  if (body.assignTo === "me") {
    assignTo = "me";
  } else if (body.assignTo && typeof body.assignTo === "object") {
    const at = body.assignTo as Record<string, unknown>;
    if (typeof at.assigneeEmail === "string" && at.assigneeEmail.endsWith("@vtj.co.jp")) {
      assignTo = { assigneeEmail: at.assigneeEmail };
    }
  }

  const rule = await getLabelRulesStore().upsertRule({
    id,
    labelNames: finalLabelNames,
    enabled,
    assignTo, // Step 83
    match: {
      ...(fromEmail ? { fromEmail } : {}),
      ...(fromDomain ? { fromDomain } : {}),
    },
  });

  // Activityログにsuggestion_applyを記録（best-effort）
  if (suggestionId) {
    try {
      await logAction({
        actorEmail: authResult.user.email,
        action: "suggestion_apply",
        messageId: "",
        metadata: { suggestionId, type: suggestionType ?? "auto_label" },
      });
    } catch {
      // 無視
    }
  }

  return NextResponse.json({ rule }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(req: Request) {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);
  if (!isAdminEmail(authResult.user.email)) {
    return NextResponse.json({ error: "forbidden_admin_only" }, { status: 403 });
  }
  if (isReadOnlyMode()) return writeForbiddenResponse("rules_write");

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  await getLabelRulesStore().deleteRule(id);
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}



