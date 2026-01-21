import { describe, it, expect, vi, beforeEach } from "vitest";

// NOTE: vi.fn の型推論が強すぎると TS が never 推論して壊れるため、ここはシンプルにする
const append = vi.fn();
const list = vi.fn();
const clear = vi.fn();

vi.mock("@/lib/activityStore", () => {
  return {
    getActivityStore: () => ({ append, list, clear }),
  };
});

const modP = import("@/lib/audit-log");

describe("audit-log", () => {
  beforeEach(() => {
    append.mockReset().mockResolvedValue(undefined);
    list.mockReset().mockResolvedValue([]);
    clear.mockReset().mockResolvedValue(undefined);
    vi.restoreAllMocks();
  });

  it("isAuditAction should accept known actions and reject unknown", async () => {
    const { isAuditAction } = await modP;
    expect(isAuditAction("assign")).toBe(true);
    expect(isAuditAction("sla_todo_warn")).toBe(true);
    expect(isAuditAction("handoff_preview")).toBe(true);
    expect(isAuditAction("handoff_send")).toBe(true);
    expect(isAuditAction("assignee_rule_preview")).toBe(true);
    expect(isAuditAction("assignee_rule_apply")).toBe(true);
    expect(isAuditAction("unknown_action")).toBe(false);
  });

  it("logAction should console.log JSON and append to store", async () => {
    const { logAction } = await modP;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await logAction({
      actorEmail: "test@vtj.co.jp",
      action: "assign",
      messageId: "msg-1",
      label: "MailHub/Todo",
      metadata: { assigneeEmail: "test@vtj.co.jp" },
    });

    expect(logSpy).toHaveBeenCalled();
    expect(append).toHaveBeenCalledTimes(1);

    const arg = append.mock.calls[0]?.[0] as unknown as {
      timestamp: string;
      actorEmail: string;
      action: string;
      messageId: string;
    };
    expect(typeof arg.timestamp).toBe("string");
    expect(arg.actorEmail).toBe("test@vtj.co.jp");
    expect(arg.action).toBe("assign");
    expect(arg.messageId).toBe("msg-1");
  });

  it("logAction should swallow append errors", async () => {
    const { logAction } = await modP;
    append.mockRejectedValueOnce(new Error("append failed"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      logAction({ actorEmail: "test@vtj.co.jp", action: "assign", messageId: "msg-1", metadata: {} }),
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
  });

  it("getActivityLogs should forward filters to store.list", async () => {
    const { getActivityLogs } = await modP;
    list.mockResolvedValueOnce([{ messageId: "msg-1" }]);

    const logs = await getActivityLogs({ actorEmail: "me@vtj.co.jp", action: "assign", limit: 10 });
    expect(list).toHaveBeenCalledWith({ actorEmail: "me@vtj.co.jp", action: "assign", limit: 10 });
    expect(logs.length).toBe(1);
  });

  it("clearActivityLogs should call store.clear", async () => {
    const { clearActivityLogs } = await modP;
    await clearActivityLogs();
    expect(clear).toHaveBeenCalledTimes(1);
  });
});

