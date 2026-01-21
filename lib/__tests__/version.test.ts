import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { getVersionInfo } from "@/lib/version";

describe("version", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.VERCEL_GIT_COMMIT_REF;
    process.env.npm_package_version = "9.9.9";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("local/dev: when no Vercel env, uses dev-<packageVersion>", () => {
    const v = getVersionInfo();
    expect(v.version).toBe("dev-9.9.9");
    expect(v.commitSha).toBe("local");
    expect(v.ref).toBe("local");
    expect(v.packageVersion).toBe("9.9.9");
  });

  test("vercel: sha+ref => <ref>-<shortsha>", () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "abcdef0123456789";
    process.env.VERCEL_GIT_COMMIT_REF = "feature/test";
    const v = getVersionInfo();
    expect(v.version).toBe("feature/test-abcdef0");
    expect(v.commitSha).toBe("abcdef0123456789");
    expect(v.ref).toBe("feature/test");
  });

  test("vercel: sha only => main-<shortsha>", () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "1234567890abcdef";
    delete process.env.VERCEL_GIT_COMMIT_REF;
    const v = getVersionInfo();
    expect(v.version).toBe("main-1234567");
    expect(v.ref).toBe("local"); // ref field falls back to local when env is missing
  });
});

