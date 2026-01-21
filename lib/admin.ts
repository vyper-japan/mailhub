import { isTestMode } from "@/lib/test-mode";

function parseAdminsCsv(csv: string | undefined): Set<string> {
  const raw = (csv ?? "").trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.includes("@")),
  );
}

/**
 * 管理者判定
 * - TEST_MODEではE2Eのため常にtrue
 * - それ以外は MAILHUB_ADMINS のCSVで判定（未設定なら誰もadminではない）
 */
export function isAdminEmail(email: string): boolean {
  if (isTestMode()) return true;
  const admins = parseAdminsCsv(process.env.MAILHUB_ADMINS);
  return admins.has(email.trim().toLowerCase());
}

export function requireAdminOrThrow(userEmail: string): void {
  if (!isAdminEmail(userEmail)) {
    throw new Error("forbidden_admin_only");
  }
}

export function getAdminDiagnostics(): {
  raw: string;
  normalized: string[];
  invalid: string[]; // @を含まない等
  nonVtj: string[]; // vtj.co.jp以外（参考: requireUserがブロックするが、設定ミス検知用）
} {
  const raw = (process.env.MAILHUB_ADMINS ?? "").trim();
  const parts = raw ? raw.split(",").map((s) => s.trim()) : [];
  const normalized = parts.filter(Boolean).map((s) => s.toLowerCase());
  const invalid = normalized.filter((s) => !s.includes("@"));
  const nonVtj = normalized.filter((s) => s.includes("@") && !s.endsWith("@vtj.co.jp"));
  return { raw, normalized, invalid, nonVtj };
}


