import "server-only";

import { NextResponse } from "next/server";
import { logAction } from "@/lib/audit-log";
import { getMessageDetail, muteMessage, shouldFailInTestMode } from "@/lib/gmail";
import { parseGmailError } from "@/lib/gmail-error";
import { extractFromEmail } from "@/lib/labelRules";
import { authErrorResponse, requireUser } from "@/lib/require-user";
import { isReadOnlyMode, writeForbiddenResponse } from "@/lib/read-only";
import {
  evaluateDetailNoiseSafety,
  type NoiseSafetyDecision,
} from "@/lib/noiseSafety";

export const dynamic = "force-dynamic";

const MAX_APPLY_MESSAGES = 50;

type NoiseApplyItem =
  | { id: string; status: "muted"; classification: NoiseSafetyDecision["classification"] }
  | {
      id: string;
      status: "skipped";
      reason: "protected" | "missing_summary" | "not_noise" | "sender_mismatch";
      classification: NoiseSafetyDecision["classification"];
    }
  | { id: string; status: "failed"; error: string };

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
  return out.slice(0, MAX_APPLY_MESSAGES);
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

export async function POST(req: Request) {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);
  if (isReadOnlyMode()) return writeForbiddenResponse("noise_apply");

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const ids = parseMessageIds(body.messageIds);
  if (ids.length === 0) {
    return NextResponse.json({ error: "missing_messageIds" }, { status: 400 });
  }

  const expectedFromEmail = typeof body.fromEmail === "string" ? extractFromEmail(body.fromEmail) : null;
  const results = await mapWithConcurrency(ids, 3, async (id): Promise<NoiseApplyItem> => {
    try {
      if (shouldFailInTestMode("mute", id)) {
        return { id, status: "failed", error: "test_mode_fail" };
      }

      const detail = await getMessageDetail(id);
      const decision = evaluateDetailNoiseSafety(detail);
      const actualFromEmail = extractFromEmail(detail.from);
      if (expectedFromEmail && actualFromEmail !== expectedFromEmail) {
        return {
          id,
          status: "skipped",
          reason: "sender_mismatch",
          classification: decision.classification,
        };
      }

      if (decision.status !== "safe_to_suppress") {
        return {
          id,
          status: "skipped",
          reason: decision.status === "protected" ? "protected" : decision.status,
          classification: decision.classification,
        };
      }

      await muteMessage(id);
      await logAction({
        actorEmail: authResult.user.email,
        action: "mute",
        messageId: id,
        metadata: {
          source: "noise_apply",
          fromEmail: expectedFromEmail,
          classification: decision.classification,
        },
      }).catch(() => {
        // best-effort audit; the mutation already succeeded
      });

      return { id, status: "muted", classification: decision.classification };
    } catch (e) {
      const parsed = parseGmailError(e);
      return { id, status: "failed", error: parsed.message };
    }
  });

  const muted = results.filter((item): item is Extract<NoiseApplyItem, { status: "muted" }> => item.status === "muted");
  const skipped = results.filter((item): item is Extract<NoiseApplyItem, { status: "skipped" }> => item.status === "skipped");
  const failed = results.filter((item): item is Extract<NoiseApplyItem, { status: "failed" }> => item.status === "failed");

  return NextResponse.json(
    {
      success: failed.length === 0,
      processed: ids.length,
      mutedCount: muted.length,
      skippedCount: skipped.length,
      failedCount: failed.length,
      muted,
      skipped,
      failed,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
