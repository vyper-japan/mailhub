import "server-only";

import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

export type BrainLedgerStoreType = "memory" | "file";
export type BrainLedgerSource = "brain_worker" | "manual_test" | "replay" | "deterministic_v1";

export type BrainLedgerEvidence = {
  type: string;
  source: string;
  summary: string;
  ref?: string;
};

export type BrainLedgerPlannedAction = {
  type: string;
  destructive: false;
  requiresHumanApproval: boolean;
};

export type BrainDecisionLedgerEntry = {
  decisionId: string;
  schemaVersion: 1;
  decidedAt: string;
  messageId: string;
  threadId?: string | null;
  source: BrainLedgerSource;
  model?: string;
  promptVersion?: string;
  policyVersion?: string;
  inputHash: string;
  purpose: string;
  disposition: string;
  replyRoute: string;
  recommendedOwnerEmail?: string | null;
  confidence: number;
  humanRequired: boolean;
  discardCandidate?: boolean;
  invoiceFlag?: boolean;
  plannedActions: BrainLedgerPlannedAction[];
  evidence: BrainLedgerEvidence[];
  warnings?: string[];
};

export type BrainLedgerListOptions = {
  limit?: number;
  messageId?: string;
  threadId?: string;
  humanRequired?: boolean;
  purpose?: string;
  latest?: boolean;
};

export interface BrainDecisionLedgerStore {
  append(entry: BrainDecisionLedgerEntry): Promise<void>;
  list(options?: BrainLedgerListOptions): Promise<BrainDecisionLedgerEntry[]>;
  clear(): Promise<void>;
}

const MAX_MEMORY_ENTRIES = 1000;
const MAX_LIST_LIMIT = 200;
const FILE_STORE_PATH = join(process.cwd(), ".mailhub", "brainDecisions.jsonl");
const memoryKey = "__mailhub_brain_decision_ledger";

function getMemoryBuffer(): BrainDecisionLedgerEntry[] {
  const g = globalThis as unknown as Record<string, unknown>;
  const existing = g[memoryKey];
  if (Array.isArray(existing)) return existing as BrainDecisionLedgerEntry[];
  const next: BrainDecisionLedgerEntry[] = [];
  g[memoryKey] = next;
  return next;
}

function clampText(value: unknown, max = 200): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

function clampOptionalEmail(value: unknown): string | null | undefined {
  if (value === null) return null;
  const text = clampText(value, 254);
  if (!text) return undefined;
  return text.includes("@") ? text.toLowerCase() : undefined;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeSource(value: unknown): BrainLedgerSource {
  return value === "brain_worker" || value === "manual_test" || value === "replay" || value === "deterministic_v1"
    ? value
    : "brain_worker";
}

function normalizeEvidence(value: unknown): BrainLedgerEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((item): BrainLedgerEvidence[] => {
    const obj = asObject(item);
    const type = clampText(obj.type, 64);
    const source = clampText(obj.source, 64);
    const summary = clampText(obj.summary, 200);
    if (!type || !source || !summary) return [];
    const ref = clampText(obj.ref, 120);
    return [{ type, source, summary, ...(ref ? { ref } : {}) }];
  });
}

function normalizePlannedActions(value: unknown): BrainLedgerPlannedAction[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).flatMap((item): BrainLedgerPlannedAction[] => {
    const obj = asObject(item);
    const type = clampText(obj.type, 64);
    if (!type || obj.destructive !== false) return [];
    return [{
      type,
      destructive: false,
      requiresHumanApproval: obj.requiresHumanApproval !== false,
    }];
  });
}

function normalizeWarnings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const warnings = value.flatMap((item) => {
    const text = clampText(item, 80);
    return text ? [text] : [];
  }).slice(0, 20);
  return warnings.length > 0 ? warnings : undefined;
}

export function parseBrainDecisionLedgerEntry(value: unknown): BrainDecisionLedgerEntry | null {
  const obj = asObject(value);
  const decisionId = clampText(obj.decisionId, 160);
  const messageId = clampText(obj.messageId, 256);
  const inputHash = clampText(obj.inputHash, 160);
  const purpose = clampText(obj.purpose, 80);
  const disposition = clampText(obj.disposition, 80);
  const replyRoute = clampText(obj.replyRoute, 80);
  const confidence = typeof obj.confidence === "number" && Number.isFinite(obj.confidence)
    ? Math.max(0, Math.min(1, obj.confidence))
    : null;
  if (!decisionId || !messageId || !inputHash || !purpose || !disposition || !replyRoute || confidence === null) {
    return null;
  }

  const decidedAt = clampText(obj.decidedAt, 40) ?? new Date().toISOString();
  const threadId = obj.threadId === null ? null : clampText(obj.threadId, 256);
  const model = clampText(obj.model, 80);
  const promptVersion = clampText(obj.promptVersion, 80);
  const policyVersion = clampText(obj.policyVersion, 80);
  const recommendedOwnerEmail = clampOptionalEmail(obj.recommendedOwnerEmail);
  const evidence = normalizeEvidence(obj.evidence);
  const plannedActions = normalizePlannedActions(obj.plannedActions);

  return {
    decisionId,
    schemaVersion: 1,
    decidedAt,
    messageId,
    ...(threadId !== undefined ? { threadId } : {}),
    source: normalizeSource(obj.source),
    ...(model ? { model } : {}),
    ...(promptVersion ? { promptVersion } : {}),
    ...(policyVersion ? { policyVersion } : {}),
    inputHash,
    purpose,
    disposition,
    replyRoute,
    ...(recommendedOwnerEmail !== undefined ? { recommendedOwnerEmail } : {}),
    confidence,
    humanRequired: obj.humanRequired !== false,
    ...(typeof obj.discardCandidate === "boolean" ? { discardCandidate: obj.discardCandidate } : {}),
    ...(typeof obj.invoiceFlag === "boolean" ? { invoiceFlag: obj.invoiceFlag } : {}),
    plannedActions,
    evidence,
    ...(normalizeWarnings(obj.warnings) ? { warnings: normalizeWarnings(obj.warnings) } : {}),
  };
}

function applyFilters(entries: BrainDecisionLedgerEntry[], options?: BrainLedgerListOptions): BrainDecisionLedgerEntry[] {
  let result = [...entries].sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
  if (options?.messageId) result = result.filter((entry) => entry.messageId === options.messageId);
  if (options?.threadId) result = result.filter((entry) => entry.threadId === options.threadId);
  if (typeof options?.humanRequired === "boolean") {
    result = result.filter((entry) => entry.humanRequired === options.humanRequired);
  }
  if (options?.purpose) result = result.filter((entry) => entry.purpose === options.purpose);
  if (options?.latest) return result.slice(0, 1);
  return result.slice(0, Math.min(Math.max(options?.limit ?? 50, 1), MAX_LIST_LIMIT));
}

class MemoryBrainDecisionLedgerStore implements BrainDecisionLedgerStore {
  async append(entry: BrainDecisionLedgerEntry): Promise<void> {
    const buffer = getMemoryBuffer();
    if (buffer.some((item) => item.decisionId === entry.decisionId)) return;
    buffer.push(entry);
    if (buffer.length > MAX_MEMORY_ENTRIES) {
      buffer.splice(0, buffer.length - MAX_MEMORY_ENTRIES);
    }
  }

  async list(options?: BrainLedgerListOptions): Promise<BrainDecisionLedgerEntry[]> {
    return applyFilters(getMemoryBuffer(), options);
  }

  async clear(): Promise<void> {
    getMemoryBuffer().splice(0);
  }
}

class FileBrainDecisionLedgerStore implements BrainDecisionLedgerStore {
  private async ensureDir(): Promise<void> {
    const dir = join(process.cwd(), ".mailhub");
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  }

  private async readAll(): Promise<BrainDecisionLedgerEntry[]> {
    await this.ensureDir();
    if (!existsSync(FILE_STORE_PATH)) return [];
    const content = await readFile(FILE_STORE_PATH, "utf-8");
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line): BrainDecisionLedgerEntry[] => {
        try {
          const parsed = parseBrainDecisionLedgerEntry(JSON.parse(line));
          return parsed ? [parsed] : [];
        } catch {
          return [];
        }
      });
  }

  async append(entry: BrainDecisionLedgerEntry): Promise<void> {
    await this.ensureDir();
    const existing = await this.readAll();
    if (existing.some((item) => item.decisionId === entry.decisionId)) return;
    await writeFile(FILE_STORE_PATH, `${JSON.stringify(entry)}\n`, { flag: "a" });
  }

  async list(options?: BrainLedgerListOptions): Promise<BrainDecisionLedgerEntry[]> {
    return applyFilters(await this.readAll(), options);
  }

  async clear(): Promise<void> {
    await this.ensureDir();
    await writeFile(FILE_STORE_PATH, "", "utf-8");
  }
}

export function getBrainLedgerStoreType(): BrainLedgerStoreType {
  const raw = process.env.MAILHUB_BRAIN_LEDGER_STORE?.trim();
  if (raw === "memory" || raw === "file") return raw;
  return process.env.NODE_ENV === "production" ? "file" : "memory";
}

let memoryStore: BrainDecisionLedgerStore | null = null;
let fileStore: BrainDecisionLedgerStore | null = null;

export function getBrainDecisionLedgerStore(forceType?: BrainLedgerStoreType): BrainDecisionLedgerStore {
  const type = forceType ?? getBrainLedgerStoreType();
  if (type === "file") {
    fileStore ??= new FileBrainDecisionLedgerStore();
    return fileStore;
  }
  memoryStore ??= new MemoryBrainDecisionLedgerStore();
  return memoryStore;
}
