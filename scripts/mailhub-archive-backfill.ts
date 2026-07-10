#!/usr/bin/env -S node --experimental-strip-types
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
type Rule = { id: string; action?: "label" | "archive"; match: { fromEmail?: string; fromDomain?: string; subjectContains?: string[]; subjectNotContains?: string[] }; labelNames?: string[]; labelName?: string; enabled: boolean };
type MessageMeta = { id: string; fromEmail: string | null; subject: string | null };
export type Target = { id: string; labels: string[] };
// 最小限の Gmail client interface（vitest でモック可能にするための type alias。実体は googleapis の gmail client がこれを構造的に満たす）
export type GmailClient = {
  users: {
    messages: {
      modify(args: { userId: string; id: string; requestBody: { addLabelIds?: string[]; removeLabelIds?: string[] } }): Promise<unknown>;
    };
    labels: {
      list(args: { userId: string }): Promise<{ data: { labels?: Array<{ id?: string | null; name?: string | null }> | null } }>;
      create(args: { userId: string; requestBody: { name: string; labelListVisibility: string; messageListVisibility: string } }): Promise<{ data: { id?: string | null } }>;
    };
    getProfile(args: { userId: string }): Promise<{ data: { emailAddress?: string | null } }>;
  };
};
const seedPath = join(process.cwd(), "config", "archive-rules-seed.json");
const envPath = join(process.cwd(), ".env.local");
const pageSize = 500, batchSize = 5, query = "label:INBOX";
// P1-1 429 指数バックオフ定数: formula = min(cap, base * 2^attempt) * (1 + rand(-jitter, jitter))
const BACKOFF_BASE_MS = 1000, BACKOFF_CAP_MS = 60000, BACKOFF_MAX_RETRY = 5, BACKOFF_JITTER_RATIO = 0.2;
// P2-5 labels.list memoize の TTL
const LABELS_CACHE_TTL_MS = 60000;
function loadEnvFile() {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim(), match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || trimmed.startsWith("#") || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value.replace(/\\n/g, "\n");
  }
}
function requireEnv(name: string): string { const value = process.env[name]?.trim(); if (!value) throw new Error(`missing_env:${name}`); return value; }
function normalizeEmail(input: string | null | undefined): string | null {
  const raw = String(input ?? "").trim();
  const angle = raw.match(/<\s*([^>\s]+@[^>\s]+)\s*>/);
  const token = (angle?.[1] ?? raw).match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)?.[1]?.toLowerCase() ?? null;
  return token && token.includes("@") ? token : null;
}
function listLabels(rule: Rule): string[] { return Array.isArray(rule.labelNames) && rule.labelNames.length ? rule.labelNames.filter(Boolean) : rule.labelName ? [rule.labelName] : []; }
function textList(values: string[] | undefined): string[] { return (values ?? []).map((v) => v.trim().toLowerCase()).filter(Boolean); }
function matchesRule(message: MessageMeta, rule: Rule): boolean {
  const email = message.fromEmail, at = email?.lastIndexOf("@") ?? -1;
  const domain = email && at >= 0 ? email.slice(at + 1) : null;
  const fromMatches = Boolean(rule.match.fromEmail && normalizeEmail(rule.match.fromEmail) === email) ||
    Boolean(rule.match.fromDomain && domain && rule.match.fromDomain.trim().toLowerCase().replace(/^@/, "") === domain);
  const subject = (message.subject ?? "").toLowerCase(), contains = textList(rule.match.subjectContains), notContains = textList(rule.match.subjectNotContains);
  return fromMatches && (!contains.length || contains.some((needle) => subject.includes(needle))) &&
    (!notContains.length || !notContains.some((needle) => subject.includes(needle)));
}
function createGmailClient() {
  const oauth2Client = new google.auth.OAuth2({ clientId: requireEnv("GOOGLE_CLIENT_ID"), clientSecret: requireEnv("GOOGLE_CLIENT_SECRET") });
  oauth2Client.setCredentials({ refresh_token: requireEnv("GOOGLE_SHARED_INBOX_REFRESH_TOKEN") });
  return { gmail: google.gmail({ version: "v1", auth: oauth2Client }), userId: "me" };
}
function headerValue(headers: Array<{ name?: string | null; value?: string | null }> | undefined, name: string): string | null { return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null; }
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; out[index] = await fn(items[index]); }
  }));
  return out;
}
function extractStatusCode(e: unknown): number | null {
  if (!e || typeof e !== "object") return null;
  const err = e as { code?: unknown; status?: unknown; response?: { status?: unknown } };
  const code = err.code ?? err.status ?? err.response?.status;
  return typeof code === "number" ? code : null;
}
function isGmailConflictError(e: unknown): boolean { return extractStatusCode(e) === 409; }
function backoffDelayMs(attempt: number): number {
  const raw = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return raw * (1 + (Math.random() * 2 - 1) * BACKOFF_JITTER_RATIO);
}
async function sleep(ms: number): Promise<void> { await new Promise((resolve) => setTimeout(resolve, ms)); }
// P2-5: labels.list の 60s TTL memoize（module scope。409 fallback 時は force=true で invalidate 後に再取得）
let labelsCache: { ids: Map<string, string>; expiresAt: number } | null = null;
async function fetchLabelIds(gmail: GmailClient, userId: string, force: boolean): Promise<Map<string, string>> {
  if (!force && labelsCache && Date.now() < labelsCache.expiresAt) return labelsCache.ids;
  const res = await gmail.users.labels.list({ userId });
  const ids = new Map((res.data.labels ?? []).flatMap((l) => l.name && l.id ? [[l.name, l.id] as const] : []));
  labelsCache = { ids, expiresAt: Date.now() + LABELS_CACHE_TTL_MS };
  return ids;
}
export async function ensureLabelIds(gmail: GmailClient, userId: string, labels: string[]): Promise<string[]> {
  if (!labels.length) return [];
  const nameToId = await fetchLabelIds(gmail, userId, false);
  const ids: string[] = [];
  for (const name of [...new Set(labels)]) {
    const existing = nameToId.get(name);
    if (existing) { ids.push(existing); continue; }
    try {
      const created = await gmail.users.labels.create({ userId, requestBody: { name, labelListVisibility: "labelShow", messageListVisibility: "show" } });
      if (created.data.id) { ids.push(created.data.id); nameToId.set(name, created.data.id); }
    } catch (err) {
      if (!isGmailConflictError(err)) throw err;
      // 409: race で他プロセスが同名ラベルを作成済み。memoize を強制 invalidate して再取得し、name match で ID を復元する
      const refreshed = await fetchLabelIds(gmail, userId, true);
      const conflictedId = refreshed.get(name);
      if (!conflictedId) throw new Error(`label_conflict_but_not_found:${name}`);
      ids.push(conflictedId);
    }
  }
  return ids;
}
type ModifyOutcome = { status: "ok" } | { status: "fail"; statusCode: number | null; reason: string; retryAttempt: number };
async function modifyWithBackoff(gmail: GmailClient, userId: string, item: Target, archive: boolean, labelIdByName: Map<string, string>): Promise<ModifyOutcome> {
  const addLabelIds = item.labels.map((label) => labelIdByName.get(label)).filter((id): id is string => Boolean(id));
  if (!archive && !addLabelIds.length) return { status: "ok" };
  let attempt = 0;
  for (;;) {
    try {
      await gmail.users.messages.modify({ userId, id: item.id, requestBody: { addLabelIds: addLabelIds.length ? addLabelIds : undefined, removeLabelIds: archive ? ["INBOX"] : undefined } });
      return { status: "ok" };
    } catch (err) {
      const statusCode = extractStatusCode(err);
      if (statusCode === 429 && attempt < BACKOFF_MAX_RETRY) {
        await sleep(backoffDelayMs(attempt));
        attempt += 1;
        continue;
      }
      // 非 429 の失敗は 1 回だけ集計して skip（fatal でなければ次 batch へ）
      return { status: "fail", statusCode, reason: err instanceof Error ? err.message : String(err), retryAttempt: attempt };
    }
  }
}
type ProgressEntry = { ts: string; batchIndex: number; mode: "archive" | "label"; attempted: number; succeeded: string[]; failed: Array<{ id: string; status: number | null; reason: string; retryAttempt: number }>; elapsedMs: number };
let cachedRunId: string | null = null;
function getRunId(): string {
  if (!cachedRunId) cachedRunId = new Date().toISOString().replace(/[:.]/g, "-");
  return cachedRunId;
}
function appendProgressEntry(entry: ProgressEntry): void {
  const dir = join(process.cwd(), ".ai-runs", "mailhub-archive-backfill");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `apply-progress-${getRunId()}.jsonl`), `${JSON.stringify(entry)}\n`);
}
export async function applyTargets(gmail: GmailClient, userId: string, targets: Target[], archive: boolean): Promise<void> {
  const allLabelNames = [...new Set(targets.flatMap((target) => target.labels))];
  const allLabelIds = await ensureLabelIds(gmail, userId, allLabelNames);
  const labelIdByName = new Map(allLabelNames.map((name, index) => [name, allLabelIds[index]] as const));
  for (let i = 0; i < targets.length; i += batchSize) {
    const batch = targets.slice(i, i + batchSize);
    const startedAt = Date.now();
    const outcomes = await Promise.all(batch.map((item) => modifyWithBackoff(gmail, userId, item, archive, labelIdByName)));
    const succeeded: string[] = [], failed: ProgressEntry["failed"] = [];
    outcomes.forEach((outcome, index) => {
      const id = batch[index].id;
      if (outcome.status === "ok") succeeded.push(id);
      else failed.push({ id, status: outcome.statusCode, reason: outcome.reason, retryAttempt: outcome.retryAttempt });
    });
    appendProgressEntry({ ts: new Date().toISOString(), batchIndex: Math.floor(i / batchSize), mode: archive ? "archive" : "label", attempted: batch.length, succeeded, failed, elapsedMs: Date.now() - startedAt });
    await sleep(200);
  }
}
// P2-3: local part 先頭 3 文字 + ***@<domain>（3 文字未満なら ***@<domain>、@ 無しなら文字列全体 mask）
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 0) return "***";
  const local = email.slice(0, at), domain = email.slice(at + 1);
  return `${local.length >= 3 ? local.slice(0, 3) : ""}***@${domain}`;
}
async function assertSharedInboxEmail(gmail: GmailClient, userId: string): Promise<void> {
  const expectedRaw = process.env.GOOGLE_SHARED_INBOX_EMAIL ?? "";
  const expected = expectedRaw.trim().toLowerCase();
  const profile = await gmail.users.getProfile({ userId });
  const actualRaw = profile.data.emailAddress ?? "";
  const actual = actualRaw.trim().toLowerCase();
  if (!expected || expected !== actual) {
    console.error(`assert_email_mismatch: expected=${maskEmail(expectedRaw)} actual=${maskEmail(actualRaw)} env=GOOGLE_SHARED_INBOX_EMAIL`);
    process.exit(2);
  }
}
async function main() {
  const argv = process.argv.slice(2);
  const args = { apply: argv.includes("--apply"), dryRun: !argv.includes("--apply") };
  if (args.apply && argv.includes("--dry-run")) throw new Error("choose_only_one:--dry-run_or_--apply");
  loadEnvFile();
  const rules = (JSON.parse(readFileSync(seedPath, "utf8")) as Rule[]).filter((rule) => rule.enabled);
  const { gmail, userId } = createGmailClient();
  await assertSharedInboxEmail(gmail, userId);
  const senderCounts = new Map<string, number>(), labelCounts = new Map<string, number>();
  const archiveTargets: Target[] = [], labelTargets: Target[] = [];
  let totalScanned = 0, noMatch = 0;
  let pageToken: string | undefined;
  do {
    const page = await gmail.users.messages.list({ userId, q: query, maxResults: pageSize, pageToken });
    pageToken = page.data.nextPageToken ?? undefined;
    const ids = (page.data.messages ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
    const metas = await mapLimit(ids, 5, async (id) => {
      const res = await gmail.users.messages.get({ userId, id, format: "metadata", metadataHeaders: ["From", "Subject"] });
      const headers = res.data.payload?.headers ?? undefined;
      return { id, fromEmail: normalizeEmail(headerValue(headers, "From")), subject: headerValue(headers, "Subject") } satisfies MessageMeta;
    });
    for (const meta of metas) {
      totalScanned += 1;
      const hit = rules.find((rule) => matchesRule(meta, rule));
      if (!hit) { noMatch += 1; continue; }
      const labels = listLabels(hit);
      if ((hit.action ?? "label") === "archive") {
        archiveTargets.push({ id: meta.id, labels });
        senderCounts.set(meta.fromEmail ?? "(missing_from)", (senderCounts.get(meta.fromEmail ?? "(missing_from)") ?? 0) + 1);
      } else {
        labelTargets.push({ id: meta.id, labels });
        for (const label of labels) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
      }
    }
    if (pageToken) await new Promise((r) => setTimeout(r, 500));
  } while (pageToken);
  console.log(`mode: ${args.apply ? "apply" : "dry-run"}`);
  console.log(`total_scanned: ${totalScanned}`);
  console.log(`would_archive: ${archiveTargets.length}`);
  for (const [sender, count] of [...senderCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${sender}: ${count}`);
  console.log(`would_label: ${labelTargets.length}`);
  for (const [label, count] of [...labelCounts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${label}: ${count}`);
  console.log(`no_match: ${noMatch}`);
  if (args.dryRun) return;
  await applyTargets(gmail, userId, archiveTargets, true);
  await applyTargets(gmail, userId, labelTargets, false);
}
// テスト (vitest) からの import 時に main() が自走しないようにするガード
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
}
