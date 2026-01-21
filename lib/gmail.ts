import "server-only";

import { google } from "googleapis";
import { mustGetEnv } from "@/lib/env";
import { isTestMode } from "@/lib/test-mode";
import type { InboxListMessage, MessageDetail } from "@/lib/mailhub-types";
import messagesFixture from "@/fixtures/messages.json";
import { assigneeSlug } from "@/lib/assignee";
import { getLabelRegistryStore } from "@/lib/labelRegistryStore";
import { extractFromEmail } from "@/lib/labelRules";
import { MAILHUB_USER_LABEL_PREFIX } from "@/lib/mailhub-labels";
import type { ThreadMessageSummary } from "@/lib/thread";
import { extractMailhubUserLabels, receivedAtToMs, statusTypeFromLabelNames } from "@/lib/thread";

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
      htmlBody: null,
      bodySource: "plain" as const,
      bodyNotice: null,
    };
  }
}

type CacheEntry<T> = { value: T; expiresAt: number };

// テストモード用: メールのStatus状態を保持
type TestMessageStatus = "todo" | "waiting" | "done" | "muted" | "snoozed";

declare global {
  // eslint-disable-next-line no-var
  var __mailhubGmailCache:
    | {
        list: Map<string, CacheEntry<InboxListMessage[]>>;
        detail: Map<string, CacheEntry<MessageDetail>>;
        thread: Map<string, CacheEntry<{ threadId: string; messages: ThreadMessageSummary[] }>>;
        labels: Map<string, unknown>; // labelName -> labelId (string) ほか、内部キャッシュも保持
      }
    | undefined;
  // eslint-disable-next-line no-var
  var __mailhubTestMessageStatus: Map<string, TestMessageStatus> | undefined;
  // eslint-disable-next-line no-var
  var __mailhubTestFailConfig: { endpoint: string; ids: Set<string> } | undefined;
  // eslint-disable-next-line no-var
  var __mailhubTestUserLabels: Map<string, Set<string>> | undefined;
  // eslint-disable-next-line no-var
  var __mailhubTestActionDelayMs: number | undefined;
}

function getCache() {
  if (!globalThis.__mailhubGmailCache) {
    globalThis.__mailhubGmailCache = {
      list: new Map(),
      detail: new Map(),
      thread: new Map(),
      labels: new Map(),
    };
  }
  return globalThis.__mailhubGmailCache;
}

function clearAllMessageCaches() {
  getCache().list.clear();
  getCache().detail.clear();
  getCache().thread.clear();
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

function getTestUserLabels(): Map<string, Set<string>> {
  if (!globalThis.__mailhubTestUserLabels) {
    globalThis.__mailhubTestUserLabels = new Map();
  }
  return globalThis.__mailhubTestUserLabels;
}

/**
 * TEST_MODE用: 指定メッセージに付いているユーザーラベル（ラベル名）を返す。
 * - 自動付与の冪等スキップ判定に使用
 */
export function getTestUserLabelNames(id: string): string[] {
  if (!isTestMode()) return [];
  const set = getTestUserLabels().get(id);
  return set ? [...set] : [];
}

function isInternalLabelName(labelName: string): boolean {
  // ここはMailHub内部の状態ラベル/担当ラベルをUIの「ユーザーラベル」に混ぜないためのガード
  if (labelName.startsWith(MAILHUB_USER_LABEL_PREFIX)) return false;
  if (labelName.startsWith("MailHub/")) return true;
  return false;
}

async function getRegisteredLabelNameSet(): Promise<Set<string>> {
  const labels = await getLabelRegistryStore().list();
  return new Set(labels.map((l) => l.labelName));
}

function filterUserLabels(labelNames: string[], registered: Set<string>): string[] {
  const out: string[] = [];
  for (const name of labelNames) {
    if (!registered.has(name)) continue;
    if (isInternalLabelName(name)) continue;
    out.push(name);
  }
  return out;
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
export const MAILHUB_LABEL_MUTED = "MailHub/Muted";
export const MAILHUB_LABEL_SNOOZED = "MailHub/Snoozed";
export const MAILHUB_LABEL_SNOOZE_DATE_PREFIX = "MailHub/Snooze/";
export const MAILHUB_LABEL_ASSIGNEE_PREFIX = "MailHub/Assignee/";

function invalidateLabelsMapCache() {
  // NOTE: labelsMapはTTLキャッシュ（5分）だが、担当ラベル作成/更新直後に古いMapが残ると
  // 「labelIdsはあるのにlabelNamesに出ない」(=パターンB) が起きるため、ここで確実に破棄する。
  // 現状 getCache().labels を labelName->labelId と labelsMapキャッシュの両方に使っているため、
  // ここでは labelsMap のキーだけを狙って消す。
  getCache().labels.delete("labelsMap");
}

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

type BodyResult = { body: string; source: "plain" | "html"; rawHtml: string | null } | null;

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
  // HTMLも取得しておく（プレーンテキストがあってもHTMLを返す）
  const html = findBodyPart(part, "text/html");
  
  // まず text/plain を探す
  const plain = findBodyPart(part, "text/plain");
  if (plain && plain.replace(/[\s{}]+/g, "").length > 0) {
    return { body: plain, source: "plain", rawHtml: html };
  }

  // なければ text/html を探してテキスト化
  if (html) {
    const extracted = stripHtmlToText(html);
    if (extracted.length > 0) {
      return { body: extracted, source: "html", rawHtml: html };
    }
  }

  return null;
}

function createOAuth2Client() {
  const sharedInboxEmail = mustGetEnv("GOOGLE_SHARED_INBOX_EMAIL");
  const refreshToken = mustGetEnv("GOOGLE_SHARED_INBOX_REFRESH_TOKEN");
  const clientId = mustGetEnv("GOOGLE_CLIENT_ID");
  const clientSecret = mustGetEnv("GOOGLE_CLIENT_SECRET");

  const oauth2Client = new google.auth.OAuth2({
    clientId,
    clientSecret,
  });
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return { oauth2Client, sharedInboxEmail };
}

function createGmailClient() {
  const { oauth2Client, sharedInboxEmail } = createOAuth2Client();

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  return { gmail, sharedInboxEmail };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timeout:${label}`)), ms),
    ),
  ]);
}

export type GmailScopeInfo =
  | { ok: true; scopes: string[]; gmailModifyEnabled: boolean }
  | { ok: false; error: string };

/**
 * refresh token の実際のスコープを推定（tokeninfo）
 * - 実データWRITE失敗の原因切り分け用（readonly token だと全部 403 になる）
 */
export async function getGmailScopeInfo(): Promise<GmailScopeInfo> {
  if (isTestMode()) {
    return { ok: true, scopes: ["TEST_MODE"], gmailModifyEnabled: true };
  }

  try {
    const { oauth2Client } = createOAuth2Client();
    const access = await withTimeout(oauth2Client.getAccessToken(), 2500, "gmail_get_access_token");
    const token =
      typeof access === "string"
        ? access
        : access && typeof access === "object" && "token" in access
          ? (access as { token?: string | null }).token ?? null
          : null;
    if (!token) return { ok: false, error: "missing_access_token" };

    const oauth2 = google.oauth2({ version: "v2" });
    const info = await withTimeout(oauth2.tokeninfo({ access_token: token }), 2500, "gmail_tokeninfo");
    const scopeStr = info.data && typeof info.data.scope === "string" ? info.data.scope : "";
    const scopes = scopeStr.split(" ").map((s) => s.trim()).filter(Boolean);
    const gmailModifyEnabled = scopes.includes("https://www.googleapis.com/auth/gmail.modify") || scopes.includes("https://mail.google.com/");
    return { ok: true, scopes, gmailModifyEnabled };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function waitForMessageLabelState(
  gmail: ReturnType<typeof google.gmail>,
  userId: string,
  messageId: string,
  opts: { mustHaveIds?: string[]; mustNotHaveIds?: string[]; attempts?: number; intervalMs?: number },
): Promise<boolean> {
  const mustHave = (opts.mustHaveIds ?? []).filter(Boolean);
  const mustNotHave = (opts.mustNotHaveIds ?? []).filter(Boolean);
  const attempts = Math.max(1, opts.attempts ?? 6);
  const intervalMs = Math.max(50, opts.intervalMs ?? 250);
  if (mustHave.length === 0 && mustNotHave.length === 0) return true;

  for (let i = 0; i < attempts; i++) {
    try {
      const meta = await gmail.users.messages.get({
        userId,
        id: messageId,
        format: "metadata",
        metadataHeaders: [],
      });
      const labelIds = meta.data.labelIds ?? [];
      const hasAll = mustHave.every((id) => labelIds.includes(id));
      const hasNone = mustNotHave.every((id) => !labelIds.includes(id));
      if (hasAll && hasNone) return true;
    } catch {
      // best-effort（反映待ちの補助なので握りつぶす）
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return false;
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
  statusType?: "todo" | "waiting" | "done" | "muted" | "snoozed"; // Status用ショートカット
  assigneeSlug?: string; // 担当者でフィルタリング（担当ラベルIDを自動取得）
  unassigned?: boolean; // 未割当のみを返す（assigneeSlug==nullのものだけ）
  pageToken?: string; // Step 103: ページング用トークン
};

export type ListMessagesResult = {
  messages: InboxListMessage[];
  nextPageToken?: string; // Step 103: 次ページがあればトークンを返す
};

export async function listLatestInboxMessages(
  options: ListMessagesOptions = {},
): Promise<ListMessagesResult> {
  const { max = 20, q, statusType, assigneeSlug: assigneeSlugParam, unassigned, pageToken } = options;
  let { labelIds } = options;

  // assigneeSlugが指定されている場合、担当ラベルIDを取得
  let assigneeLabelId: string | null = null;
  if (assigneeSlugParam) {
    // assigneeSlugからラベル名を構築してIDを取得
    const labelName = `${MAILHUB_LABEL_ASSIGNEE_PREFIX}${assigneeSlugParam}`;
    assigneeLabelId = await ensureLabelId(labelName);
  }

  // assigneeSlugが指定されている場合、担当ラベルのみでフィルタリング（保留/完了なども含む）
  if (assigneeLabelId) {
    labelIds = [assigneeLabelId];
  } else {
    // statusType が指定されていれば labelIds を自動設定
    if (statusType === "waiting") {
      const waitingId = await ensureLabelId(MAILHUB_LABEL_WAITING);
      labelIds = waitingId ? [waitingId] : [];
    } else if (statusType === "done") {
      const doneId = await ensureLabelId(MAILHUB_LABEL_DONE);
      labelIds = doneId ? [doneId] : [];
    } else if (statusType === "muted") {
      const mutedId = await ensureLabelId(MAILHUB_LABEL_MUTED);
      labelIds = mutedId ? [mutedId] : [];
    } else if (statusType === "snoozed") {
      const snoozedId = await ensureLabelId(MAILHUB_LABEL_SNOOZED);
      labelIds = snoozedId ? [snoozedId] : [];
    } else if (!labelIds) {
      labelIds = ["INBOX"]; // デフォルト: Todo
    }
  }

  // テストモード: fixtureから返す（メモリ上の状態を反映）
  if (isTestMode()) {
    const registered = await getRegisteredLabelNameSet();
    const all = messagesFixture as InboxListMessage[];
    const testAssigneeMap = getTestAssigneeMap();
    // Step 51: qがあればフィルタ（Gmail検索式を簡易パース）
    // ただし、pinnedメッセージは常に含める（QA Gate: msg-021を確実に表示）
    let filtered = q
      ? all.filter((m) => {
          if (m.pinned === true) return true; // pinnedは常に含める
          
          // Step 51: Gmail検索式を簡易パース（テストモード用）
          // subject:"..." 形式を抽出
          const subjectMatch = q.match(/subject:\s*"([^"]+)"/i) || q.match(/subject:\s*([^\s]+)/i);
          if (subjectMatch) {
            const subjectQuery = subjectMatch[1].toLowerCase();
            return m.subject?.toLowerCase().includes(subjectQuery) ?? false;
          }
          
          // from:"..." 形式を抽出
          const fromMatch = q.match(/from:\s*"([^"]+)"/i) || q.match(/from:\s*([^\s]+)/i);
          if (fromMatch) {
            const fromQuery = fromMatch[1].toLowerCase();
            return m.from?.toLowerCase().includes(fromQuery) ?? false;
          }
          
          // 通常の文字列マッチ（後方互換）
          const lowerQ = q.toLowerCase();
          return (
            m.subject?.toLowerCase().includes(lowerQ) ||
            m.from?.toLowerCase().includes(lowerQ) ||
            m.snippet?.toLowerCase().includes(lowerQ) ||
            // StoreA/B/Cチャンネルの場合、楽天メールも含める（テスト用）
            (q.includes("store-a") && (m.from?.includes("rakuten") || m.subject?.includes("楽天"))) ||
            (q.includes("store-b") && (m.from?.includes("rakuten") || m.subject?.includes("楽天"))) ||
            (q.includes("store-c") && (m.from?.includes("rakuten") || m.subject?.includes("楽天")))
          );
        })
      : all;
    // statusType でフィルタ（メモリ上の状態に基づく）
    // NOTE: assigneeSlug/unassigned でフィルタする場合は、担当ラベルのみで一覧を出したい
    // （受信箱→担当→保留→担当 で「担当0件」にならないようにする）
    // statusTypeがundefinedの場合はフィルタリングしない（全メールを表示）
    const shouldIgnoreStatusForAssigneeView = Boolean(assigneeSlugParam || unassigned);
    if (statusType !== undefined && !shouldIgnoreStatusForAssigneeView) {
      filtered = filtered.filter((m) => getTestStatus(m.id) === statusType);
    }
    // assigneeSlugでフィルタ（担当タブ用）
    if (assigneeSlugParam) {
      filtered = filtered.filter((m) => testAssigneeMap.get(m.id) === assigneeSlugParam);
    }
    // pinned: true を先頭にソート（QA Gate: msg-021を確実に表示）
    filtered.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return 0;
    });
    // assigneeSlugとsnoozeUntilを追加
    let result = filtered.slice(0, max).map((m) => ({
      ...m,
      assigneeSlug: testAssigneeMap.get(m.id) || null,
      snoozeUntil: m.snoozeUntil || undefined,
      userLabels: (() => {
        const set = getTestUserLabels().get(m.id);
        if (!set || set.size === 0) return undefined;
        return filterUserLabels([...set], registered);
      })(),
    }));
    
    // unassignedフィルタ（assigneeSlug==nullのものだけ）
    if (unassigned) {
      result = result.filter((m) => m.assigneeSlug === null);
    }
    
    // Step 103: テストモードではpageTokenはサポートせずシンプルに返す（fixtureは20件以下想定）
    return { messages: result, nextPageToken: undefined };
  }

  const { gmail, sharedInboxEmail } = createGmailClient();

  // Cache: 10s by (sharedInboxEmail + max + q + labelIds + pageToken)
  // Step 103: pageTokenがある場合はキャッシュをスキップ（ページごとに異なる結果）
  const labelKey = labelIds.join(",");
  const listCacheKey = `list:${sharedInboxEmail}:max=${max}:q=${q ?? ""}:labels=${labelKey}`;
  if (!pageToken) {
    const cachedList = getCached<InboxListMessage[]>(getCache().list, listCacheKey);
    if (cachedList) return { messages: cachedList, nextPageToken: undefined };
  }

  // NOTE: Gmailのラベル付け直後は messages.list 側に反映が遅れることがあり、
  // 「担当を付けた直後に担当一覧が0件」のような体験になる。assigneeSlug指定時は短時間だけリトライする。
  const listOnce = async () =>
    await gmail.users.messages.list({
      userId: sharedInboxEmail,
      labelIds,
      maxResults: max,
      includeSpamTrash: false,
      q,
      pageToken: pageToken || undefined, // Step 103: ページトークン
    });

  let listRes = await listOnce();
  if (assigneeSlugParam && (listRes.data.messages?.length ?? 0) === 0) {
    for (let attempt = 0; attempt < 3; attempt++) {
      await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt)));
      listRes = await listOnce();
      if ((listRes.data.messages?.length ?? 0) > 0) break;
    }
  }

  // Step 103: 次ページトークンを取得
  const nextPageToken = listRes.data.nextPageToken ?? undefined;

  const messages = (listRes.data.messages ?? [])
    .map((m) => {
      const id = m.id ?? null;
      return { id, threadId: (m.threadId ?? id) ?? null };
    })
    .filter((m): m is { id: string; threadId: string } => Boolean(m.id && m.threadId));

  if (messages.length === 0) return { messages: [], nextPageToken };

  // ラベルマップを取得（担当者判定用）
  // NOTE: message.labelIds に未知のIDが混ざる（=labelsMapが古い）ケースがあるため、必要なら1回だけ強制更新する
  let labelsMap = await listLabelsMap();
  let refreshLabelsMapP: Promise<typeof labelsMap> | null = null;
  const getLabelsMapFresh = async () => {
    if (!refreshLabelsMapP) {
      refreshLabelsMapP = listLabelsMap({ force: true }).then((m) => {
        labelsMap = m;
        return m;
      });
    }
    return refreshLabelsMapP;
  };

  const registered = await getRegisteredLabelNameSet();

  let items = await mapWithConcurrency(messages, 5, async (m) => {
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

    // 担当者を取得
    const labelIds = msgRes.data.labelIds || [];
    let mapToUse = labelsMap;
    if (labelIds.some((id) => !mapToUse.idToName.has(id))) {
      mapToUse = await getLabelsMapFresh();
    }
    const assignee = getAssigneeFromLabelIds(labelIds, mapToUse.idToName);
    const labelNames = labelIds
      .map((lid) => mapToUse.idToName.get(lid) ?? null)
      .filter((v): v is string => Boolean(v));
    const userLabels = filterUserLabels(labelNames, registered);

    // Snooze期限を抽出
    const snoozeUntil = getSnoozeUntilFromLabels(labelIds, mapToUse.idToName);

    return {
      id: m.id,
      threadId: m.threadId,
      subject: headerValue(headers, "Subject"),
      from: headerValue(headers, "From"),
      messageId,
      receivedAt: formatReceivedAt(internalDateMs),
      snippet: msgRes.data.snippet ?? "",
      gmailLink: buildGmailLink(sharedInboxEmail, messageId, m.threadId),
      isUnread: labelIds.includes("UNREAD"),
      isStarred: labelIds.includes("STARRED"),
      assigneeSlug: assignee?.slug || null,
      userLabels: userLabels.length ? userLabels : undefined,
      snoozeUntil: snoozeUntil || undefined,
    } satisfies InboxListMessage;
  });

  // unassignedフィルタ（assigneeSlug==nullのものだけ）
  if (unassigned) {
    items = items.filter((m) => m.assigneeSlug === null);
  }

  // Do not cache errors; we only set cache on success.
  // Step 103: キャッシュはメッセージのみ（nextPageTokenはキャッシュしない）
  setCached(getCache().list, listCacheKey, items, 10_000);
  return { messages: items, nextPageToken };
}

export async function getMessageDetail(id: string): Promise<MessageDetail> {
  // テストモード: fixtureから返す
  if (isTestMode()) {
    const mock = await getMockDetail(id);
    if (mock) {
      const registered = await getRegisteredLabelNameSet();
      const set = getTestUserLabels().get(id);
      const fallbackThreadId =
        (messagesFixture as InboxListMessage[]).find((m) => m.id === id)?.threadId ?? id;
      return {
        ...mock,
        threadId: mock.threadId || fallbackThreadId,
        assigneeSlug: getTestAssigneeMap().get(id) || null,
        snoozeUntil: mock.snoozeUntil || undefined,
        userLabels: set && set.size > 0 ? filterUserLabels([...set], registered) : undefined,
      };
    }
    // 見つからない場合はエラー
    throw new Error(`[TEST MODE] Detail not found for id: ${id}`);
  }

  const { gmail, sharedInboxEmail } = createGmailClient();

  // Cache: 60s by (sharedInboxEmail + id)
  const detailCacheKey = `detail:${sharedInboxEmail}:id=${id}`;
  const cachedDetail = getCached(getCache().detail, detailCacheKey);
  if (cachedDetail) return cachedDetail;

  try {
    const msgRes = await gmail.users.messages.get({
      userId: sharedInboxEmail,
      id,
      format: "full",
    });

    const threadId = msgRes.data.threadId ?? id;
    const headers = msgRes.data.payload?.headers ?? undefined;
    const internalDateMs = msgRes.data.internalDate
      ? Number(msgRes.data.internalDate)
      : Date.now();

    const messageId = normalizeMessageId(headerValue(headers, "Message-ID"));

    const bodyResult = findMessageBody(
      (msgRes.data.payload as GmailMessagePart | undefined) ?? undefined,
    );

    const plainTextBody = bodyResult?.body ?? null;
    const htmlBody = bodyResult?.rawHtml ?? null;
    const bodySource = bodyResult?.source ?? null;
    const bodyNotice = (() => {
      if (!bodyResult) {
        return "本文を取得できませんでした。Open in Gmail ↗で確認してください。";
      }
      // HTMLがある場合は通知なし（HTMLを表示するため）
      if (bodyResult.rawHtml) {
        return null;
      }
      return null;
    })();

    const isInProgress = isTestMode()
      ? getTestClaimedStatus().has(id)
      : msgRes.data.labelIds?.includes(
          (await ensureLabelId(MAILHUB_LABEL_IN_PROGRESS)) ?? ""
        ) ?? false;

    // 担当者を取得
    const labelIds = msgRes.data.labelIds || [];
    let labelsMap = await listLabelsMap();
    if (labelIds.some((lid) => !labelsMap.idToName.has(lid))) {
      labelsMap = await listLabelsMap({ force: true });
    }
    const assignee = getAssigneeFromLabelIds(labelIds, labelsMap.idToName);
    const assigneeSlugValue = isTestMode()
      ? getTestAssigneeMap().get(id) || null
      : assignee?.slug || null;

    const registered = await getRegisteredLabelNameSet();
    const labelNames = labelIds
      .map((lid) => labelsMap.idToName.get(lid) ?? null)
      .filter((v): v is string => Boolean(v));
    const userLabels = filterUserLabels(labelNames, registered);

    // Snooze期限を抽出
    const snoozeUntil = getSnoozeUntilFromLabels(labelIds, labelsMap.idToName);

    const detail: MessageDetail & { isInProgress: boolean; assigneeSlug: string | null } = {
      id,
      threadId,
      subject: headerValue(headers, "Subject"),
      from: headerValue(headers, "From"),
      messageId,
      receivedAt: formatReceivedAt(internalDateMs),
      snippet: msgRes.data.snippet ?? "",
      gmailLink: buildGmailLink(sharedInboxEmail, messageId, threadId || id),
      plainTextBody,
      htmlBody,
      bodySource,
      bodyNotice,
      isInProgress,
      assigneeSlug: assigneeSlugValue,
      userLabels: userLabels.length ? userLabels : undefined,
      snoozeUntil: snoozeUntil || undefined,
    };

    // dev限定: 「ラベルが消えているのか？」を判定するための可視化情報
    if (process.env.NODE_ENV !== "production") {
      (detail as MessageDetail & { debugLabels?: { labelIds: string[]; labelNames: Array<string | null> } }).debugLabels = {
        labelIds,
        labelNames: labelIds.map((lid) => labelsMap.idToName.get(lid) ?? null),
      };
    }
    // Do not cache errors; we only set cache on success.
    setCached(getCache().detail, detailCacheKey, detail, 60_000);
    return detail;
  } catch (e: unknown) {
    // Gmail APIエラーの詳細を取得
    let errorMessage = "メール詳細の取得に失敗しました";
    const err = e && typeof e === "object" ? (e as Record<string, unknown>) : {};
    const code = err.code;
    const msg = typeof err.message === "string" ? err.message : "";
    if (code === 404 || msg.includes("404")) {
      errorMessage = "メールが見つかりませんでした";
    } else if (code === 403 || msg.includes("insufficient") || msg.includes("Insufficient")) {
      errorMessage = "Gmail APIの権限が不足しています。管理者に連絡してください。";
    } else if (code === 401 || msg.includes("401")) {
      errorMessage = "認証エラーが発生しました。再ログインしてください。";
    } else if (msg) {
      errorMessage = msg;
    }
    throw new Error(errorMessage);
  }
}

export async function getThreadSummaryByMessageId(
  messageId: string,
): Promise<{ threadId: string; messages: ThreadMessageSummary[] }> {
  // Cache: 15s by messageId (we resolve threadId first)
  const threadCacheKey = `thread:messageId=${messageId}`;
  const cached = getCached(getCache().thread, threadCacheKey);
  if (cached) return cached;

  // TEST_MODE: derive from fixtures + in-memory state maps
  if (isTestMode()) {
    const all = messagesFixture as InboxListMessage[];
    const base = all.find((m) => m.id === messageId);
    if (!base) throw new Error(`[TEST MODE] thread not found for messageId=${messageId}`);
    const threadId = base.threadId || base.id;
    const registered = await getRegisteredLabelNameSet();
    const testAssigneeMap = getTestAssigneeMap();

    const summaries: ThreadMessageSummary[] = all
      .filter((m) => m.threadId === threadId)
      .map((m) => {
        const statusType = getTestStatus(m.id);
        const labelNames = (() => {
          const set = getTestUserLabels().get(m.id);
          if (!set || set.size === 0) return [] as string[];
          return filterUserLabels([...set], registered);
        })();
        return {
          id: m.id,
          threadId,
          subject: m.subject ?? null,
          from: m.from ?? null,
          date: m.receivedAt,
          snippet: m.snippet ?? "",
          statusType,
          assigneeSlug: testAssigneeMap.get(m.id) || null,
          labels: labelNames,
        };
      })
      .sort((a, b) => receivedAtToMs(a.date) - receivedAtToMs(b.date));

    const result = { threadId, messages: summaries };
    setCached(getCache().thread, threadCacheKey, result, 15_000);
    return result;
  }

  const { gmail, sharedInboxEmail } = createGmailClient();

  // Resolve threadId for the given message
  const msgRes = await gmail.users.messages.get({
    userId: sharedInboxEmail,
    id: messageId,
    format: "metadata",
    metadataHeaders: ["Message-ID"],
  });
  const threadId = msgRes.data.threadId ?? messageId;

  // Cache by threadId as well (lets us clear everything cheaply on writes)
  const threadCacheKey2 = `thread:threadId=${threadId}`;
  const cached2 = getCached(getCache().thread, threadCacheKey2);
  if (cached2) {
    // also seed messageId key
    setCached(getCache().thread, threadCacheKey, cached2, 15_000);
    return cached2;
  }

  const tRes = await gmail.users.threads.get({
    userId: sharedInboxEmail,
    id: threadId,
    format: "metadata",
    metadataHeaders: ["Subject", "From", "Date", "Message-ID"],
  });

  const registered = await getRegisteredLabelNameSet();
  let labelsMap = await listLabelsMap();

  const messages = (tRes.data.messages ?? []).map((m) => {
    const id = m.id ?? "";
    const labelIds = m.labelIds ?? [];
    // refresh labelsMap once if needed (unknown label IDs)
    if (labelIds.some((lid) => !labelsMap.idToName.has(lid))) {
      // best-effort refresh; ignore errors
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      listLabelsMap({ force: true }).then((nm) => (labelsMap = nm)).catch(() => {});
    }
    const headerList = (m.payload?.headers ?? []) as Array<{ name?: string; value?: string }>;
    const subject = headerValue(headerList, "Subject");
    const from = headerValue(headerList, "From");
    const internalDateMs = m.internalDate ? Number(m.internalDate) : 0;
    const receivedAt = internalDateMs ? formatReceivedAt(internalDateMs) : "";

    const labelNames = labelIds
      .map((lid) => labelsMap.idToName.get(lid) ?? null)
      .filter((v): v is string => Boolean(v));

    const statusType = statusTypeFromLabelNames(labelNames);
    const assignee = getAssigneeFromLabelIds(labelIds, labelsMap.idToName);
    const userLabels = filterUserLabels(labelNames, registered);

    return {
      id,
      threadId,
      subject,
      from,
      date: receivedAt,
      snippet: m.snippet ?? "",
      statusType,
      assigneeSlug: assignee?.slug ?? null,
      labels: extractMailhubUserLabels(userLabels, 2),
    } satisfies ThreadMessageSummary;
  });

  // stable sort old -> new
  messages.sort((a, b) => receivedAtToMs(a.date) - receivedAtToMs(b.date));

  const result = { threadId, messages };
  setCached(getCache().thread, threadCacheKey2, result, 15_000);
  setCached(getCache().thread, threadCacheKey, result, 15_000);
  return result;
}

// Step 1互換（最新1件だけ欲しいケース用）
export async function getLatestInboxMessage(): Promise<InboxListMessage | null> {
  const { messages } = await listLatestInboxMessages({ max: 1 });
  return messages[0] ?? null;
}

/**
 * ルール適用用: メッセージの From ヘッダから email を抽出する（低コスト: metadata）。
 */
export async function getMessageFromEmail(id: string): Promise<string | null> {
  if (isTestMode()) {
    const msg = (messagesFixture as InboxListMessage[]).find((m) => m.id === id);
    return extractFromEmail(msg?.from ?? null);
  }

  const { gmail, sharedInboxEmail } = createGmailClient();
  const msgRes = await gmail.users.messages.get({
    userId: sharedInboxEmail,
    id,
    format: "metadata",
    metadataHeaders: ["From"],
  });
  const headers = msgRes.data.payload?.headers ?? undefined;
  return extractFromEmail(headerValue(headers, "From"));
}

/**
 * ルール適用用: 低コストで「From」と「現在のlabelIds」を取得する（metadata）。
 */
export async function getMessageMetadataForRules(
  id: string,
): Promise<{ fromEmail: string | null; labelIds: string[] }> {
  if (isTestMode()) {
    return { fromEmail: await getMessageFromEmail(id), labelIds: [] };
  }

  const { gmail, sharedInboxEmail } = createGmailClient();
  const msgRes = await gmail.users.messages.get({
    userId: sharedInboxEmail,
    id,
    format: "metadata",
    metadataHeaders: ["From"],
  });
  const headers = msgRes.data.payload?.headers ?? undefined;
  const fromEmail = extractFromEmail(headerValue(headers, "From"));
  const labelIds = Array.isArray(msgRes.data.labelIds) ? (msgRes.data.labelIds as string[]) : [];
  return { fromEmail, labelIds };
}

/**
 * 任意のGmailラベル（labelName）をメッセージへ付与/解除する。
 * - labelName は Gmail のラベル名（例: "VIP" / "MailHub/Custom/..."）
 * - 内部ステータス等は呼び出し側で制御（この関数は指定されたラベルのみを触る）
 */
export async function applyLabelsToMessages(
  ids: string[],
  opts: { addLabelNames?: string[]; removeLabelNames?: string[] },
): Promise<{ successIds: string[]; failed: Array<{ id: string; error: string }> }> {
  const addNames = (opts.addLabelNames ?? []).filter(Boolean);
  const removeNames = (opts.removeLabelNames ?? []).filter(Boolean);

  if (ids.length === 0 || (addNames.length === 0 && removeNames.length === 0)) {
    return { successIds: [], failed: [] };
  }

  if (isTestMode()) {
    const map = getTestUserLabels();
    for (const id of ids) {
      const cur = map.get(id) ?? new Set<string>();
      for (const n of addNames) cur.add(n);
      for (const n of removeNames) cur.delete(n);
      map.set(id, cur);
    }
    // キャッシュをクリアして即反映
    clearAllMessageCaches();
    return { successIds: [...ids], failed: [] };
  }

  const { gmail, sharedInboxEmail } = createGmailClient();
  const uniqNames = [...new Set([...addNames, ...removeNames])];
  const nameToId = new Map<string, string>();
  for (const name of uniqNames) {
    const id = await ensureLabelId(name);
    if (id) nameToId.set(name, id);
  }

  const addIds = addNames.map((n) => nameToId.get(n)).filter((v): v is string => Boolean(v));
  const removeIds = removeNames.map((n) => nameToId.get(n)).filter((v): v is string => Boolean(v));

  const failed: Array<{ id: string; error: string }> = [];
  const results = await mapWithConcurrency(ids, 3, async (id) => {
    try {
      await gmail.users.messages.modify({
        userId: sharedInboxEmail,
        id,
        requestBody: {
          addLabelIds: addIds.length ? addIds : undefined,
          removeLabelIds: removeIds.length ? removeIds : undefined,
        },
      });
      return { ok: true as const, id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failed.push({ id, error: msg });
      return { ok: false as const, id };
    }
  });

  // キャッシュをクリア（一覧/詳細の反映）
  getCache().list.clear();
  getCache().thread.clear();
  for (const r of results) {
    if (r.ok) getCache().detail.delete(`detail:${sharedInboxEmail}:id=${r.id}`);
  }

  const successIds = results.filter((r) => r.ok).map((r) => r.id);
  return { successIds, failed };
}

/**
 * メールをアーカイブ（INBOXラベルを外す + Doneラベル付ける + Waitingラベル外す）
 */
export async function archiveMessage(id: string): Promise<void> {
  // テストモードでのアクション遅延を適用
  await applyTestActionDelay();
  
  // テストモードでは状態を更新
  if (isTestMode()) {
    if (shouldFailInTestMode("archive", id)) {
      throw new Error("意図的な失敗（テスト用）");
    }
    console.log(`[TEST MODE] archiveMessage: ${id}`);
    setTestStatus(id, "done");
    return;
  }

  const { gmail, sharedInboxEmail } = createGmailClient();
  const doneId = await ensureLabelId(MAILHUB_LABEL_DONE);
  const waitingId = await ensureLabelId(MAILHUB_LABEL_WAITING);
  const mutedId = await ensureLabelId(MAILHUB_LABEL_MUTED);
  const snoozedId = await ensureLabelId(MAILHUB_LABEL_SNOOZED);

  // 現在のラベルを確認して、Snooze日付ラベルを全て削除
  const msgRes = await gmail.users.messages.get({
    userId: sharedInboxEmail,
    id,
    format: "metadata",
    metadataHeaders: [],
  });

  const currentLabelIds = msgRes.data.labelIds ?? [];
  const idToName = (await listLabelsMap()).idToName;

  const removeSnoozeDateLabels = removeAllSnoozeDateLabels(currentLabelIds, idToName);
  const removeLabels = ["INBOX"];
  if (waitingId) removeLabels.push(waitingId);
  if (mutedId) removeLabels.push(mutedId);
  if (snoozedId) removeLabels.push(snoozedId);
  removeLabels.push(...removeSnoozeDateLabels);
  
  await gmail.users.messages.modify({
    userId: sharedInboxEmail,
    id,
    requestBody: {
      addLabelIds: doneId ? [doneId] : undefined,
      removeLabelIds: removeLabels,
    },
  });

  // Gmailのラベル反映遅延を短時間だけ吸収（完了直後に他フォルダへ移動するケース対策）
  const ok = await waitForMessageLabelState(gmail, sharedInboxEmail, id, {
    mustHaveIds: doneId ? [doneId] : [],
    mustNotHaveIds: ["INBOX", ...(waitingId ? [waitingId] : []), ...(mutedId ? [mutedId] : []), ...(snoozedId ? [snoozedId] : [])],
    attempts: 18,
    intervalMs: 300,
  });
  // 反映が間に合わない場合は同じmodifyを再試行（best-effort）
  if (!ok) {
    try {
      await gmail.users.messages.modify({
        userId: sharedInboxEmail,
        id,
        requestBody: {
          addLabelIds: doneId ? [doneId] : undefined,
          removeLabelIds: removeLabels,
        },
      });
      await waitForMessageLabelState(gmail, sharedInboxEmail, id, {
        mustHaveIds: doneId ? [doneId] : [],
        mustNotHaveIds: ["INBOX", ...(waitingId ? [waitingId] : []), ...(mutedId ? [mutedId] : []), ...(snoozedId ? [snoozedId] : [])],
        attempts: 10,
        intervalMs: 350,
      });
    } catch {
      // ignore
    }
  }

  // キャッシュをクリア（一覧が変わるため）
  getCache().list.clear();
  getCache().thread.clear();
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
  
  // Done/Waiting/Muted/Snoozedラベルを外す
  const doneId = await ensureLabelId(MAILHUB_LABEL_DONE);
  const waitingId = await ensureLabelId(MAILHUB_LABEL_WAITING);
  const mutedId = await ensureLabelId(MAILHUB_LABEL_MUTED);
  const snoozedId = await ensureLabelId(MAILHUB_LABEL_SNOOZED);

  // 現在のラベルを確認して、Snooze日付ラベルを全て削除
  const msgRes = await gmail.users.messages.get({
    userId: sharedInboxEmail,
    id,
    format: "metadata",
    metadataHeaders: [],
  });

  const currentLabelIds = msgRes.data.labelIds ?? [];
  const idToName = (await listLabelsMap()).idToName;

  const removeSnoozeDateLabels = removeAllSnoozeDateLabels(currentLabelIds, idToName);
  const removeLabels: string[] = [];
  if (doneId) removeLabels.push(doneId);
  if (waitingId) removeLabels.push(waitingId);
  if (mutedId) removeLabels.push(mutedId);
  if (snoozedId) removeLabels.push(snoozedId);
  removeLabels.push(...removeSnoozeDateLabels);
  
  await gmail.users.messages.modify({
    userId: sharedInboxEmail,
    id,
    requestBody: {
      addLabelIds: ["INBOX"],
      removeLabelIds: removeLabels.length > 0 ? removeLabels : undefined,
    },
  });

  // Gmailのラベル反映遅延を短時間だけ吸収
  await waitForMessageLabelState(gmail, sharedInboxEmail, id, {
    mustHaveIds: ["INBOX"],
    mustNotHaveIds: [...(doneId ? [doneId] : []), ...(waitingId ? [waitingId] : []), ...(mutedId ? [mutedId] : []), ...(snoozedId ? [snoozedId] : [])],
    attempts: 18,
    intervalMs: 300,
  });

  // キャッシュをクリア
  getCache().list.clear();
  getCache().thread.clear();
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

  // キャッシュチェック（最優先）
  const cached = getCache().labels.get(labelName);
  if (typeof cached === "string" && cached) return cached;

  // listLabelsMapのキャッシュを活用（既存ラベル検索を高速化）
  const labelsMap = await listLabelsMap();
  const existingId = labelsMap.nameToId.get(labelName);
  if (existingId) {
    // キャッシュに保存して次回以降を高速化
    getCache().labels.set(labelName, existingId);
    return existingId;
  }

  const { gmail, sharedInboxEmail } = createGmailClient();

  // キャッシュに無い場合は作成
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
    invalidateLabelsMapCache(); // labelsMapキャッシュを無効化（次回取得時に反映）
    return newId;
  }

  return null;
}

// assigneeSlugはlib/assignee.tsに移動（テスト可能にするため）
export { assigneeSlug } from "./assignee";

// テストモード用: 担当者状態を保持
declare global {
  // eslint-disable-next-line no-var
  var __mailhubTestAssigneeMap: Map<string, string> | undefined;
}

export function getTestAssigneeMap(): Map<string, string> {
  if (!globalThis.__mailhubTestAssigneeMap) {
    globalThis.__mailhubTestAssigneeMap = new Map();
  }
  return globalThis.__mailhubTestAssigneeMap;
}

/**
 * テストモードの状態をリセット（E2Eテスト用）
 * テストごとに同じ初期状態から開始できるようにする
 */
export async function resetTestState(): Promise<void> {
  if (!isTestMode()) {
    throw new Error("resetTestState can only be called in test mode");
  }
  
  // テスト状態をクリア
  if (globalThis.__mailhubTestMessageStatus) {
    globalThis.__mailhubTestMessageStatus.clear();
  }
  if (globalThis.__mailhubTestAssigneeMap) {
    globalThis.__mailhubTestAssigneeMap.clear();
  }
  if (globalThis.__mailhubTestClaimedStatus) {
    globalThis.__mailhubTestClaimedStatus.clear();
  }
  if (globalThis.__mailhubTestUserLabels) {
    globalThis.__mailhubTestUserLabels.clear();
  }
  if (globalThis.__mailhubTestFailConfig) {
    globalThis.__mailhubTestFailConfig = undefined;
  }
  
  // キャッシュもクリア
  getCache().list.clear();
  getCache().detail.clear();
  getCache().thread.clear();
  getCache().labels.clear();
  
  // Activityログもクリア
  const { clearActivityLogs } = await import("@/lib/audit-log");
  await clearActivityLogs();
}

/**
 * テストモードでの意図的失敗設定（E2Eテスト用）
 */
export function setTestFailConfig(endpoint: string | null, ids: string[]): void {
  if (!isTestMode()) {
    throw new Error("setTestFailConfig can only be called in test mode");
  }
  
  if (endpoint && ids.length > 0) {
    globalThis.__mailhubTestFailConfig = {
      endpoint,
      ids: new Set(ids),
    };
  } else {
    globalThis.__mailhubTestFailConfig = undefined;
  }
}

/**
 * テストモードでの意図的失敗チェック
 */
export function shouldFailInTestMode(endpoint: string, id: string): boolean {
  if (!isTestMode()) {
    return false;
  }
  
  const config = globalThis.__mailhubTestFailConfig;
  if (!config) {
    return false;
  }
  
  return config.endpoint === endpoint && config.ids.has(id);
}

/**
 * テストモードでのアクション遅延設定（E2Eテスト用）
 */
export function setTestActionDelayMs(ms: number | null): void {
  if (!isTestMode()) {
    throw new Error("setTestActionDelayMs can only be called in test mode");
  }
  
  if (ms !== null && ms > 0) {
    globalThis.__mailhubTestActionDelayMs = ms;
  } else {
    globalThis.__mailhubTestActionDelayMs = undefined;
  }
}

/**
 * テストモードでのアクション遅延を取得
 */
export function getTestActionDelayMs(): number | undefined {
  if (!isTestMode()) {
    return undefined;
  }
  return globalThis.__mailhubTestActionDelayMs;
}

/**
 * テストモードでのアクション遅延を適用（共通関数）
 */
export async function applyTestActionDelay(): Promise<void> {
  const delayMs = getTestActionDelayMs();
  if (delayMs && delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

/**
 * ラベル一覧を取得してMapに変換（TTLキャッシュ付き）
 * - force=true: キャッシュを無視し、必ず最新を取得（担当ラベル周りの整合性強化）
 */
async function listLabelsMap(opts?: { force?: boolean }): Promise<{
  idToName: Map<string, string>;
  nameToId: Map<string, string>;
}> {
  const cacheKey = "labelsMap";
  if (!opts?.force) {
    const cached = getCached(
      getCache().labels as unknown as Map<
        string,
        CacheEntry<{ idToName: Map<string, string>; nameToId: Map<string, string> }>
      >,
      cacheKey,
    );
    if (cached) return cached;
  } else {
    invalidateLabelsMapCache();
  }

  if (isTestMode()) {
    const result = {
      idToName: new Map<string, string>(),
      nameToId: new Map<string, string>(),
    };
    return result;
  }

  const { gmail, sharedInboxEmail } = createGmailClient();
  const listRes = await gmail.users.labels.list({ userId: sharedInboxEmail });
  
  const idToName = new Map<string, string>();
  const nameToId = new Map<string, string>();
  
  for (const label of listRes.data.labels ?? []) {
    if (label.id && label.name) {
      idToName.set(label.id, label.name);
      nameToId.set(label.name, label.id);
    }
  }

  const result = { idToName, nameToId };
  setCached(
    getCache().labels as unknown as Map<string, CacheEntry<{ idToName: Map<string, string>; nameToId: Map<string, string> }>>,
    cacheKey,
    result,
    300_000, // 5分キャッシュ
  );
  return result;
}

/**
 * ラベルIDから担当者を取得
 */
function getAssigneeFromLabelIds(
  labelIds: string[],
  idToName: Map<string, string>,
): { slug: string; labelName: string } | null {
  for (const labelId of labelIds) {
    const labelName = idToName.get(labelId);
    if (labelName?.startsWith(MAILHUB_LABEL_ASSIGNEE_PREFIX)) {
      const slug = labelName.slice(MAILHUB_LABEL_ASSIGNEE_PREFIX.length);
      return { slug, labelName };
    }
  }
  return null;
}

/**
 * 担当者ラベルのIDを取得または作成
 */
async function ensureAssigneeLabelId(email: string): Promise<string | null> {
  const slug = assigneeSlug(email);
  const labelName = `${MAILHUB_LABEL_ASSIGNEE_PREFIX}${slug}`;
  return await ensureLabelId(labelName);
}

/**
 * 既存の担当者ラベルIDを全て取得（削除用）
 */
async function removeAllAssigneeLabels(
  labelIds: string[],
  idToName: Map<string, string>,
): Promise<string[]> {
  const assigneeLabelIds: string[] = [];
  for (const labelId of labelIds) {
    const labelName = idToName.get(labelId);
    if (labelName?.startsWith(MAILHUB_LABEL_ASSIGNEE_PREFIX)) {
      assigneeLabelIds.push(labelId);
    }
  }
  return assigneeLabelIds;
}

/**
 * メールをWaitingに設定（INBOX外す + Waitingラベル付ける）
 */
export async function setWaiting(id: string): Promise<void> {
  // テストモードでのアクション遅延を適用
  await applyTestActionDelay();
  
  if (isTestMode()) {
    console.log(`[TEST MODE] setWaiting: ${id}`);
    setTestStatus(id, "waiting");
    return;
  }

  const { gmail, sharedInboxEmail } = createGmailClient();
  const waitingId = await ensureLabelId(MAILHUB_LABEL_WAITING);
  const doneId = await ensureLabelId(MAILHUB_LABEL_DONE);
  const mutedId = await ensureLabelId(MAILHUB_LABEL_MUTED);
  const snoozedId = await ensureLabelId(MAILHUB_LABEL_SNOOZED);

  // 現在のラベルを確認して、Snooze日付ラベルを全て削除
  const msgRes = await gmail.users.messages.get({
    userId: sharedInboxEmail,
    id,
    format: "metadata",
    metadataHeaders: [],
  });

  const currentLabelIds = msgRes.data.labelIds ?? [];
  const idToName = (await listLabelsMap()).idToName;

  const removeSnoozeDateLabels = removeAllSnoozeDateLabels(currentLabelIds, idToName);
  const removeLabels = ["INBOX"];
  if (doneId) removeLabels.push(doneId);
  if (mutedId) removeLabels.push(mutedId);
  if (snoozedId) removeLabels.push(snoozedId);
  removeLabels.push(...removeSnoozeDateLabels);

  // 担当者ラベルは削除しない（担当かつ保留の状態を維持）
  await gmail.users.messages.modify({
    userId: sharedInboxEmail,
    id,
    requestBody: {
      addLabelIds: waitingId ? [waitingId] : undefined,
      removeLabelIds: removeLabels,
    },
  });

  // Gmailのラベル反映遅延を短時間だけ吸収（直後にWaiting一覧へ切り替えるケース対策）
  if (waitingId) {
    for (let i = 0; i < 5; i++) {
      const meta = await gmail.users.messages.get({
        userId: sharedInboxEmail,
        id,
        format: "metadata",
      });
      const labelIds = meta.data.labelIds ?? [];
      if (labelIds.includes(waitingId)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // キャッシュをクリア（保留タブで再取得時に担当情報が正しく取得されるように）
  getCache().list.clear();
  getCache().thread.clear();
  getCache().detail.delete(`detail:${sharedInboxEmail}:id=${id}`);
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
  const doneId = await ensureLabelId(MAILHUB_LABEL_DONE);
  const mutedId = await ensureLabelId(MAILHUB_LABEL_MUTED);

  await gmail.users.messages.modify({
    userId: sharedInboxEmail,
    id,
    requestBody: {
      addLabelIds: ["INBOX"],
      // 念のため状態ラベルを相互排他に保つ（古い状態が残っているケースを吸収）
      removeLabelIds: [waitingId, doneId, mutedId].filter((v): v is string => Boolean(v)),
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
 * Step 65: assigneeLoadBySlug, unassignedLoad を追加
 */
export async function getMessageCounts(userEmail: string): Promise<{
  todo: number;
  waiting: number;
  done: number;
  muted: number;
  snoozed?: number;
  assignedMine: number;
  assigneeLoadBySlug: Record<string, number>;
  unassignedLoad: number;
}> {
  // テストモード: メモリ上の状態からカウント
  if (isTestMode()) {
    const all = messagesFixture as InboxListMessage[];
    const testAssigneeMap = getTestAssigneeMap();
    let todo = 0;
    let waiting = 0;
    let done = 0;
    let muted = 0;
    let snoozed = 0;
    let assignedMine = 0;
    // Step 65: assignee負荷（Todo+Waiting）
    const assigneeLoadBySlug: Record<string, number> = {};
    // NOTE: TEST_MODEでも担当件数は「保留/完了を含む総数」を返す
    const mineSlug = assigneeSlug(userEmail);
    for (const m of all) {
      const status = getTestStatus(m.id);
      const isLoad = status === "todo" || status === "waiting" || status === undefined;
      if (status === "waiting") waiting++;
      else if (status === "done") done++;
      else if (status === "muted") muted++;
      else if (status === "snoozed") snoozed++;
      else todo++;
      if (testAssigneeMap.get(m.id) === mineSlug) assignedMine++;
      // assignee負荷計算（Todo+Waitingのみ）
      const msgAssigneeSlug = testAssigneeMap.get(m.id);
      if (msgAssigneeSlug && isLoad) {
        assigneeLoadBySlug[msgAssigneeSlug] = (assigneeLoadBySlug[msgAssigneeSlug] ?? 0) + 1;
      }
    }
    // unassignedLoad = (todo + waiting) - Σ(assignee負荷)
    const totalAssignedLoad = Object.values(assigneeLoadBySlug).reduce((a, b) => a + b, 0);
    const unassignedLoad = Math.max(0, todo + waiting - totalAssignedLoad);
    return { todo, waiting, done, muted, snoozed, assignedMine, assigneeLoadBySlug, unassignedLoad };
  }

  const { gmail, sharedInboxEmail } = createGmailClient();
  const waitingId = await ensureLabelId(MAILHUB_LABEL_WAITING);
  const doneId = await ensureLabelId(MAILHUB_LABEL_DONE);
  const mutedId = await ensureLabelId(MAILHUB_LABEL_MUTED);
  const snoozedId = await ensureLabelId(MAILHUB_LABEL_SNOOZED);
  // NOTE: 担当件数は「担当ラベルIDのみ」でカウント（INBOX/Waiting/Doneを跨いで総数を出す）
  // API route側で認証ユーザーemailを渡す想定（vtjドメイン内）
  const mineSlug = assigneeSlug(userEmail);
  const assigneeLabelName = mineSlug
    ? `${MAILHUB_LABEL_ASSIGNEE_PREFIX}${mineSlug}`
    : null;
  const assigneeLabelId = assigneeLabelName ? await ensureLabelId(assigneeLabelName) : null;

  // NOTE:
  // - messages.list の resultSizeEstimate は推定値で、運用では「201」などの違和感が出ることがある
  // - labels.get の messagesTotal はより直感的な値なので、バッジ表示にはこちらを使う
  const getLabelTotal = async (labelId: string | null): Promise<number> => {
    if (!labelId) return 0;
    const res = await gmail.users.labels.get({ userId: sharedInboxEmail, id: labelId });
    return res.data.messagesTotal ?? 0;
  };

  const [todo, waiting, done, muted, snoozed, assignedMine] = await Promise.all([
    getLabelTotal("INBOX"),
    getLabelTotal(waitingId),
    getLabelTotal(doneId),
    getLabelTotal(mutedId),
    getLabelTotal(snoozedId),
    getLabelTotal(assigneeLabelId),
  ]);

  // Step 65: assignee負荷計算（MailHub/Assignee/*ラベルを列挙）
  // 本番では labels.list で prefix走査し、各assigneeの負荷を計算
  // TODO: 本番環境向けに Gmail API で実装（現在はTEST_MODEのみ対応）
  const assigneeLoadBySlug: Record<string, number> = {};
  // 簡易実装: mineSlugの負荷のみ計算（TODO+Waitingの合計件数）
  if (assigneeLabelId && waitingId) {
    // INBOXとassigneeLabelIdの交差、WaitingとassigneeLabelIdの交差
    const theWaitingId = waitingId; // non-null assertion via reassignment
    const theAssigneeLabelId = assigneeLabelId;
    const [inboxLoad, waitingLoad] = await Promise.all([
      (async () => {
        const res = await gmail.users.messages.list({
          userId: sharedInboxEmail,
          labelIds: ["INBOX", theAssigneeLabelId],
          maxResults: 1,
        });
        return res.data.resultSizeEstimate ?? 0;
      })(),
      (async () => {
        const res = await gmail.users.messages.list({
          userId: sharedInboxEmail,
          labelIds: [theWaitingId, theAssigneeLabelId],
          maxResults: 1,
        });
        return res.data.resultSizeEstimate ?? 0;
      })(),
    ]);
    assigneeLoadBySlug[mineSlug] = inboxLoad + waitingLoad;
  }
  // unassignedLoad = (todo + waiting) - 全assignee負荷
  const totalAssignedLoad = Object.values(assigneeLoadBySlug).reduce((a, b) => a + b, 0);
  const unassignedLoad = Math.max(0, todo + waiting - totalAssignedLoad);

  return {
    todo,
    waiting,
    done,
    muted,
    snoozed,
    assignedMine,
    assigneeLoadBySlug,
    unassignedLoad,
  };
}

/**
 * メールを低優先（ミュート）に移動
 * - removeLabelIds: ["INBOX"]
 * - addLabelIds: ["MailHub/Muted"]
 * - 冪等性: すでにINBOXが無くても成功扱い（200）
 */
export async function muteMessage(id: string): Promise<void> {
  // テストモードでのアクション遅延を適用
  await applyTestActionDelay();
  
  // テストモードでは状態を更新
  if (isTestMode()) {
    console.log(`[TEST MODE] muteMessage: ${id}`);
    setTestStatus(id, "muted");
    return;
  }

  const { gmail, sharedInboxEmail } = createGmailClient();
  const mutedId = await ensureLabelId(MAILHUB_LABEL_MUTED);
  const waitingId = await ensureLabelId(MAILHUB_LABEL_WAITING);
  const doneId = await ensureLabelId(MAILHUB_LABEL_DONE);
  const snoozedId = await ensureLabelId(MAILHUB_LABEL_SNOOZED);
  if (!mutedId) throw new Error("Could not ensure Muted label");

  let removeSnoozeDateLabels: string[] = [];
  try {
    // 現在のラベルを確認（冪等性のため）
    const msgRes = await gmail.users.messages.get({
      userId: sharedInboxEmail,
      id,
      format: "metadata",
      metadataHeaders: [],
    });

    const labelIds = msgRes.data.labelIds ?? [];
    const hasInbox = labelIds.includes("INBOX");
    const hasMuted = labelIds.includes(mutedId);
    const hasWaiting = waitingId ? labelIds.includes(waitingId) : false;
    const hasDone = doneId ? labelIds.includes(doneId) : false;
    const hasSnoozed = snoozedId ? labelIds.includes(snoozedId) : false;
    // Snooze日付ラベルを全て削除
    removeSnoozeDateLabels = removeAllSnoozeDateLabels(labelIds, (await listLabelsMap()).idToName);

    // すでにミュート済みの場合は成功扱い（冪等性）
    if (!hasInbox && hasMuted) {
      return;
    }

    await gmail.users.messages.modify({
      userId: sharedInboxEmail,
      id,
      requestBody: {
        // 状態ラベルは相互排他にする（Mutedにする時はWaiting/Doneも外す）
        removeLabelIds: [
          ...(hasInbox ? ["INBOX"] : []),
          ...(hasWaiting && waitingId ? [waitingId] : []),
          ...(hasDone && doneId ? [doneId] : []),
          ...(hasSnoozed && snoozedId ? [snoozedId] : []),
          ...removeSnoozeDateLabels,
        ],
        addLabelIds: !hasMuted ? [mutedId] : undefined,
      },
    });
  } catch (e: unknown) {
    // 404（メールIDが存在しない）だけ明確にエラー
    const err = e && typeof e === "object" ? (e as Record<string, unknown>) : {};
    if (err.code === 404) {
      throw new Error(`Message not found: ${id}`);
    }
    throw e;
  }

  // Gmailのラベル反映遅延を短時間だけ吸収（直後にタブ切替して戻るケース対策）
  await waitForMessageLabelState(gmail, sharedInboxEmail, id, {
    mustHaveIds: [mutedId],
    mustNotHaveIds: [
      "INBOX",
      ...(waitingId ? [waitingId] : []),
      ...(doneId ? [doneId] : []),
      ...(snoozedId ? [snoozedId] : []),
      ...removeSnoozeDateLabels,
    ],
    attempts: 18,
    intervalMs: 300,
  });

  // キャッシュをクリア（一覧が変わるため）
  getCache().list.clear();
  getCache().thread.clear();
  getCache().detail.delete(`detail:${sharedInboxEmail}:id=${id}`);
}

/**
 * メールに担当者を割り当て
 * @param id メールID
 * @param assigneeEmail 担当者のメールアドレス
 * @param opts force=trueの場合は既存の担当者を上書き（引き継ぎ）
 * @returns 既存の担当者がいる場合はそのslug、いない場合はnull
 */
export async function assignMessage(
  id: string,
  assigneeEmail: string,
  opts?: { force?: boolean },
): Promise<{ currentAssigneeSlug: string | null }> {
  // テストモードでのアクション遅延を適用
  await applyTestActionDelay();
  
  if (isTestMode()) {
    console.log(`[TEST MODE] assignMessage: ${id} -> ${assigneeEmail}`);
    // テストモードではメモリ上で管理
    const testAssigneeMap = getTestAssigneeMap();
    const currentSlug = testAssigneeMap.get(id) || null;
    if (currentSlug && !opts?.force) {
      return { currentAssigneeSlug: currentSlug };
    }
    testAssigneeMap.set(id, assigneeSlug(assigneeEmail));
    return { currentAssigneeSlug: currentSlug };
  }

  const { gmail, sharedInboxEmail } = createGmailClient();
  const labelsMap = await listLabelsMap();

  // 現在のラベルを取得
  const msgRes = await gmail.users.messages.get({
    userId: sharedInboxEmail,
    id,
    format: "metadata",
    metadataHeaders: [],
  });
  const currentLabelIds = msgRes.data.labelIds || [];
  
  // 現在の担当者を確認
  const currentAssignee = getAssigneeFromLabelIds(currentLabelIds, labelsMap.idToName);
  if (currentAssignee && !opts?.force) {
    return { currentAssigneeSlug: currentAssignee.slug };
  }

  // 既存の担当者ラベルを全て削除
  const removeLabelIds = await removeAllAssigneeLabels(currentLabelIds, labelsMap.idToName);
  
  // 新しい担当者ラベルを追加
  const assigneeLabelId = await ensureAssigneeLabelId(assigneeEmail);
  if (!assigneeLabelId) {
    throw new Error("Could not ensure Assignee label");
  }

  await gmail.users.messages.modify({
    userId: sharedInboxEmail,
    id,
    requestBody: {
      removeLabelIds: removeLabelIds.length > 0 ? removeLabelIds : undefined,
      addLabelIds: [assigneeLabelId],
    },
  });

  // 実ラベル反映の確認（Gmail側の反映が遅いと「担当が付いた→タブ切替で消えた」に見えるため）
  // modify直後にmetadataを数回ポーリングして、担当ラベルがlabelIdsに現れるまで待つ（短時間だけ）
  for (let attempt = 0; attempt < 3; attempt++) {
    const check = await gmail.users.messages.get({
      userId: sharedInboxEmail,
      id,
      format: "metadata",
      metadataHeaders: [],
    });
    const ids = check.data.labelIds ?? [];
    if (ids.includes(assigneeLabelId)) break;
    // 0.2s, 0.4s, 0.8s
    await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt)));
  }

  getCache().list.clear();
  getCache().thread.clear();
  getCache().detail.delete(`detail:${sharedInboxEmail}:id=${id}`);
  invalidateLabelsMapCache();

  return { currentAssigneeSlug: currentAssignee?.slug || null };
}

/**
 * メールから担当者を解除
 */
export async function unassignMessage(id: string): Promise<void> {
  if (isTestMode()) {
    console.log(`[TEST MODE] unassignMessage: ${id}`);
    const testAssigneeMap = getTestAssigneeMap();
    testAssigneeMap.delete(id);
    return;
  }

  const { gmail, sharedInboxEmail } = createGmailClient();
  const labelsMap = await listLabelsMap();

  // 現在のラベルを取得
  const msgRes = await gmail.users.messages.get({
    userId: sharedInboxEmail,
    id,
    format: "metadata",
    metadataHeaders: [],
  });
  const currentLabelIds = msgRes.data.labelIds || [];
  
  // 担当者ラベルを全て削除
  const removeLabelIds = await removeAllAssigneeLabels(currentLabelIds, labelsMap.idToName);
  if (removeLabelIds.length === 0) {
    // 既に担当者がいない場合は成功扱い（冪等性）
    return;
  }

  await gmail.users.messages.modify({
    userId: sharedInboxEmail,
    id,
    requestBody: {
      removeLabelIds,
    },
  });

  getCache().list.clear();
  getCache().thread.clear();
  getCache().detail.delete(`detail:${sharedInboxEmail}:id=${id}`);
  invalidateLabelsMapCache();
}

/**
 * 低優先（ミュート）を解除してInboxに戻す
 * - addLabelIds: ["INBOX"]
 * - removeLabelIds: ["MailHub/Muted"]
 * - 冪等性: すでにMutedが無くても成功扱い（200）
 */
export async function unmuteMessage(id: string): Promise<void> {
  // テストモードでは状態を更新
  if (isTestMode()) {
    console.log(`[TEST MODE] unmuteMessage: ${id}`);
    setTestStatus(id, "todo");
    return;
  }

  const { gmail, sharedInboxEmail } = createGmailClient();
  const mutedId = await ensureLabelId(MAILHUB_LABEL_MUTED);
  const waitingId = await ensureLabelId(MAILHUB_LABEL_WAITING);
  const doneId = await ensureLabelId(MAILHUB_LABEL_DONE);
  const snoozedId = await ensureLabelId(MAILHUB_LABEL_SNOOZED);
  if (!mutedId) throw new Error("Could not ensure Muted label");

  try {
    // 現在のラベルを確認（冪等性のため）
    const msgRes = await gmail.users.messages.get({
      userId: sharedInboxEmail,
      id,
      format: "metadata",
      metadataHeaders: [],
    });

    const labelIds = msgRes.data.labelIds ?? [];
    const hasInbox = labelIds.includes("INBOX");
    const hasMuted = labelIds.includes(mutedId);
    const hasWaiting = waitingId ? labelIds.includes(waitingId) : false;
    const hasDone = doneId ? labelIds.includes(doneId) : false;

    // すでにInboxに戻っている場合は成功扱い（冪等性）
    if (hasInbox && !hasMuted && !hasWaiting && !hasDone) {
      return;
    }

    // Snooze日付ラベルを全て削除
    const removeSnoozeDateLabels = removeAllSnoozeDateLabels(labelIds, (await listLabelsMap()).idToName);

    await gmail.users.messages.modify({
      userId: sharedInboxEmail,
      id,
      requestBody: {
        addLabelIds: !hasInbox ? ["INBOX"] : undefined,
        // 念のため状態ラベルを相互排他に保つ（Inboxへ戻す時はWaiting/Done/Snoozedも外す）
        removeLabelIds: [
          ...(hasMuted ? [mutedId] : []),
          ...(hasWaiting && waitingId ? [waitingId] : []),
          ...(hasDone && doneId ? [doneId] : []),
          ...(snoozedId ? [snoozedId] : []),
          ...removeSnoozeDateLabels,
        ],
      },
    });
  } catch (e: unknown) {
    // 404（メールIDが存在しない）だけ明確にエラー
    const err = e && typeof e === "object" ? (e as Record<string, unknown>) : {};
    if (err.code === 404) {
      throw new Error(`Message not found: ${id}`);
    }
    throw e;
  }

  // Gmailのラベル反映遅延を短時間だけ吸収（直後にタブ切替して戻るケース対策）
  await waitForMessageLabelState(gmail, sharedInboxEmail, id, {
    mustHaveIds: ["INBOX"],
    mustNotHaveIds: [mutedId, ...(waitingId ? [waitingId] : []), ...(doneId ? [doneId] : []), ...(snoozedId ? [snoozedId] : [])],
    attempts: 18,
    intervalMs: 300,
  });

  // キャッシュをクリア（一覧が変わるため）
  getCache().list.clear();
  getCache().detail.delete(`detail:${sharedInboxEmail}:id=${id}`);
}

/**
 * Snooze日付ラベルのIDを取得/作成
 * @param date YYYY-MM-DD形式の日付文字列
 */
export async function ensureSnoozeDateLabelId(date: string): Promise<string | null> {
  const labelName = `${MAILHUB_LABEL_SNOOZE_DATE_PREFIX}${date}`;
  return await ensureLabelId(labelName);
}

/**
 * ラベルからSnooze期限を抽出
 * @param labelIds Gmail APIのlabelIds
 * @param idToName labelId -> labelNameのマップ
 * @returns YYYY-MM-DD形式の日付文字列、またはnull
 */
export function getSnoozeUntilFromLabels(
  labelIds: string[],
  idToName: Map<string, string>,
): string | null {
  const prefix = MAILHUB_LABEL_SNOOZE_DATE_PREFIX;
  for (const id of labelIds) {
    const name = idToName.get(id);
    if (name && name.startsWith(prefix)) {
      const date = name.slice(prefix.length);
      // YYYY-MM-DD形式の検証
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return date;
      }
    }
  }
  return null;
}

/**
 * Snooze日付ラベルを全て削除（prefix一致で全部）
 * @param labelIds 現在のlabelIds
 * @param idToName labelId -> labelNameのマップ
 * @returns 削除対象のlabelIds
 */
export function removeAllSnoozeDateLabels(
  labelIds: string[],
  idToName: Map<string, string>,
): string[] {
  const prefix = MAILHUB_LABEL_SNOOZE_DATE_PREFIX;
  return labelIds.filter((id) => {
    const name = idToName.get(id);
    return name && name.startsWith(prefix);
  });
}

/**
 * メッセージをSnooze（期限付き保留）
 * @param id メッセージID
 * @param until YYYY-MM-DD形式の日付文字列
 */
export async function snoozeMessage(id: string, until: string): Promise<void> {
  // テストモードでは状態を更新
  if (isTestMode()) {
    console.log(`[TEST MODE] snoozeMessage: ${id} until ${until}`);
    setTestStatus(id, "snoozed");
    // テストモードではsnoozeUntilも保持（簡易実装）
    const all = messagesFixture as InboxListMessage[];
    const msg = all.find((m) => m.id === id);
    if (msg) {
      msg.snoozeUntil = until;
    }
    return;
  }

  const { gmail, sharedInboxEmail } = createGmailClient();
  const snoozedId = await ensureLabelId(MAILHUB_LABEL_SNOOZED);
  const snoozeDateId = await ensureSnoozeDateLabelId(until);
  const waitingId = await ensureLabelId(MAILHUB_LABEL_WAITING);
  const doneId = await ensureLabelId(MAILHUB_LABEL_DONE);
  const mutedId = await ensureLabelId(MAILHUB_LABEL_MUTED);
  if (!snoozedId || !snoozeDateId) throw new Error("Could not ensure Snooze labels");

  // 現在のラベルを確認して、既存のSnooze日付ラベルを削除
  const msgRes = await gmail.users.messages.get({
    userId: sharedInboxEmail,
    id,
    format: "metadata",
    metadataHeaders: [],
  });

  const currentLabelIds = msgRes.data.labelIds ?? [];
  const idToName = (await listLabelsMap()).idToName;

  const removeSnoozeDateLabels = removeAllSnoozeDateLabels(currentLabelIds, idToName);
  const removeLabels = [
    "INBOX",
    ...(waitingId ? [waitingId] : []),
    ...(doneId ? [doneId] : []),
    ...(mutedId ? [mutedId] : []),
    ...removeSnoozeDateLabels,
  ];

  await gmail.users.messages.modify({
    userId: sharedInboxEmail,
    id,
    requestBody: {
      addLabelIds: [snoozedId, snoozeDateId],
      removeLabelIds: removeLabels,
    },
  });

  // Gmailのラベル反映遅延を短時間だけ吸収
  await waitForMessageLabelState(gmail, sharedInboxEmail, id, {
    mustHaveIds: [snoozedId, snoozeDateId],
    mustNotHaveIds: ["INBOX", ...(waitingId ? [waitingId] : []), ...(doneId ? [doneId] : []), ...(mutedId ? [mutedId] : [])],
    attempts: 18,
    intervalMs: 300,
  });

  // キャッシュをクリア
  getCache().list.clear();
  getCache().thread.clear();
  getCache().detail.delete(`detail:${sharedInboxEmail}:id=${id}`);
}

/**
 * メッセージのSnoozeを解除（Todoに戻す）
 * @param id メッセージID
 */
export async function unsnoozeMessage(id: string): Promise<void> {
  // テストモードでは状態を更新
  if (isTestMode()) {
    console.log(`[TEST MODE] unsnoozeMessage: ${id}`);
    setTestStatus(id, "todo");
    const all = messagesFixture as InboxListMessage[];
    const msg = all.find((m) => m.id === id);
    if (msg) {
      msg.snoozeUntil = null;
    }
    return;
  }

  const { gmail, sharedInboxEmail } = createGmailClient();
  const snoozedId = await ensureLabelId(MAILHUB_LABEL_SNOOZED);
  const waitingId = await ensureLabelId(MAILHUB_LABEL_WAITING);
  const doneId = await ensureLabelId(MAILHUB_LABEL_DONE);
  const mutedId = await ensureLabelId(MAILHUB_LABEL_MUTED);

  // 現在のラベルを確認して、Snooze日付ラベルを全て削除
  const msgRes = await gmail.users.messages.get({
    userId: sharedInboxEmail,
    id,
    format: "metadata",
    metadataHeaders: [],
  });

  const currentLabelIds = msgRes.data.labelIds ?? [];
  const idToName = (await listLabelsMap()).idToName;

  const removeSnoozeDateLabels = removeAllSnoozeDateLabels(currentLabelIds, idToName);
  const removeLabels = [
    ...(snoozedId ? [snoozedId] : []),
    ...removeSnoozeDateLabels,
  ];

  await gmail.users.messages.modify({
    userId: sharedInboxEmail,
    id,
    requestBody: {
      addLabelIds: ["INBOX"],
      removeLabelIds: removeLabels.length > 0 ? removeLabels : undefined,
    },
  });

  // Gmailのラベル反映遅延を短時間だけ吸収
  await waitForMessageLabelState(gmail, sharedInboxEmail, id, {
    mustHaveIds: ["INBOX"],
    mustNotHaveIds: [...(snoozedId ? [snoozedId] : []), ...(waitingId ? [waitingId] : []), ...(doneId ? [doneId] : []), ...(mutedId ? [mutedId] : [])],
    attempts: 18,
    intervalMs: 300,
  });

  // キャッシュをクリア
  getCache().list.clear();
  getCache().thread.clear();
  getCache().detail.delete(`detail:${sharedInboxEmail}:id=${id}`);
}

/**
 * 期限が来たSnoozeをTodoに戻す（自動復帰）
 * @param untilDate YYYY-MM-DD形式の日付文字列（この日以前のSnoozeを戻す）
 * @returns 復帰したメッセージのIDと件数
 */
export async function releaseSnoozed(untilDate: string): Promise<{
  releasedCount: number;
  releasedIds: string[];
  truncated: boolean;
}> {
  const { gmail, sharedInboxEmail } = createGmailClient();
  const snoozedId = await ensureLabelId(MAILHUB_LABEL_SNOOZED);
  if (!snoozedId) {
    return { releasedCount: 0, releasedIds: [], truncated: false };
  }

  // Snoozedラベルを持つメッセージを検索
  const listRes = await gmail.users.messages.list({
    userId: sharedInboxEmail,
    labelIds: [snoozedId],
    maxResults: 500, // 最大500件まで処理
  });

  const messageIds = listRes.data.messages?.map((m) => m.id ?? "").filter(Boolean) ?? [];
  if (messageIds.length === 0) {
    return { releasedCount: 0, releasedIds: [], truncated: false };
  }

  // 各メッセージのSnooze日付ラベルを確認
  const idToName = (await listLabelsMap()).idToName;

  const targetDate = new Date(untilDate + "T00:00:00Z");
  const targetIds: string[] = [];

  for (const msgId of messageIds) {
    try {
      const msgRes = await gmail.users.messages.get({
        userId: sharedInboxEmail,
        id: msgId,
        format: "metadata",
        metadataHeaders: [],
      });

      const labelIds = msgRes.data.labelIds ?? [];
      const snoozeUntil = getSnoozeUntilFromLabels(labelIds, idToName);
      if (snoozeUntil) {
        const snoozeDate = new Date(snoozeUntil + "T00:00:00Z");
        if (snoozeDate <= targetDate) {
          targetIds.push(msgId);
        }
      }
    } catch {
      // 404などはスキップ
      continue;
    }
  }

  // 復帰処理（最大50件まで）
  const maxRelease = 50;
  const truncated = targetIds.length > maxRelease;
  const releaseIds = targetIds.slice(0, maxRelease);

  const waitingId = await ensureLabelId(MAILHUB_LABEL_WAITING);
  const doneId = await ensureLabelId(MAILHUB_LABEL_DONE);
  const mutedId = await ensureLabelId(MAILHUB_LABEL_MUTED);

  for (const msgId of releaseIds) {
    try {
      const msgRes = await gmail.users.messages.get({
        userId: sharedInboxEmail,
        id: msgId,
        format: "metadata",
        metadataHeaders: [],
      });

      const currentLabelIds = msgRes.data.labelIds ?? [];
      const removeSnoozeDateLabels = removeAllSnoozeDateLabels(currentLabelIds, idToName);
      const removeLabels = [
        ...(snoozedId ? [snoozedId] : []),
        ...(waitingId ? [waitingId] : []),
        ...(doneId ? [doneId] : []),
        ...(mutedId ? [mutedId] : []),
        ...removeSnoozeDateLabels,
      ];

      await gmail.users.messages.modify({
        userId: sharedInboxEmail,
        id: msgId,
        requestBody: {
          addLabelIds: ["INBOX"],
          removeLabelIds: removeLabels.length > 0 ? removeLabels : undefined,
        },
      });
    } catch {
      // エラーはスキップ（best-effort）
      continue;
    }
  }

  // キャッシュをクリア
  getCache().list.clear();
  getCache().thread.clear();

  return {
    releasedCount: releaseIds.length,
    releasedIds: releaseIds,
    truncated,
  };
}


