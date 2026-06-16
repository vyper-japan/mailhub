import { NextResponse } from "next/server";
import {
  getBrainDecisionLedgerStore,
  parseBrainDecisionLedgerEntry,
  type BrainLedgerListOptions,
} from "@/lib/brainDecisionLedgerStore";
import { authErrorResponse, requireUser } from "@/lib/require-user";

export const dynamic = "force-dynamic";

function parseBoolean(value: string | null): boolean | undefined {
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return undefined;
}

function parseLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(1, Math.min(200, Math.floor(parsed)));
}

function isBrainWorkerAuthorized(req: Request): boolean {
  const secret = process.env.MAILHUB_BRAIN_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

function containsDestructivePlannedAction(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plannedActions = (value as Record<string, unknown>).plannedActions;
  if (!Array.isArray(plannedActions)) return false;
  return plannedActions.some((action) => (
    action &&
    typeof action === "object" &&
    (action as Record<string, unknown>).destructive !== false
  ));
}

export async function GET(req: Request) {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);

  const url = new URL(req.url);
  const options: BrainLedgerListOptions = {
    limit: parseLimit(url.searchParams.get("limit")),
    messageId: url.searchParams.get("messageId") ?? undefined,
    threadId: url.searchParams.get("threadId") ?? undefined,
    humanRequired: parseBoolean(url.searchParams.get("humanRequired")),
    purpose: url.searchParams.get("purpose") ?? undefined,
    latest: parseBoolean(url.searchParams.get("latest")),
  };
  const entries = await getBrainDecisionLedgerStore().list(options);
  return NextResponse.json({ entries }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  if (!process.env.MAILHUB_BRAIN_SECRET?.trim()) {
    return NextResponse.json({ error: "brain_secret_not_configured" }, { status: 503 });
  }
  if (!isBrainWorkerAuthorized(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as unknown;
  if (containsDestructivePlannedAction(body)) {
    return NextResponse.json({ error: "destructive_actions_not_allowed" }, { status: 400 });
  }
  const entry = parseBrainDecisionLedgerEntry(body);
  if (!entry) {
    return NextResponse.json({ error: "invalid_brain_decision" }, { status: 400 });
  }

  await getBrainDecisionLedgerStore().append(entry);
  return NextResponse.json({ ok: true, entry }, { headers: { "cache-control": "no-store" } });
}
