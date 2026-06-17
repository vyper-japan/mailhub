import { beforeEach, describe, expect, it } from "vitest";
import {
  brainLedgerEntryToSheetRow,
  getBrainLedgerSheetsConfigured,
  getBrainLedgerStoreType,
  getBrainDecisionLedgerStore,
  parseBrainDecisionLedgerEntry,
  sheetRowToBrainLedgerEntry,
  type BrainDecisionLedgerEntry,
} from "@/lib/brainDecisionLedgerStore";

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

describe("brainDecisionLedgerStore", () => {
  const store = getBrainDecisionLedgerStore("memory");
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    process.env = { ...originalEnv };
    await store.clear();
  });

  it("appends idempotently and lists newest first", async () => {
    await store.append(entry({ decisionId: "older", decidedAt: "2026-06-17T00:00:00.000Z" }));
    await store.append(entry({ decisionId: "newer", decidedAt: "2026-06-17T01:00:00.000Z" }));
    await store.append(entry({ decisionId: "newer", decidedAt: "2026-06-17T01:00:00.000Z" }));

    const entries = await store.list();

    expect(entries.map((item) => item.decisionId)).toEqual(["newer", "older"]);
  });

  it("filters by message and latest", async () => {
    await store.append(entry({ decisionId: "m1-old", messageId: "m-1", decidedAt: "2026-06-17T00:00:00.000Z" }));
    await store.append(entry({ decisionId: "m2", messageId: "m-2", decidedAt: "2026-06-17T01:00:00.000Z" }));
    await store.append(entry({ decisionId: "m1-new", messageId: "m-1", decidedAt: "2026-06-17T02:00:00.000Z" }));

    const entries = await store.list({ messageId: "m-1", latest: true });

    expect(entries.map((item) => item.decisionId)).toEqual(["m1-new"]);
  });

  it("normalizes evidence and strips oversized free text", () => {
    const parsed = parseBrainDecisionLedgerEntry({
      ...entry(),
      evidence: [{ type: "body", source: "body", summary: "x".repeat(500), ref: "r".repeat(200) }],
      confidence: 2,
    });

    expect(parsed).toMatchObject({ confidence: 1 });
    expect(parsed?.evidence[0]?.summary).toHaveLength(200);
    expect(parsed?.evidence[0]?.ref).toHaveLength(120);
  });

  it("round-trips compact Sheets rows", () => {
    const source = entry({
      decisionId: "sheet-1",
      warnings: ["suggestion_only"],
      plannedActions: [{ type: "draft_reply", destructive: false, requiresHumanApproval: true }],
      evidence: [{ type: "keyword", source: "subject", summary: "問い合わせ" }],
    });

    const parsed = sheetRowToBrainLedgerEntry(brainLedgerEntryToSheetRow(source));

    expect(parsed).toMatchObject({
      decisionId: "sheet-1",
      messageId: "m-1",
      plannedActions: [{ type: "draft_reply", destructive: false, requiresHumanApproval: true }],
      evidence: [{ type: "keyword", source: "subject", summary: "問い合わせ" }],
      warnings: ["suggestion_only"],
    });
  });

  it("resolves Sheets only when required Sheets credentials exist", () => {
    process.env.MAILHUB_BRAIN_LEDGER_STORE = "sheets";
    delete process.env.MAILHUB_SHEETS_ID;
    delete process.env.MAILHUB_SHEETS_SPREADSHEET_ID;
    delete process.env.MAILHUB_SHEETS_CLIENT_EMAIL;
    delete process.env.MAILHUB_SHEETS_PRIVATE_KEY;

    expect(getBrainLedgerSheetsConfigured()).toBe(false);
    expect(getBrainLedgerStoreType()).toBe("memory");

    process.env.MAILHUB_SHEETS_SPREADSHEET_ID = "sheet-1";
    process.env.MAILHUB_SHEETS_CLIENT_EMAIL = "svc@example.com";
    process.env.MAILHUB_SHEETS_PRIVATE_KEY = "private-key";

    expect(getBrainLedgerSheetsConfigured()).toBe(true);
    expect(getBrainLedgerStoreType()).toBe("sheets");
  });
});
