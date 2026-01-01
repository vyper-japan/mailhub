import type { MessageDetail } from "./mailhub-types";
import type { ChannelId } from "./channels";

export type ReplyKind = "email" | "rakuten_rms" | "unknown";

export type ReplyRoute = {
  kind: ReplyKind;
  storeId?: string; // "store-a" | "store-b" | "store-c"
};

/**
 * メールの返信先を判定する
 * @param message メール詳細
 * @param channelId 現在のチャンネル（StoreA/B/Cなど）
 * @returns 返信先の種類とストアID
 */
export function routeReply(
  message: MessageDetail,
  channelId: ChannelId,
): ReplyRoute {
  // チャンネルがストア系でない場合は通常のメール返信
  if (channelId === "all") {
    return { kind: "email" };
  }

  // ストア系チャンネルの場合、楽天RMS判定を行う
  const storeId = channelId; // "store-a" | "store-b" | "store-c"

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
    return { kind: "rakuten_rms", storeId };
  }

  // 判定できない場合は通常のメール返信
  return { kind: "email" };
}

