import type { InboxListMessage } from "./mailhub-types";

export type MailhubMessagePurpose = "noise" | "important" | "invoice" | "inquiry" | "other";

export type MailhubClassificationEvidence = {
  field: "subject" | "from" | "snippet" | "attachment";
  keyword: string;
};

export type MailhubClassification = {
  purpose: MailhubMessagePurpose;
  evidence: MailhubClassificationEvidence[];
  suppressible: boolean;
  blockedReasons: string[];
};

type ClassifiableMessage = Pick<InboxListMessage, "subject" | "from" | "snippet"> & {
  attachmentNames?: string[];
};

const PURPOSE_KEYWORDS: Array<{
  purpose: Exclude<MailhubMessagePurpose, "other">;
  keywords: string[];
}> = [
  {
    purpose: "important",
    keywords: ["至急", "重要", "urgent", "important", "督促", "未払い", "停止", "エラー", "返品", "交換", "キャンセル"],
  },
  {
    purpose: "invoice",
    keywords: ["請求書", "領収書", "見積書", "納品書", "支払明細", "invoice", "receipt", "statement", "payment", "billing"],
  },
  {
    purpose: "inquiry",
    keywords: ["問い合わせ", "お問い合わせ", "質問", "相談", "inquiry", "question", "r-messe", "rmesse", "メッセージ"],
  },
  {
    purpose: "noise",
    keywords: [
      "no-reply",
      "noreply",
      "newsletter",
      "unsubscribe",
      "配信停止",
      "メルマガ",
      "広告",
      "セール",
      "キャンペーン",
      "notification",
      "seller-notification@amazon.co.jp",
      "注文確定",
      "出荷予定日",
      "order-confirm@mail.rms.rakuten.co.jp",
      "order@rakuten.co.jp",
      "内容ご確認",
      "発送完了報告",
      "store-shopping-order-master@mail.yahoo.co.jp",
      "shopping-editor-master@mail.yahoo.co.jp",
      "朝レポ",
      "エディター反映",
    ],
  },
];

function includesKeyword(value: string | null | undefined, keyword: string): boolean {
  if (!value) return false;
  return value.toLowerCase().includes(keyword.toLowerCase());
}

export function classifyMailhubMessage(message: ClassifiableMessage): MailhubClassification {
  const fields: Array<{ field: MailhubClassificationEvidence["field"]; value: string | null | undefined }> = [
    { field: "subject", value: message.subject },
    { field: "from", value: message.from },
    { field: "snippet", value: message.snippet },
    ...(message.attachmentNames ?? []).map((value) => ({ field: "attachment" as const, value })),
  ];

  for (const group of PURPOSE_KEYWORDS) {
    const evidence: MailhubClassificationEvidence[] = [];
    for (const keyword of group.keywords) {
      const hit = fields.find((entry) => includesKeyword(entry.value, keyword));
      if (hit) evidence.push({ field: hit.field, keyword });
    }
    if (evidence.length === 0) continue;

    const protectedPurpose = group.purpose === "important" || group.purpose === "invoice" || group.purpose === "inquiry";
    return {
      purpose: group.purpose,
      evidence,
      suppressible: !protectedPurpose,
      blockedReasons: protectedPurpose ? [`protected_${group.purpose}`] : [],
    };
  }

  return {
    purpose: "other",
    evidence: [],
    suppressible: false,
    blockedReasons: ["not_noise"],
  };
}

export function isSuppressiveLabelName(labelName: string): boolean {
  const normalized = labelName.trim().toLowerCase();
  return normalized.includes("muted") || normalized.includes("noise") || normalized.includes("処理不要");
}
