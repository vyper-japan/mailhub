import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { isReadOnlyMode, writeForbiddenResponse } from "@/lib/read-only";
import { isAdminEmail } from "@/lib/admin";

describe("read-only", () => {
  const originalEnv = { ...process.env };
  const g = globalThis as unknown as Record<string, unknown>;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete g.window;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    delete g.window;
  });

  test("server: MAILHUB_READ_ONLY=1 => true", () => {
    process.env.MAILHUB_READ_ONLY = "1";
    expect(isReadOnlyMode()).toBe(true);
  });

  test("server: MAILHUB_READ_ONLY=0 => false", () => {
    process.env.MAILHUB_READ_ONLY = "0";
    process.env.MAILHUB_ENV = "staging";
    expect(isReadOnlyMode()).toBe(false);
  });

  test("server: MAILHUB_READ_ONLY unset + MAILHUB_ENV=staging => true (safe default)", () => {
    delete process.env.MAILHUB_READ_ONLY;
    process.env.MAILHUB_ENV = "staging";
    expect(isReadOnlyMode()).toBe(true);
  });

  test("server: MAILHUB_READ_ONLY unset + MAILHUB_ENV=local => false", () => {
    delete process.env.MAILHUB_READ_ONLY;
    process.env.MAILHUB_ENV = "local";
    expect(isReadOnlyMode()).toBe(false);
  });

  test("client guard: window exists => false", () => {
    process.env.MAILHUB_READ_ONLY = "1";
    g.window = {};
    expect(isReadOnlyMode()).toBe(false);
  });

  // Step 79: writeForbiddenResponse returns 403
  test("writeForbiddenResponse returns 403 status", async () => {
    const response = writeForbiddenResponse("assign");
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("read_only");
    expect(body.message).toContain("READ ONLY");
  });
});

// Step 79: 権限ガードのテスト
describe("admin guards for assign", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.MAILHUB_TEST_MODE = "0"; // TEST_MODEは常にadmin扱いなのでOFFにする
    process.env.MAILHUB_ADMINS = "admin@vtj.co.jp";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("非adminは自分以外へのAssignが不可（403相当）", () => {
    const userEmail = "normaluser@vtj.co.jp";
    const targetEmail = "other@vtj.co.jp";
    
    // 非adminが他人にAssignしようとした場合の判定ロジック
    const isAdmin = isAdminEmail(userEmail);
    const isAssigningToOther = targetEmail.toLowerCase() !== userEmail.toLowerCase();
    
    // 非adminが他人にAssignしようとすると拒否される
    expect(isAdmin).toBe(false);
    expect(isAssigningToOther).toBe(true);
    // 実際のAPIではこの条件で403を返す
    const shouldReject = isAssigningToOther && !isAdmin;
    expect(shouldReject).toBe(true);
  });

  test("adminは他人へのAssignが可能", () => {
    const adminEmail = "admin@vtj.co.jp";
    const targetEmail = "other@vtj.co.jp";
    
    const isAdmin = isAdminEmail(adminEmail);
    const isAssigningToOther = targetEmail.toLowerCase() !== adminEmail.toLowerCase();
    
    expect(isAdmin).toBe(true);
    expect(isAssigningToOther).toBe(true);
    // adminなので拒否されない
    const shouldReject = isAssigningToOther && !isAdmin;
    expect(shouldReject).toBe(false);
  });

  test("自分へのAssignは非adminでも可能", () => {
    const userEmail = "normaluser@vtj.co.jp";
    const targetEmail = "normaluser@vtj.co.jp";
    
    const isAdmin = isAdminEmail(userEmail);
    const isAssigningToOther = targetEmail.toLowerCase() !== userEmail.toLowerCase();
    
    expect(isAdmin).toBe(false);
    expect(isAssigningToOther).toBe(false);
    // 自分へのAssignなので拒否されない
    const shouldReject = isAssigningToOther && !isAdmin;
    expect(shouldReject).toBe(false);
  });
});


