import "server-only";
import { getActivityStore } from "./activityStore";

export type AuditAction =
  | "archive"
  | "unarchive"
  | "setWaiting"
  | "unsetWaiting"
  | "toggleInProgress"
  | "rakutenReply"
  | "mute"
  | "unmute"
  | "assign"
  | "unassign"
  | "takeover"
  | "handoff_preview"
  | "handoff_send"
  | "config_import_preview"
  | "config_import_apply"
  | "sla_todo_warn"
  | "sla_todo_critical"
  | "sla_waiting_warn"
  | "sla_waiting_critical"
  | "sla_unassigned_warn"
  | "sla_unassigned_critical"
  | "sla_alert_truncated"
  | "rule_preview"
  | "rule_apply"
  | "note_set"
  | "note_clear"
  | "template_insert"
  | "template_create"
  | "template_apply"
  | "template_copy"
  | "template_apply_mark_done"
  | "template_apply_mark_waiting"
  | "template_apply_mark_muted"
  | "handoff_note_set"
  | "assignee_rule_preview"
  | "assignee_rule_apply"
  | "suggestion_preview"
  | "suggestion_apply"
  | "snooze"
  | "unsnooze"
  | "snooze_release"
  | "rule_run_all_preview"
  | "rule_run_all_apply"
  | "reply_open_rms"
  | "reply_copy_template"
  | "reply_copy_inquiry"
  | "reply_note_insert"
  | "reply_mark_done"
  | "reply_mark_waiting"
  | "reply_mark_muted";

export function isAuditAction(v: string): v is AuditAction {
  const allowed: AuditAction[] = [
    "archive",
    "unarchive",
    "setWaiting",
    "unsetWaiting",
    "toggleInProgress",
    "rakutenReply",
    "mute",
    "unmute",
    "assign",
    "unassign",
    "takeover",
    "handoff_preview",
    "handoff_send",
    "config_import_preview",
    "config_import_apply",
    "sla_todo_warn",
    "sla_todo_critical",
    "sla_waiting_warn",
    "sla_waiting_critical",
    "sla_unassigned_warn",
    "sla_unassigned_critical",
    "sla_alert_truncated",
    "rule_preview",
    "rule_apply",
    "note_set",
    "note_clear",
    "template_insert",
    "template_create",
    "template_apply",
    "template_copy",
    "template_apply_mark_done",
    "template_apply_mark_waiting",
    "template_apply_mark_muted",
    "handoff_note_set",
    "assignee_rule_preview",
    "assignee_rule_apply",
    "suggestion_preview",
    "suggestion_apply",
    "snooze",
    "unsnooze",
    "snooze_release",
    "rule_run_all_preview",
    "rule_run_all_apply",
    "reply_open_rms",
    "reply_copy_template",
    "reply_copy_inquiry",
    "reply_note_insert",
    "reply_mark_done",
    "reply_mark_waiting",
    "reply_mark_muted",
  ];
  return allowed.includes(v as AuditAction);
}

export type AuditLogEntry = {
  timestamp: string;
  actorEmail: string;
  action: AuditAction;
  messageId: string;
  label?: string; // channel/status label
  metadata?: Record<string, unknown>;
  reason?: string; // Step 91: 理由入力（takeover/bulk assign/危険ルール適用）
};

/**
 * 操作ログを出力する
 * Vercel logs で追跡可能な形式で console.log に出力
 * 同時にActivityStoreにも保存（永続化対応）
 */
export async function logAction(entry: Omit<AuditLogEntry, "timestamp">): Promise<void> {
  const logEntry: AuditLogEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

  // 構造化ログとして出力（Vercel logsで検索可能）
  console.log(
    JSON.stringify({
      type: "AUDIT_LOG",
      ...logEntry,
    })
  );

  // ActivityStoreに追加（E2E/即時反映のため await する。エラーは握りつぶす）
  const store = getActivityStore();
  try {
    await store.append(logEntry);
  } catch (e) {
    console.error("[logAction] Failed to append to store:", e);
  }
}

/**
 * 操作ログを取得する（Activityパネル用）
 * @param filters フィルタ条件（オプション）
 */
export async function getActivityLogs(filters?: {
  actorEmail?: string;
  action?: AuditAction;
  ruleId?: string;
  limit?: number;
}): Promise<AuditLogEntry[]> {
  const store = getActivityStore();
  const logs = await store.list({
    limit: filters?.limit,
    actorEmail: filters?.actorEmail,
    action: filters?.action,
  });
  
  // ruleIdフィルタ（metadataから抽出）
  if (filters?.ruleId) {
    return logs.filter((log) => {
      if (!log.metadata || typeof log.metadata !== "object") return false;
      return "ruleId" in log.metadata && log.metadata.ruleId === filters.ruleId;
    });
  }
  
  return logs;
}

/**
 * 操作ログバッファをクリア（テストモード用）
 */
export async function clearActivityLogs(): Promise<void> {
  const store = getActivityStore();
  await store.clear();
}

