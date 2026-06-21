import { describe, expect, it } from "vitest";
import { assigneeSlug } from "@/lib/assignee";
import { evaluateMailhubReplyOwnershipShield } from "@/lib/mailhub-shield";

describe("evaluateMailhubReplyOwnershipShield", () => {
  it("requires ownership before replying to an unassigned message", () => {
    expect(
      evaluateMailhubReplyOwnershipShield({
        actorEmail: "test@vtj.co.jp",
        assigneeSlug: null,
      }),
    ).toMatchObject({
      ok: false,
      reason: "reply_lock_required",
      actorSlug: "test_at_vtj_co_jp",
      ownerSlug: null,
      message: "担当してから送信してください",
      detail: "未割当",
    });
  });

  it("blocks replies owned by another staff member", () => {
    expect(
      evaluateMailhubReplyOwnershipShield({
        actorEmail: "test@vtj.co.jp",
        assigneeSlug: assigneeSlug("other@vtj.co.jp"),
        assigneeDisplayName: "other",
      }),
    ).toMatchObject({
      ok: false,
      reason: "reply_locked_by_other",
      ownerSlug: "other_at_vtj_co_jp",
      detail: "担当: other",
    });
  });

  it("allows replies owned by the current user", () => {
    expect(
      evaluateMailhubReplyOwnershipShield({
        actorEmail: "test@vtj.co.jp",
        assigneeSlug: assigneeSlug("test@vtj.co.jp"),
        actorDisplayName: "test",
      }),
    ).toMatchObject({
      ok: true,
      reason: "reply_owner_ok",
      ownerSlug: "test_at_vtj_co_jp",
      detail: "担当: test",
    });
  });
});
