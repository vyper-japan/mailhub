import { createHash } from "node:crypto";
import type { ChannelDef, ChannelId } from "@/lib/channels";
import { classifyMailhubMessage, type MailhubMessagePurpose } from "@/lib/mailhubClassification";
import type { MessageDetail } from "@/lib/mailhub-types";
import { resolveReplyContext } from "@/lib/mailhub-send-resolver";
import { routeReply } from "@/lib/replyRouter";

export type AiDraftSuggestionStatus = "ready" | "blocked" | "not_needed";

export type AiDraftEvidence = {
  source: "classification" | "reply_route" | "gmail_resolver" | "policy";
  label: string;
  summary: string;
};

export type AiDraftSuggestion = {
  id: string;
  source: "deterministic_draft_v1";
  route: "gmail";
  title: string;
  body: string;
  bodyHash: string;
  bodyLength: number;
  inputHash: string;
  evidence: AiDraftEvidence[];
  warnings: string[];
  unresolvedVars: string[];
  requiresHumanReview: true;
};

export type AiDraftSuggestionResult =
  | {
      status: "ready";
      suggestion: AiDraftSuggestion;
      blockedReason: null;
      message: string;
      inputHash: string;
    }
  | {
      status: "blocked" | "not_needed";
      suggestion: null;
      blockedReason: string;
      message: string;
      inputHash: string;
      evidence: AiDraftEvidence[];
      warnings: string[];
    };

type BuildAiDraftSuggestionInput = {
  message: MessageDetail;
  channelId: ChannelId;
  testMode: boolean;
  channels: ChannelDef[];
  sharedInboxEmail?: string | null;
};

const DRAFT_BODY = [
  "ご連絡ありがとうございます。",
  "内容を確認いたしました。",
  "",
  "確認のうえ、担当よりご返信いたします。",
  "どうぞよろしくお願いいたします。",
].join("\n");

function shortHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

function buildInputHash(message: MessageDetail, purpose: MailhubMessagePurpose, replyRoute: string): string {
  return shortHash(JSON.stringify({
    id: message.id,
    threadId: message.threadId,
    subject: message.subject,
    from: message.from,
    receivedAt: message.receivedAt,
    snippet: message.snippet,
    body: (message.plainTextBody ?? message.htmlBody ?? "").slice(0, 8000),
    attachments: message.attachments.map((attachment) => attachment.filename),
    purpose,
    replyRoute,
  }));
}

function bodyLength(body: string): number {
  return body.replace(/\r\n?/g, "\n").trim().replace(/[\u3040-\u309f]+/gu, "あ").length;
}

function canDraftForPurpose(purpose: MailhubMessagePurpose): boolean {
  return purpose === "important" || purpose === "inquiry";
}

function blockedResult(input: {
  status: "blocked" | "not_needed";
  blockedReason: string;
  message: string;
  inputHash: string;
  evidence: AiDraftEvidence[];
  warnings?: string[];
}): AiDraftSuggestionResult {
  return {
    status: input.status,
    suggestion: null,
    blockedReason: input.blockedReason,
    message: input.message,
    inputHash: input.inputHash,
    evidence: input.evidence,
    warnings: input.warnings ?? ["draft_not_generated"],
  };
}

export function buildAiDraftSuggestion(input: BuildAiDraftSuggestionInput): AiDraftSuggestionResult {
  const classification = classifyMailhubMessage({
    subject: input.message.subject,
    from: input.message.from,
    snippet: [input.message.snippet, input.message.plainTextBody].filter(Boolean).join("\n").slice(0, 4000),
    attachmentNames: input.message.attachments.map((attachment) => attachment.filename),
  });
  const reply = routeReply(input.message, input.channelId, input.testMode);
  const inputHash = buildInputHash(input.message, classification.purpose, reply.kind);
  const hasBody = Boolean((input.message.plainTextBody ?? input.message.htmlBody ?? "").trim());
  const evidence: AiDraftEvidence[] = [
    ...classification.evidence.map((item): AiDraftEvidence => ({
      source: "classification",
      label: item.field,
      summary: item.keyword,
    })),
    {
      source: "reply_route",
      label: reply.kind,
      summary: reply.kind === "gmail" ? "Gmail reply candidate" : "Not a Gmail reply candidate",
    },
    {
      source: "policy",
      label: hasBody ? "body_loaded" : "body_missing",
      summary: hasBody ? "body available for local deterministic classification" : "body missing",
    },
  ];

  if (!hasBody) {
    return blockedResult({
      status: "blocked",
      blockedReason: "body_missing",
      message: "本文が未取得または空のため、AI下書きは作成しません",
      inputHash,
      evidence,
      warnings: ["body_missing", "draft_not_generated"],
    });
  }

  if (!canDraftForPurpose(classification.purpose)) {
    return blockedResult({
      status: "not_needed",
      blockedReason: `purpose_${classification.purpose}`,
      message: "返信下書きが必要なメール種別ではありません",
      inputHash,
      evidence,
      warnings: ["draft_not_needed", ...classification.blockedReasons],
    });
  }

  if (reply.kind !== "gmail") {
    return blockedResult({
      status: "blocked",
      blockedReason: `reply_route_${reply.kind}`,
      message: "Gmail返信として安全に解決できないため、AI下書きは作成しません",
      inputHash,
      evidence,
      warnings: ["non_gmail_reply_route", "draft_not_generated"],
    });
  }

  const resolved = resolveReplyContext(input.message, input.channels, { sharedInboxEmail: input.sharedInboxEmail });
  if (!resolved.ok) {
    return blockedResult({
      status: "blocked",
      blockedReason: `gmail_${resolved.error}`,
      message: resolved.message,
      inputHash,
      evidence: [
        ...evidence,
        { source: "gmail_resolver", label: resolved.error, summary: "Gmail reply resolver blocked draft generation" },
      ],
      warnings: ["gmail_reply_context_blocked", resolved.error],
    });
  }

  const bodyHash = shortHash(DRAFT_BODY);
  const readyEvidence: AiDraftEvidence[] = [...evidence];
  readyEvidence.push({
    source: "gmail_resolver",
    label: "safe_gmail_reply_context",
    summary: `${resolved.context.fromChannelId} -> ${resolved.context.replyToSource}`,
  });

  return {
    status: "ready",
    suggestion: {
      id: `draft-${input.message.id}-gmail-${inputHash}-${bodyHash}`,
      source: "deterministic_draft_v1",
      route: "gmail",
      title: "Gmail 返信たたき台",
      body: DRAFT_BODY,
      bodyHash,
      bodyLength: bodyLength(DRAFT_BODY),
      inputHash,
      evidence: readyEvidence.slice(0, 10),
      warnings: ["draft_skeleton_only", "human_review_required", "no_customer_body_quoted"],
      unresolvedVars: [],
      requiresHumanReview: true,
    },
    blockedReason: null,
    message: "AI下書き候補を作成しました",
    inputHash,
  };
}
