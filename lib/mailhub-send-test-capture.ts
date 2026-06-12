import "server-only";

import type { ChannelId } from "@/lib/channels";

export type TestSentReplyCapture = {
  id: string;
  timestamp: string;
  actorEmail: string;
  messageId: string;
  threadId: string;
  originalMessageId: string;
  sentMessageId: string;
  clientRequestId: string;
  fromAlias: string;
  fromChannelId: ChannelId;
  to: string;
  subject: string;
  bodyText: string;
  raw: string;
  decodedHeaders: Record<string, string>;
  postSendAction: "none" | "done";
  status: TestSentReplyCaptureStatus;
};

export type TestSentReplyCaptureStatus = "sent" | "sent_and_done" | "sent_but_not_done";

declare global {
  // eslint-disable-next-line no-var
  var __mailhubTestSentReplyCaptures: TestSentReplyCapture[] | undefined;
}

function getCaptures(): TestSentReplyCapture[] {
  if (!globalThis.__mailhubTestSentReplyCaptures) {
    globalThis.__mailhubTestSentReplyCaptures = [];
  }
  return globalThis.__mailhubTestSentReplyCaptures;
}

function cloneCapture(capture: TestSentReplyCapture): TestSentReplyCapture {
  return {
    ...capture,
    decodedHeaders: { ...capture.decodedHeaders },
  };
}

export function recordTestSentReplyCapture(capture: TestSentReplyCapture): TestSentReplyCapture {
  const stored = cloneCapture(capture);
  getCaptures().push(stored);
  return cloneCapture(stored);
}

export function updateTestSentReplyCaptureStatus(input: {
  id: string;
  status: TestSentReplyCaptureStatus;
}): void {
  const capture = getCaptures().find((item) => item.id === input.id);
  if (!capture) return;
  capture.status = input.status;
}

export function listTestSentReplyCaptures(filter?: {
  messageId?: string | null;
  clientRequestId?: string | null;
}): TestSentReplyCapture[] {
  return getCaptures()
    .filter((capture) => !filter?.messageId || capture.messageId === filter.messageId)
    .filter((capture) => !filter?.clientRequestId || capture.clientRequestId === filter.clientRequestId)
    .map(cloneCapture);
}

export function clearTestSentReplyCaptures(): void {
  globalThis.__mailhubTestSentReplyCaptures = [];
}

