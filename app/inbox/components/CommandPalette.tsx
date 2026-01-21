"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export type Command = {
  id: string;
  label: string;
  icon: React.ReactNode;
  action: () => void;
  disabled?: boolean;
};

type Props = {
  open: boolean;
  commands: Command[];
  onClose: () => void;
};

export function CommandPalette({ open, commands, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSelectedIndex(0);
      return;
    }
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.filter((c) => !c.disabled);
    return commands.filter((c) => {
      if (c.disabled) return false;
      const hay = c.label.toLowerCase();
      return hay.includes(q);
    });
  }, [query, commands]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < visible.length - 1 ? prev + 1 : 0));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : visible.length - 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const selected = visible[selectedIndex];
        if (selected && !selected.disabled) {
          selected.action();
          onClose();
        }
        return;
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, visible, selectedIndex]);

  // 選択インデックスを可視範囲内に調整
  useEffect(() => {
    if (selectedIndex >= visible.length) {
      setSelectedIndex(Math.max(0, visible.length - 1));
    }
  }, [selectedIndex, visible.length]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999]" data-testid="command-palette">
      <button type="button" className="absolute inset-0 bg-black/20" aria-label="閉じる（背景）" onClick={onClose} />
      <div className="absolute left-4 right-4 top-20 max-w-[720px] mx-auto bg-white border border-[#dadce0] rounded-xl shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#e8eaed] flex items-center justify-between gap-3">
          <div className="text-[14px] font-semibold text-[#202124]">コマンド</div>
          <button type="button" className="p-2 rounded hover:bg-[#f1f3f4]" onClick={onClose} aria-label="閉じる">
            <X size={18} className="text-[#5f6368]" />
          </button>
        </div>
        <div className="p-4">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="コマンドを検索..."
            className="w-full border rounded px-3 py-2 text-sm"
            data-testid="command-palette-input"
          />

          <div className="mt-3 max-h-[50vh] overflow-auto">
            {visible.length === 0 ? (
              <div className="text-sm text-[#5f6368]">該当するコマンドがありません</div>
            ) : (
              <ul className="space-y-1">
                {visible.map((cmd, idx) => {
                  const isSelected = idx === selectedIndex;
                  return (
                    <li key={cmd.id}>
                      <button
                        type="button"
                        data-testid={`command-palette-item-${cmd.id}`}
                        className={`w-full text-left px-3 py-2 rounded border flex items-center gap-3 ${
                          isSelected
                            ? "bg-[#E8F0FE] border-[#d2e3fc]"
                            : "bg-white border-transparent hover:bg-[#f8f9fa]"
                        } ${cmd.disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                        onClick={() => {
                          if (!cmd.disabled) {
                            cmd.action();
                            onClose();
                          }
                        }}
                        disabled={cmd.disabled}
                      >
                        <div className="flex-shrink-0 text-[#5f6368]">{cmd.icon}</div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium text-[#202124]">{cmd.label}</div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="mt-3 text-[11px] text-[#5f6368]">
            ↑↓: 選択 / Enter: 実行 / Esc: 閉じる
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
