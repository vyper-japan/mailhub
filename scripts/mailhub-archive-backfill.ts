#!/usr/bin/env -S node --experimental-strip-types
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { google } from "googleapis";
type Rule = { id: string; action?: "label" | "archive"; match: { fromEmail?: string; fromDomain?: string; subjectContains?: string[]; subjectNotContains?: string[] }; labelNames?: string[]; labelName?: string; enabled: boolean };
type MessageMeta = { id: string; fromEmail: string | null; subject: string | null };
type Target = { id: string; labels: string[] };
const seedPath = join(process.cwd(), "config", "archive-rules-seed.json");
const envPath = join(process.cwd(), ".env.local");
const pageSize = 500, batchSize = 5, query = "label:INBOX";
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
async function ensureLabelIds(gmail: ReturnType<typeof google.gmail>, userId: string, labels: string[]): Promise<string[]> {
  if (!labels.length) return [];
  const res = await gmail.users.labels.list({ userId });
  const nameToId = new Map((res.data.labels ?? []).flatMap((l) => l.name && l.id ? [[l.name, l.id] as const] : []));
  const ids: string[] = [];
  for (const name of [...new Set(labels)]) {
    const existing = nameToId.get(name);
    if (existing) ids.push(existing);
    else {
      const created = await gmail.users.labels.create({ userId, requestBody: { name, labelListVisibility: "labelShow", messageListVisibility: "show" } });
      if (created.data.id) ids.push(created.data.id);
    }
  }
  return ids;
}
async function applyTargets(gmail: ReturnType<typeof google.gmail>, userId: string, targets: Target[], archive: boolean) {
  const allLabelNames = [...new Set(targets.flatMap((target) => target.labels))];
  const allLabelIds = await ensureLabelIds(gmail, userId, allLabelNames);
  const labelIdByName = new Map(allLabelNames.map((name, index) => [name, allLabelIds[index]] as const));
  for (let i = 0; i < targets.length; i += batchSize) {
    await Promise.all(targets.slice(i, i + batchSize).map(async (item) => {
      const addLabelIds = item.labels.map((label) => labelIdByName.get(label)).filter((id): id is string => Boolean(id));
      if (!archive && !addLabelIds.length) return;
      await gmail.users.messages.modify({ userId, id: item.id, requestBody: { addLabelIds: addLabelIds.length ? addLabelIds : undefined, removeLabelIds: archive ? ["INBOX"] : undefined } });
    }));
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
async function main() {
  const argv = process.argv.slice(2);
  const args = { apply: argv.includes("--apply"), dryRun: !argv.includes("--apply") };
  if (args.apply && argv.includes("--dry-run")) throw new Error("choose_only_one:--dry-run_or_--apply");
  loadEnvFile();
  const rules = (JSON.parse(readFileSync(seedPath, "utf8")) as Rule[]).filter((rule) => rule.enabled);
  const { gmail, userId } = createGmailClient();
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
main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
