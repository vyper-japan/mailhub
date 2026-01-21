import "server-only";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-user";
import { buildOpsSummary } from "@/lib/opsSummary";

export const dynamic = "force-dynamic";

/**
 * Ops Board用サマリー取得API
 * GET /api/mailhub/ops/summary
 */
export async function GET(): Promise<NextResponse> {
  const authResult = await requireUser();
  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.status === 401 ? "unauthorized" : "forbidden", message: authResult.message },
      { status: authResult.status }
    );
  }

  try {
    const summary = await buildOpsSummary();
    return NextResponse.json({ summary });
  } catch (e) {
    console.error("Failed to get ops summary:", e);
    return NextResponse.json(
      { error: "Internal Server Error", message: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
