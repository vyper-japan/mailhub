import "server-only";

import { SLA_RULES, getSLAStatus } from "@/lib/slaRules";
import { listCandidatesByQuery } from "@/lib/gmail-alerts";
import { formatElapsedTime, getElapsedMs } from "@/lib/time-utils";

export type OpsSummaryItem = {
  id: string;
  subject: string | null;
  from: string | null;
  receivedAt: string;
  elapsed: string;
  status: "critical" | "warn";
  gmailLink: string | null;
};

export type OpsSummary = {
  todo: {
    critical: { count: number; items: OpsSummaryItem[] };
    warn: { count: number; items: OpsSummaryItem[] };
  };
  waiting: {
    critical: { count: number; items: OpsSummaryItem[] };
    warn: { count: number; items: OpsSummaryItem[] };
  };
  unassigned: {
    critical: { count: number; items: OpsSummaryItem[] };
    warn: { count: number; items: OpsSummaryItem[] };
  };
};

export async function buildOpsSummary(options?: {
  maxPages?: number;
  maxTotal?: number;
  topN?: number;
}): Promise<OpsSummary> {
  const { maxPages = 2, maxTotal = 50, topN = 10 } = options ?? {};

  const summary: OpsSummary = {
    todo: { critical: { count: 0, items: [] }, warn: { count: 0, items: [] } },
    waiting: { critical: { count: 0, items: [] }, warn: { count: 0, items: [] } },
    unassigned: { critical: { count: 0, items: [] }, warn: { count: 0, items: [] } },
  };

  for (const rule of SLA_RULES) {
    const { messages } = await listCandidatesByQuery({
      q: rule.gmailQuery,
      maxPages,
      maxTotal,
    });

    const critical: OpsSummaryItem[] = [];
    const warn: OpsSummaryItem[] = [];

    for (const msg of messages) {
      const status = getSLAStatus(msg.receivedAt, rule);
      if (status === "ok") continue;

      const elapsedMs = getElapsedMs(msg.receivedAt);
      const item: OpsSummaryItem = {
        id: msg.id,
        subject: msg.subject,
        from: msg.from,
        receivedAt: msg.receivedAt,
        elapsed: formatElapsedTime(elapsedMs),
        status,
        gmailLink: msg.gmailLink,
      };

      if (status === "critical") critical.push(item);
      else warn.push(item);
    }

    // 古い順
    critical.sort((a, b) => {
      try {
        return new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime();
      } catch {
        return 0;
      }
    });
    warn.sort((a, b) => {
      try {
        return new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime();
      } catch {
        return 0;
      }
    });

    const criticalTop = critical.slice(0, topN);
    const warnTop = warn.slice(0, topN);

    if (rule.type === "todo") {
      summary.todo.critical = { count: critical.length, items: criticalTop };
      summary.todo.warn = { count: warn.length, items: warnTop };
    } else if (rule.type === "waiting") {
      summary.waiting.critical = { count: critical.length, items: criticalTop };
      summary.waiting.warn = { count: warn.length, items: warnTop };
    } else {
      summary.unassigned.critical = { count: critical.length, items: criticalTop };
      summary.unassigned.warn = { count: warn.length, items: warnTop };
    }
  }

  return summary;
}

