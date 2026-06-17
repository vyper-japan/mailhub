import { describe, expect, it } from "vitest";
import { getStaffAccessDiagnostics, isStaffAccessAllowed, parseStaffEmailList } from "@/lib/staffAccess";

describe("staffAccess", () => {
  it("parses comma, newline, and display-name staff entries", () => {
    expect(parseStaffEmailList("Admin <Admin@vtj.co.jp>, user@vtj.co.jp\nbad, outside@example.com")).toEqual([
      { raw: "Admin <Admin@vtj.co.jp>", email: "admin@vtj.co.jp", valid: true, vtj: true },
      { raw: "user@vtj.co.jp", email: "user@vtj.co.jp", valid: true, vtj: true },
      { raw: "bad", email: "bad", valid: false, vtj: false },
      { raw: "outside@example.com", email: "outside@example.com", valid: true, vtj: false },
    ]);
  });

  it("keeps legacy vtj-domain access when no staff allowlist is configured", () => {
    const env = { MAILHUB_ADMINS: "", MAILHUB_TEAM_MEMBERS: "" };

    expect(isStaffAccessAllowed("member@vtj.co.jp", env)).toBe(true);
    expect(isStaffAccessAllowed("member@example.com", env)).toBe(false);
  });

  it("limits access to configured admins and team members once allowlist env is set", () => {
    const env = {
      MAILHUB_ADMINS: "Admin@vtj.co.jp",
      MAILHUB_TEAM_MEMBERS: "Ops <ops@vtj.co.jp>,outside@example.com,bad",
    };

    expect(isStaffAccessAllowed("admin@vtj.co.jp", env)).toBe(true);
    expect(isStaffAccessAllowed("ops@vtj.co.jp", env)).toBe(true);
    expect(isStaffAccessAllowed("other@vtj.co.jp", env)).toBe(false);
    expect(isStaffAccessAllowed("outside@example.com", env)).toBe(false);
    expect(getStaffAccessDiagnostics(env)).toEqual({
      configured: true,
      emails: ["admin@vtj.co.jp", "ops@vtj.co.jp"],
      invalid: ["bad"],
      nonVtj: ["outside@example.com"],
      adminCount: 1,
      teamMemberCount: 1,
    });
  });
});
