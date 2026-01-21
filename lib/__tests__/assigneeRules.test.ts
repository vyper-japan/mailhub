import { describe, it, expect } from "vitest";
import {
  matchAssigneeRule,
  pickAssigneeRule,
  isDangerousDomain,
  normalizeVtjEmail,
  type AssigneeRule,
} from "@/lib/assigneeRules";

function rule(partial: Partial<AssigneeRule>): AssigneeRule {
  return {
    id: partial.id ?? "r1",
    enabled: partial.enabled ?? true,
    priority: partial.priority ?? 0,
    match: partial.match ?? { fromDomain: "example.com" },
    assigneeEmail: partial.assigneeEmail ?? "test@vtj.co.jp",
    when: partial.when ?? { unassignedOnly: true },
    safety: partial.safety ?? { dangerousDomainConfirm: false },
    createdAt: partial.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: partial.updatedAt,
  };
}

describe("assigneeRules", () => {
  describe("normalizeVtjEmail", () => {
    it("accepts vtj.co.jp only", () => {
      expect(normalizeVtjEmail("Test@vtj.co.jp")).toBe("test@vtj.co.jp");
      expect(normalizeVtjEmail("x@example.com")).toBeNull();
      expect(normalizeVtjEmail("")).toBeNull();
    });
  });

  describe("isDangerousDomain", () => {
    it("flags common public domains", () => {
      expect(isDangerousDomain("gmail.com")).toBe(true);
      expect(isDangerousDomain("@gmail.com")).toBe(true);
      expect(isDangerousDomain("vtj.co.jp")).toBe(false);
    });
  });

  describe("matchAssigneeRule", () => {
    it("matches by fromEmail", () => {
      const r = rule({ match: { fromEmail: "label-tester@example.com" } });
      expect(matchAssigneeRule("Label Tester <label-tester@example.com>", r).ok).toBe(true);
      expect(matchAssigneeRule("other@example.com", r).ok).toBe(false);
    });

    it("matches by fromDomain", () => {
      const r = rule({ match: { fromDomain: "example.com" } });
      expect(matchAssigneeRule("label-tester@example.com", r).ok).toBe(true);
      expect(matchAssigneeRule("x@other.com", r).ok).toBe(false);
    });
  });

  describe("pickAssigneeRule", () => {
    it("picks lowest priority first", () => {
      const r1 = rule({ id: "r1", priority: 10, match: { fromDomain: "example.com" } });
      const r2 = rule({ id: "r2", priority: 1, match: { fromDomain: "example.com" } });
      expect(pickAssigneeRule("x@example.com", [r1, r2])?.id).toBe("r2");
    });

    it("skips disabled rules", () => {
      const r1 = rule({ id: "r1", enabled: false, match: { fromDomain: "example.com" } });
      const r2 = rule({ id: "r2", enabled: true, match: { fromDomain: "example.com" } });
      expect(pickAssigneeRule("x@example.com", [r1, r2])?.id).toBe("r2");
    });

    it("rejects non-vtj.co.jp assigneeEmail", () => {
      // normalizeVtjEmailで検証される
      expect(normalizeVtjEmail("test@example.com")).toBeNull();
      expect(normalizeVtjEmail("test@vtj.co.jp")).toBe("test@vtj.co.jp");
    });

    it("matches fromEmail exactly", () => {
      const r = rule({ match: { fromEmail: "exact@example.com" } });
      expect(matchAssigneeRule("exact@example.com", r).ok).toBe(true);
      expect(matchAssigneeRule("other@example.com", r).ok).toBe(false);
      expect(matchAssigneeRule("Exact <exact@example.com>", r).ok).toBe(true);
    });

    it("matches fromDomain case-insensitively", () => {
      const r = rule({ match: { fromDomain: "Example.COM" } });
      expect(matchAssigneeRule("x@example.com", r).ok).toBe(true);
      expect(matchAssigneeRule("y@EXAMPLE.COM", r).ok).toBe(true);
      expect(matchAssigneeRule("z@other.com", r).ok).toBe(false);
    });

    it("matches by priority order (lower priority wins)", () => {
      const r1 = rule({ id: "r1", priority: 10, match: { fromDomain: "example.com" } });
      const r2 = rule({ id: "r2", priority: 5, match: { fromEmail: "specific@example.com" } });
      const r3 = rule({ id: "r3", priority: 1, match: { fromDomain: "example.com" } });
      // specific@example.com は r2 と r3 の両方にマッチするが、priority順に評価されるため r3 が返される
      expect(pickAssigneeRule("specific@example.com", [r1, r2, r3])?.id).toBe("r3");
      // other@example.com は r1 と r3 の両方にマッチするが、priority順に評価されるため r3 が返される
      expect(pickAssigneeRule("other@example.com", [r1, r2, r3])?.id).toBe("r3");
    });
  });
});

