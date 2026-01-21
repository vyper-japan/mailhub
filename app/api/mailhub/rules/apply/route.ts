import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { getLabelRulesStore } from "@/lib/labelRulesStore";
import { getLabelRegistryStore } from "@/lib/labelRegistryStore";
import { matchRulesWithAssign, type AssignToSpec } from "@/lib/labelRules";
import { applyLabelsToMessages, ensureLabelId, getMessageMetadataForRules, getTestUserLabelNames, listLatestInboxMessages, applyTestActionDelay, assignMessage, getTestAssigneeMap, assigneeSlug } from "@/lib/gmail";
import { isTestMode } from "@/lib/test-mode";
import { logAction } from "@/lib/audit-log";
import { isAdminEmail } from "@/lib/admin";
import { isReadOnlyMode, writeForbiddenResponse } from "@/lib/read-only";

export const dynamic = "force-dynamic";

const MAX_APPLY_MESSAGES = 50;
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
  | { id: string; status: "applied"; labels: string[]; assignedTo: string | null }
  | { id: string; status: "skipped"; reason: string }
  | { id: string; status: "failed"; error: string };

export async function POST(req: Request) {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);

  const body = (await req.json().catch(() => ({} as Record<string, unknown>))) as Record<string, unknown>;
  const dryRun = body.dryRun === true;
  // READ ONLY: Preview(dryRun)のみ許可
  if (isReadOnlyMode() && !dryRun) {
    return writeForbiddenResponse("rules_apply");
  }
  const shouldLog = body.log === true;
  const ruleId = typeof body.ruleId === "string" ? body.ruleId : null;
  const max = typeof body.max === "number" && Number.isFinite(body.max) ? Math.max(1, Math.min(body.max, MAX_APPLY_MESSAGES)) : MAX_APPLY_MESSAGES;

  const messageIds = Array.isArray(body.messageIds)
    ? (body.messageIds as unknown[]).filter((v): v is string => typeof v === "string")
    : [];

  const listResult = messageIds.length === 0 ? await listLatestInboxMessages({ max }) : null;
  const listForPreview = listResult?.messages ?? null;
  const sourceIds = messageIds.length ? messageIds : (listForPreview ?? []).map((m) => m.id);
  if (sourceIds.length === 0) {
    return NextResponse.json({ error: "missing_messageIds" }, { status: 400 });
  }

  const targetIds = sourceIds.slice(0, max);
  const idToSummary = new Map(
    (listForPreview ?? []).map((m) => [m.id, { subject: m.subject ?? null, from: m.from ?? null }] as const),
  );

  const [rules, registeredList] = await Promise.all([
    getLabelRulesStore().getRules(),
    getLabelRegistryStore().list(),
  ]);
  const registered = new Set(registeredList.map((l) => l.labelName));

  const effectiveRules = ruleId ? rules.filter((r) => r.id === ruleId) : rules;
  if (ruleId && effectiveRules.length === 0) {
    return NextResponse.json({ error: "rule_not_found", ruleId }, { status: 404 });
  }
  if (!dryRun && ruleId && effectiveRules[0]?.enabled === false) {
    return NextResponse.json({ error: "rule_disabled", ruleId }, { status: 400 });
  }

  // registered labels -> labelId（冪等スキップ判定用）
  const labelNameToId = new Map<string, string>();
  await Promise.all(
    [...registered].map(async (name) => {
      const id = await withTimeout(ensureLabelId(name), PER_MESSAGE_TIMEOUT_MS, `ensureLabelId:${name}`).catch(() => null);
      if (id) labelNameToId.set(name, id);
    }),
  );

  const inTest = isTestMode();

  // テストモードでのアクション遅延を適用（dryRunでない場合のみ）
  if (!dryRun) {
    await applyTestActionDelay();
  }

  // Step 83: assignToSpecからassignee emailを解決するヘルパ
  const resolveAssigneeEmail = (spec: AssignToSpec | null): string | null => {
    if (!spec) return null;
    if (spec === "me") return authResult.user.email;
    if (typeof spec === "object" && spec.assigneeEmail) return spec.assigneeEmail;
    return null;
  };

  const results = await mapWithConcurrency<string, ApplyItem>(targetIds, 3, async (id) => {
    try {
      const meta = await withTimeout(getMessageMetadataForRules(id), PER_MESSAGE_TIMEOUT_MS, `metadata:${id}`);
      const fromEmail = meta.fromEmail;
      if (!fromEmail) return { id, status: "skipped", reason: "missing_from" };

      // Step 83: matchRulesWithAssignを使用
      const matchResult = matchRulesWithAssign(fromEmail, effectiveRules);
      const matchedLabels = matchResult.labels.filter((n) => registered.has(n));
      const assignToEmail = resolveAssigneeEmail(matchResult.assignTo);

      // labels も assignTo も無い場合はスキップ
      if (matchedLabels.length === 0 && !assignToEmail) {
        return { id, status: "skipped", reason: "no_match" };
      }

      // 既に付いているラベルはスキップ（冪等・API保護）
      const alreadyNames = inTest
        ? getTestUserLabelNames(id)
        : matchedLabels.filter((n) => {
            const lid = labelNameToId.get(n);
            return lid ? meta.labelIds.includes(lid) : false;
          });
      const alreadySet = new Set(alreadyNames);
      const toAdd = matchedLabels.filter((n) => !alreadySet.has(n));

      // Step 83: 既にassignされているかチェック（冪等性）
      let alreadyAssigned = false;
      if (assignToEmail) {
        const targetSlug = assigneeSlug(assignToEmail);
        if (inTest) {
          const testAssigneeMap = getTestAssigneeMap();
          alreadyAssigned = testAssigneeMap.get(id) === targetSlug;
        }
        // NOTE: prod環境での既存assign確認はassignMessage内で行われる（currentAssigneeSlugで判定）
      }

      // labels追加もassignも不要ならスキップ
      const hasLabelChange = toAdd.length > 0;
      const hasAssignChange = assignToEmail && !alreadyAssigned;
      if (!hasLabelChange && !hasAssignChange) {
        return { id, status: "skipped", reason: "already_labeled" };
      }

      if (dryRun) {
        return { id, status: "applied", labels: toAdd, assignedTo: hasAssignChange ? assignToEmail : null };
      }

      // Labels適用
      if (toAdd.length > 0) {
        const res = await withTimeout(applyLabelsToMessages([id], { addLabelNames: toAdd }), PER_MESSAGE_TIMEOUT_MS, `apply:${id}`);
        if (res.failed.length > 0) return { id, status: "failed", error: res.failed[0].error };
      }

      // Step 83: Assign適用
      let assignedToFinal: string | null = null;
      if (hasAssignChange && assignToEmail) {
        try {
          const assignRes = await withTimeout(
            assignMessage(id, assignToEmail, { force: false }),
            PER_MESSAGE_TIMEOUT_MS,
            `assign:${id}`
          );
          // force=falseなので、既に他人が担当している場合はスキップされる
          // currentAssigneeSlugがnullなら割り当て成功
          if (assignRes.currentAssigneeSlug === null) {
            assignedToFinal = assignToEmail;
          }
        } catch (e) {
          // assignの失敗はlabel適用が成功していれば部分成功として扱う
          console.warn(`[rules/apply] assign failed for ${id}: ${e}`);
        }
      }
      
      // 実際の変更をActivityログに記録（ruleId付き）
      // NOTE: ruleIdが指定されている場合のみ記録（全ルール適用時は記録しない）
      if (ruleId && shouldLog && !dryRun) {
        try {
          await logAction({
            actorEmail: authResult.user.email,
            action: "archive", // label付与はarchiveアクションとして記録
            messageId: id,
            metadata: { ruleId, labels: toAdd, assignedTo: assignedToFinal },
          });
        } catch {
          // ignore
        }
      }
      
      return { id, status: "applied", labels: toAdd, assignedTo: assignedToFinal };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { id, status: "failed", error: msg };
    }
  });

  const appliedDetails = results
    .filter((r): r is Extract<ApplyItem, { status: "applied" }> => r.status === "applied")
    .map((r) => ({ id: r.id, labels: r.labels, assignedTo: r.assignedTo }));
  const applied = appliedDetails.map((x) => x.id);
  // Step 83: assign予定/実行件数
  const assignedCount = appliedDetails.filter((x) => x.assignedTo).length;
  const skipped = results.filter((r) => r.status === "skipped").map((r) => r.id);
  const failed = results
    .filter((r): r is Extract<ApplyItem, { status: "failed" }> => r.status === "failed")
    .map((r) => ({ id: r.id, error: r.error }));

  const matchedIds = applied; // dryRun時は「would add」があるものをmatched扱い
  const samples = matchedIds.slice(0, 10).map((id) => {
    const s = idToSummary.get(id);
    return { id, subject: s?.subject ?? null, from: s?.from ?? null };
  });

  const preview = dryRun
    ? {
        matchedCount: matchedIds.length,
        matchedIds,
        samples,
        max: targetIds.length,
        truncated: sourceIds.length > targetIds.length,
        assignedCount, // Step 83: assign予定件数
      }
    : null;

  // Activityログ（best-effort / 明示指定のみ）
  if (shouldLog) {
    if (!isAdminEmail(authResult.user.email)) {
      return NextResponse.json({ error: "forbidden_admin_only" }, { status: 403 });
    }
    try {
      await logAction({
        actorEmail: authResult.user.email,
        action: dryRun ? "rule_preview" : "rule_apply",
        messageId: "",
        metadata: {
          ruleId,
          processed: targetIds.length,
          matched: matchedIds.length,
          truncated: sourceIds.length > targetIds.length,
          max,
        },
      });
    } catch {
      // ignore
    }
  }

  return NextResponse.json(
    {
      applied,
      appliedDetails,
      skipped,
      failed,
      truncated: sourceIds.length > targetIds.length,
      processed: targetIds.length,
      assignedCount, // Step 83: assign実行/予定件数
      preview,
    },
    { headers: { "cache-control": "no-store" } },
  );
}


