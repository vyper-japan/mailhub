import "server-only";

import { join } from "path";
import { createConfigStore, type ConfigStore, type ConfigStoreType } from "@/lib/configStore";

/** 担当者名簿の1エントリ */
export type AssigneeEntry = {
  email: string;
  displayName?: string;
};

export interface AssigneeRegistryStore {
  /** 全担当者を取得（email昇順） */
  list(): Promise<AssigneeEntry[]>;
  /** 全置換（重複除去・昇順ソート済みで保存） */
  replaceAll(entries: AssigneeEntry[]): Promise<AssigneeEntry[]>;
  /** 全削除（テスト用） */
  clear(): Promise<void>;
}

const FILE_PATH = join(process.cwd(), ".mailhub", "assignees.json");
const ALLOWED_DOMAIN = "vtj.co.jp";

/** JSON parse helper */
export function parseAssignees(raw: string): AssigneeEntry[] {
  const s = raw.trim();
  if (!s) return [];
  try {
    const parsed = JSON.parse(s) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => {
        const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
        return {
          email: typeof o.email === "string" ? o.email.toLowerCase().trim() : "",
          displayName: typeof o.displayName === "string" ? o.displayName.trim() : undefined,
        } satisfies AssigneeEntry;
      })
      .filter((e) => e.email && e.email.includes("@"));
  } catch (e) {
    throw new Error(`config_json_corrupt_assignees:${e instanceof Error ? e.message : String(e)}`);
  }
}

function serializeAssignees(data: AssigneeEntry[]): string {
  return JSON.stringify(data, null, 2);
}

export function normalizeAssignees(entries: AssigneeEntry[]): AssigneeEntry[] {
  const seen = new Set<string>();
  const normalized: AssigneeEntry[] = [];
  for (const e of entries) {
    const email = e.email.toLowerCase().trim();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    normalized.push({
      email,
      displayName: e.displayName?.trim() || undefined,
    });
  }
  return normalized.sort((a, b) => a.email.localeCompare(b.email));
}

export function getInvalidAssigneeImportSourceEmails(entries: AssigneeEntry[]): string[] {
  return normalizeAssignees(entries)
    .filter((e) => !e.email.endsWith(`@${ALLOWED_DOMAIN}`))
    .map((e) => e.email);
}

function assertValidAssigneeImportSource(entries: AssigneeEntry[]): void {
  const invalidEmails = getInvalidAssigneeImportSourceEmails(entries);
  if (invalidEmails.length > 0) {
    throw new Error(`assignee_import_invalid_domain:${invalidEmails.join(",")}`);
  }
}

function buildConfigStore(forceType?: ConfigStoreType): ConfigStore<AssigneeEntry[]> {
  return createConfigStore<AssigneeEntry[]>({
    key: "__mailhub_config_assignees",
    empty: [],
    forceType,
    file: {
      primaryPath: FILE_PATH,
      parse: parseAssignees,
      serialize: serializeAssignees,
    },
    sheets: {
      sheetName: "ConfigAssignees",
      sheetNameEnv: "MAILHUB_SHEETS_TAB_ASSIGNEES",
      mode: "json_blob",
      toJson: (assignees) => JSON.stringify(assignees),
      fromJson: (json) => parseAssignees(json),
    },
  });
}

class Store implements AssigneeRegistryStore {
  constructor(private cfg: ConfigStore<AssigneeEntry[]>) {}

  async list(): Promise<AssigneeEntry[]> {
    const { data } = await this.cfg.read();
    return [...data].sort((a, b) => a.email.localeCompare(b.email));
  }

  async replaceAll(entries: AssigneeEntry[]): Promise<AssigneeEntry[]> {
    const normalized = normalizeAssignees(entries);

    // バリデーション: vtj.co.jpドメインのみ許可（正規化後にチェック）
    const invalidEntries = normalized.filter((e) => !e.email.endsWith(`@${ALLOWED_DOMAIN}`));
    if (invalidEntries.length > 0) {
      throw new Error(`assignee_invalid_domain:${invalidEntries.map((e) => e.email).join(",")}`);
    }

    await this.cfg.write(normalized);
    return normalized;
  }

  async clear(): Promise<void> {
    await this.cfg.write([]);
  }
}

let _instance: AssigneeRegistryStore | null = null;

export function getAssigneeRegistryStore(forceType?: ConfigStoreType): AssigneeRegistryStore {
  if (_instance && !forceType) return _instance;
  const cfg = buildConfigStore(forceType);
  _instance = new Store(cfg);
  return _instance;
}

export function getAssigneeRegistryFileStoreForImport(): AssigneeRegistryStore {
  return new Store(buildConfigStore("file"));
}

export async function overwriteAssigneesForImport(sourceEntries: AssigneeEntry[], targetEntries: AssigneeEntry[]): Promise<AssigneeEntry[]> {
  const normalizedSource = normalizeAssignees(sourceEntries);
  assertValidAssigneeImportSource(normalizedSource);

  const merged = new Map<string, AssigneeEntry>();
  for (const entry of normalizeAssignees(targetEntries)) {
    merged.set(entry.email, entry);
  }
  for (const entry of normalizedSource) {
    merged.set(entry.email, entry);
  }

  const next = [...merged.values()].sort((a, b) => a.email.localeCompare(b.email));
  await buildConfigStore().write(next);
  return next;
}

/** テスト用: インスタンスをリセット */
export function resetAssigneeRegistryStore(): void {
  _instance = null;
}
