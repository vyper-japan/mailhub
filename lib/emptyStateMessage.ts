import type { View } from "@/lib/views";

export type SlaEmptyMessage = {
  title: string;
  subtitle?: string;
};

const DEFAULT_SLA_EMPTY_MESSAGE: SlaEmptyMessage = {
  title: "長く残っているメールはありません",
  subtitle: "全てのメールが期限内です",
};

export function getSlaEmptyMessage(activeViewId: string | null, views: readonly View[]): SlaEmptyMessage {
  switch (activeViewId) {
    case null:
    case "overdue":
      return DEFAULT_SLA_EMPTY_MESSAGE;
    case "customer-inquiries":
      return {
        title: "未返信の問い合わせはありません",
        subtitle: "全ての問い合わせに返信済みです",
      };
    case "invoice-docs":
      return {
        title: "未対応の請求書はありません",
        subtitle: "全ての請求書に対応済みです",
      };
    case "noise-candidates":
      return { title: "処理不要候補はありません" };
    case "unassigned":
      return { title: "担当が決まっていないメールはありません" };
    case "mine":
      return { title: "自分担当のメールはありません" };
    case "waiting":
      return { title: "返事待ちのメールはありません" };
    case "muted":
      return { title: "処理不要のメールはありません" };
    case "inbox":
      return { title: "今返すメールはありません" };
    default: {
      const customView = views.find((view) => view.id === activeViewId);
      if (!customView) return DEFAULT_SLA_EMPTY_MESSAGE;
      return { title: `未処理の${customView.name}はありません` };
    }
  }
}
