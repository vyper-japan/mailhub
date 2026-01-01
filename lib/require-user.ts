import "server-only";

import { auth } from "@/auth";
import { isTestMode } from "@/lib/test-mode";

const ALLOWED_DOMAIN = "vtj.co.jp";

export type AuthenticatedUser = {
  email: string;
  name?: string | null;
};

export type AuthResult =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; status: 401 | 403; message: string };

/**
 * 認証を必須とする共通関数
 * - テストモード: テストユーザーを返す
 * - 未ログイン: 401
 * - ドメイン不一致: 403
 * - 成功: ユーザー情報を返す
 */
export async function requireUser(): Promise<AuthResult> {
  // テストモードではテストユーザーを返す
  if (isTestMode()) {
    return {
      ok: true,
      user: {
        email: "test-user@vtj.co.jp",
        name: "Test User",
      },
    };
  }

  const session = await auth();

  // 未ログイン
  if (!session?.user?.email) {
    return {
      ok: false,
      status: 401,
      message: "Unauthorized: Please sign in",
    };
  }

  const email = session.user.email;

  // ドメインチェック
  if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    return {
      ok: false,
      status: 403,
      message: `Forbidden: Only ${ALLOWED_DOMAIN} users are allowed`,
    };
  }

  return {
    ok: true,
    user: {
      email,
      name: session.user.name,
    },
  };
}

/**
 * API route用のヘルパー
 * 認証失敗時は適切なJSON Responseを返す
 */
export function authErrorResponse(result: Extract<AuthResult, { ok: false }>) {
  return Response.json(
    { error: result.status === 401 ? "unauthorized" : "forbidden", message: result.message },
    { status: result.status }
  );
}

