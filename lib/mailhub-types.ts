export type InboxListMessage = {
  id: string;
  threadId: string;
  subject: string | null;
  from: string | null;
  messageId: string | null;
  receivedAt: string;
  snippet: string;
  gmailLink: string;
  pinned?: boolean; // テストモード用: 先頭に表示する
  isUnread?: boolean; // GmailのUNREAD相当（未指定の場合は不明）
  isStarred?: boolean; // GmailのSTARRED相当（未指定の場合は不明）
  assigneeSlug: string | null; // 担当者のslug（例: "tanaka_at_vtj_co_jp"）
  /**
   * 登録済みラベル（ユーザーラベル）だけを返す。
   * NOTE: MailHub内部ラベル（MailHub/*）やシステムラベルは含めない。
   */
  userLabels?: string[];
  /**
   * Snooze期限（YYYY-MM-DD形式、Snoozed状態の場合のみ）
   */
  snoozeUntil?: string | null;
};

export type MessageDetail = {
  id: string;
  threadId: string;
  subject: string | null;
  from: string | null;
  messageId: string | null;
  receivedAt: string;
  snippet: string;
  gmailLink: string;
  plainTextBody: string | null;
  htmlBody: string | null; // サニタイズ済みHTML（利用可能な場合）
  bodySource: "plain" | "html" | null; // 本文の元ソース
  bodyNotice: string | null;
  isInProgress?: boolean;
  assigneeSlug: string | null; // 担当者のslug（例: "tanaka_at_vtj_co_jp"）
  /**
   * 登録済みラベル（ユーザーラベル）
   */
  userLabels?: string[];
  /**
   * Snooze期限（YYYY-MM-DD形式、Snoozed状態の場合のみ）
   */
  snoozeUntil?: string | null;
  /**
   * 開発/検証用: 実ラベルの可視化（本番では返さない/表示しない）
   * - labelIds: Gmail APIのlabelIds
   * - labelNames: labelIdsをlabelsMapで復元した結果（不明なIDはnullになる）
   */
  debugLabels?: { labelIds: string[]; labelNames: Array<string | null> };
};

/**
 * サイドバー件数（Status）
 * - assignedMine: 自分担当の総数（受信箱/保留/完了を跨いでカウント）
 * - assigneeLoadBySlug: Step 65 担当別の負荷件数（Todo+Waiting）
 * - unassignedLoad: 未割当の負荷件数
 */
export type StatusCounts = {
  todo: number;
  waiting: number;
  done: number;
  muted: number;
  snoozed?: number;
  assignedMine?: number;
  assigneeLoadBySlug?: Record<string, number>;
  unassignedLoad?: number;
};

/**
 * Channels（All/StoreA/B/C）の件数キャッシュ（UI側）
 */
export type ChannelCounts = Record<string, number>;


