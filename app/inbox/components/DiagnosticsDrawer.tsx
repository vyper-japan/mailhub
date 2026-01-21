"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, RefreshCw, X } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
};

type FetchState<T> = { ok: true; data: T } | { ok: false; error: string };

async function safeFetchJson<T>(url: string): Promise<FetchState<T>> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as T;
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function DiagnosticsDrawer({ open, onClose }: Props) {
  const [health, setHealth] = useState<FetchState<unknown> | null>(null);
  const [version, setVersion] = useState<FetchState<unknown> | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showManualCopy, setShowManualCopy] = useState(false);
  const manualCopyTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const load = useCallback(async () => {
    const [h, v] = await Promise.all([
      safeFetchJson("/api/mailhub/config/health"),
      safeFetchJson("/api/version"),
    ]);
    setHealth(h);
    setVersion(v);
  }, []);

  useEffect(() => {
    if (!open) return;
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

  const copyText = useCallback(async (text: string, showManualOnFail = false) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast("コピーしました");
      setTimeout(() => setToast(null), 2500);
      if (showManualOnFail) {
        setShowManualCopy(false);
      }
    } catch {
      if (showManualOnFail) {
        // コピー失敗時はテキストエリアを表示して手動コピーできるようにする
        setShowManualCopy(true);
        setTimeout(() => {
          manualCopyTextareaRef.current?.select();
          manualCopyTextareaRef.current?.focus();
        }, 100);
      } else {
        setToast("コピーに失敗しました（権限/ブラウザ設定を確認）");
        setTimeout(() => setToast(null), 4000);
      }
    }
  }, []);

  const bundle = useMemo(() => {
    return {
      capturedAt: new Date().toISOString(),
      location: typeof window !== "undefined" ? window.location.href : "(unknown)",
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "(unknown)",
      health,
      version,
    };
  }, [health, version]);

  const prettyBundle = useMemo(() => JSON.stringify(bundle, null, 2), [bundle]);
  const prettyHealth = useMemo(() => JSON.stringify(health, null, 2), [health]);
  const prettyVersion = useMemo(() => JSON.stringify(version, null, 2), [version]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[9997]" data-testid="diagnostics-overlay">
      <button
        type="button"
        className="absolute inset-0 bg-black/20"
        aria-label="閉じる（背景）"
        onClick={onClose}
      />
      <div
        className="absolute right-0 top-0 h-full w-full max-w-[560px] bg-white shadow-2xl border-l border-[#dadce0] flex flex-col"
        data-testid="diagnostics-drawer"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-14 px-4 flex items-center justify-between border-b border-[#e8eaed]">
          <div className="text-[14px] font-semibold text-[#202124]">Help / Diagnostics</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="px-2 py-1 text-[12px] rounded border border-[#dadce0] hover:bg-[#f1f3f4] flex items-center gap-1"
              onClick={() => void load()}
              title="再取得"
              data-testid="diagnostics-reload"
            >
              <RefreshCw size={14} className="text-[#5f6368]" />
              再取得
            </button>
            <button
              type="button"
              className="px-2 py-1 text-[12px] rounded border border-[#dadce0] hover:bg-[#f1f3f4] flex items-center gap-1"
              onClick={() => void copyText(prettyBundle, true)}
              title="診断情報をまとめてコピー"
              data-testid="diagnostics-copy"
            >
              <Copy size={14} className="text-[#5f6368]" />
              診断情報をコピー
            </button>
            <button type="button" onClick={onClose} className="p-2 rounded hover:bg-[#f1f3f4]" aria-label="閉じる">
              <X size={18} className="text-[#5f6368]" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          <div className="text-[12px] text-[#5f6368]">
            困ったら「診断情報をコピー」を押して、Slack/チャットに貼り付けてください（秘密情報は含めません）。
          </div>

          {showManualCopy && (
            <section className="border rounded-md border-[#dadce0] bg-[#fef7e0]">
              <div className="px-3 py-2 border-b border-[#e8eaed] flex items-center justify-between">
                <div className="text-[13px] font-semibold text-[#ea8600]">手動コピー（クリップボードコピーに失敗した場合）</div>
                <button
                  type="button"
                  className="px-2 py-1 text-[12px] rounded border border-[#dadce0] hover:bg-[#f1f3f4]"
                  onClick={() => setShowManualCopy(false)}
                >
                  閉じる
                </button>
              </div>
              <div className="p-3">
                <textarea
                  ref={manualCopyTextareaRef}
                  readOnly
                  value={prettyBundle}
                  className="w-full h-48 p-2 text-[11px] font-mono border border-[#dadce0] rounded bg-white resize-none"
                  onClick={(e) => {
                    e.currentTarget.select();
                  }}
                  data-testid="diagnostics-manual-copy-textarea"
                />
                <div className="mt-2 text-[11px] text-[#5f6368]">
                  上記のテキストエリアを全選択（Cmd+A / Ctrl+A）してコピー（Cmd+C / Ctrl+C）してください。
                </div>
              </div>
            </section>
          )}

          <section className="border rounded-md border-[#dadce0]">
            <div className="px-3 py-2 border-b border-[#e8eaed] flex items-center justify-between">
              <div className="text-[13px] font-semibold text-[#202124]">Health</div>
              <button
                type="button"
                className="px-2 py-1 text-[12px] rounded border border-[#dadce0] hover:bg-[#f1f3f4]"
                onClick={() => void copyText(prettyHealth)}
                data-testid="diagnostics-copy-health"
              >
                コピー
              </button>
            </div>
            <pre className="p-3 text-[11px] overflow-auto whitespace-pre-wrap break-words">{prettyHealth}</pre>
          </section>

          <section className="border rounded-md border-[#dadce0]">
            <div className="px-3 py-2 border-b border-[#e8eaed] flex items-center justify-between">
              <div className="text-[13px] font-semibold text-[#202124]">Version</div>
              <button
                type="button"
                className="px-2 py-1 text-[12px] rounded border border-[#dadce0] hover:bg-[#f1f3f4]"
                onClick={() => void copyText(prettyVersion)}
                data-testid="diagnostics-copy-version"
              >
                コピー
              </button>
            </div>
            <pre className="p-3 text-[11px] overflow-auto whitespace-pre-wrap break-words">{prettyVersion}</pre>
          </section>
        </div>

        {toast && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-[#202124] text-white text-[12px] px-3 py-2 rounded shadow">
            {toast}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

