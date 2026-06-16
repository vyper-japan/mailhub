import { NextResponse } from "next/server";
import { coerceChannelId, DEFAULT_CHANNEL_ID } from "@/lib/channels";
import { buildBrainDecision } from "@/lib/brainDecision";
import { getMessageDetail } from "@/lib/gmail";
import { parseGmailError } from "@/lib/gmail-error";
import { authErrorResponse, requireUser } from "@/lib/require-user";
import { isTestMode } from "@/lib/test-mode";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);

  const url = new URL(req.url);
  const messageId = url.searchParams.get("messageId");
  if (!messageId) {
    return NextResponse.json({ error: "missing_messageId" }, { status: 400 });
  }

  const testMode = isTestMode();
  const requestedChannel = url.searchParams.get("channel") ?? DEFAULT_CHANNEL_ID;
  const channelId = coerceChannelId(requestedChannel, testMode) ?? DEFAULT_CHANNEL_ID;

  try {
    const detail = await getMessageDetail(messageId);
    const decision = buildBrainDecision({ message: detail, channelId, testMode });
    return NextResponse.json(
      { decision },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    const errorInfo = parseGmailError(e);
    return NextResponse.json(
      {
        error: "brain_decision_failed",
        error_code: errorInfo.error_code,
        message: errorInfo.message,
        debug: process.env.NODE_ENV === "development" ? errorInfo.debug : undefined,
      },
      { status: errorInfo.httpStatus, headers: { "cache-control": "no-store" } },
    );
  }
}
