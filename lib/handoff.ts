import "server-only";

import { buildOpsSummary, type OpsSummary } from "@/lib/opsSummary";
import { getMailhubEnvLabel, getMailhubEnv, type MailhubEnv } from "@/lib/mailhub-env";
import { isReadOnlyMode } from "@/lib/read-only";
import { getActivityLogs, type AuditAction, type AuditLogEntry } from "@/lib/audit-log";

export type HandoffActivityItem = {
  timestamp: string;
  actorEmail: string;
  action: AuditAction;
  messageId: string;
  label?: string;
  mailhubLink: string | null;
};

export type HandoffPreview = {
  generatedAt: string;
  env: MailhubEnv;
  envLabel: "LOCAL" | "STAGING" | "PROD";
  readOnly: boolean;
  opsSummary: OpsSummary;
  activity: {
    all: HandoffActivityItem[];
    mine: HandoffActivityItem[];
  };
  markdown: string;
};

function safeDateMs(iso: string): number | null {
  try {
    const d = new Date(iso);
    const t = d.getTime();
    if (Number.isNaN(t)) return null;
    return t;
  } catch {
    return null;
  }
}

function buildMailhubLink(messageId: string, label: "todo" | "waiting"): string {
  const params = new URLSearchParams();
  params.set("label", label);
  params.set("id", messageId);
  return `/?${params.toString()}`;
}

function opsCounts(summary: OpsSummary): {
  todoCritical: number;
  todoWarn: number;
  waitingCritical: number;
  waitingWarn: number;
  unassignedCritical: number;
  unassignedWarn: number;
} {
  return {
    todoCritical: summary.todo.critical.count,
    todoWarn: summary.todo.warn.count,
    waitingCritical: summary.waiting.critical.count,
    waitingWarn: summary.waiting.warn.count,
    unassignedCritical: summary.unassigned.critical.count,
    unassignedWarn: summary.unassigned.warn.count,
  };
}

function pickTopLinks(summary: OpsSummary, topN: number): Array<{ title: string; items: Array<{ subject: string; elapsed: string; link: string }> }> {
  const out: Array<{ title: string; items: Array<{ subject: string; elapsed: string; link: string }> }> = [];

  const todoItems = [...summary.todo.critical.items, ...summary.todo.warn.items]
    .slice(0, topN)
    .map((x) => ({
      subject: x.subject || x.from || x.id,
      elapsed: x.elapsed,
      link: buildMailhubLink(x.id, "todo"),
    }));
  if (todoItems.length) out.push({ title: "Todo（要対応）", items: todoItems });

  const waitingItems = [...summary.waiting.critical.items, ...summary.waiting.warn.items]
    .slice(0, topN)
    .map((x) => ({
      subject: x.subject || x.from || x.id,
      elapsed: x.elapsed,
      link: buildMailhubLink(x.id, "waiting"),
    }));
  if (waitingItems.length) out.push({ title: "Waiting（保留/滞留）", items: waitingItems });

  const unassignedItems = [...summary.unassigned.critical.items, ...summary.unassigned.warn.items]
    .slice(0, topN)
    .map((x) => ({
      subject: x.subject || x.from || x.id,
      elapsed: x.elapsed,
      link: buildMailhubLink(x.id, "todo"),
    }));
  if (unassignedItems.length) out.push({ title: "Unassigned（未割当）", items: unassignedItems });

  return out;
}

export async function buildHandoffPreview(options: {
  userEmail: string;
  hours?: number;
  activityLimit?: number;
  opsTopN?: number;
}): Promise<HandoffPreview> {
  const generatedAt = new Date().toISOString();
  const env = getMailhubEnv();
  const envLabel = getMailhubEnvLabel(env);
  const readOnly = isReadOnlyMode();

  const opsSummary = await buildOpsSummary({ topN: 10 });

  const hours = options.hours ?? 24;
  const activityLimit = options.activityLimit ?? 10;

  const logs = await getActivityLogs({ limit: 200 });
  const cutoff = Date.now() - hours * 60 * 60 * 1000;

  const recent = logs.filter((l) => {
    const t = safeDateMs(l.timestamp);
    if (t === null) return false;
    return t >= cutoff;
  });

  const toItem = (l: AuditLogEntry): HandoffActivityItem => {
    const mailhubLink = l.messageId ? buildMailhubLink(l.messageId, "todo") : null;
    return {
      timestamp: l.timestamp,
      actorEmail: l.actorEmail,
      action: l.action,
      messageId: l.messageId,
      label: l.label,
      mailhubLink,
    };
  };

  const all = recent.slice(0, activityLimit).map(toItem);
  const mine = recent.filter((l) => l.actorEmail === options.userEmail).slice(0, activityLimit).map(toItem);

  const counts = opsCounts(opsSummary);
  const topLinks = pickTopLinks(opsSummary, options.opsTopN ?? 5);

  const mdLines: string[] = [];
  mdLines.push(`## 引き継ぎサマリ`);
  mdLines.push(`- generatedAt: ${generatedAt}`);
  mdLines.push(`- env: ${envLabel}`);
  mdLines.push(`- readOnly: ${readOnly ? "true" : "false"}`);
  mdLines.push(``);
  mdLines.push(`## Ops（SLA / 未割当 / 保留滞留）`);
  mdLines.push(`- Todo: 🔴${counts.todoCritical} / 🟡${counts.todoWarn}`);
  mdLines.push(`- Waiting: 🔴${counts.waitingCritical} / 🟡${counts.waitingWarn}`);
  mdLines.push(`- Unassigned: 🔴${counts.unassignedCritical} / 🟡${counts.unassignedWarn}`);
  mdLines.push(``);
  for (const section of topLinks) {
    mdLines.push(`### ${section.title}（上位${section.items.length}）`);
    for (const item of section.items) {
      mdLines.push(`- ${item.elapsed} | ${item.subject} | ${item.link}`);
    }
    mdLines.push(``);
  }
  mdLines.push(`## Activity（直近${hours}h / 上位${activityLimit}）`);
  mdLines.push(`### All`);
  if (all.length === 0) {
    mdLines.push(`- (no activity)`);
  } else {
    for (const a of all) {
      const who = a.actorEmail.split("@")[0] ?? a.actorEmail;
      const link = a.mailhubLink ? ` ${a.mailhubLink}` : "";
      mdLines.push(`- ${a.timestamp} | ${who} | ${a.action} | ${a.messageId}${link}`);
    }
  }
  mdLines.push(``);
  mdLines.push(`### Mine`);
  if (mine.length === 0) {
    mdLines.push(`- (no activity)`);
  } else {
    for (const a of mine) {
      const who = a.actorEmail.split("@")[0] ?? a.actorEmail;
      const link = a.mailhubLink ? ` ${a.mailhubLink}` : "";
      mdLines.push(`- ${a.timestamp} | ${who} | ${a.action} | ${a.messageId}${link}`);
    }
  }

  const markdown = mdLines.join("\n");

  return {
    generatedAt,
    env,
    envLabel,
    readOnly,
    opsSummary,
    activity: { all, mine },
    markdown,
  };
}

