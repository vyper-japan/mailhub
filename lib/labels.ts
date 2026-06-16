/**
 * Gmail風ラベルナビ用のデータ構造
 * - LabelGroup: 親セクション（Channels, Status, Marketplace等）
 * - LabelItem: 子ラベル（All, StoreA, Todo等）
 */

import { getChannels } from "@/lib/channels";

export type LabelType = "channel" | "status" | "marketplace" | "assignee";
export type StatusType = "todo" | "waiting" | "done" | "muted" | "snoozed";

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

const STATUS_GROUP: LabelGroup = {
  id: "status",
  label: "ステータス",
  collapsible: true,
  defaultCollapsed: false, // デフォルト展開
  items: [
    { id: "todo", label: "返答・処理する", type: "status", statusType: "todo" },
    { id: "waiting", label: "返事待ち・確認待ち", type: "status", statusType: "waiting" },
    { id: "done", label: "対応済み", type: "status", statusType: "done" },
    { id: "muted", label: "処理不要", type: "status", statusType: "muted" },
    { id: "snoozed", label: "日付を決めて戻す", type: "status", statusType: "snoozed" },
  ],
};

const ASSIGNEE_GROUP: LabelGroup = {
  id: "assignee",
  label: "担当者",
  collapsible: true,
  defaultCollapsed: false,
  items: [
    { id: "mine", label: "自分", type: "assignee" },
    { id: "unassigned", label: "未割当", type: "assignee" },
  ],
};

function cloneGroup(group: LabelGroup): LabelGroup {
  return {
    ...group,
    items: group.items.map((item) => ({ ...item })),
  };
}

export function buildLabelGroups(testMode: boolean): LabelGroup[] {
  return [
    {
      id: "channels",
      label: "チャンネル",
      collapsible: true,
      defaultCollapsed: false,
      items: getChannels(testMode).map((channel) => {
        const item: LabelItem = {
          id: channel.id,
          label: channel.id === "all" ? "すべて" : channel.label,
          type: "channel",
        };
        if (channel.q) item.q = channel.q;
        return item;
      }),
    },
    cloneGroup(STATUS_GROUP),
    cloneGroup(ASSIGNEE_GROUP),
  ];
}

/**
 * ラベルツリー定義
 * Channels: メール振り分け用（既存のchannels.tsと互換）
 * Status: 対応状況（将来用）
 */
export const LABEL_GROUPS: LabelGroup[] = buildLabelGroups(true);

/**
 * IDからラベルを検索
 */
export function getLabelById(id: string | undefined, testMode = true): LabelItem | null {
  if (!id) return null;
  for (const group of buildLabelGroups(testMode)) {
    const hit = group.items.find((item) => item.id === id);
    if (hit) return hit;
  }
  return null;
}

/**
 * デフォルトラベル（All）を取得
 */
export function getDefaultLabel(testMode = true): LabelItem {
  return buildLabelGroups(testMode)[0].items[0];
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
