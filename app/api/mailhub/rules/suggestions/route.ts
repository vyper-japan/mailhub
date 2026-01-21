import "server-only";

import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { generateRuleSuggestions } from "@/lib/ruleSuggestions";

export const dynamic = "force-dynamic";

/**
 * ルール提案API（副作用ゼロ、READ ONLYでも実行可）
 * GET /api/mailhub/rules/suggestions?days=14&minActions=3&minActors=2
 */
export async function GET(req: Request): Promise<NextResponse> {
  const authResult = await requireUser();
  if (!authResult.ok) {
    return authErrorResponse(authResult);
  }

  const url = new URL(req.url);
  const daysParam = url.searchParams.get("days");
  const minActionsParam = url.searchParams.get("minActions");
  const minActorsParam = url.searchParams.get("minActors");

  const days = daysParam && /^\d+$/.test(daysParam) ? Math.min(Math.max(1, parseInt(daysParam, 10)), 90) : undefined;
  const minActions = minActionsParam && /^\d+$/.test(minActionsParam) ? Math.min(Math.max(1, parseInt(minActionsParam, 10)), 100) : undefined;
  const minActors = minActorsParam && /^\d+$/.test(minActorsParam) ? Math.min(Math.max(1, parseInt(minActorsParam, 10)), 50) : undefined;

  try {
    const result = await generateRuleSuggestions({
      days,
      minActions,
      minActors,
    });

    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("Failed to generate rule suggestions:", e);
    return NextResponse.json(
      { error: "Internal Server Error", message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
