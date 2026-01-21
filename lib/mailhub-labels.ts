/**
 * MailHubが管理する「ユーザー用」ラベル（Gmail側に実体を持つ）
 * - 事故防止のため、MailHubプレフィックス配下のみを対象にする
 */

export const MAILHUB_USER_LABEL_PREFIX = "MailHub/Label/";

export function slugifyMailhubLabel(displayName: string): string {
  const base = displayName.trim().toLowerCase();
  const slug = base
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return slug || "label";
}

export function buildMailhubLabelName(displayName: string): string {
  return `${MAILHUB_USER_LABEL_PREFIX}${slugifyMailhubLabel(displayName)}`;
}



