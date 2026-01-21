import "server-only";

import { join } from "path";
import { randomUUID } from "crypto";
import { createConfigStore, type ConfigStore, type ConfigStoreType } from "@/lib/configStore";
import type { AssigneeRule } from "@/lib/assigneeRules";
import { normalizeDomain, normalizeVtjEmail } from "@/lib/assigneeRules";
import { normalizeFromEmail } from "@/lib/labelRules";

export interface AssigneeRulesStore {
  getRules(): Promise<AssigneeRule[]>;
  upsertRule(input: {
    id?: string;
    enabled?: boolean;
    priority: number;
    match: { fromEmail?: string; fromDomain?: string };
    assigneeEmail: string;
    unassignedOnly?: boolean;
    dangerousDomainConfirm?: boolean;
  }): Promise<AssigneeRule>;
  deleteRule(id: string): Promise<void>;
  clear(): Promise<void>;
}

// Spec: .mailhub/assigneeRules.json
const FILE_PATH = join(process.cwd(), ".mailhub", "assigneeRules.json");

function parseRules(raw: string): AssigneeRule[] {
  const s = raw.trim();
  if (!s) return [];
  try {
    const parsed = JSON.parse(s) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
      .map((o) => {
        const id = typeof o.id === "string" ? o.id : "";
        const enabled = typeof o.enabled === "boolean" ? o.enabled : true;
        const createdAt = typeof o.createdAt === "string" ? o.createdAt : new Date().toISOString();
        const updatedAt = typeof o.updatedAt === "string" ? o.updatedAt : undefined;
        const priority = typeof o.priority === "number" && Number.isFinite(o.priority) ? o.priority : 0;

        const matchRaw = o.match && typeof o.match === "object" ? (o.match as Record<string, unknown>) : {};
        const fromEmailRaw = typeof matchRaw.fromEmail === "string" ? matchRaw.fromEmail : undefined;
        const fromDomainRaw = typeof matchRaw.fromDomain === "string" ? matchRaw.fromDomain : undefined;
        const fromEmail = fromEmailRaw ? normalizeFromEmail(fromEmailRaw) : null;
        const fromDomain = fromDomainRaw ? normalizeDomain(fromDomainRaw) : null;

        const assigneeEmailRaw = typeof o.assigneeEmail === "string" ? o.assigneeEmail : "";
        const assigneeEmail = normalizeVtjEmail(assigneeEmailRaw);

        const whenRaw = o.when && typeof o.when === "object" ? (o.when as Record<string, unknown>) : {};
        const unassignedOnly = whenRaw.unassignedOnly !== false; // default true

        const safetyRaw = o.safety && typeof o.safety === "object" ? (o.safety as Record<string, unknown>) : {};
        const dangerousDomainConfirm = safetyRaw.dangerousDomainConfirm === true;

        if (!id) return null;
        if (!assigneeEmail) return null;
        if (!fromEmail && !fromDomain) return null;

        return {
          id,
          enabled,
          priority,
          match: { ...(fromEmail ? { fromEmail } : {}), ...(fromDomain ? { fromDomain } : {}) },
          assigneeEmail,
          when: { unassignedOnly },
          safety: { dangerousDomainConfirm },
          createdAt,
          ...(updatedAt ? { updatedAt } : {}),
        } satisfies AssigneeRule;
      })
      .filter((r): r is AssigneeRule => Boolean(r));
  } catch (e) {
    throw new Error(`config_json_corrupt_assignee_rules:${e instanceof Error ? e.message : String(e)}`);
  }
}

function serializeRules(data: AssigneeRule[]): string {
  return JSON.stringify(data, null, 2);
}

function buildConfigStore(forceType?: ConfigStoreType): ConfigStore<AssigneeRule[]> {
  return createConfigStore<AssigneeRule[]>({
    key: "__mailhub_config_assignee_rules",
    empty: [],
    forceType,
    file: {
      primaryPath: FILE_PATH,
      legacyReadPaths: [],
      parse: parseRules,
      serialize: serializeRules,
    },
    sheets: {
      sheetName: "ConfigAssigneeRules",
      sheetNameEnv: "MAILHUB_SHEETS_TAB_ASSIGNEE_RULES",
      mode: "json_blob",
      toJson: (rules) => JSON.stringify(rules),
      fromJson: (json) => parseRules(json),
    },
  });
}

class Store implements AssigneeRulesStore {
  constructor(private cfg: ConfigStore<AssigneeRule[]>) {}

  async getRules(): Promise<AssigneeRule[]> {
    const { data } = await this.cfg.read();
    return [...data];
  }

  private async writeAll(rules: AssigneeRule[]): Promise<void> {
    await this.cfg.write(rules);
  }

  async upsertRule(input: {
    id?: string;
    enabled?: boolean;
    priority: number;
    match: { fromEmail?: string; fromDomain?: string };
    assigneeEmail: string;
    unassignedOnly?: boolean;
    dangerousDomainConfirm?: boolean;
  }): Promise<AssigneeRule> {
    const assigneeEmail = normalizeVtjEmail(input.assigneeEmail);
    if (!assigneeEmail) throw new Error("invalid_assignee_email");

    const fromEmail = typeof input.match.fromEmail === "string" ? normalizeFromEmail(input.match.fromEmail) : null;
    const fromDomain = typeof input.match.fromDomain === "string" ? normalizeDomain(input.match.fromDomain) : null;
    if (!fromEmail && !fromDomain) throw new Error("missing_match");

    const enabled = input.enabled ?? true;
    const unassignedOnly = input.unassignedOnly !== false;
    const dangerousDomainConfirm = input.dangerousDomainConfirm === true;
    const priority = Number.isFinite(input.priority) ? input.priority : 0;

    const cur = await this.getRules();
    const now = new Date().toISOString();

    if (input.id) {
      const idx = cur.findIndex((r) => r.id === input.id);
      const next: AssigneeRule = {
        id: input.id,
        enabled,
        priority,
        match: { ...(fromEmail ? { fromEmail } : {}), ...(fromDomain ? { fromDomain } : {}) },
        assigneeEmail,
        when: { unassignedOnly },
        safety: { dangerousDomainConfirm },
        createdAt: idx >= 0 ? cur[idx].createdAt : now,
        updatedAt: now,
      };
      if (idx >= 0) cur[idx] = next;
      else cur.push(next);
      await this.writeAll(cur);
      return next;
    }

    const rule: AssigneeRule = {
      id: randomUUID(),
      enabled,
      priority,
      match: { ...(fromEmail ? { fromEmail } : {}), ...(fromDomain ? { fromDomain } : {}) },
      assigneeEmail,
      when: { unassignedOnly },
      safety: { dangerousDomainConfirm },
      createdAt: now,
      updatedAt: now,
    };
    cur.push(rule);
    await this.writeAll(cur);
    return rule;
  }

  async deleteRule(id: string): Promise<void> {
    const cur = await this.getRules();
    await this.writeAll(cur.filter((r) => r.id !== id));
  }

  async clear(): Promise<void> {
    await this.writeAll([]);
  }
}

let instance: AssigneeRulesStore | null = null;

export function getAssigneeRulesStore(): AssigneeRulesStore {
  if (instance) return instance;
  instance = new Store(buildConfigStore());
  return instance;
}

export async function resetAssigneeRulesForTest(): Promise<void> {
  await getAssigneeRulesStore().clear();
}

