import type { MessageDetail } from "./mailhub-types";
import { coerceChannelId, getChannelById, type ChannelDef, type ChannelId } from "./channels";
import { extractInquiryNumber } from "./rakuten/extract";

export type ReplyKind = "gmail" | "rakuten_rms" | "unknown";

export type ReplyRoute = {
  kind: ReplyKind;
  storeId?: string;
  inquiryId?: string; // 問い合わせ番号（自動抽出）
  openUrl?: string; // RMSのdeep link URL（設定されている場合）
};

function getReplyChannel(channelId: ChannelId, testMode: boolean): ChannelDef | undefined {
  const activeChannelId = coerceChannelId(channelId, testMode);
  return activeChannelId ? getChannelById(activeChannelId, testMode) : undefined;
}

/**
 * メールの返信先を判定する（Step55拡張版）
 * @param message メール詳細
 * @param channelId 現在のチャンネル（StoreA/B/Cなど）
 * @returns 返信先の種類、ストアID、問い合わせ番号、RMS URL
 */
export function routeReply(
  message: MessageDetail,
  channelId: ChannelId,
  testMode: boolean,
): ReplyRoute {
  const channel = getReplyChannel(channelId, testMode);
  if (channel?.replyKind !== "rakuten_rms") {
    return { kind: "gmail" };
  }

  const storeId = channel.id;

  // 楽天RMS判定キーワード
  const rakutenKeywords = [
    "楽天",
    "RMS",
    "R-Messe",
    "rakuten",
    "rms",
    "r-messe",
    "楽天市場",
    "楽天ショップ",
  ];

  // 判定対象テキストを収集
  const searchTexts: string[] = [];
  if (message.subject) searchTexts.push(message.subject);
  if (message.from) searchTexts.push(message.from);
  if (message.snippet) searchTexts.push(message.snippet);
  if (message.plainTextBody) searchTexts.push(message.plainTextBody);

  const combinedText = searchTexts.join(" ").toLowerCase();

  // 楽天キーワードが含まれているかチェック
  const hasRakutenKeyword = rakutenKeywords.some((keyword) =>
    combinedText.includes(keyword.toLowerCase()),
  );

  if (hasRakutenKeyword) {
    // 問い合わせ番号を自動抽出
    const inquiryId = message.plainTextBody ? extractInquiryNumber(message.plainTextBody) : null;
    
    // RMS URLを組み立て（環境変数が設定されている場合）
    let openUrl: string | undefined;
    const baseUrl = process.env.MAILHUB_RAKUTEN_RMS_BASE_URL;
    if (inquiryId && baseUrl) {
      // baseUrlの末尾にスラッシュがある場合は除去
      const normalizedBase = baseUrl.replace(/\/$/, "");
      openUrl = `${normalizedBase}/inquiry/${inquiryId}`;
    }
    
    return {
      kind: "rakuten_rms",
      storeId,
      inquiryId: inquiryId ?? undefined,
      openUrl,
    };
  }

  // 判定できない場合は通常のメール返信
  return { kind: "gmail" };
}



