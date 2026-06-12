import { beforeEach, describe, expect, it } from "vitest";
import {
  MAILHUB_SEND_DUPLICATE_TTL_MS,
  clearMailhubSendDuplicateGuard,
  releaseMailhubSendDuplicateGuard,
  reserveMailhubSendDuplicateGuard,
  retainMailhubSendDuplicateGuardReservation,
} from "@/lib/mailhub-send-duplicate-guard";

function reserve(overrides: Partial<Parameters<typeof reserveMailhubSendDuplicateGuard>[0]> = {}) {
  return reserveMailhubSendDuplicateGuard({
    actorEmail: "staff-a@vtj.co.jp",
    messageId: "msg-001",
    clientRequestId: "client-001",
    bodyText: "Hello\r\nworld",
    nowMs: 1_000,
    ...overrides,
  });
}

describe("mailhub-send-duplicate-guard", () => {
  beforeEach(() => {
    clearMailhubSendDuplicateGuard();
  });

  it("blocks duplicate requestKey for the same actor, message, and clientRequestId", () => {
    const first = reserve();
    const second = reserve({ bodyText: "Different body" });

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({
      ok: false,
      duplicateKey: "clientRequestId",
      requestKey: "req:staff-a@vtj.co.jp:msg-001:client-001",
    });
  });

  it("blocks duplicate bodyKey across actors for the same message and normalized body", () => {
    const first = reserve();
    const second = reserve({
      actorEmail: "staff-b@vtj.co.jp",
      clientRequestId: "client-002",
      bodyText: "  Hello\nworld  ",
    });

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({
      ok: false,
      duplicateKey: "bodyHash",
      bodyKey: expect.stringMatching(/^body:msg-001:[a-f0-9]{16}$/),
    });
  });

  it("returns clientRequestId when requestKey and bodyKey both hit", () => {
    reserve();
    const duplicate = reserve();

    expect(duplicate).toMatchObject({
      ok: false,
      duplicateKey: "clientRequestId",
    });
  });

  it("releases only the matching pre-send reservation", () => {
    const first = reserve();
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(releaseMailhubSendDuplicateGuard(first)).toBe(true);
    expect(reserve().ok).toBe(true);
  });

  it("does not let an old release clear a newer reservation after TTL expiry", () => {
    const first = reserve({ nowMs: 1_000 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const afterExpiry = reserve({ nowMs: 1_000 + MAILHUB_SEND_DUPLICATE_TTL_MS });
    expect(afterExpiry.ok).toBe(true);
    expect(releaseMailhubSendDuplicateGuard(first)).toBe(false);

    const duplicate = reserve({ nowMs: 1_000 + MAILHUB_SEND_DUPLICATE_TTL_MS + 1 });
    expect(duplicate).toMatchObject({ ok: false, duplicateKey: "clientRequestId" });
  });

  it("keeps reservations through the TTL when retained after the send boundary", () => {
    const first = reserve();
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    retainMailhubSendDuplicateGuardReservation(first);
    expect(reserve({ nowMs: 1_000 + MAILHUB_SEND_DUPLICATE_TTL_MS - 1 })).toMatchObject({
      ok: false,
      duplicateKey: "clientRequestId",
    });
    expect(reserve({ nowMs: 1_000 + MAILHUB_SEND_DUPLICATE_TTL_MS }).ok).toBe(true);
  });
});

