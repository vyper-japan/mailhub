import { NextResponse } from "next/server";
import {
  getBrainLedgerStoreType,
  getBrainDecisionLedgerStore,
  getRequestedBrainLedgerStoreType,
  parseBrainDecisionLedgerEntry,
  type BrainLedgerListOptions,
} from "@/lib/brainDecisionLedgerStore";
import { authErrorResponse, requireUser } from "@/lib/require-user";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "cache-control": "no-store" };

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

function getBrainLedgerStoreBlocker(): { error: string; requested: string; resolved: string } | null {
  const requested = getRequestedBrainLedgerStoreType();
  const resolved = getBrainLedgerStoreType();
  if (requested === "sheets" && resolved !== "sheets") {
    return { error: "brain_ledger_sheets_not_configured", requested, resolved };
  }
  if (process.env.NODE_ENV === "production" && resolved === "memory") {
    return { error: "brain_ledger_durable_store_required", requested, resolved };
  }
  return null;
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

  const storeBlocker = getBrainLedgerStoreBlocker();
  if (storeBlocker) {
    return NextResponse.json(storeBlocker, { status: 503, headers: NO_STORE_HEADERS });
  }

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
  return NextResponse.json({ entries }, { headers: NO_STORE_HEADERS });
}

export async function POST(req: Request) {
  if (!process.env.MAILHUB_BRAIN_SECRET?.trim()) {
    return NextResponse.json({ error: "brain_secret_not_configured" }, { status: 503, headers: NO_STORE_HEADERS });
  }
  if (!isBrainWorkerAuthorized(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE_HEADERS });
  }

  const storeBlocker = getBrainLedgerStoreBlocker();
  if (storeBlocker) {
    return NextResponse.json(storeBlocker, { status: 503, headers: NO_STORE_HEADERS });
  }

  const body = (await req.json().catch(() => null)) as unknown;
  if (containsDestructivePlannedAction(body)) {
    return NextResponse.json({ error: "destructive_actions_not_allowed" }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const entry = parseBrainDecisionLedgerEntry(body);
  if (!entry) {
    return NextResponse.json({ error: "invalid_brain_decision" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  await getBrainDecisionLedgerStore().append(entry);
  return NextResponse.json({ ok: true, entry }, { headers: NO_STORE_HEADERS });
}
