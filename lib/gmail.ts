import "server-only";

import { google } from "googleapis";
import { mustGetEnv } from "@/lib/env";
import { isTestMode } from "@/lib/test-mode";
import type { InboxListMessage, MessageDetail } from "@/lib/mailhub-types";
import messagesFixture from "@/fixtures/messages.json";

// テストモード用のモックデータ読み込み
async function getMockDetail(id: string): Promise<MessageDetail | null> {
  try {
    // 動的インポートでfixtureを読み込む
    const detail = await import(`@/fixtures/details/${id}.json`);
    return detail.default as MessageDetail;
  } catch {
    // ファイルがない場合はデフォルト生成
    const msg = (messagesFixture as InboxListMessage[]).find((m) => m.id === id);
    if (!msg) return null;
    return {
      ...msg,
      plainTextBody: `これは ${msg.subject} のテスト本文です。\n\nテストモードで表示しています。`,
      bodyNotice: null,
    };
  }
}

type CacheEntry<T> = { value: T; expiresAt: number };

// テストモード用: メールのStatus状態を保持
type TestMessageStatus = "todo" | "waiting" | "done";

declare global {
  // eslint-disable-next-line no-var
  var __mailhubGmailCache:
    | {
        list: Map<string, CacheEntry<InboxListMessage[]>>;
        detail: Map<string, CacheEntry<MessageDetail>>;
        labels: Map<string, string>; // labelName -> labelId
      }
    | undefined;
  // eslint-disable-next-line no-var
  var __mailhubTestMessageStatus: Map<string, TestMessageStatus> | undefined;
}

function getCache() {
  if (!globalThis.__mailhubGmailCache) {
    globalThis.__mailhubGmailCache = {
      list: new Map(),
      detail: new Map(),
      labels: new Map(),
    };
  }
  return globalThis.__mailhubGmailCache;
}

// テストモード用: メール状態を取得/設定
function getTestMessageStatus(): Map<string, TestMessageStatus> {
  if (!globalThis.__mailhubTestMessageStatus) {
    globalThis.__mailhubTestMessageStatus = new Map();
  }
  return globalThis.__mailhubTestMessageStatus;
}

// テストモード用: Claimed状態を保持
declare global {
  // eslint-disable-next-line no-var
  var __mailhubTestClaimedStatus: Set<string> | undefined;
}

function getTestClaimedStatus(): Set<string> {
  if (!globalThis.__mailhubTestClaimedStatus) {
    globalThis.__mailhubTestClaimedStatus = new Set();
  }
  return globalThis.__mailhubTestClaimedStatus;
}

function getTestStatus(id: string): TestMessageStatus {
  return getTestMessageStatus().get(id) ?? "todo";
}

function setTestStatus(id: string, status: TestMessageStatus) {
  getTestMessageStatus().set(id, status);
}

// MailHub用のGmailラベル名
export const MAILHUB_LABEL_WAITING = "MailHub/Waiting";
export const MAILHUB_LABEL_DONE = "MailHub/Done";
export const MAILHUB_LABEL_IN_PROGRESS = "MailHub/InProgress";

function getCached<T>(map: Map<string, CacheEntry<T>>, key: string): T | null {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    map.delete(key);
    return null;
  }
  return hit.value;
}

function setCached<T>(map: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number) {
  map.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function headerValue(
  headers: Array<{ name?: string | null; value?: string | null }> | undefined,
  name: string,
): string | null {
  const hit = headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return hit?.value ?? null;
}

function formatReceivedAt(internalDateMs: number): string {
  return new Date(internalDateMs).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
  });
}

// テスト用にexport（QA Gate要件）
export function normalizeMessageId(messageId: string | null): string | null {
  if (!messageId) return null;
  const trimmed = messageId.trim();
  return trimmed.length ? trimmed : null;
}

// テスト用にexport（QA Gate要件）
export function buildGmailLink(
  sharedInboxEmail: string,
  messageId: string | null,
  threadId: string,
): string {
  const base = `https://mail.google.com/mail/u/0/?authuser=${encodeURIComponent(
    sharedInboxEmail,
  )}#`;
  const normalized = normalizeMessageId(messageId);
  if (normalized) {
    // より確実に検索で辿れる（in:anywhere を付与）
    const q = `in:anywhere rfc822msgid:${normalized}`;
    return `${base}search/${encodeURIComponent(q)}`;
  }
  return `${base}inbox/${threadId}`;
}

// テスト用にexport（QA Gate要件）
export function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLength);
  return Buffer.from(padded, "base64").toString("utf8");
}

type GmailMessagePart = {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: GmailMessagePart[] | null;
};

type BodyResult = { body: string; source: "plain" | "html" } | null;

function findBodyPart(
  part: GmailMessagePart | null | undefined,
  targetMime: "text/plain" | "text/html",
): string | null {
  if (!part) return null;

  const mimeType = part.mimeType ?? undefined;
  const data = part.body?.data ?? undefined;

  if (mimeType?.toLowerCase().startsWith(targetMime) && data) {
    try {
      return decodeBase64Url(data);
    } catch {
      return null;
    }
  }

  const parts = part.parts ?? undefined;
  if (!parts?.length) return null;

  for (const p of parts) {
    const hit = findBodyPart(p, targetMime);
    if (hit) return hit;
  }
  return null;
}

function stripHtmlToText(html: string): string {
  let text = html;

  // 1. 不要なブロックを完全除去
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "");
  // 非表示要素も除去
  text = text.replace(/<[^>]+display\s*:\s*none[^>]*>[\s\S]*?<\/[^>]+>/gi, "");

  // 2. ブロック要素を改行に変換（最小限）
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<\/tr>/gi, "\n");
  text = text.replace(/<\/li>/gi, "\n");
  text = text.replace(/<\/h[1-6]>/gi, "\n");
  // テーブルセルはスペースに（改行にしない）
  text = text.replace(/<\/td>/gi, " ");
  text = text.replace(/<\/th>/gi, " ");

  // 3. 残りのタグを除去
  text = text.replace(/<[^>]+>/g, "");

  // 4. &amp; を先にデコード（&amp;zwnj; → &zwnj; にするため）
  text = text.replace(/&amp;/gi, "&");

  // 5. ゼロ幅文字系エンティティを除去
  text = text.replace(/&zwnj;/gi, "");
  text = text.replace(/&zwj;/gi, "");
  text = text.replace(/&shy;/gi, "");
  text = text.replace(/&#8203;/g, "");
  text = text.replace(/&#x200[bcd];/gi, "");
  text = text.replace(/&#173;/g, "");
  text = text.replace(/&#65279;/g, ""); // BOM

  // 6. その他のHTMLエンティティ変換
  text = text.replace(/&nbsp;/gi, " ");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&apos;/gi, "'");
  text = text.replace(/&mdash;/gi, "—");
  text = text.replace(/&ndash;/gi, "–");
  text = text.replace(/&hellip;/gi, "…");
  text = text.replace(/&copy;/gi, "©");
  text = text.replace(/&reg;/gi, "®");
  text = text.replace(/&trade;/gi, "™");
  text = text.replace(/&#\d+;/g, ""); // 残りの数値エンティティは除去

  // 7. Unicode ゼロ幅文字・制御文字を直接除去
  text = text.replace(/[\u200B\u200C\u200D\u00AD\uFEFF\u2028\u2029]/g, "");
  // 制御文字（改行・タブ以外）を除去
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // 8. 空白整理（より積極的）
  text = text.replace(/[ \t]+/g, " ");           // 連続スペースを1つに
  text = text.replace(/\n[ \t]+/g, "\n");        // 行頭の空白を除去
  text = text.replace(/[ \t]+\n/g, "\n");        // 行末の空白を除去
  text = text.replace(/^\s*\n/gm, "\n");         // 空白のみの行を空行に
  text = text.replace(/\n{2,}/g, "\n\n");        // 2行以上の連続改行を2行に
  text = text.replace(/^\n+/, "");               // 先頭の改行を除去
  text = text.replace(/\n+$/, "");               // 末尾の改行を除去

  return text.trim();
}

function findMessageBody(part: GmailMessagePart | null | undefined): BodyResult {
  // まず text/plain を探す
  const plain = findBodyPart(part, "text/plain");
  if (plain && plain.replace(/[\s{}]+/g, "").length > 0) {
    return { body: plain, source: "plain" };
  }

  // なければ text/html を探してテキスト化
  const html = findBodyPart(part, "text/html");
  if (html) {
    const extracted = stripHtmlToText(html);
    if (extracted.length > 0) {
      return { body: extracted, source: "html" };
    }
  }

  return null;
}

function createGmailClient() {
  const sharedInboxEmail = mustGetEnv("GOOGLE_SHARED_INBOX_EMAIL");
  const refreshToken = mustGetEnv("GOOGLE_SHARED_INBOX_REFRESH_TOKEN");
  const clientId = mustGetEnv("GOOGLE_CLIENT_ID");
  const clientSecret = mustGetEnv("GOOGLE_CLIENT_SECRET");

  const oauth2Client = new google.auth.OAuth2({
    clientId,
    clientSecret,
  });
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  return { gmail, sharedInboxEmail };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await fn(items[current]);
    }
  });

  await Promise.all(workers);
  return results;
}

export type ListMessagesOptions = {
  max?: number;
  q?: string;
  labelIds?: string[]; // デフォルト: ["INBOX"]
  statusType?: "todo" | "waiting" | "done"; // Status用ショートカット
};

export async function listLatestInboxMessages(
  options: ListMessagesOptions = {},
): Promise<InboxListMessage[]> {
  const { max = 20, q, statusType } = options;
  let { labelIds } = options;

  // statusType が指定されていれば labelIds を自動設定
  if (statusType === "waiting") {
    const waitingId = await ensureLabelId(MAILHUB_LABEL_WAITING);
    labelIds = waitingId ? [waitingId] : [];
  } else if (statusType === "done") {
    const doneId = await ensureLabelId(MAILHUB_LABEL_DONE);
    labelIds = doneId ? [doneId] : [];
  } else if (!labelIds) {
    labelIds = ["INBOX"]; // デフォルト: Todo
  }

  // テストモード: fixtureから返す（メモリ上の状態を反映）
  if (isTestMode()) {
    const all = messagesFixture as InboxListMessage[];
    // qがあればフィルタ（簡易マッチ）
    // ただし、pinnedメッセージは常に含める（QA Gate: msg-021を確実に表示）
    let filtered = q
      ? all.filter(
          (m) =>
            m.pinned === true || // pinnedは常に含める
            m.subject?.toLowerCase().includes(q.toLowerCase()) ||
            m.from?.toLowerCase().includes(q.toLowerCase()) ||
            // StoreA/B/Cチャンネルの場合、楽天メールも含める（テスト用）
            (q.includes("store-a") && (m.from?.includes("rakuten") || m.subject?.includes("楽天"))) ||
            (q.includes("store-b") && (m.from?.includes("rakuten") || m.subject?.includes("楽天"))) ||
            (q.includes("store-c") && (m.from?.includes("rakuten") || m.subject?.includes("楽天"))),
        )
      : all;
    // statusType でフィルタ（メモリ上の状態に基づく）
    const targetStatus = statusType ?? "todo";
    filtered = filtered.filter((m) => getTestStatus(m.id) === targetStatus);
    // pinned: true を先頭にソート（QA Gate: msg-021を確実に表示）
    filtered.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return 0;
    });
    return filtered.slice(0, max);
  }

  const { gmail, sharedInboxEmail } = createGmailClient();

  // Cache: 10s by (sharedInboxEmail + max + q + labelIds)
  const labelKey = labelIds.join(",");
  const listCacheKey = `list:${sharedInboxEmail}:max=${max}:q=${q ?? ""}:labels=${labelKey}`;
  const cachedList = getCached(getCache().list, listCacheKey);
  if (cachedList) return cachedList;

  const listRes = await gmail.users.messages.list({
    userId: sharedInboxEmail,
    labelIds,
    maxResults: max,
    includeSpamTrash: false,
    q,
  });

  const messages = (listRes.data.messages ?? [])
    .map((m) => ({ id: m.id ?? null, threadId: m.threadId ?? null }))
    .filter((m): m is { id: string; threadId: string } => Boolean(m.id && m.threadId));

  if (messages.length === 0) return [];

  const items = await mapWithConcurrency(messages, 5, async (m) => {
    const msgRes = await gmail.users.messages.get({
      userId: sharedInboxEmail,
      id: m.id,
      format: "metadata",
      metadataHeaders: ["Subject", "From", "Date", "Message-ID"],
    });

    const headers = msgRes.data.payload?.headers ?? undefined;
    const internalDateMs = msgRes.data.internalDate
      ? Number(msgRes.data.internalDate)
      : Date.now();

    const messageId = normalizeMessageId(headerValue(headers, "Message-ID"));

    return {
      id: m.id,
      threadId: m.threadId,
      subject: headerValue(headers, "Subject"),
      from: headerValue(headers, "From"),
      messageId,
      receivedAt: formatReceivedAt(internalDateMs),
      snippet: msgRes.data.snippet ?? "",
      gmailLink: buildGmailLink(sharedInboxEmail, messageId, m.threadId),
    } satisfies InboxListMessage;
  });

  // Do not cache errors; we only set cache on success.
  setCached(getCache().list, listCacheKey, items, 10_000);
  return items;
}

export async function getMessageDetail(id: string): Promise<MessageDetail> {
  // テストモード: fixtureから返す
  if (isTestMode()) {
    const mock = await getMockDetail(id);
    if (mock) return mock;
    // 見つからない場合はエラー
    throw new Error(`[TEST MODE] Detail not found for id: ${id}`);
  }

  const { gmail, sharedInboxEmail } = createGmailClient();

  // Cache: 60s by (sharedInboxEmail + id)
  const detailCacheKey = `detail:${sharedInboxEmail}:id=${id}`;
  const cachedDetail = getCached(getCache().detail, detailCacheKey);
  if (cachedDetail) return cachedDetail;

  const msgRes = await gmail.users.messages.get({
    userId: sharedInboxEmail,
    id,
    format: "full",
  });

  const threadId = msgRes.data.threadId ?? "";
  const headers = msgRes.data.payload?.headers ?? undefined;
  const internalDateMs = msgRes.data.internalDate
    ? Number(msgRes.data.internalDate)
    : Date.now();

  const messageId = normalizeMessageId(headerValue(headers, "Message-ID"));

  const bodyResult = findMessageBody(
    (msgRes.data.payload as GmailMessagePart | undefined) ?? undefined,
  );

  const plainTextBody = bodyResult?.body ?? null;
  const bodyNotice = (() => {
    if (!bodyResult) {
      return "本文を取得できませんでした。Open in Gmail ↗で確認してください。";
    }
    if (bodyResult.source === "html") {
      return "（HTMLから抽出）";
    }
    return null;
  })();

  const isInProgress = isTestMode()
    ? getTestClaimedStatus().has(id)
    : msgRes.data.labelIds?.includes(
        (await ensureLabelId(MAILHUB_LABEL_IN_PROGRESS)) ?? ""
      ) ?? false;

  const detail: MessageDetail & { isInProgress: boolean } = {
    id,
    threadId,
    subject: headerValue(headers, "Subject"),
    from: headerValue(headers, "From"),
    messageId,
    receivedAt: formatReceivedAt(internalDateMs),
    snippet: msgRes.data.snippet ?? "",
    gmailLink: buildGmailLink(sharedInboxEmail, messageId, threadId || id),
    plainTextBody,
    bodyNotice,
    isInProgress,
  };
  // Do not cache errors; we only set cache on success.
  setCached(getCache().detail, detailCacheKey, detail as any, 60_000);
  return detail;
}

// Step 1互換（最新1件だけ欲しいケース用）
export async function getLatestInboxMessage(): Promise<InboxListMessage | null> {
  const list = await listLatestInboxMessages({ max: 1 });
  return list[0] ?? null;
}

/**
 * メールをアーカイブ（INBOXラベルを外す + Doneラベル付ける + Waitingラベル外す）
 */
export async function archiveMessage(id: string): Promise<void> {
  // テストモードでは状態を更新
  if (isTestMode()) {
    console.log(`[TEST MODE] archiveMessage: ${id}`);
    setTestStatus(id, "done");
    return;
  }

  const { gmail, sharedInboxEmail } = createGmailClient();
  const doneId = await ensureLabelId(MAILHUB_LABEL_DONE);
  const waitingId = await ensureLabelId(MAILHUB_LABEL_WAITING);

  const removeLabels = ["INBOX"];
  if (waitingId) removeLabels.push(waitingId);
  
  await gmail.users.messages.modify({
    userId: sharedInboxEmail,
    id,
    requestBody: {
      addLabelIds: doneId ? [doneId] : undefined,
      removeLabelIds: removeLabels,
    },
  });

  // キャッシュをクリア（一覧が変わるため）
  getCache().list.clear();
  getCache().detail.delete(`detail:${sharedInboxEmail}:id=${id}`);
}

/**
 * アーカイブを取り消し（INBOXラベルを戻す + Done/Waitingラベルを外す）
 */
export async function unarchiveMessage(id: string): Promise<void> {
  // テストモードでは状態を更新
  if (isTestMode()) {
    console.log(`[TEST MODE] unarchiveMessage: ${id}`);
    setTestStatus(id, "todo");
    return;
  }

  const { gmail, sharedInboxEmail } = createGmailClient();
  
  // Done/Waitingラベルを外す
  const removeLabels: string[] = [];
  const doneId = await ensureLabelId(MAILHUB_LABEL_DONE);
  const waitingId = await ensureLabelId(MAILHUB_LABEL_WAITING);
  if (doneId) removeLabels.push(doneId);
  if (waitingId) removeLabels.push(waitingId);
  
  await gmail.users.messages.modify({
    userId: sharedInboxEmail,
    id,
    requestBody: {
      addLabelIds: ["INBOX"],
      removeLabelIds: removeLabels.length > 0 ? removeLabels : undefined,
    },
  });

  // キャッシュをクリア
  getCache().list.clear();
}

/**
 * InProgressラベルをトグル
 */
export async function toggleInProgress(id: string): Promise<boolean> {
  if (isTestMode()) {
    const claimed = getTestClaimedStatus();
    if (claimed.has(id)) {
      claimed.delete(id);
      return false;
    } else {
      claimed.add(id);
      return true;
    }
  }

  const { gmail, sharedInboxEmail } = createGmailClient();
  const inProgressId = await ensureLabelId(MAILHUB_LABEL_IN_PROGRESS);
  if (!inProgressId) throw new Error("Could not ensure InProgress label");

  const msgRes = await gmail.users.messages.get({
    userId: sharedInboxEmail,
    id,
    format: "metadata",
    metadataHeaders: [],
  });

  const currentlyHas = msgRes.data.labelIds?.includes(inProgressId) ?? false;

  await gmail.users.messages.modify({
    userId: sharedInboxEmail,
    id,
    requestBody: {
      addLabelIds: currentlyHas ? undefined : [inProgressId],
      removeLabelIds: currentlyHas ? [inProgressId] : undefined,
    },
  });

  getCache().detail.delete(`detail:${sharedInboxEmail}:id=${id}`);
  return !currentlyHas;
}

/**
 * ラベルを名前で取得、無ければ作成
 */
export async function ensureLabelId(labelName: string): Promise<string | null> {
  // テストモードではダミーID
  if (isTestMode()) {
    return `test-label-${labelName.replace(/\//g, "-")}`;
  }

  // キャッシュチェック
  const cached = getCache().labels.get(labelName);
  if (cached) return cached;

  const { gmail, sharedInboxEmail } = createGmailClient();

  // まず既存ラベルを探す
  const listRes = await gmail.users.labels.list({ userId: sharedInboxEmail });
  const existing = listRes.data.labels?.find((l) => l.name === labelName);
  if (existing?.id) {
    getCache().labels.set(labelName, existing.id);
    return existing.id;
  }

  // 無ければ作成
  const createRes = await gmail.users.labels.create({
    userId: sharedInboxEmail,
    requestBody: {
      name: labelName,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });
  const newId = createRes.data.id;
  if (newId) {
    getCache().labels.set(labelName, newId);
    return newId;
  }

  return null;
}

/**
 * メールをWaitingに設定（INBOX外す + Waitingラベル付ける）
 */
export async function setWaiting(id: string): Promise<void> {
  if (isTestMode()) {
    console.log(`[TEST MODE] setWaiting: ${id}`);
    setTestStatus(id, "waiting");
    return;
  }

  const { gmail, sharedInboxEmail } = createGmailClient();
  const waitingId = await ensureLabelId(MAILHUB_LABEL_WAITING);
  const doneId = await ensureLabelId(MAILHUB_LABEL_DONE);

  const removeLabels = ["INBOX"];
  if (doneId) removeLabels.push(doneId);

  await gmail.users.messages.modify({
    userId: sharedInboxEmail,
    id,
    requestBody: {
      addLabelIds: waitingId ? [waitingId] : undefined,
      removeLabelIds: removeLabels,
    },
  });

  getCache().list.clear();
}

/**
 * WaitingからTodoに戻す（INBOX付ける + Waitingラベル外す）
 */
export async function unsetWaiting(id: string): Promise<void> {
  if (isTestMode()) {
    console.log(`[TEST MODE] unsetWaiting: ${id}`);
    setTestStatus(id, "todo");
    return;
  }

  const { gmail, sharedInboxEmail } = createGmailClient();
  const waitingId = await ensureLabelId(MAILHUB_LABEL_WAITING);

  await gmail.users.messages.modify({
    userId: sharedInboxEmail,
    id,
    requestBody: {
      addLabelIds: ["INBOX"],
      removeLabelIds: waitingId ? [waitingId] : undefined,
    },
  });

  getCache().list.clear();
}

/**
 * Waiting/DoneラベルのIDを取得（一覧取得用）
 */
export async function getStatusLabelIds(): Promise<{
  waitingLabelId: string | null;
  doneLabelId: string | null;
}> {
  const waitingLabelId = await ensureLabelId(MAILHUB_LABEL_WAITING);
  const doneLabelId = await ensureLabelId(MAILHUB_LABEL_DONE);
  return { waitingLabelId, doneLabelId };
}

/**
 * 各ステータスのメッセージ件数を取得
 */
export async function getMessageCounts(): Promise<{
  todo: number;
  waiting: number;
  done: number;
}> {
  // テストモード: メモリ上の状態からカウント
  if (isTestMode()) {
    const all = messagesFixture as InboxListMessage[];
    let todo = 0;
    let waiting = 0;
    let done = 0;
    for (const m of all) {
      const status = getTestStatus(m.id);
      if (status === "waiting") waiting++;
      else if (status === "done") done++;
      else todo++;
    }
    return { todo, waiting, done };
  }

  const { gmail, sharedInboxEmail } = createGmailClient();
  const waitingId = await ensureLabelId(MAILHUB_LABEL_WAITING);
  const doneId = await ensureLabelId(MAILHUB_LABEL_DONE);

  // 並列でカウントを取得
  const [todoRes, waitingRes, doneRes] = await Promise.all([
    gmail.users.messages.list({
      userId: sharedInboxEmail,
      labelIds: ["INBOX"],
      maxResults: 1,
      includeSpamTrash: false,
    }),
    waitingId
      ? gmail.users.messages.list({
          userId: sharedInboxEmail,
          labelIds: [waitingId],
          maxResults: 1,
          includeSpamTrash: false,
        })
      : Promise.resolve({ data: { resultSizeEstimate: 0 } }),
    doneId
      ? gmail.users.messages.list({
          userId: sharedInboxEmail,
          labelIds: [doneId],
          maxResults: 1,
          includeSpamTrash: false,
        })
      : Promise.resolve({ data: { resultSizeEstimate: 0 } }),
  ]);

  return {
    todo: todoRes.data.resultSizeEstimate ?? 0,
    waiting: waitingRes.data.resultSizeEstimate ?? 0,
    done: doneRes.data.resultSizeEstimate ?? 0,
  };
}


