import { describe, expect, test } from "vitest";
import { isBroadDomain, normalizeDomain } from "@/lib/ruleSafety";

describe("ruleSafety", () => {
  test("normalizeDomain", () => {
    expect(normalizeDomain(" @Gmail.COM ")).toBe("gmail.com");
    expect(normalizeDomain(".Example.COM")).toBe("example.com");
    expect(normalizeDomain("rakuten.co.jp")).toBe("rakuten.co.jp");
  });

  test("isBroadDomain: risky providers", () => {
    expect(isBroadDomain("gmail.com")).toBe(true);
    expect(isBroadDomain("outlook.com")).toBe(true);
  });

  test("isBroadDomain: common company domains", () => {
    expect(isBroadDomain("rakuten.co.jp")).toBe(true);
    expect(isBroadDomain("example.com")).toBe(true);
    expect(isBroadDomain("example.net")).toBe(true);
  });

  test("isBroadDomain: not broad (subdomain is more specific)", () => {
    expect(isBroadDomain("alerts.rakuten.co.jp")).toBe(false);
    expect(isBroadDomain("mail.example.com")).toBe(false);
  });
});



