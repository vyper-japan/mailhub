/**
 * READ ONLY モード
 * - 実データ（shared inbox）接続時に事故らないための最優先安全装置
 * - サーバ側拒否が必須（UIは補助）
 */

import { getMailhubEnv } from "@/lib/mailhub-env";
import { isTestMode } from "@/lib/test-mode";

declare global {
  // eslint-disable-next-line no-var
  var __mailhubTestReadOnly: boolean | undefined;
}

/**
 * TEST_MODE限定: E2E等でREAD ONLYを擬似的に切り替えるためのフック
 * - 本番/通常環境には影響しない（isTestMode()の時だけ参照）
 */
export function setTestReadOnlyMode(v: boolean | null): void {
  if (!isTestMode()) return;
  globalThis.__mailhubTestReadOnly = v === null ? undefined : v;
}

export function isReadOnlyMode(): boolean {
  // クライアントに紛れ込んでも安全側に倒す（env参照しない）
  if (typeof window !== "undefined") return false;
  // TEST_MODEのみ：E2EでREAD ONLYを再現するための上書き
  if (isTestMode() && typeof globalThis.__mailhubTestReadOnly === "boolean") {
    return globalThis.__mailhubTestReadOnly;
  }
  const raw = (process.env.MAILHUB_READ_ONLY ?? "").trim();
  if (raw === "1") return true;
  if (raw === "0") return false;
  // staging は「設定漏れでも事故ゼロ」に倒す（デフォルトREAD ONLY）
  return getMailhubEnv() === "staging";
}

export function writeForbiddenResponse(reason = "read_only"): Response {
  return Response.json(
    { error: "read_only", message: "READ ONLYのため実行できません", reason },
    { status: 403 },
  );
}


