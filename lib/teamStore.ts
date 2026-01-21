import "server-only";

import { join } from "path";
import { createConfigStore, type ConfigStore, type ConfigStoreType } from "@/lib/configStore";

export type TeamMember = {
  email: string;
  name: string | null;
  createdAt: string;
  updatedAt?: string;
};

export interface TeamStore {
  list(): Promise<TeamMember[]>;
  get(email: string): Promise<TeamMember | null>;
  create(member: Omit<TeamMember, "createdAt" | "updatedAt">): Promise<TeamMember>;
  update(email: string, updates: Partial<Omit<TeamMember, "email" | "createdAt">>): Promise<TeamMember>;
  delete(email: string): Promise<void>;
  clear(): Promise<void>;
}

const FILE_PATH = join(process.cwd(), ".mailhub", "team.json");

// テスト用にexport（カバレッジ向上のため）
export function parseTeam(raw: string): TeamMember[] {
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
          name: typeof o.name === "string" ? o.name.trim() : null,
          createdAt: typeof o.createdAt === "string" ? o.createdAt : new Date().toISOString(),
          updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : undefined,
        } satisfies TeamMember;
      })
      .filter((m) => m.email && m.email.includes("@"));
  } catch (e) {
    throw new Error(`config_json_corrupt_team:${e instanceof Error ? e.message : String(e)}`);
  }
}

function serializeTeam(data: TeamMember[]): string {
  return JSON.stringify(data, null, 2);
}

function buildConfigStore(forceType?: ConfigStoreType): ConfigStore<TeamMember[]> {
  return createConfigStore<TeamMember[]>({
    key: "__mailhub_config_team",
    empty: [],
    forceType,
    file: {
      primaryPath: FILE_PATH,
      parse: parseTeam,
      serialize: serializeTeam,
    },
    sheets: {
      sheetName: "ConfigTeam",
      sheetNameEnv: "MAILHUB_SHEETS_TAB_TEAM",
      mode: "json_blob",
      toJson: (team) => JSON.stringify(team),
      fromJson: (json) => parseTeam(json),
    },
  });
}

class Store implements TeamStore {
  constructor(private cfg: ConfigStore<TeamMember[]>) {}

  async list(): Promise<TeamMember[]> {
    const { data } = await this.cfg.read();
    return [...data].sort((a, b) => {
      // 名前があれば名前順、なければメール順
      const aName = a.name || a.email;
      const bName = b.name || b.email;
      return aName.localeCompare(bName);
    });
  }

  async get(email: string): Promise<TeamMember | null> {
    const team = await this.list();
    const normalized = email.toLowerCase().trim();
    return team.find((m) => m.email.toLowerCase() === normalized) ?? null;
  }

  private async writeAll(team: TeamMember[]): Promise<void> {
    await this.cfg.write(team);
  }

  async create(member: Omit<TeamMember, "createdAt" | "updatedAt">): Promise<TeamMember> {
    const cur = await this.list();
    const normalized = member.email.toLowerCase().trim();
    if (cur.some((m) => m.email.toLowerCase() === normalized)) {
      throw new Error(`team_member_already_exists:${normalized}`);
    }
    const now = new Date().toISOString();
    const newMember: TeamMember = {
      email: normalized,
      name: member.name?.trim() || null,
      createdAt: now,
    };
    await this.writeAll([...cur, newMember]);
    return newMember;
  }

  async update(email: string, updates: Partial<Omit<TeamMember, "email" | "createdAt">>): Promise<TeamMember> {
    const cur = await this.list();
    const normalized = email.toLowerCase().trim();
    const idx = cur.findIndex((m) => m.email.toLowerCase() === normalized);
    if (idx === -1) {
      throw new Error(`team_member_not_found:${normalized}`);
    }
    const updated: TeamMember = {
      ...cur[idx],
      ...updates,
      name: updates.name !== undefined ? (updates.name?.trim() || null) : cur[idx].name,
      updatedAt: new Date().toISOString(),
    };
    const next = [...cur];
    next[idx] = updated;
    await this.writeAll(next);
    return updated;
  }

  async delete(email: string): Promise<void> {
    const cur = await this.list();
    const normalized = email.toLowerCase().trim();
    const filtered = cur.filter((m) => m.email.toLowerCase() !== normalized);
    if (filtered.length === cur.length) {
      throw new Error(`team_member_not_found:${normalized}`);
    }
    await this.writeAll(filtered);
  }

  async clear(): Promise<void> {
    await this.writeAll([]);
  }
}

let _instance: TeamStore | null = null;

export function getTeamStore(forceType?: ConfigStoreType): TeamStore {
  if (_instance && !forceType) return _instance;
  const cfg = buildConfigStore(forceType);
  _instance = new Store(cfg);
  return _instance;
}
