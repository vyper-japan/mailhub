import "server-only";

import { join } from "path";
import { createConfigStore, type ConfigStore, type ConfigStoreType } from "@/lib/configStore";

export type RegisteredLabel = {
  labelName: string;
  /**
   * MailHub内での表示名（Gmailラベル名は変更しない安全弁）
   * 未指定の場合は labelName を表示名として扱う
   */
  displayName?: string;
  createdAt: string; // ISO
};

export interface LabelRegistryStore {
  list(): Promise<RegisteredLabel[]>;
  add(labelName: string, displayName?: string): Promise<RegisteredLabel[]>;
  remove(labelName: string): Promise<RegisteredLabel[]>;
  updateDisplayName(labelName: string, displayName: string): Promise<RegisteredLabel[]>;
  clear(): Promise<void>;
}

const FILE_PATH = join(process.cwd(), ".mailhub", "registered-labels.json");

function parseLabels(raw: string): RegisteredLabel[] {
  const s = raw.trim();
  if (!s) return [];
  try {
    const parsed = JSON.parse(s) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => {
        const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
        return {
          labelName: typeof o.labelName === "string" ? o.labelName : "",
          createdAt: typeof o.createdAt === "string" ? o.createdAt : "",
          displayName: typeof o.displayName === "string" ? o.displayName : undefined,
        } satisfies RegisteredLabel;
      })
      .filter((x) => x.labelName && x.createdAt);
  } catch (e) {
    // 設定データは事故なので握りつぶさずエラーにする（health/UIで可視化）
    throw new Error(`config_json_corrupt_labels:${e instanceof Error ? e.message : String(e)}`);
  }
}

function serializeLabels(data: RegisteredLabel[]): string {
  return JSON.stringify(data, null, 2);
}

function buildConfigStore(forceType?: ConfigStoreType): ConfigStore<RegisteredLabel[]> {
  return createConfigStore<RegisteredLabel[]>({
    key: "__mailhub_config_labels",
    empty: [],
    forceType,
    file: {
      primaryPath: FILE_PATH,
      parse: parseLabels,
      serialize: serializeLabels,
    },
    sheets: {
      sheetName: "ConfigLabels",
      sheetNameEnv: "MAILHUB_SHEETS_TAB_LABELS",
      mode: "json_blob",
      toJson: (labels) => JSON.stringify(labels),
      fromJson: (json) => parseLabels(json),
    },
  });
}

class Store implements LabelRegistryStore {
  constructor(private cfg: ConfigStore<RegisteredLabel[]>) {}

  async list(): Promise<RegisteredLabel[]> {
    const { data } = await this.cfg.read();
    return [...data];
  }

  async add(labelName: string, displayName?: string): Promise<RegisteredLabel[]> {
    const cur = await this.list();
    const idx = cur.findIndex((l) => l.labelName === labelName);
    if (idx === -1) {
      cur.push({ labelName, displayName: displayName?.trim() || undefined, createdAt: new Date().toISOString() });
    } else if (typeof displayName === "string") {
      cur[idx] = { ...cur[idx], displayName: displayName.trim() || undefined };
    }
    await this.cfg.write(cur);
    return cur;
  }

  async remove(labelName: string): Promise<RegisteredLabel[]> {
    const cur = await this.list();
    const next = cur.filter((l) => l.labelName !== labelName);
    await this.cfg.write(next);
    return next;
  }

  async updateDisplayName(labelName: string, displayName: string): Promise<RegisteredLabel[]> {
    const cur = await this.list();
    const idx = cur.findIndex((l) => l.labelName === labelName);
    if (idx >= 0) {
      cur[idx] = { ...cur[idx], displayName: displayName.trim() || undefined };
      await this.cfg.write(cur);
    }
    return cur;
  }

  async clear(): Promise<void> {
    await this.cfg.write([]);
  }
}

let instance: LabelRegistryStore | null = null;

export function getLabelRegistryStore(): LabelRegistryStore {
  if (instance) return instance;
  instance = new Store(buildConfigStore());
  return instance;
}

export async function resetRegisteredLabelsForTest(): Promise<void> {
  // E2EのbeforeEachで呼ばれる想定
  await getLabelRegistryStore().clear();
}

// Step25: Import用（現在のenvを無視してfileから読む）
export function getLabelRegistryFileStoreForImport(): LabelRegistryStore {
  return new Store(buildConfigStore("file"));
}

// Step25: Import実行用（まとめてwriteできるようにする）
export async function overwriteRegisteredLabelsForImport(labels: RegisteredLabel[]): Promise<void> {
  await buildConfigStore().write(labels);
}



