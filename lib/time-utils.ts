/**
 * 経過時間フォーマットと閾値判定のユーティリティ
 */

// 閾値（定数化）
export const TIME_THRESHOLDS = {
  WARNING_TODO: 24 * 60 * 60 * 1000, // 24時間（ミリ秒）
  ERROR_TODO: 72 * 60 * 60 * 1000, // 72時間（ミリ秒）
  WARNING_WAITING: 48 * 60 * 60 * 1000, // 48時間（ミリ秒）
  ERROR_WAITING: 7 * 24 * 60 * 60 * 1000, // 7日（ミリ秒）
} as const;

/**
 * 経過時間をフォーマット（例: 59s / 5m / 2h / 3d）
 */
export function formatElapsedTime(ms: number): string {
  if (ms < 0) return "0s";
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return `${days}d`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

/**
 * 経過時間の色を判定（Todo用）
 */
export function getElapsedColorTodo(ms: number): "default" | "warning" | "error" {
  if (ms >= TIME_THRESHOLDS.ERROR_TODO) {
    return "error";
  }
  if (ms >= TIME_THRESHOLDS.WARNING_TODO) {
    return "warning";
  }
  return "default";
}

/**
 * 経過時間の色を判定（Waiting用）
 */
export function getElapsedColorWaiting(ms: number): "default" | "warning" | "error" {
  if (ms >= TIME_THRESHOLDS.ERROR_WAITING) {
    return "error";
  }
  if (ms >= TIME_THRESHOLDS.WARNING_WAITING) {
    return "warning";
  }
  return "default";
}

/**
 * 受信日時から経過時間を計算
 */
export function getElapsedMs(receivedAt: string | null): number {
  if (!receivedAt) return 0;
  
  try {
    const received = new Date(receivedAt);
    const now = new Date();
    return now.getTime() - received.getTime();
  } catch {
    return 0;
  }
}

// Step 66: SLA Focus用のSLAレベル判定
export type SlaLevel = "ok" | "warn" | "critical";

/**
 * SLAレベルを判定
 * - done/muted は常に ok（対象外）
 * - Todo: 24h超え=warn、72h超え=critical
 * - Waiting: 48h超え=warn、7d超え=critical
 */
export function getSlaLevel(args: {
  statusType: "todo" | "waiting" | "done" | "muted" | "snoozed" | undefined;
  receivedAtIso: string | null;
}): SlaLevel {
  const { statusType, receivedAtIso } = args;
  
  // done/muted/snoozed は対象外
  if (statusType === "done" || statusType === "muted" || statusType === "snoozed") {
    return "ok";
  }
  
  const elapsed = getElapsedMs(receivedAtIso);
  if (elapsed <= 0) return "ok";
  
  if (statusType === "waiting") {
    if (elapsed >= TIME_THRESHOLDS.ERROR_WAITING) return "critical";
    if (elapsed >= TIME_THRESHOLDS.WARNING_WAITING) return "warn";
    return "ok";
  }
  
  // todo（またはundefined = inbox）
  if (elapsed >= TIME_THRESHOLDS.ERROR_TODO) return "critical";
  if (elapsed >= TIME_THRESHOLDS.WARNING_TODO) return "warn";
  return "ok";
}




