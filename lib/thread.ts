import type { StatusType } from "@/lib/labels";
import { MAILHUB_USER_LABEL_PREFIX } from "@/lib/mailhub-labels";

export type ThreadMessageSummary = {
  id: string;
  threadId: string;
  subject: string | null;
  from: string | null;
  /**
   * Display date string (UI-friendly).
   * - In TEST_MODE we use `receivedAt` (e.g. "2025/12/31 01:30:00")
   * - In Gmail mode we use formatted receivedAt as well.
   */
  date: string;
  snippet: string;
  statusType: StatusType;
  assigneeSlug: string | null;
  /**
   * MailHub display labels (safe subset; e.g. user labels).
   */
  labels: string[];
};

const STATUS_LABEL_WAITING = "MailHub/Waiting";
const STATUS_LABEL_DONE = "MailHub/Done";
const STATUS_LABEL_MUTED = "MailHub/Muted";
const STATUS_LABEL_SNOOZED = "MailHub/Snoozed";

export function statusTypeFromLabelNames(labelNames: string[]): StatusType {
  // Order matters: status labels are mutually exclusive in our system, but be defensive.
  if (labelNames.includes(STATUS_LABEL_SNOOZED)) return "snoozed";
  if (labelNames.includes(STATUS_LABEL_MUTED)) return "muted";
  if (labelNames.includes(STATUS_LABEL_DONE)) return "done";
  if (labelNames.includes(STATUS_LABEL_WAITING)) return "waiting";
  return "todo";
}

export function extractMailhubUserLabels(labelNames: string[], max = 2): string[] {
  const labels = labelNames.filter((n) => n.startsWith(MAILHUB_USER_LABEL_PREFIX));
  if (labels.length <= max) return labels;
  return labels.slice(0, max);
}

/**
 * Parse our UI `receivedAt` format ("YYYY/MM/DD HH:mm:ss") into ms.
 * Returns 0 on invalid input.
 */
export function receivedAtToMs(receivedAt: string): number {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(receivedAt);
  if (!m) return 0;
  const [, y, mo, d, h, mi, s] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return Number.isFinite(ms) ? ms : 0;
}

