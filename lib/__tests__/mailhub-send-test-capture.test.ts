import { beforeEach, describe, expect, it } from "vitest";
import {
  clearTestSentReplyCaptures,
  listTestSentReplyCaptures,
  recordTestSentReplyCapture,
  updateTestSentReplyCaptureStatus,
  type TestSentReplyCapture,
} from "@/lib/mailhub-send-test-capture";

function createCapture(overrides: Partial<TestSentReplyCapture> = {}): TestSentReplyCapture {
  return {
    id: "capture-001",
    timestamp: "2026-06-12T00:00:00.000Z",
    actorEmail: "staff@vtj.co.jp",
    messageId: "msg-001",
    threadId: "thread-001",
    originalMessageId: "<original@example.com>",
    sentMessageId: "sent-client-001",
    clientRequestId: "client-001",
    fromAlias: "vyper_sc@vtj.co.jp",
    fromChannelId: "vyper-amazon",
    to: "customer@example.com",
    subject: "Re: Order",
    bodyText: "Reply body",
    raw: "UmVwbHkgYm9keQ",
    decodedHeaders: {
      "In-Reply-To": "<original@example.com>",
      References: "<original@example.com>",
    },
    postSendAction: "done",
    status: "sent",
    ...overrides,
  };
}

describe("mailhub-send-test-capture", () => {
  beforeEach(() => {
    clearTestSentReplyCaptures();
  });

  it("records, lists, and clears sent reply captures", () => {
    const saved = recordTestSentReplyCapture(createCapture());

    expect(saved).toMatchObject({
      id: "capture-001",
      status: "sent",
      fromChannelId: "vyper-amazon",
    });
    expect(listTestSentReplyCaptures()).toHaveLength(1);

    clearTestSentReplyCaptures();
    expect(listTestSentReplyCaptures()).toEqual([]);
  });

  it("filters captures by messageId and clientRequestId", () => {
    recordTestSentReplyCapture(createCapture());
    recordTestSentReplyCapture(
      createCapture({
        id: "capture-002",
        messageId: "msg-002",
        clientRequestId: "client-002",
        sentMessageId: "sent-client-002",
      }),
    );

    expect(listTestSentReplyCaptures({ messageId: "msg-001" }).map((item) => item.id)).toEqual(["capture-001"]);
    expect(listTestSentReplyCaptures({ clientRequestId: "client-002" }).map((item) => item.id)).toEqual([
      "capture-002",
    ]);
  });

  it("updates capture status after Done completes", () => {
    recordTestSentReplyCapture(createCapture());

    updateTestSentReplyCaptureStatus({ id: "capture-001", status: "sent_and_done" });

    expect(listTestSentReplyCaptures()[0]?.status).toBe("sent_and_done");
  });

  it("updates capture status when Done fails after send", () => {
    recordTestSentReplyCapture(createCapture());

    updateTestSentReplyCaptureStatus({ id: "capture-001", status: "sent_but_not_done" });

    expect(listTestSentReplyCaptures()[0]?.status).toBe("sent_but_not_done");
  });

  it("returns cloned captures so callers cannot mutate the store", () => {
    recordTestSentReplyCapture(createCapture());
    const listed = listTestSentReplyCaptures();
    listed[0]!.decodedHeaders.References = "<mutated@example.com>";

    expect(listTestSentReplyCaptures()[0]?.decodedHeaders.References).toBe("<original@example.com>");
  });
});

