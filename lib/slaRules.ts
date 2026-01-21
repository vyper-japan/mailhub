import "server-only";
import { TIME_THRESHOLDS } from "./time-utils";
import { isAuditAction, type AuditAction } from "./audit-log";

export type SLAStatus = "ok" | "warn" | "critical";

export type SLARule = {
  type: "todo" | "waiting" | "unassigned";
  warnThresholdMs: number;
  criticalThresholdMs: number;
  gmailQuery: string;
};

export const SLA_RULES: SLARule[] = [
  {
    type: "todo",
    warnThresholdMs: TIME_THRESHOLDS.WARNING_TODO, // 24h
    criticalThresholdMs: TIME_THRESHOLDS.ERROR_TODO, // 72h
    gmailQuery: 'label:inbox older_than:1d -label:"MailHub/Waiting" -label:"MailHub/Done" -label:"MailHub/Muted"',
  },
  {
    type: "waiting",
    warnThresholdMs: TIME_THRESHOLDS.WARNING_WAITING, // 48h
    criticalThresholdMs: TIME_THRESHOLDS.ERROR_WAITING, // 7d
    gmailQuery: 'label:"MailHub/Waiting" older_than:2d',
  },
  {
    type: "unassigned",
    warnThresholdMs: TIME_THRESHOLDS.WARNING_TODO, // 24h
    criticalThresholdMs: TIME_THRESHOLDS.ERROR_TODO, // 72h
    gmailQuery: 'label:inbox older_than:1d -label:"MailHub/Waiting" -label:"MailHub/Done" -label:"MailHub/Muted" -label:"MailHub/Assignee/*"',
  },
];

/**
 * 受信日時からSLAステータスを判定
 */
export function getSLAStatus(
  receivedAt: string | null,
  rule: SLARule
): SLAStatus {
  if (!receivedAt) return "ok";
  
  try {
    const received = new Date(receivedAt);
    const now = new Date();
    const elapsedMs = now.getTime() - received.getTime();
    
    if (elapsedMs >= rule.criticalThresholdMs) {
      return "critical";
    }
    if (elapsedMs >= rule.warnThresholdMs) {
      return "warn";
    }
    return "ok";
  } catch {
    return "ok";
  }
}

/**
 * SLAアクション名を生成（重複防止用）
 */
export function getSLAActionName(
  ruleType: "todo" | "waiting" | "unassigned",
  status: Exclude<SLAStatus, "ok">,
): AuditAction {
  const name = `sla_${ruleType}_${status}`;
  if (isAuditAction(name)) return name;
  // 不正な組み合わせ（例: ok）はここに来る。呼び出し側が制御すべきだが安全側に倒す。
  return "sla_alert_truncated";
}

