import { NextResponse } from "next/server";
import { assignMessage, unassignMessage } from "@/lib/gmail";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { logAction } from "@/lib/audit-log";
import { isTestMode } from "@/lib/test-mode";
import { parseGmailError } from "@/lib/gmail-error";
import type { NextRequest } from "next/server";
import { isReadOnlyMode, writeForbiddenResponse } from "@/lib/read-only";
import { isAdminEmail } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const authResult = await requireUser();
  if (!authResult.ok) {
    return authErrorResponse(authResult);
  }
  if (isReadOnlyMode()) return writeForbiddenResponse("assign");

  const body = (await req.json().catch(() => null)) as unknown;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const id = typeof b.id === "string" ? b.id : null;
  const action = typeof b.action === "string" ? b.action : null;
  const force = b.force === true;
  const assigneeEmail = typeof b.assigneeEmail === "string" ? b.assigneeEmail.toLowerCase().trim() : null;
  const reason = typeof b.reason === "string" ? b.reason.trim() : undefined; // Step 91: 理由入力

  if (!id) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  if (action !== "assign" && action !== "unassign") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  // assigneeEmailが指定されている場合の検証
  let targetEmail = authResult.user.email; // デフォルトは自分
  if (action === "assign" && assigneeEmail) {
    // Step 70: @vtj.co.jpドメインのみ許可
    if (!assigneeEmail.endsWith("@vtj.co.jp")) {
      return NextResponse.json({ error: "invalid_domain", message: "@vtj.co.jp ドメインのみ許可されています" }, { status: 400 });
    }
    // 他人への割当はadminのみ
    if (assigneeEmail !== authResult.user.email.toLowerCase()) {
      if (!isAdminEmail(authResult.user.email)) {
        return NextResponse.json({ error: "forbidden_admin_only_for_others" }, { status: 403 });
      }
      // Team登録必須チェック（Team未登録でも@vtj.co.jpなら許可するため、このチェックをスキップ可能に）
      // TODO: Team登録必須を強制するかどうかは運用で決める
      // 現状: Team登録チェックを維持（Step70ではTeam未登録でも許可する方向に変更）
      // const teamStore = getTeamStore();
      // const member = await teamStore.get(assigneeEmail);
      // if (!member) {
      //   return NextResponse.json({ error: "assignee_not_in_team", assigneeEmail }, { status: 400 });
      // }
    }
    targetEmail = assigneeEmail;
  }

  // assigneeSlugを計算（emailからローカル部分を抽出）
  const computeAssigneeSlug = (email: string) => email.split("@")[0].toLowerCase();

  // Test mode handling
  if (isTestMode()) {
    if (action === "assign") {
      const result = await assignMessage(id, targetEmail, { force });
      if (result.currentAssigneeSlug && !force) {
        return NextResponse.json(
          { error: "already_assigned", currentAssigneeSlug: result.currentAssigneeSlug },
          { status: 409 },
        );
      }
      // Step 91: Test modeでも logAction を呼ぶ（E2E検証のため）
      await logAction({
        actorEmail: authResult.user.email,
        action: force ? "takeover" : "assign",
        messageId: id,
        metadata: { assigneeEmail: targetEmail },
        reason,
      }).catch(() => {});
      // Step 76: assigneeSlugを返す
      return NextResponse.json({ ok: true, assigneeSlug: computeAssigneeSlug(targetEmail), assigneeEmail: targetEmail });
    } else {
      await unassignMessage(id);
      // Step 91: Test modeでも logAction を呼ぶ（E2E検証のため）
      await logAction({
        actorEmail: authResult.user.email,
        action: "unassign",
        messageId: id,
      }).catch(() => {});
      return NextResponse.json({ ok: true, assigneeSlug: null });
    }
  }

  try {
    if (action === "assign") {
      const result = await assignMessage(id, targetEmail, { force });
      if (result.currentAssigneeSlug && !force) {
        logAction({
          actorEmail: authResult.user.email,
          action: "assign",
          messageId: id,
          metadata: { assigneeEmail: targetEmail },
        }).catch(() => {
          // ログ失敗は無視
        });
        return NextResponse.json(
          { error: "already_assigned", currentAssigneeSlug: result.currentAssigneeSlug },
          { status: 409 },
        );
      }
      logAction({
        actorEmail: authResult.user.email,
        action: force ? "takeover" : "assign",
        messageId: id,
        metadata: { assigneeEmail: targetEmail },
        reason, // Step 91: 理由入力
      }).catch(() => {
        // ログ失敗は無視
      });
      // Step 76: assigneeSlugを返す
      return NextResponse.json(
        { success: true, id, action, assigneeSlug: computeAssigneeSlug(targetEmail), assigneeEmail: targetEmail },
        { headers: { "cache-control": "no-store" } },
      );
    } else {
      await unassignMessage(id);
      logAction({
        actorEmail: authResult.user.email,
        action: "unassign",
        messageId: id,
      }).catch(() => {
        // ログ失敗は無視
      });
      return NextResponse.json(
        { success: true, id, action, assigneeSlug: null },
        { headers: { "cache-control": "no-store" } },
      );
    }
  } catch (e) {
    // サーバーログに詳細を出力（トークン等の秘密情報は出さない）
    console.error(`[Assign API Error] action=${action}, messageId=${id}, user=${authResult.user.email}`, e);
    
    const errorInfo = parseGmailError(e);
    return NextResponse.json(
      {
        error: "gmail_api_error",
        error_code: errorInfo.error_code,
        message: errorInfo.message,
        debug: process.env.NODE_ENV === "development" ? errorInfo.debug : undefined,
      },
      { status: errorInfo.httpStatus, headers: { "cache-control": "no-store" } },
    );
  }
}

