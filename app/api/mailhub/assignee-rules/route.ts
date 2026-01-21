import "server-only";

import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { isAdminEmail } from "@/lib/admin";
import { isReadOnlyMode, writeForbiddenResponse } from "@/lib/read-only";
import { getAssigneeRulesStore } from "@/lib/assigneeRulesStore";
import { normalizeDomain, normalizeVtjEmail } from "@/lib/assigneeRules";
import { normalizeFromEmail } from "@/lib/labelRules";
import { isBroadDomain } from "@/lib/ruleSafety";
import { logAction } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

export async function GET() {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);

  try {
    const rules = await getAssigneeRulesStore().getRules();
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
  if (isReadOnlyMode()) return writeForbiddenResponse("assignee_rules_write");

  const raw = (await req.json().catch(() => ({}))) as unknown;
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const id = typeof body.id === "string" ? body.id : undefined;
  const enabled = typeof body.enabled === "boolean" ? body.enabled : undefined;
  const priority =
    typeof body.priority === "number" && Number.isFinite(body.priority) ? body.priority : 0;

  const matchRaw = body.match;
  const match = matchRaw && typeof matchRaw === "object" ? (matchRaw as Record<string, unknown>) : {};
  const fromEmailRaw = typeof match.fromEmail === "string" ? match.fromEmail : undefined;
  const fromDomainRaw = typeof match.fromDomain === "string" ? match.fromDomain : undefined;

  const fromEmail = fromEmailRaw ? normalizeFromEmail(fromEmailRaw) : null;
  const fromDomain = fromDomainRaw ? normalizeDomain(fromDomainRaw) : null;
  if (!fromEmail && !fromDomain) {
    return NextResponse.json({ error: "missing_match" }, { status: 400 });
  }

  const assigneeEmailRaw = typeof body.assigneeEmail === "string" ? body.assigneeEmail : "";
  const assigneeEmail = normalizeVtjEmail(assigneeEmailRaw);
  if (!assigneeEmail) {
    return NextResponse.json({ error: "invalid_assignee_email" }, { status: 400 });
  }

  // whenオブジェクトからも読み取れるようにする
  const whenRaw = body.when && typeof body.when === "object" ? (body.when as Record<string, unknown>) : {};
  const unassignedOnlyFromWhen = typeof whenRaw.unassignedOnly === "boolean" ? whenRaw.unassignedOnly : undefined;
  const unassignedOnly = unassignedOnlyFromWhen ?? (body.unassignedOnly !== false);
  const dangerousDomainConfirmRaw = body.dangerousDomainConfirm === true;
  const dangerousDomainConfirm =
    dangerousDomainConfirmRaw || (fromDomain ? isBroadDomain(fromDomain) : false);

  const suggestionId = typeof body.suggestionId === "string" ? body.suggestionId : null;
  const suggestionType = typeof body.suggestionType === "string" ? body.suggestionType : null;

  const rule = await getAssigneeRulesStore().upsertRule({
    id,
    enabled,
    priority,
    match: { ...(fromEmail ? { fromEmail } : {}), ...(fromDomain ? { fromDomain } : {}) },
    assigneeEmail,
    unassignedOnly,
    dangerousDomainConfirm,
  });

  // Activityログにsuggestion_applyを記録（best-effort）
  if (suggestionId) {
    try {
      await logAction({
        actorEmail: authResult.user.email,
        action: "suggestion_apply",
        messageId: "",
        metadata: { suggestionId, type: suggestionType ?? "auto_assign" },
      });
    } catch {
      // 無視
    }
  }

  return NextResponse.json({ rule }, { headers: { "cache-control": "no-store" } });
}

