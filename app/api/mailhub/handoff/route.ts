import "server-only";

import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { isReadOnlyMode, writeForbiddenResponse } from "@/lib/read-only";
import { isAdminEmail } from "@/lib/admin";
import { logAction } from "@/lib/audit-log";
import { buildHandoffPreview } from "@/lib/handoff";
import { SlackProvider, LogProvider, type AlertProvider } from "@/lib/alerts";
import { isTestMode } from "@/lib/test-mode";

export const dynamic = "force-dynamic";

function getSlackProviderForHandoff(): { ok: true; provider: AlertProvider } | { ok: false; status: number; error: string } {
  if (isTestMode()) {
    return { ok: true, provider: new LogProvider() };
  }

  const provider = (process.env.MAILHUB_ALERTS_PROVIDER ?? "none").trim().toLowerCase();
  const webhookUrl = (process.env.MAILHUB_SLACK_WEBHOOK_URL ?? "").trim();

  if (provider !== "slack") {
    return { ok: false, status: 400, error: "slack_not_configured" };
  }
  if (!webhookUrl) {
    return { ok: false, status: 400, error: "slack_webhook_missing" };
  }
  return { ok: true, provider: new SlackProvider(webhookUrl) };
}

/**
 * Handoff preview生成
 * GET /api/mailhub/handoff?dryRun=1
 */
export async function GET(req: Request) {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  const preview = await buildHandoffPreview({
    userEmail: authResult.user.email,
    hours: 24,
    activityLimit: 10,
    opsTopN: 5,
  });

  // best-effort activity log（messageIdは空にしてActivity Drawerのクリック対象から外す）
  try {
    await logAction({
      actorEmail: authResult.user.email,
      action: "handoff_preview",
      messageId: "",
      metadata: { dryRun },
    });
  } catch {
    // ignore
  }

  return NextResponse.json(
    { preview },
    { headers: { "cache-control": "no-store" } },
  );
}

/**
 * Slack送信（adminのみ + READ ONLY禁止）
 * POST /api/mailhub/handoff
 */
export async function POST(): Promise<Response> {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);

  if (!isAdminEmail(authResult.user.email)) {
    return NextResponse.json({ error: "forbidden_admin_only" }, { status: 403 });
  }
  if (isReadOnlyMode()) return writeForbiddenResponse("handoff_send");

  const slack = getSlackProviderForHandoff();
  if (!slack.ok) {
    return NextResponse.json({ error: slack.error }, { status: slack.status });
  }

  const preview = await buildHandoffPreview({
    userEmail: authResult.user.email,
    hours: 24,
    activityLimit: 10,
    opsTopN: 5,
  });

  await slack.provider.send({
    title: `Handoff (${preview.envLabel})`,
    text: preview.markdown,
    items: [],
  });

  // best-effort activity log（messageIdは空）
  try {
    await logAction({
      actorEmail: authResult.user.email,
      action: "handoff_send",
      messageId: "",
      metadata: { length: preview.markdown.length },
    });
  } catch {
    // ignore
  }

  return NextResponse.json({ ok: true });
}

