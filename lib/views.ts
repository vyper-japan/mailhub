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
    name: "今返す",
    icon: "📧",
    labelId: "todo",
    pinned: true,
    order: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: "unassigned",
    name: "誰かが取る",
    icon: "👤",
    labelId: "unassigned",
    pinned: true,
    order: 1,
    createdAt: new Date().toISOString(),
  },
  {
    id: "mine",
    name: "自分が対応",
    icon: "✅",
    labelId: "mine",
    pinned: true,
    order: 2,
    createdAt: new Date().toISOString(),
  },
  {
    id: "waiting",
    name: "返事待ち",
    icon: "⏰",
    labelId: "waiting",
    pinned: true,
    order: 3,
    createdAt: new Date().toISOString(),
  },
  {
    id: "invoice-docs",
    name: "請求/書類",
    icon: "📎",
    labelId: "todo",
    q: "has:attachment (invoice OR receipt OR statement OR 請求書 OR 領収書 OR 見積書 OR 納品書 OR 支払明細)",
    pinned: true,
    order: 4,
    createdAt: new Date().toISOString(),
  },
  {
    id: "customer-inquiries",
    name: "問い合わせ",
    icon: "💬",
    labelId: "todo",
    q: "(問い合わせ OR お問い合わせ OR \"返信がありました\" OR \"お客様から\" OR inquiry OR question OR 質問 OR 相談 OR from:ichiba-inquiry@rakuten.co.jp OR from:shopping-proorder-master@mail.yahoo.co.jp)",
    pinned: true,
    order: 5,
    createdAt: new Date().toISOString(),
  },
  {
    id: "noise-candidates",
    name: "処理不要候補",
    icon: "🧹",
    labelId: "todo",
    q: "(from:no-reply OR from:noreply OR unsubscribe OR newsletter OR メルマガ OR 配信停止 OR 広告 OR セール) -問い合わせ -お問い合わせ -至急 -重要",
    pinned: true,
    order: 6,
    createdAt: new Date().toISOString(),
  },
  {
    id: "muted",
    name: "処理不要",
    icon: "🔇",
    labelId: "muted",
    pinned: true,
    order: 7,
    createdAt: new Date().toISOString(),
  },
  {
    id: "overdue",
    name: "長く残っている",
    icon: "⚠️",
    labelId: "todo",
    q: "older_than:7d",
    pinned: false,
    order: 8,
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
