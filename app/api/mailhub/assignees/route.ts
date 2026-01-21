import { NextResponse, type NextRequest } from "next/server";
import { getAssigneeRegistryStore, type AssigneeEntry } from "@/lib/assigneeRegistryStore";
import { isAdminEmail } from "@/lib/admin";
import { requireUser, authErrorResponse } from "@/lib/require-user";
import { isTestMode } from "@/lib/test-mode";
import { getResolvedConfigStoreType } from "@/lib/configStore";

export const dynamic = "force-dynamic";

/**
 * GET /api/mailhub/assignees
 * 担当者名簿を取得（誰でもOK）
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_req: NextRequest) {
  try {
    const authResult = await requireUser();
    if (!authResult.ok) {
      return authErrorResponse(authResult);
    }
    const isAdmin = isTestMode() || isAdminEmail(authResult.user.email);
    const storeType = getResolvedConfigStoreType();

    const store = getAssigneeRegistryStore();
    const assignees = await store.list();

    return NextResponse.json({
      assignees,
      isAdmin,
      storeType,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[GET /api/mailhub/assignees] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /api/mailhub/assignees
 * 担当者名簿を全置換（adminのみ）
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await requireUser();
    if (!authResult.ok) {
      return authErrorResponse(authResult);
    }
    const isAdmin = isTestMode() || isAdminEmail(authResult.user.email);

    if (!isAdmin) {
      return NextResponse.json({ error: "admin_only" }, { status: 403 });
    }

    const body = (await req.json()) as { assignees?: unknown };
    if (!body.assignees || !Array.isArray(body.assignees)) {
      return NextResponse.json({ error: "assignees_required" }, { status: 400 });
    }

    // バリデーション: 各エントリがemail持ちか
    const entries: AssigneeEntry[] = body.assignees.map((x: unknown) => {
      const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
      return {
        email: typeof o.email === "string" ? o.email : "",
        displayName: typeof o.displayName === "string" ? o.displayName : undefined,
      };
    });

    // 空emailは除外
    const validEntries = entries.filter((e) => e.email.includes("@"));

    const store = getAssigneeRegistryStore();
    const saved = await store.replaceAll(validEntries);

    return NextResponse.json({ assignees: saved, success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("assignee_invalid_domain")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error("[POST /api/mailhub/assignees] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
