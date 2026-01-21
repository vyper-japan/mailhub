// Gmail完全再現: 配色・デザイン要素を完璧にコピー
export const t = {
  // Gmail base background (完全再現)
  bg: "bg-[#f6f8fc] text-[#202124] font-normal",
  layout: "h-screen flex overflow-hidden",

  // サイドバー（Gmail完全再現 + レスポンシブ）
  sidebar:
    "min-w-[200px] w-64 max-w-[320px] bg-white flex flex-col border-r border-[#dadce0] flex-shrink-0",
  sidebarItem:
    "flex items-center justify-between px-3 py-2 mx-1 text-[14px] text-[#3c4043] rounded-r-full hover:bg-[#f1f3f4] transition-colors cursor-pointer font-normal group",
  sidebarItemActive: "bg-[#E8F0FE] text-[#1a73e8] font-medium",
  sidebarHeader:
    "px-4 py-2 mt-4 text-[11px] font-medium text-[#5f6368] uppercase tracking-wider",

  // ヘッダー（検索バー - Gmail完全再現 + レスポンシブ）
  header:
    "h-14 border-b border-[#dadce0] flex items-center px-2 sm:px-4 bg-white gap-2 sm:gap-4",
  headerSearchWrapper: "relative flex-1 max-w-2xl min-w-0",
  headerSearch:
    "w-full bg-[#f1f3f4] border border-transparent text-[#202124] text-[14px] rounded-full px-8 sm:px-12 py-2.5 focus:outline-none focus:bg-white focus:border-[#dadce0] focus:shadow-[0_2px_5px_1px_rgba(64,60,67,0.16)] transition-all placeholder-[#5f6368] font-normal",

  // ツールバー（アクションボタン群 - Gmail完全再現 + レスポンシブ）
  toolbar:
    "h-12 border-b border-[#dadce0] flex items-center px-2 sm:px-4 bg-white overflow-x-auto",
  toolbarButton:
    "relative flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 text-[#3c4043] hover:bg-[#f1f3f4] rounded-md transition-all text-[13px] sm:text-[14px] font-normal group flex-shrink-0",
  toolbarButtonActive: "bg-[#E8F0FE] text-[#1a73e8]",
  toolbarShortcut:
    "absolute -bottom-6 left-1/2 -translate-x-1/2 hidden group-hover:block text-[10px] text-gray-500 bg-gray-800 text-white border border-gray-700 px-1.5 py-0.5 rounded whitespace-nowrap pointer-events-none z-50",

  // タブナビゲーション（Gmail完全再現 + レスポンシブ）
  tabs:
    "h-12 flex items-center justify-between border-b border-[#dadce0] bg-white px-1 sm:px-2 gap-1 sm:gap-2 overflow-x-auto",
  tab:
    "h-12 px-2 sm:px-4 text-[12px] sm:text-[13px] font-medium text-[#5f6368] border-b-2 border-transparent hover:text-[#202124] hover:border-[#dadce0] transition-colors cursor-pointer flex items-center flex-shrink-0",
  tabActive: "text-[#1a73e8] border-[#1a73e8] font-medium",

  // メインエリア（Gmail完全再現 + レスポンシブ）
  mainArea: "flex-1 flex bg-[#f6f8fc] overflow-hidden min-w-0",

  // リストカラム（Gmail完全再現 + レスポンシブ）
  listColumn:
    "min-w-[280px] w-96 max-w-[480px] flex flex-col bg-white border-r border-[#dadce0] overflow-hidden flex-shrink-0",
  listItem:
    "px-2 sm:px-3 py-1.5 border-b border-[#e8eaed] hover:bg-[#f2f6fc] cursor-pointer transition-colors group select-none flex items-center gap-2",
  listItemActive: "bg-[#E8F0FE] shadow-[inset_0_0_0_1px_#d2e3fc]",
  listItemChecked: "bg-[#E8F0FE]",
  listItemUnread: "bg-white",
  listItemRead: "bg-[#F2F6FC]",

  // 詳細カラム（Gmail完全再現 + レスポンシブ）
  detailColumn: "flex-1 flex flex-col bg-white overflow-hidden min-w-[400px]",

  // ボタン・その他（Gmail完全再現）
  buttonPrimary:
    "bg-[#1a73e8] text-white hover:bg-[#1557b0] px-4 py-2 rounded-md text-[14px] font-medium transition-all flex items-center gap-2",
  buttonIcon: "p-2 text-[#5f6368] hover:bg-[#f1f3f4] rounded-full transition-colors",
  badge: "bg-[#e8eaed] text-[#3c4043] px-2 py-0.5 rounded-full text-[11px] font-medium",
} as const;

export function shortSnippet(s: string, max = 120): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max)}…`;
}

/**
 * 検索用の文字列正規化（大文字小文字・全角半角・ひらがなカタカナを統一）
 */
export function normalizeForSearch(text: string | null | undefined): string {
  if (!text) return "";
  let normalized = text.toLowerCase(); // 大文字小文字を統一

  // 全角・半角を統一（英数字・記号）
  if (typeof normalized.normalize === "function") {
    normalized = normalized.normalize("NFKC");
  }

  // ひらがな（\u3041-\u3096）をカタカナ（\u30A1-\u30F6）に変換
  normalized = normalized.replace(/[\u3041-\u3096]/g, (char) => {
    const code = char.charCodeAt(0);
    if (code >= 0x3041 && code <= 0x3096) {
      return String.fromCharCode(code + 0x60);
    }
    return char;
  });

  // 空白文字を除去（検索の柔軟性向上）
  return normalized.replace(/\s+/g, "");
}

/**
 * Gmailの返信URLを生成
 */
export function buildGmailReplyLink(gmailLink: string, threadId: string): string {
  // gmailLinkからbase URLを抽出（#の前まで）
  const hashIndex = gmailLink.indexOf("#");
  const base = hashIndex >= 0 ? gmailLink.substring(0, hashIndex) : gmailLink;
  // threadIdを使って返信URLを生成
  return `${base}#inbox/${threadId}#reply`;
}

/**
 * Gmailの転送URLを生成
 */
export function buildGmailForwardLink(gmailLink: string, threadId: string): string {
  const hashIndex = gmailLink.indexOf("#");
  const base = hashIndex >= 0 ? gmailLink.substring(0, hashIndex) : gmailLink;
  return `${base}#inbox/${threadId}#forward`;
}





