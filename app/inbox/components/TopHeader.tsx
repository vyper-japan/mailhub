"use client";

import { useState, useRef, useEffect } from "react";
import { Activity, Command, ExternalLink, HelpCircle, Info, MoreVertical, RefreshCw, RotateCcw, Search, Settings, TrendingUp, Handshake, X, List, Zap } from "lucide-react";
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
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const macroRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!showMoreMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMoreMenu]);

  const secondaryActions = [
    { id: "more-ops", label: "Ops Board", icon: TrendingUp, onClick: onOpenOps },
    { id: "more-handoff", label: "引き継ぎ", icon: Handshake, onClick: onOpenHandoff },
    { id: "more-activity", label: "操作ログ", icon: Activity, onClick: () => onOpenActivity?.() },
    { id: "more-help", label: "ヘルプ", icon: HelpCircle, onClick: onOpenHelp },
    { id: "more-diagnostics", label: "診断", icon: Info, onClick: onOpenDiagnostics },
  ] as const;
  const envLabel = mailhubEnv === "production" ? "PROD" : mailhubEnv === "staging" ? "STAGING" : "LOCAL";
  const envClass =
    mailhubEnv === "production"
      ? "bg-red-50 text-red-700 border-red-200"
      : mailhubEnv === "staging"
        ? "bg-amber-50 text-amber-800 border-amber-200"
        : "bg-gray-50 text-gray-700 border-gray-200";
  const topIconButton =
    "relative h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#3c4043] hover:bg-[#f1f3f4] transition-[background-color,color,box-shadow,border-color] duration-75";

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
      <div className="flex max-w-full flex-shrink-0 items-center gap-1 overflow-x-auto">
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
            className={`inline-flex ${topIconButton}`}
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
            className={`inline-flex ${topIconButton}`}
            title="よく見る一覧"
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
            className={`inline-flex ${topIconButton} ${readOnlyMode ? "opacity-40 cursor-not-allowed" : ""}`}
            title={readOnlyMode ? "READ ONLYモードでは実行できません" : "未割当を取る N"}
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
            className={`inline-flex ${topIconButton} ${macroDisabled ? "opacity-40 cursor-not-allowed" : ""}`}
            title={macroDisabled ? "READ ONLYモードでは複合アクションは実行できません" : "複合アクション"}
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
                <span>取って返事待ち</span>
                <span className="ml-auto text-[10px] text-[#5f6368]">自分が対応→返事待ち</span>
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
                <span>取って対応済み</span>
                <span className="ml-auto text-[10px] text-[#5f6368]">自分が対応→対応済み</span>
              </button>
            </div>
          )}
        </div>
        <button
          data-testid="action-ops"
          onClick={onOpenOps}
          className={`${topIconButton} hidden xl:inline-flex`}
          title="Ops Board（朝会ビュー/滞留ゼロ）"
        >
          <TrendingUp size={20} className="text-[#5f6368]" />
        </button>
        <button
          data-testid="action-handoff"
          onClick={onOpenHandoff}
          className={`${topIconButton} hidden xl:inline-flex`}
          title="Handoff（引き継ぎサマリ）"
        >
          <Handshake size={20} className="text-[#5f6368]" />
        </button>
        <button
          data-testid="topbar-activity"
            onClick={() => onOpenActivity?.()}
          className={`${topIconButton} hidden xl:inline-flex`}
          title="Activity（操作ログ）"
        >
          <Activity size={20} className="text-[#5f6368]" />
        </button>
        <button
          data-testid="action-help"
          onClick={onOpenHelp}
          className={`${topIconButton} hidden xl:inline-flex`}
          title="Help（Quick Start / Shortcuts / Diagnostics）"
        >
          <HelpCircle size={20} className="text-[#5f6368]" />
        </button>
        <button
          data-testid="topbar-diagnostics"
          onClick={onOpenDiagnostics}
          className={`${topIconButton} hidden xl:inline-flex`}
          title="Diagnostics（診断情報のみ）"
        >
          <Info size={20} className="text-[#5f6368]" />
        </button>
        <div ref={moreRef} className="relative xl:hidden">
          <button
            type="button"
            data-testid="action-more"
            onClick={() => setShowMoreMenu((prev) => !prev)}
            className={`inline-flex ${topIconButton}`}
            title="その他"
            aria-expanded={showMoreMenu}
          >
            <MoreVertical size={20} className="text-[#5f6368]" />
          </button>
          {showMoreMenu && (
            <div
              data-testid="more-menu"
              className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-lg border border-[#dadce0] bg-white py-1 shadow-lg"
            >
              {secondaryActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    type="button"
                    data-testid={action.id}
                    onClick={() => {
                      setShowMoreMenu(false);
                      action.onClick();
                    }}
                    className="flex h-9 w-full items-center gap-3 px-3 text-left text-[13px] text-[#3c4043] hover:bg-[#f1f3f4]"
                  >
                    <Icon size={16} className="text-[#5f6368]" />
                    <span>{action.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <button
          data-testid="header-refresh"
          onClick={onRefresh}
          className={`inline-flex ${topIconButton}`}
          title="更新"
        >
          <RefreshCw size={20} className={`text-[#5f6368] ${isPending ? "animate-spin" : ""}`} />
        </button>
        <a
          href={gmailLink ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex ${topIconButton}`}
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
