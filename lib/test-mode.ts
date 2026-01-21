/**
 * テストモード判定
 * - MAILHUB_TEST_MODE=1 かつ NODE_ENV !== 'production' のときのみ有効
 * - production では絶対に有効にならないようガード
 */
export function isTestMode(): boolean {
  // クライアントに紛れ込んでも安全側に倒す（環境変数を参照しない）
  if (typeof window !== "undefined") {
    return false;
  }
  // production では絶対に無効
  if (process.env.NODE_ENV === "production") {
    return false;
  }
  return process.env.MAILHUB_TEST_MODE === "1";
}

/**
 * テストモードでのみ実行される処理のガード
 */
export function assertTestMode(context: string): void {
  if (!isTestMode()) {
    throw new Error(`[${context}] Test mode is not enabled. This should never happen in production.`);
  }
}





