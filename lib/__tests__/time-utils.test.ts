import { describe, it, expect } from "vitest";
import { formatElapsedTime, getElapsedMs, getElapsedColorTodo, getElapsedColorWaiting, TIME_THRESHOLDS, getSlaLevel } from "@/lib/time-utils";

describe("time-utils", () => {
  describe("formatElapsedTime", () => {
    it("should return '0s' for negative values", () => {
      expect(formatElapsedTime(-1000)).toBe("0s");
    });

    it("should format seconds", () => {
      expect(formatElapsedTime(5000)).toBe("5s");
      expect(formatElapsedTime(59000)).toBe("59s");
    });

    it("should format minutes", () => {
      expect(formatElapsedTime(60000)).toBe("1m");
      expect(formatElapsedTime(300000)).toBe("5m");
    });

    it("should format hours", () => {
      expect(formatElapsedTime(3600000)).toBe("1h");
      expect(formatElapsedTime(7200000)).toBe("2h");
    });

    it("should format days", () => {
      expect(formatElapsedTime(86400000)).toBe("1d");
      expect(formatElapsedTime(172800000)).toBe("2d");
    });
  });

  describe("getElapsedMs", () => {
    it("should return 0 for null", () => {
      expect(getElapsedMs(null)).toBe(0);
    });

    it("should return 0 for invalid date", () => {
      const result = getElapsedMs("invalid-date");
      expect(isNaN(result) || result === 0).toBe(true);
    });

    it("should calculate elapsed time", () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 3600000);
      const elapsed = getElapsedMs(oneHourAgo.toISOString());
      expect(elapsed).toBeGreaterThan(3500000);
      expect(elapsed).toBeLessThan(3700000);
    });
  });

  describe("getElapsedColorTodo", () => {
    it("should return 'default' for recent messages", () => {
      expect(getElapsedColorTodo(12 * 60 * 60 * 1000)).toBe("default");
    });

    it("should return 'warning' for messages older than WARNING_TODO", () => {
      expect(getElapsedColorTodo(TIME_THRESHOLDS.WARNING_TODO)).toBe("warning");
      expect(getElapsedColorTodo(25 * 60 * 60 * 1000)).toBe("warning");
    });

    it("should return 'error' for messages older than ERROR_TODO", () => {
      expect(getElapsedColorTodo(TIME_THRESHOLDS.ERROR_TODO)).toBe("error");
      expect(getElapsedColorTodo(73 * 60 * 60 * 1000)).toBe("error");
    });
  });

  describe("getElapsedColorWaiting", () => {
    it("should return 'default' for recent messages", () => {
      expect(getElapsedColorWaiting(12 * 60 * 60 * 1000)).toBe("default");
    });

    it("should return 'warning' for messages older than WARNING_WAITING", () => {
      expect(getElapsedColorWaiting(TIME_THRESHOLDS.WARNING_WAITING)).toBe("warning");
      expect(getElapsedColorWaiting(49 * 60 * 60 * 1000)).toBe("warning");
    });

    it("should return 'error' for messages older than ERROR_WAITING", () => {
      expect(getElapsedColorWaiting(TIME_THRESHOLDS.ERROR_WAITING)).toBe("error");
      expect(getElapsedColorWaiting(8 * 24 * 60 * 60 * 1000)).toBe("error");
    });
  });

  // Step 66: getSlaLevel tests
  describe("getSlaLevel", () => {
    it("should return 'ok' for done/muted/snoozed status", () => {
      const now = new Date();
      const veryOld = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString();
      expect(getSlaLevel({ statusType: "done", receivedAtIso: veryOld })).toBe("ok");
      expect(getSlaLevel({ statusType: "muted", receivedAtIso: veryOld })).toBe("ok");
      expect(getSlaLevel({ statusType: "snoozed", receivedAtIso: veryOld })).toBe("ok");
    });

    it("should return 'ok' for null receivedAtIso", () => {
      expect(getSlaLevel({ statusType: "todo", receivedAtIso: null })).toBe("ok");
    });

    it("should return 'ok' for recent todo", () => {
      const now = new Date();
      const recent = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(); // 1h ago
      expect(getSlaLevel({ statusType: "todo", receivedAtIso: recent })).toBe("ok");
    });

    it("should return 'warn' for todo older than 24h", () => {
      const now = new Date();
      const old = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString(); // 25h ago
      expect(getSlaLevel({ statusType: "todo", receivedAtIso: old })).toBe("warn");
      expect(getSlaLevel({ statusType: undefined, receivedAtIso: old })).toBe("warn"); // default = todo
    });

    it("should return 'critical' for todo older than 72h", () => {
      const now = new Date();
      const veryOld = new Date(now.getTime() - 73 * 60 * 60 * 1000).toISOString(); // 73h ago
      expect(getSlaLevel({ statusType: "todo", receivedAtIso: veryOld })).toBe("critical");
    });

    it("should return 'ok' for recent waiting", () => {
      const now = new Date();
      const recent = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(); // 24h ago
      expect(getSlaLevel({ statusType: "waiting", receivedAtIso: recent })).toBe("ok");
    });

    it("should return 'warn' for waiting older than 48h", () => {
      const now = new Date();
      const old = new Date(now.getTime() - 49 * 60 * 60 * 1000).toISOString(); // 49h ago
      expect(getSlaLevel({ statusType: "waiting", receivedAtIso: old })).toBe("warn");
    });

    it("should return 'critical' for waiting older than 7d", () => {
      const now = new Date();
      const veryOld = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8d ago
      expect(getSlaLevel({ statusType: "waiting", receivedAtIso: veryOld })).toBe("critical");
    });
  });
});
