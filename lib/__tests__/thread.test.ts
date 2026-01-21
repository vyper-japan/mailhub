import { describe, expect, test } from "vitest";
import { extractMailhubUserLabels, receivedAtToMs, statusTypeFromLabelNames } from "@/lib/thread";

describe("thread utils", () => {
  test("statusTypeFromLabelNames", () => {
    expect(statusTypeFromLabelNames([])).toBe("todo");
    expect(statusTypeFromLabelNames(["MailHub/Waiting"])).toBe("waiting");
    expect(statusTypeFromLabelNames(["MailHub/Done"])).toBe("done");
    expect(statusTypeFromLabelNames(["MailHub/Muted"])).toBe("muted");
    expect(statusTypeFromLabelNames(["MailHub/Snoozed"])).toBe("snoozed");
    // defensive precedence
    expect(statusTypeFromLabelNames(["MailHub/Waiting", "MailHub/Muted"])).toBe("muted");
    expect(statusTypeFromLabelNames(["MailHub/Muted", "MailHub/Snoozed"])).toBe("snoozed");
  });

  test("extractMailhubUserLabels", () => {
    const labels = [
      "MailHub/Label/A",
      "MailHub/Label/B",
      "INBOX",
      "MailHub/Waiting",
      "MailHub/Label/C",
    ];
    expect(extractMailhubUserLabels(labels, 2)).toEqual(["MailHub/Label/A", "MailHub/Label/B"]);
    expect(extractMailhubUserLabels(labels, 10)).toEqual([
      "MailHub/Label/A",
      "MailHub/Label/B",
      "MailHub/Label/C",
    ]);
  });

  test("receivedAtToMs", () => {
    expect(receivedAtToMs("2025/12/31 01:30:00")).toBeGreaterThan(0);
    expect(receivedAtToMs("invalid")).toBe(0);
    expect(receivedAtToMs("2025-12-31 01:30:00")).toBe(0);
  });
});

