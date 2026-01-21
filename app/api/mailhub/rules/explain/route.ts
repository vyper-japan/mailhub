import "server-only";

import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { getLabelRulesStore } from "@/lib/labelRulesStore";
import { getAssigneeRulesStore } from "@/lib/assigneeRulesStore";
import { getMessageMetadataForRules } from "@/lib/gmail";
import { explainRulesForMessage } from "@/lib/ruleInspector";

export const dynamic = "force-dynamic";

/**
 * メッセージに対するルールExplain API（副作用ゼロ、READ ONLYでも実行可）
 * GET /api/mailhub/rules/explain?id=<messageId>
 */
export async function GET(req: Request): Promise<NextResponse> {
  const authResult = await requireUser();
  if (!authResult.ok) {
    return authErrorResponse(authResult);
  }

  const url = new URL(req.url);
  const messageId = url.searchParams.get("id");
  if (!messageId || typeof messageId !== "string" || messageId.length > 200) {
    return NextResponse.json({ error: "invalid_messageId", message: "messageId is required and must be <= 200 chars" }, { status: 400 });
  }

  try {
    const meta = await getMessageMetadataForRules(messageId);
    const [labelRules, assigneeRules] = await Promise.all([
      getLabelRulesStore().getRules(),
      getAssigneeRulesStore().getRules(),
    ]);

    const result = await explainRulesForMessage(messageId, meta.fromEmail, labelRules, assigneeRules);

    return NextResponse.json({ explain: result }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("Failed to explain rules for message:", e);
    return NextResponse.json(
      { error: "Internal Server Error", message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
