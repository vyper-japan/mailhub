import "server-only";

import { join } from "path";
import { createConfigStore, type ConfigStore, type ConfigStoreType } from "@/lib/configStore";

export interface RosterStore {
  get(): Promise<string[]>;
  set(emails: string[]): Promise<void>;
}

const FILE_PATH = join(process.cwd(), ".mailhub", "roster.json");

// テスト用にexport（カバレッジ向上のため）
export function parseRoster(raw: string): string[] {
  const s = raw.trim();
  if (!s) return [];
  try {
    const parsed = JSON.parse(s) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => (typeof x === "string" ? x.toLowerCase().trim() : ""))
      .filter((email) => email && email.includes("@") && email.endsWith("@vtj.co.jp"));
  } catch (e) {
    throw new Error(`config_json_corrupt_roster:${e instanceof Error ? e.message : String(e)}`);
  }
}

function serializeRoster(data: string[]): string {
  return JSON.stringify(data, null, 2);
}

function buildConfigStore(forceType?: ConfigStoreType): ConfigStore<string[]> {
  return createConfigStore<string[]>({
    key: "__mailhub_config_roster",
    empty: [],
    forceType,
    file: {
      primaryPath: FILE_PATH,
      parse: parseRoster,
      serialize: serializeRoster,
    },
    sheets: {
      sheetName: "ConfigRoster",
      sheetNameEnv: "MAILHUB_SHEETS_TAB_ROSTER",
      mode: "json_blob",
      toJson: (roster) => JSON.stringify(roster),
      fromJson: (json) => parseRoster(json),
    },
  });
}

class Store implements RosterStore {
  constructor(private cfg: ConfigStore<string[]>) {}

  async get(): Promise<string[]> {
    const { data } = await this.cfg.read();
    // 重複除去と正規化
    const normalized = data
      .map((email) => email.toLowerCase().trim())
      .filter((email) => email && email.includes("@") && email.endsWith("@vtj.co.jp"));
    const unique = Array.from(new Set(normalized));
    return unique.sort();
  }

  async set(emails: string[]): Promise<void> {
    // vtj.co.jpのみ許可、重複除去、正規化
    const normalized = emails
      .map((email) => email.toLowerCase().trim())
      .filter((email) => email && email.includes("@") && email.endsWith("@vtj.co.jp"));
    const unique = Array.from(new Set(normalized));
    await this.cfg.write(unique.sort());
  }
}

let _instance: RosterStore | null = null;

export function getRosterStore(forceType?: ConfigStoreType): RosterStore {
  if (_instance && !forceType) return _instance;
  const cfg = buildConfigStore(forceType);
  _instance = new Store(cfg);
  return _instance;
}
