import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { assertTestMode, isTestMode } from "@/lib/test-mode";

describe("test-mode", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("production => always false", () => {
    Object.defineProperty(process.env, "NODE_ENV", { value: "production", configurable: true });
    process.env.MAILHUB_TEST_MODE = "1";
    expect(isTestMode()).toBe(false);
  });

  test("development + MAILHUB_TEST_MODE=1 => true", () => {
    Object.defineProperty(process.env, "NODE_ENV", { value: "development", configurable: true });
    process.env.MAILHUB_TEST_MODE = "1";
    expect(isTestMode()).toBe(true);
  });

  test("assertTestMode throws when disabled", () => {
    Object.defineProperty(process.env, "NODE_ENV", { value: "development", configurable: true });
    process.env.MAILHUB_TEST_MODE = "0";
    expect(() => assertTestMode("ctx")).toThrow(/Test mode is not enabled/);
  });
});


