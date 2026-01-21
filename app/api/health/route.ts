import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * ヘルスチェックAPI
 * GET /api/health
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { status: "ok", timestamp: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } }
  );
}
