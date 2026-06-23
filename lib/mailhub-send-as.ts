import "server-only";

import { google } from "googleapis";
import { getChannels } from "@/lib/channels";
import { mustGetEnv } from "@/lib/env";

export type SendAsCheckResult =
  | {
      ok: true;
      fromAlias: string;
      acceptedAliases: string[];
      cache: "hit" | "miss" | "test";
      checkedAt: string;
    }
  | {
      ok: false;
      error: "send_as_unaccepted" | "send_as_check_failed";
      fromAlias: string;
      acceptedAliases: string[];
      message: string;
      checkedAt: string;
    };

export type TestSendAsOverride = {
  unaccepted: string[];
};

type SendAsCacheEntry = {
  acceptedAliases: string[];
  checkedAt: string;
  expiresAt: number;
};

const SEND_AS_CACHE_TTL_MS = 300_000;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

declare global {
  // eslint-disable-next-line no-var
  var __mailhubSendAsCache: Map<string, SendAsCacheEntry> | undefined;
  // eslint-disable-next-line no-var
  var __mailhubTestSendAsOverride: TestSendAsOverride | undefined;
}

function getSendAsCache(): Map<string, SendAsCacheEntry> {
  if (!globalThis.__mailhubSendAsCache) {
    globalThis.__mailhubSendAsCache = new Map();
  }
  return globalThis.__mailhubSendAsCache;
}

function normalizeEmail(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  return value.match(EMAIL_RE)?.[0]?.toLowerCase() ?? null;
}

function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function getRequiredGmailSendAsAliases(): string[] {
  return getChannels(false)
    .filter((channel) => channel.replyKind === "gmail" && channel.id !== "ams-vyper")
    .flatMap((channel) => channel.addresses)
    .map((address) => address.toLowerCase());
}

function normalizeOverride(override: TestSendAsOverride): TestSendAsOverride {
  const required = new Set(getRequiredGmailSendAsAliases());
  return {
    unaccepted: dedupePreserveOrder(
      override.unaccepted
        .map((alias) => normalizeEmail(alias))
        .filter((alias): alias is string => alias !== null && required.has(alias)),
    ),
  };
}

export function setTestSendAsOverride(override: TestSendAsOverride | null): void {
  if (!override) {
    resetTestSendAsOverride();
    return;
  }
  globalThis.__mailhubTestSendAsOverride = normalizeOverride(override);
}

export function getTestSendAsOverride(): TestSendAsOverride | null {
  const override = globalThis.__mailhubTestSendAsOverride;
  return override ? { unaccepted: [...override.unaccepted] } : null;
}

export function resetTestSendAsOverride(): void {
  delete globalThis.__mailhubTestSendAsOverride;
}

function createGmailClient() {
  const refreshToken = mustGetEnv("GOOGLE_SHARED_INBOX_REFRESH_TOKEN");
  const clientId = mustGetEnv("GOOGLE_CLIENT_ID");
  const clientSecret = mustGetEnv("GOOGLE_CLIENT_SECRET");

  const oauth2Client = new google.auth.OAuth2({
    clientId,
    clientSecret,
  });
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

async function fetchAcceptedSendAsAliases(sharedInboxEmail: string): Promise<string[]> {
  const gmail = createGmailClient();
  const response = await gmail.users.settings.sendAs.list({ userId: sharedInboxEmail });
  return dedupePreserveOrder(
    (response.data.sendAs ?? [])
      .filter((item) => item.verificationStatus === "accepted" || item.isPrimary === true)
      .map((item) => normalizeEmail(item.sendAsEmail))
      .filter((alias): alias is string => alias !== null),
  );
}

function buildResult(input: {
  fromAlias: string;
  acceptedAliases: string[];
  cache?: "hit" | "miss" | "test";
  checkedAt: string;
}): SendAsCheckResult {
  const accepted = new Set(input.acceptedAliases);
  if (!accepted.has(input.fromAlias)) {
    return {
      ok: false,
      error: "send_as_unaccepted",
      fromAlias: input.fromAlias,
      acceptedAliases: input.acceptedAliases,
      message: "このFromはGmail send-asで未承認です",
      checkedAt: input.checkedAt,
    };
  }
  return {
    ok: true,
    fromAlias: input.fromAlias,
    acceptedAliases: input.acceptedAliases,
    cache: input.cache ?? "miss",
    checkedAt: input.checkedAt,
  };
}

function checkTestMode(fromAlias: string): SendAsCheckResult {
  const checkedAt = new Date().toISOString();
  const override = getTestSendAsOverride();
  const unaccepted = new Set(override?.unaccepted ?? []);
  const acceptedAliases = getRequiredGmailSendAsAliases().filter((alias) => !unaccepted.has(alias));
  return buildResult({ fromAlias, acceptedAliases, cache: "test", checkedAt });
}

export async function assertSendAsAccepted(input: {
  fromAlias: string;
  sharedInboxEmail: string;
  testMode: boolean;
  forceRefresh?: boolean;
}): Promise<SendAsCheckResult> {
  const fromAlias = normalizeEmail(input.fromAlias);
  const checkedAt = new Date().toISOString();
  if (!fromAlias) {
    return {
      ok: false,
      error: "send_as_unaccepted",
      fromAlias: "",
      acceptedAliases: [],
      message: "このFromはGmail send-asで未承認です",
      checkedAt,
    };
  }

  if (input.testMode) {
    return checkTestMode(fromAlias);
  }

  const cacheKey = input.sharedInboxEmail.toLowerCase();
  const now = Date.now();
  const cache = getSendAsCache();
  const cached = cache.get(cacheKey);
  if (!input.forceRefresh && cached && cached.expiresAt > now) {
    return buildResult({
      fromAlias,
      acceptedAliases: cached.acceptedAliases,
      cache: "hit",
      checkedAt: cached.checkedAt,
    });
  }

  try {
    const acceptedAliases = await fetchAcceptedSendAsAliases(input.sharedInboxEmail);
    const entry = {
      acceptedAliases,
      checkedAt,
      expiresAt: now + SEND_AS_CACHE_TTL_MS,
    };
    cache.set(cacheKey, entry);
    return buildResult({ fromAlias, acceptedAliases, cache: "miss", checkedAt });
  } catch {
    return {
      ok: false,
      error: "send_as_check_failed",
      fromAlias,
      acceptedAliases: [],
      message: "Gmail send-as状態を確認できません",
      checkedAt,
    };
  }
}
