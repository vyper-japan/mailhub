"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { SettingsPanel } from "@/app/settings/labels/settings-panel";

type Props = {
  open: boolean;
  onClose: () => void;
  onOpenActivity?: (ruleId?: string) => void;
};

export function SettingsDrawer({ open, onClose, onOpenActivity }: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (!open) return;
    // 軽いフォーカス（アクセシビリティ/キーボード操作）
    setTimeout(() => panelRef.current?.focus(), 0);
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[9998]" data-testid="settings-overlay">
      <button
        type="button"
        className="absolute inset-0 bg-black/20"
        aria-label="閉じる（背景）"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="absolute right-0 top-0 h-full w-full max-w-[520px] bg-white shadow-2xl border-l border-[#dadce0] flex flex-col"
        data-testid="settings-drawer"
      >
        <div className="h-14 px-4 flex items-center justify-between border-b border-[#e8eaed]">
          <div className="text-[14px] font-semibold text-[#202124]">設定</div>
          <button type="button" onClick={onClose} className="p-2 rounded hover:bg-[#f1f3f4]" aria-label="閉じる" data-testid="settings-drawer-close">
            <X size={18} className="text-[#5f6368]" />
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          <SettingsPanel mode="drawer" onOpenActivity={onOpenActivity} />
        </div>
      </div>
    </div>,
    document.body,
  );
}



