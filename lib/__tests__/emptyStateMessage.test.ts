import { describe, expect, it } from "vitest";
import { getSlaEmptyMessage } from "@/lib/emptyStateMessage";
import type { View } from "@/lib/views";

const views: View[] = [
  {
    id: "custom-escalations",
    name: "重要確認",
    labelId: "todo",
    pinned: false,
    order: 10,
    createdAt: "2026-07-09T00:00:00.000Z",
  },
  {
    id: "customer-inquiries",
    name: "問い合わせ",
    labelId: "todo",
    pinned: true,
    order: 5,
    createdAt: "2026-07-09T00:00:00.000Z",
  },
  {
    id: "invoice-docs",
    name: "請求/書類",
    labelId: "todo",
    pinned: true,
    order: 4,
    createdAt: "2026-07-09T00:00:00.000Z",
  },
  {
    id: "inbox",
    name: "今返す",
    labelId: "todo",
    pinned: true,
    order: 0,
    createdAt: "2026-07-09T00:00:00.000Z",
  },
];

describe("getSlaEmptyMessage", () => {
  it.each([
    [null, "長く残っているメールはありません", "全てのメールが期限内です"],
    ["overdue", "長く残っているメールはありません", "全てのメールが期限内です"],
    ["customer-inquiries", "未返信の問い合わせはありません", "全ての問い合わせに返信済みです"],
    ["invoice-docs", "未対応の請求書はありません", "全ての請求書に対応済みです"],
    ["noise-candidates", "処理不要候補はありません", undefined],
    ["unassigned", "担当が決まっていないメールはありません", undefined],
    ["mine", "自分担当のメールはありません", undefined],
    ["waiting", "返事待ちのメールはありません", undefined],
    ["muted", "処理不要のメールはありません", undefined],
    ["inbox", "今返すメールはありません", undefined],
    ["custom-escalations", "未処理の重要確認はありません", undefined],
    ["missing-view", "長く残っているメールはありません", "全てのメールが期限内です"],
  ] satisfies Array<[string | null, string, string | undefined]>)(
    "returns SLA empty copy for %s",
    (activeViewId, title, subtitle) => {
      expect(getSlaEmptyMessage(activeViewId, views)).toEqual({ title, ...(subtitle ? { subtitle } : {}) });
    },
  );
});
