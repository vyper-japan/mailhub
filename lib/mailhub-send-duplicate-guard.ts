import "server-only";

import { createHash } from "node:crypto";
import { getActivityLogs } from "@/lib/audit-log";

export const MAILHUB_SEND_DUPLICATE_TTL_MS = 600_000;

export type MailhubSendDuplicateKey = "clientRequestId" | "bodyHash";

export type MailhubSendDuplicateReservation = {
  requestKey: string;
  bodyKey: string;
  bodyHash: string;
  expiresAt: number;
  reservationId: string;
};

export type MailhubSendDuplicateReserveResult =
  | ({ ok: true } & MailhubSendDuplicateReservation)
  | {
      ok: false;
      duplicateKey: MailhubSendDuplicateKey;
      requestKey: string;
      bodyKey: string;
      bodyHash: string;
      expiresAt: number;
    };

export type MailhubSendDuplicateHistoryHit = {
  duplicateKey: MailhubSendDuplicateKey;
  requestKey: string;
  bodyKey: string;
  bodyHash: string;
  expiresAt: number;
};

type GuardEntry = {
  requestKey: string;
  bodyKey: string;
  bodyHash: string;
  expiresAt: number;
  reservationId: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __mailhubSendDuplicateGuardStore: Map<string, GuardEntry> | undefined;
  // eslint-disable-next-line no-var
  var __mailhubSendDuplicateGuardSeq: number | undefined;
}

function getStore(): Map<string, GuardEntry> {
  if (!globalThis.__mailhubSendDuplicateGuardStore) {
    globalThis.__mailhubSendDuplicateGuardStore = new Map();
  }
  return globalThis.__mailhubSendDuplicateGuardStore;
}

function nextReservationId(): string {
  const seq = (globalThis.__mailhubSendDuplicateGuardSeq ?? 0) + 1;
  globalThis.__mailhubSendDuplicateGuardSeq = seq;
  return `mailhub-send:${Date.now()}:${seq}`;
}

function normalizeBody(bodyText: string): string {
  return bodyText.replace(/\r\n?/g, "\n").trim();
}

function createBodyHash(bodyText: string): string {
  return createHash("sha256").update(normalizeBody(bodyText), "utf8").digest("hex").slice(0, 16);
}

function pruneExpired(nowMs: number): void {
  const store = getStore();
  for (const [key, entry] of store.entries()) {
    if (entry.expiresAt <= nowMs) {
      store.delete(key);
    }
  }
}

export function buildMailhubSendDuplicateKeys(input: {
  actorEmail: string;
  messageId: string;
  clientRequestId: string;
  bodyText: string;
}): { requestKey: string; bodyKey: string; bodyHash: string } {
  const bodyHash = createBodyHash(input.bodyText);
  return {
    requestKey: `req:${input.actorEmail}:${input.messageId}:${input.clientRequestId}`,
    bodyKey: `body:${input.messageId}:${bodyHash}`,
    bodyHash,
  };
}

function stringMetadataValue(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function historyExpiresAt(timestamp: string, nowMs: number): number | null {
  const createdAt = Date.parse(timestamp);
  if (!Number.isFinite(createdAt)) return null;
  const expiresAt = createdAt + MAILHUB_SEND_DUPLICATE_TTL_MS;
  return expiresAt > nowMs ? expiresAt : null;
}

export async function findMailhubSendDuplicateHistory(input: {
  actorEmail: string;
  messageId: string;
  clientRequestId: string;
  bodyHash: string;
  nowMs?: number;
}): Promise<MailhubSendDuplicateHistoryHit | null> {
  const nowMs = input.nowMs ?? Date.now();
  const keys = {
    requestKey: `req:${input.actorEmail}:${input.messageId}:${input.clientRequestId}`,
    bodyKey: `body:${input.messageId}:${input.bodyHash}`,
    bodyHash: input.bodyHash,
  };

  const [guardLogs, sendLogs] = await Promise.all([
    getActivityLogs({ action: "reply_send_guard", limit: 200 }),
    getActivityLogs({ action: "reply_send", limit: 200 }),
  ]).catch(() => [[], []] as const);

  for (const log of [...guardLogs, ...sendLogs]) {
    if (log.messageId !== input.messageId) continue;
    const expiresAt = historyExpiresAt(log.timestamp, nowMs);
    if (!expiresAt) continue;

    const metadata = log.metadata;
    const logRequestKey = stringMetadataValue(metadata, "requestKey");
    const logBodyKey = stringMetadataValue(metadata, "bodyKey");
    const logClientRequestId = stringMetadataValue(metadata, "clientRequestId");
    const logBodyHash = stringMetadataValue(metadata, "bodyHash");

    const requestMatches =
      logRequestKey === keys.requestKey ||
      (log.actorEmail === input.actorEmail && logClientRequestId === input.clientRequestId);
    if (requestMatches) {
      return {
        duplicateKey: "clientRequestId",
        requestKey: keys.requestKey,
        bodyKey: keys.bodyKey,
        bodyHash: keys.bodyHash,
        expiresAt,
      };
    }

    const bodyMatches = logBodyKey === keys.bodyKey || logBodyHash === input.bodyHash;
    if (bodyMatches) {
      return {
        duplicateKey: "bodyHash",
        requestKey: keys.requestKey,
        bodyKey: keys.bodyKey,
        bodyHash: keys.bodyHash,
        expiresAt,
      };
    }
  }

  return null;
}

export function reserveMailhubSendDuplicateGuard(input: {
  actorEmail: string;
  messageId: string;
  clientRequestId: string;
  bodyText: string;
  nowMs?: number;
}): MailhubSendDuplicateReserveResult {
  const nowMs = input.nowMs ?? Date.now();
  pruneExpired(nowMs);

  const keys = buildMailhubSendDuplicateKeys(input);
  const store = getStore();
  const requestHit = store.get(keys.requestKey);
  const bodyHit = store.get(keys.bodyKey);

  if (requestHit || bodyHit) {
    return {
      ok: false,
      duplicateKey: requestHit ? "clientRequestId" : "bodyHash",
      requestKey: keys.requestKey,
      bodyKey: keys.bodyKey,
      bodyHash: keys.bodyHash,
      expiresAt: (requestHit ?? bodyHit)?.expiresAt ?? nowMs,
    };
  }

  const entry: GuardEntry = {
    ...keys,
    expiresAt: nowMs + MAILHUB_SEND_DUPLICATE_TTL_MS,
    reservationId: nextReservationId(),
  };
  store.set(entry.requestKey, entry);
  store.set(entry.bodyKey, entry);
  return { ok: true, ...entry };
}

export function releaseMailhubSendDuplicateGuard(reservation: MailhubSendDuplicateReservation): boolean {
  const store = getStore();
  const requestEntry = store.get(reservation.requestKey);
  const bodyEntry = store.get(reservation.bodyKey);
  const matches =
    requestEntry?.reservationId === reservation.reservationId &&
    bodyEntry?.reservationId === reservation.reservationId;

  if (!matches) return false;
  store.delete(reservation.requestKey);
  store.delete(reservation.bodyKey);
  return true;
}

export function retainMailhubSendDuplicateGuardReservation(
  // Holding after the send boundary is represented by leaving the TTL entries in place.
  reservation: MailhubSendDuplicateReservation,
): void {
  void reservation;
}

export function clearMailhubSendDuplicateGuard(): void {
  globalThis.__mailhubSendDuplicateGuardStore?.clear();
  globalThis.__mailhubSendDuplicateGuardSeq = 0;
}
