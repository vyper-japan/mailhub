import "server-only";

import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { isAdminEmail } from "@/lib/admin";
import { getLabelRegistryStore } from "@/lib/labelRegistryStore";
import { getLabelRulesStore } from "@/lib/labelRulesStore";
import { getAssigneeRegistryStore } from "@/lib/assigneeRegistryStore";
import { getReplyTemplatesStore } from "@/lib/replyTemplatesStore";
import { getSavedSearchesStore } from "@/lib/savedSearchesStore";
import { buildConfigExportFilename, buildConfigExportPayload } from "@/lib/config-export";
import { isTestMode } from "@/lib/test-mode";
import { getMailhubEnv } from "@/lib/mailhub-env";

export const dynamic = "force-dynamic";

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;
  if (!authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.substring(7).trim();
  return token || null;
}

function isAuthorizedBySecret(req: Request): boolean {
  const secret = (process.env.MAILHUB_CONFIG_EXPORT_SECRET ?? "").trim();
  if (!secret) return false;
  const token = getBearerToken(req);
  return token === secret;
}

export async function GET(req: Request): Promise<NextResponse> {
  const env = getMailhubEnv();
  const isProd = env === "production" || process.env.NODE_ENV === "production";

  // 1) Bearer secret（Actions用、セッション不要）
  if (isAuthorizedBySecret(req)) {
    return await exportConfig();
  }

  // 2) Admin session（UI用）
  const authResult = await requireUser();
  if (!authResult.ok) {
    // productionでは未認証を明確に401/403
    return authErrorResponse(authResult);
  }
  if (!isAdminEmail(authResult.user.email)) {
    return NextResponse.json({ error: "forbidden_admin_only" }, { status: 403 });
  }

  // productionでも admin は許可（secret未設定でも可）
  // staging/local/test は admin セッションだけでOK（secret経路も別途OK）
  // test mode: admin扱いだが、念のため production扱いの強制はしない
  if (isProd && !isTestMode()) {
    return await exportConfig();
  }
  return await exportConfig();
}

async function exportConfig(): Promise<NextResponse> {
  const [labels, rules, assignees, templates, savedSearches] = await Promise.all([
    getLabelRegistryStore().list(),
    getLabelRulesStore().getRules(),
    getAssigneeRegistryStore().list().catch(() => []), // Step 82: assigneesを追加
    getReplyTemplatesStore().list().catch(() => []),
    getSavedSearchesStore().list().catch(() => []),
  ]);
  const payload = buildConfigExportPayload({ labels, rules, assignees });
  const notesSchema = { maxBodyLength: 4000 };
  const extendedPayload = {
    ...payload,
    storeType: payload.configStoreType,
    templates,
    savedSearches,
    notesSchema,
  };
  const json = JSON.stringify(extendedPayload, null, 2);
  const filename = buildConfigExportFilename();

  return new NextResponse(json, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

