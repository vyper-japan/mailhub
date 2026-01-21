import "server-only";

import { join } from "path";
import { createConfigStore, type ConfigStore, type ConfigStoreType } from "@/lib/configStore";

export type MessageNote = {
  body: string;
  updatedAt: string; // ISO
  updatedBy: string; // email
};

export type MessageNotes = Record<string, MessageNote>; // messageId -> Note

export interface MessageNotesStore {
  get(messageId: string): Promise<MessageNote | null>;
  set(messageId: string, body: string, updatedBy: string): Promise<void>;
  delete(messageId: string): Promise<void>;
  list(): Promise<MessageNotes>;
  clear(): Promise<void>;
}

const FILE_PATH = join(process.cwd(), ".mailhub", "messageNotes.json");
const MAX_BODY_LENGTH = 4000; // 安全上限

function parseNotes(raw: string): MessageNotes {
  const s = raw.trim();
  if (!s) return {};
  try {
    const parsed = JSON.parse(s) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const result: MessageNotes = {};
    for (const [messageId, noteRaw] of Object.entries(parsed)) {
      if (typeof messageId !== "string" || !messageId.trim()) continue;
      const note = noteRaw && typeof noteRaw === "object" ? (noteRaw as Record<string, unknown>) : {};
      const body = typeof note.body === "string" ? note.body : "";
      const updatedAt = typeof note.updatedAt === "string" ? note.updatedAt : new Date().toISOString();
      const updatedBy = typeof note.updatedBy === "string" ? note.updatedBy : "";
      // 空文字は削除扱い（保存しない）
      if (body.trim() && updatedBy) {
        result[messageId] = { body: body.trim(), updatedAt, updatedBy };
      }
    }
    return result;
  } catch (e) {
    // JSON破損時はサイレントに空オブジェクトを返す（ログのみ）
    console.warn("[messageNotesStore] JSON parse failed, returning empty:", e);
    return {};
  }
}

function serializeNotes(data: MessageNotes): string {
  return JSON.stringify(data, null, 2);
}

function buildConfigStore(forceType?: ConfigStoreType): ConfigStore<MessageNotes> {
  return createConfigStore<MessageNotes>({
    key: "__mailhub_config_notes",
    empty: {},
    forceType,
    file: {
      primaryPath: FILE_PATH,
      parse: parseNotes,
      serialize: serializeNotes,
    },
    sheets: {
      sheetName: "ConfigNotes",
      sheetNameEnv: "MAILHUB_SHEETS_TAB_NOTES",
      mode: "json_blob",
      toJson: (notes) => JSON.stringify(notes),
      fromJson: (json) => parseNotes(json),
    },
  });
}

class Store implements MessageNotesStore {
  constructor(private cfg: ConfigStore<MessageNotes>) {}

  async list(): Promise<MessageNotes> {
    const { data } = await this.cfg.read();
    return { ...data };
  }

  async get(messageId: string): Promise<MessageNote | null> {
    const notes = await this.list();
    return notes[messageId] ?? null;
  }

  private async writeAll(notes: MessageNotes): Promise<void> {
    await this.cfg.write(notes);
  }

  async set(messageId: string, body: string, updatedBy: string): Promise<void> {
    if (body.length > MAX_BODY_LENGTH) {
      throw new Error(`note_body_too_long:${body.length} > ${MAX_BODY_LENGTH}`);
    }
    const cur = await this.list();
    const trimmed = body.trim();
    if (!trimmed) {
      // 空文字は削除扱い
      await this.delete(messageId);
      return;
    }
    const updated: MessageNotes = {
      ...cur,
      [messageId]: {
        body: trimmed,
        updatedAt: new Date().toISOString(),
        updatedBy,
      },
    };
    await this.writeAll(updated);
  }

  async delete(messageId: string): Promise<void> {
    const cur = await this.list();
    if (!(messageId in cur)) return;
    const updated = { ...cur };
    delete updated[messageId];
    await this.writeAll(updated);
  }

  async clear(): Promise<void> {
    await this.writeAll({});
  }
}

let _instance: MessageNotesStore | null = null;

export function getMessageNotesStore(forceType?: ConfigStoreType): MessageNotesStore {
  if (_instance && !forceType) return _instance;
  const cfg = buildConfigStore(forceType);
  _instance = new Store(cfg);
  return _instance;
}
