import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { getThreadSummaryByMessageId } from "@/lib/gmail";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const authResult = await requireUser();
  if (!authResult.ok) {
    return authErrorResponse(authResult);
  }

  const url = new URL(req.url);
  const messageId = url.searchParams.get("messageId");
  if (!messageId) {
    return NextResponse.json({ error: "missing_messageId" }, { status: 400 });
  }

  try {
    const result = await getThreadSummaryByMessageId(messageId);
    // short TTL caching (client/proxy). Server-side cache is in lib/gmail.ts.
    return NextResponse.json(result, { headers: { "cache-control": "private, max-age=15" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "thread_error", message: msg },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

