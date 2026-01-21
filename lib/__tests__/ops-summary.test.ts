import { describe, it, expect } from "vitest";
import { getSLAStatus, getSLAActionName, SLA_RULES } from "@/lib/slaRules";
import { TIME_THRESHOLDS } from "@/lib/time-utils";

describe("Ops Summary", () => {
  describe("SLA_RULES", () => {
    it("should have todo, waiting, and unassigned rules", () => {
      expect(SLA_RULES.length).toBeGreaterThanOrEqual(3);
      expect(SLA_RULES.some((r) => r.type === "todo")).toBe(true);
      expect(SLA_RULES.some((r) => r.type === "waiting")).toBe(true);
      expect(SLA_RULES.some((r) => r.type === "unassigned")).toBe(true);
    });
  });

  describe("getSLAStatus", () => {
    it("should return 'ok' for recent messages", () => {
      const now = new Date();
      const recent = new Date(now.getTime() - 12 * 60 * 60 * 1000); // 12時間前
      const rule = {
        type: "todo" as const,
        warnThresholdMs: TIME_THRESHOLDS.WARNING_TODO,
        criticalThresholdMs: TIME_THRESHOLDS.ERROR_TODO,
        gmailQuery: "",
      };
      expect(getSLAStatus(recent.toISOString(), rule)).toBe("ok");
    });

    it("should return 'warn' for messages older than warn threshold", () => {
      const now = new Date();
      const warnAge = new Date(now.getTime() - 25 * 60 * 60 * 1000); // 25時間前
      const rule = {
        type: "todo" as const,
        warnThresholdMs: TIME_THRESHOLDS.WARNING_TODO,
        criticalThresholdMs: TIME_THRESHOLDS.ERROR_TODO,
        gmailQuery: "",
      };
      expect(getSLAStatus(warnAge.toISOString(), rule)).toBe("warn");
    });

    it("should return 'critical' for messages older than critical threshold", () => {
      const now = new Date();
      const criticalAge = new Date(now.getTime() - 73 * 60 * 60 * 1000); // 73時間前
      const rule = {
        type: "todo" as const,
        warnThresholdMs: TIME_THRESHOLDS.WARNING_TODO,
        criticalThresholdMs: TIME_THRESHOLDS.ERROR_TODO,
        gmailQuery: "",
      };
      expect(getSLAStatus(criticalAge.toISOString(), rule)).toBe("critical");
    });

    it("should return 'ok' for null receivedAt", () => {
      const rule = {
        type: "todo" as const,
        warnThresholdMs: TIME_THRESHOLDS.WARNING_TODO,
        criticalThresholdMs: TIME_THRESHOLDS.ERROR_TODO,
        gmailQuery: "",
      };
      expect(getSLAStatus(null, rule)).toBe("ok");
    });

    it("should return 'ok' for invalid date", () => {
      const rule = {
        type: "todo" as const,
        warnThresholdMs: TIME_THRESHOLDS.WARNING_TODO,
        criticalThresholdMs: TIME_THRESHOLDS.ERROR_TODO,
        gmailQuery: "",
      };
      expect(getSLAStatus("invalid-date", rule)).toBe("ok");
    });

    it("should handle waiting rule thresholds", () => {
      const now = new Date();
      const warnAge = new Date(now.getTime() - 49 * 60 * 60 * 1000); // 49時間前
      const criticalAge = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000); // 8日前
      const rule = {
        type: "waiting" as const,
        warnThresholdMs: TIME_THRESHOLDS.WARNING_WAITING,
        criticalThresholdMs: TIME_THRESHOLDS.ERROR_WAITING,
        gmailQuery: "",
      };
      expect(getSLAStatus(warnAge.toISOString(), rule)).toBe("warn");
      expect(getSLAStatus(criticalAge.toISOString(), rule)).toBe("critical");
    });

    it("should handle unassigned rule thresholds", () => {
      const now = new Date();
      const warnAge = new Date(now.getTime() - 25 * 60 * 60 * 1000); // 25時間前
      const criticalAge = new Date(now.getTime() - 73 * 60 * 60 * 1000); // 73時間前
      const rule = {
        type: "unassigned" as const,
        warnThresholdMs: TIME_THRESHOLDS.WARNING_TODO,
        criticalThresholdMs: TIME_THRESHOLDS.ERROR_TODO,
        gmailQuery: "",
      };
      expect(getSLAStatus(warnAge.toISOString(), rule)).toBe("warn");
      expect(getSLAStatus(criticalAge.toISOString(), rule)).toBe("critical");
    });
  });

  describe("getSLAActionName", () => {
    it("should return valid action names", () => {
      expect(getSLAActionName("todo", "warn")).toBe("sla_todo_warn");
      expect(getSLAActionName("todo", "critical")).toBe("sla_todo_critical");
      expect(getSLAActionName("waiting", "warn")).toBe("sla_waiting_warn");
      expect(getSLAActionName("waiting", "critical")).toBe("sla_waiting_critical");
      expect(getSLAActionName("unassigned", "warn")).toBe("sla_unassigned_warn");
      expect(getSLAActionName("unassigned", "critical")).toBe("sla_unassigned_critical");
    });
  });
});
