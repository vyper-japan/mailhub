import "server-only";

export type AuditAction =
  | "archive"
  | "unarchive"
  | "setWaiting"
  | "unsetWaiting"
  | "toggleInProgress"
  | "rakutenReply";

export type AuditLogEntry = {
  timestamp: string;
  actorEmail: string;
  action: AuditAction;
  messageId: string;
  label?: string; // channel/status label
  metadata?: Record<string, unknown>;
};

/**
 * 操作ログを出力する
 * Vercel logs で追跡可能な形式で console.log に出力
 */
export function logAction(entry: Omit<AuditLogEntry, "timestamp">): void {
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
}

