"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { User, X, Check } from "lucide-react";
import { fetchJson } from "../client-api";

type AssigneeEntry = {
  email: string;
  displayName?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  currentUserEmail: string;
  currentAssigneeEmail: string | null;
  onSelect: (email: string | null, handoffNote?: string) => Promise<void>;
  isAdmin: boolean;
};

export function AssigneeSelector({ open, onClose, currentUserEmail, currentAssigneeEmail, onSelect, isAdmin }: Props) {
  const [assignees, setAssignees] = useState<AssigneeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [handoffNote, setHandoffNote] = useState("");
  const [showHandoffNote, setShowHandoffNote] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        // Step 110: /api/mailhub/teamからrosterを取得（優先）
        const teamData = await fetchJson<{ team: Array<{ email: string; name: string | null }>; roster?: string[] }>("/api/mailhub/team");
        if (teamData.roster && teamData.roster.length > 0) {
          // rosterから名簿を構築（teamのnameを取得）
          const rosterEntries: AssigneeEntry[] = teamData.roster.map((email) => {
            const teamMember = teamData.team.find((m) => m.email.toLowerCase() === email.toLowerCase());
            return {
              email,
              displayName: teamMember?.name ?? undefined,
            };
          });
          setAssignees(rosterEntries);
        } else {
          // フォールバック: /api/mailhub/assigneesから担当者名簿を取得
          const data = await fetchJson<{ assignees: AssigneeEntry[] }>("/api/mailhub/assignees");
          setAssignees(data.assignees ?? []);
        }
      } catch (e) {
        console.error("Failed to load assignees:", e);
        setAssignees([]);
      }
    })();
    setSearchQuery("");
    setHandoffNote("");
    setShowHandoffNote(false);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
  }, [open]);

  const filteredAssignees = useMemo(() => {
    if (!searchQuery) return assignees;
    const q = searchQuery.toLowerCase();
    return assignees.filter(
      (m) => m.email.toLowerCase().includes(q) || (m.displayName?.toLowerCase().includes(q) ?? false)
    );
  }, [assignees, searchQuery]);

  // Step 70: 直接入力メールでAssign可能か判定
  const directInputEmail = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    // 有効なメールアドレス形式かつ@vtj.co.jpドメインのみ許可
    if (!q.includes("@") || !q.endsWith("@vtj.co.jp")) return null;
    // 簡易メールバリデーション
    const emailRegex = /^[^\s@]+@vtj\.co\.jp$/;
    return emailRegex.test(q) ? q : null;
  }, [searchQuery]);
  
  // 直接入力メールが有効かつ、名簿に含まれていない場合に表示
  const showDirectInput = directInputEmail && !assignees.some((m) => m.email.toLowerCase() === directInputEmail);

  const handleSelect = useCallback(
    async (email: string | null) => {
      setLoading(true);
      try {
        // 現在の担当者がいて、新しい担当者が異なる場合は引き継ぎメモを渡す
        const hasHandoffNote = showHandoffNote && handoffNote.trim().length > 0;
        const note = currentAssigneeEmail && email && currentAssigneeEmail.toLowerCase() !== email.toLowerCase() && hasHandoffNote ? handoffNote.trim() : undefined;
        await onSelect(email, note);
        onClose();
      } catch (e) {
        console.error("Failed to assign:", e);
      } finally {
        setLoading(false);
      }
    },
    [onSelect, onClose, currentAssigneeEmail, showHandoffNote, handoffNote]
  );

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

  if (!open || typeof document === "undefined") return null;

  const currentUserLower = currentUserEmail.toLowerCase();
  const currentAssigneeLower = currentAssigneeEmail?.toLowerCase() ?? null;

  return createPortal(
    <div className="fixed inset-0 z-[9998] flex items-start justify-center bg-black/20 backdrop-blur-sm pt-20" data-testid="assignee-selector-overlay" data-testid-modal="assignee-modal">
      <button
        type="button"
        className="absolute inset-0 -z-10"
        aria-label="閉じる（背景）"
        onClick={onClose}
      />
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-md flex flex-col overflow-hidden relative z-10"
        onClick={(e) => e.stopPropagation()}
        data-testid="assignee-selector"
      >
        <div className="h-14 px-4 flex items-center justify-between border-b border-[#e8eaed]">
          <div className="text-[14px] font-semibold text-[#202124]">担当者を選択</div>
          <button type="button" onClick={onClose} className="p-2 rounded hover:bg-[#f1f3f4]" aria-label="閉じる">
            <X size={18} className="text-[#5f6368]" />
          </button>
        </div>

        <div className="p-3 border-b border-[#e8eaed]">
          <input
            ref={inputRef}
            type="text"
            placeholder="メールアドレスまたは名前で検索..."
            className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="assignee-picker-input"
          />
        </div>

        {/* 引き継ぎメモ入力欄（現在の担当者がいる場合のみ） */}
        {currentAssigneeLower && (
          <div className="px-3 py-2 border-b border-[#e8eaed]">
            <label className="flex items-center gap-2 text-sm text-[#202124] mb-2">
              <input
                type="checkbox"
                checked={showHandoffNote}
                onChange={(e) => setShowHandoffNote(e.target.checked)}
                className="rounded"
                data-testid="assignee-selector-handoff-note-toggle"
              />
              <span>引き継ぎメモを追加</span>
            </label>
            {showHandoffNote && (
              <textarea
                value={handoffNote}
                onChange={(e) => setHandoffNote(e.target.value)}
                placeholder="引き継ぎメモを入力（任意）"
                rows={3}
                className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                data-testid="assignee-selector-handoff-note-input"
              />
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto max-h-[400px] p-2">
          {/* 担当解除オプション */}
          {currentAssigneeLower && (
            <button
              type="button"
              className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-gray-50 text-left text-sm text-gray-700"
              onClick={() => void handleSelect(null)}
              disabled={loading}
              data-testid="assignee-selector-unassign"
            >
              <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                <X size={16} className="text-gray-500" />
              </div>
              <div className="flex-1">
                <div className="font-medium">担当を解除</div>
              </div>
            </button>
          )}

          {/* 自分（常に表示） */}
          <button
            type="button"
            className={`w-full flex items-center gap-2 p-2 rounded-md hover:bg-gray-50 text-left text-sm ${
              currentAssigneeLower === currentUserLower ? "bg-blue-50" : ""
            }`}
            onClick={() => void handleSelect(currentUserEmail)}
            disabled={loading}
            data-testid="assignee-picker-apply"
          >
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
              <User size={16} className="text-blue-600" />
            </div>
            <div className="flex-1">
              <div className="font-medium">自分（{currentUserEmail}）</div>
            </div>
            {currentAssigneeLower === currentUserLower && (
              <Check size={16} className="text-blue-600" />
            )}
          </button>

          {/* Step 70: 直接入力メールでAssign（Admin & @vtj.co.jpのみ） */}
          {isAdmin && showDirectInput && (
            <button
              type="button"
              className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-green-50 text-left text-sm border border-green-300 bg-green-50/50 mt-2"
              onClick={() => void handleSelect(directInputEmail)}
              disabled={loading}
              data-testid="assignee-picker-direct-apply"
            >
              <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                <User size={16} className="text-green-600" />
              </div>
              <div className="flex-1">
                <div className="font-medium text-green-800">この宛先に割当: {directInputEmail}</div>
                <div className="text-xs text-green-600">（Team未登録でも割当可能）</div>
              </div>
            </button>
          )}
          {/* Step 70: 無効なメール入力時のヒント */}
          {isAdmin && searchQuery.includes("@") && !searchQuery.endsWith("@vtj.co.jp") && (
            <div className="text-center text-red-500 py-2 text-sm" data-testid="assignee-picker-domain-error">
              ⚠️ @vtj.co.jp ドメインのみ割当可能です
            </div>
          )}

          {/* 担当者名簿 (Admin only) */}
          {isAdmin && (
            filteredAssignees.length === 0 ? (
              <div className="text-center text-gray-500 py-8 text-sm">
                {searchQuery ? "該当するメンバーが見つかりません" : "担当者が登録されていません"}
              </div>
            ) : (
              <ul className="space-y-1" data-testid="assignee-picker-team-list">
                {filteredAssignees
                  .filter((m) => m.email.toLowerCase() !== currentUserLower)
                  .map((member) => {
                    const isSelected = currentAssigneeLower === member.email.toLowerCase();
                    return (
                      <li key={member.email}>
                        <button
                          type="button"
                          className={`w-full flex items-center gap-2 p-2 rounded-md hover:bg-gray-50 text-left text-sm ${
                            isSelected ? "bg-blue-50" : ""
                          }`}
                          onClick={() => void handleSelect(member.email)}
                          disabled={loading}
                          data-testid={`assignee-picker-item-${member.email}`}
                        >
                          <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                            <User size={16} className="text-gray-500" />
                          </div>
                          <div className="flex-1">
                            <div className="font-medium">{member.displayName || member.email}</div>
                            {member.displayName && (
                              <div className="text-xs text-gray-500">{member.email}</div>
                            )}
                          </div>
                          {isSelected && <Check size={16} className="text-blue-600" />}
                        </button>
                      </li>
                    );
                  })}
              </ul>
            )
          )}
          {!isAdmin && (
            <div className="text-center text-gray-500 py-4 text-sm" data-testid="assignee-picker-admin-only-hint">
              他のメンバーへの割当は管理者のみ可能です
            </div>
          )}
        </div>

        {loading && (
          <div className="px-4 py-2 border-t border-[#e8eaed] text-sm text-gray-600 text-center">
            処理中...
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
