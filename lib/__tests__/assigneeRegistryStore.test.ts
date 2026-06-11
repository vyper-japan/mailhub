import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import {
  getAssigneeRegistryFileStoreForImport,
  getAssigneeRegistryStore,
  getInvalidAssigneeImportSourceEmails,
  normalizeAssignees,
  overwriteAssigneesForImport,
  resetAssigneeRegistryStore,
  parseAssignees,
  type AssigneeEntry,
} from "../assigneeRegistryStore";

const sheetsState = vi.hoisted(() => ({
  valuesByRange: {} as Record<string, string[][]>,
  sheetTitles: ["ConfigAssignees"],
}));

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
        get: async () => ({
          data: {
            sheets: sheetsState.sheetTitles.map((title) => ({ properties: { title } })),
          },
        }),
        batchUpdate: async () => ({ data: {} }),
        values: {
          get: async (args: { range: string }) => ({
            data: { values: sheetsState.valuesByRange[args.range] ?? [] },
          }),
          update: async (args: { range: string; requestBody: { values: string[][] } }) => {
            sheetsState.valuesByRange[args.range] = args.requestBody.values;
            if (args.range.endsWith("!A1")) {
              const sheetName = args.range.split("!")[0];
              sheetsState.valuesByRange[`${sheetName}!A1:B2`] = args.requestBody.values;
            }
            return { data: {} };
          },
          clear: async (args: { range: string }) => {
            delete sheetsState.valuesByRange[args.range];
            return { data: {} };
          },
        },
      },
    }),
  };
  return { google };
});

describe("assigneeRegistryStore", () => {
  const assigneesPath = join(process.cwd(), ".mailhub", "assignees.json");
  const originalEnv = { ...process.env };
  let originalAssigneesFile: string | null = null;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    originalAssigneesFile = await readFile(assigneesPath, "utf-8").catch(() => null);
    sheetsState.valuesByRange = {};
    sheetsState.sheetTitles = ["ConfigAssignees"];
    resetAssigneeRegistryStore();
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    if (originalAssigneesFile === null) {
      await rm(assigneesPath, { force: true });
    } else {
      await mkdir(join(process.cwd(), ".mailhub"), { recursive: true });
      await writeFile(assigneesPath, originalAssigneesFile, "utf-8");
    }
    originalAssigneesFile = null;
    resetAssigneeRegistryStore();
  });

  describe("parseAssignees", () => {
    it("空文字列は空配列を返す", () => {
      expect(parseAssignees("")).toEqual([]);
      expect(parseAssignees("  ")).toEqual([]);
    });

    it("正常なJSONをパースできる", () => {
      const json = JSON.stringify([
        { email: "test@vtj.co.jp", displayName: "Test User" },
        { email: "admin@vtj.co.jp" },
      ]);
      const result = parseAssignees(json);
      expect(result).toHaveLength(2);
      expect(result[0].email).toBe("test@vtj.co.jp");
      expect(result[0].displayName).toBe("Test User");
      expect(result[1].email).toBe("admin@vtj.co.jp");
      expect(result[1].displayName).toBeUndefined();
    });

    it("不正なJSONはエラーをthrow", () => {
      expect(() => parseAssignees("{invalid}")).toThrow(/config_json_corrupt_assignees/);
    });

    it("配列でないJSONは空配列を返す", () => {
      expect(parseAssignees('{"foo": "bar"}')).toEqual([]);
    });

    it("emailが空のエントリは除外", () => {
      const json = JSON.stringify([
        { email: "", displayName: "No Email" },
        { email: "valid@vtj.co.jp" },
      ]);
      const result = parseAssignees(json);
      expect(result).toHaveLength(1);
      expect(result[0].email).toBe("valid@vtj.co.jp");
    });
  });

  describe("Store operations (memory)", () => {
    it("初期状態は空配列", async () => {
      const store = getAssigneeRegistryStore("memory");
      const list = await store.list();
      expect(list).toEqual([]);
    });

    it("replaceAllで保存→listで取得できる", async () => {
      const store = getAssigneeRegistryStore("memory");
      const entries: AssigneeEntry[] = [
        { email: "alice@vtj.co.jp", displayName: "Alice" },
        { email: "bob@vtj.co.jp" },
      ];
      const saved = await store.replaceAll(entries);
      expect(saved).toHaveLength(2);
      // 昇順ソート確認
      expect(saved[0].email).toBe("alice@vtj.co.jp");
      expect(saved[1].email).toBe("bob@vtj.co.jp");

      const list = await store.list();
      expect(list).toHaveLength(2);
    });

    it("重複emailは除去される", async () => {
      const store = getAssigneeRegistryStore("memory");
      const entries: AssigneeEntry[] = [
        { email: "alice@vtj.co.jp", displayName: "Alice 1" },
        { email: "ALICE@VTJ.CO.JP", displayName: "Alice 2" }, // 重複
        { email: "bob@vtj.co.jp" },
      ];
      const saved = await store.replaceAll(entries);
      expect(saved).toHaveLength(2);
      expect(saved[0].email).toBe("alice@vtj.co.jp");
      expect(saved[0].displayName).toBe("Alice 1"); // 先のを採用
    });

    it("vtj.co.jp以外のドメインはエラー", async () => {
      const store = getAssigneeRegistryStore("memory");
      const entries: AssigneeEntry[] = [
        { email: "alice@vtj.co.jp" },
        { email: "bob@example.com" }, // 不正
      ];
      await expect(store.replaceAll(entries)).rejects.toThrow(/assignee_invalid_domain/);
    });

    it("clearで全削除", async () => {
      const store = getAssigneeRegistryStore("memory");
      await store.replaceAll([{ email: "test@vtj.co.jp" }]);
      expect(await store.list()).toHaveLength(1);

      await store.clear();
      expect(await store.list()).toHaveLength(0);
    });
  });

  describe("import helpers", () => {
    it("normalizes emails and display names, keeps first duplicate, and sorts by email", () => {
      expect(
        normalizeAssignees([
          { email: " ZED@VTJ.CO.JP ", displayName: " Zed " },
          { email: "alice@vtj.co.jp", displayName: "Alice 1" },
          { email: "ALICE@VTJ.CO.JP", displayName: "Alice 2" },
        ]),
      ).toEqual([
        { email: "alice@vtj.co.jp", displayName: "Alice 1" },
        { email: "zed@vtj.co.jp", displayName: "Zed" },
      ]);
    });

    it("reads import source from .mailhub/assignees.json and treats missing file as empty", async () => {
      await mkdir(join(process.cwd(), ".mailhub"), { recursive: true });
      await writeFile(
        assigneesPath,
        JSON.stringify([{ email: "FILE@VTJ.CO.JP", displayName: " File User " }]),
        "utf-8",
      );

      await expect(getAssigneeRegistryFileStoreForImport().list()).resolves.toEqual([
        { email: "file@vtj.co.jp", displayName: "File User" },
      ]);

      await rm(assigneesPath, { force: true });
      await expect(getAssigneeRegistryFileStoreForImport().list()).resolves.toEqual([]);
    });

    it("keeps admin replaceAll full-entry domain validation", async () => {
      const store = getAssigneeRegistryStore("memory");
      await expect(
        store.replaceAll([
          { email: "valid@vtj.co.jp" },
          { email: "target-only@example.com" },
        ]),
      ).rejects.toThrow(/assignee_invalid_domain:target-only@example\.com/);
    });

    it("validates only source entries during import and preserves target-only invalid entries", async () => {
      const targetEntries: AssigneeEntry[] = [
        { email: "target-only@example.com", displayName: "Target Only" },
        { email: "existing@vtj.co.jp", displayName: "Old" },
      ];

      expect(getInvalidAssigneeImportSourceEmails([{ email: "bad@example.com" }])).toEqual(["bad@example.com"]);
      await expect(overwriteAssigneesForImport([{ email: "bad@example.com" }], targetEntries)).rejects.toThrow(
        /assignee_import_invalid_domain:bad@example\.com/,
      );

      const saved = await overwriteAssigneesForImport(
        [{ email: "existing@vtj.co.jp", displayName: "New" }],
        targetEntries,
      );
      expect(saved).toEqual([
        { email: "existing@vtj.co.jp", displayName: "New" },
        { email: "target-only@example.com", displayName: "Target Only" },
      ]);
    });

    it("round-trips assignees through Sheets json_blob store", async () => {
      process.env.MAILHUB_TEST_MODE = "0";
      process.env.MAILHUB_SHEETS_ID = "sid";
      process.env.MAILHUB_SHEETS_CLIENT_EMAIL = "svc@example.com";
      process.env.MAILHUB_SHEETS_PRIVATE_KEY = "private-key";

      const store = getAssigneeRegistryStore("sheets");
      await store.replaceAll([{ email: "sheets@vtj.co.jp", displayName: "Sheets User" }]);

      await expect(store.list()).resolves.toEqual([
        { email: "sheets@vtj.co.jp", displayName: "Sheets User" },
      ]);
    });
  });
});
