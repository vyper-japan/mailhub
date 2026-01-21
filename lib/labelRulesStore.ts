import "server-only";

import { join } from "path";
import { randomUUID } from "crypto";
import type { LabelRule, LabelRuleMatch, AssignToSpec } from "@/lib/labelRules";
import { createConfigStore, type ConfigStore, type ConfigStoreType } from "@/lib/configStore";

export interface LabelRulesStore {
  getRules(): Promise<LabelRule[]>;
  upsertRule(input: {
    id?: string;
    match: LabelRuleMatch;
    labelNames: string[];
    enabled?: boolean;
    assignTo?: AssignToSpec; // Step 83: Assignアクション
  }): Promise<LabelRule>;
  deleteRule(id: string): Promise<void>;
  toggleRule(id: string, enabled: boolean): Promise<void>;
  clear(): Promise<void>;
}

// Spec: .mailhub/labelRules.json
// Backward-compat: 旧ファイル（label-rules.json）も読み取り対象にする
const FILE_PATH = join(process.cwd(), ".mailhub", "labelRules.json");
const LEGACY_FILE_PATH = join(process.cwd(), ".mailhub", "label-rules.json");

function parseRules(raw: string): LabelRule[] {
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
        const matchRaw = o.match && typeof o.match === "object" ? (o.match as Record<string, unknown>) : {};
        const fromEmail = typeof matchRaw.fromEmail === "string" ? matchRaw.fromEmail : undefined;
        const fromDomain = typeof matchRaw.fromDomain === "string" ? matchRaw.fromDomain : undefined;
        const labelName = typeof o.labelName === "string" ? o.labelName : undefined;
        const labelNamesRaw = o.labelNames;
        const labelNames = Array.isArray(labelNamesRaw)
          ? labelNamesRaw.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
          : [];
        return {
          id,
          enabled,
          createdAt,
          match: { ...(fromEmail ? { fromEmail } : {}), ...(fromDomain ? { fromDomain } : {}) },
          ...(labelNames.length ? { labelNames } : {}),
          ...(labelName ? { labelName } : {}),
        } satisfies LabelRule;
      })
      .filter((r) => r.id);
  } catch (e) {
    // 設定データは事故なので握りつぶさずエラーにする（health/UIで可視化）
    throw new Error(`config_json_corrupt_rules:${e instanceof Error ? e.message : String(e)}`);
  }
}

function serializeRules(data: LabelRule[]): string {
  return JSON.stringify(data, null, 2);
}

function buildConfigStore(forceType?: ConfigStoreType): ConfigStore<LabelRule[]> {
  return createConfigStore<LabelRule[]>({
    key: "__mailhub_config_rules",
    empty: [],
    forceType,
    file: {
      primaryPath: FILE_PATH,
      legacyReadPaths: [LEGACY_FILE_PATH],
      parse: parseRules,
      serialize: serializeRules,
    },
    sheets: {
      sheetName: "ConfigRules",
      sheetNameEnv: "MAILHUB_SHEETS_TAB_RULES",
      mode: "json_blob",
      toJson: (rules) => JSON.stringify(rules),
      fromJson: (json) => parseRules(json),
    },
  });
}

class Store implements LabelRulesStore {
  constructor(private cfg: ConfigStore<LabelRule[]>) {}

  async getRules(): Promise<LabelRule[]> {
    const { data } = await this.cfg.read();
    return [...data];
  }

  private async writeAll(rules: LabelRule[]): Promise<void> {
    await this.cfg.write(rules);
  }

  async upsertRule(input: { id?: string; match: LabelRuleMatch; labelNames: string[]; enabled?: boolean; assignTo?: AssignToSpec }): Promise<LabelRule> {
    const cur = await this.getRules();
    const enabled = input.enabled ?? true;
    if (input.id) {
      const idx = cur.findIndex((r) => r.id === input.id);
      const next: LabelRule = {
        id: input.id,
        match: input.match,
        labelNames: input.labelNames,
        assignTo: input.assignTo, // Step 83
        enabled,
        createdAt: idx >= 0 ? cur[idx].createdAt : new Date().toISOString(),
      };
      if (idx >= 0) cur[idx] = next;
      else cur.push(next);
      await this.writeAll(cur);
      return next;
    }
    const rule: LabelRule = {
      id: randomUUID(),
      match: input.match,
      labelNames: input.labelNames,
      assignTo: input.assignTo, // Step 83
      enabled,
      createdAt: new Date().toISOString(),
    };
    cur.push(rule);
    await this.writeAll(cur);
    return rule;
  }

  async deleteRule(id: string): Promise<void> {
    const cur = await this.getRules();
    await this.writeAll(cur.filter((r) => r.id !== id));
  }

  async toggleRule(id: string, enabled: boolean): Promise<void> {
    const cur = await this.getRules();
    const idx = cur.findIndex((r) => r.id === id);
    if (idx >= 0) {
      cur[idx] = { ...cur[idx], enabled };
      await this.writeAll(cur);
    }
  }

  async clear(): Promise<void> {
    await this.writeAll([]);
  }
}

let instance: LabelRulesStore | null = null;

export function getLabelRulesStore(): LabelRulesStore {
  if (instance) return instance;
  instance = new Store(buildConfigStore());
  return instance;
}

export async function resetLabelRulesForTest(): Promise<void> {
  await getLabelRulesStore().clear();
}

// Step25: Import用（現在のenvを無視してfileから読む）
export function getLabelRulesFileStoreForImport(): LabelRulesStore {
  return new Store(buildConfigStore("file"));
}

// Step25: Import実行用（まとめてwriteできるようにする）
export async function overwriteLabelRulesForImport(rules: LabelRule[]): Promise<void> {
  await buildConfigStore().write(rules);
}


