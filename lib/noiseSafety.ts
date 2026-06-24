import type { InboxListMessage, MailAttachment, MessageDetail } from "./mailhub-types";
import {
  classifyMailhubMessage,
  type MailhubClassification,
} from "./mailhubClassification";

export type NoiseSafetyStatus = "safe_to_suppress" | "protected" | "missing_summary" | "not_noise";

export type NoiseSafetyDecision = {
  id: string;
  threadId: string | null;
  subject: string | null;
  from: string | null;
  status: NoiseSafetyStatus;
  classification: MailhubClassification;
};

type NoiseSafetyMessage = Pick<InboxListMessage, "id" | "subject" | "from" | "snippet"> &
  Partial<Pick<InboxListMessage, "threadId" | "attachmentCount">> & {
    attachmentNames?: string[];
    attachments?: Pick<MailAttachment, "filename">[];
  };

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function attachmentNamesFor(message: NoiseSafetyMessage): string[] {
  const explicit = message.attachmentNames ?? [];
  const fromAttachments = message.attachments?.map((attachment) => attachment.filename).filter(Boolean) ?? [];
  return [...explicit, ...fromAttachments].map((value) => value.trim()).filter(Boolean);
}

function blockedClassification(reason: string): MailhubClassification {
  return {
    purpose: "other",
    evidence: [],
    suppressible: false,
    blockedReasons: [reason],
  };
}

export function evaluateNoiseSafety(message: NoiseSafetyMessage): NoiseSafetyDecision {
  const subject = nonEmpty(message.subject);
  const from = nonEmpty(message.from);
  const snippet = nonEmpty(message.snippet);
  const attachmentNames = attachmentNamesFor(message);
  const attachmentCount = typeof message.attachmentCount === "number" ? message.attachmentCount : null;
  const hasSummaryText = Boolean(subject || snippet || attachmentNames.length > 0);

  if (!hasSummaryText) {
    return {
      id: message.id,
      threadId: message.threadId ?? null,
      subject,
      from,
      status: "missing_summary",
      classification: blockedClassification("missing_summary"),
    };
  }

  const classification = classifyMailhubMessage({
    subject,
    from,
    snippet: snippet ?? "",
    attachmentNames,
  });

  if (!classification.suppressible && classification.purpose !== "other") {
    return {
      id: message.id,
      threadId: message.threadId ?? null,
      subject,
      from,
      status: "protected",
      classification,
    };
  }

  if (attachmentCount !== null && attachmentCount > attachmentNames.length) {
    return {
      id: message.id,
      threadId: message.threadId ?? null,
      subject,
      from,
      status: "missing_summary",
      classification: {
        ...classification,
        suppressible: false,
        blockedReasons: [...classification.blockedReasons, "unknown_attachment_names"],
      },
    };
  }

  if (classification.purpose === "noise" && classification.suppressible) {
    return {
      id: message.id,
      threadId: message.threadId ?? null,
      subject,
      from,
      status: "safe_to_suppress",
      classification,
    };
  }

  return {
    id: message.id,
    threadId: message.threadId ?? null,
    subject,
    from,
    status: "not_noise",
    classification,
  };
}

export function evaluateDetailNoiseSafety(detail: MessageDetail): NoiseSafetyDecision {
  return evaluateNoiseSafety({
    id: detail.id,
    threadId: detail.threadId,
    subject: detail.subject,
    from: detail.from,
    snippet: detail.snippet,
    attachments: detail.attachments,
  });
}
