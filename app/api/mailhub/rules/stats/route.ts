import "server-only";
import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { getActivityLogs } from "@/lib/audit-log";
import { getLabelRulesStore } from "@/lib/labelRulesStore";
import { getAssigneeRulesStore } from "@/lib/assigneeRulesStore";

export const dynamic = "force-dynamic";

type RuleStats = {
  ruleId: string;
  enabled: boolean;
  lastPreviewAt: string | null;
  lastApplyAt: string | null;
  appliedMessagesCount7d: number;
  appliedMessagesCount30d: number;
  lastApplySummary: {
    processed: number;
    matched: number;
    applied: number;
    skipped: number;
    failed: number;
  } | null;
};

/**
 * ルール統計を取得するAPI
 * GET /api/mailhub/rules/stats?days=30
 */
export async function GET(req: Request) {
  const authResult = await requireUser();
  if (!authResult.ok) {
    return authErrorResponse(authResult);
  }

  const url = new URL(req.url);
  const daysParam = url.searchParams.get("days");
  // daysパラメータは将来の拡張用（現状は30日固定で使用）
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _days = daysParam && /^\d+$/.test(daysParam) ? Math.min(Math.max(1, parseInt(daysParam, 10)), 90) : 30;

  const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Activityログを取得（ruleIdフィルタなしで全件取得）
  const allLogs = await getActivityLogs({ limit: 1000 });

  // ルール一覧を取得
  const [labelRules, assigneeRules] = await Promise.all([
    getLabelRulesStore().getRules(),
    getAssigneeRulesStore().getRules(),
  ]);

  const stats: RuleStats[] = [];

  // Label Rules統計
  for (const rule of labelRules) {
    const ruleLogs = allLogs.filter(
      (log) =>
        (log.action === "rule_preview" || log.action === "rule_apply") &&
        log.metadata &&
        typeof log.metadata === "object" &&
        "ruleId" in log.metadata &&
        log.metadata.ruleId === rule.id,
    );

    const previewLogs = ruleLogs.filter((log) => log.action === "rule_preview");
    const applyLogs = ruleLogs.filter((log) => log.action === "rule_apply");

    const lastPreviewAt = previewLogs.length > 0 ? previewLogs[0].timestamp : null;
    const lastApplyAt = applyLogs.length > 0 ? applyLogs[0].timestamp : null;

    // 7日/30日の適用件数（実際にメールに変更を加えた件数）
    // NOTE: 実際の変更は別のアクション（archive, mute等）で記録される想定だが、
    // 現状はrule_applyのmatched数で代用
    const applied7d = applyLogs.filter((log) => log.timestamp >= cutoff7d).reduce((sum, log) => {
      const matched = log.metadata && typeof log.metadata === "object" && "matched" in log.metadata && typeof log.metadata.matched === "number" ? log.metadata.matched : 0;
      return sum + matched;
    }, 0);
    const applied30d = applyLogs.filter((log) => log.timestamp >= cutoff30d).reduce((sum, log) => {
      const matched = log.metadata && typeof log.metadata === "object" && "matched" in log.metadata && typeof log.metadata.matched === "number" ? log.metadata.matched : 0;
      return sum + matched;
    }, 0);

    const lastApply = applyLogs[0];
    const lastApplySummary =
      lastApply && lastApply.metadata && typeof lastApply.metadata === "object"
        ? {
            processed: "processed" in lastApply.metadata && typeof lastApply.metadata.processed === "number" ? lastApply.metadata.processed : 0,
            matched: "matched" in lastApply.metadata && typeof lastApply.metadata.matched === "number" ? lastApply.metadata.matched : 0,
            applied: "applied" in lastApply.metadata && typeof lastApply.metadata.applied === "number" ? lastApply.metadata.applied : 0,
            skipped: "skipped" in lastApply.metadata && typeof lastApply.metadata.skipped === "number" ? lastApply.metadata.skipped : 0,
            failed: "failed" in lastApply.metadata && typeof lastApply.metadata.failed === "number" ? lastApply.metadata.failed : 0,
          }
        : null;

    stats.push({
      ruleId: rule.id,
      enabled: rule.enabled,
      lastPreviewAt,
      lastApplyAt,
      appliedMessagesCount7d: applied7d,
      appliedMessagesCount30d: applied30d,
      lastApplySummary,
    });
  }

  // Assignee Rules統計
  for (const rule of assigneeRules) {
    // Preview/ApplyログからruleIdを取得
    const previewApplyLogs = allLogs.filter((log) => {
      if (log.action !== "assignee_rule_preview" && log.action !== "assignee_rule_apply") return false;
      if (!log.metadata || typeof log.metadata !== "object") return false;
      return "ruleId" in log.metadata && log.metadata.ruleId === rule.id;
    });
    
    // 実際のassignアクションからもruleIdを取得（metadata.ruleIdがあるもの）
    const assignLogs = allLogs.filter(
      (log) =>
        log.action === "assign" &&
        log.metadata &&
        typeof log.metadata === "object" &&
        "ruleId" in log.metadata &&
        log.metadata.ruleId === rule.id,
    );
    
    // すべてのログを統合
    const ruleLogs = [...previewApplyLogs, ...assignLogs].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const previewLogs = ruleLogs.filter((log) => log.action === "assignee_rule_preview");
    
    const lastPreviewAt = previewLogs.length > 0 ? previewLogs[0].timestamp : null;
    
    // lastApplyAt: assignee_rule_applyまたはassignアクションの最新
    const applyActionLogs = ruleLogs.filter((log) => log.action === "assignee_rule_apply");
    const assignActionLogs = assignLogs;
    const allApplyLogs = [...applyActionLogs, ...assignActionLogs].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const lastApplyAt = allApplyLogs.length > 0 ? allApplyLogs[0].timestamp : null;

    // appliedMessagesCount: assignee_rule_applyのmetadata.applied + assignアクションの件数
    const applied7d =
      applyActionLogs.filter((log) => log.timestamp >= cutoff7d).reduce((sum, log) => {
        const applied = log.metadata && typeof log.metadata === "object" && "applied" in log.metadata && typeof log.metadata.applied === "number" ? log.metadata.applied : 0;
        return sum + applied;
      }, 0) + assignActionLogs.filter((log) => log.timestamp >= cutoff7d).length;
    const applied30d =
      applyActionLogs.filter((log) => log.timestamp >= cutoff30d).reduce((sum, log) => {
        const applied = log.metadata && typeof log.metadata === "object" && "applied" in log.metadata && typeof log.metadata.applied === "number" ? log.metadata.applied : 0;
        return sum + applied;
      }, 0) + assignActionLogs.filter((log) => log.timestamp >= cutoff30d).length;

    const lastApply = allApplyLogs[0] || null;
    const lastApplySummary =
      lastApply && lastApply.metadata && typeof lastApply.metadata === "object"
        ? {
            processed: "processed" in lastApply.metadata && typeof lastApply.metadata.processed === "number" ? lastApply.metadata.processed : 0,
            matched: "matched" in lastApply.metadata && typeof lastApply.metadata.matched === "number" ? lastApply.metadata.matched : 0,
            applied: "applied" in lastApply.metadata && typeof lastApply.metadata.applied === "number" ? lastApply.metadata.applied : (lastApply.action === "assign" ? 1 : 0),
            skipped: "skipped" in lastApply.metadata && typeof lastApply.metadata.skipped === "number" ? lastApply.metadata.skipped : 0,
            failed: "failed" in lastApply.metadata && typeof lastApply.metadata.failed === "number" ? lastApply.metadata.failed : 0,
          }
        : null;

    stats.push({
      ruleId: rule.id,
      enabled: rule.enabled,
      lastPreviewAt,
      lastApplyAt,
      appliedMessagesCount7d: applied7d,
      appliedMessagesCount30d: applied30d,
      lastApplySummary,
    });
  }

  return NextResponse.json({ stats }, { headers: { "cache-control": "no-store" } });
}
