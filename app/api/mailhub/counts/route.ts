import { NextResponse } from "next/server";
import { getMessageCounts } from "@/lib/gmail";
import { requireUser, authErrorResponse } from "@/lib/require-user";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await requireUser();
  if (!result.ok) {
    return authErrorResponse(result);
  }

  try {
    const counts = await getMessageCounts(result.user.email);
    return NextResponse.json(
      { counts },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    console.error("counts API error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
