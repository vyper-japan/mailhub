import { describe, expect, test, beforeEach, afterEach } from "vitest";

describe("admin", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("MAILHUB_ADMINS CSV parsing", async () => {
    process.env.MAILHUB_TEST_MODE = "0";
    process.env.MAILHUB_ADMINS = "takayuki@vtj.co.jp,  Foo@vtj.co.jp  ";
    const { isAdminEmail } = await import("@/lib/admin");
    expect(isAdminEmail("takayuki@vtj.co.jp")).toBe(true);
    expect(isAdminEmail("foo@vtj.co.jp")).toBe(true);
    expect(isAdminEmail("bar@vtj.co.jp")).toBe(false);
  });

  test("requireAdminOrThrow", async () => {
    process.env.MAILHUB_TEST_MODE = "0";
    process.env.MAILHUB_ADMINS = "admin@vtj.co.jp";
    const { requireAdminOrThrow } = await import("@/lib/admin");
    expect(() => requireAdminOrThrow("admin@vtj.co.jp")).not.toThrow();
    expect(() => requireAdminOrThrow("user@vtj.co.jp")).toThrow("forbidden_admin_only");
  });

  test("TEST_MODE => always admin", async () => {
    Object.defineProperty(process.env, "NODE_ENV", { value: "development", configurable: true });
    process.env.MAILHUB_TEST_MODE = "1";
    process.env.MAILHUB_ADMINS = "";
    const { isAdminEmail } = await import("@/lib/admin");
    expect(isAdminEmail("anyone@vtj.co.jp")).toBe(true);
  });

  test("getAdminDiagnostics: invalid/nonVtj", async () => {
    process.env.MAILHUB_TEST_MODE = "0";
    process.env.MAILHUB_ADMINS = " , foo, bar@outside.com, ok@vtj.co.jp ";
    const { getAdminDiagnostics } = await import("@/lib/admin");
    const d = getAdminDiagnostics();
    expect(d.invalid.length).toBeGreaterThanOrEqual(1);
    expect(d.nonVtj).toContain("bar@outside.com");
  });
});


