"use client";

import { useState, useRef, useEffect } from "react";
import { Activity, Command, ExternalLink, HelpCircle, Info, RefreshCw, RotateCcw, Search, Settings, TrendingUp, Handshake, X, List, Zap } from "lucide-react";
import { t } from "../inbox-ui";

export type MacroType = "take-waiting" | "take-done";

type Props = {
  searchTerm: string;
  onChangeSearch: (next: string) => void;
  onSearchSubmit?: (query: string) => void;
  onSearchClear?: () => void;
  serverSearchQuery?: string;
  isPending: boolean;
  onOpenSettings: () => void;
  showSettings?: boolean;
  onOpenActivity?: (ruleId?: string) => void;
  onOpenDiagnostics: () => void;
  onOpenHelp: () => void;
  onOpenOps: () => void;
  onOpenHandoff: () => void;
  onRefresh: () => void;
  gmailLink: string | null;
  onOpenShortcutHelp: () => void;
  testMode: boolean;
  onTestReset: () => void;
  mailhubEnv: "local" | "staging" | "production";
  readOnlyMode: boolean;
  onOpenQueues?: () => void;
  queuesButtonRef?: React.RefObject<HTMLButtonElement | null>;
  // Step 58: Macro
  macroDisabled?: boolean;
  onRunMacro?: (macroType: MacroType) => void;
  // Step 111: Take Next
  onTakeNext?: () => void;
  // Step 112: Command Palette
  onOpenCommandPalette?: () => void;
};

export function TopHeader({
  searchTerm,
  onChangeSearch,
  onSearchSubmit,
  onSearchClear,
  serverSearchQuery = "",
  isPending,
  onOpenSettings,
  showSettings = true,
  onOpenActivity,
  onOpenDiagnostics,
  onOpenHelp,
  onOpenOps,
  onOpenHandoff,
  onRefresh,
  gmailLink,
  testMode,
  onTestReset,
  mailhubEnv,
  readOnlyMode,
  onOpenQueues,
  queuesButtonRef,
  macroDisabled = false,
  onRunMacro,
  onTakeNext,
  onOpenCommandPalette,
}: Props) {
  const [showMacroPopover, setShowMacroPopover] = useState(false);
  const macroRef = useRef<HTMLDivElement>(null);

  // 外側クリックでポップオーバーを閉じる
  useEffect(() => {
    if (!showMacroPopover) return;
    const handleClick = (e: MouseEvent) => {
      if (macroRef.current && !macroRef.current.contains(e.target as Node)) {
        setShowMacroPopover(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMacroPopover]);
  const envLabel = mailhubEnv === "production" ? "PROD" : mailhubEnv === "staging" ? "STAGING" : "LOCAL";
  const envClass =
    mailhubEnv === "production"
      ? "bg-red-50 text-red-700 border-red-200"
      : mailhubEnv === "staging"
        ? "bg-amber-50 text-amber-800 border-amber-200"
        : "bg-gray-50 text-gray-700 border-gray-200";

  return (
    <header className={t.header} data-testid="header">
      <div className={t.headerSearchWrapper}>
        <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5f6368]" />
        <input
          type="text"
          data-testid="topbar-search"
          placeholder="メールを検索... (Gmail検索式: from:, subject:, newer_than:)"
          className={t.headerSearch}
          value={searchTerm}
          onChange={(e) => onChangeSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onSearchSubmit) {
              e.preventDefault();
              const query = searchTerm.trim();
              if (query) {
                onSearchSubmit(query);
              } else if (onSearchClear) {
                onSearchClear();
              }
            } else if (e.key === "Escape" && onSearchClear) {
              e.preventDefault();
              onChangeSearch("");
              onSearchClear();
            }
          }}
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {/* Step 51: 検索中の見た目（クリアボタン） */}
          {serverSearchQuery && (
            <button
              type="button"
              data-testid="search-clear"
              onClick={() => {
                onChangeSearch("");
                if (onSearchClear) onSearchClear();
              }}
              className="p-1 rounded hover:bg-[#f1f3f4] text-[#5f6368]"
              title="検索をクリア"
            >
              <X size={16} />
            </button>
          )}
          <button
            type="button"
            data-testid="action-command-palette"
            onClick={onOpenCommandPalette}
            className="hidden sm:inline-flex items-center gap-1 px-1.5 h-5 text-[10px] font-medium text-[#5f6368] bg-[#e8eaed] border border-[#dadce0] rounded font-mono uppercase hover:bg-[#dadce0] transition-colors"
            title="コマンドパレット（⌘K / Ctrl+K）"
          >
            <Command size={10} />K
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span
          data-testid="env-badge"
          className={`hidden sm:inline-flex items-center px-2 h-6 text-[11px] font-semibold rounded border ${envClass}`}
          title={`環境: ${envLabel}`}
        >
          {envLabel}
        </span>
        {readOnlyMode && (
          <span
            data-testid="readonly-badge"
            className="hidden sm:inline-flex items-center px-2 h-6 text-[11px] font-semibold rounded border bg-red-50 text-red-700 border-red-200"
            title="READ ONLY（変更系は403で拒否）"
          >
            READ ONLY
          </span>
        )}
        {showSettings && (
          <button
            type="button"
            data-testid="action-settings"
            onClick={onOpenSettings}
            className={t.toolbarButton}
            title="設定（ラベル/ルール）"
          >
            <Settings size={20} className="text-[#5f6368]" />
          </button>
        )}
        {onOpenQueues && (
          <button
            type="button"
            ref={queuesButtonRef}
            data-testid="action-queues"
            onClick={onOpenQueues}
            className={t.toolbarButton}
            title="Queues（作業キュー）"
          >
            <List size={20} className="text-[#5f6368]" />
          </button>
        )}
        {/* Step 111: Take Next ボタン */}
        {onTakeNext && (
          <button
            type="button"
            data-testid="action-take-next"
            onClick={onTakeNext}
            disabled={readOnlyMode}
            className={`${t.toolbarButton} ${readOnlyMode ? "opacity-40 cursor-not-allowed" : ""}`}
            title={readOnlyMode ? "READ ONLYモードでは実行できません" : "Take Next（未割当を1件自動で自分に割当） N"}
          >
            <span className="text-[#5f6368] font-semibold">N</span>
          </button>
        )}
        {/* Step 58: Macro ボタン */}
        <div ref={macroRef} className="relative">
          <button
            type="button"
            data-testid="action-macro"
            onClick={() => !macroDisabled && setShowMacroPopover((prev) => !prev)}
            disabled={macroDisabled}
            className={`${t.toolbarButton} ${macroDisabled ? "opacity-40 cursor-not-allowed" : ""}`}
            title={macroDisabled ? "READ ONLYモードではMacroは実行できません" : "Macro（複合アクション）"}
          >
            <Zap size={20} className="text-[#5f6368]" />
          </button>
          {showMacroPopover && (
            <div
              data-testid="macro-popover"
              className="absolute right-0 top-full mt-1 w-56 bg-white border border-[#dadce0] rounded-lg shadow-lg z-50 py-1"
            >
              <button
                type="button"
                data-testid="macro-item-take-waiting"
                onClick={() => {
                  setShowMacroPopover(false);
                  onRunMacro?.("take-waiting");
                }}
                className="w-full px-4 py-2 text-left text-sm hover:bg-[#f1f3f4] flex items-center gap-2"
              >
                <span className="text-[#1a73e8]">⚡</span>
                <span>Take + Waiting</span>
                <span className="ml-auto text-[10px] text-[#5f6368]">自分担当→保留</span>
              </button>
              <button
                type="button"
                data-testid="macro-item-take-done"
                onClick={() => {
                  setShowMacroPopover(false);
                  onRunMacro?.("take-done");
                }}
                className="w-full px-4 py-2 text-left text-sm hover:bg-[#f1f3f4] flex items-center gap-2"
              >
                <span className="text-[#34a853]">⚡</span>
                <span>Take + Done</span>
                <span className="ml-auto text-[10px] text-[#5f6368]">自分担当→完了</span>
              </button>
            </div>
          )}
        </div>
        <button
          data-testid="action-ops"
          onClick={onOpenOps}
          className={t.toolbarButton}
          title="Ops Board（朝会ビュー/滞留ゼロ）"
        >
          <TrendingUp size={20} className="text-[#5f6368]" />
        </button>
        <button
          data-testid="action-handoff"
          onClick={onOpenHandoff}
          className={t.toolbarButton}
          title="Handoff（引き継ぎサマリ）"
        >
          <Handshake size={20} className="text-[#5f6368]" />
        </button>
        <button
          data-testid="topbar-activity"
            onClick={() => onOpenActivity?.()}
          className={t.toolbarButton}
          title="Activity（操作ログ）"
        >
          <Activity size={20} className="text-[#5f6368]" />
        </button>
        <button
          data-testid="action-help"
          onClick={onOpenHelp}
          className={t.toolbarButton}
          title="Help（Quick Start / Shortcuts / Diagnostics）"
        >
          <HelpCircle size={20} className="text-[#5f6368]" />
        </button>
        <button
          data-testid="topbar-diagnostics"
          onClick={onOpenDiagnostics}
          className={t.toolbarButton}
          title="Diagnostics（診断情報のみ）"
        >
          <Info size={20} className="text-[#5f6368]" />
        </button>
        <button
          data-testid="header-refresh"
          onClick={onRefresh}
          className={t.toolbarButton}
          title="更新"
        >
          <RefreshCw size={20} className={`text-[#5f6368] ${isPending ? "animate-spin" : ""}`} />
        </button>
        <a
          href={gmailLink ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className={t.toolbarButton}
          title="Gmailで開く"
        >
          <ExternalLink size={20} className="text-[#5f6368]" />
        </a>
        {/* テストモードのリセットボタン */}
        {testMode && (
          <button
            data-testid="test-reset"
            onClick={onTestReset}
            className={`${t.toolbarButton} bg-[#fef7e0] text-[#ea8600] hover:bg-[#fdd663] border border-[#fdd663]`}
            title="テストモードをリセット（初期状態に戻す）"
          >
            <RotateCcw size={20} />
            <span className="hidden lg:inline">リセット</span>
          </button>
        )}
      </div>
    </header>
  );
}



