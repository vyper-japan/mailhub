import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { createConfigStore, getResolvedConfigStoreType, getResolvedSheetsConfig } from "@/lib/configStore";
import { isTestMode } from "@/lib/test-mode";

// --- googleapis mock (for SheetsConfigStore coverage) ---
type ValuesCall = { spreadsheetId: string; range: string; requestBody?: { values?: string[][] } };
const sheetsState: {
  valuesByRange: Record<string, string[][]>;
  calls: { get: ValuesCall[]; update: ValuesCall[]; clear: ValuesCall[] };
  throwGet?: boolean;
  throwUpdate?: boolean;
  throwClear?: boolean;
} = {
  valuesByRange: {},
  calls: { get: [], update: [], clear: [] },
  throwGet: false,
  throwUpdate: false,
  throwClear: false,
};

vi.mock("googleapis", () => {
  const google = {
    auth: {
      JWT: class JWT {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        constructor(_args: { email: string; key: string; scopes: string[] }) {}
      },
    },
    sheets: () => ({
      spreadsheets: {
        values: {
          get: async (args: { spreadsheetId: string; range: string }) => {
            if (sheetsState.throwGet) throw new Error("mock_get_fail");
            sheetsState.calls.get.push({ spreadsheetId: args.spreadsheetId, range: args.range });
            return { data: { values: sheetsState.valuesByRange[args.range] ?? [] } };
          },
          clear: async (args: { spreadsheetId: string; range: string }) => {
            if (sheetsState.throwClear) throw new Error("mock_clear_fail");
            sheetsState.calls.clear.push({ spreadsheetId: args.spreadsheetId, range: args.range });
            // clear matching "A:Z" range key if exists
            delete sheetsState.valuesByRange[args.range];
            return { data: {} };
          },
          update: async (args: { spreadsheetId: string; range: string; requestBody: { values: string[][] } }) => {
            if (sheetsState.throwUpdate) throw new Error("mock_update_fail");
            sheetsState.calls.update.push({ spreadsheetId: args.spreadsheetId, range: args.range, requestBody: args.requestBody });
            // normalize storage: writing to A1 updates both A1:B2 and A:Z snapshots for reads
            if (args.range.endsWith("!A1")) {
              const sheetName = args.range.split("!")[0];
              sheetsState.valuesByRange[`${sheetName}!A1:B2`] = args.requestBody.values;
              sheetsState.valuesByRange[`${sheetName}!A:Z`] = args.requestBody.values;
              sheetsState.valuesByRange[`${sheetName}!A1:Z1`] = [args.requestBody.values[0] ?? []];
            } else {
              sheetsState.valuesByRange[args.range] = args.requestBody.values;
            }
            return { data: {} };
          },
        },
      },
    }),
  };
  return { google };
});

describe("configStore", () => {
  const originalEnv = { ...process.env };

  const g = globalThis as unknown as Record<string, unknown>;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // ensure no client guard unless explicitly set
    delete g.window;
    sheetsState.valuesByRange = {};
    sheetsState.calls = { get: [], update: [], clear: [] };
    sheetsState.throwGet = false;
    sheetsState.throwUpdate = false;
    sheetsState.throwClear = false;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    delete g.window;
  });

  test("getResolvedConfigStoreType: explicit env wins", () => {
    process.env.MAILHUB_TEST_MODE = "0";
    process.env.MAILHUB_CONFIG_STORE = "file";
    Object.defineProperty(process.env, "NODE_ENV", { value: "development", configurable: true });
    expect(getResolvedConfigStoreType()).toBe("file");
  });

  test("getResolvedConfigStoreType: default dev=file, prod=sheets", () => {
    process.env.MAILHUB_TEST_MODE = "0";
    delete process.env.MAILHUB_CONFIG_STORE;

    Object.defineProperty(process.env, "NODE_ENV", { value: "development", configurable: true });
    expect(getResolvedConfigStoreType()).toBe("file");

    Object.defineProperty(process.env, "NODE_ENV", { value: "production", configurable: true });
    expect(getResolvedConfigStoreType()).toBe("sheets");
  });

  test("getResolvedSheetsConfig uses MAILHUB_SHEETS_ID fallback", () => {
    process.env.MAILHUB_SHEETS_ID = "sid";
    process.env.MAILHUB_SHEETS_CLIENT_EMAIL = "svc@x";
    process.env.MAILHUB_SHEETS_PRIVATE_KEY = "k";
    const cfg = getResolvedSheetsConfig();
    expect(cfg.spreadsheetId).toBe("sid");
  });

  test("createConfigStore: file read/write and write serialization (also covers lock)", async () => {
    const path = `${process.cwd()}/.mailhub/test-configStore.${Date.now()}.json`;
    await (await import("fs/promises")).rm(path, { force: true }).catch(() => {});
    const store = createConfigStore<string[]>({
      key: "__test_cfg",
      empty: [],
      forceType: "file",
      file: {
        primaryPath: path,
        parse: (raw) => {
          const s = raw.trim();
          if (!s) return [];
          return JSON.parse(s) as string[];
        },
        serialize: (data) => JSON.stringify(data),
      },
    });

    const r0 = await store.read();
    expect(r0.data).toEqual([]);

    // concurrent writes (should be serialized, not corrupt)
    await Promise.all([store.write(["a"]), store.write(["b"])]);
    const r1 = await store.read();
    expect(Array.isArray(r1.data)).toBe(true);
    expect(r1.data.length).toBe(1);
  });

  test("FileConfigStore reads legacy path when primary missing", async () => {
    const legacy = `${process.cwd()}/.mailhub/test-legacy.json`;
    await (await import("fs/promises")).writeFile(legacy, JSON.stringify(["legacy"]), "utf-8");
    const store = createConfigStore<string[]>({
      key: "__test_cfg_legacy",
      empty: [],
      forceType: "file",
      file: {
        primaryPath: `${process.cwd()}/.mailhub/test-primary-missing.json`,
        legacyReadPaths: [legacy],
        parse: (raw) => (raw.trim() ? (JSON.parse(raw) as string[]) : []),
        serialize: (data) => JSON.stringify(data),
      },
    });
    const r = await store.read();
    expect(r.data).toEqual(["legacy"]);
  });

  test("FileConfigStore health returns ok=false when parse throws", async () => {
    const p = `${process.cwd()}/.mailhub/test-bad.json`;
    await (await import("fs/promises")).writeFile(p, "{", "utf-8"); // corrupt JSON
    const store = createConfigStore<string[]>({
      key: "__test_cfg_bad",
      empty: [],
      forceType: "file",
      file: {
        primaryPath: p,
        parse: (raw) => JSON.parse(raw) as string[],
        serialize: (data) => JSON.stringify(data),
      },
    });
    const h = await store.health();
    expect(h.ok).toBe(false);
  });

  test("createConfigStore: sheets requested but config missing => safe memory fallback", async () => {
    process.env.MAILHUB_TEST_MODE = "0";
    process.env.MAILHUB_CONFIG_STORE = "sheets";
    delete process.env.MAILHUB_SHEETS_ID;
    delete process.env.MAILHUB_SHEETS_SPREADSHEET_ID;
    delete process.env.MAILHUB_SHEETS_CLIENT_EMAIL;
    delete process.env.MAILHUB_SHEETS_PRIVATE_KEY;

    const store = createConfigStore<string[]>({
      key: "__test_cfg2",
      empty: [],
      sheets: {
        sheetName: "ConfigLabels",
        mode: "json_blob",
      },
    });

    await store.write(["x"]);
    const r = await store.read();
    expect(r.source).toBe("memory");
    expect(r.data).toEqual(["x"]);
  });

  test("createConfigStore: force memory and file-without-config fallbacks", async () => {
    const mem = createConfigStore<number>({
      key: "__test_mem",
      empty: 0,
      forceType: "memory",
    });
    await mem.write(1);
    expect((await mem.read()).source).toBe("memory");

    const fileNoCfg = createConfigStore<number>({
      key: "__test_file_no_cfg",
      empty: 0,
      forceType: "file",
      // no file backend
    });
    await fileNoCfg.write(2);
    expect((await fileNoCfg.read()).source).toBe("memory");
  });

  test("SheetsConfigStore json_blob read/write/health (mocked)", async () => {
    process.env.MAILHUB_TEST_MODE = "0";
    process.env.MAILHUB_CONFIG_STORE = "sheets";
    process.env.MAILHUB_SHEETS_ID = "sid";
    process.env.MAILHUB_SHEETS_CLIENT_EMAIL = "svc@x";
    process.env.MAILHUB_SHEETS_PRIVATE_KEY = "k";

    const store = createConfigStore<string[]>({
      key: "__test_sheets_blob",
      empty: [],
      forceType: "sheets",
      sheets: {
        sheetName: "ConfigLabels",
        mode: "json_blob",
        toJson: (v) => JSON.stringify(v),
        fromJson: (json) => (json.trim() ? (JSON.parse(json) as string[]) : []),
      },
    });

    // initial read => empty
    const r0 = await store.read();
    expect(r0.data).toEqual([]);

    await store.write(["a", "b"]);
    const r1 = await store.read();
    expect(r1.data).toEqual(["a", "b"]);

    const h = await store.health();
    expect(h.ok).toBe(true);
    expect(sheetsState.calls.update.length).toBeGreaterThan(0);
  });

  test("SheetsConfigStore json_blob read: JSON.parse fallback path", async () => {
    process.env.MAILHUB_TEST_MODE = "0";
    process.env.MAILHUB_CONFIG_STORE = "sheets";
    process.env.MAILHUB_SHEETS_ID = "sid";
    process.env.MAILHUB_SHEETS_CLIENT_EMAIL = "svc@x";
    process.env.MAILHUB_SHEETS_PRIVATE_KEY = "k";

    // preload sheet data for A1:B2
    sheetsState.valuesByRange["ConfigLabels!A1:B2"] = [["json", "updatedAt"], ["[\"z\"]", "2026-01-01T00:00:00.000Z"]];

    const store = createConfigStore<string[]>({
      key: "__test_sheets_blob_parse",
      empty: [],
      forceType: "sheets",
      sheets: { sheetName: "ConfigLabels", mode: "json_blob" },
    });
    const r = await store.read();
    expect(r.data).toEqual(["z"]);
  });

  test("SheetsConfigStore table mode covers ensureHeaderTable + clear/update", async () => {
    process.env.MAILHUB_TEST_MODE = "0";
    process.env.MAILHUB_CONFIG_STORE = "sheets";
    process.env.MAILHUB_SHEETS_ID = "sid";
    process.env.MAILHUB_SHEETS_CLIENT_EMAIL = "svc@x";
    process.env.MAILHUB_SHEETS_PRIVATE_KEY = "k";

    const store = createConfigStore<{ n: number }[]>({
      key: "__test_sheets_table",
      empty: [],
      forceType: "sheets",
      sheets: {
        sheetName: "ConfigRules",
        mode: "table",
        headers: ["n"],
        toRows: (data) => data.map((x) => [String(x.n)]),
        fromRows: (rows) => rows.map((r) => ({ n: Number(r[0] ?? "0") })),
      },
    });

    // empty read path (rows <= 1)
    const r0 = await store.read();
    expect(r0.data).toEqual([]);

    await store.write([{ n: 1 }]);
    const r = await store.read();
    expect(r.data[0]?.n).toBe(1);
    const h = await store.health();
    expect(h.ok).toBe(true);
    expect(sheetsState.calls.clear.length).toBeGreaterThan(0);
  });

  test("SheetsConfigStore health returns ok=false on get failure", async () => {
    process.env.MAILHUB_TEST_MODE = "0";
    process.env.MAILHUB_CONFIG_STORE = "sheets";
    process.env.MAILHUB_SHEETS_ID = "sid";
    process.env.MAILHUB_SHEETS_CLIENT_EMAIL = "svc@x";
    process.env.MAILHUB_SHEETS_PRIVATE_KEY = "k";

    sheetsState.throwGet = true;
    const store = createConfigStore<string[]>({
      key: "__test_sheets_fail",
      empty: [],
      forceType: "sheets",
      sheets: { sheetName: "ConfigLabels", mode: "json_blob", toJson: (v) => JSON.stringify(v), fromJson: (j) => (j.trim() ? (JSON.parse(j) as string[]) : []) },
    });
    const h = await store.health();
    expect(h.ok).toBe(false);
  });
});

describe("test-mode client guard", () => {
  const originalEnv = { ...process.env };
  const g = globalThis as unknown as Record<string, unknown>;
  afterEach(() => {
    process.env = { ...originalEnv };
    delete g.window;
  });

  test("window exists => false even if env says test", () => {
    Object.defineProperty(process.env, "NODE_ENV", { value: "development", configurable: true });
    process.env.MAILHUB_TEST_MODE = "1";
    g.window = {};
    expect(isTestMode()).toBe(false);
  });
});


