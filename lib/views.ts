/**
 * Saved Views（保存ビュー）の型定義
 * 
 * Viewは、ラベル/検索/担当/状態の組み合わせを1オブジェクトにまとめたもの。
 * ConfigStore（memory/file/sheets）に保存され、labels/rulesと同格で管理される。
 */

export type ViewId = string; // slug形式（例: "inbox", "unassigned", "mine"）

export type View = {
  id: ViewId;
  name: string; // 表示名
  icon?: string; // 任意：emoji可（例: "📧", "👤", "⏰"）
  labelId: string; // ベースになる label（例: "all", "todo", "waiting", "muted"）
  q?: string; // Gmail検索文字列（空可）
  assignee?: "mine" | "unassigned" | null; // 追加条件（null = 指定なし）
  statusType?: "todo" | "waiting" | "muted" | null; // 必要なら（labelIdがstatusなら不要）
  pinned: boolean; // 固定（pinnedDefault）
  order: number; // 並び順（小さい順）
  createdAt: string; // ISO
  updatedAt?: string; // ISO（更新時のみ）
};

/**
 * 初期Views（おすすめ）
 */
export const DEFAULT_VIEWS: View[] = [
  {
    id: "inbox",
    name: "受信箱",
    icon: "📧",
    labelId: "todo",
    pinned: true,
    order: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: "unassigned",
    name: "未割当",
    icon: "👤",
    labelId: "unassigned",
    pinned: true,
    order: 1,
    createdAt: new Date().toISOString(),
  },
  {
    id: "mine",
    name: "自分担当",
    icon: "✅",
    labelId: "mine",
    pinned: true,
    order: 2,
    createdAt: new Date().toISOString(),
  },
  {
    id: "waiting",
    name: "保留",
    icon: "⏰",
    labelId: "waiting",
    pinned: true,
    order: 3,
    createdAt: new Date().toISOString(),
  },
  {
    id: "muted",
    name: "低優先",
    icon: "🔇",
    labelId: "muted",
    pinned: true,
    order: 4,
    createdAt: new Date().toISOString(),
  },
  {
    id: "overdue",
    name: "期限超過",
    icon: "⚠️",
    labelId: "todo",
    q: "older_than:7d",
    pinned: false,
    order: 5,
    createdAt: new Date().toISOString(),
  },
];

/**
 * ViewからGmail検索クエリとフィルタ条件を構築
 */
export function buildViewQuery(view: View): {
  q?: string;
  assignee?: "mine" | "unassigned" | null;
  statusType?: "todo" | "waiting" | "muted" | null;
} {
  return {
    q: view.q,
    assignee: view.assignee ?? null,
    statusType: view.statusType ?? null,
  };
}
