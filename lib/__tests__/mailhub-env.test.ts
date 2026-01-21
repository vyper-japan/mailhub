import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { getMailhubEnv, getMailhubEnvLabel } from "@/lib/mailhub-env";

describe("mailhub-env", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("default => local", () => {
    delete process.env.MAILHUB_ENV;
    expect(getMailhubEnv()).toBe("local");
  });

  test("staging => staging", () => {
    process.env.MAILHUB_ENV = "staging";
    expect(getMailhubEnv()).toBe("staging");
  });

  test("production => production", () => {
    process.env.MAILHUB_ENV = "production";
    expect(getMailhubEnv()).toBe("production");
  });

  test("invalid => local", () => {
    process.env.MAILHUB_ENV = "weird";
    expect(getMailhubEnv()).toBe("local");
  });

  test("label mapping", () => {
    expect(getMailhubEnvLabel("local")).toBe("LOCAL");
    expect(getMailhubEnvLabel("staging")).toBe("STAGING");
    expect(getMailhubEnvLabel("production")).toBe("PROD");
  });
});


