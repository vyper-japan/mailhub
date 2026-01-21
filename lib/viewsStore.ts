import "server-only";

import { join } from "path";
import { createConfigStore, type ConfigStore, type ConfigStoreType } from "@/lib/configStore";
import { DEFAULT_VIEWS, type View } from "@/lib/views";

export interface ViewsStore {
  list(): Promise<View[]>;
  get(id: string): Promise<View | null>;
  create(view: Omit<View, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<View>;
  update(id: string, updates: Partial<Omit<View, "id" | "createdAt">>): Promise<View>;
  delete(id: string): Promise<void>;
  reorder(ids: string[]): Promise<void>;
  clear(): Promise<void>;
}

const FILE_PATH = join(process.cwd(), ".mailhub", "views.json");

function parseViews(raw: string): View[] {
  const s = raw.trim();
  if (!s) return DEFAULT_VIEWS;
  try {
    const parsed = JSON.parse(s) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_VIEWS;
    return parsed
      .map((x) => {
        const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
        return {
          id: typeof o.id === "string" ? o.id : "",
          name: typeof o.name === "string" ? o.name : "",
          icon: typeof o.icon === "string" ? o.icon : undefined,
          labelId: typeof o.labelId === "string" ? o.labelId : "all",
          q: typeof o.q === "string" ? o.q : undefined,
          assignee: o.assignee === "mine" || o.assignee === "unassigned" ? o.assignee : null,
          statusType: o.statusType === "todo" || o.statusType === "waiting" || o.statusType === "muted" ? o.statusType : null,
          pinned: typeof o.pinned === "boolean" ? o.pinned : false,
          order: typeof o.order === "number" ? o.order : 999,
          createdAt: typeof o.createdAt === "string" ? o.createdAt : new Date().toISOString(),
          updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : undefined,
        } satisfies View;
      })
      .filter((v) => v.id && v.name);
  } catch (e) {
    // 設定データは事故なので握りつぶさずエラーにする（health/UIで可視化）
    throw new Error(`config_json_corrupt_views:${e instanceof Error ? e.message : String(e)}`);
  }
}

function serializeViews(data: View[]): string {
  return JSON.stringify(data, null, 2);
}

function buildConfigStore(forceType?: ConfigStoreType): ConfigStore<View[]> {
  return createConfigStore<View[]>({
    key: "__mailhub_config_views",
    empty: DEFAULT_VIEWS,
    forceType,
    file: {
      primaryPath: FILE_PATH,
      parse: parseViews,
      serialize: serializeViews,
    },
    sheets: {
      sheetName: "ConfigViews",
      sheetNameEnv: "MAILHUB_SHEETS_TAB_VIEWS",
      mode: "json_blob",
      toJson: (views) => JSON.stringify(views),
      fromJson: (json) => parseViews(json),
    },
  });
}

class Store implements ViewsStore {
  constructor(private cfg: ConfigStore<View[]>) {}

  async list(): Promise<View[]> {
    const { data } = await this.cfg.read();
    // orderでソート（小さい順）
    return [...data].sort((a, b) => a.order - b.order);
  }

  async get(id: string): Promise<View | null> {
    const views = await this.list();
    return views.find((v) => v.id === id) ?? null;
  }

  private async writeAll(views: View[]): Promise<void> {
    await this.cfg.write(views);
  }

  async create(view: Omit<View, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<View> {
    const cur = await this.list();
    const id = view.id ?? `view-${Date.now()}`;
    if (cur.some((v) => v.id === id)) {
      throw new Error(`view_already_exists:${id}`);
    }
    const now = new Date().toISOString();
    const newView: View = {
      ...view,
      id,
      createdAt: now,
    };
    await this.writeAll([...cur, newView]);
    return newView;
  }

  async update(id: string, updates: Partial<Omit<View, "id" | "createdAt">>): Promise<View> {
    const cur = await this.list();
    const idx = cur.findIndex((v) => v.id === id);
    if (idx === -1) {
      throw new Error(`view_not_found:${id}`);
    }
    const updated: View = {
      ...cur[idx],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    const next = [...cur];
    next[idx] = updated;
    await this.writeAll(next);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const cur = await this.list();
    const filtered = cur.filter((v) => v.id !== id);
    if (filtered.length === cur.length) {
      throw new Error(`view_not_found:${id}`);
    }
    await this.writeAll(filtered);
  }

  async reorder(ids: string[]): Promise<void> {
    const cur = await this.list();
    const idSet = new Set(ids);
    const reordered: View[] = [];
    // 指定された順序で並べ替え
    for (let i = 0; i < ids.length; i++) {
      const view = cur.find((v) => v.id === ids[i]);
      if (view) {
        reordered.push({ ...view, order: i, updatedAt: new Date().toISOString() });
      }
    }
    // 残りのviewを末尾に追加（orderは大きめの値）
    for (const view of cur) {
      if (!idSet.has(view.id)) {
        reordered.push({ ...view, order: 999 + reordered.length });
      }
    }
    await this.writeAll(reordered);
  }

  async clear(): Promise<void> {
    await this.writeAll(DEFAULT_VIEWS);
  }
}

let _instance: ViewsStore | null = null;

export function getViewsStore(forceType?: ConfigStoreType): ViewsStore {
  if (_instance && !forceType) return _instance;
  const cfg = buildConfigStore(forceType);
  _instance = new Store(cfg);
  return _instance;
}
