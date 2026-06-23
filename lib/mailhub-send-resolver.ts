import type { ChannelDef, ChannelId } from "@/lib/channels";
import { getChannels } from "@/lib/channels";
import type { MessageDetail } from "@/lib/mailhub-types";

export type ReplyToSource = "replyTo" | "from";
export type MatchedHeaderName = "deliveredTo" | "xOriginalTo" | "to" | "cc" | "bcc";

export type ResolveReplyErrorCode =
  | "missing_thread_id"
  | "missing_original_message_id"
  | "from_alias_unresolved"
  | "from_alias_ambiguous"
  | "rakuten_reply_blocked"
  | "reply_to_unresolved"
  | "reply_to_ambiguous"
  | "reply_to_self_loop"
  | "reply_to_internal_blocked"
  | "reply_to_group_blocked"
  | "mailing_list_reply_blocked";

export type ResolvedReplyContext = {
  fromAlias: string;
  fromChannelId: ChannelId;
  fromChannelLabel: string;
  to: string;
  replyToSource: ReplyToSource;
  subject: string;
  threadId: string;
  originalMessageId: string;
  references: string[];
  inReplyTo: string;
  matchedHeader: MatchedHeaderName;
  matchedHeaderValue: string;
  isRakutenBlocked: false;
};

export type ResolveReplyContextResult =
  | { ok: true; context: ResolvedReplyContext }
  | {
      ok: false;
      error: ResolveReplyErrorCode;
      message: string;
      candidates?: string[];
      matchedHeader?: MatchedHeaderName;
    };

type HeaderEmailHit = {
  email: string;
  header: MatchedHeaderName;
  headerValue: string;
  tierIndex: number;
  headerValueIndex: number;
  emailIndex: number;
};

type GmailAliasHit = HeaderEmailHit & {
  aliasAddress: string;
  channel: ChannelDef;
};

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function getSendResolverChannels(testMode: boolean): ChannelDef[] {
  if (!testMode) return getChannels(false);
  return [...getChannels(false), ...getChannels(true).filter((channel) => channel.id !== "all")];
}

function normalizeEmail(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const match = value.match(EMAIL_RE);
  return match?.[0]?.toLowerCase() ?? null;
}

function extractEmailOccurrences(rawHeader: string | null | undefined): string[] {
  const value = rawHeader?.trim();
  if (!value) return [];
  return Array.from(value.matchAll(EMAIL_RE), (match) => match[0].toLowerCase());
}

function parseMessageIdList(rawHeader: string | null | undefined): string[] {
  const value = rawHeader?.trim();
  if (!value) return [];
  return Array.from(value.matchAll(/<[^<>]+>/g), (match) => match[0]);
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

function normalizeMessageId(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  return parseMessageIdList(value)[0] ?? value;
}

function collectHeaderHits(detail: MessageDetail): HeaderEmailHit[] {
  const headerTiers: Array<{ name: MatchedHeaderName; values: string[] }> = [
    { name: "deliveredTo", values: detail.deliveredTo },
    { name: "xOriginalTo", values: detail.xOriginalTo ? [detail.xOriginalTo] : [] },
    { name: "to", values: detail.to ? [detail.to] : [] },
    { name: "cc", values: detail.cc ? [detail.cc] : [] },
    { name: "bcc", values: detail.bcc ? [detail.bcc] : [] },
  ];

  const allHits: HeaderEmailHit[] = [];
  for (const [tierIndex, tier] of headerTiers.entries()) {
    for (const [headerValueIndex, headerValue] of tier.values.entries()) {
      for (const [emailIndex, email] of extractEmailOccurrences(headerValue).entries()) {
        allHits.push({ email, header: tier.name, headerValue, tierIndex, headerValueIndex, emailIndex });
      }
    }
  }
  return allHits;
}

function compareHeaderHitOrder(a: HeaderEmailHit, b: HeaderEmailHit): number {
  return (
    a.tierIndex - b.tierIndex ||
    a.headerValueIndex - b.headerValueIndex ||
    a.emailIndex - b.emailIndex
  );
}

export function resolveReplyContext(
  detail: MessageDetail,
  channels: ChannelDef[],
  opts?: { sharedInboxEmail?: string | null },
): ResolveReplyContextResult {
  const threadId = detail.threadId?.trim();
  if (!threadId) {
    return { ok: false, error: "missing_thread_id", message: "Gmail threadIdがありません" };
  }

  const originalMessageId = normalizeMessageId(detail.messageId);
  if (!originalMessageId) {
    return { ok: false, error: "missing_original_message_id", message: "元メールのMessage-IDがありません" };
  }

  const allHits = collectHeaderHits(detail);
  const rakutenAliases = new Set(
    channels
      .filter((channel) => channel.replyKind === "rakuten_rms")
      .flatMap((channel) => channel.addresses.map((address) => address.toLowerCase())),
  );
  const rakutenHits = allHits.filter((hit) => rakutenAliases.has(hit.email));
  if (rakutenHits.length > 0) {
    return {
      ok: false,
      error: "rakuten_reply_blocked",
      message: "楽天RMS宛のメールはGmail送信できません",
      candidates: dedupePreserveOrder(rakutenHits.map((hit) => hit.email)),
      matchedHeader: rakutenHits[0]?.header,
    };
  }

  if (detail.listId || detail.listPost) {
    return {
      ok: false,
      error: "mailing_list_reply_blocked",
      message: "メーリングリスト宛のメールにはGmail返信できません",
    };
  }

  const gmailAliases = channels
    .filter((channel) => channel.replyKind === "gmail")
    .flatMap((channel) =>
      channel.addresses.map((address) => ({
        address: address.toLowerCase(),
        channel,
      })),
    );
  const gmailHits: GmailAliasHit[] = allHits.flatMap((hit) =>
    gmailAliases
      .filter((alias) => alias.address === hit.email)
      .map((alias) => ({ ...hit, aliasAddress: alias.address, channel: alias.channel })),
  );
  const gmailHitsByChannel = new Map<ChannelId, GmailAliasHit[]>();
  for (const hit of gmailHits) {
    const channelHits = gmailHitsByChannel.get(hit.channel.id) ?? [];
    channelHits.push(hit);
    gmailHitsByChannel.set(hit.channel.id, channelHits);
  }

  if (gmailHitsByChannel.size === 0) {
    return { ok: false, error: "from_alias_unresolved", message: "送信元グループアドレスを一意に解決できません" };
  }
  const representativeHitsByChannel = Array.from(gmailHitsByChannel.values())
    .map((channelHits) => [...channelHits].sort(compareHeaderHitOrder)[0])
    .filter((hit): hit is GmailAliasHit => Boolean(hit))
    .sort(compareHeaderHitOrder);

  if (representativeHitsByChannel.length > 1) {
    return {
      ok: false,
      error: "from_alias_ambiguous",
      message: "送信元グループアドレス候補が複数あります",
      candidates: dedupePreserveOrder(representativeHitsByChannel.map((hit) => hit.aliasAddress)),
    };
  }

  const selectedHit = representativeHitsByChannel[0];
  if (!selectedHit) {
    return { ok: false, error: "from_alias_unresolved", message: "送信元グループアドレスを一意に解決できません" };
  }

  const replyToSource: ReplyToSource = detail.replyTo ? "replyTo" : "from";
  const replyCandidates = extractEmailOccurrences(replyToSource === "replyTo" ? detail.replyTo : detail.from);
  if (replyCandidates.length === 0) {
    return { ok: false, error: "reply_to_unresolved", message: "返信先メールアドレスを解決できません" };
  }
  if (replyCandidates.length > 1) {
    return {
      ok: false,
      error: "reply_to_ambiguous",
      message: "返信先メールアドレスが複数あります",
      candidates: dedupePreserveOrder(replyCandidates),
    };
  }

  const to = replyCandidates[0]!;
  const groupAliases = channels.flatMap((channel) => channel.addresses.map((address) => address.toLowerCase()));
  const sharedInbox = normalizeEmail(opts?.sharedInboxEmail);

  if (to === selectedHit.aliasAddress || (sharedInbox && to === sharedInbox)) {
    return { ok: false, error: "reply_to_self_loop", message: "自分自身には返信できません" };
  }
  if (groupAliases.includes(to)) {
    return { ok: false, error: "reply_to_group_blocked", message: "グループアドレスにはGmail返信できません" };
  }
  if (to.endsWith("@vtj.co.jp")) {
    return { ok: false, error: "reply_to_internal_blocked", message: "社内アドレスにはGmail返信できません" };
  }

  return {
    ok: true,
    context: {
      fromAlias: selectedHit.aliasAddress,
      fromChannelId: selectedHit.channel.id,
      fromChannelLabel: selectedHit.channel.label,
      to,
      replyToSource,
      subject: detail.subject?.trim() || "(no subject)",
      threadId,
      originalMessageId,
      references: dedupePreserveOrder([...parseMessageIdList(detail.references), ...parseMessageIdList(detail.inReplyTo)]),
      inReplyTo: originalMessageId,
      matchedHeader: selectedHit.header,
      matchedHeaderValue: selectedHit.headerValue,
      isRakutenBlocked: false,
    },
  };
}
