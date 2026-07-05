import { existsSync } from "fs";
import { mkdir, readFile, stat, open, rename } from "fs/promises";
import { join } from "path";
import { isTestMode } from "@/lib/test-mode";

export type ConfigStoreType = "memory" | "file" | "sheets";

export type ConfigHealth = {
  storeType: ConfigStoreType;
  ok: boolean;
  detail?: string;
  lastUpdatedAt?: string | null;
};

export type ConfigReadResult<T> = {
  data: T;
  lastUpdatedAt: string | null;
  source: ConfigStoreType;
};

export interface ConfigStore<T> {
  read(): Promise<ConfigReadResult<T>>;
  write(data: T): Promise<void>; // 設定データはsilent禁止（失敗はthrow）
  health(): Promise<ConfigHealth>;
}

type FileBackendOpts<T> = {
  primaryPath: string;
  legacyReadPaths?: string[];
  parse: (raw: string) => T;
  serialize: (data: T) => string;
};

type SheetsBackendOpts<T> = {
  spreadsheetId: string;
  clientEmail: string;
  privateKey: string;
  sheetName: string;
  /**
   * table: 行ベース（人間が編集しやすいが、整合性確保が難しい）
   * json_blob: A1:B2 を一括update（JSON + updatedAt）で原子性を担保
   */
  mode: "table" | "json_blob";
  // table
  headers?: string[];
  toRows?: (data: T) => string[][];
  fromRows?: (rows: string[][]) => T;
  // json_blob
  toJson?: (data: T) => string;
  fromJson?: (json: string) => T;
};

export function getResolvedConfigStoreType(): ConfigStoreType {
  if (isTestMode()) return "memory";
  const explicit = (process.env.MAILHUB_CONFIG_STORE ?? "").trim();
  if (explicit === "memory" || explicit === "file" || explicit === "sheets") return explicit;
  return process.env.NODE_ENV === "production" ? "sheets" : "file";
}

export function getResolvedSheetsConfig(): { spreadsheetId: string | null; clientEmail: string | null; privateKey: string | null } {
  const spreadsheetId =
    process.env.MAILHUB_SHEETS_ID ??
    process.env.MAILHUB_SHEETS_SPREADSHEET_ID ??
    null;
  const clientEmail = process.env.MAILHUB_SHEETS_CLIENT_EMAIL ?? null;
  const privateKey = process.env.MAILHUB_SHEETS_PRIVATE_KEY ?? null;
  return { spreadsheetId, clientEmail, privateKey };
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  const timeout = new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label}_timeout`)), ms));
  return await Promise.race([p, timeout]);
}

const writeTimeoutDrains = new WeakMap<Error, Promise<void>>();

function getWriteTimeoutDrain(e: unknown): Promise<void> | null {
  return e instanceof Error ? writeTimeoutDrains.get(e) ?? null : null;
}

async function withWriteTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  try {
    return await withTimeout(p, ms, label);
  } catch (e) {
    if (e instanceof Error && e.message === `${label}_timeout`) {
      writeTimeoutDrains.set(e, p.then(() => undefined, () => undefined));
    }
    throw e;
  }
}

const SHEETS_READ_CACHE_TTL_MS = 20_000;

type SheetsReadOptions = {
  bypassCache?: boolean;
};

type SheetsReadCacheEntry<T> = {
  result: ConfigReadResult<T>;
  expiresAt: number;
  epoch: number;
};

type SheetsReadInFlight<T> = {
  promise: Promise<ConfigReadResult<T>>;
  epoch: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function getNumericStatus(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function getSheetsErrorStatus(e: unknown): number | null {
  const err = asRecord(e);
  if (!err) return null;
  const direct = getNumericStatus(err.code) ?? getNumericStatus(err.status);
  if (direct !== null) return direct;

  const response = asRecord(err.response);
  const responseStatus = getNumericStatus(response?.status);
  if (responseStatus !== null) return responseStatus;

  const data = asRecord(response?.data);
  const dataError = asRecord(data?.error);
  return getNumericStatus(dataError?.code);
}

function getSheetsErrorText(e: unknown): string {
  const messages: string[] = [];
  if (e instanceof Error) messages.push(e.message);

  const err = asRecord(e);
  const response = asRecord(err?.response);
  const data = asRecord(response?.data);
  const dataError = asRecord(data?.error);
  const candidates = [err, dataError];

  for (const candidate of candidates) {
    const message = candidate && typeof candidate.message === "string" ? candidate.message : "";
    const status = candidate && typeof candidate.status === "string" ? candidate.status : "";
    if (message) messages.push(message);
    if (status) messages.push(status);
  }

  const errors = Array.isArray(dataError?.errors) ? dataError.errors : [];
  for (const item of errors) {
    const record = asRecord(item);
    const message = record && typeof record.message === "string" ? record.message : "";
    const reason = record && typeof record.reason === "string" ? record.reason : "";
    if (message) messages.push(message);
    if (reason) messages.push(reason);
  }

  return messages.join(" ");
}

function isMissingSheetRangeError(e: unknown, sheetName: string): boolean {
  const text = getSheetsErrorText(e).toLowerCase();
  if (text.includes("unable to parse range")) return true;

  const status = getSheetsErrorStatus(e);
  if (status !== 400) return false;

  const normalizedSheetName = sheetName.toLowerCase();
  return text.includes(normalizedSheetName) && (text.includes("range") || text.includes("sheet"));
}

function isDuplicateSheetError(e: unknown): boolean {
  const text = getSheetsErrorText(e).toLowerCase();
  return text.includes("already exists") || text.includes("duplicate");
}

type SheetsTitleLookupClient = {
  spreadsheets: {
    get(params: {
      spreadsheetId: string;
      fields: "sheets.properties.title";
    }): Promise<{
      data: {
        sheets?: Array<{
          properties?: {
            title?: string | null;
          } | null;
        } | null> | null;
      };
    }>;
  };
};

class MemoryConfigStore<T> implements ConfigStore<T> {
  private key: string;
  private empty: T;
  constructor(key: string, empty: T) {
    this.key = key;
    this.empty = empty;
  }
  private getMemory(): { data: T; updatedAt: string | null } {
    const g = globalThis as unknown as Record<string, unknown>;
    const cur = g[this.key];
    if (cur && typeof cur === "object") {
      const o = cur as { data?: T; updatedAt?: string | null };
      if (o.data) return { data: o.data, updatedAt: o.updatedAt ?? null };
    }
    const init = { data: this.empty, updatedAt: null };
    g[this.key] = init;
    return init;
  }
  async read(): Promise<ConfigReadResult<T>> {
    const cur = this.getMemory();
    return { data: cur.data, lastUpdatedAt: cur.updatedAt, source: "memory" };
  }
  async write(data: T): Promise<void> {
    const g = globalThis as unknown as Record<string, unknown>;
    g[this.key] = { data, updatedAt: new Date().toISOString() };
  }
  async health(): Promise<ConfigHealth> {
    const cur = this.getMemory();
    return { storeType: "memory", ok: true, lastUpdatedAt: cur.updatedAt ?? null };
  }
}

class FileConfigStore<T> implements ConfigStore<T> {
  private opts: FileBackendOpts<T>;
  constructor(opts: FileBackendOpts<T>) {
    this.opts = opts;
  }
  private static writeLocks = new Map<string, Promise<void>>();

  private async ensureDir(): Promise<void> {
    const dir = join(process.cwd(), ".mailhub");
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }

  private pickReadPath(): string | null {
    if (existsSync(this.opts.primaryPath)) return this.opts.primaryPath;
    for (const p of this.opts.legacyReadPaths ?? []) {
      if (existsSync(p)) return p;
    }
    return null;
  }

  async read(): Promise<ConfigReadResult<T>> {
    await this.ensureDir();
    const path = this.pickReadPath();
    if (!path) {
      return { data: this.opts.parse(""), lastUpdatedAt: null, source: "file" };
    }
    const raw = await readFile(path, "utf-8").catch(() => "");
    const s = await stat(path).catch(() => null);
    const lastUpdatedAt = s ? s.mtime.toISOString() : null;
    return { data: this.opts.parse(raw), lastUpdatedAt, source: "file" };
  }

  async write(data: T): Promise<void> {
    await this.ensureDir();
    const payload = this.opts.serialize(data);
    const key = this.opts.primaryPath;

    const prev = FileConfigStore.writeLocks.get(key) ?? Promise.resolve();
    const next = prev.then(async () => {
      // 原子性: tmp → fsync → rename（突然死でも壊れにくい）
      const dir = join(process.cwd(), ".mailhub");
      const baseName = this.opts.primaryPath.split("/").pop() ?? "config.json";
      const tmpPath = join(dir, `.${baseName}.${process.pid}.${Date.now()}.tmp`);
      const fh = await open(tmpPath, "w");
      try {
        await fh.writeFile(payload, "utf-8");
        await fh.sync();
      } finally {
        await fh.close();
      }
      await rename(tmpPath, this.opts.primaryPath);
    });
    FileConfigStore.writeLocks.set(key, next.catch(() => {}));
    await next;
  }

  async health(): Promise<ConfigHealth> {
    try {
      const r = await this.read();
      return { storeType: "file", ok: true, lastUpdatedAt: r.lastUpdatedAt };
    } catch (e) {
      return { storeType: "file", ok: false, detail: e instanceof Error ? e.message : String(e), lastUpdatedAt: null };
    }
  }
}

class SheetsConfigStore<T> implements ConfigStore<T> {
  private static sheetWriteLocks = new Map<string, Promise<void>>();
  private static globalEpochs = new Map<string, number>();
  private static globalSuppressedUntil = new Map<string, number>();
  private opts: SheetsBackendOpts<T>;
  private readCache: SheetsReadCacheEntry<T> | null = null;
  private readInFlight: SheetsReadInFlight<T> | null = null;

  constructor(opts: SheetsBackendOpts<T>) {
    this.opts = { ...opts, privateKey: opts.privateKey.replace(/\\n/g, "\n") };
  }

  private async getSheetsClient() {
    const { google } = await import("googleapis");
    const auth = new google.auth.JWT({
      email: this.opts.clientEmail,
      key: this.opts.privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    return google.sheets({ version: "v4", auth });
  }

  private emptyJsonBlobData(): T {
    return this.opts.fromJson?.("") ?? ({} as T);
  }

  private async hasConfiguredSheet(sheets: SheetsTitleLookupClient): Promise<boolean> {
    const resp = await withTimeout(
      sheets.spreadsheets.get({
        spreadsheetId: this.opts.spreadsheetId,
        fields: "sheets.properties.title",
      }),
      6000,
      "sheets_list_titles",
    );
    return (resp.data.sheets ?? []).some((sheet) => sheet?.properties?.title === this.opts.sheetName);
  }

  private async isConfirmedMissingSheet(sheets: SheetsTitleLookupClient, e: unknown): Promise<boolean> {
    if (!isMissingSheetRangeError(e, this.opts.sheetName)) return false;
    return !(await this.hasConfiguredSheet(sheets));
  }

  private async ensureJsonBlobSheet(): Promise<void> {
    const sheets = await this.getSheetsClient();
    try {
      await withWriteTimeout(
        sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.opts.spreadsheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: this.opts.sheetName,
                  },
                },
              },
            ],
          },
        }),
        6000,
        "sheets_add_sheet",
      );
    } catch (e) {
      if (isDuplicateSheetError(e)) return;
      if (getWriteTimeoutDrain(e)) throw e;
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`sheets_sheet_bootstrap_failed:${this.opts.sheetName}:${message}`);
    }
  }

  private async ensureHeaderTable(): Promise<void> {
    const sheets = await this.getSheetsClient();
    const range = `${this.opts.sheetName}!A1:Z1`;
    const cur = await sheets.spreadsheets.values.get({ spreadsheetId: this.opts.spreadsheetId, range });
    const hasHeader = (cur.data.values?.[0] ?? []).length > 0;
    if (!hasHeader) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: this.opts.spreadsheetId,
        range,
        valueInputOption: "RAW",
        requestBody: { values: [this.opts.headers ?? []] },
      });
    }
  }

  private get sheetKey(): string {
    return `${this.opts.spreadsheetId}:${this.opts.sheetName}`;
  }

  private getGlobalEpoch(): number {
    return SheetsConfigStore.globalEpochs.get(this.sheetKey) ?? 0;
  }

  private bumpGlobalEpoch(): number {
    const next = this.getGlobalEpoch() + 1;
    SheetsConfigStore.globalEpochs.set(this.sheetKey, next);
    return next;
  }

  private getGlobalSuppressedUntil(): number {
    return SheetsConfigStore.globalSuppressedUntil.get(this.sheetKey) ?? 0;
  }

  private setGlobalSuppressedUntil(until: number): void {
    SheetsConfigStore.globalSuppressedUntil.set(this.sheetKey, until);
  }

  private clearGlobalSuppression(): void {
    SheetsConfigStore.globalSuppressedUntil.delete(this.sheetKey);
  }

  private setReadCache(result: ConfigReadResult<T>, epoch = this.getGlobalEpoch()): void {
    this.readCache = { result, expiresAt: Date.now() + SHEETS_READ_CACHE_TTL_MS, epoch };
  }

  private invalidateReadCacheForWrite(): void {
    this.bumpGlobalEpoch();
    this.readCache = null;
    this.readInFlight = null;
  }

  private setReadCacheAfterWrite(result: ConfigReadResult<T>): void {
    this.clearGlobalSuppression();
    this.readInFlight = null;
    this.setReadCache(result);
  }

  async read(opts: SheetsReadOptions = {}): Promise<ConfigReadResult<T>> {
    const bypassCache = opts.bypassCache === true;
    const now = Date.now();
    const currentEpoch = this.getGlobalEpoch();
    const cachePopulateSuppressed = now < this.getGlobalSuppressedUntil();
    const cached = this.readCache;
    if (!bypassCache && !cachePopulateSuppressed && cached && cached.epoch === currentEpoch && cached.expiresAt > now) {
      return cached.result;
    }
    if (!bypassCache && !cachePopulateSuppressed && this.readInFlight?.epoch === currentEpoch) {
      return this.readInFlight.promise;
    }

    const epoch = currentEpoch;
    const run = this.readUnlocked().then((result) => {
      if (this.getGlobalEpoch() === epoch && Date.now() >= this.getGlobalSuppressedUntil()) {
        this.setReadCache(result, epoch);
      }
      return result;
    });

    if (!bypassCache && !cachePopulateSuppressed) {
      this.readInFlight = { promise: run, epoch };
      void run
        .finally(() => {
          if (this.readInFlight?.promise === run) this.readInFlight = null;
        })
        .catch(() => {});
    }

    return await run;
  }

  private async readUnlocked(): Promise<ConfigReadResult<T>> {
    const sheets = await this.getSheetsClient();
    if (this.opts.mode === "json_blob") {
      const range = `${this.opts.sheetName}!A1:B2`;
      let resp;
      try {
        resp = await withTimeout(
          sheets.spreadsheets.values.get({ spreadsheetId: this.opts.spreadsheetId, range }),
          6000,
          "sheets_read",
        );
      } catch (e) {
        if (!(await this.isConfirmedMissingSheet(sheets, e))) throw e;
        return { data: this.emptyJsonBlobData(), lastUpdatedAt: null, source: "sheets" };
      }
      const values = resp.data.values ?? [];
      const json = String(values?.[1]?.[0] ?? "");
      const updatedAt = String(values?.[1]?.[1] ?? "") || null;
      if (!json.trim()) {
        return { data: this.emptyJsonBlobData(), lastUpdatedAt: updatedAt, source: "sheets" };
      }
      return { data: this.opts.fromJson ? this.opts.fromJson(json) : (JSON.parse(json) as T), lastUpdatedAt: updatedAt, source: "sheets" };
    }

    const range = `${this.opts.sheetName}!A:Z`;
    const resp = await withTimeout(
      sheets.spreadsheets.values.get({ spreadsheetId: this.opts.spreadsheetId, range }),
      6000,
      "sheets_read",
    );
    const rows = (resp.data.values ?? []).map((r) => r.map((c) => String(c ?? "")));
    if (rows.length <= 1) {
      return { data: this.opts.fromRows ? this.opts.fromRows([]) : ([] as unknown as T), lastUpdatedAt: null, source: "sheets" };
    }
    const dataRows = rows.slice(1);
    return { data: this.opts.fromRows ? this.opts.fromRows(dataRows) : ([] as unknown as T), lastUpdatedAt: null, source: "sheets" };
  }

  async write(data: T): Promise<void> {
    this.invalidateReadCacheForWrite();
    const key = this.sheetKey;
    const prev = SheetsConfigStore.sheetWriteLocks.get(key) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(() => {
      this.invalidateReadCacheForWrite();
      return this.writeUnlocked(data);
    });
    const lock = run.catch(async (e) => {
      const drain = getWriteTimeoutDrain(e);
      if (drain) await drain;
    });

    SheetsConfigStore.sheetWriteLocks.set(key, lock);
    void lock.finally(() => {
      if (SheetsConfigStore.sheetWriteLocks.get(key) === lock) {
        SheetsConfigStore.sheetWriteLocks.delete(key);
      }
    });

    try {
      await run;
    } catch (e) {
      this.setGlobalSuppressedUntil(Date.now() + 60_000);
      throw e;
    }
  }

  private async writeUnlocked(data: T): Promise<void> {
    const sheets = await this.getSheetsClient();
    if (this.opts.mode === "json_blob") {
      const now = new Date().toISOString();
      const json = this.opts.toJson ? this.opts.toJson(data) : JSON.stringify(data);
      const writeJsonBlob = () =>
        sheets.spreadsheets.values.update({
          spreadsheetId: this.opts.spreadsheetId,
          range: `${this.opts.sheetName}!A1`,
          valueInputOption: "RAW",
          requestBody: {
            values: [
              ["json", "updatedAt"],
              [json, now],
            ],
          },
        });
      // 1操作で整合性を担保（A1:B2を一括update）
      try {
        await withWriteTimeout(writeJsonBlob(), 6000, "sheets_write");
      } catch (e) {
        if (!(await this.isConfirmedMissingSheet(sheets, e))) throw e;
        await this.ensureJsonBlobSheet();
        await withWriteTimeout(writeJsonBlob(), 6000, "sheets_write");
      }
      this.setReadCacheAfterWrite({ data, lastUpdatedAt: now, source: "sheets" });
      return;
    }

    await withWriteTimeout(this.ensureHeaderTable(), 6000, "sheets_header");
    const values = [this.opts.headers ?? [], ...(this.opts.toRows ? this.opts.toRows(data) : [])];
    const range = `${this.opts.sheetName}!A:Z`;
    await withWriteTimeout(sheets.spreadsheets.values.clear({ spreadsheetId: this.opts.spreadsheetId, range }), 6000, "sheets_clear");
    await withWriteTimeout(
      sheets.spreadsheets.values.update({
        spreadsheetId: this.opts.spreadsheetId,
        range: `${this.opts.sheetName}!A1`,
        valueInputOption: "RAW",
        requestBody: { values },
      }),
      6000,
      "sheets_write",
    );
    this.setReadCacheAfterWrite({ data, lastUpdatedAt: null, source: "sheets" });
  }

  async health(): Promise<ConfigHealth> {
    try {
      if (this.opts.mode === "table") {
        await withTimeout(this.ensureHeaderTable(), 3000, "sheets_header_health");
      }
      await withTimeout(this.read({ bypassCache: true }), 3000, "sheets_read_health");
      return { storeType: "sheets", ok: true, lastUpdatedAt: null };
    } catch (e) {
      return { storeType: "sheets", ok: false, detail: e instanceof Error ? e.message : String(e), lastUpdatedAt: null };
    }
  }
}

export function createConfigStore<T>(params: {
  key: string; // memory key
  empty: T;
  file?: FileBackendOpts<T>;
  sheets?: Omit<SheetsBackendOpts<T>, "spreadsheetId" | "clientEmail" | "privateKey"> & {
    sheetNameEnv?: string;
  };
  forceType?: ConfigStoreType;
}): ConfigStore<T> {
  const type = params.forceType ?? getResolvedConfigStoreType();

  if (type === "memory") {
    return new MemoryConfigStore<T>(params.key, params.empty);
  }

  if (type === "file") {
    if (!params.file) {
      return new MemoryConfigStore<T>(params.key, params.empty);
    }
    return new FileConfigStore<T>(params.file);
  }

  // sheets
  const sheetsCfg = getResolvedSheetsConfig();
  if (!sheetsCfg.spreadsheetId || !sheetsCfg.clientEmail || !sheetsCfg.privateKey || !params.sheets) {
    // 設定不備は安全側（書込みが危険）なのでmemoryにフォールバック
    return new MemoryConfigStore<T>(params.key, params.empty);
  }
  const sheetName =
    (params.sheets.sheetNameEnv ? process.env[params.sheets.sheetNameEnv] : undefined) ??
    params.sheets.sheetName;
  return new SheetsConfigStore<T>({
    spreadsheetId: sheetsCfg.spreadsheetId,
    clientEmail: sheetsCfg.clientEmail,
    privateKey: sheetsCfg.privateKey,
    sheetName,
    mode: params.sheets.mode,
    headers: params.sheets.headers,
    toRows: params.sheets.toRows,
    fromRows: params.sheets.fromRows,
    toJson: params.sheets.toJson,
    fromJson: params.sheets.fromJson,
  });
}
