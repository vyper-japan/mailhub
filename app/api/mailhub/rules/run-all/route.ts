import "server-only";

import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { isAdminEmail } from "@/lib/admin";
import { isReadOnlyMode, writeForbiddenResponse } from "@/lib/read-only";
import { runAutoRules } from "@/lib/autoRulesRunner";
import { logAction } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

type RunnerActor =
  | { kind: "service"; email: "system@mailhub" }
  | { kind: "user"; email: string };

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7).trim();
}

async function authorizeRunner(req: Request): Promise<RunnerActor | Response> {
  const secret = process.env.MAILHUB_RULES_SECRET;
  const token = getBearerToken(req);

  if (token) {
    if (!secret) {
      return NextResponse.json(
        { error: "unauthorized", message: "MAILHUB_RULES_SECRET not configured" },
        { status: 401 },
      );
    }
    if (token !== secret) {
      return NextResponse.json({ error: "unauthorized", message: "Invalid secret" }, { status: 403 });
    }
    return { kind: "service", email: "system@mailhub" };
  }

  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);
  return { kind: "user", email: authResult.user.email };
}

export async function POST(req: Request) {
  const actorOrResponse = await authorizeRunner(req);
  if (actorOrResponse instanceof Response) return actorOrResponse;
  const actor = actorOrResponse;

  const body = (await req.json().catch(() => ({} as Record<string, unknown>))) as Record<string, unknown>;
  const dryRun = body.dryRun === true || body.dryRun === 1 || body.dryRun === "1";
  const maxTotal = typeof body.maxTotal === "number" && Number.isFinite(body.maxTotal) ? Math.max(1, Math.min(body.maxTotal, 200)) : 100;
  const maxPerRule = typeof body.maxPerRule === "number" && Number.isFinite(body.maxPerRule) ? Math.max(1, Math.min(body.maxPerRule, 50)) : 50;
  const shouldLog = body.log === true;

  // READ ONLY: Preview(dryRun)のみ許可
  if (isReadOnlyMode() && !dryRun) {
    return writeForbiddenResponse("rules_run_all");
  }

  // apply時はadmin必須
  if (!dryRun && actor.kind === "user" && !isAdminEmail(actor.email)) {
    return NextResponse.json({ error: "forbidden_admin_only" }, { status: 403 });
  }

  try {
    const result = await runAutoRules({
      dryRun,
      maxTotal,
      maxPerRule,
      concurrency: 3,
      timeoutMs: 6_000,
    });

    // Activityログ（best-effort / 明示指定のみ）
    if (shouldLog) {
      try {
        await logAction({
          actorEmail: actor.email,
          action: dryRun ? "rule_run_all_preview" : "rule_run_all_apply",
          messageId: "",
          metadata: {
            mode: result.mode,
            totalCandidates: result.totalCandidates,
            totalApplied: result.totalApplied,
            totalSkipped: result.totalSkipped,
            totalFailed: result.totalFailed,
            truncated: result.truncated,
            maxTotal,
            maxPerRule,
          },
        });
      } catch {
        // ignore
      }
    }

    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "runner_failed", message: msg }, { status: 500 });
  }
}
