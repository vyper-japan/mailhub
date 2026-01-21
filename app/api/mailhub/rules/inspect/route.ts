import "server-only";

import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { getLabelRulesStore } from "@/lib/labelRulesStore";
import { getAssigneeRulesStore } from "@/lib/assigneeRulesStore";
import { inspectRules } from "@/lib/ruleInspector";

export const dynamic = "force-dynamic";

/**
 * ルール診断API（副作用ゼロ、READ ONLYでも実行可）
 * GET /api/mailhub/rules/inspect?type=labels|assignee|all&sampleSize=50
 */
export async function GET(req: Request): Promise<NextResponse> {
  const authResult = await requireUser();
  if (!authResult.ok) {
    return authErrorResponse(authResult);
  }

  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "all";
  const sampleSizeRaw = url.searchParams.get("sampleSize");
  const sampleSize = sampleSizeRaw && /^\d+$/.test(sampleSizeRaw) ? Math.min(Math.max(1, parseInt(sampleSizeRaw, 10)), 200) : 50;

  try {
    const [labelRules, assigneeRules] = await Promise.all([
      type === "labels" || type === "all" ? getLabelRulesStore().getRules() : Promise.resolve([]),
      type === "assignee" || type === "all" ? getAssigneeRulesStore().getRules() : Promise.resolve([]),
    ]);

    const result = await inspectRules(labelRules, assigneeRules, sampleSize);

    return NextResponse.json({ inspection: result }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("Failed to inspect rules:", e);
    return NextResponse.json(
      { error: "Internal Server Error", message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
