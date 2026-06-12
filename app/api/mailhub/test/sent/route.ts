import { NextResponse } from "next/server";
import { listTestSentReplyCaptures } from "@/lib/mailhub-send-test-capture";
import { isTestMode } from "@/lib/test-mode";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "cache-control": "no-store" };

export async function GET(req: Request) {
  if (!isTestMode()) {
    return NextResponse.json(
      { ok: false, error: "test_mode_only" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const url = new URL(req.url);
  const captures = listTestSentReplyCaptures({
    messageId: url.searchParams.get("messageId"),
    clientRequestId: url.searchParams.get("clientRequestId"),
  });

  return NextResponse.json({ ok: true, captures }, { headers: NO_STORE_HEADERS });
}
