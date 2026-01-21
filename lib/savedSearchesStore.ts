import "server-only";

import { join } from "path";
import { randomUUID } from "crypto";
import { createConfigStore, type ConfigStore, type ConfigStoreType } from "@/lib/configStore";
import type { SavedSearch } from "@/lib/savedSearches";

export interface SavedSearchesStore {
  list(): Promise<SavedSearch[]>;
  get(id: string): Promise<SavedSearch | null>;
  create(input: { name: string; query: string; baseLabelId?: string | null }): Promise<SavedSearch>;
  update(id: string, updates: Partial<Omit<SavedSearch, "id" | "createdAt">>): Promise<SavedSearch>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

// Spec: .mailhub/savedSearches.json
const FILE_PATH = join(process.cwd(), ".mailhub", "savedSearches.json");

function parseSearches(raw: string): SavedSearch[] {
  const s = raw.trim();
  if (!s) return [];
  try {
    const parsed = JSON.parse(s) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
      .map((o) => {
        const id = typeof o.id === "string" ? o.id : "";
        const name = typeof o.name === "string" ? o.name : "";
        const query = typeof o.query === "string" ? o.query : "";
        const baseLabelId = typeof o.baseLabelId === "string" ? o.baseLabelId : o.baseLabelId === null ? null : undefined;
        const createdAt = typeof o.createdAt === "string" ? o.createdAt : new Date().toISOString();
        const updatedAt = typeof o.updatedAt === "string" ? o.updatedAt : undefined;

        if (!id || !name || !query) return null;

        const result: SavedSearch = {
          id,
          name,
          query,
          baseLabelId: baseLabelId ?? null,
          createdAt,
        };
        if (updatedAt) {
          result.updatedAt = updatedAt;
        }
        return result;
      })
      .filter((s): s is SavedSearch => s !== null);
  } catch (e) {
    throw new Error(`config_json_corrupt_saved_searches:${e instanceof Error ? e.message : String(e)}`);
  }
}

function serializeSearches(data: SavedSearch[]): string {
  return JSON.stringify(data, null, 2);
}

function buildConfigStore(forceType?: ConfigStoreType): ConfigStore<SavedSearch[]> {
  return createConfigStore<SavedSearch[]>({
    key: "__mailhub_config_saved_searches",
    empty: [],
    forceType,
    file: {
      primaryPath: FILE_PATH,
      parse: parseSearches,
      serialize: serializeSearches,
    },
    sheets: {
      sheetName: "ConfigSavedSearches",
      sheetNameEnv: "MAILHUB_SHEETS_TAB_SAVED_SEARCHES",
      mode: "json_blob",
      toJson: (searches) => JSON.stringify(searches),
      fromJson: (json) => parseSearches(json),
    },
  });
}

class Store implements SavedSearchesStore {
  constructor(private cfg: ConfigStore<SavedSearch[]>) {}

  async list(): Promise<SavedSearch[]> {
    const { data } = await this.cfg.read();
    return [...data];
  }

  async get(id: string): Promise<SavedSearch | null> {
    const searches = await this.list();
    return searches.find((s) => s.id === id) ?? null;
  }

  private async writeAll(searches: SavedSearch[]): Promise<void> {
    await this.cfg.write(searches);
  }

  async create(input: { name: string; query: string; baseLabelId?: string | null }): Promise<SavedSearch> {
    // バリデーション
    const name = input.name.trim();
    if (name.length < 1 || name.length > 40) {
      throw new Error("invalid_name_length");
    }
    const query = input.query.trim().replace(/\n/g, "");
    if (query.length < 1 || query.length > 500) {
      throw new Error("invalid_query_length");
    }

    const cur = await this.list();
    if (cur.length >= 50) {
      throw new Error("max_searches_exceeded");
    }

    const id = `search-${randomUUID()}`;
    const now = new Date().toISOString();
    const newSearch: SavedSearch = {
      id,
      name,
      query,
      baseLabelId: input.baseLabelId ?? null,
      createdAt: now,
    };
    await this.writeAll([...cur, newSearch]);
    return newSearch;
  }

  async update(id: string, updates: Partial<Omit<SavedSearch, "id" | "createdAt">>): Promise<SavedSearch> {
    const cur = await this.list();
    const idx = cur.findIndex((s) => s.id === id);
    if (idx === -1) {
      throw new Error(`search_not_found:${id}`);
    }

    // バリデーション
    if (updates.name !== undefined) {
      const name = updates.name.trim();
      if (name.length < 1 || name.length > 40) {
        throw new Error("invalid_name_length");
      }
    }
    if (updates.query !== undefined) {
      const query = updates.query.trim().replace(/\n/g, "");
      if (query.length < 1 || query.length > 500) {
        throw new Error("invalid_query_length");
      }
    }

    const updated: SavedSearch = {
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
    const filtered = cur.filter((s) => s.id !== id);
    if (filtered.length === cur.length) {
      throw new Error(`search_not_found:${id}`);
    }
    await this.writeAll(filtered);
  }

  async clear(): Promise<void> {
    await this.writeAll([]);
  }
}

let _instance: SavedSearchesStore | null = null;

export function getSavedSearchesStore(forceType?: ConfigStoreType): SavedSearchesStore {
  if (_instance && !forceType) return _instance;
  const cfg = buildConfigStore(forceType);
  _instance = new Store(cfg);
  return _instance;
}
