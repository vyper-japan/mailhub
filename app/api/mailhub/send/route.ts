import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { archiveMessage, getMessageDetail, sendGmailReply } from "@/lib/gmail";
import { parseGmailError } from "@/lib/gmail-error";
import { logAction } from "@/lib/audit-log";
import { assertSendAsAccepted } from "@/lib/mailhub-send-as";
import {
  releaseMailhubSendDuplicateGuard,
  reserveMailhubSendDuplicateGuard,
  type MailhubSendDuplicateReservation,
} from "@/lib/mailhub-send-duplicate-guard";
import {
  recordTestSentReplyCapture,
  updateTestSentReplyCaptureStatus,
  type TestSentReplyCaptureStatus,
} from "@/lib/mailhub-send-test-capture";
import { buildReplyMime } from "@/lib/mailhub-send-mime";
import { getSendResolverChannels, resolveReplyContext } from "@/lib/mailhub-send-resolver";
import { isReadOnlyMode } from "@/lib/read-only";
import { requireUser, type AuthResult } from "@/lib/require-user";
import { isTestMode } from "@/lib/test-mode";

export const dynamic = "force-dynamic";

type PostSendAction = "none" | "done";

type ValidatedSendRequest = {
  messageId: string;
  bodyText: string;
  clientRequestId: string;
  postSendAction: PostSendAction;
  templateId: string | null;
  templateTitle: string | null;
};

const NO_STORE_HEADERS = { "cache-control": "no-store" };
const CLIENT_REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,100}$/;
const UNRESOLVED_TEMPLATE_VAR_RE = /{{\s*[\w.-]+\s*}}/;

function noStoreJson(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, { status: init?.status, headers: NO_STORE_HEADERS });
}

function authResponse(result: Extract<AuthResult, { ok: false }>) {
  return noStoreJson(
    {
      ok: false,
      error: result.status === 401 ? "unauthorized" : "forbidden",
      message: result.status === 401 ? "ログインが必要です" : "社内アカウントのみ利用できます",
    },
    { status: result.status },
  );
}

function errorResponse(status: number, error: string, message: string, extra?: Record<string, unknown>) {
  return noStoreJson({ ok: false, error, message, ...extra }, { status });
}

function gmailApiErrorResponse(e: unknown) {
  const errorInfo = parseGmailError(e);
  return noStoreJson(
    {
      ok: false,
      error: "gmail_api_error",
      error_code: errorInfo.error_code,
      message: errorInfo.message,
      debug: process.env.NODE_ENV === "development" ? errorInfo.debug : undefined,
    },
    { status: errorInfo.httpStatus },
  );
}

function normalizeBodyForHash(bodyText: string): string {
  return bodyText.replace(/\r\n?/g, "\n").trim();
}

function shortHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

function toDomain(email: string): string {
  return email.toLowerCase().split("@")[1] ?? "";
}

function getSharedInboxEmail(testMode: boolean): string {
  return process.env.GOOGLE_SHARED_INBOX_EMAIL?.trim() || (testMode ? "mailhub@vtj.co.jp" : "");
}

function validateRequest(body: unknown): { ok: true; request: ValidatedSendRequest } | { ok: false; response: Response } {
  const data = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  if (typeof data.messageId !== "string") {
    return { ok: false, response: errorResponse(400, "missing_messageId", "messageIdが必要です") };
  }
  const messageId = data.messageId.trim();
  if (!messageId || messageId.length > 200) {
    return { ok: false, response: errorResponse(400, "invalid_messageId", "messageIdが不正です") };
  }

  if (typeof data.bodyText !== "string" || data.bodyText.trim().length === 0) {
    return { ok: false, response: errorResponse(400, "missing_body", "本文を入力してください") };
  }
  const bodyText = data.bodyText;
  if (bodyText.length > 20_000) {
    return { ok: false, response: errorResponse(400, "body_too_long", "本文は20000文字以内にしてください") };
  }
  if (UNRESOLVED_TEMPLATE_VAR_RE.test(bodyText)) {
    return {
      ok: false,
      response: errorResponse(400, "unresolved_template_vars", "未解決のテンプレート変数があります"),
    };
  }

  if (typeof data.clientRequestId !== "string") {
    return {
      ok: false,
      response: errorResponse(400, "missing_client_request_id", "clientRequestIdが必要です"),
    };
  }
  const clientRequestId = data.clientRequestId.trim();
  if (!CLIENT_REQUEST_ID_RE.test(clientRequestId)) {
    return {
      ok: false,
      response: errorResponse(400, "invalid_client_request_id", "clientRequestIdが不正です"),
    };
  }

  if (data.postSendAction !== "none" && data.postSendAction !== "done") {
    return {
      ok: false,
      response: errorResponse(400, "invalid_post_send_action", "postSendActionが不正です"),
    };
  }

  const templateId = typeof data.templateId === "string" ? data.templateId.trim() : null;
  if (templateId && templateId.length > 120) {
    return { ok: false, response: errorResponse(400, "invalid_template_id", "templateIdが不正です") };
  }

  const templateTitle = typeof data.templateTitle === "string" ? data.templateTitle.trim() : null;
  if (templateTitle && templateTitle.length > 200) {
    return { ok: false, response: errorResponse(400, "invalid_template_title", "templateTitleが不正です") };
  }

  return {
    ok: true,
    request: {
      messageId,
      bodyText,
      clientRequestId,
      postSendAction: data.postSendAction,
      templateId,
      templateTitle,
    },
  };
}

function releaseReservation(reservation: MailhubSendDuplicateReservation | null): void {
  if (reservation) releaseMailhubSendDuplicateGuard(reservation);
}

export async function POST(req: Request) {
  const testMode = isTestMode();

  const authResult = await requireUser();
  if (!authResult.ok) return authResponse(authResult);

  if (isReadOnlyMode()) {
    return errorResponse(403, "read_only", "READ ONLYのため送信できません", { reason: "gmail_send" });
  }

  if (!testMode && process.env.MAILHUB_SEND_ENABLED !== "1") {
    return errorResponse(403, "send_disabled", "Gmail送信はまだ有効化されていません");
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errorResponse(400, "invalid_json", "JSONを解析できません");
  }

  const validation = validateRequest(rawBody);
  if (!validation.ok) return validation.response;

  const sendRequest = validation.request;
  const duplicateReservation = reserveMailhubSendDuplicateGuard({
    actorEmail: authResult.user.email,
    messageId: sendRequest.messageId,
    clientRequestId: sendRequest.clientRequestId,
    bodyText: sendRequest.bodyText,
  });

  if (!duplicateReservation.ok) {
    return errorResponse(
      409,
      "duplicate_send",
      "すでに同じ送信が処理されています。送信済みの可能性があるため、受信トレイ/送信済みを確認してください",
      {
        messageId: sendRequest.messageId,
        clientRequestId: sendRequest.clientRequestId,
        duplicateKey: duplicateReservation.duplicateKey,
      },
    );
  }

  let reservation: MailhubSendDuplicateReservation | null = duplicateReservation;

  try {
    const detail = await getMessageDetail(sendRequest.messageId).catch((e: unknown) => {
      releaseReservation(reservation);
      reservation = null;
      const errorInfo = parseGmailError(e);
      if (testMode || errorInfo.error_code === "not_found") {
        throw { kind: "message_not_found" };
      }
      throw e;
    });

    const sharedInboxEmail = getSharedInboxEmail(testMode);
    const resolved = resolveReplyContext(detail, getSendResolverChannels(testMode), { sharedInboxEmail });
    if (!resolved.ok) {
      releaseReservation(reservation);
      reservation = null;
      const status = resolved.error === "rakuten_reply_blocked" ||
        resolved.error === "reply_to_self_loop" ||
        resolved.error === "reply_to_internal_blocked" ||
        resolved.error === "reply_to_group_blocked" ||
        resolved.error === "mailing_list_reply_blocked"
        ? 403
        : 400;
      return errorResponse(status, resolved.error, resolved.message, {
        messageId: sendRequest.messageId,
        candidates: resolved.candidates,
        matchedHeader: resolved.matchedHeader,
      });
    }

    const sendAs = await assertSendAsAccepted({
      fromAlias: resolved.context.fromAlias,
      sharedInboxEmail,
      testMode,
    });
    if (!sendAs.ok) {
      releaseReservation(reservation);
      reservation = null;
      return errorResponse(sendAs.error === "send_as_check_failed" ? 503 : 403, sendAs.error, sendAs.message, {
        messageId: sendRequest.messageId,
        fromAlias: sendAs.fromAlias,
      });
    }

    let mime;
    try {
      mime = await buildReplyMime({
        fromAlias: resolved.context.fromAlias,
        fromDisplayName: resolved.context.fromChannelLabel,
        to: resolved.context.to,
        originalSubject: resolved.context.subject,
        bodyText: sendRequest.bodyText,
        threadId: resolved.context.threadId,
        originalMessageId: resolved.context.originalMessageId,
        originalReferences: resolved.context.references,
      });
    } catch {
      releaseReservation(reservation);
      reservation = null;
      return errorResponse(500, "mime_build_failed", "返信メールの生成に失敗しました", {
        messageId: sendRequest.messageId,
      });
    }

    let sentMessageId: string;
    let threadId = resolved.context.threadId;
    let captureId: string | null = null;

    if (testMode) {
      sentMessageId = `sent-${sendRequest.clientRequestId}`;
      captureId = `capture-${sendRequest.clientRequestId}`;
      recordTestSentReplyCapture({
        id: captureId,
        timestamp: new Date().toISOString(),
        actorEmail: authResult.user.email,
        messageId: sendRequest.messageId,
        threadId,
        originalMessageId: resolved.context.originalMessageId,
        sentMessageId,
        clientRequestId: sendRequest.clientRequestId,
        fromAlias: resolved.context.fromAlias,
        fromChannelId: resolved.context.fromChannelId,
        to: resolved.context.to,
        subject: mime.subject,
        bodyText: sendRequest.bodyText,
        raw: mime.raw,
        decodedHeaders: {
          From: mime.headers.from,
          To: mime.headers.to,
          Subject: mime.headers.subject,
          "In-Reply-To": mime.headers.inReplyTo,
          References: mime.headers.references,
          threadId: mime.threadId,
        },
        postSendAction: sendRequest.postSendAction,
        status: "sent",
      });
    } else {
      try {
        const sendResult = await sendGmailReply({ raw: mime.raw, threadId: resolved.context.threadId });
        sentMessageId = sendResult.sentMessageId;
        threadId = sendResult.threadId;
      } catch (e) {
        return gmailApiErrorResponse(e);
      }
    }

    let status: TestSentReplyCaptureStatus = "sent";
    let done:
      | { ok: true; action: "archive"; undoable: true }
      | { ok: false; error: "gmail_api_error"; error_code: string; message: string }
      | undefined;

    if (sendRequest.postSendAction === "done") {
      try {
        await archiveMessage(sendRequest.messageId);
        status = "sent_and_done";
        done = { ok: true, action: "archive", undoable: true };
      } catch (e) {
        const errorInfo = parseGmailError(e);
        status = "sent_but_not_done";
        done = {
          ok: false,
          error: "gmail_api_error",
          error_code: errorInfo.error_code,
          message: errorInfo.message,
        };
      }
    }

    if (testMode && captureId) {
      updateTestSentReplyCaptureStatus({ id: captureId, status });
    }

    const auditResult = await logAction({
      actorEmail: authResult.user.email,
      action: "reply_send",
      messageId: sendRequest.messageId,
      label: status,
      metadata: {
        route: "gmail",
        status,
        threadId,
        sentMessageId,
        clientRequestId: sendRequest.clientRequestId,
        fromAlias: resolved.context.fromAlias,
        fromChannelId: resolved.context.fromChannelId,
        fromChannelLabel: resolved.context.fromChannelLabel,
        toDomain: toDomain(resolved.context.to),
        toHash: shortHash(resolved.context.to.toLowerCase()),
        bodyLength: sendRequest.bodyText.length,
        bodyHash: duplicateReservation.bodyHash || shortHash(normalizeBodyForHash(sendRequest.bodyText)),
        postSendAction: sendRequest.postSendAction,
        doneAction: sendRequest.postSendAction === "done" ? "archive" : null,
        templateId: sendRequest.templateId,
        templateTitle: sendRequest.templateTitle,
        unresolvedVars: [],
        sendAsAccepted: true,
      },
    });

    return noStoreJson({
      ok: true,
      status,
      action: "reply_send",
      messageId: sendRequest.messageId,
      threadId,
      sentMessageId,
      clientRequestId: sendRequest.clientRequestId,
      fromAlias: resolved.context.fromAlias,
      fromChannelId: resolved.context.fromChannelId,
      to: resolved.context.to,
      postSendAction: sendRequest.postSendAction,
      done,
      auditWarning: auditResult.storeAppendOk ? undefined : true,
    });
  } catch (e) {
    if (e && typeof e === "object" && (e as { kind?: unknown }).kind === "message_not_found") {
      return errorResponse(404, "message_not_found", "メールが見つかりませんでした", {
        messageId: sendRequest.messageId,
      });
    }
    return gmailApiErrorResponse(e);
  }
}
