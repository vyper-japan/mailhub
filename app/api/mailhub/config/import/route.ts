import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { getResolvedConfigStoreType } from "@/lib/configStore";
import { isAdminEmail } from "@/lib/admin";
import { getLabelRegistryFileStoreForImport, overwriteRegisteredLabelsForImport } from "@/lib/labelRegistryStore";
import { getLabelRulesFileStoreForImport, overwriteLabelRulesForImport } from "@/lib/labelRulesStore";
import { getLabelRegistryStore } from "@/lib/labelRegistryStore";
import { getLabelRulesStore } from "@/lib/labelRulesStore";
import type { RegisteredLabel } from "@/lib/labelRegistryStore";
import type { LabelRule } from "@/lib/labelRules";
import { isReadOnlyMode, writeForbiddenResponse } from "@/lib/read-only";
import { logAction } from "@/lib/audit-log";
import { isTestMode } from "@/lib/test-mode";
import { createHash } from "crypto";

export const dynamic = "force-dynamic";

type LabelDiffItem = {
  labelName: string;
  beforeDisplayName?: string;
  afterDisplayName?: string;
};

type RuleDiffItem = {
  id: string;
};

type Preview = {
  labels: {
    sourceCount: number;
    targetCount: number;
    willAdd: number;
    willUpdate: number;
    willSkip: number;
    add: LabelDiffItem[];
    update: LabelDiffItem[];
    skip: LabelDiffItem[];
  };
  rules: {
    sourceCount: number;
    targetCount: number;
    willAdd: number;
    willUpdate: number;
    willSkip: number;
    add: RuleDiffItem[];
    update: RuleDiffItem[];
    skip: RuleDiffItem[];
  };
  warnings: Array<{ level: "danger"; message: string; totalChanges: number; threshold: number }>;
  requiresConfirm: boolean;
};

function buildLabelIndex(labels: RegisteredLabel[]): Map<string, RegisteredLabel> {
  return new Map(labels.map((l) => [l.labelName, l]));
}

function buildRuleIndex(rules: LabelRule[]): Map<string, LabelRule> {
  return new Map(rules.map((r) => [r.id, r]));
}

function normalizeRule(r: LabelRule): LabelRule {
  return {
    ...r,
    labelNames: r.labelNames?.length ? r.labelNames : r.labelName ? [r.labelName] : [],
  };
}

function computePreview(sourceLabels: RegisteredLabel[], targetLabels: RegisteredLabel[], sourceRules: LabelRule[], targetRules: LabelRule[]): Preview {
  const sL = buildLabelIndex(sourceLabels);
  const tL = buildLabelIndex(targetLabels);
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

  const sR = buildRuleIndex(sourceRules.map(normalizeRule));
  const tR = buildRuleIndex(targetRules.map(normalizeRule));
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
      JSON.stringify((cur.labelNames ?? []).slice().sort()) === JSON.stringify((v.labelNames ?? []).slice().sort());
    if (!same) {
      updateRules.push({ id });
    } else {
      skipRules.push({ id });
    }
  }

  const willAddL = addLabels.length;
  const willUpdateL = updateLabels.length;
  const willSkipL = skipLabels.length;
  const willAddR = addRules.length;
  const willUpdateR = updateRules.length;
  const willSkipR = skipRules.length;
  const totalChanges = willAddL + willUpdateL + willAddR + willUpdateR;
  const DANGER_THRESHOLD = 50;
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
      sourceCount: sourceLabels.length,
      targetCount: targetLabels.length,
      willAdd: willAddL,
      willUpdate: willUpdateL,
      willSkip: willSkipL,
      add: addLabels,
      update: updateLabels,
      skip: skipLabels,
    },
    rules: {
      sourceCount: sourceRules.length,
      targetCount: targetRules.length,
      willAdd: willAddR,
      willUpdate: willUpdateR,
      willSkip: willSkipR,
      add: addRules,
      update: updateRules,
      skip: skipRules,
    },
    warnings,
    requiresConfirm: warnings.length > 0,
  };
}

function buildPreviewToken(preview: Preview): string {
  return createHash("sha256").update(JSON.stringify(preview)).digest("hex").slice(0, 12);
}

export async function POST(req: Request) {
  const authResult = await requireUser();
  if (!authResult.ok) return authErrorResponse(authResult);
  if (!isAdminEmail(authResult.user.email)) {
    return NextResponse.json({ error: "forbidden_admin_only" }, { status: 403 });
  }
  if (isReadOnlyMode()) return writeForbiddenResponse("config_import");

  const storeType = getResolvedConfigStoreType();
  if (storeType !== "sheets" && !isTestMode()) {
    return NextResponse.json({ error: "import_only_for_sheets", storeType }, { status: 400 });
  }

  const raw = (await req.json().catch(() => ({}))) as unknown;
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const dryRun = body.dryRun !== false; // default true
  const log = body.log === true;
  const previewTokenFromClient = typeof body.previewToken === "string" ? body.previewToken : null;
  const confirmed = body.confirmed === true;

  const [sourceLabels, sourceRules] = await Promise.all([
    getLabelRegistryFileStoreForImport().list(),
    getLabelRulesFileStoreForImport().getRules(),
  ]);

  // targetは現store（sheets想定）
  const [targetLabels, targetRules] = await Promise.all([
    getLabelRegistryStore().list(),
    getLabelRulesStore().getRules(),
  ]);

  const preview = computePreview(sourceLabels, targetLabels, sourceRules, targetRules);
  const previewToken = buildPreviewToken(preview);
  if (dryRun) {
    if (log) {
      await logAction({
        actorEmail: authResult.user.email,
        action: "config_import_preview",
        messageId: "meta",
        metadata: { preview },
      });
    }
    return NextResponse.json({ preview, previewToken }, { headers: { "cache-control": "no-store" } });
  }

  if (!previewTokenFromClient) {
    return NextResponse.json({ error: "preview_required", preview, previewToken }, { status: 400 });
  }
  if (previewTokenFromClient !== previewToken) {
    return NextResponse.json({ error: "preview_outdated", preview, previewToken }, { status: 409 });
  }
  if (preview.requiresConfirm && !confirmed) {
    return NextResponse.json({ error: "preview_confirm_required", preview, previewToken }, { status: 400 });
  }

  // 実行: file側を優先ソースとして、同キーは上書き（ただし target にしかないものは残す=非破壊）
  const mergedLabelsMap = buildLabelIndex(targetLabels);
  for (const l of sourceLabels) mergedLabelsMap.set(l.labelName, l);
  const mergedLabels = [...mergedLabelsMap.values()];

  const mergedRulesMap = buildRuleIndex(targetRules);
  for (const r of sourceRules) mergedRulesMap.set(r.id, r);
  const mergedRules = [...mergedRulesMap.values()];

  await overwriteRegisteredLabelsForImport(mergedLabels);
  await overwriteLabelRulesForImport(mergedRules);

  await logAction({
    actorEmail: authResult.user.email,
    action: "config_import_apply",
    messageId: "meta",
    metadata: { preview },
  });

  return NextResponse.json({ ok: true, preview, previewToken }, { headers: { "cache-control": "no-store" } });
}


