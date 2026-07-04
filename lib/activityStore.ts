import "server-only";
import { isAuditAction, type AuditAction, type AuditLogEntry } from "./audit-log";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

export type ActivityStoreType = "memory" | "file" | "sheets";

export interface ActivityStore {
  append(entry: AuditLogEntry): Promise<void>;
  appendWithResult?(entry: AuditLogEntry): Promise<{ ok: boolean; error: string | null }>;
  list(options?: { limit?: number; actorEmail?: string; action?: string }): Promise<AuditLogEntry[]>;
  clear(): Promise<void>;
}

// MemoryStore（既定、リングバッファ）
const MAX_LOG_ENTRIES = 200;
let memoryBuffer: AuditLogEntry[] = [];

export class MemoryStore implements ActivityStore {
  async append(entry: AuditLogEntry): Promise<void> {
    memoryBuffer.push(entry);
    if (memoryBuffer.length > MAX_LOG_ENTRIES) {
      memoryBuffer = memoryBuffer.slice(-MAX_LOG_ENTRIES);
    }
  }

  async appendWithResult(entry: AuditLogEntry): Promise<{ ok: boolean; error: string | null }> {
    try {
      await this.append(entry);
      return { ok: true, error: null };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async list(options?: { limit?: number; actorEmail?: string; action?: string }): Promise<AuditLogEntry[]> {
    let logs = [...memoryBuffer].reverse(); // 新しい順

    if (options?.actorEmail) {
      logs = logs.filter((log) => log.actorEmail === options.actorEmail);
    }
    if (options?.action) {
      logs = logs.filter((log) => log.action === options.action);
    }

    const limit = options?.limit ?? MAX_LOG_ENTRIES;
    return logs.slice(0, limit);
  }

  async clear(): Promise<void> {
    memoryBuffer = [];
  }
}

// FileStore（ローカル/dev/CI専用、JSONL形式）
const FILE_STORE_PATH = join(process.cwd(), ".mailhub", "activity.jsonl");

export class FileStore implements ActivityStore {
  private async ensureDir(): Promise<void> {
    const dir = join(process.cwd(), ".mailhub");
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }

  async append(entry: AuditLogEntry): Promise<void> {
    await this.ensureDir();
    const line = JSON.stringify(entry) + "\n";
    await writeFile(FILE_STORE_PATH, line, { flag: "a" });
  }

  async appendWithResult(entry: AuditLogEntry): Promise<{ ok: boolean; error: string | null }> {
    try {
      await this.append(entry);
      return { ok: true, error: null };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async list(options?: { limit?: number; actorEmail?: string; action?: string }): Promise<AuditLogEntry[]> {
    await this.ensureDir();
    
    if (!existsSync(FILE_STORE_PATH)) {
      return [];
    }

    const content = await readFile(FILE_STORE_PATH, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    
    let logs: AuditLogEntry[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as AuditLogEntry;
        logs.push(entry);
      } catch {
        // パースエラーは無視
      }
    }

    logs = logs.reverse(); // 新しい順

    if (options?.actorEmail) {
      logs = logs.filter((log) => log.actorEmail === options.actorEmail);
    }
    if (options?.action) {
      logs = logs.filter((log) => log.action === options.action);
    }

    const limit = options?.limit ?? MAX_LOG_ENTRIES;
    return logs.slice(0, limit);
  }

  async clear(): Promise<void> {
    if (existsSync(FILE_STORE_PATH)) {
      await writeFile(FILE_STORE_PATH, "", "utf-8");
    }
  }
}

// SheetsStore（本番向け、Google Sheets）
export class SheetsStore implements ActivityStore {
  private spreadsheetId: string;
  private clientEmail: string;
  private privateKey: string;
  private sheetName: string;

  constructor(
    spreadsheetId: string,
    clientEmail: string,
    privateKey: string,
    sheetName: string = "Activity"
  ) {
    this.spreadsheetId = spreadsheetId;
    this.clientEmail = clientEmail;
    this.privateKey = privateKey.replace(/\\n/g, "\n");
    this.sheetName = sheetName;
  }

  private async getSheetsClient() {
    const { google } = await import("googleapis");
    const auth = new google.auth.JWT({
      email: this.clientEmail,
      key: this.privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    return google.sheets({ version: "v4", auth });
  }

  private async appendStrict(entry: AuditLogEntry): Promise<void> {
    const sheets = await this.getSheetsClient();
      
    // タイムアウト付きでbest-effort
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Sheets append timeout")), 3000)
    );

    // ヘッダー行の初期化（初回のみ）
    try {
      const headerCheck = await sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A1:J1`,
      });
      const header = headerCheck.data.values?.[0] || [];
      if (header.length === 0 || header[9] !== "reason") {
        await sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `${this.sheetName}!A1:J1`,
          valueInputOption: "RAW",
          requestBody: {
            values: [[
              "timeISO",
              "actor",
              "action",
              "messageId",
              "subject",
              "channel",
              "status",
              "label",
              "metaJSON",
              "reason",
            ]],
          },
        });
      }
    } catch {
      // ヘッダー初期化失敗は無視
    }

    await Promise.race([
      sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A:J`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: {
          values: [[
            entry.timestamp,
            entry.actorEmail,
            entry.action,
            entry.messageId,
            "", // subject (後でenrich)
            "", // channel (後でenrich)
            "", // status (後でenrich)
            entry.label || "",
            JSON.stringify(entry.metadata || {}),
            entry.reason || "",
          ]],
        },
      }),
      timeoutPromise,
    ]);
  }

  async append(entry: AuditLogEntry): Promise<void> {
    try {
      await this.appendStrict(entry);
    } catch (e) {
      // append失敗しても本体アクションは失敗させない（ログだけ落ちるのは許容）
      console.error("[SheetsStore] Failed to append:", e);
    }
  }

  async appendWithResult(entry: AuditLogEntry): Promise<{ ok: boolean; error: string | null }> {
    try {
      await this.appendStrict(entry);
      return { ok: true, error: null };
    } catch (e) {
      console.error("[SheetsStore] Failed to append:", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async list(options?: { limit?: number; actorEmail?: string; action?: string }): Promise<AuditLogEntry[]> {
    try {
      const sheets = await this.getSheetsClient();
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A:J`,
      });

      const rows = response.data.values || [];
      if (rows.length === 0) {
        return [];
      }

      // ヘッダ行をスキップ
      const dataRows = rows.slice(1);

      let logs: AuditLogEntry[] = [];
      for (const row of dataRows) {
        if (row.length < 6) continue;
        
        try {
          const actionRaw = String(row[2] || "");
          if (!isAuditAction(actionRaw)) continue;
          const isLegacyCompactRow = row.length < 9;
          const label = isLegacyCompactRow ? row[4] : row[7];
          const metadataRaw = isLegacyCompactRow ? row[5] : row[8];
          const reason = isLegacyCompactRow ? row[6] : row[9];
          let metadata: Record<string, unknown> | undefined;
          if (metadataRaw) {
            try {
              metadata = JSON.parse(String(metadataRaw)) as Record<string, unknown>;
            } catch {
              metadata = undefined;
            }
          }
          const entry: AuditLogEntry = {
            timestamp: row[0] || "",
            actorEmail: row[1] || "",
            action: actionRaw as AuditAction,
            messageId: row[3] || "",
            label: label || undefined,
            metadata,
            reason: reason || undefined,
          };
          logs.push(entry);
        } catch {
          // パースエラーは無視
        }
      }

      logs = logs.reverse(); // 新しい順

      if (options?.actorEmail) {
        logs = logs.filter((log) => log.actorEmail === options.actorEmail);
      }
      if (options?.action) {
        logs = logs.filter((log) => log.action === options.action);
      }

      const limit = options?.limit ?? MAX_LOG_ENTRIES;
      return logs.slice(0, limit);
    } catch (e) {
      console.error("[SheetsStore] Failed to list:", e);
      return [];
    }
  }

  async clear(): Promise<void> {
    // Sheetsのclearは実装しない（本番では削除しない）
    // TEST_MODEでは使わない想定
  }
}

// Storeインスタンスを取得（環境変数で選択）
let storeInstance: ActivityStore | null = null;

export function getRequestedActivityStoreType(): string {
  return (process.env.MAILHUB_ACTIVITY_STORE || "memory").trim();
}

function getActivitySheetsConfig(): { spreadsheetId: string | undefined; clientEmail: string | undefined; privateKey: string | undefined } {
  return {
    spreadsheetId: process.env.MAILHUB_SHEETS_SPREADSHEET_ID || process.env.MAILHUB_SHEETS_ID,
    clientEmail: process.env.MAILHUB_SHEETS_CLIENT_EMAIL,
    privateKey: process.env.MAILHUB_SHEETS_PRIVATE_KEY,
  };
}

export function getResolvedActivityStoreType(): ActivityStoreType {
  const requested = getRequestedActivityStoreType();
  if (requested === "file") return "file";
  if (requested === "sheets") {
    const { spreadsheetId, clientEmail, privateKey } = getActivitySheetsConfig();
    if (spreadsheetId && clientEmail && privateKey) return "sheets";
    return "memory";
  }
  return "memory";
}

export function getActivitySheetsConfigured(): boolean {
  const { spreadsheetId, clientEmail, privateKey } = getActivitySheetsConfig();
  return Boolean(
    spreadsheetId &&
      clientEmail &&
      privateKey,
  );
}

export function getActivityStore(): ActivityStore {
  if (storeInstance) {
    return storeInstance;
  }

  const storeType = getRequestedActivityStoreType();

  if (storeType === "file") {
    storeInstance = new FileStore();
  } else if (storeType === "sheets") {
    const { spreadsheetId, clientEmail, privateKey } = getActivitySheetsConfig();
    const sheetName = process.env.MAILHUB_SHEETS_SHEET_NAME || "Activity";

    if (!spreadsheetId || !clientEmail || !privateKey) {
      console.warn("[ActivityStore] Sheets config incomplete, falling back to MemoryStore");
      storeInstance = new MemoryStore();
    } else {
      storeInstance = new SheetsStore(spreadsheetId, clientEmail, privateKey, sheetName);
    }
  } else {
    storeInstance = new MemoryStore();
  }

  return storeInstance;
}
