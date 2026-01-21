"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Settings } from "lucide-react";

type RuleExplainResult = {
  messageId: string;
  fromEmail: string | null;
  labelRules: Array<{
    ruleId: string;
    enabled: boolean;
    priority?: number;
    matchReason: "fromEmail" | "fromDomain" | "no_match";
    matchCondition: { fromEmail?: string; fromDomain?: string };
    result: string[]; // labelNames
  }>;
  assigneeRules: Array<{
    ruleId: string;
    enabled: boolean;
    priority: number;
    matchReason: "fromEmail" | "fromDomain" | "no_match";
    matchCondition: { fromEmail?: string; fromDomain?: string };
    result: string | null; // assigneeEmail or null
  }>;
};

type Props = {
  open: boolean;
  onClose: () => void;
  messageId: string | null;
  isAdmin: boolean;
  showToast: (message: string, type: "success" | "error") => void;
};

export function ExplainDrawer({ open, onClose, messageId, isAdmin, showToast }: Props) {
  const [explain, setExplain] = useState<RuleExplainResult | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!messageId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/mailhub/rules/explain?id=${encodeURIComponent(messageId)}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { explain?: RuleExplainResult; error?: string; message?: string };
      if (!res.ok) {
        showToast(`エラー: ${data.message || data.error || `explain failed (${res.status})`}`, "error");
        return;
      }
      setExplain(data.explain ?? null);
    } catch (e) {
      showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setLoading(false);
    }
  }, [messageId, showToast]);

  useEffect(() => {
    if (!open || !messageId) return;
    void load();
  }, [open, messageId, load]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const matchingLabelRules = explain?.labelRules.filter((r) => r.matchReason !== "no_match") ?? [];
  const matchingAssigneeRules = explain?.assigneeRules.filter((r) => r.matchReason !== "no_match") ?? [];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-end pointer-events-none">
      {/* オーバーレイ */}
      <div className="absolute inset-0 bg-black/20 pointer-events-auto" onClick={onClose} data-testid="explain-drawer-overlay" />

      {/* Drawer */}
      <div
        className="relative w-full max-w-2xl h-full bg-white shadow-xl pointer-events-auto flex flex-col"
        data-testid="explain-drawer"
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">ルール説明</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
            data-testid="explain-drawer-close"
          >
            <X size={20} />
          </button>
        </div>

        {/* コンテンツ */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-sm text-gray-500">読み込み中...</div>
            </div>
          ) : !explain ? (
            <div className="text-sm text-gray-500">説明データを取得できませんでした</div>
          ) : (
            <div className="space-y-6">
              {/* メッセージ情報 */}
              <div className="border-b border-gray-200 pb-4">
                <div className="text-sm text-gray-600 mb-1">メッセージID</div>
                <div className="text-sm font-mono text-gray-900 break-all">{explain.messageId}</div>
                {explain.fromEmail && (
                  <>
                    <div className="text-sm text-gray-600 mt-3 mb-1">送信元メールアドレス</div>
                    <div className="text-sm font-mono text-gray-900">{explain.fromEmail}</div>
                  </>
                )}
              </div>

              {/* マッチしたラベルルール */}
              {matchingLabelRules.length > 0 && (
                <div>
                  <h3 className="text-base font-semibold text-gray-900 mb-3">マッチしたラベルルール</h3>
                  <div className="space-y-3">
                    {matchingLabelRules.map((rule) => (
                      <div key={rule.ruleId} className="border border-gray-200 rounded-lg p-4" data-testid={`explain-label-rule-${rule.ruleId}`}>
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">ルールID: {rule.ruleId}</span>
                            {!rule.enabled && <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">無効</span>}
                          </div>
                          {isAdmin && (
                            <a
                              href={`/settings?tab=rules&ruleId=${encodeURIComponent(rule.ruleId)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                              data-testid={`explain-label-rule-link-${rule.ruleId}`}
                            >
                              <Settings size={14} />
                              設定を開く
                            </a>
                          )}
                        </div>
                        <div className="text-xs text-gray-600 mb-2">
                          マッチ理由: <span className="font-medium">{rule.matchReason === "fromEmail" ? "fromEmail一致" : "fromDomain一致"}</span>
                        </div>
                        <div className="text-xs text-gray-600 mb-2">
                          条件:{" "}
                          {rule.matchCondition.fromEmail ? (
                            <span className="font-mono">fromEmail = {rule.matchCondition.fromEmail}</span>
                          ) : rule.matchCondition.fromDomain ? (
                            <span className="font-mono">fromDomain = {rule.matchCondition.fromDomain}</span>
                          ) : (
                            <span className="text-gray-400">条件なし</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-600">
                          適用ラベル: <span className="font-medium text-gray-900">{rule.result.length > 0 ? rule.result.join(", ") : "(なし)"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* マッチしたAssigneeルール */}
              {matchingAssigneeRules.length > 0 && (
                <div>
                  <h3 className="text-base font-semibold text-gray-900 mb-3">マッチしたAssigneeルール</h3>
                  <div className="space-y-3">
                    {matchingAssigneeRules.map((rule) => (
                      <div key={rule.ruleId} className="border border-gray-200 rounded-lg p-4" data-testid={`explain-assignee-rule-${rule.ruleId}`}>
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">ルールID: {rule.ruleId}</span>
                            {!rule.enabled && <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">無効</span>}
                            <span className="text-xs text-gray-500">優先度: {rule.priority}</span>
                          </div>
                          {isAdmin && (
                            <a
                              href={`/settings?tab=assignee-rules&ruleId=${encodeURIComponent(rule.ruleId)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                              data-testid={`explain-assignee-rule-link-${rule.ruleId}`}
                            >
                              <Settings size={14} />
                              設定を開く
                            </a>
                          )}
                        </div>
                        <div className="text-xs text-gray-600 mb-2">
                          マッチ理由: <span className="font-medium">{rule.matchReason === "fromEmail" ? "fromEmail一致" : "fromDomain一致"}</span>
                        </div>
                        <div className="text-xs text-gray-600 mb-2">
                          条件:{" "}
                          {rule.matchCondition.fromEmail ? (
                            <span className="font-mono">fromEmail = {rule.matchCondition.fromEmail}</span>
                          ) : rule.matchCondition.fromDomain ? (
                            <span className="font-mono">fromDomain = {rule.matchCondition.fromDomain}</span>
                          ) : (
                            <span className="text-gray-400">条件なし</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-600">
                          担当: <span className="font-medium text-gray-900">{rule.result ?? "(なし)"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* マッチなし */}
              {matchingLabelRules.length === 0 && matchingAssigneeRules.length === 0 && (
                <div className="text-sm text-gray-500 text-center py-8">
                  このメッセージにマッチするルールはありません。
                </div>
              )}

              {/* 無効/マッチしなかったルール（参考情報） */}
              {(explain.labelRules.some((r) => r.matchReason === "no_match" || !r.enabled) ||
                explain.assigneeRules.some((r) => r.matchReason === "no_match" || !r.enabled)) && (
                <div className="border-t border-gray-200 pt-4">
                  <details className="text-sm">
                    <summary className="cursor-pointer text-gray-600 hover:text-gray-900">参考: マッチしなかったルール</summary>
                    <div className="mt-3 space-y-2 text-xs text-gray-500">
                      {explain.labelRules
                        .filter((r) => r.matchReason === "no_match" || !r.enabled)
                        .map((r) => (
                          <div key={r.ruleId}>
                            {r.ruleId} ({!r.enabled ? "無効" : "マッチなし"})
                          </div>
                        ))}
                      {explain.assigneeRules
                        .filter((r) => r.matchReason === "no_match" || !r.enabled)
                        .map((r) => (
                          <div key={r.ruleId}>
                            {r.ruleId} ({!r.enabled ? "無効" : "マッチなし"})
                          </div>
                        ))}
                    </div>
                  </details>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
