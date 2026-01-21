import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { isAdminEmail } from "@/lib/admin";
import { isReadOnlyMode, writeForbiddenResponse } from "@/lib/read-only";
import { getAssigneeRulesStore } from "@/lib/assigneeRulesStore";
import { normalizeDomain, normalizeVtjEmail } from "@/lib/assigneeRules";
import { normalizeFromEmail } from "@/lib/labelRules";
import { isBroadDomain } from "@/lib/ruleSafety";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);
  if (!isAdminEmail(authResult.user.email)) {
    return NextResponse.json({ error: "forbidden_admin_only" }, { status: 403 });
  }
  if (isReadOnlyMode()) return writeForbiddenResponse("assignee_rules_write");

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  const store = getAssigneeRulesStore();
  const current = (await store.getRules()).find((r) => r.id === id);
  if (!current) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const raw = (await req.json().catch(() => ({}))) as unknown;
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const enabled = typeof body.enabled === "boolean" ? body.enabled : current.enabled;
  const priority =
    typeof body.priority === "number" && Number.isFinite(body.priority) ? body.priority : current.priority;

  const matchRaw = body.match;
  const match = matchRaw && typeof matchRaw === "object" ? (matchRaw as Record<string, unknown>) : (current.match as Record<string, unknown>);
  const fromEmailRaw = typeof match.fromEmail === "string" ? match.fromEmail : undefined;
  const fromDomainRaw = typeof match.fromDomain === "string" ? match.fromDomain : undefined;

  const fromEmail = fromEmailRaw ? normalizeFromEmail(fromEmailRaw) : null;
  const fromDomain = fromDomainRaw ? normalizeDomain(fromDomainRaw) : null;
  if (!fromEmail && !fromDomain) {
    return NextResponse.json({ error: "missing_match" }, { status: 400 });
  }

  const assigneeEmailRaw =
    typeof body.assigneeEmail === "string" ? body.assigneeEmail : current.assigneeEmail;
  const assigneeEmail = normalizeVtjEmail(assigneeEmailRaw);
  if (!assigneeEmail) return NextResponse.json({ error: "invalid_assignee_email" }, { status: 400 });

  const unassignedOnly = body.unassignedOnly !== false;
  const dangerousDomainConfirmRaw = typeof body.dangerousDomainConfirm === "boolean" ? body.dangerousDomainConfirm : current.safety?.dangerousDomainConfirm === true;
  const dangerousDomainConfirm =
    dangerousDomainConfirmRaw || (fromDomain ? isBroadDomain(fromDomain) : false);

  const rule = await store.upsertRule({
    id,
    enabled,
    priority,
    match: { ...(fromEmail ? { fromEmail } : {}), ...(fromDomain ? { fromDomain } : {}) },
    assigneeEmail,
    unassignedOnly,
    dangerousDomainConfirm,
  });

  return NextResponse.json({ rule }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);
  if (!isAdminEmail(authResult.user.email)) {
    return NextResponse.json({ error: "forbidden_admin_only" }, { status: 403 });
  }
  if (isReadOnlyMode()) return writeForbiddenResponse("assignee_rules_write");

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  await getAssigneeRulesStore().deleteRule(id);
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}

