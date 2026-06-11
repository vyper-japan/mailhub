import { createHash } from "crypto";
import type { RegisteredLabel } from "@/lib/labelRegistryStore";
import type { LabelRule } from "@/lib/labelRules";
import type { AssigneeEntry } from "@/lib/assigneeRegistryStore";
import { normalizeAssignees } from "@/lib/assigneeRegistryStore";

export type LabelDiffItem = {
  labelName: string;
  beforeDisplayName?: string;
  afterDisplayName?: string;
};

export type RuleDiffItem = {
  id: string;
};

export type AssigneeDiffItem = {
  email: string;
  beforeDisplayName?: string;
  afterDisplayName?: string;
};

export type DiffBucket<T> = {
  sourceCount: number;
  targetCount: number;
  willAdd: number;
  willUpdate: number;
  willSkip: number;
  add: T[];
  update: T[];
  skip: T[];
};

export type ImportPreviewV2 = {
  labels: DiffBucket<LabelDiffItem>;
  rules: DiffBucket<RuleDiffItem>;
  assignees: DiffBucket<AssigneeDiffItem>;
  warnings: Array<{ level: "danger"; message: string; totalChanges: number; threshold: number }>;
  requiresConfirm: boolean;
};

const DANGER_THRESHOLD = 50;

export function buildLabelIndex(labels: RegisteredLabel[]): Map<string, RegisteredLabel> {
  return new Map(labels.map((l) => [l.labelName, l]));
}

export function buildRuleIndex(rules: LabelRule[]): Map<string, LabelRule> {
  return new Map(rules.map((r) => [r.id, r]));
}

function buildAssigneeIndex(assignees: AssigneeEntry[]): Map<string, AssigneeEntry> {
  return new Map(normalizeAssignees(assignees).map((a) => [a.email, a]));
}

function normalizeRule(r: LabelRule): LabelRule {
  return {
    ...r,
    labelNames: r.labelNames?.length ? r.labelNames : r.labelName ? [r.labelName] : [],
  };
}

function canonicalAssignTo(assignTo: LabelRule["assignTo"] | null | undefined): string {
  if (assignTo == null) return "";
  if (assignTo === "me") return "me";
  return JSON.stringify({ assigneeEmail: assignTo.assigneeEmail });
}

export function computeImportPreview(input: {
  sourceLabels: RegisteredLabel[];
  targetLabels: RegisteredLabel[];
  sourceRules: LabelRule[];
  targetRules: LabelRule[];
  sourceAssignees: AssigneeEntry[];
  targetAssignees: AssigneeEntry[];
}): ImportPreviewV2 {
  const sL = buildLabelIndex(input.sourceLabels);
  const tL = buildLabelIndex(input.targetLabels);
  const addLabels: LabelDiffItem[] = [];
  const updateLabels: LabelDiffItem[] = [];
  const skipLabels: LabelDiffItem[] = [];
  for (const [k, v] of sL) {
    const cur = tL.get(k);
    if (!cur) {
      addLabels.push({ labelName: k, afterDisplayName: v.displayName ?? "" });
      continue;
    }
    if ((cur.displayName ?? "") !== (v.displayName ?? "")) {
      updateLabels.push({
        labelName: k,
        beforeDisplayName: cur.displayName ?? "",
        afterDisplayName: v.displayName ?? "",
      });
    } else {
      skipLabels.push({ labelName: k, afterDisplayName: v.displayName ?? "" });
    }
  }

  const sR = buildRuleIndex(input.sourceRules.map(normalizeRule));
  const tR = buildRuleIndex(input.targetRules.map(normalizeRule));
  const addRules: RuleDiffItem[] = [];
  const updateRules: RuleDiffItem[] = [];
  const skipRules: RuleDiffItem[] = [];
  for (const [id, v] of sR) {
    const cur = tR.get(id);
    if (!cur) {
      addRules.push({ id });
      continue;
    }
    const same =
      cur.enabled === v.enabled &&
      (cur.match.fromEmail ?? "") === (v.match.fromEmail ?? "") &&
      (cur.match.fromDomain ?? "") === (v.match.fromDomain ?? "") &&
      JSON.stringify((cur.labelNames ?? []).slice().sort()) === JSON.stringify((v.labelNames ?? []).slice().sort()) &&
      canonicalAssignTo(cur.assignTo) === canonicalAssignTo(v.assignTo);
    if (!same) {
      updateRules.push({ id });
    } else {
      skipRules.push({ id });
    }
  }

  const sourceAssignees = normalizeAssignees(input.sourceAssignees);
  const sA = buildAssigneeIndex(sourceAssignees);
  const tA = buildAssigneeIndex(input.targetAssignees);
  const addAssignees: AssigneeDiffItem[] = [];
  const updateAssignees: AssigneeDiffItem[] = [];
  const skipAssignees: AssigneeDiffItem[] = [];
  for (const [email, v] of sA) {
    const cur = tA.get(email);
    if (!cur) {
      addAssignees.push({ email, afterDisplayName: v.displayName ?? "" });
      continue;
    }
    if ((cur.displayName ?? "") !== (v.displayName ?? "")) {
      updateAssignees.push({
        email,
        beforeDisplayName: cur.displayName ?? "",
        afterDisplayName: v.displayName ?? "",
      });
    } else {
      skipAssignees.push({ email, afterDisplayName: v.displayName ?? "" });
    }
  }

  const totalChanges = addLabels.length + updateLabels.length + addRules.length + updateRules.length + addAssignees.length + updateAssignees.length;
  const warnings =
    totalChanges >= DANGER_THRESHOLD
      ? [
          {
            level: "danger" as const,
            message: `⚠️ 変更件数が${totalChanges}件です。意図した差分か必ず確認してください。`,
            totalChanges,
            threshold: DANGER_THRESHOLD,
          },
        ]
      : [];

  return {
    labels: {
      sourceCount: input.sourceLabels.length,
      targetCount: input.targetLabels.length,
      willAdd: addLabels.length,
      willUpdate: updateLabels.length,
      willSkip: skipLabels.length,
      add: addLabels,
      update: updateLabels,
      skip: skipLabels,
    },
    rules: {
      sourceCount: input.sourceRules.length,
      targetCount: input.targetRules.length,
      willAdd: addRules.length,
      willUpdate: updateRules.length,
      willSkip: skipRules.length,
      add: addRules,
      update: updateRules,
      skip: skipRules,
    },
    assignees: {
      sourceCount: sourceAssignees.length,
      targetCount: normalizeAssignees(input.targetAssignees).length,
      willAdd: addAssignees.length,
      willUpdate: updateAssignees.length,
      willSkip: skipAssignees.length,
      add: addAssignees,
      update: updateAssignees,
      skip: skipAssignees,
    },
    warnings,
    requiresConfirm: warnings.length > 0,
  };
}

export function buildPreviewToken(preview: ImportPreviewV2): string {
  return createHash("sha256").update(JSON.stringify(preview)).digest("hex").slice(0, 12);
}
