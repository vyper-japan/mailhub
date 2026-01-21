import "server-only";

import type { LabelRule } from "@/lib/labelRules";
import type { AssigneeRule } from "@/lib/assigneeRules";
import { matchRules } from "@/lib/labelRules";
import { matchAssigneeRule, getFromDomain, normalizeFromEmail } from "@/lib/assigneeRules";
import { isBroadDomain } from "@/lib/ruleSafety";
import { listLatestInboxMessages } from "@/lib/gmail";

export type RuleConflict = {
  type: "label_label" | "assignee_assignee" | "cross_type";
  ruleIds: string[];
  matchCondition: { fromEmail?: string; fromDomain?: string };
  conflictingResults: Array<{ ruleId: string; result: string | string[] }>;
  message: string;
};

export type DangerousRule = {
  ruleId: string;
  ruleType: "label" | "assignee";
  reason: "broad_domain" | "too_many_matches";
  matchCondition: { fromEmail?: string; fromDomain?: string };
  message: string;
  previewCount?: number;
};

export type InactiveRule = {
  ruleId: string;
  ruleType: "label" | "assignee";
  matchCondition: { fromEmail?: string; fromDomain?: string };
  message: string;
};

export type RuleInspectionResult = {
  conflicts: RuleConflict[];
  dangerous: DangerousRule[];
  inactive: InactiveRule[];
  hitStats: Array<{
    ruleId: string;
    ruleType: "label" | "assignee";
    hitCount: number;
    sampleMessages: Array<{ id: string; subject: string | null; from: string | null }>;
  }>;
};

export type RuleExplainResult = {
  messageId: string;
  fromEmail: string | null;
  labelRules: Array<{
    ruleId: string;
    enabled: boolean;
    priority?: number;
    matchReason: "fromEmail" | "fromDomain" | "no_match";
    matchCondition: { fromEmail?: string; fromDomain?: string };
    result: string[]; // labelNames
  }>;
  assigneeRules: Array<{
    ruleId: string;
    enabled: boolean;
    priority: number;
    matchReason: "fromEmail" | "fromDomain" | "no_match";
    matchCondition: { fromEmail?: string; fromDomain?: string };
    result: string | null; // assigneeEmail or null
  }>;
};

/**
 * ラベルルール間の衝突を検知
 */
function detectLabelRuleConflicts(rules: LabelRule[]): RuleConflict[] {
  const conflicts: RuleConflict[] = [];
  const enabled = rules.filter((r) => r.enabled);

  // 同じ条件でマッチする可能性があるルールの組み合わせを検出
  for (let i = 0; i < enabled.length; i++) {
    for (let j = i + 1; j < enabled.length; j++) {
      const r1 = enabled[i];
      const r2 = enabled[j];

      // 同じfromEmailでマッチする場合
      if (r1.match.fromEmail && r2.match.fromEmail) {
        const email1 = normalizeFromEmail(r1.match.fromEmail);
        const email2 = normalizeFromEmail(r2.match.fromEmail);
        if (email1 && email2 && email1 === email2) {
          const labels1 = r1.labelNames?.length ? r1.labelNames : r1.labelName ? [r1.labelName] : [];
          const labels2 = r2.labelNames?.length ? r2.labelNames : r2.labelName ? [r2.labelName] : [];
          const sorted1 = [...labels1].sort().join(",");
          const sorted2 = [...labels2].sort().join(",");
          if (sorted1 !== sorted2) {
            conflicts.push({
              type: "label_label",
              ruleIds: [r1.id, r2.id],
              matchCondition: { fromEmail: email1 },
              conflictingResults: [
                { ruleId: r1.id, result: labels1 },
                { ruleId: r2.id, result: labels2 },
              ],
              message: `同じfromEmail(${email1})で複数のラベルルールがマッチし、結果が異なります`,
            });
          }
        }
      }

      // 同じfromDomainでマッチする場合
      if (r1.match.fromDomain && r2.match.fromDomain) {
        const domain1 = r1.match.fromDomain.toLowerCase().replace(/^@/, "");
        const domain2 = r2.match.fromDomain.toLowerCase().replace(/^@/, "");
        if (domain1 && domain2 && domain1 === domain2) {
          const labels1 = r1.labelNames?.length ? r1.labelNames : r1.labelName ? [r1.labelName] : [];
          const labels2 = r2.labelNames?.length ? r2.labelNames : r2.labelName ? [r2.labelName] : [];
          const sorted1 = [...labels1].sort().join(",");
          const sorted2 = [...labels2].sort().join(",");
          if (sorted1 !== sorted2) {
            conflicts.push({
              type: "label_label",
              ruleIds: [r1.id, r2.id],
              matchCondition: { fromDomain: domain1 },
              conflictingResults: [
                { ruleId: r1.id, result: labels1 },
                { ruleId: r2.id, result: labels2 },
              ],
              message: `同じfromDomain(${domain1})で複数のラベルルールがマッチし、結果が異なります`,
            });
          }
        }
      }

      // fromEmailとfromDomainの包含関係（例: foo@bar.com と bar.com）
      if (r1.match.fromEmail && r2.match.fromDomain) {
        const email1 = normalizeFromEmail(r1.match.fromEmail);
        if (email1) {
          const domain1 = getFromDomain(email1);
          const domain2 = r2.match.fromDomain.toLowerCase().replace(/^@/, "");
          if (domain1 && domain2 && domain1 === domain2) {
            const labels1 = r1.labelNames?.length ? r1.labelNames : r1.labelName ? [r1.labelName] : [];
            const labels2 = r2.labelNames?.length ? r2.labelNames : r2.labelName ? [r2.labelName] : [];
            const sorted1 = [...labels1].sort().join(",");
            const sorted2 = [...labels2].sort().join(",");
            if (sorted1 !== sorted2) {
              conflicts.push({
                type: "label_label",
                ruleIds: [r1.id, r2.id],
                matchCondition: { fromEmail: email1, fromDomain: domain2 },
                conflictingResults: [
                  { ruleId: r1.id, result: labels1 },
                  { ruleId: r2.id, result: labels2 },
                ],
                message: `fromEmail(${email1})とfromDomain(${domain2})でラベルルールが衝突する可能性があります`,
              });
            }
          }
        }
      }
    }
  }

  return conflicts;
}

/**
 * Assigneeルール間の衝突を検知（priorityが同じで結果が違う場合）
 */
function detectAssigneeRuleConflicts(rules: AssigneeRule[]): RuleConflict[] {
  const conflicts: RuleConflict[] = [];
  const enabled = rules.filter((r) => r.enabled !== false);

  for (let i = 0; i < enabled.length; i++) {
    for (let j = i + 1; j < enabled.length; j++) {
      const r1 = enabled[i];
      const r2 = enabled[j];

      // priorityが同じで、同じ条件でマッチする可能性がある場合
      const priority1 = r1.priority ?? 0;
      const priority2 = r2.priority ?? 0;
      if (priority1 !== priority2) continue; // priorityが違えば衝突しない（先勝ち）

      // 同じfromEmailでマッチする場合
      if (r1.match.fromEmail && r2.match.fromEmail) {
        const email1 = normalizeFromEmail(r1.match.fromEmail);
        const email2 = normalizeFromEmail(r2.match.fromEmail);
        if (email1 && email2 && email1 === email2 && r1.assigneeEmail !== r2.assigneeEmail) {
          conflicts.push({
            type: "assignee_assignee",
            ruleIds: [r1.id, r2.id],
            matchCondition: { fromEmail: email1 },
            conflictingResults: [
              { ruleId: r1.id, result: r1.assigneeEmail },
              { ruleId: r2.id, result: r2.assigneeEmail },
            ],
            message: `同じfromEmail(${email1})で同じpriority(${priority1})のAssigneeルールが複数あり、結果が異なります`,
          });
        }
      }

      // 同じfromDomainでマッチする場合
      if (r1.match.fromDomain && r2.match.fromDomain) {
        const domain1 = r1.match.fromDomain.toLowerCase().replace(/^@/, "");
        const domain2 = r2.match.fromDomain.toLowerCase().replace(/^@/, "");
        if (domain1 && domain2 && domain1 === domain2 && r1.assigneeEmail !== r2.assigneeEmail) {
          conflicts.push({
            type: "assignee_assignee",
            ruleIds: [r1.id, r2.id],
            matchCondition: { fromDomain: domain1 },
            conflictingResults: [
              { ruleId: r1.id, result: r1.assigneeEmail },
              { ruleId: r2.id, result: r2.assigneeEmail },
            ],
            message: `同じfromDomain(${domain1})で同じpriority(${priority1})のAssigneeルールが複数あり、結果が異なります`,
          });
        }
      }
    }
  }

  return conflicts;
}

/**
 * 危険ルールを検知（広すぎるドメイン、Preview件数が多い）
 */
async function detectDangerousRules(
  labelRules: LabelRule[],
  assigneeRules: AssigneeRule[],
  sampleSize: number = 50,
): Promise<DangerousRule[]> {
  const dangerous: DangerousRule[] = [];

  // ラベルルールの危険検知
  for (const rule of labelRules) {
    if (!rule.enabled) continue;

    // 広すぎるドメイン
    if (rule.match.fromDomain) {
      const domain = rule.match.fromDomain.toLowerCase().replace(/^@/, "");
      if (isBroadDomain(domain)) {
        dangerous.push({
          ruleId: rule.id,
          ruleType: "label",
          reason: "broad_domain",
          matchCondition: { fromDomain: domain },
          message: `fromDomain(${domain})が広すぎます（誤爆の可能性）`,
        });
      }
    }

    // Preview件数が多い（サンプルで確認）
    try {
      const { messages: sample } = await listLatestInboxMessages({ max: sampleSize });
      let hitCount = 0;
      for (const msg of sample) {
        const fromEmail = msg.from ? normalizeFromEmail(msg.from) : null;
        if (!fromEmail) continue;
        const matched = matchRules(fromEmail, [rule]);
        if (matched.length > 0) hitCount++;
      }
      if (hitCount > 200) {
        dangerous.push({
          ruleId: rule.id,
          ruleType: "label",
          reason: "too_many_matches",
          matchCondition: rule.match,
          message: `サンプル${sampleSize}件中${hitCount}件にマッチします（誤爆の可能性）`,
          previewCount: hitCount,
        });
      }
    } catch {
      // エラーは無視（診断はbest-effort）
    }
  }

  // Assigneeルールの危険検知
  for (const rule of assigneeRules) {
    if (rule.enabled === false) continue;

    // 広すぎるドメイン
    if (rule.match.fromDomain) {
      const domain = rule.match.fromDomain.toLowerCase().replace(/^@/, "");
      if (isBroadDomain(domain) || rule.safety?.dangerousDomainConfirm === true) {
        dangerous.push({
          ruleId: rule.id,
          ruleType: "assignee",
          reason: "broad_domain",
          matchCondition: { fromDomain: domain },
          message: `fromDomain(${domain})が広すぎます（誤爆の可能性）`,
        });
      }
    }

    // Preview件数が多い（サンプルで確認）
    try {
      const { messages: sample } = await listLatestInboxMessages({ max: sampleSize, unassigned: true });
      let hitCount = 0;
      for (const msg of sample) {
        const fromEmail = msg.from ? normalizeFromEmail(msg.from) : null;
        if (!fromEmail) continue;
        const matchResult = matchAssigneeRule(fromEmail, rule);
        if (matchResult.ok) hitCount++;
      }
      if (hitCount > 200) {
        dangerous.push({
          ruleId: rule.id,
          ruleType: "assignee",
          reason: "too_many_matches",
          matchCondition: rule.match,
          message: `サンプル${sampleSize}件中${hitCount}件にマッチします（誤爆の可能性）`,
          previewCount: hitCount,
        });
      }
    } catch {
      // エラーは無視（診断はbest-effort）
    }
  }

  return dangerous;
}

/**
 * 無効ルールを検知（enabledだけど最近ヒットしていない）
 */
async function detectInactiveRules(
  labelRules: LabelRule[],
  assigneeRules: AssigneeRule[],
  sampleSize: number = 50,
): Promise<InactiveRule[]> {
  const inactive: InactiveRule[] = [];

  // サンプルメッセージでヒット確認
  try {
    const { messages: sample } = await listLatestInboxMessages({ max: sampleSize });

    // ラベルルール
    for (const rule of labelRules) {
      if (!rule.enabled) continue;
      let hit = false;
      for (const msg of sample) {
        const fromEmail = msg.from ? normalizeFromEmail(msg.from) : null;
        if (!fromEmail) continue;
        const matched = matchRules(fromEmail, [rule]);
        if (matched.length > 0) {
          hit = true;
          break;
        }
      }
      if (!hit) {
        inactive.push({
          ruleId: rule.id,
          ruleType: "label",
          matchCondition: rule.match,
          message: `enabledですが、サンプル${sampleSize}件中で一度もヒットしていません`,
        });
      }
    }

    // Assigneeルール（未割当のみ）
    const { messages: unassignedSample } = await listLatestInboxMessages({ max: sampleSize, unassigned: true });
    for (const rule of assigneeRules) {
      if (rule.enabled === false) continue;
      let hit = false;
      for (const msg of unassignedSample) {
        const fromEmail = msg.from ? normalizeFromEmail(msg.from) : null;
        if (!fromEmail) continue;
        const matchResult = matchAssigneeRule(fromEmail, rule);
        if (matchResult.ok) {
          hit = true;
          break;
        }
      }
      if (!hit) {
        inactive.push({
          ruleId: rule.id,
          ruleType: "assignee",
          matchCondition: rule.match,
          message: `enabledですが、サンプル${sampleSize}件中で一度もヒットしていません`,
        });
      }
    }
  } catch {
    // エラーは無視（診断はbest-effort）
  }

  return inactive;
}

/**
 * ルール診断を実行（副作用ゼロ、READ ONLYでも実行可）
 */
export async function inspectRules(
  labelRules: LabelRule[],
  assigneeRules: AssigneeRule[],
  sampleSize: number = 50,
): Promise<RuleInspectionResult> {
  const conflicts: RuleConflict[] = [];
  conflicts.push(...detectLabelRuleConflicts(labelRules));
  conflicts.push(...detectAssigneeRuleConflicts(assigneeRules));

  const dangerous = await detectDangerousRules(labelRules, assigneeRules, sampleSize);
  const inactive = await detectInactiveRules(labelRules, assigneeRules, sampleSize);

  // ヒット統計（サンプルベース）
  const hitStats: RuleInspectionResult["hitStats"] = [];
  try {
    const { messages: sample } = await listLatestInboxMessages({ max: sampleSize });
    const { messages: unassignedSample } = await listLatestInboxMessages({ max: sampleSize, unassigned: true });

    // ラベルルール
    for (const rule of labelRules) {
      if (!rule.enabled) continue;
      const hits: Array<{ id: string; subject: string | null; from: string | null }> = [];
      for (const msg of sample) {
        const fromEmail = msg.from ? normalizeFromEmail(msg.from) : null;
        if (!fromEmail) continue;
        const matched = matchRules(fromEmail, [rule]);
        if (matched.length > 0) {
          hits.push({ id: msg.id, subject: msg.subject ?? null, from: msg.from ?? null });
        }
      }
      if (hits.length > 0) {
        hitStats.push({
          ruleId: rule.id,
          ruleType: "label",
          hitCount: hits.length,
          sampleMessages: hits.slice(0, 5),
        });
      }
    }

    // Assigneeルール
    for (const rule of assigneeRules) {
      if (rule.enabled === false) continue;
      const hits: Array<{ id: string; subject: string | null; from: string | null }> = [];
      for (const msg of unassignedSample) {
        const fromEmail = msg.from ? normalizeFromEmail(msg.from) : null;
        if (!fromEmail) continue;
        const matchResult = matchAssigneeRule(fromEmail, rule);
        if (matchResult.ok) {
          hits.push({ id: msg.id, subject: msg.subject ?? null, from: msg.from ?? null });
        }
      }
      if (hits.length > 0) {
        hitStats.push({
          ruleId: rule.id,
          ruleType: "assignee",
          hitCount: hits.length,
          sampleMessages: hits.slice(0, 5),
        });
      }
    }
  } catch {
    // エラーは無視（診断はbest-effort）
  }

  return { conflicts, dangerous, inactive, hitStats };
}

/**
 * メッセージに対するルールExplain（副作用ゼロ、READ ONLYでも実行可）
 */
export async function explainRulesForMessage(
  messageId: string,
  fromEmail: string | null,
  labelRules: LabelRule[],
  assigneeRules: AssigneeRule[],
): Promise<RuleExplainResult> {
  const normalizedEmail = fromEmail ? normalizeFromEmail(fromEmail) : null;

  // ラベルルールのマッチ結果
  const labelMatches = labelRules.map((rule) => {
    let matchReason: "fromEmail" | "fromDomain" | "no_match" = "no_match";
    if (!normalizedEmail || !rule.enabled) {
      return {
        ruleId: rule.id,
        enabled: rule.enabled,
        priority: undefined,
        matchReason: "no_match" as const,
        matchCondition: rule.match,
        result: [] as string[],
      };
    }

    const domain = getFromDomain(normalizedEmail);
    if (rule.match.fromEmail) {
      const ruleEmail = normalizeFromEmail(rule.match.fromEmail);
      if (ruleEmail === normalizedEmail) {
        matchReason = "fromEmail";
      }
    }
    if (matchReason === "no_match" && rule.match.fromDomain && domain) {
      const ruleDomain = rule.match.fromDomain.toLowerCase().replace(/^@/, "");
      if (ruleDomain === domain) {
        matchReason = "fromDomain";
      }
    }

    const matched = matchReason !== "no_match" ? matchRules(normalizedEmail, [rule]) : [];
    return {
      ruleId: rule.id,
      enabled: rule.enabled,
      priority: undefined,
      matchReason,
      matchCondition: rule.match,
      result: matched,
    };
  });

  // Assigneeルールのマッチ結果（priority順）
  const assigneeMatches = assigneeRules
    .slice()
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
    .map((rule) => {
      let matchReason: "fromEmail" | "fromDomain" | "no_match" = "no_match";
      if (!normalizedEmail || rule.enabled === false) {
        return {
          ruleId: rule.id,
          enabled: rule.enabled !== false,
          priority: rule.priority ?? 0,
          matchReason: "no_match" as const,
          matchCondition: rule.match,
          result: null as string | null,
        };
      }

      const matchResult = matchAssigneeRule(normalizedEmail, rule);
      if (matchResult.ok) {
        matchReason = matchResult.reason;
        return {
          ruleId: rule.id,
          enabled: true,
          priority: rule.priority ?? 0,
          matchReason,
          matchCondition: rule.match,
          result: rule.assigneeEmail,
        };
      }

      return {
        ruleId: rule.id,
        enabled: true,
        priority: rule.priority ?? 0,
        matchReason: "no_match" as const,
        matchCondition: rule.match,
        result: null as string | null,
      };
    });

  return {
    messageId,
    fromEmail: normalizedEmail,
    labelRules: labelMatches,
    assigneeRules: assigneeMatches,
  };
}
