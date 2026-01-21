import { describe, it, expect, beforeEach } from "vitest";
import {
  getAssigneeRegistryStore,
  resetAssigneeRegistryStore,
  parseAssignees,
  type AssigneeEntry,
} from "../assigneeRegistryStore";

describe("assigneeRegistryStore", () => {
  beforeEach(() => {
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
});
