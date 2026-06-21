import { assigneeSlug as toAssigneeSlug } from "./assignee";

export type MailhubReplyOwnershipShieldReason =
  | "reply_owner_ok"
  | "reply_lock_required"
  | "reply_locked_by_other";

export type MailhubReplyOwnershipShieldResult =
  | {
      ok: true;
      reason: "reply_owner_ok";
      actorSlug: string;
      ownerSlug: string;
      message: string;
      detail: string;
      tone: "ok";
    }
  | {
      ok: false;
      reason: "reply_lock_required" | "reply_locked_by_other";
      actorSlug: string;
      ownerSlug: string | null;
      message: string;
      detail: string;
      tone: "warn";
    };

export function evaluateMailhubReplyOwnershipShield(input: {
  actorEmail: string;
  assigneeSlug: string | null | undefined;
  actorDisplayName?: string | null;
  assigneeDisplayName?: string | null;
}): MailhubReplyOwnershipShieldResult {
  const actorSlug = toAssigneeSlug(input.actorEmail);
  const ownerSlug = input.assigneeSlug?.trim() || null;

  if (!ownerSlug) {
    return {
      ok: false,
      reason: "reply_lock_required",
      actorSlug,
      ownerSlug: null,
      message: "担当してから送信してください",
      detail: "未割当",
      tone: "warn",
    };
  }

  if (ownerSlug !== actorSlug) {
    return {
      ok: false,
      reason: "reply_locked_by_other",
      actorSlug,
      ownerSlug,
      message: "他の担当者が対応中です",
      detail: input.assigneeDisplayName ? `担当: ${input.assigneeDisplayName}` : "他担当",
      tone: "warn",
    };
  }

  return {
    ok: true,
    reason: "reply_owner_ok",
    actorSlug,
    ownerSlug,
    message: "自分が担当中",
    detail: input.actorDisplayName ? `担当: ${input.actorDisplayName}` : "自分",
    tone: "ok",
  };
}
