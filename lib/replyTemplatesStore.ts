import "server-only";

import { join } from "path";
import { createConfigStore, type ConfigStore, type ConfigStoreType } from "@/lib/configStore";

export type ReplyTemplate = {
  id: string;
  title: string; // 表示名
  route?: "rakuten_rms" | "gmail" | "any"; // Step57: 対象ルート（フィルタ用、未指定はany）
  body: string; // テンプレ本文
  tags?: string[]; // 任意（amazon/rakuten等）
  updatedAt: string; // ISO
  updatedBy: string; // email
};

const FILE_PATH = join(process.cwd(), ".mailhub", "replyTemplates.json");
const MAX_BODY_LENGTH = 10000; // 安全上限
const HTML_TAG_RE = /<\/?[a-z][^>]*>/i;

function assertPlainTextTemplateBody(body: string): void {
  // Step57: テンプレはプレーンテキストのみ（HTMLは禁止）
  // 事故防止のため「タグっぽいもの」は弾く（<b> 等）
  if (HTML_TAG_RE.test(body)) {
    throw new Error("template_body_html_not_allowed");
  }
}

const DEFAULT_TEMPLATES: ReplyTemplate[] = [
  {
    id: "acknowledged",
    title: "受領しました",
    route: "any",
    body: "お問い合わせありがとうございます。\n内容を確認いたします。",
    updatedAt: new Date().toISOString(),
    updatedBy: "system",
  },
  {
    id: "checking",
    title: "確認して折り返します",
    route: "any",
    body: "ご連絡ありがとうございます。\n内容を確認の上、折り返しご連絡いたします。",
    updatedAt: new Date().toISOString(),
    updatedBy: "system",
  },
  {
    id: "need-info",
    title: "追加情報お願いします",
    route: "any",
    body: "ご連絡ありがとうございます。\nご回答のため、以下の情報をご提供いただけますでしょうか。\n\n・\n・\n・",
    updatedAt: new Date().toISOString(),
    updatedBy: "system",
  },
];

export interface ReplyTemplatesStore {
  list(): Promise<ReplyTemplate[]>;
  get(id: string): Promise<ReplyTemplate | null>;
  create(template: Omit<ReplyTemplate, "id" | "updatedAt" | "updatedBy"> & { id?: string }, updatedBy: string): Promise<ReplyTemplate>;
  update(id: string, updates: Partial<Omit<ReplyTemplate, "id" | "updatedAt" | "updatedBy">>, updatedBy: string): Promise<ReplyTemplate>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

function parseTemplates(raw: string): ReplyTemplate[] {
  const s = raw.trim();
  if (!s) return DEFAULT_TEMPLATES;
  try {
    const parsed = JSON.parse(s) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_TEMPLATES;
    return parsed
      .map((x) => {
        const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
        const routeRaw = typeof o.route === "string" ? o.route : "any";
        const route = routeRaw === "rakuten_rms" || routeRaw === "gmail" || routeRaw === "any" ? routeRaw : "any";
        const tags = o.tags && Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === "string") : undefined;
        return {
          id: typeof o.id === "string" ? o.id : "",
          title: typeof o.title === "string" ? o.title : "",
          route,
          body: typeof o.body === "string" ? o.body : "",
          ...(tags && tags.length > 0 ? { tags } : {}),
          updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : new Date().toISOString(),
          updatedBy: typeof o.updatedBy === "string" ? o.updatedBy : "unknown",
        } satisfies ReplyTemplate;
      })
      .filter((t) => t.id && t.title && t.body);
  } catch (e) {
    // 設定データは事故なので握りつぶさずエラーにする（health/UIで可視化）
    throw new Error(`config_json_corrupt_templates:${e instanceof Error ? e.message : String(e)}`);
  }
}

function serializeTemplates(data: ReplyTemplate[]): string {
  return JSON.stringify(data, null, 2);
}

function buildConfigStore(forceType?: ConfigStoreType): ConfigStore<ReplyTemplate[]> {
  return createConfigStore<ReplyTemplate[]>({
    key: "__mailhub_config_templates",
    empty: DEFAULT_TEMPLATES,
    forceType,
    file: {
      primaryPath: FILE_PATH,
      parse: parseTemplates,
      serialize: serializeTemplates,
    },
    sheets: {
      sheetName: "ConfigTemplates",
      sheetNameEnv: "MAILHUB_SHEETS_TAB_TEMPLATES",
      mode: "json_blob",
      toJson: (templates) => JSON.stringify(templates),
      fromJson: (json) => parseTemplates(json),
    },
  });
}

class Store implements ReplyTemplatesStore {
  constructor(private cfg: ConfigStore<ReplyTemplate[]>) {}

  async list(): Promise<ReplyTemplate[]> {
    const { data } = await this.cfg.read();
    return [...data];
  }

  async get(id: string): Promise<ReplyTemplate | null> {
    const templates = await this.list();
    return templates.find((t) => t.id === id) ?? null;
  }

  private async writeAll(templates: ReplyTemplate[]): Promise<void> {
    await this.cfg.write(templates);
  }

  async create(template: Omit<ReplyTemplate, "id" | "updatedAt" | "updatedBy"> & { id?: string }, updatedBy: string): Promise<ReplyTemplate> {
    if (template.body.length > MAX_BODY_LENGTH) {
      throw new Error(`template_body_too_long:${template.body.length} > ${MAX_BODY_LENGTH}`);
    }
    assertPlainTextTemplateBody(template.body);
    const cur = await this.list();
    const id = template.id ?? `template-${Date.now()}`;
    if (cur.some((t) => t.id === id)) {
      throw new Error(`template_already_exists:${id}`);
    }
    const now = new Date().toISOString();
    const newTemplate: ReplyTemplate = {
      ...template,
      route: template.route ?? "any",
      id,
      updatedAt: now,
      updatedBy,
    };
    await this.writeAll([...cur, newTemplate]);
    return newTemplate;
  }

  async update(id: string, updates: Partial<Omit<ReplyTemplate, "id" | "updatedAt" | "updatedBy">>, updatedBy: string): Promise<ReplyTemplate> {
    if (updates.body && updates.body.length > MAX_BODY_LENGTH) {
      throw new Error(`template_body_too_long:${updates.body.length} > ${MAX_BODY_LENGTH}`);
    }
    if (typeof updates.body === "string") {
      assertPlainTextTemplateBody(updates.body);
    }
    const cur = await this.list();
    const idx = cur.findIndex((t) => t.id === id);
    if (idx === -1) {
      throw new Error(`template_not_found:${id}`);
    }
    const updated: ReplyTemplate = {
      ...cur[idx],
      ...updates,
      route: (updates as Partial<ReplyTemplate>).route ?? cur[idx].route ?? "any",
      updatedAt: new Date().toISOString(),
      updatedBy,
    };
    const next = [...cur];
    next[idx] = updated;
    await this.writeAll(next);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const cur = await this.list();
    const filtered = cur.filter((t) => t.id !== id);
    if (filtered.length === cur.length) {
      throw new Error(`template_not_found:${id}`);
    }
    await this.writeAll(filtered);
  }

  async clear(): Promise<void> {
    await this.writeAll(DEFAULT_TEMPLATES);
  }
}

let _instance: ReplyTemplatesStore | null = null;

export function getReplyTemplatesStore(forceType?: ConfigStoreType): ReplyTemplatesStore {
  if (_instance && !forceType) return _instance;
  const cfg = buildConfigStore(forceType);
  _instance = new Store(cfg);
  return _instance;
}
