import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { getLabelRulesStore } from "@/lib/labelRulesStore";
import { getLabelRegistryStore } from "@/lib/labelRegistryStore";
import { normalizeFromEmail } from "@/lib/labelRules";
import { isAdminEmail } from "@/lib/admin";
import { isReadOnlyMode, writeForbiddenResponse } from "@/lib/read-only";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);
  if (!isAdminEmail(authResult.user.email)) {
    return NextResponse.json({ error: "forbidden_admin_only" }, { status: 403 });
  }
  if (isReadOnlyMode()) return writeForbiddenResponse("rules_write");

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  const store = getLabelRulesStore();
  const current = (await store.getRules()).find((r) => r.id === id);
  if (!current) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const raw = (await req.json().catch(() => ({}))) as unknown;
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const labelNameRaw = typeof body.labelName === "string" ? body.labelName.trim() : "";
  const labelNamesRaw = body.labelNames;
  const currentLabelNames: string[] =
    Array.isArray(current.labelNames) && current.labelNames.length > 0
      ? current.labelNames
      : typeof current.labelName === "string" && current.labelName.trim().length > 0
        ? [current.labelName.trim()]
        : [];

  const labelNames: string[] =
    // 明示的な labelNames が来た場合はそれを優先
    Array.isArray(labelNamesRaw)
      ? labelNamesRaw.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      : // backward-compat: labelName だけ来た場合
        labelNameRaw
        ? [labelNameRaw]
        : // enabledだけPATCHしたいケースなどは、既存のlabelNamesを維持する
          currentLabelNames;
  const nextEnabled = typeof body.enabled === "boolean" ? body.enabled : current.enabled;
  const matchRaw = body.match;
  const match =
    matchRaw && typeof matchRaw === "object" ? (matchRaw as Record<string, unknown>) : (current.match as Record<string, unknown>);

  const fromEmailRaw = typeof match.fromEmail === "string" ? match.fromEmail : undefined;
  const fromDomainRaw = typeof match.fromDomain === "string" ? match.fromDomain : undefined;

  const fromEmail = fromEmailRaw ? normalizeFromEmail(fromEmailRaw) : null;
  const fromDomain = fromDomainRaw ? fromDomainRaw.trim().toLowerCase().replace(/^@/, "") : null;

  if (labelNames.length === 0) return NextResponse.json({ error: "missing_labelName" }, { status: 400 });
  if (!fromEmail && !fromDomain) return NextResponse.json({ error: "missing_match" }, { status: 400 });

  const registered = new Set((await getLabelRegistryStore().list()).map((l) => l.labelName));
  for (const n of labelNames) {
    if (!registered.has(n)) {
      return NextResponse.json({ error: "label_not_registered", labelName: n }, { status: 400 });
    }
  }

  const rule = await store.upsertRule({
    id,
    labelNames,
    enabled: nextEnabled,
    match: {
      ...(fromEmail ? { fromEmail } : {}),
      ...(fromDomain ? { fromDomain } : {}),
    },
  });

  return NextResponse.json({ rule }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);
  if (!isAdminEmail(authResult.user.email)) {
    return NextResponse.json({ error: "forbidden_admin_only" }, { status: 403 });
  }
  if (isReadOnlyMode()) return writeForbiddenResponse("rules_write");

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  await getLabelRulesStore().deleteRule(id);
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}



