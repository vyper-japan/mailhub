"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, FileText, StickyNote, X } from "lucide-react";
import { renderTemplate, buildVariablesFromContext, type TemplateRenderResult } from "@/lib/replyTemplates";

type ToastFn = (message: string, type: "success" | "error" | "info") => void;

type Note = {
  body: string;
  updatedAt: string;
  updatedBy: string;
};

type ReplyTemplate = {
  id: string;
  title: string;
  route?: "rakuten_rms" | "gmail" | "any";
  body: string;
  updatedAt: string;
  updatedBy: string;
};

type Props = {
  messageId: string;
  readOnlyMode: boolean;
  showToast: ToastFn;
  // Step46: 変数埋め用のコンテキスト
  messageContext?: {
    inquiryId?: string | null;
    orderId?: string | null;
    customerEmail?: string | null;
    fromName?: string | null;
    fromEmail?: string | null;
    subject?: string | null;
    store?: string | null;
    assignee?: string | null;
    agent?: string | null;
    today?: string;
  };
  // Step57: Activity証跡（route/channel）
  activityContext?: {
    route: "rakuten_rms" | "gmail" | "unknown" | null;
    channel: string | null;
  };
  // Step55/57: Replyブロック用のコールバック（テンプレ適用）
  onTemplateInsertToReply?: (payload: { text: string; templateId: string; templateTitle: string; unresolvedVars: string[] }) => void;
};

async function safeJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // fallback
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "true");
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "0";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  if (!ok) throw new Error("copy_failed");
}

function formatIsoToJa(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP");
}

const DRAFT_STORAGE_PREFIX = "mailhub:draft:";

export function InternalOpsPane({
  messageId,
  readOnlyMode,
  showToast,
  messageContext,
  activityContext,
  onTemplateInsertToReply,
}: Props) {
  // ---- shared note (server) ----
  const [noteText, setNoteText] = useState<string>("");
  const [noteMeta, setNoteMeta] = useState<Note | null>(null);
  const [noteLoadState, setNoteLoadState] = useState<"idle" | "loading" | "error">("idle");
  const [noteSaveState, setNoteSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const suppressSaveRef = useRef(false);
  const noteAbortRef = useRef<AbortController | null>(null);
  const repairedMessageIdsRef = useRef<Set<string>>(new Set());

  const noteLastUpdatedText = useMemo(() => {
    const at = formatIsoToJa(noteMeta?.updatedAt ?? null);
    const by = noteMeta?.updatedBy ?? null;
    if (!at || !by) return null;
    return `${at} / ${by}`;
  }, [noteMeta]);

  const loadNote = useCallback(async () => {
    noteAbortRef.current?.abort();
    const ac = new AbortController();
    noteAbortRef.current = ac;

    setNoteLoadState("loading");
    try {
      const res = await fetch(`/api/mailhub/notes?messageId=${encodeURIComponent(messageId)}`, {
        cache: "no-store",
        signal: ac.signal,
      });
      const data = await safeJson(res);
      if (!res.ok) {
        const msg = typeof data.message === "string" ? data.message : typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const note = (data.note ?? null) as Note | null;
      suppressSaveRef.current = true;
      setNoteMeta(note);
      setNoteText(note?.body ?? "");
      setNoteSaveState("idle");
      setNoteLoadState("idle");
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") return;
      setNoteLoadState("error");
      const errorMsg = e instanceof Error ? e.message : String(e);
      // JSON破損エラーの場合は自動修復されるため、より分かりやすいメッセージを表示
      if (errorMsg.includes("config_json_corrupt_notes")) {
        if (!repairedMessageIdsRef.current.has(messageId)) {
          repairedMessageIdsRef.current.add(messageId);
          showToast("社内メモのデータを修復しました", "info");
          // エラー状態をリセットして再読み込みを試みる
          setTimeout(() => {
            void loadNote();
          }, 1000);
        } else {
          setNoteLoadState("idle");
        }
      } else {
        showToast(`社内メモの読み込みに失敗しました: ${errorMsg}`, "error");
      }
    } finally {
      // 次のレンダーサイクルで解除（state反映時の副作用を避ける）
      setTimeout(() => {
        suppressSaveRef.current = false;
      }, 0);
    }
  }, [messageId, showToast]);

  useEffect(() => {
    void loadNote();
    return () => {
      noteAbortRef.current?.abort();
    };
  }, [loadNote]);

  // Step86: autosave を禁止し、手動 Save ボタンで保存
  const handleSaveNote = useCallback(async () => {
    if (readOnlyMode) {
      showToast("READ ONLYのため保存できません", "error");
      return;
    }
    setNoteSaveState("saving");
    try {
      const res = await fetch("/api/mailhub/notes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, body: noteText }),
      });
      const data = await safeJson(res);
      if (!res.ok) {
        const msg = typeof data.message === "string" ? data.message : typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const note = (data.note ?? null) as Note | null;
      setNoteMeta(note);
      setNoteSaveState("saved");
      showToast("社内メモを保存しました", "success");
    } catch (e) {
      setNoteSaveState("error");
      showToast(`社内メモの保存に失敗しました: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }, [messageId, noteText, readOnlyMode, showToast]);

  // 未保存の変更があるかどうか
  const hasUnsavedNote = useMemo(() => {
    const currentTrimmed = noteText.trim();
    const savedTrimmed = (noteMeta?.body ?? "").trim();
    return currentTrimmed !== savedTrimmed;
  }, [noteText, noteMeta?.body]);

  // ---- personal draft (localStorage) ----
  const [draftText, setDraftText] = useState<string>("");
  const [draftLoaded, setDraftLoaded] = useState(false);

  const draftKey = useMemo(() => `${DRAFT_STORAGE_PREFIX}${messageId}`, [messageId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem(draftKey);
      setDraftText(stored ?? "");
    } catch {
      setDraftText("");
    } finally {
      setDraftLoaded(true);
    }
  }, [draftKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!draftLoaded) return;
    try {
      if (draftText) localStorage.setItem(draftKey, draftText);
      else localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
  }, [draftKey, draftLoaded, draftText]);

  const handleCopyDraft = useCallback(async () => {
    try {
      await copyToClipboard(draftText || "");
      showToast("下書きをコピーしました", "success");
    } catch {
      showToast("コピーに失敗しました（ブラウザの制限の可能性）", "error");
    }
  }, [draftText, showToast]);

  // ---- template picker ----
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templates, setTemplates] = useState<ReplyTemplate[]>([]);
  const [templateQuery, setTemplateQuery] = useState("");
  const [templateLoadState, setTemplateLoadState] = useState<"idle" | "loading" | "error">("idle");
  const [selectedTemplate, setSelectedTemplate] = useState<ReplyTemplate | null>(null); // Step46: プレビュー用

  const visibleTemplates = useMemo(() => {
    const q = templateQuery.trim().toLowerCase();
    const route = activityContext?.route ?? null;
    const routeFiltered =
      !route ? templates : templates.filter((t) => (t.route ?? "any") === "any" || t.route === route);
    if (!q) return routeFiltered;
    return routeFiltered.filter((t) => t.title.toLowerCase().includes(q) || t.id.toLowerCase().includes(q));
  }, [templateQuery, templates, activityContext]);

  const loadTemplates = useCallback(async () => {
    setTemplateLoadState("loading");
    try {
      const res = await fetch("/api/mailhub/templates", { cache: "no-store" });
      const data = await safeJson(res);
      if (!res.ok) {
        const msg = typeof data.message === "string" ? data.message : typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const list = (data.templates ?? []) as ReplyTemplate[];
      setTemplates(Array.isArray(list) ? list : []);
      setTemplateLoadState("idle");
    } catch (e) {
      setTemplateLoadState("error");
      showToast(`テンプレ読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }, [showToast]);

  const handleInsertTemplate = useCallback(async (t: ReplyTemplate) => {
    // Step46: 変数埋めを実行
    const variables = messageContext ? buildVariablesFromContext(messageContext) : {};
    const result = renderTemplate(t.body, variables);
    
    // 未解決プレースホルダがある場合は警告
    if (result.unresolved.length > 0) {
      showToast(`未解決のプレースホルダがあります: ${result.unresolved.join(", ")}`, "error");
    }
    
    // Step55: Replyブロック用のコールバックがある場合はそちらを使用
    if (onTemplateInsertToReply) {
      onTemplateInsertToReply({
        text: result.rendered,
        templateId: t.id,
        templateTitle: t.title,
        unresolvedVars: result.unresolved,
      });
      setTemplateOpen(false);
      // Step57: Activity証跡（best-effort / READ ONLYでもOK）
      try {
        fetch("/api/mailhub/activity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "template_apply",
            messageId,
            metadata: {
              templateId: t.id,
              templateName: t.title,
              unresolvedVars: result.unresolved,
              route: activityContext?.route ?? null,
              channel: activityContext?.channel ?? null,
            },
          }),
        }).catch(() => {});
      } catch {
        // ignore
      }
      return;
    }
    
    const sep = draftText.trim() ? "\n\n" : "";
    setDraftText(`${draftText}${sep}${result.rendered}`);
    setTemplateOpen(false);

    // Activity（template_insert）は best-effort（READ ONLY時は抑止）
    if (!readOnlyMode) {
      fetch("/api/mailhub/templates/insert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, templateId: t.id }),
      }).catch(() => {});
    }
  }, [draftText, messageId, readOnlyMode, messageContext, showToast, onTemplateInsertToReply, activityContext]);

  const openTemplatePicker = useCallback(() => {
    setTemplateOpen(true);
    setTemplateQuery("");
    setSelectedTemplate(null); // Step46: 選択をリセット
    if (templates.length === 0) {
      void loadTemplates();
    }
  }, [loadTemplates, templates.length]);

  // Step46: 変数埋めロジック（プレビュー用）
  const renderResult = useMemo<TemplateRenderResult | null>(() => {
    if (!selectedTemplate) return null;
    const variables = messageContext ? buildVariablesFromContext(messageContext) : {};
    return renderTemplate(selectedTemplate.body, variables);
  }, [selectedTemplate, messageContext]);

  // Step46: Tキーショートカット（input/textareaフォーカス中は無効）
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isTypingField = (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (isTypingField) return; // input/textareaフォーカス中は無効
      
      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        openTemplatePicker();
      }
      if (templateOpen && e.key === "Escape") {
        e.preventDefault();
        setTemplateOpen(false);
        setSelectedTemplate(null);
      }
      if (templateOpen && e.key === "Enter" && selectedTemplate) {
        e.preventDefault();
        void handleInsertTemplate(selectedTemplate);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [templateOpen, selectedTemplate, openTemplatePicker, handleInsertTemplate, onTemplateInsertToReply]);

  const NoteIndicator = () => {
    const text =
      readOnlyMode
        ? "READ ONLY"
        : noteLoadState === "loading"
          ? "読込中..."
          : noteSaveState === "saving"
            ? "保存中..."
            : noteSaveState === "saved"
              ? "保存済み"
              : noteSaveState === "error"
                ? "保存エラー"
                : " ";
    const cls =
      readOnlyMode
        ? "text-red-700"
        : noteSaveState === "error"
          ? "text-red-700"
          : noteSaveState === "saving"
            ? "text-[#ea8600]"
            : "text-[#5f6368]";
    return (
      <span data-testid="note-save-indicator" className={`text-[12px] ${cls}`}>
        {text}
      </span>
    );
  };

  return (
    <div className="mt-8 pt-8 border-t border-gray-200" data-testid="internal-ops-pane">
      {/* 社内メモ */}
      <div className="bg-[#f8f9fa] rounded-xl p-6 border border-[#dadce0]">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <StickyNote size={16} className="text-[#5f6368]" />
            <div className="text-[13px] font-semibold text-[#202124]">社内メモ（共有）</div>
          </div>
          <NoteIndicator />
        </div>

        <textarea
          data-testid="note-textarea"
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          rows={5}
          placeholder={
            readOnlyMode
              ? "READ ONLYのため編集できません"
              : noteLoadState === "loading"
                ? "読込中..."
                : "ここに社内向けメモを書けます（共有）"
          }
          className="w-full bg-white border border-[#dadce0] text-[#202124] text-sm rounded-md px-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all resize-y"
          disabled={readOnlyMode || noteLoadState === "loading"}
        />

        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="text-[11px] text-[#5f6368]" data-testid="note-last-updated">
            {noteLastUpdatedText ? `最終更新: ${noteLastUpdatedText}` : "最終更新: -"}
          </div>
          <div className="flex items-center gap-2">
            {!readOnlyMode && (
              <button
                type="button"
                className="text-[12px] text-[#5f6368] hover:text-[#202124]"
                onClick={() => setNoteText("")}
                title="空にすると削除扱いになります"
              >
                クリア
              </button>
            )}
            {!readOnlyMode && (
              <button
                type="button"
                data-testid="note-save"
                className="px-3 py-1.5 text-[12px] bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
                onClick={() => void handleSaveNote()}
                disabled={!hasUnsavedNote || noteSaveState === "saving"}
              >
                {noteSaveState === "saving" ? "保存中..." : "Save"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 返信下書き（個人） */}
      <div className="mt-6 bg-white rounded-xl p-6 border border-[#dadce0]">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-[#5f6368]" />
            <div className="text-[13px] font-semibold text-[#202124]">返信下書き（個人）</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="reply-templates-open"
              className="px-3 py-1.5 text-[12px] border rounded hover:bg-[#f1f3f4]"
              onClick={openTemplatePicker}
            >
              テンプレ
            </button>
            <button
              type="button"
              data-testid="draft-copy"
              className="px-3 py-1.5 text-[12px] border rounded hover:bg-[#f1f3f4] disabled:opacity-40"
              onClick={() => void handleCopyDraft()}
              disabled={!draftText.trim()}
              title="クリップボードにコピー"
            >
              <span className="inline-flex items-center gap-1">
                <Copy size={14} />
                コピー
              </span>
            </button>
          </div>
        </div>

        <textarea
          data-testid="draft-textarea"
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          rows={8}
          placeholder="ここで返信文を作って、Gmail/RMSに貼り付けできます（端末ごとに保存）"
          className="w-full bg-white border border-[#dadce0] text-[#202124] text-sm rounded-md px-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all resize-y font-mono"
        />
        <div className="mt-2 text-[11px] text-[#5f6368]">
          自動保存: <span className="font-mono">{draftKey}</span>
        </div>
      </div>

      {/* Template Picker Modal */}
      {templateOpen && typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[9999]" data-testid="template-picker">
            <button type="button" className="absolute inset-0 bg-black/20" aria-label="閉じる（背景）" onClick={() => setTemplateOpen(false)} />
            <div className="absolute right-4 top-4 left-4 max-w-[720px] mx-auto bg-white border border-[#dadce0] rounded-xl shadow-2xl">
              <div className="px-4 py-3 border-b border-[#e8eaed] flex items-center justify-between">
                <div className="text-[14px] font-semibold text-[#202124]">テンプレを挿入</div>
                <button
                  type="button"
                  className="p-2 rounded hover:bg-[#f1f3f4]"
                  onClick={() => setTemplateOpen(false)}
                  aria-label="閉じる"
                >
                  <X size={18} className="text-[#5f6368]" />
                </button>
              </div>
              <div className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <input
                    value={templateQuery}
                    onChange={(e) => setTemplateQuery(e.target.value)}
                    placeholder="検索（タイトル/ID）"
                    className="flex-1 border rounded px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    data-testid="template-reload"
                    className="px-3 py-2 text-[12px] border rounded hover:bg-[#f1f3f4] disabled:opacity-40"
                    onClick={() => void loadTemplates()}
                    disabled={templateLoadState === "loading"}
                  >
                    再読込
                  </button>
                </div>

                {templateLoadState === "loading" ? (
                  <div className="text-sm text-[#5f6368]">読み込み中...</div>
                ) : templateLoadState === "error" ? (
                  <div className="text-sm text-red-700">読み込みに失敗しました</div>
                ) : visibleTemplates.length === 0 ? (
                  <div className="text-sm text-[#5f6368]">テンプレがありません</div>
                ) : (
                  <ul className="space-y-2 max-h-[50vh] overflow-auto">
                    {visibleTemplates.map((t) => {
                      const isSelected = selectedTemplate?.id === t.id;
                      const previewResult = isSelected && renderResult ? renderResult : null;
                      return (
                        <li key={t.id} className={`border rounded p-3 ${isSelected ? "bg-blue-50 border-blue-300" : "hover:bg-[#f8f9fa]"}`}>
                          <div className="flex items-start gap-3">
                            <button
                              type="button"
                              data-testid={`reply-template-item-${t.id}`}
                              className="flex-1 text-left"
                              onClick={() => setSelectedTemplate(t)}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-[13px] font-medium text-[#202124] truncate">{t.title}</div>
                                  <div className="text-[11px] text-[#5f6368] font-mono truncate">{t.id}</div>
                                </div>
                                <div className="text-[11px] text-[#5f6368] whitespace-nowrap">
                                  {formatIsoToJa(t.updatedAt) ?? "-"}
                                </div>
                              </div>
                              <div className="mt-2 text-[12px] text-[#3c4043] whitespace-pre-wrap line-clamp-3">
                                {t.body}
                              </div>
                            </button>
                            {isSelected && (
                              <div className="flex flex-col gap-2">
                                <button
                                  type="button"
                                  data-testid={`reply-template-insert-${t.id}`}
                                  className="px-3 py-1.5 text-[12px] bg-blue-600 text-white rounded hover:bg-blue-700"
                                  onClick={() => void handleInsertTemplate(t)}
                                >
                                  挿入
                                </button>
                                <button
                                  type="button"
                                  data-testid={`reply-template-copy-${t.id}`}
                                  className="px-3 py-1.5 text-[12px] border rounded hover:bg-[#f1f3f4]"
                                  onClick={async () => {
                                    if (previewResult) {
                                      try {
                                        await copyToClipboard(previewResult.rendered);
                                        showToast("コピーしました", "success");
                                        // Step57: Activity証跡（best-effort / READ ONLYでもOK）
                                        try {
                                          fetch("/api/mailhub/activity", {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({
                                              action: "template_copy",
                                              messageId,
                                              metadata: {
                                                templateId: t.id,
                                                templateName: t.title,
                                                unresolvedVars: previewResult.unresolved,
                                                route: activityContext?.route ?? null,
                                                channel: activityContext?.channel ?? null,
                                              },
                                            }),
                                          }).catch(() => {});
                                        } catch {
                                          // ignore
                                        }
                                      } catch {
                                        showToast("コピーに失敗しました", "error");
                                      }
                                    }
                                  }}
                                  disabled={!previewResult}
                                >
                                  コピー
                                </button>
                              </div>
                            )}
                          </div>
                          {/* Step46: プレビュー表示 */}
                          {isSelected && previewResult && (
                            <div className="mt-3 pt-3 border-t border-[#dadce0]" data-testid={`reply-template-preview-${t.id}`}>
                              <div className="text-[11px] font-medium text-[#202124] mb-2">プレビュー（変数埋め後）:</div>
                              <div className="text-[12px] text-[#3c4043] whitespace-pre-wrap bg-[#f8f9fa] border border-[#dadce0] rounded p-2 font-mono">
                                {previewResult.rendered}
                              </div>
                              {previewResult.unresolved.length > 0 && (
                                <div className="mt-2 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded p-2">
                                  警告: 未解決のプレースホルダ: {previewResult.unresolved.join(", ")}
                                </div>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

