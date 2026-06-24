import "server-only";

import { NextResponse } from "next/server";
import { getMessageDetail } from "@/lib/gmail";
import { listCandidatesByQuery } from "@/lib/gmail-alerts";
import { extractFromEmail } from "@/lib/labelRules";
import { authErrorResponse, requireUser } from "@/lib/require-user";
import {
  evaluateDetailNoiseSafety,
  type NoiseSafetyDecision,
} from "@/lib/noiseSafety";

export const dynamic = "force-dynamic";

const MAX_PREVIEW_MESSAGES = 50;

type NoisePreviewItem = {
  id: string;
  threadId: string | null;
  subject: string | null;
  from: string | null;
  status: NoiseSafetyDecision["status"];
  classification: NoiseSafetyDecision["classification"];
};

type NoisePreviewWarning = {
  type: string;
  message: string;
  id?: string;
};

type DetailFetchResult =
  | { ok: true; decision: NoiseSafetyDecision }
  | { ok: false; id: string; warning: NoisePreviewWarning; decision: NoiseSafetyDecision };

function parseMax(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return MAX_PREVIEW_MESSAGES;
  return Math.max(1, Math.min(Math.trunc(value), MAX_PREVIEW_MESSAGES));
}

function parseMessageIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function missingSummaryDecision(id: string, reason: string): NoiseSafetyDecision {
  return {
    id,
    threadId: null,
    subject: null,
    from: null,
    status: "missing_summary",
    classification: {
      purpose: "other",
      evidence: [],
      suppressible: false,
      blockedReasons: [reason],
    },
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await fn(items[current]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchDecision(id: string): Promise<DetailFetchResult> {
  try {
    const detail = await getMessageDetail(id);
    return { ok: true, decision: evaluateDetailNoiseSafety(detail) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      id,
      warning: {
        type: "detail_fetch_failed",
        id,
        message,
      },
      decision: missingSummaryDecision(id, "detail_fetch_failed"),
    };
  }
}

function itemFromDecision(decision: NoiseSafetyDecision): NoisePreviewItem {
  return {
    id: decision.id,
    threadId: decision.threadId,
    subject: decision.subject,
    from: decision.from,
    status: decision.status,
    classification: decision.classification,
  };
}

function splitDecisions(decisions: NoiseSafetyDecision[]) {
  const safeCandidates: NoisePreviewItem[] = [];
  const protectedItems: NoisePreviewItem[] = [];
  const missingSummary: NoisePreviewItem[] = [];
  const notNoise: NoisePreviewItem[] = [];

  for (const decision of decisions) {
    const item = itemFromDecision(decision);
    if (decision.status === "safe_to_suppress") safeCandidates.push(item);
    else if (decision.status === "protected") protectedItems.push(item);
    else if (decision.status === "missing_summary") missingSummary.push(item);
    else notNoise.push(item);
  }

  return { safeCandidates, protected: protectedItems, missingSummary, notNoise };
}

export async function POST(req: Request) {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (typeof body.fromDomain === "string" || typeof body.q === "string") {
    return NextResponse.json(
      { error: "unsupported_source", message: "Use exact messageIds or fromEmail for noise preview." },
      { status: 400 },
    );
  }

  const max = parseMax(body.max);
  const messageIds = parseMessageIds(body.messageIds);
  const fromEmail = typeof body.fromEmail === "string" ? extractFromEmail(body.fromEmail) : null;
  const sourceCount = (messageIds.length > 0 ? 1 : 0) + (fromEmail ? 1 : 0);
  if (sourceCount !== 1) {
    return NextResponse.json({ error: "invalid_source", message: "Specify exactly one source." }, { status: 400 });
  }

  const warnings: NoisePreviewWarning[] = [];
  let requestedIds: string[] = [];
  let truncated = false;
  let source: { type: "messageIds"; requested: number } | { type: "fromEmail"; value: string; query: string } =
    { type: "messageIds", requested: 0 };

  if (messageIds.length > 0) {
    requestedIds = messageIds.slice(0, max);
    truncated = messageIds.length > requestedIds.length;
    source = { type: "messageIds", requested: messageIds.length };
  } else if (fromEmail) {
    const query = `from:${fromEmail}`;
    const result = await listCandidatesByQuery({ q: query, maxTotal: max + 1, maxPages: 5 });
    const ids = result.messages.map((message) => message.id);
    requestedIds = ids.slice(0, max);
    truncated = result.truncated || ids.length > requestedIds.length;
    source = { type: "fromEmail", value: fromEmail, query };
  }

  const detailResults = await mapWithConcurrency(requestedIds, 4, fetchDecision);
  for (const result of detailResults) {
    if (!result.ok) warnings.push(result.warning);
  }

  const decisions = detailResults.map((result) => result.decision);
  const split = splitDecisions(decisions);

  return NextResponse.json(
    {
      source,
      evaluated: decisions.length,
      truncated,
      ...split,
      warnings,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
