import "server-only";

import { getLabelRulesStore } from "@/lib/labelRulesStore";
import { getLabelRegistryStore } from "@/lib/labelRegistryStore";
import { matchRules } from "@/lib/labelRules";
import {
  listLatestInboxMessages,
  getMessageMetadataForRules,
  applyLabelsToMessages,
  ensureLabelId,
  getTestUserLabelNames,
} from "@/lib/gmail";
import { isTestMode } from "@/lib/test-mode";
import { MAILHUB_USER_LABEL_PREFIX } from "@/lib/mailhub-labels";

const DEFAULT_MAX_TOTAL = 100;
const DEFAULT_MAX_PER_RULE = 50;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_TIMEOUT_MS = 6_000;

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

type RuleResult = {
  ruleId: string;
  candidates: number;
  applied: number;
  skipped: number;
  failed: number;
  failedIds: string[];
  truncated: boolean;
};

type RunResult = {
  mode: "dryRun" | "apply";
  truncated: boolean;
  totalCandidates: number;
  totalApplied: number;
  totalSkipped: number;
  totalFailed: number;
  perRule: RuleResult[];
};

/**
 * Auto Rules Runner: 有効化されたルールを一括実行
 */
export async function runAutoRules(opts: {
  dryRun: boolean;
  maxTotal?: number;
  maxPerRule?: number;
  concurrency?: number;
  timeoutMs?: number;
}): Promise<RunResult> {
  const {
    dryRun,
    maxTotal = DEFAULT_MAX_TOTAL,
    maxPerRule = DEFAULT_MAX_PER_RULE,
    concurrency = DEFAULT_CONCURRENCY,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = opts;

  // 有効化されたルール一覧を取得
  const [rules, registeredList] = await Promise.all([
    getLabelRulesStore().getRules(),
    getLabelRegistryStore().list(),
  ]);
  const enabledRules = rules.filter((r) => r.enabled);
  const registered = new Set(registeredList.map((l) => l.labelName));

  if (enabledRules.length === 0) {
    return {
      mode: dryRun ? "dryRun" : "apply",
      truncated: false,
      totalCandidates: 0,
      totalApplied: 0,
      totalSkipped: 0,
      totalFailed: 0,
      perRule: [],
    };
  }

  // registered labels -> labelId（冪等スキップ判定用）
  const labelNameToId = new Map<string, string>();
  await Promise.all(
    [...registered].map(async (name) => {
      const id = await withTimeout(ensureLabelId(name), timeoutMs, `ensureLabelId:${name}`).catch(() => null);
      if (id) labelNameToId.set(name, id);
    }),
  );

  const inTest = isTestMode();
  const perRuleResults: RuleResult[] = [];
  let totalCandidates = 0;
  let totalApplied = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let globalTruncated = false;

  // ルールごとに処理
  for (const rule of enabledRules) {
    if (totalCandidates >= maxTotal) {
      globalTruncated = true;
      break;
    }

    // ルール用のGmail検索クエリを生成
    const queryParts: string[] = [];
    if (rule.match.fromEmail) {
      queryParts.push(`from:${rule.match.fromEmail}`);
    } else if (rule.match.fromDomain) {
      queryParts.push(`from:${rule.match.fromDomain}`);
    }
    const query = queryParts.join(" ");

    // 対象メッセージを取得（maxPerRuleで制限）
    const remaining = maxTotal - totalCandidates;
    const ruleMax = Math.min(maxPerRule, remaining);
    const { messages: candidates } = await listLatestInboxMessages({ max: ruleMax, q: query });

    const ruleCandidates = candidates.length;
    totalCandidates += ruleCandidates;

    if (ruleCandidates === 0) {
      perRuleResults.push({
        ruleId: rule.id,
        candidates: 0,
        applied: 0,
        skipped: 0,
        failed: 0,
        failedIds: [],
        truncated: false,
      });
      continue;
    }

    // 各メッセージに対してラベル付与を計算
    const ruleApplied: string[] = [];
    const ruleSkipped: string[] = [];
    const ruleFailed: Array<{ id: string; error: string }> = [];

    await mapWithConcurrency(candidates, concurrency, async (message) => {
      try {
        const meta = await withTimeout(getMessageMetadataForRules(message.id), timeoutMs, `metadata:${message.id}`);
        const fromEmail = meta.fromEmail;
        if (!fromEmail) {
          ruleSkipped.push(message.id);
          return;
        }

        // マッチするラベルを計算
        const matched = matchRules(fromEmail, [rule]).filter((n) => registered.has(n));
        if (matched.length === 0) {
          ruleSkipped.push(message.id);
          return;
        }

        // 既に付いているラベルはスキップ（冪等）
        const alreadyNames = inTest
          ? getTestUserLabelNames(message.id)
          : matched.filter((n) => {
              const lid = labelNameToId.get(n);
              return lid ? meta.labelIds.includes(lid) : false;
            });
        const alreadySet = new Set(alreadyNames);
        const toAdd = matched.filter((n) => !alreadySet.has(n) && n.startsWith(MAILHUB_USER_LABEL_PREFIX));
        if (toAdd.length === 0) {
          ruleSkipped.push(message.id);
          return;
        }

        if (dryRun) {
          ruleApplied.push(message.id);
          return;
        }

        // 実際にラベルを付与
        const res = await withTimeout(
          applyLabelsToMessages([message.id], { addLabelNames: toAdd }),
          timeoutMs,
          `apply:${message.id}`,
        );
        if (res.failed.length > 0) {
          ruleFailed.push({ id: message.id, error: res.failed[0].error });
        } else {
          ruleApplied.push(message.id);
        }
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        ruleFailed.push({ id: message.id, error: errorMsg });
      }
    });

    totalApplied += ruleApplied.length;
    totalSkipped += ruleSkipped.length;
    totalFailed += ruleFailed.length;

    perRuleResults.push({
      ruleId: rule.id,
      candidates: ruleCandidates,
      applied: ruleApplied.length,
      skipped: ruleSkipped.length,
      failed: ruleFailed.length,
      failedIds: ruleFailed.slice(0, 10).map((f) => f.id), // 上位10件
      truncated: ruleCandidates >= ruleMax && candidates.length >= ruleMax,
    });

    if (totalCandidates >= maxTotal) {
      globalTruncated = true;
      break;
    }
  }

  return {
    mode: dryRun ? "dryRun" : "apply",
    truncated: globalTruncated,
    totalCandidates,
    totalApplied,
    totalSkipped,
    totalFailed,
    perRule: perRuleResults,
  };
}
