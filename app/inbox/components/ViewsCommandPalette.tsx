"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { View } from "@/lib/views";

type Props = {
  open: boolean;
  views: View[];
  activeViewId: string | null;
  onClose: () => void;
  onSelectView: (id: string) => void;
};

export function ViewsCommandPalette({ open, views, activeViewId, onClose, onSelectView }: Props) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return views;
    return views.filter((v) => {
      const hay = `${v.icon ?? ""} ${v.name} ${v.id}`.toLowerCase();
      return hay.includes(q);
    });
  }, [query, views]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const first = visible[0];
        if (first) onSelectView(first.id);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, onSelectView, visible]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999]" data-testid="views-palette">
      <button type="button" className="absolute inset-0 bg-black/20" aria-label="閉じる（背景）" onClick={onClose} />
      <div className="absolute left-4 right-4 top-20 max-w-[720px] mx-auto bg-white border border-[#dadce0] rounded-xl shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#e8eaed] flex items-center justify-between gap-3">
          <div className="text-[14px] font-semibold text-[#202124]">Views</div>
          <button type="button" className="p-2 rounded hover:bg-[#f1f3f4]" onClick={onClose} aria-label="閉じる">
            <X size={18} className="text-[#5f6368]" />
          </button>
        </div>
        <div className="p-4">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ビューを検索（例: 未割当 / waiting / overdue）"
            className="w-full border rounded px-3 py-2 text-sm"
          />

          <div className="mt-3 max-h-[50vh] overflow-auto">
            {visible.length === 0 ? (
              <div className="text-sm text-[#5f6368]">該当するビューがありません</div>
            ) : (
              <ul className="space-y-1">
                {visible.map((v) => {
                  const isActive = v.id === activeViewId;
                  return (
                    <li key={v.id}>
                      <button
                        type="button"
                        data-testid={`views-palette-item-${v.id}`}
                        className={`w-full text-left px-3 py-2 rounded border ${
                          isActive ? "bg-[#E8F0FE] border-[#d2e3fc]" : "bg-white border-transparent hover:bg-[#f8f9fa]"
                        }`}
                        onClick={() => onSelectView(v.id)}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[13px] font-medium text-[#202124] truncate">
                              {v.icon ? `${v.icon} ` : ""}{v.name}
                            </div>
                            <div className="text-[11px] text-[#5f6368] font-mono truncate">{v.id}</div>
                          </div>
                          {v.pinned && <span className="text-[11px] text-[#5f6368]">pinned</span>}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="mt-3 text-[11px] text-[#5f6368]">
            Enter: 先頭を選択 / Esc: 閉じる
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

