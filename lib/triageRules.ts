import type { InboxListMessage } from "@/lib/mailhub-types";
import type { ChannelId } from "@/lib/channels";

export type TriageAction = "suggest_muted" | "none";

export interface TriageContext {
  channelId: ChannelId | null;
  statusType: "todo" | "waiting" | "done" | "muted" | "snoozed" | null;
}

export interface TriageRule {
  id: string;
  label: string; // UI表示用
  match: (message: InboxListMessage, context: TriageContext) => boolean;
}

// 重要キーワード（これらが含まれる場合は候補から除外）
const IMPORTANT_KEYWORDS = [
  "重要",
  "至急",
  "緊急",
  "問い合わせ",
  "お問い合わせ",
  "inquiry",
  "urgent",
  "important",
  "critical",
];

// 重要キーワードチェック
function hasImportantKeywords(text: string | null): boolean {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  return IMPORTANT_KEYWORDS.some((keyword) => lowerText.includes(keyword.toLowerCase()));
}

// ルール定義
export const TRIAGE_RULES: TriageRule[] = [
  {
    id: "rakuten_notice",
    label: "低優先候補",
    match: (message) => {
      // 重要キーワードが含まれる場合は除外
      if (hasImportantKeywords(message.subject) || hasImportantKeywords(message.snippet)) {
        return false;
      }

      const subject = (message.subject || "").toLowerCase();
      const snippet = (message.snippet || "").toLowerCase();
      const from = (message.from || "").toLowerCase();

      // 楽天の通知系メール
      const isRakutenNotice =
        from.includes("rakuten") &&
        (subject.includes("お知らせ") ||
          subject.includes("メンテナンス") ||
          subject.includes("メンテ") ||
          subject.includes("規約") ||
          subject.includes("キャンペーン") ||
          subject.includes("キャッシュバック") ||
          subject.includes("ポイント") ||
          subject.includes("セール") ||
          snippet.includes("お知らせ") ||
          snippet.includes("メンテナンス"));

      return isRakutenNotice;
    },
  },
  {
    id: "generic_notice",
    label: "低優先候補",
    match: (message) => {
      // 重要キーワードが含まれる場合は除外
      if (hasImportantKeywords(message.subject) || hasImportantKeywords(message.snippet)) {
        return false;
      }

      const subject = (message.subject || "").toLowerCase();
      const snippet = (message.snippet || "").toLowerCase();

      // 一般的な通知系メール（広告・お知らせ系）
      const isGenericNotice =
        (subject.includes("お知らせ") ||
          subject.includes("ご案内") ||
          subject.includes("メンテナンス") ||
          subject.includes("メンテ") ||
          subject.includes("キャンペーン") ||
          subject.includes("セール") ||
          subject.includes("ポイント") ||
          snippet.includes("お知らせ") ||
          snippet.includes("ご案内")) &&
        !subject.includes("注文") && // 注文関連は除外
        !subject.includes("配送") && // 配送関連は除外
        !subject.includes("決済"); // 決済関連は除外

      return isGenericNotice;
    },
  },
];

// メッセージに対して適用されるアクションを判定
export function evaluateTriage(
  message: InboxListMessage,
  context: TriageContext,
): TriageAction {
  // 既にMutedの場合は候補にしない
  if (context.statusType === "muted") {
    return "none";
  }

  // ルールを順に評価
  for (const rule of TRIAGE_RULES) {
    if (rule.match(message, context)) {
      return "suggest_muted";
    }
  }

  return "none";
}

// メッセージリストから候補を抽出
export function getTriageCandidates(
  messages: InboxListMessage[],
  contextFn: (msg: InboxListMessage) => TriageContext,
): InboxListMessage[] {
  return messages.filter((msg) => {
    const context = contextFn(msg);
    return evaluateTriage(msg, context) === "suggest_muted";
  });
}



