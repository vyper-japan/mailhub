import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { getResolvedConfigStoreType } from "@/lib/configStore";
import { isAdminEmail } from "@/lib/admin";
import { getLabelRegistryFileStoreForImport, overwriteRegisteredLabelsForImport } from "@/lib/labelRegistryStore";
import { getLabelRulesFileStoreForImport, overwriteLabelRulesForImport } from "@/lib/labelRulesStore";
import { getLabelRegistryStore } from "@/lib/labelRegistryStore";
import { getLabelRulesStore } from "@/lib/labelRulesStore";
import {
  getAssigneeRegistryFileStoreForImport,
  getAssigneeRegistryStore,
  getInvalidAssigneeImportSourceEmails,
  normalizeAssignees,
  overwriteAssigneesForImport,
} from "@/lib/assigneeRegistryStore";
import {
  buildLabelIndex,
  buildPreviewToken,
  buildRuleIndex,
  computeImportPreview,
} from "@/lib/config-import-preview";
import { isReadOnlyMode, writeForbiddenResponse } from "@/lib/read-only";
import { logAction } from "@/lib/audit-log";
import { isTestMode } from "@/lib/test-mode";

export const dynamic = "force-dynamic";

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

  const [sourceLabels, sourceRules, rawSourceAssignees] = await Promise.all([
    getLabelRegistryFileStoreForImport().list(),
    getLabelRulesFileStoreForImport().getRules(),
    getAssigneeRegistryFileStoreForImport().list(),
  ]);
  const sourceAssignees = normalizeAssignees(rawSourceAssignees);
  const invalidAssigneeEmails = getInvalidAssigneeImportSourceEmails(sourceAssignees);
  if (invalidAssigneeEmails.length > 0) {
    return NextResponse.json(
      { error: "import_invalid_assignee_domain", emails: invalidAssigneeEmails },
      { status: 400 },
    );
  }

  // targetは現store（sheets想定）
  const [targetLabels, targetRules, targetAssignees] = await Promise.all([
    getLabelRegistryStore().list(),
    getLabelRulesStore().getRules(),
    getAssigneeRegistryStore().list(),
  ]);

  const preview = computeImportPreview({
    sourceLabels,
    targetLabels,
    sourceRules,
    targetRules,
    sourceAssignees,
    targetAssignees,
  });
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
  if (sourceAssignees.length > 0) {
    await overwriteAssigneesForImport(sourceAssignees, targetAssignees);
  }

  await logAction({
    actorEmail: authResult.user.email,
    action: "config_import_apply",
    messageId: "meta",
    metadata: { preview },
  });

  return NextResponse.json({ ok: true, preview, previewToken }, { headers: { "cache-control": "no-store" } });
}

