import { NextResponse } from "next/server";
import { buildAiDraftSuggestion } from "@/lib/aiDraftSuggestion";
import { coerceChannelId, DEFAULT_CHANNEL_ID } from "@/lib/channels";
import { getMessageDetail } from "@/lib/gmail";
import { parseGmailError } from "@/lib/gmail-error";
import { getSendResolverChannels } from "@/lib/mailhub-send-resolver";
import { authErrorResponse, requireUser } from "@/lib/require-user";
import { isTestMode } from "@/lib/test-mode";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "cache-control": "no-store" };

export async function GET(req: Request) {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);

  const url = new URL(req.url);
  const messageId = url.searchParams.get("messageId")?.trim();
  if (!messageId) {
    return NextResponse.json({ error: "missing_messageId" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const testMode = isTestMode();
  const requestedChannel = url.searchParams.get("channel") ?? DEFAULT_CHANNEL_ID;
  const channelId = coerceChannelId(requestedChannel, testMode) ?? DEFAULT_CHANNEL_ID;

  try {
    const detail = await getMessageDetail(messageId);
    const result = buildAiDraftSuggestion({
      message: detail,
      channelId,
      testMode,
      channels: getSendResolverChannels(testMode),
      sharedInboxEmail: process.env.GOOGLE_SHARED_INBOX_EMAIL ?? null,
    });
    return NextResponse.json({ result }, { headers: NO_STORE_HEADERS });
  } catch (e) {
    const errorInfo = parseGmailError(e);
    return NextResponse.json(
      {
        error: "brain_draft_failed",
        error_code: errorInfo.error_code,
        message: errorInfo.message,
        debug: process.env.NODE_ENV === "development" ? errorInfo.debug : undefined,
      },
      { status: errorInfo.httpStatus, headers: NO_STORE_HEADERS },
    );
  }
}
