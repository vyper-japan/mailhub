import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBrainDecisionLedgerStore, type BrainDecisionLedgerEntry } from "@/lib/brainDecisionLedgerStore";

const routeMocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
}));

vi.mock("@/lib/require-user", () => ({
  requireUser: routeMocks.requireUser,
  authErrorResponse: (result: { status: number; message: string }) =>
    Response.json({ error: "unauthorized", message: result.message }, { status: result.status }),
}));

function entry(overrides: Partial<BrainDecisionLedgerEntry> = {}): BrainDecisionLedgerEntry {
  return {
    decisionId: "decision-1",
    schemaVersion: 1,
    decidedAt: "2026-06-17T00:00:00.000Z",
    messageId: "m-1",
    threadId: "t-1",
    source: "brain_worker",
    inputHash: "hash-1",
    purpose: "inquiry",
    disposition: "reply",
    replyRoute: "gmail",
    confidence: 0.8,
    humanRequired: true,
    discardCandidate: false,
    plannedActions: [{ type: "draft_reply", destructive: false, requiresHumanApproval: true }],
    evidence: [{ type: "keyword", source: "subject", summary: "問い合わせ" }],
    warnings: ["suggestion_only"],
    ...overrides,
  };
}

async function importRoute() {
  vi.resetModules();
  return await import("@/app/api/mailhub/brain/decisions/route");
}

describe("mailhub brain decisions route", () => {
  const originalEnv = { ...process.env };
  const store = getBrainDecisionLedgerStore("memory");

  beforeEach(async () => {
    process.env = { ...originalEnv, MAILHUB_BRAIN_LEDGER_STORE: "memory", MAILHUB_BRAIN_SECRET: "secret-1" };
    routeMocks.requireUser.mockReset().mockResolvedValue({
      ok: true,
      user: { email: "test@vtj.co.jp", name: "Test" },
    });
    await store.clear();
  });

  it("requires a Brain worker bearer secret for POST", async () => {
    const { POST } = await importRoute();

    const res = await POST(new Request("http://localhost/api/mailhub/brain/decisions", {
      method: "POST",
      body: JSON.stringify(entry()),
    }));

    expect(res.status).toBe(403);
    expect(await store.list()).toEqual([]);
  });

  it("appends a non-destructive decision and GET returns it", async () => {
    const { GET, POST } = await importRoute();

    const postRes = await POST(new Request("http://localhost/api/mailhub/brain/decisions", {
      method: "POST",
      headers: { authorization: "Bearer secret-1" },
      body: JSON.stringify(entry()),
    }));
    expect(postRes.status).toBe(200);

    const getRes = await GET(new Request("http://localhost/api/mailhub/brain/decisions?messageId=m-1&latest=1"));
    const json = (await getRes.json()) as { entries: BrainDecisionLedgerEntry[] };

    expect(getRes.status).toBe(200);
    expect(json.entries).toHaveLength(1);
    expect(json.entries[0]).toMatchObject({
      decisionId: "decision-1",
      messageId: "m-1",
      plannedActions: [{ destructive: false }],
    });
  });

  it("rejects destructive planned actions", async () => {
    const { POST } = await importRoute();

    const res = await POST(new Request("http://localhost/api/mailhub/brain/decisions", {
      method: "POST",
      headers: { authorization: "Bearer secret-1" },
      body: JSON.stringify({
        ...entry(),
        plannedActions: [{ type: "archive", destructive: true, requiresHumanApproval: true }],
      }),
    }));

    expect(res.status).toBe(400);
    expect(await store.list()).toEqual([]);
  });
});
