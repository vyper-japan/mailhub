"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { InboxListMessage, MessageDetail } from "@/lib/mailhub-types";
import type { LabelGroup, LabelItem } from "@/lib/labels";
import { routeReply } from "@/lib/replyRouter";
import { extractInquiryNumber } from "@/lib/rakuten/extract";
import { getChannelById, type ChannelId } from "@/lib/channels";
import { 
  Inbox, CheckCircle, Clock, User, Undo2, 
  Search, Command, RefreshCw, ExternalLink, 
  HelpCircle, ArrowUp, ArrowDown, CornerUpLeft,
  LogOut, Mail, Copy, Send
} from 'lucide-react';

type Props = {
  initialLabelId: string;
  initialChannelId: ChannelId;
  labelGroups: LabelGroup[];
  initialMessages: InboxListMessage[];
  initialSelectedId: string | null;
  initialSelectedMessage: InboxListMessage | null;
  initialDetail: MessageDetail | null;
  user: {
    email: string;
    name: string;
  };
  logoutAction: () => Promise<void>;
  testMode: boolean;
  listError: string | null;
};

// コンセプト D のクラス定義を移植
const t = {
  bg: 'bg-[#0f172a] text-[#cbd5e1]', 
  layout: 'h-screen flex overflow-hidden',
  
  // サイドバー
  sidebar: 'w-60 bg-[#0f172a] flex flex-col border-r border-slate-800',
  sidebarItem: 'flex items-center justify-between px-3 py-2 mx-2 text-sm text-slate-400 rounded-lg hover:bg-slate-800/50 transition-colors cursor-pointer font-medium group',
  sidebarItemActive: 'bg-[#1e293b] shadow-lg shadow-black/20 text-blue-400 ring-1 ring-slate-700',
  sidebarHeader: 'px-4 py-2 mt-4 text-xs font-bold text-slate-500 uppercase tracking-wider',
  
  // トップバー
  topbar: 'h-14 border-b border-slate-800 flex items-center justify-between px-4 bg-[#0f172a]',
  topbarInputWrapper: 'relative w-full max-w-lg mx-4',
  topbarInput: 'w-full bg-[#1e293b] border border-slate-700 text-slate-200 text-sm rounded-md px-9 py-1.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all placeholder-slate-500',
  topbarButton: 'flex items-center gap-2 px-2 py-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-md transition-all text-xs font-medium group',
  topbarShortcut: 'hidden group-hover:inline-block ml-1 text-[10px] text-slate-600 border border-slate-700 px-1 rounded bg-slate-900',

  // メインエリア
  mainArea: 'flex-1 flex bg-[#0f172a] p-4 gap-4 overflow-hidden',

  // リストカラム
  listColumn: 'w-80 flex flex-col bg-[#1e293b] rounded-2xl shadow-xl shadow-black/20 overflow-hidden border border-slate-700/50',
  listItem: 'px-4 py-3 border-b border-slate-700/50 hover:bg-[#334155]/30 cursor-pointer transition-colors group',
  listItemActive: 'bg-[#334155]/50 border-l-4 border-blue-500 pl-3',
  
  // 詳細カラム
  detailColumn: 'flex-1 flex flex-col bg-[#1e293b] rounded-2xl shadow-xl shadow-black/20 overflow-hidden border border-slate-700/50',
  detailHeader: 'h-16 border-b border-slate-700/50 flex items-center justify-between px-6 bg-[#1e293b]/90 backdrop-blur sticky top-0 z-10',
  
  // ボタン・その他
  buttonPrimary: 'bg-blue-600 text-white hover:bg-blue-500 px-4 py-2 rounded-full text-sm font-medium shadow-lg shadow-blue-900/20 transition-all flex items-center gap-2',
  buttonIcon: 'p-2 text-slate-400 hover:bg-slate-700 hover:text-slate-200 rounded-full transition-colors',
  badge: 'bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full text-[10px] font-bold',
};

function shortSnippet(s: string, max = 120): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max)}…`;
}

/**
 * 検索用の文字列正規化（大文字小文字・全角半角・ひらがなカタカナを統一）
 */
function normalizeForSearch(text: string | null | undefined): string {
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

function updateUrl(label: string, id: string | null) {
  const params = new URLSearchParams(window.location.search);
  params.set("label", label);
  if (id) params.set("id", id);
  else params.delete("id");
  const newUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(null, "", newUrl);
}

/**
 * Gmailの返信URLを生成
 */
function buildGmailReplyLink(gmailLink: string, threadId: string): string {
  // gmailLinkからbase URLを抽出（#の前まで）
  const hashIndex = gmailLink.indexOf("#");
  const base = hashIndex >= 0 ? gmailLink.substring(0, hashIndex) : gmailLink;
  // threadIdを使って返信URLを生成
  return `${base}#inbox/${threadId}#reply`;
}

/**
 * Gmailの転送URLを生成
 */
function buildGmailForwardLink(gmailLink: string, threadId: string): string {
  const hashIndex = gmailLink.indexOf("#");
  const base = hashIndex >= 0 ? gmailLink.substring(0, hashIndex) : gmailLink;
  return `${base}#inbox/${threadId}#forward`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
}

export default function InboxShell({
  initialLabelId,
  initialChannelId,
  labelGroups,
  initialMessages,
  initialSelectedId,
  initialSelectedMessage,
  initialDetail,
  user,
  logoutAction,
  testMode,
  listError: serverListError,
}: Props) {
  const [labelId, setLabelId] = useState<string>(initialLabelId);
  const [channelId, setChannelId] = useState<ChannelId>(initialChannelId);
  const [messages, setMessages] = useState<InboxListMessage[]>(initialMessages);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [selectedMessage, setSelectedMessage] = useState<InboxListMessage | null>(
    initialSelectedMessage,
  );
  const [detailBody, setDetailBody] = useState<{
    plainTextBody: string | null;
    bodyNotice: string | null;
    isLoading: boolean;
  }>(() => ({
    plainTextBody: initialDetail?.plainTextBody ?? null,
    bodyNotice: initialDetail?.bodyNotice ?? null,
    isLoading: false,
  }));
  const [listError, setListError] = useState<string | null>(serverListError);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isClaimedMap, setIsClaimedMap] = useState<Record<string, boolean>>({});
  const [searchTerm, setSearchTerm] = useState("");

  // リサイズ機能の状態
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [listWidth, setListWidth] = useState(340);
  const [resizing, setResizing] = useState<"sidebar" | "list" | null>(null);

  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Undoスタック（複数の操作をUndoできるように）
  const [undoStack, setUndoStack] = useState<Array<{
    id: string;
    message: InboxListMessage;
    action: "archive" | "setWaiting" | "unsetWaiting";
  }>>([]);

  const [showShortcutHelp, setShowShortcutHelp] = useState(false);

  const [statusCounts, setStatusCounts] = useState<{
    todo: number;
    waiting: number;
    done: number;
  } | null>(null);

  // 返信パネルの状態
  const [replyInquiryNumber, setReplyInquiryNumber] = useState("");
  const [replyMessage, setReplyMessage] = useState("");
  const [isSendingReply, setIsSendingReply] = useState(false);

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    const defaults: Record<string, boolean> = {};
    for (const group of labelGroups) {
      defaults[group.id] = group.defaultCollapsed ?? false;
    }
    return defaults;
  });

  const listRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightIdRef = useRef<string | null>(null);

  const activeLabel = useMemo((): LabelItem | null => {
    for (const group of labelGroups) {
      const hit = group.items.find((item) => item.id === labelId);
      if (hit) return hit;
    }
    return labelGroups[0]?.items[0] ?? null;
  }, [labelId, labelGroups]);

  const filteredMessages = useMemo(() => {
    if (!searchTerm) return messages;
    const normalizedQuery = normalizeForSearch(searchTerm);
    return messages.filter((m) => {
      const normalizedSubject = m.subject ? normalizeForSearch(m.subject) : "";
      const normalizedFrom = m.from ? normalizeForSearch(m.from) : "";
      const normalizedSnippet = m.snippet ? normalizeForSearch(m.snippet) : "";
      return (
        normalizedSubject.includes(normalizedQuery) ||
        normalizedFrom.includes(normalizedQuery) ||
        normalizedSnippet.includes(normalizedQuery)
      );
    });
  }, [messages, searchTerm]);

  useEffect(() => {
    const saved = window.localStorage.getItem("mailhub:collapsedGroups");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Record<string, boolean>;
        setCollapsedGroups((prev) => ({ ...prev, ...parsed }));
      } catch {
        // ignore
      }
    }
  }, []);

  const toggleGroupCollapsed = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [groupId]: !prev[groupId] };
      window.localStorage.setItem("mailhub:collapsedGroups", JSON.stringify(next));
      return next;
    });
  }, []);

  useEffect(() => {
    updateUrl(labelId, selectedId);
    // labelIdからchannelIdを更新（URLから直接開いた場合の対応）
    if (labelId === "store-a" || labelId === "store-b" || labelId === "store-c") {
      setChannelId(labelId as ChannelId);
    } else {
      setChannelId("all");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetch("/api/mailhub/counts", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { counts: { todo: number; waiting: number; done: number } };
        setStatusCounts(data.counts);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  const loadDetailBodyOnly = useCallback(async (id: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    inFlightIdRef.current = id;

    setDetailError(null);
    setDetailBody((b) => ({ ...b, isLoading: true }));

    try {
      const res = await fetch(`/api/mailhub/detail?id=${encodeURIComponent(id)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status} ${res.statusText}: ${text}`);
      }
      const data = (await res.json()) as { detail: MessageDetail };
      if (inFlightIdRef.current !== id) return;

      setDetailBody({
        plainTextBody: data.detail.plainTextBody,
        bodyNotice: data.detail.bodyNotice,
        isLoading: false,
      });
      if (data.detail.isInProgress !== undefined) {
        setIsClaimedMap((prev) => ({ ...prev, [id]: data.detail.isInProgress ?? false }));
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setDetailError(e instanceof Error ? e.message : String(e));
      setDetailBody((b) => ({ ...b, isLoading: false }));
    }
  }, []);

  // 返信ルートを判定
  const replyRoute = useMemo(() => {
    if (!selectedMessage || !detailBody.plainTextBody) return null;
    const detail: MessageDetail = {
      ...selectedMessage,
      plainTextBody: detailBody.plainTextBody,
      bodyNotice: detailBody.bodyNotice,
    };
    return routeReply(detail, channelId);
  }, [selectedMessage, detailBody.plainTextBody, detailBody.bodyNotice, channelId]);

  // 問い合わせ番号を自動抽出
  useEffect(() => {
    if (replyRoute?.kind === "rakuten_rms" && detailBody.plainTextBody) {
      const extracted = extractInquiryNumber(detailBody.plainTextBody);
      if (extracted) {
        setReplyInquiryNumber(extracted);
      }
    } else {
      setReplyInquiryNumber("");
    }
  }, [replyRoute, detailBody.plainTextBody]);

  const onSelectMessage = useCallback((id: string) => {
    if (id === selectedId) return;
    setSelectedId(id);
    setSelectedMessage(messages.find((m) => m.id === id) ?? null);
    setDetailBody({ plainTextBody: null, bodyNotice: null, isLoading: true });
    setDetailError(null);
    setReplyMessage(""); // 返信メッセージをリセット
    updateUrl(labelId, id);

    void loadDetailBodyOnly(id);
  }, [selectedId, messages, labelId, loadDetailBodyOnly]);

  const handleMoveSelection = useCallback((direction: "up" | "down") => {
    if (filteredMessages.length === 0) return;
    const currentIndex = filteredMessages.findIndex((m) => m.id === selectedId);
    let nextIndex = 0;
    if (direction === "up") {
      nextIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
    } else {
      nextIndex = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, filteredMessages.length - 1);
    }
    const nextMessage = filteredMessages[nextIndex];
    if (nextMessage && nextMessage.id !== selectedId) {
      onSelectMessage(nextMessage.id);
      setTimeout(() => {
        const row = document.querySelector(`[data-message-id="${nextMessage.id}"]`);
        row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }, 0);
    }
  }, [filteredMessages, selectedId, onSelectMessage]);

  const loadList = useCallback(async (nextLabelId: string, preferredSelectedId: string | null) => {
    setListError(null);
    const data = await fetchJson<{ label: string; messages: InboxListMessage[] }>(
      `/api/mailhub/list?label=${encodeURIComponent(nextLabelId)}&max=20`,
    );
    setMessages(data.messages);

    const nextSelected =
      preferredSelectedId && data.messages.some((m) => m.id === preferredSelectedId)
        ? preferredSelectedId
        : data.messages[0]?.id ?? null;
    setSelectedId(nextSelected);
    setSelectedMessage(
      nextSelected ? data.messages.find((m) => m.id === nextSelected) ?? null : null,
    );
    updateUrl(nextLabelId, nextSelected);
    if (nextSelected) {
      void loadDetailBodyOnly(nextSelected);
    } else {
      setDetailBody({ plainTextBody: null, bodyNotice: null, isLoading: false });
    }
  }, [loadDetailBodyOnly]);

  const onSelectLabel = useCallback((item: LabelItem) => {
    if (item.id === labelId) return;
    setLabelId(item.id);
    
    // channelIdを更新（labelIdから推測）
    if (item.id === "store-a" || item.id === "store-b" || item.id === "store-c") {
      setChannelId(item.id as ChannelId);
    } else {
      setChannelId("all");
    }
    
    updateUrl(item.id, null);
    
    startTransition(async () => {
      try {
        await loadList(item.id, null);
        listRef.current?.scrollTo({ top: 0 });
      } catch (e) {
        setListError(e instanceof Error ? e.message : String(e));
      }
    });
  }, [labelId, loadList]);

  const reloadCurrentList = useCallback(() => {
    startTransition(async () => {
      try {
        await loadList(labelId, selectedId);
        fetchCounts();
      } catch (e) {
        setListError(e instanceof Error ? e.message : String(e));
      }
    });
  }, [labelId, selectedId, loadList, fetchCounts]);

  const showToast = useCallback((
    message: string,
    type: "success" | "error",
  ) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
    }, 10000);
  }, []);

  const addToUndoStack = useCallback((item: {
    id: string;
    message: InboxListMessage;
    action: "archive" | "setWaiting" | "unsetWaiting";
  }) => {
    setUndoStack((prev) => [item, ...prev].slice(0, 10)); // 最大10件まで保持
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast(null);
  }, []);

  const handleArchive = useCallback(async (id: string) => {
    const targetMessage = messages.find((m) => m.id === id);
    if (!targetMessage) return;

    const previousMessages = [...messages];
    const newMessages = messages.filter((m) => m.id !== id);
    setMessages(newMessages);

    const currentIndex = previousMessages.findIndex((m) => m.id === id);
    const nextMessage = newMessages[currentIndex] ?? newMessages[currentIndex - 1] ?? newMessages[0];
    if (nextMessage) {
      onSelectMessage(nextMessage.id);
    } else {
      setSelectedId(null);
      setSelectedMessage(null);
      setDetailBody({ plainTextBody: null, bodyNotice: null, isLoading: false });
      updateUrl(labelId, null);
    }

    try {
      const res = await fetch("/api/mailhub/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "archive" }),
      });
      if (!res.ok) {
        throw new Error(`Archive failed: ${res.status}`);
      }
      addToUndoStack({ id, message: targetMessage, action: "archive" });
      showToast("完了しました", "success");
      fetchCounts();
    } catch (e) {
      setMessages(previousMessages);
      setSelectedId(id);
      setSelectedMessage(targetMessage);
      showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }, [messages, labelId, onSelectMessage, showToast, fetchCounts, addToUndoStack]);

  const handleSetWaiting = useCallback(async (id: string) => {
    const targetMessage = messages.find((m) => m.id === id);
    if (!targetMessage) return;

    // 現在の状態が Waiting かどうかを確認
    const isCurrentlyWaiting = activeLabel?.statusType === "waiting";
    const action = isCurrentlyWaiting ? "unsetWaiting" : "setWaiting";

    const previousMessages = [...messages];
    const newMessages = messages.filter((m) => m.id !== id);
    setMessages(newMessages);

    const currentIndex = previousMessages.findIndex((m) => m.id === id);
    const nextMessage = newMessages[currentIndex] ?? newMessages[currentIndex - 1] ?? newMessages[0];
    if (nextMessage) {
      onSelectMessage(nextMessage.id);
    } else {
      setSelectedId(null);
      setSelectedMessage(null);
      setDetailBody({ plainTextBody: null, bodyNotice: null, isLoading: false });
      updateUrl(labelId, null);
    }

    try {
      const res = await fetch("/api/mailhub/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      if (!res.ok) {
        throw new Error(`${action} failed: ${res.status}`);
      }
      addToUndoStack({ 
        id, 
        message: targetMessage, 
        action: isCurrentlyWaiting ? "unsetWaiting" : "setWaiting" 
      });
      showToast(isCurrentlyWaiting ? "Todoに戻しました" : "保留にしました", "success");
      fetchCounts();
    } catch (e) {
      setMessages(previousMessages);
      setSelectedId(id);
      setSelectedMessage(targetMessage);
      showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }, [messages, labelId, activeLabel, onSelectMessage, showToast, fetchCounts, addToUndoStack]);

  const handleToggleClaimed = useCallback(async (id: string) => {
    const currentlyClaimed = isClaimedMap[id] ?? false;
    const nextStatus = !currentlyClaimed;

    // 楽観的更新
    setIsClaimedMap((prev) => ({ ...prev, [id]: nextStatus }));

    try {
      const res = await fetch("/api/mailhub/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "toggleInProgress" }),
      });
      if (!res.ok) {
        throw new Error(`Toggle InProgress failed: ${res.status}`);
      }
    } catch (e) {
      // 失敗時は戻す
      setIsClaimedMap((prev) => ({ ...prev, [id]: currentlyClaimed }));
      showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }, [isClaimedMap, showToast]);

  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0) return;
    
    // スタックから最新の操作を取り出す
    const latestUndo = undoStack[0];
    const { id, message, action } = latestUndo;
    
    // スタックから削除
    setUndoStack((prev) => prev.slice(1));

    // メッセージをリストに戻す
    setMessages((prev) => {
      // 既に存在する場合は追加しない
      if (prev.some((m) => m.id === id)) return prev;
      return [message, ...prev];
    });
    onSelectMessage(id);

    try {
      // actionに応じて適切なAPIを呼ぶ
      let apiAction: string;
      if (action === "archive") {
        apiAction = "unarchive";
      } else if (action === "setWaiting") {
        apiAction = "unsetWaiting";
      } else if (action === "unsetWaiting") {
        apiAction = "setWaiting";
      } else {
        throw new Error(`Unknown action: ${action}`);
      }

      const endpoint = action === "archive" ? "/api/mailhub/archive" : "/api/mailhub/status";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: apiAction }),
      });
      if (!res.ok) {
        throw new Error(`Undo failed: ${res.status}`);
      }
      showToast("元に戻しました", "success");
      fetchCounts();
    } catch (e) {
      // エラー時はスタックに戻す
      setUndoStack((prev) => [latestUndo, ...prev]);
      showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
      reloadCurrentList();
    }
  }, [undoStack, onSelectMessage, showToast, fetchCounts, reloadCurrentList]);

  // 楽天RMS返信の送信
  const handleRakutenReply = useCallback(async () => {
    if (!selectedMessage || !replyRoute || replyRoute.kind !== "rakuten_rms" || !replyInquiryNumber || !replyMessage.trim()) {
      return;
    }

    setIsSendingReply(true);
    try {
      const res = await fetch("/api/mailhub/rakuten/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: replyRoute.storeId,
          inquiryNumber: replyInquiryNumber,
          message: replyMessage,
          emailId: selectedMessage.id,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        showToast("RMSへ返信を登録しました", "success");
        // 返信後はWaitingに設定（運用ルール）
        if (selectedMessage.id) {
          await handleSetWaiting(selectedMessage.id);
        }
        setReplyMessage(""); // 返信メッセージをクリア
      } else if (data.fallback) {
        // API未設定の場合はフォールバック案内
        showToast("RMS APIが設定されていません。RMSを開いて手動で返信してください。", "error");
      } else {
        throw new Error(data.error || "返信に失敗しました");
      }
    } catch (e) {
      showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setIsSendingReply(false);
    }
  }, [selectedMessage, replyRoute, replyInquiryNumber, replyMessage, showToast, handleSetWaiting]);

  // 返信内容をコピー
  const handleCopyReply = useCallback(async () => {
    const textToCopy = replyMessage || "";
    if (!textToCopy) return;

    try {
      await navigator.clipboard.writeText(textToCopy);
      showToast("返信内容をコピーしました", "success");
    } catch (e) {
      showToast("コピーに失敗しました", "error");
    }
  }, [replyMessage, showToast]);

  // 問い合わせ番号をコピー
  const handleCopyInquiryNumber = useCallback(async () => {
    if (!replyInquiryNumber) return;

    try {
      await navigator.clipboard.writeText(replyInquiryNumber);
      showToast("問い合わせ番号をコピーしました", "success");
    } catch (e) {
      showToast("コピーに失敗しました", "error");
    }
  }, [replyInquiryNumber, showToast]);

  // RMSを開くURLを生成（暫定: 実際のRMS URLは要確認）
  const getRmsUrl = useCallback((storeId: string, inquiryNumber: string) => {
    // TODO: 実際のRMS URLに置き換える
    // 例: https://rms.rakuten.co.jp/inquiry/{inquiryNumber}
    return `https://rms.rakuten.co.jp/inquiry/${inquiryNumber}`;
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      
      if (isInput) {
        if (e.key === "Escape") {
          e.preventDefault();
          setSearchTerm("");
          target.blur();
        }
        return;
      }

      if (showShortcutHelp) {
        if (e.key === "Escape") { e.preventDefault(); setShowShortcutHelp(false); }
        return;
      }

      // Cmd+K or Ctrl+K for search
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        const searchInput = document.querySelector('input[type="text"]') as HTMLInputElement;
        searchInput?.focus();
        return;
      }

      switch (e.key) {
        case "ArrowUp": {
          e.preventDefault();
          handleMoveSelection("up");
          break;
        }
        case "ArrowDown": {
          e.preventDefault();
          handleMoveSelection("down");
          break;
        }
        case "e": case "E": {
          e.preventDefault();
          if (selectedId) handleArchive(selectedId);
          break;
        }
        case "w": case "W": {
          e.preventDefault();
          if (selectedId) handleSetWaiting(selectedId);
          break;
        }
        case "c": case "C": {
          e.preventDefault();
          if (selectedId) handleToggleClaimed(selectedId);
          break;
        }
        case "u": case "U": {
          e.preventDefault();
          handleUndo();
          break;
        }
        case "?": {
          e.preventDefault();
          setShowShortcutHelp(true);
          break;
        }
        case "/": {
          if (e.shiftKey) { e.preventDefault(); setShowShortcutHelp(true); }
          break;
        }
        case "Escape": {
          e.preventDefault();
          setShowShortcutHelp(false);
          break;
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, showShortcutHelp, handleMoveSelection, handleArchive, handleSetWaiting, handleToggleClaimed, handleUndo]);

  // リサイズロジック
  const startResizing = useCallback((type: "sidebar" | "list") => {
    setResizing(type);
  }, []);

  const stopResizing = useCallback(() => {
    setResizing(null);
  }, []);

  const resize = useCallback((e: MouseEvent) => {
    if (resizing === "sidebar") {
      const newWidth = Math.min(Math.max(e.clientX, 160), 480);
      setSidebarWidth(newWidth);
    } else if (resizing === "list") {
      const sidebarAndPadding = sidebarWidth + 16; // sidebar + main area padding
      const newWidth = Math.min(Math.max(e.clientX - sidebarAndPadding, 240), 640);
      setListWidth(newWidth);
    }
  }, [resizing, sidebarWidth]);

  useEffect(() => {
    if (resizing) {
      window.addEventListener("mousemove", resize);
      window.addEventListener("mouseup", stopResizing);
      // リサイズ中のテキスト選択を防止
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    } else {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [resizing, resize, stopResizing]);

  return (
    <div className={`w-full h-screen ${t.bg} flex flex-col font-sans`}>
      <div className="flex-1 flex overflow-hidden">
        {/* --- 左サイドバー --- */}
        <aside 
          className={t.sidebar}
          style={{ width: sidebarWidth }}
        >
          <div className="p-4 h-14 flex items-center">
            <div className="flex items-center gap-2 font-bold text-lg tracking-tight text-slate-200">
              <Inbox size={20} className="text-blue-400" />
              <span>MailHub</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto py-2">
            {labelGroups.map((group) => (
              <div key={group.id} className="mb-6" data-testid={group.id === "channels" ? "label-channels" : group.id === "status" ? "label-status" : undefined}>
                <div className={t.sidebarHeader}>{group.label}</div>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const isActive = item.id === labelId;
                    const Icon = item.statusType === "waiting" ? Clock : item.statusType === "done" ? CheckCircle : null;
                    
                    let count: number | null = null;
                    if (item.statusType === "todo" && statusCounts) count = statusCounts.todo;
                    if (item.statusType === "waiting" && statusCounts) count = statusCounts.waiting;
                    if (item.statusType === "done" && statusCounts) count = statusCounts.done;
                    if (item.type === "channel" && isActive) count = messages.length;

                    return (
                      <div 
                        key={item.id} 
                        data-testid={`label-item-${item.id}`}
                        onClick={() => onSelectLabel(item)}
                        className={`${t.sidebarItem} ${isActive ? t.sidebarItemActive : ""}`}
                      >
                        <span className="flex items-center gap-2">
                          {item.type === "channel" && (
                            <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.5)]' : 'bg-white/20'}`}></span>
                          )}
                          {Icon && <Icon size={14} className={isActive ? "text-blue-400" : ""} />}
                          {item.label}
                        </span>
                        {count !== null && count > 0 && <span className={t.badge}>{count}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          
          <div className="p-4 border-t border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white shadow-lg shadow-blue-900/20">
                {user.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-slate-300 truncate text-xs">{user.name}</div>
                <div className="opacity-60 text-[10px] truncate">{user.email}</div>
              </div>
              {!testMode && (
                <form action={logoutAction}>
                  <button type="submit" className="p-1 text-slate-500 hover:text-red-400 transition-colors cursor-pointer" title="ログアウト">
                    <LogOut size={14} />
                  </button>
                </form>
              )}
            </div>
          </div>
        </aside>

        {/* サイドバーリサイザー */}
        <div 
          className="w-1 cursor-col-resize hover:bg-blue-500/30 transition-colors active:bg-blue-500/50 z-20"
          onMouseDown={() => startResizing("sidebar")}
        />

        {/* --- 右側エリア (トップバー + メイン) --- */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          
          {/* トップバー (Actions & Search) */}
          <header className={t.topbar} data-testid="topbar">
            <div className="flex items-center gap-1">
              <button 
                data-testid="action-done"
                onClick={() => selectedId && handleArchive(selectedId)}
                className={t.topbarButton} 
                title="完了 (Archive)"
              >
                <CheckCircle size={18} className="text-slate-400 group-hover:text-green-400" />
                <span className="hidden lg:inline">Done</span>
                <span className={t.topbarShortcut}>E</span>
              </button>
              
              <button 
                data-testid="action-waiting"
                onClick={() => selectedId && handleSetWaiting(selectedId)}
                className={t.topbarButton} 
                title="保留 (Waiting)"
              >
                <Clock size={18} className="text-slate-400 group-hover:text-orange-400" />
                <span className="hidden lg:inline">Later</span>
                <span className={t.topbarShortcut}>W</span>
              </button>

              <button 
                className={`${t.topbarButton} ${selectedId && isClaimedMap[selectedId] ? 'bg-indigo-500/10 text-indigo-400' : ''}`}
                onClick={() => selectedId && handleToggleClaimed(selectedId)}
                title="対応中 (Claim)"
              >
                <User size={18} className={selectedId && isClaimedMap[selectedId] ? "text-indigo-400" : "text-slate-400 group-hover:text-indigo-400"} />
                <span className={selectedId && isClaimedMap[selectedId] ? "text-indigo-400 font-bold" : "hidden lg:inline"}>
                  {selectedId && isClaimedMap[selectedId] ? "Claimed" : "Claim"}
                </span>
                <span className={t.topbarShortcut}>C</span>
              </button>

              <div className="w-px h-5 bg-slate-800 mx-2"></div>

              <button 
                data-testid="action-undo"
                onClick={handleUndo}
                className={t.topbarButton} 
                disabled={undoStack.length === 0}
                title={`取り消し (Undo)${undoStack.length > 0 ? ` - ${undoStack.length}件` : ""}`}
              >
                <Undo2 size={18} />
                <span className={t.topbarShortcut}>U</span>
                {undoStack.length > 0 && (
                  <span className="ml-1 text-[10px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded font-bold">
                    {undoStack.length}
                  </span>
                )}
              </button>
            </div>

            <div className={t.topbarInputWrapper}>
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input 
                type="text" 
                data-testid="topbar-search"
                placeholder="Search mail... (Cmd+K)" 
                className={t.topbarInput}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 h-5 text-[10px] font-medium text-slate-500 bg-slate-800 border border-slate-700 rounded font-mono uppercase text-[10px]">
                  <Command size={10} />K
                </kbd>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button 
                data-testid="topbar-refresh"
                onClick={reloadCurrentList}
                className={t.topbarButton} 
                title="更新 (Refresh)"
              >
                <RefreshCw size={16} className={isPending ? "animate-spin" : ""} />
                <span className={t.topbarShortcut}>R</span>
              </button>
              
              <a 
                href={selectedMessage?.gmailLink ?? "#"} 
                target="_blank" 
                rel="noopener noreferrer"
                className={t.topbarButton} 
                title="Gmailで開く"
              >
                <ExternalLink size={16} />
              </a>

              <button 
                onClick={() => setShowShortcutHelp(true)}
                className={t.topbarButton} 
                title="ショートカット一覧"
              >
                <HelpCircle size={16} />
                <span className={t.topbarShortcut}>?</span>
              </button>
            </div>
          </header>

          {/* メインエリア (リスト + 詳細) */}
          <main className={t.mainArea}>
            {/* メール一覧 */}
            <div 
              className={t.listColumn}
              style={{ width: listWidth }}
            >
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {listError ? (
                  <div className="p-8 text-center space-y-3">
                    <div className="text-red-400/80 text-sm font-medium">リストを取得できませんでした</div>
                    <button onClick={reloadCurrentList} className="px-4 py-2 bg-slate-800 text-slate-300 rounded-full text-xs font-bold hover:bg-slate-700 transition-colors">再試行</button>
                  </div>
                ) : filteredMessages.length === 0 && !isPending ? (
                  <div className="flex-1 flex items-center justify-center p-8 text-slate-500 text-sm font-medium" data-testid={searchTerm ? undefined : "zero-inbox"}>
                    {searchTerm ? "見つかりませんでした" : "メールはありません"}
                  </div>
                ) : (
                  <div className="divide-y divide-slate-700/30" data-testid="message-list">
                    {filteredMessages.map((mail) => {
                      const isActive = selectedId === mail.id;
                      const textPrimary = isActive ? 'text-white' : 'text-slate-200';
                      const textSecondary = isActive ? 'text-blue-200' : 'text-slate-400';
                      const isClaimed = isClaimedMap[mail.id] ?? false;
                      
                      return (
                        <div 
                          key={mail.id}
                          data-message-id={mail.id}
                          data-testid={isActive ? "message-row-selected" : "message-row"}
                          onClick={() => onSelectMessage(mail.id)}
                          className={`${t.listItem} ${isActive ? t.listItemActive : ""}`}
                        >
                          <div className="flex justify-between items-baseline mb-1">
                            <div className={`text-xs font-medium truncate max-w-[70%] ${textSecondary} flex items-center gap-1.5`}>
                              {isClaimed && (
                                <span title="対応中">
                                  <User size={12} className="text-indigo-400 flex-shrink-0" />
                                </span>
                              )}
                              {mail.from}
                            </div>
                            <div className={`text-[10px] ${textSecondary}`}>
                              {mail.receivedAt.split(' ')[1]}
                            </div>
                          </div>
                          <div className={`text-sm font-bold mb-1 truncate ${textPrimary} flex items-center gap-1.5`}>
                            {mail.subject ?? "(no subject)"}
                          </div>
                          <div className={`text-xs truncate ${isActive ? 'text-blue-200/70' : 'text-slate-500'}`}>
                            {mail.snippet}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* リストリサイザー */}
            <div 
              className="w-1 cursor-col-resize hover:bg-blue-500/30 transition-colors active:bg-blue-500/50 z-20 -mx-2"
              onMouseDown={() => startResizing("list")}
            />

            {/* 詳細表示 */}
            <div className={t.detailColumn} data-testid="detail-pane">
              {!selectedMessage ? (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-600 space-y-4">
                  <Mail className="w-12 h-12 opacity-10" />
                  <span className="text-sm font-medium opacity-40">メールを選択してください</span>
                </div>
              ) : (
                <>
                  <header className={t.detailHeader}>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => handleMoveSelection("up")}
                        className={t.buttonIcon}
                      >
                        <ArrowUp size={18} />
                      </button>
                      <button 
                        onClick={() => handleMoveSelection("down")}
                        className={t.buttonIcon}
                      >
                        <ArrowDown size={18} />
                      </button>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-500">{activeLabel?.label ?? "Inbox"}</span>
                      {selectedId && isClaimedMap[selectedId] && (
                        <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded border border-indigo-500/30 flex items-center gap-1 font-bold">
                          <User size={10} /> IN PROGRESS
                        </span>
                      )}
                    </div>
                  </header>

                  <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
                    <div className="max-w-3xl mx-auto">
                      <div className="mb-8">
                        <div className="flex items-center gap-3 mb-4">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-blue-400 border border-slate-700 uppercase tracking-widest">SHOP-A</span>
                          <span className="text-xs text-slate-500">Today at {selectedMessage.receivedAt.split(' ')[1]}</span>
                        </div>
                        <h1 className="text-2xl font-bold mb-4 text-slate-100 leading-tight" data-testid="detail-subject">{selectedMessage.subject ?? "(no subject)"}</h1>
                        <div className="flex items-center gap-3 text-sm border-y border-slate-700/30 py-4">
                          <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center font-bold text-white border border-slate-700/50">
                            {selectedMessage.from?.[0]?.toUpperCase() ?? "?"}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-200">{selectedMessage.from?.split('<')[0].trim()}</span>
                              <span className="text-xs text-slate-500 hidden sm:inline">&lt;{selectedMessage.from?.split('<')[1]}</span>
                            </div>
                            <div className="text-[11px] text-slate-500 font-medium">共用受信箱 宛</div>
                          </div>
                        </div>
                      </div>

                      <div className="relative">
                        {detailBody.isLoading ? (
                          <div className="space-y-4" data-testid="detail-skeleton">
                             <div className="h-4 bg-slate-800 rounded w-3/4 animate-pulse" />
                             <div className="h-4 bg-slate-800 rounded w-1/2 animate-pulse" />
                             <div className="h-4 bg-slate-800 rounded w-2/3 animate-pulse" />
                          </div>
                        ) : detailError ? (
                          <div className="text-red-400 text-sm font-medium bg-red-900/10 p-4 rounded-xl border border-red-500/20">
                            本文の読み込みに失敗しました。
                          </div>
                        ) : (
                          <div className="prose max-w-none text-[15px] leading-loose whitespace-pre-wrap font-mono text-slate-300 selection:bg-blue-500/40">
                            {detailBody.plainTextBody || "本文がありません"}
                          </div>
                        )}
                      </div>
                      
                      <div className="mt-12 pt-12 border-t border-slate-800/50 flex flex-col gap-6">
                        <div className="flex gap-4">
                          {selectedMessage && selectedMessage.gmailLink && selectedMessage.threadId ? (
                            <>
                              <a
                                href={buildGmailReplyLink(selectedMessage.gmailLink, selectedMessage.threadId)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={t.buttonPrimary}
                              >
                                <CornerUpLeft size={14} /> Reply
                              </a>
                              <a
                                href={buildGmailForwardLink(selectedMessage.gmailLink, selectedMessage.threadId)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-4 py-2 rounded-md text-sm border border-slate-700 text-slate-400 hover:bg-slate-800 transition-colors font-medium"
                              >
                                Forward
                              </a>
                            </>
                          ) : (
                            <>
                              <button className={t.buttonPrimary} disabled>
                                <CornerUpLeft size={14} /> Reply
                              </button>
                              <button className="px-4 py-2 rounded-md text-sm border border-slate-700 text-slate-400 hover:bg-slate-800 transition-colors font-medium" disabled>
                                Forward
                              </button>
                            </>
                          )}
                        </div>

                        {/* 返信パネル（楽天RMSの場合） */}
                        {replyRoute?.kind === "rakuten_rms" && (
                          <div className="mt-8 pt-8 border-t border-slate-800/50" data-testid="rakuten-panel">
                            <div className="bg-slate-800/30 rounded-xl p-6 border border-slate-700/50">
                              <div className="flex items-center gap-2 mb-4">
                                <span className="text-sm font-bold text-orange-400">楽天RMS返信</span>
                                <span className="text-xs text-slate-500">({replyRoute.storeId})</span>
                              </div>

                              {/* 問い合わせ番号 */}
                              <div className="mb-4">
                                <label className="block text-xs font-medium text-slate-400 mb-2">
                                  問い合わせ番号
                                </label>
                                <div className="flex gap-2">
                                  <input
                                    type="text"
                                    data-testid="rakuten-inquiry"
                                    value={replyInquiryNumber}
                                    onChange={(e) => setReplyInquiryNumber(e.target.value)}
                                    placeholder="問い合わせ番号を入力"
                                    className="flex-1 bg-[#1e293b] border border-slate-700 text-slate-200 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all"
                                  />
                                  {replyInquiryNumber && (
                                    <button
                                      onClick={handleCopyInquiryNumber}
                                      className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-md text-xs font-medium transition-colors flex items-center gap-1"
                                      title="問い合わせ番号をコピー"
                                    >
                                      <Copy size={14} />
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* 返信本文 */}
                              <div className="mb-4">
                                <label className="block text-xs font-medium text-slate-400 mb-2">
                                  返信内容
                                </label>
                                <textarea
                                  value={replyMessage}
                                  onChange={(e) => setReplyMessage(e.target.value)}
                                  placeholder="返信内容を入力してください"
                                  rows={6}
                                  className="w-full bg-[#1e293b] border border-slate-700 text-slate-200 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all resize-y font-mono"
                                />
                              </div>

                              {/* アクションボタン */}
                              <div className="flex gap-2 flex-wrap">
                                <button
                                  onClick={handleRakutenReply}
                                  disabled={!replyInquiryNumber || !replyMessage.trim() || isSendingReply}
                                  className="px-4 py-2 bg-orange-600 text-white hover:bg-orange-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed rounded-md text-sm font-medium transition-colors flex items-center gap-2"
                                >
                                  <Send size={14} />
                                  {isSendingReply ? "送信中..." : "送信（RMS）"}
                                </button>
                                <button
                                  onClick={handleCopyReply}
                                  disabled={!replyMessage.trim()}
                                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-slate-300 rounded-md text-sm font-medium transition-colors flex items-center gap-2"
                                >
                                  <Copy size={14} />
                                  コピー
                                </button>
                                {replyInquiryNumber && (
                                  <a
                                    href={getRmsUrl(replyRoute.storeId!, replyInquiryNumber)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-md text-sm font-medium transition-colors flex items-center gap-2"
                                  >
                                    <ExternalLink size={14} />
                                    RMSを開く
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="w-full h-px bg-gradient-to-r from-transparent via-slate-700/50 to-transparent" />
                        <div className="flex justify-center items-center gap-6 opacity-30">
                           <CheckCircle size={20} />
                           <div className="text-[10px] font-black uppercase tracking-[0.3em]">End of Thread</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </main>
        </div>
      </div>

      {/* ショートカットヘルプ */}
      {showShortcutHelp && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0f172a]/90 backdrop-blur-sm p-4" onClick={() => setShowShortcutHelp(false)}>
          <div className="w-full max-w-sm bg-[#1e293b] rounded-2xl shadow-2xl border border-slate-700/50 p-8" onClick={(e) => e.stopPropagation()} data-testid="shortcut-help">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-xl font-black text-white tracking-tight">Shortcuts</h3>
              <button onClick={() => setShowShortcutHelp(false)} className="p-1 hover:bg-slate-800 rounded-lg text-slate-500 hover:text-white transition-colors">
                 <LogOut className="w-5 h-5 rotate-180" />
              </button>
            </div>
            <div className="space-y-4">
              {[
                { keys: ["↑", "↓"], desc: "一覧で上下移動" },
                { keys: ["E"], desc: "完了（Done）" },
                { keys: ["W"], desc: "保留（Later）" },
                { keys: ["C"], desc: "対応中（Claim）" },
                { keys: ["U"], desc: "元に戻す（Undo）" },
                { keys: ["?"], desc: "ヘルプを表示" },
                { keys: ["Esc"], desc: "閉じる" },
              ].map((item, i) => (
                <div key={i} className="flex items-center justify-between gap-4 py-2 border-b border-slate-700/20 last:border-0">
                  <span className="text-sm font-medium text-slate-400">{item.desc}</span>
                  <div className="flex gap-1">
                    {item.keys.map((k, j) => (
                      <kbd key={j} className="px-2 py-1 bg-[#0f172a] border border-slate-800 rounded text-[10px] text-blue-400 font-bold font-sans shadow-sm ring-1 ring-slate-700/50">{k}</kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* トースト通知 */}
      {toast && (
        <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-4 px-6 py-3 rounded-2xl shadow-2xl backdrop-blur-xl border transition-all animate-in slide-in-from-bottom-4 duration-300 ${
          toast.type === "error" 
            ? "bg-red-500/20 border-red-500/30 text-red-200" 
            : "bg-blue-600 border-blue-400/30 text-white"
        }`}>
          <div className="flex items-center gap-3">
            {toast.type === "success" && <CheckCircle className="w-5 h-5" />}
            <span className="text-sm font-bold tracking-tight">{toast.message}</span>
          </div>
          {undoStack.length > 0 && (
            <button onClick={handleUndo} className="ml-2 px-3 py-1 bg-white/10 hover:bg-white/20 rounded-lg text-xs font-black uppercase tracking-widest transition-colors">
              Undo{undoStack.length > 1 ? ` (${undoStack.length})` : ""}
            </button>
          )}
          <button onClick={dismissToast} className="ml-2 p-1 hover:bg-black/10 rounded-full transition-colors opacity-60">
             <LogOut size={16} className="rotate-180" />
          </button>
        </div>
      )}
    </div>
  );
}
