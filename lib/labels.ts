/**
 * Gmail風ラベルナビ用のデータ構造
 * - LabelGroup: 親セクション（Channels, Status, Marketplace等）
 * - LabelItem: 子ラベル（All, StoreA, Todo等）
 */

export type LabelType = "channel" | "status" | "marketplace";
export type StatusType = "todo" | "waiting" | "done";

export type LabelItem = {
  id: string;
  label: string;
  type: LabelType;
  /** Gmail検索クエリ（channelタイプのみ使用） */
  q?: string;
  /** Status用: todo/waiting/done */
  statusType?: StatusType;
  /** アイコン（将来用） */
  icon?: string;
};

export type LabelGroup = {
  id: string;
  label: string;
  /** 折りたたみ可能か（デフォルト: true） */
  collapsible?: boolean;
  /** デフォルトで折りたたまれているか */
  defaultCollapsed?: boolean;
  items: LabelItem[];
};

/**
 * ラベルツリー定義
 * Channels: メール振り分け用（既存のchannels.tsと互換）
 * Status: 対応状況（将来用）
 */
export const LABEL_GROUPS: LabelGroup[] = [
  {
    id: "channels",
    label: "Channels",
    collapsible: true,
    defaultCollapsed: false,
    items: [
      { id: "all", label: "All", type: "channel" },
      {
        id: "store-a",
        label: "StoreA",
        type: "channel",
        q: "(deliveredto:shop-a@vtj.co.jp OR to:shop-a@vtj.co.jp OR cc:shop-a@vtj.co.jp)",
      },
      {
        id: "store-b",
        label: "StoreB",
        type: "channel",
        q: "(deliveredto:shop-b@vtj.co.jp OR to:shop-b@vtj.co.jp OR cc:shop-b@vtj.co.jp)",
      },
      {
        id: "store-c",
        label: "StoreC",
        type: "channel",
        q: "(deliveredto:shop-c@vtj.co.jp OR to:shop-c@vtj.co.jp OR cc:shop-c@vtj.co.jp)",
      },
    ],
  },
  {
    id: "status",
    label: "Status",
    collapsible: true,
    defaultCollapsed: false, // デフォルト展開
    items: [
      { id: "todo", label: "Todo（未対応）", type: "status", statusType: "todo" },
      { id: "waiting", label: "Waiting（保留）", type: "status", statusType: "waiting" },
      { id: "done", label: "Done（完了）", type: "status", statusType: "done" },
    ],
  },
];

/**
 * IDからラベルを検索
 */
export function getLabelById(id: string | undefined): LabelItem | null {
  if (!id) return null;
  for (const group of LABEL_GROUPS) {
    const hit = group.items.find((item) => item.id === id);
    if (hit) return hit;
  }
  return null;
}

/**
 * デフォルトラベル（All）を取得
 */
export function getDefaultLabel(): LabelItem {
  return LABEL_GROUPS[0].items[0];
}

/**
 * ラベルタイプに基づいて検索クエリを取得
 * - channel: q を返す
 * - status: 将来的にはGmailラベル検索（label:xxx）
 */
export function getLabelQuery(label: LabelItem): string | undefined {
  if (label.type === "channel") {
    return label.q;
  }
  // status タイプは将来実装
  return undefined;
}

