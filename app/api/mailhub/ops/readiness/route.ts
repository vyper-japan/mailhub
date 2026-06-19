import "server-only";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-user";
import { readOpsReadinessSummary } from "@/lib/opsReadinessSummary";

export const dynamic = "force-dynamic";

/**
 * Header strip用の軽量readiness API。
 * Ops Board本体のSLA/Gmail集計は走らせず、repo-local readiness artifactだけ読む。
 */
export async function GET(): Promise<NextResponse> {
  const authResult = await requireUser();
  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.status === 401 ? "unauthorized" : "forbidden", message: authResult.message },
      { status: authResult.status },
    );
  }

  try {
    return NextResponse.json({ productionReadiness: readOpsReadinessSummary() });
  } catch (e) {
    console.error("Failed to get ops readiness:", e);
    return NextResponse.json(
      { error: "Internal Server Error", message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
