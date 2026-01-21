import "server-only";

/**
 * Gmail APIエラーを分類して、適切なエラーコードとメッセージを返す
 */
export type GmailErrorCode =
  | "insufficient_permissions"
  | "invalid_grant"
  | "not_found"
  | "label_missing"
  | "rate_limit_exceeded"
  | "unknown";

export interface GmailErrorInfo {
  error_code: GmailErrorCode;
  message: string;
  debug?: string;
  httpStatus: number;
}

/**
 * Gmail APIエラーを解析して、適切なエラー情報を返す
 */
export function parseGmailError(e: unknown): GmailErrorInfo {
  const error = e && typeof e === "object" ? (e as Record<string, unknown>) : {};
  const errorMessage = (typeof error.message === "string" ? error.message : undefined) || String(e);
  const errorCode = error.code;

  // 403: 権限不足
  if (errorCode === 403 || errorMessage.includes("insufficient") || errorMessage.includes("Insufficient")) {
    return {
      error_code: "insufficient_permissions",
      message: "Gmail APIの権限が不足しています。gmail.modifyスコープでrefresh tokenを再取得してください。",
      debug: errorMessage,
      httpStatus: 403,
    };
  }

  // 401: 認証エラー（refresh token無効など）
  if (errorCode === 401 || errorMessage.includes("invalid_grant") || errorMessage.includes("401")) {
    return {
      error_code: "invalid_grant",
      message: "認証エラーが発生しました。refresh tokenが無効の可能性があります。",
      debug: errorMessage,
      httpStatus: 401,
    };
  }

  // 404: メールが見つからない
  if (errorCode === 404 || errorMessage.includes("404") || errorMessage.includes("見つかりません")) {
    return {
      error_code: "not_found",
      message: "メールが見つかりませんでした。",
      debug: errorMessage,
      httpStatus: 404,
    };
  }

  // 429: レート制限
  if (errorCode === 429 || errorMessage.includes("rate limit") || errorMessage.includes("429")) {
    return {
      error_code: "rate_limit_exceeded",
      message: "Gmail APIのレート制限に達しました。しばらく待ってから再試行してください。",
      debug: errorMessage,
      httpStatus: 429,
    };
  }

  // その他のエラー
  return {
    error_code: "unknown",
    message: `Gmail APIエラー: ${errorMessage}`,
    debug: errorMessage,
    httpStatus: 500,
  };
}



