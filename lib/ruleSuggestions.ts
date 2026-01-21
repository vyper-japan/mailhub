import "server-only";

import type { AuditLogEntry } from "./audit-log";
import { getActivityLogs } from "./audit-log";
import { getMessageMetadataForRules } from "./gmail";
import { extractFromDomain, normalizeFromEmail, type LabelRule } from "./labelRules";
import { getLabelRulesStore } from "./labelRulesStore";
import { getAssigneeRulesStore } from "./assigneeRulesStore";
import { isBroadDomain } from "./ruleSafety";
import { MAILHUB_LABEL_MUTED } from "./gmail";

export type SuggestionType = "auto_label" | "auto_mute" | "auto_assign";

export type RuleSuggestion = {
  suggestionId: string; // 安定したID（同じsender+typeなら同じID）
  type: SuggestionType;
  sender: {
    fromEmail?: string;
    fromDomain?: string;
  };
  reason: string; // 提案理由（「誰が何回やったから提案」）
  evidenceCount: number; // 根拠ログ数
  actorCount: number; // 関与したactor数
  actors: string[]; // 関与したactorのemail（最大5件）
  proposedRule: {
    match: { fromEmail?: string; fromDomain?: string };
    labelNames?: string[];
    assigneeEmail?: string;
  };
  warnings: Array<{ type: "broad_domain" | "too_many_matches"; message: string }>;
};

export type RuleSuggestionsResult = {
  suggestions: RuleSuggestion[];
  warnings: Array<{ type: "broad_domain" | "too_many_matches"; message: string }>;
};

/**
 * 提案IDを生成（同じsender+typeなら同じID）
 */
function generateSuggestionId(type: SuggestionType, sender: { fromEmail?: string; fromDomain?: string }): string {
  const key = `${type}:${sender.fromEmail ?? ""}:${sender.fromDomain ?? ""}`;
  // 簡易ハッシュ（安定性重視）
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return `suggestion-${Math.abs(hash).toString(36)}`;
}

/**
 * 日付範囲でActivityログをフィルタ
 */
function filterLogsByDateRange(logs: AuditLogEntry[], days: number): AuditLogEntry[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffISO = cutoff.toISOString();

  return logs.filter((log) => log.timestamp >= cutoffISO);
}

/**
 * メッセージのfromEmailを取得（キャッシュを活用）
 */
async function getFromEmailForMessage(messageId: string): Promise<string | null> {
  try {
    const meta = await getMessageMetadataForRules(messageId);
    return meta.fromEmail;
  } catch {
    return null;
  }
}

/**
 * Auto Label提案を生成
 * NOTE: 現在の実装では、ラベル付与のActivityログが記録されていないため、
 * この機能は暫定的に無効化されています。
 * 将来的にラベル付与のActivityログが記録されるようになったら、この関数を有効化します。
 */
async function generateAutoLabelSuggestions(
  logs: AuditLogEntry[],
  existingRules: LabelRule[],
  minActions: number,
  minActors: number,
): Promise<RuleSuggestion[]> {
  // ラベル付与アクションを抽出（暫定的に空配列を返す）
  // TODO: ラベル付与のActivityログが記録されるようになったら、ここで抽出する
  const labelActions: AuditLogEntry[] = [];

  // messageIdごとにfromEmailを取得してグループ化
  const senderToActions = new Map<string, { fromEmail: string | null; fromDomain: string | null; actions: AuditLogEntry[] }>();

  for (const action of labelActions) {
    const fromEmail = await getFromEmailForMessage(action.messageId);
    if (!fromEmail) continue;

    const normalized = normalizeFromEmail(fromEmail);
    if (!normalized) continue;

    const domain = extractFromDomain(normalized);
    const key = normalized;

    if (!senderToActions.has(key)) {
      senderToActions.set(key, { fromEmail: normalized, fromDomain: domain, actions: [] });
    }
    senderToActions.get(key)!.actions.push(action);
  }

  // 既存ルールでカバーされているsenderを除外
  const coveredSenders = new Set<string>();
  for (const rule of existingRules) {
    if (!rule.enabled) continue;
    if (rule.match.fromEmail) {
      const normalized = normalizeFromEmail(rule.match.fromEmail);
      if (normalized) coveredSenders.add(normalized);
    }
    if (rule.match.fromDomain) {
      const domain = rule.match.fromDomain.toLowerCase().replace(/^@/, "");
      // fromDomainルールがある場合、そのドメインの全メールアドレスを除外
      for (const [senderKey, sender] of senderToActions.entries()) {
        if (sender.fromDomain === domain) {
          coveredSenders.add(senderKey);
        }
      }
    }
  }

  const suggestions: RuleSuggestion[] = [];

  for (const [senderKey, sender] of senderToActions.entries()) {
    if (coveredSenders.has(senderKey)) continue;

    const actions = sender.actions;
    if (actions.length < minActions) continue;

    // 関与したactorを集計
    const actorSet = new Set<string>();
    for (const action of actions) {
      actorSet.add(action.actorEmail);
    }

    if (actorSet.size < minActors) continue;

    // 最も多く付与されたラベルを特定
    const labelCounts = new Map<string, number>();
    for (const action of actions) {
      if (action.label) {
        labelCounts.set(action.label, (labelCounts.get(action.label) || 0) + 1);
      }
    }

    const topLabel = Array.from(labelCounts.entries())
      .sort((a, b) => b[1] - a[1])[0]?.[0];

    if (!topLabel) continue;

    const suggestionId = generateSuggestionId("auto_label", {
      ...(sender.fromEmail ? { fromEmail: sender.fromEmail } : {}),
      ...(sender.fromDomain ? { fromDomain: sender.fromDomain } : {}),
    });
    const warnings: RuleSuggestion["warnings"] = [];

    if (sender.fromDomain && isBroadDomain(sender.fromDomain)) {
      warnings.push({
        type: "broad_domain",
        message: `fromDomain(${sender.fromDomain})が広すぎます（誤爆の可能性）`,
      });
    }

    suggestions.push({
      suggestionId,
      type: "auto_label",
      sender: {
        ...(sender.fromEmail ? { fromEmail: sender.fromEmail } : {}),
        ...(sender.fromDomain ? { fromDomain: sender.fromDomain } : {}),
      },
      reason: `${actorSet.size}人が合計${actions.length}回「${topLabel}」を付与しました`,
      evidenceCount: actions.length,
      actorCount: actorSet.size,
      actors: Array.from(actorSet).slice(0, 5),
      proposedRule: {
        match: {
          ...(sender.fromEmail ? { fromEmail: sender.fromEmail } : {}),
          ...(sender.fromDomain ? { fromDomain: sender.fromDomain } : {}),
        },
        labelNames: [topLabel],
      },
      warnings,
    });
  }

  return suggestions;
}

/**
 * Auto Mute提案を生成
 */
async function generateAutoMuteSuggestions(
  logs: AuditLogEntry[],
  existingRules: LabelRule[],
  minActions: number,
  minActors: number,
): Promise<RuleSuggestion[]> {
  // muteアクションを抽出
  const muteActions = logs.filter((log) => log.action === "mute");

  // messageIdごとにfromEmailを取得してグループ化
  const senderToActions = new Map<string, { fromEmail: string | null; fromDomain: string | null; actions: AuditLogEntry[] }>();

  for (const action of muteActions) {
    const fromEmail = await getFromEmailForMessage(action.messageId);
    if (!fromEmail) continue;

    const normalized = normalizeFromEmail(fromEmail);
    if (!normalized) continue;

    const domain = extractFromDomain(normalized);
    const key = normalized;

    if (!senderToActions.has(key)) {
      senderToActions.set(key, { fromEmail: normalized, fromDomain: domain, actions: [] });
    }
    senderToActions.get(key)!.actions.push(action);
  }

  // 既存ルールでカバーされているsenderを除外（muteラベルを付与するルールがある場合）
  const coveredSenders = new Set<string>();
  for (const rule of existingRules) {
    if (!rule.enabled) continue;
    const labels = rule.labelNames ?? (rule.labelName ? [rule.labelName] : []);
    const hasMuteLabel = labels.some((l) => l.includes("Muted") || l.includes("mute"));
    if (!hasMuteLabel) continue;

    if (rule.match.fromEmail) {
      const normalized = normalizeFromEmail(rule.match.fromEmail);
      if (normalized) coveredSenders.add(normalized);
    }
    if (rule.match.fromDomain) {
      const domain = rule.match.fromDomain.toLowerCase().replace(/^@/, "");
      for (const [senderKey, sender] of senderToActions.entries()) {
        if (sender.fromDomain === domain) {
          coveredSenders.add(senderKey);
        }
      }
    }
  }

  const suggestions: RuleSuggestion[] = [];

  for (const [senderKey, sender] of senderToActions.entries()) {
    if (coveredSenders.has(senderKey)) continue;

    const actions = sender.actions;
    if (actions.length < minActions) continue;

    // 関与したactorを集計
    const actorSet = new Set<string>();
    for (const action of actions) {
      actorSet.add(action.actorEmail);
    }

    if (actorSet.size < minActors) continue;

    // Mutedラベルを取得
    const mutedLabel = MAILHUB_LABEL_MUTED;

    const suggestionId = generateSuggestionId("auto_mute", {
      ...(sender.fromEmail ? { fromEmail: sender.fromEmail } : {}),
      ...(sender.fromDomain ? { fromDomain: sender.fromDomain } : {}),
    });
    const warnings: RuleSuggestion["warnings"] = [];

    if (sender.fromDomain && isBroadDomain(sender.fromDomain)) {
      warnings.push({
        type: "broad_domain",
        message: `fromDomain(${sender.fromDomain})が広すぎます（誤爆の可能性）`,
      });
    }

    suggestions.push({
      suggestionId,
      type: "auto_mute",
      sender: {
        ...(sender.fromEmail ? { fromEmail: sender.fromEmail } : {}),
        ...(sender.fromDomain ? { fromDomain: sender.fromDomain } : {}),
      },
      reason: `${actorSet.size}人が合計${actions.length}回「低優先へ（ミュート）」を実行しました`,
      evidenceCount: actions.length,
      actorCount: actorSet.size,
      actors: Array.from(actorSet).slice(0, 5),
      proposedRule: {
        match: {
          ...(sender.fromEmail ? { fromEmail: sender.fromEmail } : {}),
          ...(sender.fromDomain ? { fromDomain: sender.fromDomain } : {}),
        },
        labelNames: [mutedLabel],
      },
      warnings,
    });
  }

  return suggestions;
}

/**
 * Auto Assign提案を生成
 */
async function generateAutoAssignSuggestions(
  logs: AuditLogEntry[],
  existingRules: Array<{ id: string; match: { fromEmail?: string; fromDomain?: string }; assigneeEmail: string; enabled: boolean }>,
  minActions: number,
  minActors: number,
): Promise<RuleSuggestion[]> {
  // assignアクションを抽出（metadataにassigneeEmailが含まれる想定）
  const assignActions = logs.filter((log) => log.action === "assign" || log.action === "takeover");

  // messageIdごとにfromEmailとassigneeEmailを取得してグループ化
  const senderToAssignees = new Map<
    string,
    {
      fromEmail: string | null;
      fromDomain: string | null;
      assigneeToActions: Map<string, AuditLogEntry[]>;
    }
  >();

  for (const action of assignActions) {
    const fromEmail = await getFromEmailForMessage(action.messageId);
    if (!fromEmail) continue;

    const normalized = normalizeFromEmail(fromEmail);
    if (!normalized) continue;

    const domain = extractFromDomain(normalized);
    const key = normalized;

    // metadataからassigneeEmailを取得
    const assigneeEmail = typeof action.metadata?.assigneeEmail === "string" ? action.metadata.assigneeEmail : null;
    if (!assigneeEmail || !assigneeEmail.endsWith("@vtj.co.jp")) continue;

    if (!senderToAssignees.has(key)) {
      senderToAssignees.set(key, {
        fromEmail: normalized,
        fromDomain: domain,
        assigneeToActions: new Map(),
      });
    }

    const sender = senderToAssignees.get(key)!;
    if (!sender.assigneeToActions.has(assigneeEmail)) {
      sender.assigneeToActions.set(assigneeEmail, []);
    }
    sender.assigneeToActions.get(assigneeEmail)!.push(action);
  }

  // 既存ルールでカバーされているsenderを除外
  const coveredSenders = new Set<string>();
  for (const rule of existingRules) {
    if (!rule.enabled) continue;
    if (rule.match.fromEmail) {
      const normalized = normalizeFromEmail(rule.match.fromEmail);
      if (normalized) coveredSenders.add(normalized);
    }
    if (rule.match.fromDomain) {
      const domain = rule.match.fromDomain.toLowerCase().replace(/^@/, "");
      for (const [senderKey, sender] of senderToAssignees.entries()) {
        if (sender.fromDomain === domain) {
          coveredSenders.add(senderKey);
        }
      }
    }
  }

  const suggestions: RuleSuggestion[] = [];

  for (const [senderKey, sender] of senderToAssignees.entries()) {
    if (coveredSenders.has(senderKey)) continue;

    // 最も多く割り当てられたassigneeを特定
    let topAssignee: string | null = null;
    let topCount = 0;
    let totalActions = 0;
    const allActors = new Set<string>();

    for (const [assigneeEmail, actions] of sender.assigneeToActions.entries()) {
      totalActions += actions.length;
      for (const action of actions) {
        allActors.add(action.actorEmail);
      }
      if (actions.length > topCount) {
        topCount = actions.length;
        topAssignee = assigneeEmail;
      }
    }

    if (totalActions < minActions) continue;
    if (allActors.size < minActors) continue;
    if (!topAssignee) continue;

    const suggestionId = generateSuggestionId("auto_assign", {
      ...(sender.fromEmail ? { fromEmail: sender.fromEmail } : {}),
      ...(sender.fromDomain ? { fromDomain: sender.fromDomain } : {}),
    });
    const warnings: RuleSuggestion["warnings"] = [];

    if (sender.fromDomain && isBroadDomain(sender.fromDomain)) {
      warnings.push({
        type: "broad_domain",
        message: `fromDomain(${sender.fromDomain})が広すぎます（誤爆の可能性）`,
      });
    }

    suggestions.push({
      suggestionId,
      type: "auto_assign",
      sender: {
        ...(sender.fromEmail ? { fromEmail: sender.fromEmail } : {}),
        ...(sender.fromDomain ? { fromDomain: sender.fromDomain } : {}),
      },
      reason: `${allActors.size}人が合計${totalActions}回「${topAssignee}」に割り当てました`,
      evidenceCount: totalActions,
      actorCount: allActors.size,
      actors: Array.from(allActors).slice(0, 5),
      proposedRule: {
        match: {
          ...(sender.fromEmail ? { fromEmail: sender.fromEmail } : {}),
          ...(sender.fromDomain ? { fromDomain: sender.fromDomain } : {}),
        },
        assigneeEmail: topAssignee,
      },
      warnings,
    });
  }

  return suggestions;
}

/**
 * ルール提案を生成
 */
export async function generateRuleSuggestions(options?: {
  days?: number;
  minActions?: number;
  minActors?: number;
}): Promise<RuleSuggestionsResult> {
  const days = options?.days ?? 14;
  const minActions = options?.minActions ?? 3;
  const minActors = options?.minActors ?? 2;

  // Activityログを取得
  const allLogs = await getActivityLogs({ limit: 1000 }); // 最大1000件取得
  const logs = filterLogsByDateRange(allLogs, days);

  // 既存ルールを取得
  const [labelRules, assigneeRules] = await Promise.all([
    getLabelRulesStore().getRules(),
    getAssigneeRulesStore().getRules(),
  ]);

  // 提案を生成
  const [labelSuggestions, muteSuggestions, assignSuggestions] = await Promise.all([
    generateAutoLabelSuggestions(logs, labelRules, minActions, minActors),
    generateAutoMuteSuggestions(logs, labelRules, minActions, minActors),
    generateAutoAssignSuggestions(logs, assigneeRules, minActions, minActors),
  ]);

  const allSuggestions = [...labelSuggestions, ...muteSuggestions, ...assignSuggestions];

  // 全体の警告を集約
  const globalWarnings: RuleSuggestionsResult["warnings"] = [];
  const hasBroadDomain = allSuggestions.some((s) => s.warnings.some((w) => w.type === "broad_domain"));
  if (hasBroadDomain) {
    globalWarnings.push({
      type: "broad_domain",
      message: "一部の提案に広すぎるドメインが含まれています。Previewで件数を確認してください。",
    });
  }

  return {
    suggestions: allSuggestions,
    warnings: globalWarnings,
  };
}
