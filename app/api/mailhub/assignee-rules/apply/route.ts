import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { isAdminEmail } from "@/lib/admin";
import { isReadOnlyMode, writeForbiddenResponse } from "@/lib/read-only";
import { logAction } from "@/lib/audit-log";
import { getAssigneeRulesStore } from "@/lib/assigneeRulesStore";
import { pickAssigneeRule, type AssigneeRule } from "@/lib/assigneeRules";
import { assignMessage, getMessageMetadataForRules, listLatestInboxMessages } from "@/lib/gmail";

export const dynamic = "force-dynamic";

const MAX_APPLY_MESSAGES = 50;
const MAX_PREVIEW_MESSAGES = 500;
const PER_MESSAGE_TIMEOUT_MS = 6_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout:${label}`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
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

type ApplyItem =
  | { id: string; status: "applied"; assigneeEmail: string; ruleId: string }
  | { id: string; status: "skipped"; reason: string }
  | { id: string; status: "failed"; error: string };

type Preview = {
  matchedCount: number;
  matchedIds: string[];
  samples: Array<{ id: string; subject: string | null; from: string | null; assigneeEmail: string; ruleId: string }>;
  max: number;
  truncated: boolean;
  warnings: Array<{ type: "broad_domain" | "too_many"; message: string }>;
};

function computeWarnings(rules: AssigneeRule[], matchedCount: number): Preview["warnings"] {
  const warnings: Preview["warnings"] = [];
  const hasBroadDomain = rules.some((r) => r.enabled !== false && r.match?.fromDomain && r.safety?.dangerousDomainConfirm === true);
  if (hasBroadDomain) {
    warnings.push({ type: "broad_domain", message: "⚠️ 広すぎるfromDomainルールが有効です（誤爆の可能性）" });
  }
  if (matchedCount > 200) {
    warnings.push({ type: "too_many", message: `⚠️ マッチ件数が多すぎます（${matchedCount}件）。Previewで内容を確認し、必要ならルールを絞ってください。` });
  }
  return warnings;
}

export async function POST(req: Request) {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);

  const body = (await req.json().catch(() => ({} as Record<string, unknown>))) as Record<string, unknown>;
  const dryRun = body.dryRun === true;

  // READ ONLY: Preview(dryRun)のみ許可
  if (isReadOnlyMode() && !dryRun) {
    return writeForbiddenResponse("assignee_rules_apply");
  }
  // Applyはadmin必須
  if (!dryRun && !isAdminEmail(authResult.user.email)) {
    return NextResponse.json({ error: "forbidden_admin_only" }, { status: 403 });
  }

  const shouldLog = body.log === true;
  const requestedMax = typeof body.max === "number" && Number.isFinite(body.max) ? Math.max(1, body.max) : (dryRun ? 200 : MAX_APPLY_MESSAGES);
  const max = dryRun ? Math.min(requestedMax, MAX_PREVIEW_MESSAGES) : Math.min(requestedMax, MAX_APPLY_MESSAGES);

  const rules = await getAssigneeRulesStore().getRules();
  const effectiveRules = rules
    .filter((r) => r.enabled !== false)
    .slice()
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  // ルールが無い場合は即返す
  if (effectiveRules.length === 0) {
    return NextResponse.json(
      { applied: [], skipped: [], failed: [], truncated: false, processed: 0, preview: dryRun ? { matchedCount: 0, matchedIds: [], samples: [], max, truncated: false, warnings: [] } satisfies Preview : null },
      { headers: { "cache-control": "no-store" } },
    );
  }

  // 未割当のみ（サーバ側で二重ガード）
  const { messages: list } = await listLatestInboxMessages({ max, unassigned: true });
  const sourceIds = list.map((m) => m.id);
  if (sourceIds.length === 0) {
    return NextResponse.json(
      { applied: [], skipped: [], failed: [], truncated: false, processed: 0, preview: dryRun ? { matchedCount: 0, matchedIds: [], samples: [], max, truncated: false, warnings: computeWarnings(effectiveRules, 0) } satisfies Preview : null },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const targetIds = sourceIds.slice(0, max);
  const idToSummary = new Map(list.map((m) => [m.id, { subject: m.subject ?? null, from: m.from ?? null }] as const));

  const results = await mapWithConcurrency<string, ApplyItem>(targetIds, 3, async (id) => {
    try {
      const meta = await withTimeout(getMessageMetadataForRules(id), PER_MESSAGE_TIMEOUT_MS, `metadata:${id}`);
      const fromEmail = meta.fromEmail;
      if (!fromEmail) return { id, status: "skipped", reason: "missing_from" };

      const rule = pickAssigneeRule(fromEmail, effectiveRules);
      if (!rule) return { id, status: "skipped", reason: "no_match" };
      if (rule.when?.unassignedOnly !== true) return { id, status: "skipped", reason: "not_unassigned_only" };

      if (dryRun) {
        return { id, status: "applied", assigneeEmail: rule.assigneeEmail, ruleId: rule.id };
      }

      // takeoverはしない（force=false）
      await withTimeout(assignMessage(id, rule.assigneeEmail, { force: false }), PER_MESSAGE_TIMEOUT_MS, `assign:${id}`);
      
      // 実際の変更をActivityログに記録（ruleId付き）
      // NOTE: shouldLogがtrueの場合のみ記録（明示指定）
      if (shouldLog && !dryRun) {
        try {
          await logAction({
            actorEmail: authResult.user.email,
            action: "assign",
            messageId: id,
            metadata: { ruleId: rule.id, assigneeEmail: rule.assigneeEmail },
          });
        } catch {
          // ignore
        }
      }
      
      return { id, status: "applied", assigneeEmail: rule.assigneeEmail, ruleId: rule.id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { id, status: "failed", error: msg };
    }
  });

  const appliedDetails = results.filter((r): r is Extract<ApplyItem, { status: "applied" }> => r.status === "applied");
  const applied = appliedDetails.map((x) => x.id);
  const skipped = results.filter((r) => r.status === "skipped").map((r) => r.id);
  const failed = results
    .filter((r): r is Extract<ApplyItem, { status: "failed" }> => r.status === "failed")
    .map((r) => ({ id: r.id, error: r.error }));

  const matchedIds = applied;
  const samples = appliedDetails.slice(0, 10).map((x) => {
    const s = idToSummary.get(x.id);
    return { id: x.id, subject: s?.subject ?? null, from: s?.from ?? null, assigneeEmail: x.assigneeEmail, ruleId: x.ruleId };
  });

  const preview = dryRun
    ? ({
        matchedCount: matchedIds.length,
        matchedIds,
        samples,
        max: targetIds.length,
        truncated: sourceIds.length > targetIds.length,
        warnings: computeWarnings(effectiveRules, matchedIds.length),
      } satisfies Preview)
    : null;

  // Activityログ（best-effort / 明示指定のみ）
  if (shouldLog) {
    if (!isAdminEmail(authResult.user.email)) {
      return NextResponse.json({ error: "forbidden_admin_only" }, { status: 403 });
    }
    try {
      // ruleIdを取得（最初の適用ルールから）
      const firstRuleId = appliedDetails.length > 0 ? appliedDetails[0].ruleId : null;
      
      await logAction({
        actorEmail: authResult.user.email,
        action: dryRun ? "assignee_rule_preview" : "assignee_rule_apply",
        messageId: "",
        metadata: {
          ...(firstRuleId ? { ruleId: firstRuleId } : {}),
          processed: targetIds.length,
          matched: matchedIds.length,
          truncated: sourceIds.length > targetIds.length,
          max,
          applied: applied.length,
          skipped: skipped.length,
          failed: failed.length,
        },
      });
    } catch {
      // ignore
    }
  }

  return NextResponse.json(
    { applied, appliedDetails, skipped, failed, truncated: sourceIds.length > targetIds.length, processed: targetIds.length, preview },
    { headers: { "cache-control": "no-store" } },
  );
}

