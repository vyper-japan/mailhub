"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LogOut } from "lucide-react";

type HandoffPreview = {
  generatedAt: string;
  envLabel: "LOCAL" | "STAGING" | "PROD";
  readOnly: boolean;
  opsSummary: {
    todo: { critical: { count: number; items: Array<{ id: string; subject: string | null; elapsed: string }> }; warn: { count: number; items: Array<{ id: string; subject: string | null; elapsed: string }> } };
    waiting: { critical: { count: number; items: Array<{ id: string; subject: string | null; elapsed: string }> }; warn: { count: number; items: Array<{ id: string; subject: string | null; elapsed: string }> } };
    unassigned: { critical: { count: number; items: Array<{ id: string; subject: string | null; elapsed: string }> }; warn: { count: number; items: Array<{ id: string; subject: string | null; elapsed: string }> } };
  };
  activity: {
    all: Array<{ timestamp: string; actorEmail: string; action: string; messageId: string; mailhubLink: string | null }>;
    mine: Array<{ timestamp: string; actorEmail: string; action: string; messageId: string; mailhubLink: string | null }>;
  };
  markdown: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
  showToast: (message: string, type: "success" | "error") => void;
};

export function HandoffDrawer({ open, onClose, isAdmin, showToast }: Props) {
  const [preview, setPreview] = useState<HandoffPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [activityTab, setActivityTab] = useState<"all" | "mine">("all");
  const [slackConfirm, setSlackConfirm] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/mailhub/handoff?dryRun=1", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { preview?: HandoffPreview; error?: string; message?: string };
      if (!res.ok) {
        showToast(`エラー: ${data.message || data.error || `handoff preview failed (${res.status})`}`, "error");
        return;
      }
      setPreview(data.preview ?? null);
    } catch (e) {
      showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (!open) return;
    setSlackConfirm(false);
    setActivityTab("all");
    void load();
  }, [open, load]);

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

  const activityRows = useMemo(() => {
    if (!preview) return [];
    return activityTab === "mine" ? preview.activity.mine : preview.activity.all;
  }, [preview, activityTab]);

  const handleCopy = useCallback(async () => {
    const text = preview?.markdown ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast("コピーしました", "success");
    } catch {
      // フォールバック: textareaを選択状態にして手動コピー誘導
      try {
        textareaRef.current?.focus();
        textareaRef.current?.select();
        // 可能なら execCommand でコピー（Playwright/ブラウザ制約で clipboard が失敗するケースを救う）
        const ok = document.execCommand?.("copy") === true;
        if (ok) {
          showToast("コピーしました", "success");
          return;
        }
      } catch {
        // ignore
      }
      showToast("コピーできませんでした（手動で選択してコピーしてください）", "error");
    }
  }, [preview, showToast]);

  const handleSlackSend = useCallback(async () => {
    setSlackConfirm(false);
    try {
      const res = await fetch("/api/mailhub/handoff", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok) {
        showToast(`エラー: ${data.message || data.error || `handoff send failed (${res.status})`}`, "error");
        return;
      }
      showToast("Slackへ送信しました", "success");
    } catch (e) {
      showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }, [showToast]);

  if (!open || typeof document === "undefined") return null;

  const readOnly = preview?.readOnly ?? false;
  const canSendSlack = isAdmin && !readOnly;

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-end justify-end bg-[#0f172a]/90 backdrop-blur-sm" onClick={onClose} data-testid="handoff-overlay">
      <div className="w-full max-w-2xl h-[80vh] bg-[#1e293b] rounded-t-2xl shadow-2xl border-t border-slate-700/50 flex flex-col" onClick={(e) => e.stopPropagation()} data-testid="handoff-drawer">
        <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
          <div>
            <h3 className="text-xl font-black text-white tracking-tight">Handoff</h3>
            <div className="mt-1 text-xs text-slate-400">
              {preview ? `generatedAt: ${preview.generatedAt} / env: ${preview.envLabel} / readOnly: ${preview.readOnly ? "true" : "false"}` : "loading..."}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-800 rounded-lg text-slate-500 hover:text-white transition-colors"
            data-testid="handoff-close"
            aria-label="閉じる"
          >
            <LogOut className="w-5 h-5 rotate-180" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {loading && <div className="text-slate-400 text-sm">読み込み中...</div>}

          {preview && (
            <>
              <section>
                <div className="text-sm font-bold text-white mb-2">Ops Summary</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div className="bg-slate-800/50 rounded border border-slate-700/30 p-3">
                    <div className="text-slate-300 font-semibold">Todo</div>
                    <div className="mt-1 text-slate-400">🔴{preview.opsSummary.todo.critical.count} / 🟡{preview.opsSummary.todo.warn.count}</div>
                  </div>
                  <div className="bg-slate-800/50 rounded border border-slate-700/30 p-3">
                    <div className="text-slate-300 font-semibold">Waiting</div>
                    <div className="mt-1 text-slate-400">🔴{preview.opsSummary.waiting.critical.count} / 🟡{preview.opsSummary.waiting.warn.count}</div>
                  </div>
                  <div className="bg-slate-800/50 rounded border border-slate-700/30 p-3">
                    <div className="text-slate-300 font-semibold">Unassigned</div>
                    <div className="mt-1 text-slate-400">🔴{preview.opsSummary.unassigned.critical.count} / 🟡{preview.opsSummary.unassigned.warn.count}</div>
                  </div>
                </div>
              </section>

              <section>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-bold text-white">Activity（直近24h / 上位10）</div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setActivityTab("all")}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${activityTab === "all" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}
                      data-testid="handoff-activity-all"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setActivityTab("mine")}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${activityTab === "mine" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}
                      data-testid="handoff-activity-mine"
                    >
                      Mine
                    </button>
                  </div>
                </div>

                {activityRows.length === 0 ? (
                  <div className="text-slate-500 text-sm">（なし）</div>
                ) : (
                  <div className="space-y-2">
                    {activityRows.map((a, idx) => (
                      <div key={`${a.timestamp}-${idx}`} className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/30">
                        <div className="text-xs text-slate-400">{a.timestamp}</div>
                        <div className="text-sm text-slate-200 truncate">
                          {a.actorEmail.split("@")[0]} / {a.action} / {a.messageId}
                        </div>
                        {a.mailhubLink && (
                          <a className="text-xs text-blue-400 hover:underline" href={a.mailhubLink}>
                            Open in MailHub
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <div className="text-sm font-bold text-white mb-2">Markdown（Preview）</div>
                <textarea
                  ref={textareaRef}
                  className="w-full h-56 bg-slate-900 text-slate-100 text-xs rounded border border-slate-700/50 p-3 font-mono"
                  readOnly
                  value={preview.markdown}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-testid="handoff-copy"
                    onClick={() => void handleCopy()}
                    className="px-3 py-2 text-xs font-bold rounded-md bg-blue-600 text-white hover:bg-blue-500"
                    disabled={!preview.markdown}
                  >
                    Copy
                  </button>

                  <button
                    type="button"
                    onClick={() => void load()}
                    className="px-3 py-2 text-xs font-bold rounded-md bg-slate-800 text-slate-200 hover:bg-slate-700"
                  >
                    再生成
                  </button>

                  {/* Slack send: preview -> send */}
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSlackConfirm(true)}
                      className="px-3 py-2 text-xs font-bold rounded-md bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40"
                      disabled={!canSendSlack}
                      title={!isAdmin ? "管理者のみ送信できます" : readOnly ? "READ ONLYのため送信できません" : undefined}
                    >
                      Slackへ送る（確認）
                    </button>
                    {slackConfirm && (
                      <button
                        type="button"
                        data-testid="handoff-send"
                        onClick={() => void handleSlackSend()}
                        className="px-3 py-2 text-xs font-bold rounded-md bg-red-600 text-white hover:bg-red-500"
                      >
                        送信する
                      </button>
                    )}
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

