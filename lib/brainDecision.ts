import type { ChannelId } from "@/lib/channels";
import { classifyMailhubMessage, type MailhubClassification, type MailhubMessagePurpose } from "@/lib/mailhubClassification";
import type { MessageDetail } from "@/lib/mailhub-types";
import { routeReply, type ReplyKind, type ReplyRoute } from "@/lib/replyRouter";

export type BrainDisposition =
  | "reply"
  | "check_only"
  | "save_document"
  | "external_route"
  | "noise_candidate"
  | "review";

export type BrainEvidence = {
  source: "classification" | "reply_route" | "message" | "policy";
  label: string;
  detail: string;
};

export type BrainDecision = {
  id: string;
  messageId: string;
  generatedAt: string;
  source: "deterministic_v1";
  purpose: MailhubMessagePurpose;
  disposition: BrainDisposition;
  nextAction: string;
  replyRoute: ReplyKind;
  draftNeeded: boolean;
  discardCandidate: boolean;
  humanRequired: boolean;
  confidence: "low" | "medium" | "high";
  classification: MailhubClassification;
  evidence: BrainEvidence[];
  warnings: string[];
};

export function buildBrainDecision(input: {
  message: MessageDetail;
  channelId: ChannelId;
  testMode: boolean;
  now?: Date;
}): BrainDecision {
  const { message, channelId, testMode } = input;
  const generatedAt = (input.now ?? new Date()).toISOString();
  const classification = classifyMailhubMessage({
    subject: message.subject,
    from: message.from,
    snippet: [message.snippet, message.plainTextBody].filter(Boolean).join("\n").slice(0, 4000),
    attachmentNames: message.attachments.map((attachment) => attachment.filename),
  });
  const reply = routeReply(message, channelId, testMode);
  const hasBody = Boolean((message.plainTextBody ?? message.htmlBody ?? "").trim());

  const evidence: BrainEvidence[] = classification.evidence.map((item) => ({
    source: "classification",
    label: item.field,
    detail: item.keyword,
  }));
  evidence.push({
    source: "reply_route",
    label: reply.kind,
    detail: describeReplyRoute(reply),
  });
  evidence.push({
    source: "message",
    label: hasBody ? "body_loaded" : "body_missing",
    detail: hasBody ? "本文を読める状態です" : "本文が未取得または空です",
  });

  const decision = decideFromPurpose(classification.purpose, reply, hasBody);
  const warnings = [
    "suggestion_only",
    ...(classification.blockedReasons.length > 0 ? classification.blockedReasons : []),
    ...(!hasBody ? ["body_missing"] : []),
    ...(classification.purpose === "noise" ? ["no_auto_discard_without_human_review"] : []),
  ];

  return {
    id: `brain-${message.id}-${classification.purpose}-${reply.kind}`,
    messageId: message.id,
    generatedAt,
    source: "deterministic_v1",
    purpose: classification.purpose,
    disposition: decision.disposition,
    nextAction: decision.nextAction,
    replyRoute: reply.kind,
    draftNeeded: decision.draftNeeded,
    discardCandidate: decision.discardCandidate,
    humanRequired: true,
    confidence: decision.confidence,
    classification,
    evidence,
    warnings,
  };
}

function describeReplyRoute(reply: ReplyRoute): string {
  if (reply.kind === "rakuten_rms") {
    return reply.inquiryId ? `楽天RMS / ${reply.inquiryId}` : "楽天RMS";
  }
  if (reply.kind === "gmail") return "Gmail返信";
  return "返信ルート未確定";
}

function decideFromPurpose(
  purpose: MailhubMessagePurpose,
  reply: ReplyRoute,
  hasBody: boolean,
): Pick<BrainDecision, "disposition" | "nextAction" | "draftNeeded" | "discardCandidate" | "confidence"> {
  if (purpose === "invoice") {
    return {
      disposition: "save_document",
      nextAction: "請求/書類として確認",
      draftNeeded: false,
      discardCandidate: false,
      confidence: "high",
    };
  }
  if (purpose === "important" || purpose === "inquiry") {
    return {
      disposition: reply.kind === "rakuten_rms" ? "external_route" : "reply",
      nextAction: reply.kind === "rakuten_rms" ? "楽天RMSで返信/確認" : "返信内容を作成",
      draftNeeded: hasBody,
      discardCandidate: false,
      confidence: hasBody ? "high" : "medium",
    };
  }
  if (purpose === "noise") {
    return {
      disposition: "noise_candidate",
      nextAction: "処理不要候補として人が確認",
      draftNeeded: false,
      discardCandidate: true,
      confidence: hasBody ? "medium" : "low",
    };
  }
  return {
    disposition: "check_only",
    nextAction: "内容を確認して行き先を決める",
    draftNeeded: false,
    discardCandidate: false,
    confidence: hasBody ? "medium" : "low",
  };
}
