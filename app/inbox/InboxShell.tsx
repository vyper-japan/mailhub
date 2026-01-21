"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { createPortal, flushSync } from "react-dom";
import DOMPurify from "dompurify";
import type { ChannelCounts, InboxListMessage, MessageDetail, StatusCounts } from "@/lib/mailhub-types";
import type { LabelGroup, LabelItem } from "@/lib/labels";
import type { ThreadMessageSummary } from "@/lib/thread";
import { routeReply } from "@/lib/replyRouter";
import { extractInquiryNumber } from "@/lib/rakuten/extract";
import { type ChannelId } from "@/lib/channels";
import { getTriageCandidates, type TriageContext } from "@/lib/triageRules";
import { assigneeSlug } from "@/lib/assignee";
import { fetchJson, postJsonOrThrow } from "./client-api";
import { buildGmailForwardLink, buildGmailReplyLink, normalizeForSearch, shortSnippet, t } from "./inbox-ui";
import { Sidebar } from "./components/Sidebar";
import { TopHeader } from "./components/TopHeader";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { DiagnosticsDrawer } from "./components/DiagnosticsDrawer";
import { HelpDrawer } from "./components/HelpDrawer";
import { HandoffDrawer } from "./components/HandoffDrawer";
import { ExplainDrawer } from "./components/ExplainDrawer";
import { OnboardingModal, shouldShowOnboarding } from "./components/OnboardingModal";
import { InternalOpsPane } from "./components/InternalOpsPane";
import { ViewsCommandPalette } from "./components/ViewsCommandPalette";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { AssigneeSelector } from "./components/AssigneeSelector";
import type { View } from "@/lib/views";
import { extractFromDomain, extractFromEmail } from "@/lib/labelRules";
import { 
  CheckCircle, Clock, Undo2, 
  ExternalLink, 
  ArrowUp, ArrowDown, CornerUpLeft,
  LogOut, Mail, Copy, Send, VolumeX, UserCheck, Square, Star, Tag, HelpCircle, Search,
  ChevronUp, ChevronDown, Users, X, AlertTriangle, RefreshCw, Activity, Settings, Zap
} from 'lucide-react';
import { formatElapsedTime, getElapsedMs, getElapsedColorTodo, getElapsedColorWaiting, getSlaLevel } from "@/lib/time-utils";
import { isBroadDomain } from "@/lib/ruleSafety";
import { buildMailhubLabelName } from "@/lib/mailhub-labels";

type DebugLabels = { labelIds: string[]; labelNames: Array<string | null> };
type DetailWithDebug = MessageDetail & { debugLabels?: DebugLabels };

type Props = {
  initialLabelId: string;
  initialChannelId: ChannelId;
  labelGroups: LabelGroup[];
  initialMessages: InboxListMessage[];
  initialSelectedId: string | null;
  initialSelectedMessage: InboxListMessage | null;
  initialDetail: MessageDetail | null;
  initialSearchQuery?: string;
  user: {
    email: string;
    name: string;
  };
  logoutAction: () => Promise<void>;
  testMode: boolean;
  mailhubEnv: "local" | "staging" | "production";
  debugMode: boolean;
  listError: string | null;
};

export default function InboxShell({
  initialLabelId,
  initialChannelId,
  labelGroups,
  initialMessages,
  initialSelectedId,
  initialSelectedMessage,
  initialDetail,
  initialSearchQuery = "",
  user,
  logoutAction,
  testMode,
  mailhubEnv,
  debugMode,
  listError: serverListError,
}: Props) {
  const getErrorStatus = (e: unknown): number | null => {
    if (!e || typeof e !== "object") return null;
    const status = (e as Record<string, unknown>).status;
    return typeof status === "number" ? status : null;
  };

  const pathname = usePathname();

  // 初回オンボーディング（localStorageで1回のみ）
  useEffect(() => {
    if (shouldShowOnboarding()) {
      setShowOnboarding(true);
    }
  }, []);

  const [labelId, setLabelId] = useState<string>(initialLabelId);
  const [channelId, setChannelId] = useState<ChannelId>(initialChannelId);
  const [messages, setMessages] = useState<InboxListMessage[]>(() => initialMessages);
  // Step 103: ページングトークン
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // Step 104: URLからmax値を取得（デフォルト20、1-50の範囲）
  const listMax = useMemo(() => {
    if (typeof window === "undefined") return 20;
    const params = new URLSearchParams(window.location.search);
    const maxParam = params.get("max");
    if (!maxParam) return 20;
    const n = parseInt(maxParam, 10);
    if (isNaN(n)) return 20;
    return Math.max(1, Math.min(50, n));
  }, []);
  // Step 105: Seen（自分の既読風）- localStorageで管理
  const SEEN_STORAGE_KEY = "mailhub-seen-ids";
  const seenIdsLoadedRef = useRef(false);
  const [seenIds, setSeenIds] = useState<Set<string>>(() => new Set()); // SSR/初期は空
  // マウント後にlocalStorageから読み込み
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem(SEEN_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as unknown;
        if (Array.isArray(parsed)) {
          setSeenIds(new Set(parsed.filter((v): v is string => typeof v === "string")));
        }
      }
    } catch {
      // ignore
    }
    seenIdsLoadedRef.current = true;
  }, []);
  const markAsSeen = useCallback((id: string) => {
    setSeenIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      // 最大500件に制限（古いものを削除）
      if (next.size > 500) {
        const arr = Array.from(next);
        const trimmed = arr.slice(arr.length - 500);
        return new Set(trimmed);
      }
      // 即座にlocalStorageに保存（refで制御）
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(Array.from(next)));
        } catch {
          // ignore
        }
      }
      return next;
    });
  }, []);
  // Step 64: Team View - 選択中のチームメンバーのassigneeSlug
  const [activeAssigneeSlug, setActiveAssigneeSlug] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      return params.get("assignee") || null;
    }
    return null;
  });
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [selectedMessage, setSelectedMessage] = useState<InboxListMessage | null>(
    initialSelectedMessage,
  );
  // Step 50拡張: initialDetailをキャッシュに保存（即座に表示できるように）
  useEffect(() => {
    if (initialDetail && initialSelectedId) {
      const message = initialMessages.find((m) => m.id === initialSelectedId) ?? initialSelectedMessage;
      detailCacheRef.current.set(initialSelectedId, {
        plainTextBody: initialDetail.plainTextBody,
        htmlBody: initialDetail.htmlBody,
        bodyNotice: initialDetail.bodyNotice,
        subject: initialDetail.subject ?? message?.subject ?? "",
        from: initialDetail.from ?? message?.from ?? "",
        fetchedAt: Date.now(),
        debugLabels: (initialDetail as DetailWithDebug).debugLabels,
      });
    }
  }, [initialDetail, initialSelectedId, initialMessages, initialSelectedMessage]);

  const [detailBody, setDetailBody] = useState<{
    plainTextBody: string | null;
    htmlBody: string | null;
    bodyNotice: string | null;
    isLoading: boolean;
    debugLabels?: { labelIds: string[]; labelNames: Array<string | null> };
  }>(() => ({
    plainTextBody: initialDetail?.plainTextBody ?? null,
    htmlBody: initialDetail?.htmlBody ?? null,
    bodyNotice: initialDetail?.bodyNotice ?? null,
    isLoading: false,
    debugLabels: (initialDetail as DetailWithDebug | null)?.debugLabels,
  }));

  const sanitizedHtmlBody = useMemo(() => {
    if (!detailBody.htmlBody) return "";
    return DOMPurify.sanitize(detailBody.htmlBody, {
      ALLOWED_TAGS: [
        "p",
        "br",
        "div",
        "span",
        "a",
        "b",
        "strong",
        "i",
        "em",
        "u",
        "ul",
        "ol",
        "li",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "table",
        "thead",
        "tbody",
        "tr",
        "td",
        "th",
        "img",
        "blockquote",
        "pre",
        "code",
        "hr",
        "center",
        "font",
      ],
      ALLOWED_ATTR: [
        "href",
        "src",
        "alt",
        "title",
        "style",
        "class",
        "width",
        "height",
        "border",
        "cellpadding",
        "cellspacing",
        "align",
        "valign",
        "bgcolor",
        "color",
        "size",
        "face",
      ],
      ALLOW_DATA_ATTR: false,
      ADD_ATTR: ["target"],
      FORCE_BODY: true,
    });
  }, [detailBody.htmlBody]);
  const htmlBodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (htmlBodyRef.current) {
      htmlBodyRef.current.innerHTML = sanitizedHtmlBody;
    }
  }, [sanitizedHtmlBody]);
  const [listError, setListError] = useState<string | null>(serverListError);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Conversation (thread) summary + lazy bodies
  const [threadSummary, setThreadSummary] = useState<{ threadId: string; messages: ThreadMessageSummary[] } | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [threadExpandedIds, setThreadExpandedIds] = useState<Set<string>>(new Set());
  const [threadBodies, setThreadBodies] = useState<Record<string, { plainTextBody: string | null; bodyNotice: string | null; isLoading: boolean; error: string | null }>>({});
  const threadInFlightRef = useRef<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isClaimedMap, setIsClaimedMap] = useState<Record<string, boolean>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [noteIndexIds, setNoteIndexIds] = useState<Set<string> | null>(null);
  const [noteSearchIds, setNoteSearchIds] = useState<Set<string> | null>(null);
  const noteSearchKeyRef = useRef<string | null>(null);
  // Step 101: Work Tags（状況タグ）: messageId -> tags[]
  const [workTagsById, setWorkTagsById] = useState<Record<string, string[]>>({});
  const [workTagDraft, setWorkTagDraft] = useState<string[]>([]);
  const [workTagInput, setWorkTagInput] = useState("");

  const parseNoteSearch = useCallback((query: string) => {
    const tokens = query.split(/\s+/).filter(Boolean);
    let hasNote = false;
    let noteQuery: string | null = null;
    const restTokens: string[] = [];
    for (const token of tokens) {
      if (token === "has:note") {
        hasNote = true;
        continue;
      }
      if (token.startsWith("note:")) {
        const q = token.slice("note:".length).trim();
        noteQuery = q || null;
        continue;
      }
      restTokens.push(token);
    }
    return { hasNote, noteQuery, textQuery: restTokens.join(" ").trim() };
  }, []);

  const noteSearch = parseNoteSearch(searchTerm);

  const parseTagSearch = useCallback((query: string) => {
    const tokens = query.split(/\s+/).filter(Boolean);
    let hasTag = false;
    let tagSlug: string | null = null;
    const restTokens: string[] = [];
    for (const token of tokens) {
      if (token === "has:tag") {
        hasTag = true;
        continue;
      }
      if (token.startsWith("tag:")) {
        const v = token.slice("tag:".length).trim();
        tagSlug = v || null;
        continue;
      }
      restTokens.push(token);
    }
    return { hasTag, tagSlug, textQuery: restTokens.join(" ").trim() };
  }, []);

  const normalizeTagSlug = useCallback((raw: string): string => {
    const s = raw.trim().toLowerCase();
    if (!s) return "";
    return s
      .replace(/[\s_]+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32);
  }, []);

  // note tokens を除去した後に tag tokens を除去する（検索文字列を一元化）
  const tagSearch = parseTagSearch(noteSearch.textQuery);

  // Step 105: is:unseen / is:seen パーサー
  const parseSeenSearch = useCallback((query: string) => {
    const tokens = query.split(/\s+/).filter(Boolean);
    let isUnseen = false;
    let isSeen = false;
    const restTokens: string[] = [];
    for (const token of tokens) {
      if (token === "is:unseen") {
        isUnseen = true;
        continue;
      }
      if (token === "is:seen") {
        isSeen = true;
        continue;
      }
      restTokens.push(token);
    }
    return { isUnseen, isSeen, textQuery: restTokens.join(" ").trim() };
  }, []);
  const seenSearch = parseSeenSearch(tagSearch.textQuery);

  const fetchNoteIds = useCallback(async (opts: { hasNote?: boolean; query?: string }) => {
    const params = new URLSearchParams();
    if (opts.hasNote) params.set("hasNote", "1");
    if (opts.query) params.set("q", opts.query);
    const res = await fetch(`/api/mailhub/notes?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as { ids?: string[] };
    return Array.isArray(data.ids) ? data.ids : [];
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ids = await fetchNoteIds({ hasNote: true });
      if (!cancelled) setNoteIndexIds(new Set(ids));
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchNoteIds]);

  // Step 101: Work Tags index を取得（一覧表示と検索に使用）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/mailhub/meta?list=1", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { items?: Array<{ messageId: string; tags: string[] }> };
        if (cancelled) return;
        const next: Record<string, string[]> = {};
        for (const it of data.items ?? []) {
          if (!it?.messageId) continue;
          next[it.messageId] = Array.isArray(it.tags) ? it.tags : [];
        }
        setWorkTagsById(next);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 選択中メッセージのDraftを同期（UIで編集→保存）
  useEffect(() => {
    if (!selectedId) {
      setWorkTagDraft([]);
      setWorkTagInput("");
      return;
    }
    setWorkTagDraft(workTagsById[selectedId] ?? []);
    setWorkTagInput("");
  }, [selectedId, workTagsById]);

  useEffect(() => {
    if (!noteSearch.hasNote && !noteSearch.noteQuery) {
      setNoteSearchIds(null);
      noteSearchKeyRef.current = null;
      return;
    }
    const key = `${noteSearch.hasNote ? "1" : "0"}:${noteSearch.noteQuery ?? ""}`;
    if (noteSearchKeyRef.current === key && noteSearchIds) return;
    noteSearchKeyRef.current = key;
    setNoteSearchIds(null);
    let cancelled = false;
    void (async () => {
      const ids = await fetchNoteIds({ hasNote: noteSearch.hasNote, query: noteSearch.noteQuery ?? undefined });
      if (cancelled) return;
      const setIds = new Set(ids);
      setNoteSearchIds(setIds);
      if (noteSearch.hasNote && !noteSearch.noteQuery) {
        setNoteIndexIds(setIds);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchNoteIds, noteSearch.hasNote, noteSearch.noteQuery, noteSearchIds]);
  // Step 51: サーバ検索クエリ（Gmail検索式）
  const [serverSearchQuery, setServerSearchQuery] = useState<string>(initialSearchQuery);
  // Step 23: Gmail-like labels (registered labels + manual apply + rules)
  const [registeredLabels, setRegisteredLabels] = useState<Array<{ labelName: string; displayName?: string; createdAt: string }>>([]);
  const [labelPopoverOpen, setLabelPopoverOpen] = useState(false);
  const [labelPopoverQuery, setLabelPopoverQuery] = useState("");
  const [newLabelName, setNewLabelName] = useState("");
  const [autoApplyRule, setAutoApplyRule] = useState(false);
  const [autoApplyRuleMatchMode, setAutoApplyRuleMatchMode] = useState<"email" | "domain">("email");
  const labelPopoverRef = useRef<HTMLDivElement | null>(null);
  const labelButtonRef = useRef<HTMLButtonElement | null>(null);
  const [labelPopoverPos, setLabelPopoverPos] = useState<{ top: number; left: number } | null>(null);
  // Snooze popover state
  const [snoozePopoverOpen, setSnoozePopoverOpen] = useState(false);
  const snoozePopoverRef = useRef<HTMLDivElement | null>(null);
  const snoozeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [snoozePopoverPos, setSnoozePopoverPos] = useState<{ top: number; left: number } | null>(null);
  // Step 52: Queues (saved searches) popover state
  const [queuesPopoverOpen, setQueuesPopoverOpen] = useState(false);
  const queuesPopoverRef = useRef<HTMLDivElement | null>(null);
  const queuesButtonRef = useRef<HTMLButtonElement | null>(null);
  const [queuesPopoverPos, setQueuesPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const [savedSearches, setSavedSearches] = useState<Array<{ id: string; name: string; query: string; baseLabelId?: string | null }>>([]);
  // 初期viewTabをinitialLabelIdに基づいて設定
  const getInitialViewTab = (): "inbox" | "assigned" | "waiting" | "muted" | "snoozed" => {
    const initialLabel = labelGroups.flatMap((g) => g.items).find((item) => item.id === initialLabelId);
    if (initialLabel?.statusType === "todo") return "inbox";
    if (initialLabel?.statusType === "waiting") return "waiting";
    if (initialLabel?.statusType === "muted") return "muted";
    if (initialLabel?.statusType === "snoozed") return "snoozed";
    if (initialLabel?.id === "mine" || initialLabel?.type === "assignee") return "assigned";
    return "inbox"; // デフォルトは受信箱
  };
  
  const [viewTab, setViewTab] = useState<"inbox" | "assigned" | "waiting" | "muted" | "snoozed">(() => getInitialViewTab()); // タブ切り替え（受信箱、担当、保留、低優先、期限付き保留）
  
  // Step 66: SLA Focus（危険メールのみ表示）
  // Step 67: URLから初期状態を読み取る
  const [slaFocus, setSlaFocus] = useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      return params.get("sla") === "1";
    }
    return false;
  });
  const [slaCriticalOnly, setSlaCriticalOnly] = useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      return params.get("slaLevel") === "critical";
    }
    return false;
  });
  
  // 複数選択機能の状態
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [lastCheckedId, setLastCheckedId] = useState<string | null>(null); // Shift選択用
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set()); // アニメーション用
  const [flashingIds, setFlashingIds] = useState<Set<string>>(new Set()); // Flash効果用
  const [glowTab, setGlowTab] = useState<string | null>(null); // Glow effect用
  // Step 59: 処理中フラグ（二重押し防止）
  const [actionInProgress, setActionInProgress] = useState<Set<string>>(new Set());
  
  // 一括操作の進捗と結果
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null);
  const [bulkResult, setBulkResult] = useState<{
    successIds: string[];
    failedIds: string[];
    failedMessages: Array<{ id: string; subject: string }>;
    action: "bulkArchive" | "bulkMute" | "bulkWaiting" | "bulkAssign";
  } | null>(null);

  // リサイズ機能の状態（レスポンシブ対応）
  const [sidebarWidth, setSidebarWidth] = useState(256); // w-64 = 256px
  const [listWidth, setListWidth] = useState(572); // デフォルトを+30%（440px→約572px）
  const [resizing, setResizing] = useState<"sidebar" | "list" | null>(null);

  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Undoスタック（複数の操作をUndoできるように）
  type SingleUndoItem = {
    id: string;
    message: InboxListMessage;
    action: "archive" | "setWaiting" | "unsetWaiting" | "mute" | "unmute" | "assign" | "unassign" | "takeover" | "snooze" | "unsnooze";
  };
  type BulkUndoItem = {
    action: "bulkArchive" | "bulkMute" | "bulkWaiting" | "bulkAssign";
    ids: string[];
    messages: InboxListMessage[];
  };
  type UndoItem = SingleUndoItem | BulkUndoItem;
  const [undoStack, setUndoStack] = useState<UndoItem[]>([]);

  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [showBulkMuteConfirm, setShowBulkMuteConfirm] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  // Step 90: Safety Confirm（状況依存）
  const BULK_CONFIRM_THRESHOLD = 10; // 10件以上で確認必須
  type BulkConfirmAction = "bulkDone" | "bulkMute" | "bulkAssign" | null;
  const [pendingBulkConfirm, setPendingBulkConfirm] = useState<{ action: BulkConfirmAction; ids: string[]; assigneeEmail?: string } | null>(null);

  // Step 91: Audit Reason（理由入力モーダル）
  type ReasonRequiredAction = "takeover" | null;
  const [pendingReasonModal, setPendingReasonModal] = useState<{
    action: ReasonRequiredAction;
    messageId: string;
    assigneeEmail?: string;
    handoffNote?: string;
    isBulk?: boolean;
    bulkIds?: string[];
  } | null>(null);
  const [reasonText, setReasonText] = useState("");

  const [statusCounts, setStatusCounts] = useState<StatusCounts | null>(null);

  // Channels（All/StoreA/B/C）の件数を保持（画面移動で消えないようにする）
  const [channelCounts, setChannelCounts] = useState<ChannelCounts>(() => {
    const init: Record<string, number> = {};
    // 初期ラベルがchannelの場合は、初期messages.lengthを反映
    // （Allを開いている初期表示でバッジが空にならないように）
    try {
      const initialLabel = labelGroups
        .flatMap((g) => g.items)
        .find((it) => it.id === initialLabelId);
      if (initialLabel?.type === "channel") {
        init[initialLabelId] = initialMessages.length;
      }
    } catch {
      // ignore
    }
    return init;
  });

  // 返信パネルの状態
  const [replyInquiryNumber, setReplyInquiryNumber] = useState("");
  const [replyMessage, setReplyMessage] = useState("");
  const [isSendingReply, setIsSendingReply] = useState(false);
  const [lastAppliedTemplate, setLastAppliedTemplate] = useState<{
    id: string;
    title: string;
    unresolvedVars: string[];
  } | null>(null);
  
  // 本文の折りたたみ状態
  const [bodyCollapsed, setBodyCollapsed] = useState(false);
  
  // 返信完了マクロの状態
  const [showReplyCompleteModal, setShowReplyCompleteModal] = useState(false);
  const [replyCompleteStatus, setReplyCompleteStatus] = useState<"done" | "waiting" | "muted" | null>(null);
  const [isCompletingReply, setIsCompletingReply] = useState(false);

  // Activity Drawerの状態（URL共有: /inbox?activity=1&actor=me...）
  const [showActivityDrawer, setShowActivityDrawer] = useState(() => {
    try {
      if (typeof window === "undefined") return false;
      return new URLSearchParams(window.location.search).get("activity") === "1";
    } catch {
      return false;
    }
  });
  const [showOpsDrawer, setShowOpsDrawer] = useState(false);
  const [showHandoffDrawer, setShowHandoffDrawer] = useState(false);
  const [showExplainDrawer, setShowExplainDrawer] = useState(false);
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const [showDiagnosticsDrawer, setShowDiagnosticsDrawer] = useState(false);
  const [showHelpDrawer, setShowHelpDrawer] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showViewsPalette, setShowViewsPalette] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showAssigneeSelector, setShowAssigneeSelector] = useState(false);
  const [assigneeSelectorMessageId, setAssigneeSelectorMessageId] = useState<string | null>(null);
  const [assigneeSelectorBulkIds, setAssigneeSelectorBulkIds] = useState<string[]>([]);
  // Step 71: take=1 ガード（1回だけ開く）
  const takeAutoOpenDone = useRef(false);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  // Step 63: Auto Assign (Round-robin)
  const [showAutoAssignModal, setShowAutoAssignModal] = useState(false);
  const [autoAssignPreview, setAutoAssignPreview] = useState<Array<{ id: string; subject: string | null; assignee: string }>>([]);
  // TEST_MODEではE2Eが即クリックするので初期true（本番はhealthで判定）
  const [canOpenSettings, setCanOpenSettings] = useState<boolean>(testMode);
  const [readOnlyMode, setReadOnlyMode] = useState<boolean>(false);
  const [writeBlockedReason, setWriteBlockedReason] = useState<null | "read_only" | "insufficient_permissions">(null);
  const [activityLogs, setActivityLogs] = useState<Array<{
    timestamp: string;
    actorEmail: string;
    action: string;
    messageId: string;
    subject: string | null;
    receivedAt: string | null;
    channel?: string;
    status?: string;
    reason?: string; // Step 91: 理由入力
  }>>([]);
  const [activityFilter, setActivityFilter] = useState<"all" | "me">(() => {
    try {
      if (typeof window === "undefined") return "all";
      const actor = new URLSearchParams(window.location.search).get("actor");
      return actor === "me" ? "me" : "all";
    } catch {
      return "all";
    }
  });
  const [activityActorEmail, setActivityActorEmail] = useState<string>(() => {
    try {
      if (typeof window === "undefined") return "";
      const actor = new URLSearchParams(window.location.search).get("actor");
      return actor && actor !== "me" ? actor : "";
    } catch {
      return "";
    }
  });
  const [activityActionFilter, setActivityActionFilter] = useState<string>(() => {
    try {
      if (typeof window === "undefined") return "all";
      return new URLSearchParams(window.location.search).get("action") || "all";
    } catch {
      return "all";
    }
  });
  const [activityRuleIdFilter, setActivityRuleIdFilter] = useState<string | null>(() => {
    try {
      if (typeof window === "undefined") return null;
      return new URLSearchParams(window.location.search).get("ruleId");
    } catch {
      return null;
    }
  });
  const [activityMessageIdFilter, setActivityMessageIdFilter] = useState<string>(() => {
    try {
      if (typeof window === "undefined") return "";
      return new URLSearchParams(window.location.search).get("messageId") || "";
    } catch {
      return "";
    }
  });
  const [activitySubjectFilter, setActivitySubjectFilter] = useState<string>(() => {
    try {
      if (typeof window === "undefined") return "";
      return new URLSearchParams(window.location.search).get("subject") || "";
    } catch {
      return "";
    }
  });
  const [activityPeriodFilter, setActivityPeriodFilter] = useState<"all" | "24h" | "7d" | "30d">(() => {
    try {
      if (typeof window === "undefined") return "all";
      const v = new URLSearchParams(window.location.search).get("period");
      return v === "24h" || v === "7d" || v === "30d" ? v : "all";
    } catch {
      return "all";
    }
  });
  
  // Ops Board Drawerの状態
  const [opsSummary, setOpsSummary] = useState<{
    todo: { critical: { count: number; items: Array<{ id: string; subject: string | null; from: string | null; receivedAt: string; elapsed: string; status: "critical" | "warn"; gmailLink: string | null }> }; warn: { count: number; items: Array<{ id: string; subject: string | null; from: string | null; receivedAt: string; elapsed: string; status: "critical" | "warn"; gmailLink: string | null }> } };
    waiting: { critical: { count: number; items: Array<{ id: string; subject: string | null; from: string | null; receivedAt: string; elapsed: string; status: "critical" | "warn"; gmailLink: string | null }> }; warn: { count: number; items: Array<{ id: string; subject: string | null; from: string | null; receivedAt: string; elapsed: string; status: "critical" | "warn"; gmailLink: string | null }> } };
    unassigned: { critical: { count: number; items: Array<{ id: string; subject: string | null; from: string | null; receivedAt: string; elapsed: string; status: "critical" | "warn"; gmailLink: string | null }> }; warn: { count: number; items: Array<{ id: string; subject: string | null; from: string | null; receivedAt: string; elapsed: string; status: "critical" | "warn"; gmailLink: string | null }> } };
  } | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightIdRef = useRef<string | null>(null);
  const lastFocusSyncAtRef = useRef<number>(0);
  
  // Step 93: Hover Prefetch用のref
  const hoverPrefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverPrefetchAbortRef = useRef<AbortController | null>(null);
  
  // Step 50: Detailキャッシュ（LRU、最大20件、TTL 5分）
  type DetailCacheEntry = {
    plainTextBody: string | null;
    htmlBody: string | null;
    bodyNotice: string | null;
    subject: string;
    from: string;
    fetchedAt: number;
    debugLabels?: { labelIds: string[]; labelNames: Array<string | null> };
  };
  const detailCacheRef = useRef<Map<string, DetailCacheEntry>>(new Map());
  const DETAIL_CACHE_MAX_SIZE = 20;

  // URL同期は history API のみで行う（Next Router の連続 replace による throttling を回避）
  const replaceUrl = useCallback((label: string, id: string | null, keepView: boolean = true, searchQ?: string | null) => {
    const params = new URLSearchParams(window.location.search);
    params.set("label", label);
    if (id) params.set("id", id);
    else params.delete("id");
    if (!keepView) params.delete("view");
    // Step 51: 検索クエリをURLに保持（idだけ変える時もqが消えないように）
    if (searchQ !== undefined) {
      if (searchQ && searchQ.trim()) {
        params.set("q", searchQ.trim());
      } else {
        params.delete("q");
      }
    }
    const qs = params.toString();
    const nextUrl = qs ? `${pathname}?${qs}` : `${pathname}`;
    window.history.replaceState(null, "", nextUrl);
  }, [pathname]);

  const replaceUrlWithView = useCallback((viewId: string, label: string, id: string | null) => {
    const params = new URLSearchParams(window.location.search);
    params.set("view", viewId);
    params.set("label", label);
    if (id) params.set("id", id);
    else params.delete("id");
    const qs = params.toString();
    const nextUrl = qs ? `${pathname}?${qs}` : `${pathname}`;
    window.history.replaceState(null, "", nextUrl);
  }, [pathname]);

  // Saved Views（保存ビュー）
  const [views, setViews] = useState<View[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(() => {
    try {
      if (typeof window === "undefined") return null;
      return new URLSearchParams(window.location.search).get("view");
    } catch {
      return null;
    }
  });

  // Team（担当者名簿）
  const [team, setTeam] = useState<Array<{ email: string; name: string | null }>>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/mailhub/views", { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as { views?: View[] };
        if (!res.ok) return;
        if (cancelled) return;
        setViews(Array.isArray(data.views) ? data.views : []);
      } catch {
        // ignore（一覧表示が最優先）
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Step 77: /api/mailhub/assignees から名簿を取得（全員ツリー化）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/mailhub/assignees", { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as { assignees?: Array<{ email: string; displayName?: string }> };
        if (!res.ok) return;
        if (cancelled) return;
        // displayName を name に変換して互換性を維持
        setTeam(
          Array.isArray(data.assignees)
            ? data.assignees.map((a) => ({ email: a.email, name: a.displayName ?? null }))
            : []
        );
      } catch {
        // ignore（一覧表示が最優先）
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeLabel = useMemo((): LabelItem | null => {
    for (const group of labelGroups) {
      const hit = group.items.find((item) => item.id === labelId);
      if (hit) return hit;
    }
    return labelGroups[0]?.items[0] ?? null;
  }, [labelId, labelGroups]);

  // Step 81: slug→displayNameのMapを作成（team名簿から）
  const assigneeDisplayNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of team) {
      const slug = m.email.replace("@", "_at_").replace(/\./g, "_");
      // displayName優先、なければ短縮email（ローカル部分）
      map.set(slug, m.name || m.email.split("@")[0]);
    }
    return map;
  }, [team]);

  // 担当者slugから表示名を取得（displayName優先、なければ短縮email、最後はslug）
  // E2E互換: 自分担当（test@...）の場合は "test" になるように user.name を優先
  const getAssigneeDisplayName = useCallback((slug: string | null): string | null => {
    if (!slug) return null;
    const mySlug = assigneeSlug(user.email);
    if (slug === mySlug) return (user.name || user.email.split("@")[0]).toLowerCase();
    // Step 81: 名簿から取得
    if (assigneeDisplayNameMap.has(slug)) {
      return assigneeDisplayNameMap.get(slug) ?? null;
    }
    // フォールバック: slugからローカル部分を抽出
    const parts = slug.split("_at_");
    return parts[0] || slug;
  }, [user.email, user.name, assigneeDisplayNameMap]);

  // 自分の担当者slugを取得
  const myAssigneeSlug = useMemo(() => assigneeSlug(user.email), [user.email]);
  const selectedAssigneeSlug = useMemo(() => {
    if (!selectedId) return null;
    return messages.find((m) => m.id === selectedId)?.assigneeSlug ?? selectedMessage?.assigneeSlug ?? null;
  }, [messages, selectedId, selectedMessage]);
  const isSelectedMine = selectedAssigneeSlug === myAssigneeSlug;

  // Step 59: 単一アクション処理中かどうか（ボタンdisable用）
  const isActionInProgress = useMemo(() => {
    if (actionInProgress.size === 0) return false;
    // checkedIdsがあればそのいずれかが処理中かチェック
    if (checkedIds.size > 0) {
      return Array.from(checkedIds).some((id) => actionInProgress.has(id));
    }
    // 単一選択の場合
    return selectedId ? actionInProgress.has(selectedId) : false;
  }, [actionInProgress, checkedIds, selectedId]);

  const selectedIds = useMemo(() => {
    if (checkedIds.size > 0) return Array.from(checkedIds);
    if (selectedId) return [selectedId];
    return [];
  }, [checkedIds, selectedId]);

  const singleSelectedFromEmail = useMemo(() => {
    if (selectedIds.length !== 1) return null;
    const id = selectedIds[0];
    const fromHeader = messages.find((m) => m.id === id)?.from ?? selectedMessage?.from ?? null;
    return extractFromEmail(fromHeader);
  }, [messages, selectedIds, selectedMessage]);

  const singleSelectedFromDomain = useMemo(() => {
    return extractFromDomain(singleSelectedFromEmail);
  }, [singleSelectedFromEmail]);

  const visibleRegisteredLabels = useMemo(() => {
    const q = labelPopoverQuery.trim().toLowerCase();
    if (!q) return registeredLabels;
    return registeredLabels.filter((l) => {
      const dn = (l.displayName ?? "").toLowerCase();
      return l.labelName.toLowerCase().includes(q) || dn.includes(q);
    });
  }, [registeredLabels, labelPopoverQuery]);

  const labelNameToDisplayName = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of registeredLabels) {
      map.set(l.labelName, l.displayName?.trim() || l.labelName);
    }
    return map;
  }, [registeredLabels]);

  const displayUserLabel = useCallback((labelName: string) => {
    return labelNameToDisplayName.get(labelName) ?? labelName;
  }, [labelNameToDisplayName]);

  const labelSelectionState = useMemo(() => {
    const ids = selectedIds;
    const map = new Map<string, { all: boolean; some: boolean }>();
    if (ids.length === 0) return map;
    const idToLabels = new Map(messages.map((m) => [m.id, new Set(m.userLabels ?? [])] as const));
    for (const l of registeredLabels) {
      const all = ids.every((id) => (idToLabels.get(id)?.has(l.labelName) ?? false));
      const some = ids.some((id) => (idToLabels.get(id)?.has(l.labelName) ?? false));
      map.set(l.labelName, { all, some });
    }
    return map;
  }, [messages, registeredLabels, selectedIds]);

  const allSelectedMine = useMemo(() => {
    if (selectedIds.length === 0) return false;
    return selectedIds.every((id) => (messages.find((m) => m.id === id)?.assigneeSlug ?? null) === myAssigneeSlug);
  }, [messages, myAssigneeSlug, selectedIds]);

  const someSelectedMine = useMemo(() => {
    if (selectedIds.length === 0) return false;
    return selectedIds.some((id) => (messages.find((m) => m.id === id)?.assigneeSlug ?? null) === myAssigneeSlug);
  }, [messages, myAssigneeSlug, selectedIds]);

  const toggleStarLocal = useCallback((id: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, isStarred: !(m.isStarred ?? false) } : m)),
    );
    setSelectedMessage((prev) =>
      prev && prev.id === id ? { ...prev, isStarred: !(prev.isStarred ?? false) } : prev,
    );
  }, []);

  const filteredMessages = useMemo(() => {
    let filtered = messages;
    
    // activeLabel.type==="assignee" の場合
    if (activeLabel?.type === "assignee") {
      // Unassignedビューの場合: assigneeSlugがnullのものだけ表示（Optimistic更新対応）
      if (activeLabel?.id === "unassigned") {
        filtered = filtered.filter((m) => !m.assigneeSlug);
      }
      // Mineビューの場合: 自分が担当のものだけ表示
      else if (activeLabel?.id === "mine") {
        filtered = filtered.filter((m) => m.assigneeSlug === myAssigneeSlug);
      }
      // それ以外のassigneeビューはサーバ取得結果をそのまま表示
    } else {
      // タブフィルタ（受信箱/担当/保留/低優先）
      if (viewTab === "inbox") {
        // 受信箱タブ: activeLabelがtodoの場合、またはチャンネルラベルの場合は表示
        // チャンネルラベル（all, store-a, store-b, store-c）の場合はstatusTypeチェックをスキップ
        if (activeLabel?.type !== "channel" && activeLabel?.statusType !== "todo") {
          filtered = [];
        }
      } else if (viewTab === "assigned") {
        // 担当タブ: 自分が担当になっているものだけ表示
        filtered = filtered.filter((m) => m.assigneeSlug === myAssigneeSlug);
      } else if (viewTab === "waiting") {
        // 保留タブ: activeLabelがwaitingの場合のみ表示（loadListでwaitingラベルを読み込んでいるため）
        if (activeLabel?.statusType !== "waiting") {
          filtered = [];
        }
      } else if (viewTab === "muted") {
        // 低優先タブ: activeLabelがmutedの場合のみ表示（loadListでmutedラベルを読み込んでいるため）
        if (activeLabel?.statusType !== "muted") {
          filtered = [];
        }
      } else if (viewTab === "snoozed") {
        // Snoozedタブ: activeLabelがsnoozedの場合のみ表示（loadListでsnoozedラベルを読み込んでいるため）
        if (activeLabel?.statusType !== "snoozed") {
          filtered = [];
        }
      }
    }
    
    // Step 51: 検索フィルタ（サーバ検索中はローカルフィルタリングをスキップ）
    if ((noteSearch.hasNote || noteSearch.noteQuery) && !serverSearchQuery) {
      if (!noteSearchIds) return [];
      filtered = filtered.filter((m) => noteSearchIds.has(m.id));
    }
    if ((tagSearch.hasTag || tagSearch.tagSlug) && !serverSearchQuery) {
      const slug = tagSearch.tagSlug ? normalizeTagSlug(tagSearch.tagSlug) : null;
      filtered = filtered.filter((m) => {
        const tags = workTagsById[m.id] ?? [];
        if (tagSearch.hasTag && tags.length === 0) return false;
        if (slug && !tags.includes(slug)) return false;
        return true;
      });
    }
    // Step 105: テキスト検索はseenSearch.textQuery（is:unseen/is:seenを除去した残り）を使用
    if (seenSearch.textQuery && !serverSearchQuery) {
      const normalizedQuery = normalizeForSearch(seenSearch.textQuery);
      filtered = filtered.filter((m) => {
        const normalizedSubject = m.subject ? normalizeForSearch(m.subject) : "";
        const normalizedFrom = m.from ? normalizeForSearch(m.from) : "";
        const normalizedSnippet = m.snippet ? normalizeForSearch(m.snippet) : "";
        return (
          normalizedSubject.includes(normalizedQuery) ||
          normalizedFrom.includes(normalizedQuery) ||
          normalizedSnippet.includes(normalizedQuery)
        );
      });
    }
    // Step 105: is:unseen / is:seen フィルタ
    if (seenSearch.isUnseen && !serverSearchQuery) {
      filtered = filtered.filter((m) => !seenIds.has(m.id));
    }
    if (seenSearch.isSeen && !serverSearchQuery) {
      filtered = filtered.filter((m) => seenIds.has(m.id));
    }
    
    return filtered;
  }, [
    messages,
    serverSearchQuery,
    activeLabel,
    myAssigneeSlug,
    viewTab,
    noteSearch,
    noteSearchIds,
    tagSearch.hasTag,
    tagSearch.tagSlug,
    workTagsById,
    normalizeTagSlug,
    seenSearch.isUnseen,
    seenSearch.isSeen,
    seenSearch.textQuery,
    seenIds,
  ]);

  // Step 66: SLA Focus（危険メールのみフィルタ＋優先ソート）
  const slaFilteredMessages = useMemo(() => {
    if (!slaFocus) return filteredMessages;
    
    // SLA超過（warn/critical）のみ抽出
    const slaMessages = filteredMessages.filter((m) => {
      const statusType = (() => {
        // statusTypeをmessageから推定（Done/Muted/Waitingなど）
        // 通常はactiveLabel.statusTypeに依存するが、メッセージ自体に状態がある場合も
        // シンプルにviewTabを使用
        if (viewTab === "waiting") return "waiting";
        if (viewTab === "muted") return "muted";
        return "todo";
      })();
      const level = getSlaLevel({ statusType, receivedAtIso: m.receivedAt });
      // Step 67: criticalOnlyの場合はcriticalのみ
      if (slaCriticalOnly) return level === "critical";
      return level !== "ok";
    });
    
    // critical > warn、同ランク内は経過時間が長い順
    return slaMessages.sort((a, b) => {
      const statusType = viewTab === "waiting" ? "waiting" : "todo";
      const levelA = getSlaLevel({ statusType, receivedAtIso: a.receivedAt });
      const levelB = getSlaLevel({ statusType, receivedAtIso: b.receivedAt });
      const rankA = levelA === "critical" ? 2 : levelA === "warn" ? 1 : 0;
      const rankB = levelB === "critical" ? 2 : levelB === "warn" ? 1 : 0;
      if (rankA !== rankB) return rankB - rankA; // critical優先
      // 同ランク: 古い順（経過時間が長い＝receivedAtが小さい）
      const timeA = new Date(a.receivedAt || 0).getTime();
      const timeB = new Date(b.receivedAt || 0).getTime();
      return timeA - timeB;
    });
  }, [filteredMessages, slaFocus, slaCriticalOnly, viewTab]);

  // Step 89: Duplicate Grouping（束ね表示）
  // 同じfromDomain + 正規化subjectが連続している場合に束ねる
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // fromからドメインを抽出
  const extractDomain = useCallback((from: string): string => {
    const match = from.match(/<([^>]+)>/);
    const email = match ? match[1] : from;
    const parts = email.split("@");
    return parts.length > 1 ? parts[1].toLowerCase() : "";
  }, []);

  // subjectを正規化（Re:, Fwd:, 【...】などを除去）
  const normalizeSubject = useCallback((subject: string): string => {
    return subject
      .replace(/^(Re:|Fwd:|FW:|RE:|Fw:)\s*/gi, "")
      .replace(/【[^】]*】/g, "")
      .replace(/\[[^\]]*\]/g, "")
      .trim()
      .toLowerCase();
  }, []);


  // グループ化のキーを生成
  const getGroupKey = useCallback((mail: InboxListMessage): string => {
    const domain = extractDomain(mail.from || "");
    const normalizedSubject = normalizeSubject(mail.subject || "");
    return `${domain}::${normalizedSubject}`;
  }, [extractDomain, normalizeSubject]);

  // メッセージをグループ化（連続する同一キーをまとめる）
  type MessageGroup = {
    key: string;
    messages: InboxListMessage[];
    isGroup: boolean;
  };

  const groupedMessages = useMemo((): MessageGroup[] => {
    if (slaFilteredMessages.length === 0) return [];

    const groups: MessageGroup[] = [];
    let currentGroup: MessageGroup | null = null;

    for (const mail of slaFilteredMessages) {
      const key = getGroupKey(mail);

      if (currentGroup && currentGroup.key === key) {
        // 同じグループに追加
        currentGroup.messages.push(mail);
      } else {
        // 新しいグループを開始
        if (currentGroup) {
          currentGroup.isGroup = currentGroup.messages.length > 1;
          groups.push(currentGroup);
        }
        currentGroup = { key, messages: [mail], isGroup: false };
      }
    }

    // 最後のグループを追加
    if (currentGroup) {
      currentGroup.isGroup = currentGroup.messages.length > 1;
      groups.push(currentGroup);
    }

    return groups;
  }, [slaFilteredMessages, getGroupKey]);

  const toggleGroupExpand = useCallback((groupKey: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);

  // Step 89: グループ化されたメッセージをフラット化（表示用）
  // 折りたたまれたグループは最初のメッセージのみ、展開されたグループは全メッセージを表示
  type DisplayMessage = InboxListMessage & {
    isGroupHeader?: boolean;
    groupCount?: number;
    groupKey?: string;
    isGroupChild?: boolean;
  };

  const displayMessages = useMemo((): DisplayMessage[] => {
    const result: DisplayMessage[] = [];

    for (const group of groupedMessages) {
      if (group.isGroup) {
        const isExpanded = expandedGroups.has(group.key);
        if (isExpanded) {
          // 展開中: 全メッセージを表示（最初のメッセージにヘッダー情報を付与）
          result.push({
            ...group.messages[0],
            isGroupHeader: true,
            groupCount: group.messages.length,
            groupKey: group.key,
          });
          for (let i = 1; i < group.messages.length; i++) {
            result.push({
              ...group.messages[i],
              isGroupChild: true,
              groupKey: group.key,
            });
          }
        } else {
          // 折りたたみ: 最初のメッセージのみ表示（グループヘッダーとして）
          result.push({
            ...group.messages[0],
            isGroupHeader: true,
            groupCount: group.messages.length,
            groupKey: group.key,
          });
        }
      } else {
        // グループではない（1件のみ）
        result.push(group.messages[0]);
      }
    }

    return result;
  }, [groupedMessages, expandedGroups]);

  // Gmail風: 現在表示中（slaFilteredMessages）の一括選択チェックボックス状態
  const checkAllRef = useRef<HTMLInputElement | null>(null);
  const visibleIds = useMemo(() => slaFilteredMessages.map((m) => m.id), [slaFilteredMessages]);
  const checkedVisibleCount = useMemo(() => {
    let c = 0;
    for (const id of visibleIds) {
      if (checkedIds.has(id)) c++;
    }
    return c;
  }, [visibleIds, checkedIds]);
  const isAllVisibleChecked = visibleIds.length > 0 && checkedVisibleCount === visibleIds.length;
  const isNoneVisibleChecked = checkedVisibleCount === 0;
  const isVisibleIndeterminate = !isAllVisibleChecked && !isNoneVisibleChecked;

  useEffect(() => {
    if (checkAllRef.current) {
      checkAllRef.current.indeterminate = isVisibleIndeterminate;
    }
  }, [isVisibleIndeterminate]);

  const handleToggleCheckAllVisible = useCallback(
    (nextChecked: boolean) => {
      if (nextChecked) {
        setCheckedIds(new Set(visibleIds));
        setLastCheckedId(visibleIds[visibleIds.length - 1] ?? null);
      } else {
        setCheckedIds(new Set());
        setLastCheckedId(null);
      }
    },
    [visibleIds],
  );

  // 候補メッセージの判定
  const triageCandidates = useMemo(() => {
    return getTriageCandidates(filteredMessages, () => {
      const context: TriageContext = {
        channelId: channelId,
        statusType: activeLabel?.statusType ?? null,
      };
      return context;
    });
  }, [filteredMessages, channelId, activeLabel]);

  const isTriageCandidate = useCallback((msgId: string) => {
    return triageCandidates.some((c) => c.id === msgId);
  }, [triageCandidates]);

  useEffect(() => {
    // Step 51: 検索クエリをURLに保持
    replaceUrl(labelId, selectedId, true, serverSearchQuery || undefined);
    // labelIdからchannelIdを更新（URLから直接開いた場合の対応）
    if (labelId === "store-a" || labelId === "store-b" || labelId === "store-c") {
      setChannelId(labelId as ChannelId);
    } else {
      setChannelId("all");
    }
  }, [labelId, selectedId, serverSearchQuery, replaceUrl]);

  // Step 50: デバウンス用のref（300-500ms）
  const fetchCountsDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchCountsDebounced = useCallback(async () => {
    // Step 50: bulk処理中はcounts再取得を避ける
    if (bulkProgress) return;
    
    if (fetchCountsDebounceTimerRef.current) {
      clearTimeout(fetchCountsDebounceTimerRef.current);
    }
    fetchCountsDebounceTimerRef.current = setTimeout(async () => {
      // Step 50: 実行時にもbulk処理中でないことを確認
      if (bulkProgress) return;
      
      try {
        const res = await fetch("/api/mailhub/counts", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { counts: StatusCounts };
          setStatusCounts(data.counts);
        }
      } catch {
        // ignore
      }
      fetchCountsDebounceTimerRef.current = null;
    }, 400); // Step 50: 300ms → 400msに調整（要件C）
  }, [bulkProgress]);

  const fetchCounts = useCallback(async () => {
    // 即座に実行（初回ロード時など）
    try {
      const res = await fetch("/api/mailhub/counts", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { counts: StatusCounts };
        setStatusCounts(data.counts);
      }
    } catch {
      // ignore
    }
  }, []);

  const bumpCounts = useCallback((delta: Partial<Pick<StatusCounts, "todo" | "waiting" | "done" | "muted" | "snoozed" | "assignedMine">>) => {
    setStatusCounts((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      (Object.keys(delta) as Array<keyof typeof delta>).forEach((k) => {
        const d = delta[k];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (typeof d === "number") (next as any)[k] = Math.max(0, ((next as any)[k] ?? 0) + d);
      });
      return next;
    });
  }, []);

  // Activityログを取得
  const fetchActivityLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (activityFilter === "me") {
        params.set("actor", "me");
      }
      if (activityFilter !== "me" && activityActorEmail.trim()) {
        params.set("actor", activityActorEmail.trim());
      }
      if (activityActionFilter !== "all") {
        params.set("action", activityActionFilter);
      }
      if (activityRuleIdFilter) {
        params.set("ruleId", activityRuleIdFilter);
      }
      if (activityMessageIdFilter.trim()) {
        params.set("messageId", activityMessageIdFilter.trim());
      }
      if (activitySubjectFilter.trim()) {
        params.set("subject", activitySubjectFilter.trim());
      }
      if (activityPeriodFilter !== "all") {
        params.set("period", activityPeriodFilter);
      }
      params.set("limit", "50");
      
      const res = await fetch(`/api/mailhub/activity?${params.toString()}`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { logs: typeof activityLogs };
        // E2E安定化: waitForResponse直後にDOMに反映されるよう同期反映
        flushSync(() => setActivityLogs((prev) => (data.logs.length > 0 ? data.logs : prev)));
      }
    } catch {
      // ignore
    }
  }, [
    activityFilter,
    activityActorEmail,
    activityActionFilter,
    activityRuleIdFilter,
    activityMessageIdFilter,
    activitySubjectFilter,
    activityPeriodFilter,
  ]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  // Activity Drawerが開いたらログを取得、フィルタ変更時も再取得
  // E2E安定化: waitForResponse が取りこぼさないように少し遅延させる
  useEffect(() => {
    if (!showActivityDrawer) return;
    const timerId = window.setTimeout(() => {
      void fetchActivityLogs();
    }, 200);
    return () => window.clearTimeout(timerId);
  }, [
    showActivityDrawer,
    activityFilter,
    activityActorEmail,
    activityActionFilter,
    activityRuleIdFilter,
    activityMessageIdFilter,
    activitySubjectFilter,
    activityPeriodFilter,
    fetchActivityLogs,
  ]);

  // Step 99: Activityフィルタ状態をURLクエリで共有（/inbox?activity=1&actor=me...）
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      if (showActivityDrawer) url.searchParams.set("activity", "1");
      else url.searchParams.delete("activity");

      const actorParam = activityFilter === "me" ? "me" : activityActorEmail.trim();
      if (actorParam) url.searchParams.set("actor", actorParam);
      else url.searchParams.delete("actor");

      if (activityActionFilter !== "all") url.searchParams.set("action", activityActionFilter);
      else url.searchParams.delete("action");

      if (activityRuleIdFilter) url.searchParams.set("ruleId", activityRuleIdFilter);
      else url.searchParams.delete("ruleId");

      if (activityMessageIdFilter.trim()) url.searchParams.set("messageId", activityMessageIdFilter.trim());
      else url.searchParams.delete("messageId");

      if (activitySubjectFilter.trim()) url.searchParams.set("subject", activitySubjectFilter.trim());
      else url.searchParams.delete("subject");

      if (activityPeriodFilter !== "all") url.searchParams.set("period", activityPeriodFilter);
      else url.searchParams.delete("period");

      window.history.replaceState(null, "", url.toString());
    } catch {
      // ignore
    }
  }, [
    showActivityDrawer,
    activityFilter,
    activityActorEmail,
    activityActionFilter,
    activityRuleIdFilter,
    activityMessageIdFilter,
    activitySubjectFilter,
    activityPeriodFilter,
  ]);

  // Ops Board Drawerが開いたらサマリーを取得
  const fetchOpsSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/mailhub/ops/summary", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("Failed to fetch ops summary:", data);
        return;
      }
      setOpsSummary(data.summary ?? null);
    } catch (e) {
      console.error("Failed to fetch ops summary:", e);
    }
  }, []);

  useEffect(() => {
    if (!showOpsDrawer) return;
    const timerId = window.setTimeout(() => {
      void fetchOpsSummary();
    }, 200);
    return () => window.clearTimeout(timerId);
  }, [showOpsDrawer, fetchOpsSummary]);

  // バージョン情報を取得
  useEffect(() => {
    fetch("/api/version")
      .then((res) => res.json())
      .then((data) => setVersion(data.version))
      .catch(() => setVersion(null));
  }, []);

  // Step 50: キャッシュから古いエントリを削除（LRU）
  const evictOldCacheEntries = useCallback(() => {
    const cache = detailCacheRef.current;
    const now = Date.now();
    const entriesToDelete: string[] = [];
    const TTL_MS = 5 * 60 * 1000; // 5分
    
    // TTL超過を削除
    for (const [key, entry] of cache.entries()) {
      if (now - entry.fetchedAt > TTL_MS) {
        entriesToDelete.push(key);
      }
    }
    entriesToDelete.forEach((key) => cache.delete(key));
    
    // サイズ超過時は最も古いエントリを削除
    if (cache.size >= DETAIL_CACHE_MAX_SIZE) {
      const sorted = Array.from(cache.entries()).sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
      const toDelete = sorted.slice(0, cache.size - DETAIL_CACHE_MAX_SIZE + 1);
      toDelete.forEach(([key]) => cache.delete(key));
    }
  }, []);

  const loadDetailBodyOnly = useCallback(async (id: string, useCache: boolean = true) => {
    // プリフェッチモード（useCache = false）の場合は、inFlightIdRefを変更しない
    // これにより、現在選択中のメールのレスポンスが正しく処理される
    const isPrefetch = !useCache;
    let controller: AbortController;
    
    if (isPrefetch) {
      // プリフェッチ：独立したコントローラーを使用（メインのフェッチに干渉しない）
      controller = new AbortController();
    } else {
      // 通常のフェッチ：前のリクエストをキャンセルしてinFlightIdRefを設定
      abortRef.current?.abort();
      controller = new AbortController();
      abortRef.current = controller;
      inFlightIdRef.current = id;
    }

    // Step 50: キャッシュから取得を試みる（プリフェッチ以外）
    if (!isPrefetch) {
      const cached = detailCacheRef.current.get(id);
      if (cached) {
        const now = Date.now();
        const TTL_MS = 5 * 60 * 1000; // 5分
        if (now - cached.fetchedAt < TTL_MS) {
          // キャッシュヒット：即座に反映（inFlightIdRefと一致する時だけ）
          if (inFlightIdRef.current === id) {
            setDetailError(null);
            setDetailBody({
              plainTextBody: cached.plainTextBody,
              htmlBody: cached.htmlBody,
              bodyNotice: cached.bodyNotice,
              isLoading: false,
              debugLabels: cached.debugLabels,
            });
          }
          return;
        } else {
          // TTL超過：キャッシュから削除
          detailCacheRef.current.delete(id);
        }
      }
    }

    // プリフェッチ以外の場合のみローディング状態を設定
    if (!isPrefetch) {
      setDetailError(null);
      setDetailBody((b) => ({ ...b, isLoading: true }));
    }

    try {
      const res = await fetch(`/api/mailhub/detail?id=${encodeURIComponent(id)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) {
        const errorData = (await res.json().catch(() => ({} as Record<string, unknown>))) as Record<string, unknown>;
        const errorMessage =
          (typeof errorData.message === "string" ? errorData.message : undefined) ||
          (typeof errorData.error === "string" ? errorData.error : undefined) ||
          `${res.status} ${res.statusText}`;
        throw new Error(errorMessage);
      }
      const data = (await res.json()) as { detail: MessageDetail };
      
      // キャッシュに保存（常に実行）
      evictOldCacheEntries();
      const message = messages.find((m) => m.id === id) ?? selectedMessage;
      detailCacheRef.current.set(id, {
        plainTextBody: data.detail.plainTextBody,
        htmlBody: data.detail.htmlBody,
        bodyNotice: data.detail.bodyNotice,
        subject: data.detail.subject ?? message?.subject ?? "",
        from: data.detail.from ?? message?.from ?? "",
        fetchedAt: Date.now(),
        debugLabels: (data.detail as DetailWithDebug).debugLabels,
      });

      // inFlightIdRef.currentと一致する時だけUIを更新（連続クリック対策）
      // selectedIdはstate更新の遅延があるためinFlightIdRefを使用
      if (inFlightIdRef.current === id) {
        setDetailBody({
          plainTextBody: data.detail.plainTextBody,
          htmlBody: data.detail.htmlBody,
          bodyNotice: data.detail.bodyNotice,
          isLoading: false,
          debugLabels: (data.detail as DetailWithDebug).debugLabels,
        });
        if (data.detail.isInProgress !== undefined) {
          setIsClaimedMap((prev) => ({ ...prev, [id]: data.detail.isInProgress ?? false }));
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      // エラーメッセージをより分かりやすく
      let errorMessage = "本文の読み込みに失敗しました";
      if (e instanceof Error) {
        if (e.message.includes("404") || e.message.includes("見つかりません")) {
          errorMessage = "メールが見つかりませんでした";
        } else if (e.message.includes("500") || e.message.includes("サーバーエラー")) {
          errorMessage = "サーバーエラーが発生しました";
        } else if (e.message.includes("insufficient") || e.message.includes("権限が不足")) {
          errorMessage = "Gmail APIの権限が不足しています";
        } else if (e.message.includes("401") || e.message.includes("認証エラー")) {
          errorMessage = "認証エラーが発生しました。再ログインしてください";
        } else if (!e.message.includes("AbortError")) {
          // APIから返されたエラーメッセージをそのまま使用
          errorMessage = e.message;
        }
      }
      // Step 50: selectedIdと一致する時だけエラー表示（連続クリック対策）
      if (selectedId === id && inFlightIdRef.current === id) {
        setDetailError(errorMessage);
        setDetailBody((b) => ({ ...b, isLoading: false }));
      }
    }
  }, [messages, selectedMessage, evictOldCacheEntries, selectedId]);

  const loadThreadSummary = useCallback(async (messageId: string) => {
    threadInFlightRef.current = messageId;
    setThreadError(null);
    setThreadLoading(true);
    try {
      const res = await fetch(`/api/mailhub/thread?messageId=${encodeURIComponent(messageId)}`, { cache: "no-store" });
      if (!res.ok) {
        const errorData = (await res.json().catch(() => ({} as Record<string, unknown>))) as Record<string, unknown>;
        const errorMessage =
          (typeof errorData.message === "string" ? errorData.message : undefined) ||
          (typeof errorData.error === "string" ? errorData.error : undefined) ||
          `${res.status} ${res.statusText}`;
        throw new Error(errorMessage);
      }
      const data = (await res.json()) as { threadId: string; messages: ThreadMessageSummary[] };
      if (threadInFlightRef.current !== messageId) return;
      setThreadSummary({ threadId: data.threadId, messages: data.messages ?? [] });
      setThreadExpandedIds(new Set()); // reset expands when switching message
      setThreadBodies({});
    } catch (e) {
      if (threadInFlightRef.current !== messageId) return;
      setThreadSummary(null);
      setThreadError(e instanceof Error ? e.message : String(e));
    } finally {
      if (threadInFlightRef.current === messageId) setThreadLoading(false);
    }
  }, []);

  const loadThreadBody = useCallback(async (id: string) => {
    setThreadBodies((prev) => ({
      ...prev,
      [id]: { plainTextBody: prev[id]?.plainTextBody ?? null, bodyNotice: prev[id]?.bodyNotice ?? null, isLoading: true, error: null },
    }));
    try {
      const res = await fetch(`/api/mailhub/detail?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!res.ok) {
        const errorData = (await res.json().catch(() => ({} as Record<string, unknown>))) as Record<string, unknown>;
        const errorMessage =
          (typeof errorData.message === "string" ? errorData.message : undefined) ||
          (typeof errorData.error === "string" ? errorData.error : undefined) ||
          `${res.status} ${res.statusText}`;
        throw new Error(errorMessage);
      }
      const data = (await res.json()) as { detail: MessageDetail };
      setThreadBodies((prev) => ({
        ...prev,
        [id]: { plainTextBody: data.detail.plainTextBody, bodyNotice: data.detail.bodyNotice, isLoading: false, error: null },
      }));
    } catch (e) {
      setThreadBodies((prev) => ({
        ...prev,
        [id]: { plainTextBody: prev[id]?.plainTextBody ?? null, bodyNotice: prev[id]?.bodyNotice ?? null, isLoading: false, error: e instanceof Error ? e.message : String(e) },
      }));
    }
  }, []);

  const toggleThreadExpand = useCallback(async (id: string) => {
    setThreadExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    const existing = threadBodies[id];
    if (!existing || (existing.plainTextBody == null && !existing.isLoading && !existing.error)) {
      await loadThreadBody(id);
    }
  }, [threadBodies, loadThreadBody]);

  useEffect(() => {
    if (!selectedMessage?.id) return;
    void loadThreadSummary(selectedMessage.id);
  }, [selectedMessage?.id, loadThreadSummary]);

  // 返信ルートを判定
  const replyRoute = useMemo(() => {
    if (!selectedMessage || !detailBody.plainTextBody) return null;
    const detail: MessageDetail = {
      ...selectedMessage,
      plainTextBody: detailBody.plainTextBody,
      htmlBody: detailBody.htmlBody,
      bodySource: detailBody.htmlBody ? "html" : "plain",
      bodyNotice: detailBody.bodyNotice,
    };
    return routeReply(detail, channelId);
  }, [selectedMessage, detailBody.plainTextBody, detailBody.htmlBody, detailBody.bodyNotice, channelId]);

  // 問い合わせ番号を自動抽出（Step55: replyRouteから取得）
  useEffect(() => {
    if (replyRoute?.kind === "rakuten_rms") {
      // replyRouteにinquiryIdが含まれている場合はそれを使用
      if (replyRoute.inquiryId) {
        setReplyInquiryNumber(replyRoute.inquiryId);
      } else if (detailBody.plainTextBody) {
        // フォールバック: 既存の抽出ロジック
        const extracted = extractInquiryNumber(detailBody.plainTextBody);
        if (extracted) {
          setReplyInquiryNumber(extracted);
        }
      }
    } else {
      setReplyInquiryNumber("");
    }
  }, [replyRoute, detailBody.plainTextBody]);

  // Step 50: 次のメールをプリフェッチ（キャッシュに無い場合のみ）
  const prefetchNextMessage = useCallback((currentId: string | null, messageList: InboxListMessage[]) => {
    if (!currentId || messageList.length === 0) return;
    const currentIndex = messageList.findIndex((m) => m.id === currentId);
    if (currentIndex < 0) return;
    
    // 次の1件を優先、なければ前の1件
    const nextId = messageList[currentIndex + 1]?.id ?? messageList[currentIndex - 1]?.id;
    if (!nextId) return;
    
    // キャッシュに無ければプリフェッチ（useCache=falseで強制フェッチ）
    const cached = detailCacheRef.current.get(nextId);
    const TTL_MS = 5 * 60 * 1000; // 5分
    if (!cached || Date.now() - cached.fetchedAt > TTL_MS) {
      void loadDetailBodyOnly(nextId, false); // バックグラウンドでフェッチ（useCache=false）
    }
  }, [loadDetailBodyOnly]);

  // Step 93: Hover時のprefetch（150ms debounce、同時1件まで）
  const handleRowMouseEnter = useCallback((id: string) => {
    // 現在選択中のメールはprefetch不要
    if (id === selectedId) return;
    
    // キャッシュに新鮮なデータがあればprefetch不要
    const cached = detailCacheRef.current.get(id);
    const TTL_MS = 5 * 60 * 1000; // 5分
    if (cached && Date.now() - cached.fetchedAt < TTL_MS) return;
    
    // 前のタイマーをキャンセル
    if (hoverPrefetchTimerRef.current) {
      clearTimeout(hoverPrefetchTimerRef.current);
      hoverPrefetchTimerRef.current = null;
    }
    
    // 前のprefetchリクエストをキャンセル（同時1件まで）
    if (hoverPrefetchAbortRef.current) {
      hoverPrefetchAbortRef.current.abort();
      hoverPrefetchAbortRef.current = null;
    }
    
    // 150ms後にprefetch開始
    hoverPrefetchTimerRef.current = setTimeout(async () => {
      // 再度キャッシュをチェック（タイマー中に取得された可能性）
      const cachedNow = detailCacheRef.current.get(id);
      if (cachedNow && Date.now() - cachedNow.fetchedAt < TTL_MS) return;
      
      // AbortControllerを作成
      const controller = new AbortController();
      hoverPrefetchAbortRef.current = controller;
      
      try {
        const res = await fetch(`/api/mailhub/detail?id=${encodeURIComponent(id)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) return; // エラーは無視（prefetchなので）
        
        const data = (await res.json()) as { detail: MessageDetail };
        
        // キャッシュに保存
        evictOldCacheEntries();
        const message = messages.find((m) => m.id === id);
        detailCacheRef.current.set(id, {
          plainTextBody: data.detail.plainTextBody,
          htmlBody: data.detail.htmlBody,
          bodyNotice: data.detail.bodyNotice,
          subject: data.detail.subject ?? message?.subject ?? "",
          from: data.detail.from ?? message?.from ?? "",
          fetchedAt: Date.now(),
          debugLabels: (data.detail as DetailWithDebug).debugLabels,
        });
      } catch {
        // AbortErrorやネットワークエラーは無視（prefetchなので）
      } finally {
        if (hoverPrefetchAbortRef.current === controller) {
          hoverPrefetchAbortRef.current = null;
        }
      }
    }, 150);
  }, [selectedId, messages, evictOldCacheEntries]);
  
  // Step 93: マウス離脱時にタイマーをキャンセル
  const handleRowMouseLeave = useCallback(() => {
    if (hoverPrefetchTimerRef.current) {
      clearTimeout(hoverPrefetchTimerRef.current);
      hoverPrefetchTimerRef.current = null;
    }
    // 注意: 進行中のリクエストはキャンセルしない（完了させてキャッシュに保存）
  }, []);

  const onSelectMessage = useCallback((id: string) => {
    if (id === selectedId) return;
    
    // Step 50: キャッシュから即座に表示を試みる
    const cached = detailCacheRef.current.get(id);
    const TTL_MS = 5 * 60 * 1000; // 5分
    const hasFreshCache = cached && Date.now() - cached.fetchedAt < TTL_MS;
    
    // flushSyncを使って、選択メッセージとタイトルと本文の更新を同期的に行う
    // これにより、連続クリック時にタイトルと本文がずれる問題を防ぐ
    const selectedMsg = messages.find((m) => m.id === id) ?? null;
    flushSync(() => {
      setSelectedId(id);
      setSelectedMessage(selectedMsg);
      setReplyMessage(""); // 返信メッセージをリセット
      setLastAppliedTemplate(null); // テンプレ適用状態をリセット
      setBodyCollapsed(false); // 本文の折りたたみをリセット
      setDetailError(null);
      
      if (hasFreshCache && cached) {
        // キャッシュヒット：即座に表示
        setDetailBody({
          plainTextBody: cached.plainTextBody,
          htmlBody: cached.htmlBody,
          bodyNotice: cached.bodyNotice,
          isLoading: false,
          debugLabels: cached.debugLabels,
        });
      } else {
        // キャッシュがない場合：ローディング状態を表示
        setDetailBody({ plainTextBody: null, htmlBody: null, bodyNotice: null, isLoading: true });
      }
    });
    
    // バックグラウンドで最新データを取得
    if (hasFreshCache) {
      void loadDetailBodyOnly(id, false);
    } else {
      void loadDetailBodyOnly(id);
    }
    // Step 51: 検索クエリをURLに保持（idだけ変える時もqが消えないように）
    replaceUrl(labelId, id, true, serverSearchQuery || undefined);
    
    // Step 50: 次のメールをプリフェッチ
    prefetchNextMessage(id, messages);
    
    // Step 105: Seenとして記録
    markAsSeen(id);
  }, [selectedId, messages, labelId, serverSearchQuery, replaceUrl, loadDetailBodyOnly, prefetchNextMessage, markAsSeen]);

  const handleMoveSelection = useCallback((direction: "up" | "down") => {
    if (slaFilteredMessages.length === 0) return;
    const currentIndex = slaFilteredMessages.findIndex((m) => m.id === selectedId);
    let nextIndex = 0;
    if (direction === "up") {
      nextIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
    } else {
      nextIndex = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, slaFilteredMessages.length - 1);
    }
    const nextMessage = slaFilteredMessages[nextIndex];
    if (nextMessage && nextMessage.id !== selectedId) {
      onSelectMessage(nextMessage.id);
      setTimeout(() => {
        const row = document.querySelector(`[data-message-id="${nextMessage.id}"]`);
        row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }, 0);
    }
  }, [slaFilteredMessages, selectedId, onSelectMessage]);

  const applyRulesBestEffort = useCallback(async (messageIds: string[]) => {
    if (messageIds.length === 0) return;
    try {
      const res = (await postJsonOrThrow("/api/mailhub/rules/apply", {
        messageIds,
      })) as { appliedDetails?: Array<{ id: string; labels: string[] }> };
      const appliedDetails = res?.appliedDetails ?? [];
      if (appliedDetails.length === 0) return;
      const idToLabels = new Map(appliedDetails.map((x) => [x.id, x.labels] as const));
      setMessages((prev) =>
        prev.map((m) => {
          const add = idToLabels.get(m.id);
          if (!add?.length) return m;
          const next = new Set([...(m.userLabels ?? []), ...add]);
          return { ...m, userLabels: [...next] };
        }),
      );
      setSelectedMessage((prev) => {
        if (!prev) return prev;
        const add = idToLabels.get(prev.id);
        if (!add?.length) return prev;
        const next = new Set([...(prev.userLabels ?? []), ...add]);
        return { ...prev, userLabels: [...next] };
      });
    } catch {
      // ignore（一覧表示が最優先）
    }
  }, []);

  const loadList = useCallback(async (
    nextLabelId: string,
    preferredSelectedId: string | null,
    opts?: {
      q?: string;
      statusType?: "todo" | "waiting" | "muted" | "snoozed";
      assignee?: "mine" | "unassigned";
      keepView?: boolean;
      viewId?: string | null;
      assigneeSlug?: string; // Step 64: Team View - 任意のassigneeSlugを指定可能
    },
  ) => {
    setListError(null);
    
    // リクエストIDを更新（レースコンディション対策）
    const requestId = `${nextLabelId}-${Date.now()}`;
    inFlightIdRef.current = requestId;
    
    try {
      const params = new URLSearchParams();
      params.set("label", nextLabelId);
      params.set("max", String(listMax)); // Step 104: URL指定のmaxを使用
      if (opts?.q) params.set("q", opts.q);
      if (opts?.statusType) params.set("statusType", opts.statusType);
      if (opts?.assigneeSlug) params.set("assigneeSlug", opts.assigneeSlug);
      else if (opts?.assignee === "mine") params.set("assigneeSlug", myAssigneeSlug);
      if (opts?.assignee === "unassigned") params.set("unassigned", "1");
      const url = `/api/mailhub/list?${params.toString()}`;
      const data = await fetchJson<{ label: string; messages: InboxListMessage[]; nextPageToken?: string }>(url);
      
      // リクエストIDが変わっていたら無視（レースコンディション対策）
      if (inFlightIdRef.current !== requestId) return;
      
      // 状態を更新
      setMessages(data.messages);
      setNextPageToken(data.nextPageToken ?? null); // Step 103
      // Step 23: 一覧表示をブロックしない形で「自動ルール適用」を裏で走らせる（best-effort）
      void applyRulesBestEffort(data.messages.map((m) => m.id));
      // Channels件数を更新（別画面へ移動しても消えない）
      const nextLabel = labelGroups.flatMap((g) => g.items).find((it) => it.id === nextLabelId);
      if (testMode && nextLabel?.type === "channel") {
        setChannelCounts((prev) => ({ ...prev, [nextLabelId]: data.messages.length }));
      }

      const nextSelected =
        preferredSelectedId && data.messages.some((m) => m.id === preferredSelectedId)
          ? preferredSelectedId
          : data.messages[0]?.id ?? null;
      setSelectedId(nextSelected);
      setSelectedMessage(
        nextSelected ? data.messages.find((m) => m.id === nextSelected) ?? null : null,
      );
      if (opts?.viewId) {
        replaceUrlWithView(opts.viewId, nextLabelId, nextSelected);
      } else {
        // Step 51: 検索クエリをURLに保持
        replaceUrl(nextLabelId, nextSelected, opts?.keepView ?? true, opts?.q);
      }
      if (nextSelected) {
        void loadDetailBodyOnly(nextSelected);
        // Step 50拡張: 表示されている最初の5件のメールの詳細をバックグラウンドでプリフェッチ
        const prefetchIds = data.messages.slice(0, 5).map((m) => m.id).filter((id) => id !== nextSelected);
        const TTL_MS = 5 * 60 * 1000; // 5分
        for (const id of prefetchIds) {
          const cached = detailCacheRef.current.get(id);
          if (!cached || Date.now() - cached.fetchedAt > TTL_MS) {
            void loadDetailBodyOnly(id, false); // バックグラウンドでフェッチ
          }
        }
      } else {
        setDetailBody({ plainTextBody: null, htmlBody: null, bodyNotice: null, isLoading: false });
      }
    } catch (e) {
      // リクエストIDが変わっていたら無視
      if (inFlightIdRef.current !== requestId) return;
      
      const errorMessage = e instanceof Error ? e.message : String(e);
      setListError(errorMessage);
    }
  }, [labelGroups, loadDetailBodyOnly, replaceUrl, replaceUrlWithView, testMode, applyRulesBestEffort, myAssigneeSlug, listMax]);

  // Step 103: Load more（次ページ読み込み）
  const handleLoadMore = useCallback(async () => {
    if (!nextPageToken || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const params = new URLSearchParams();
      params.set("label", labelId);
      params.set("max", String(listMax)); // Step 104: URL指定のmaxを使用
      params.set("pageToken", nextPageToken);
      if (serverSearchQuery) params.set("q", serverSearchQuery);
      const url = `/api/mailhub/list?${params.toString()}`;
      const data = await fetchJson<{ label: string; messages: InboxListMessage[]; nextPageToken?: string }>(url);
      // 重複除外してappend
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const newMsgs = data.messages.filter((m) => !existingIds.has(m.id));
        return [...prev, ...newMsgs];
      });
      setNextPageToken(data.nextPageToken ?? null);
    } catch (e) {
      console.error("Load more error:", e);
    } finally {
      setIsLoadingMore(false);
    }
  }, [nextPageToken, isLoadingMore, labelId, serverSearchQuery, listMax]);

  // Step 23: 初期表示（SSRで届いたmessages）でもルール適用を走らせる（best-effort）
  const lastRulesApplyKeyRef = useRef<string>("");
  useEffect(() => {
    if (messages.length === 0) return;
    const key = `${labelId}:${messages.map((m) => m.id).join(",")}`;
    if (lastRulesApplyKeyRef.current === key) return;
    lastRulesApplyKeyRef.current = key;
    void applyRulesBestEffort(messages.map((m) => m.id));
  }, [applyRulesBestEffort, labelId, messages]);

  const fetchRegisteredLabels = useCallback(async () => {
    try {
      const data = await fetchJson<{ labels: Array<{ labelName: string; displayName?: string; createdAt: string }> }>("/api/mailhub/labels");
      setRegisteredLabels(data.labels ?? []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void fetchRegisteredLabels();
  }, [fetchRegisteredLabels]);

  // Step 52: Fetch saved searches (queues)
  const fetchSavedSearches = useCallback(async () => {
    try {
      const data = await fetchJson<{ searches: Array<{ id: string; name: string; query: string; baseLabelId?: string | null }> }>("/api/mailhub/queues");
      setSavedSearches(data.searches ?? []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void fetchSavedSearches();
  }, [fetchSavedSearches]);

  useEffect(() => {
    // Settingsはadminのみ表示（サーバ側でも拒否するが、UIでも事故防止）
    // NOTE: TEST_MODEではE2EでSettingsを確実に操作できるように、admin扱いで表示する。
    void (async () => {
      try {
        const res = await fetch("/api/mailhub/config/health", { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as {
          isAdmin?: boolean;
          readOnly?: boolean;
          gmailModifyEnabled?: boolean | null;
        };
        const admin = testMode ? true : json.isAdmin === true;
        setCanOpenSettings(admin);
        setIsAdmin(admin);
        const blocked =
          json.readOnly === true
            ? ("read_only" as const)
            : json.gmailModifyEnabled === false
              ? ("insufficient_permissions" as const)
              : null;
        setWriteBlockedReason(blocked);
        setReadOnlyMode(blocked !== null);
      } catch {
        setCanOpenSettings(testMode);
        setIsAdmin(testMode);
        setWriteBlockedReason(null);
        setReadOnlyMode(false);
      }
    })();
  }, [testMode]);

  const getWriteBlockedTitle = useCallback(() => {
    if (writeBlockedReason === "read_only") return "READ ONLYのため実行できません";
    if (writeBlockedReason === "insufficient_permissions") return "Gmail権限が不足しています（gmail.modify が必要）";
    return null;
  }, [writeBlockedReason]);

  useEffect(() => {
    if (!labelPopoverOpen) return;
    const onDown = (e: MouseEvent) => {
      const pop = labelPopoverRef.current;
      const btn = labelButtonRef.current;
      if (!(e.target instanceof Node)) return;
      if (pop && pop.contains(e.target)) return;
      if (btn && btn.contains(e.target)) return;
      setLabelPopoverOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [labelPopoverOpen]);

  const openLabelPopover = useCallback(() => {
    const rect = labelButtonRef.current?.getBoundingClientRect();
    if (rect) {
      const width = 320;
      const padding = 12;
      const left = Math.min(Math.max(rect.left, padding), Math.max(padding, window.innerWidth - width - padding));
      const top = rect.bottom + 8;
      setLabelPopoverPos({ top, left });
    } else {
      setLabelPopoverPos({ top: 56, left: 16 });
    }
    setLabelPopoverOpen(true);
    void fetchRegisteredLabels();
  }, [fetchRegisteredLabels]);

  // Snooze popover handlers
  useEffect(() => {
    if (!snoozePopoverOpen) return;
    const onDown = (e: MouseEvent) => {
      const pop = snoozePopoverRef.current;
      const btn = snoozeButtonRef.current;
      if (!(e.target instanceof Node)) return;
      if (pop && pop.contains(e.target)) return;
      if (btn && btn.contains(e.target)) return;
      setSnoozePopoverOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [snoozePopoverOpen]);

  // Step 71: take=1 で担当UIを自動で開く（1回だけ）
  useEffect(() => {
    if (takeAutoOpenDone.current) return;
    if (!selectedId) return;
    if (readOnlyMode) return;
    if (typeof window === "undefined") return;
    
    const params = new URLSearchParams(window.location.search);
    const takeParam = params.get("take");
    if (takeParam !== "1") return;
    
    // 自動オープン実行
    takeAutoOpenDone.current = true;
    setAssigneeSelectorMessageId(selectedId);
    setShowAssigneeSelector(true);
    
    // URLからtake=1を削除（事故防止・戻る対策）
    params.delete("take");
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, "", newUrl);
  }, [selectedId, readOnlyMode]);

  const openSnoozePopover = useCallback(() => {
    const rect = snoozeButtonRef.current?.getBoundingClientRect();
    if (rect) {
      const width = 240;
      const padding = 12;
      const left = Math.min(Math.max(rect.left, padding), Math.max(padding, window.innerWidth - width - padding));
      const top = rect.bottom + 8;
      setSnoozePopoverPos({ top, left });
    } else {
      setSnoozePopoverPos({ top: 56, left: 16 });
    }
    setSnoozePopoverOpen(true);
  }, []);

  // Step 52: Queues popover handlers
  useEffect(() => {
    if (!queuesPopoverOpen) return;
    const onDown = (e: MouseEvent) => {
      const pop = queuesPopoverRef.current;
      const btn = queuesButtonRef.current;
      if (!(e.target instanceof Node)) return;
      if (pop && pop.contains(e.target)) return;
      if (btn && btn.contains(e.target)) return;
      setQueuesPopoverOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [queuesPopoverOpen]);

  const openQueuesPopover = useCallback(() => {
    const rect = queuesButtonRef.current?.getBoundingClientRect();
    if (rect) {
      const width = 320;
      const padding = 12;
      const left = Math.min(Math.max(rect.left, padding), Math.max(padding, window.innerWidth - width - padding));
      const top = rect.bottom + 8;
      setQueuesPopoverPos({ top, left });
    } else {
      setQueuesPopoverPos({ top: 56, left: 16 });
    }
    setQueuesPopoverOpen(true);
    void fetchSavedSearches();
  }, [fetchSavedSearches]);

  const applyQueue = useCallback((search: { id: string; name: string; query: string; baseLabelId?: string | null }) => {
    const targetLabelId = search.baseLabelId ?? labelId;
    setSearchTerm(search.query);
    setServerSearchQuery(search.query);
    if (targetLabelId !== labelId) {
      setLabelId(targetLabelId);
    }
    void loadList(targetLabelId, null, { q: search.query });
    setQueuesPopoverOpen(false);
  }, [labelId, loadList]);

  // テストモード: Channelsの件数を事前に取得して保持（画面移動で消えない + 初回から表示）
  useEffect(() => {
    if (!testMode) return;
    const channelGroup = labelGroups.find((g) => g.id === "channels");
    const channelIds = (channelGroup?.items ?? []).filter((it) => it.type === "channel").map((it) => it.id);
    if (channelIds.length === 0) return;

    // すでに全件揃っていれば何もしない
    const hasAll = channelIds.every((id) => typeof channelCounts[id] === "number");
    if (hasAll) return;

    let cancelled = false;
    (async () => {
      try {
        // 取得は軽量化のため max=20（現状UIの表示と一致）
        const results = await Promise.all(
          channelIds.map(async (id) => {
            const url = `/api/mailhub/list?label=${encodeURIComponent(id)}&max=20`;
            const data = await fetchJson<{ label: string; messages: InboxListMessage[] }>(url);
            return [id, data.messages.length] as const;
          }),
        );
        if (cancelled) return;
        setChannelCounts((prev) => {
          const next = { ...prev };
          results.forEach(([id, c]) => {
            next[id] = c;
          });
          return next;
        });
      } catch {
        // ignore（表示が消えないことが最優先。失敗時は現状維持）
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [testMode, labelGroups, channelCounts]);

  // 初期化時にメールが空の場合、loadListを呼ぶ（loadList定義後に配置）
  useEffect(() => {
    if (messages.length === 0 && initialMessages.length === 0 && !listError && !isPending) {
      startTransition(async () => {
        try {
          await loadList(labelId, null);
        } catch (e) {
          setListError(e instanceof Error ? e.message : String(e));
        }
      });
    }
  }, [messages.length, initialMessages.length, listError, isPending, labelId, loadList]);

  const onSelectLabel = useCallback((item: LabelItem) => {
    // 同じラベルでも再読み込みする（リストが更新されない問題を修正）
    setLabelId(item.id);
    setActiveViewId(null);
    // Step 64: Team View をクリア
    setActiveAssigneeSlug(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("assignee");
      window.history.replaceState({}, "", url.toString());
    }
    
    // ステータスラベルをクリックしたときは、対応するviewTabを設定（タブとサイドバーをリンク）
    if (item.statusType === "todo") {
      setViewTab("inbox");
    } else if (item.statusType === "waiting") {
      setViewTab("waiting");
    } else if (item.statusType === "muted") {
      setViewTab("muted");
    } else if (item.statusType === "snoozed") {
      setViewTab("snoozed");
    } else if (item.id === "assigned" || item.type === "assignee" && item.id === "mine") {
      // 担当ラベルをクリックした場合
      setViewTab("assigned");
    } else {
      // その他のラベル（チャンネルなど）の場合は受信箱に
      setViewTab("inbox");
    }
    
    // channelIdを更新（labelIdから推測）
    if (item.id === "store-a" || item.id === "store-b" || item.id === "store-c") {
      setChannelId(item.id as ChannelId);
    } else {
      setChannelId("all");
    }
    
    // loadList内でreplaceUrlが呼ばれるため、ここでは呼ばない
    // startTransitionを使ってloadListを呼ぶ（Reactの状態更新を確実にする）
    startTransition(async () => {
      try {
        await loadList(item.id, null, { 
          keepView: false,
          statusType: item.statusType === "snoozed" ? "snoozed" : undefined,
        });
        listRef.current?.scrollTo({ top: 0 });
      } catch (e) {
        setListError(e instanceof Error ? e.message : String(e));
      }
    });
  }, [loadList]);

  const onSelectView = useCallback((viewId: string) => {
    const v = views.find((x) => x.id === viewId);
    if (!v) return;
    setActiveViewId(viewId);
    setLabelId(v.labelId);
    startTransition(async () => {
      try {
        await loadList(v.labelId, null, {
          q: v.q,
          assignee: v.assignee ?? undefined,
          statusType: v.statusType ?? undefined,
          viewId,
        });
        listRef.current?.scrollTo({ top: 0 });
      } catch (e) {
        setListError(e instanceof Error ? e.message : String(e));
      }
    });
  }, [loadList, views]);

  const reloadCurrentList = useCallback(() => {
    startTransition(async () => {
      try {
        // Step 51: 検索クエリがある場合は再検索
        await loadList(labelId, selectedId, serverSearchQuery ? { q: serverSearchQuery } : {});
        void fetchCountsDebounced();
      } catch (e) {
        setListError(e instanceof Error ? e.message : String(e));
      }
    });
  }, [labelId, selectedId, serverSearchQuery, loadList, fetchCountsDebounced]);

  const refreshLightSync = useCallback(() => {
    reloadCurrentList();
    void fetchActivityLogs();
  }, [reloadCurrentList, fetchActivityLogs]);

  const shouldSkipAutoSync = useCallback(() => {
    if (typeof document === "undefined") return true;
    if (document.visibilityState && document.visibilityState !== "visible") return true;
    const active = document.activeElement as HTMLElement | null;
    if (!active) return false;
    const tag = active.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea") return true;
    if (active.isContentEditable) return true;
    if (active.getAttribute("role") === "textbox") return true;
    return false;
  }, []);

  useEffect(() => {
    const handler = () => {
      if (shouldSkipAutoSync()) return;
      const now = Date.now();
      if (now - lastFocusSyncAtRef.current < 60_000) return;
      lastFocusSyncAtRef.current = now;
      refreshLightSync();
    };
    window.addEventListener("focus", handler);
    const onVisibility = () => {
      if (document.visibilityState === "visible") handler();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", handler);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshLightSync, shouldSkipAutoSync]);

  const handleAssignedStatusClick = useCallback(() => {
    setViewTab("assigned");
    // 担当タブ: 担当ラベルでフィルタリングしてメッセージを取得
    const todoLabel = labelGroups.flatMap((g) => g.items).find((item) => item.statusType === "todo");
    if (!todoLabel) return;
    startTransition(async () => {
      try {
        // 担当ラベルでフィルタリング（担当タブ専用）
        const url = `/api/mailhub/list?label=${encodeURIComponent(todoLabel.id)}&max=100&assigneeSlug=${encodeURIComponent(myAssigneeSlug)}`;
        const data = await fetchJson<{ label: string; messages: InboxListMessage[] }>(url);
        setMessages(data.messages);
        // 最初の担当メールを選択
        const assignedMessage = data.messages[0];
        if (assignedMessage) {
          setSelectedId(assignedMessage.id);
          setSelectedMessage(assignedMessage);
          replaceUrl(todoLabel.id, assignedMessage.id);
          void loadDetailBodyOnly(assignedMessage.id);
        } else {
          setSelectedId(null);
          setSelectedMessage(null);
          replaceUrl(todoLabel.id, null);
        }
        listRef.current?.scrollTo({ top: 0 });
      } catch (e) {
        setListError(e instanceof Error ? e.message : String(e));
      }
    });
  }, [
    labelGroups,
    loadDetailBodyOnly,
    myAssigneeSlug,
    replaceUrl,
    setSelectedId,
    setSelectedMessage,
    setMessages,
    startTransition,
    setListError,
  ]);

  // Step 64: Team View - チームメンバー選択ハンドラ
  const handleSelectTeamMember = useCallback((email: string) => {
    const memberSlug = email.replace("@", "_at_").replace(/\./g, "_");
    setActiveAssigneeSlug(memberSlug);
    setViewTab("inbox");
    const todoLabel = labelGroups.flatMap((g) => g.items).find((item) => item.statusType === "todo");
    if (!todoLabel) return;
    startTransition(async () => {
      try {
        await loadList(todoLabel.id, null, { assigneeSlug: memberSlug });
        setLabelId(todoLabel.id);
        // URLにassigneeパラメータを追加
        const url = new URL(window.location.href);
        url.searchParams.set("assignee", memberSlug);
        url.searchParams.delete("id");
        window.history.replaceState({}, "", url.toString());
        listRef.current?.scrollTo({ top: 0 });
      } catch (e) {
        setListError(e instanceof Error ? e.message : String(e));
      }
    });
  }, [labelGroups, loadList, setLabelId, startTransition, setListError]);

  const showToast = useCallback((
    message: string,
    type: "success" | "error" | "info",
  ) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
    }, type === "info" ? 3000 : 10000); // infoは3秒で自動消去
  }, []);

  const handleRegisterNewLabel = useCallback(async () => {
    const name = newLabelName.trim();
    if (!name) return;
    if (readOnlyMode) {
      showToast(getWriteBlockedTitle() ?? "実行できません", "error");
      return;
    }
    try {
      const labelName = buildMailhubLabelName(name);
      await postJsonOrThrow("/api/mailhub/labels", { labelName, displayName: name });
      setNewLabelName("");
      await fetchRegisteredLabels();
      showToast("ラベルを登録しました", "success");
    } catch (e) {
      showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }, [newLabelName, fetchRegisteredLabels, getWriteBlockedTitle, readOnlyMode, showToast]);

  const handleToggleLabelForSelection = useCallback(async (labelName: string) => {
    if (selectedIds.length === 0) return;
    if (readOnlyMode) {
      showToast(getWriteBlockedTitle() ?? "実行できません", "error");
      return;
    }
    // Step 73: 二重送信防止
    if (selectedIds.some((id) => actionInProgress.has(id))) return;
    setActionInProgress((prev) => {
      const next = new Set(prev);
      selectedIds.forEach((id) => next.add(id));
      return next;
    });
    
    const state = labelSelectionState.get(labelName);
    const shouldRemove = state?.all === true;

    const previousMessages = [...messages];
    const previousSelectedMessage = selectedMessage;

    const applyLocal = (arr: string[] | undefined, remove: boolean) => {
      const set = new Set(arr ?? []);
      if (remove) set.delete(labelName);
      else set.add(labelName);
      const next = [...set];
      return next.length ? next : undefined;
    };

    // 楽観更新（UIを即反映）
    setMessages((prev) =>
      prev.map((m) =>
        selectedIds.includes(m.id) ? { ...m, userLabels: applyLocal(m.userLabels, shouldRemove) } : m,
      ),
    );
    setSelectedMessage((prev) =>
      prev && selectedIds.includes(prev.id) ? { ...prev, userLabels: applyLocal(prev.userLabels, shouldRemove) } : prev,
    );

    try {
      await postJsonOrThrow("/api/mailhub/labels/apply", {
        ids: selectedIds,
        add: shouldRemove ? [] : [labelName],
        remove: shouldRemove ? [labelName] : [],
      });

      // 単体選択時のみ: 「この送信元に今後も自動適用」= ルール保存（デフォルトはfromEmail完全一致）
      if (!shouldRemove && autoApplyRule && selectedIds.length === 1 && singleSelectedFromEmail) {
        const match =
          autoApplyRuleMatchMode === "domain" && singleSelectedFromDomain
            ? { fromDomain: singleSelectedFromDomain }
            : { fromEmail: singleSelectedFromEmail };
        if ("fromDomain" in match && match.fromDomain && isBroadDomain(match.fromDomain)) {
          const ok = window.confirm(
            `⚠️ fromDomain が広範囲です（誤爆の可能性）: ${match.fromDomain}\n\nこのドメイン配下のメールに自動でラベルが付きます。作成しますか？`,
          );
          if (!ok) {
            showToast("ルール作成をキャンセルしました（手動ラベルのみ適用）", "success");
            return;
          }
        }
        await postJsonOrThrow("/api/mailhub/rules", { match, labelNames: [labelName], enabled: true });
        showToast("ラベルを付与しました（ルール保存）", "success");
      } else {
        showToast(shouldRemove ? "ラベルを解除しました" : "ラベルを付与しました", "success");
      }
    } catch (e) {
      // ロールバック
      setMessages(previousMessages);
      setSelectedMessage(previousSelectedMessage);
      showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      // Step 73: ロック解除（success/fail両方で保証）
      setActionInProgress((prev) => {
        const next = new Set(prev);
        selectedIds.forEach((id) => next.delete(id));
        return next;
      });
    }
  }, [
    actionInProgress,
    autoApplyRule,
    autoApplyRuleMatchMode,
    getWriteBlockedTitle,
    labelSelectionState,
    messages,
    readOnlyMode,
    selectedIds,
    selectedMessage,
    showToast,
    singleSelectedFromDomain,
    singleSelectedFromEmail,
  ]);

  // テストモードのリセット機能
  const handleTestReset = useCallback(async () => {
    if (!testMode) return;
    
    try {
      const res = await fetch("/api/mailhub/test/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      
      if (!res.ok) {
        const errorData = (await res.json().catch(() => ({} as Record<string, unknown>))) as Record<string, unknown>;
        const msg = typeof errorData.message === "string" ? errorData.message : null;
        throw new Error(msg || `${res.status} ${res.statusText}`);
      }
      
      // リセット成功後、ページをリロードして初期状態に戻す
      window.location.reload();
    } catch (e) {
      showToast(`リセット失敗: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }, [testMode, showToast]);

  const addToUndoStack = useCallback((item: UndoItem) => {
    setUndoStack((prev) => [item, ...prev].slice(0, 10)); // 最大10件まで保持
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast(null);
  }, []);

  const handleArchive = useCallback(async (id: string) => {
    // Step 59: 二重押し防止
    if (actionInProgress.has(id)) return;
    setActionInProgress((prev) => new Set(prev).add(id));

    const targetMessage = messages.find((m) => m.id === id);
    if (!targetMessage) {
      setActionInProgress((prev) => { const next = new Set(prev); next.delete(id); return next; });
      return;
    }

    const fromStatus = activeLabel?.statusType ?? "todo";
    // 楽観的にカウント反映（失敗時は戻す）
    const delta: Partial<{ todo: number; waiting: number; done: number; muted: number }> =
      fromStatus === "waiting"
        ? { waiting: -1, done: +1 }
        : fromStatus === "muted"
          ? { muted: -1, done: +1 }
          : { todo: -1, done: +1 };
    const inverseDelta: Partial<{ todo: number; waiting: number; done: number; muted: number }> =
      fromStatus === "waiting"
        ? { waiting: +1, done: -1 }
        : fromStatus === "muted"
          ? { muted: +1, done: -1 }
          : { todo: +1, done: -1 };
    
    // 即座にUI更新（レスポンス改善）
    bumpCounts(delta);
    
    // Flash効果（一瞬明るく）- 即座に開始
    setFlashingIds((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setFlashingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 100); // 150ms → 100msに短縮
    
    // アニメーション開始（Flashと同時にスライド）
    // 担当タブは「担当ラベルの総覧」なので、完了しても一覧から消さない（以前の保留バグと同型）
    const shouldRemoveFromCurrentList = viewTab !== "assigned";
    if (shouldRemoveFromCurrentList) {
      setRemovingIds((prev) => new Set(prev).add(id));
    }
    
    // Glow effect（Doneタブを強く光らせる）- 即座に開始
    setGlowTab("done");
    setTimeout(() => setGlowTab(null), 1000); // 1500ms → 1000msに短縮

    const previousMessages = [...messages];
    if (shouldRemoveFromCurrentList) {
      const currentIndex = previousMessages.findIndex((m) => m.id === id);
      const newMessages = previousMessages.filter((m) => m.id !== id);
      
      // 即座にメッセージリストから削除（レスポンス改善）
      setMessages(newMessages);
      
      // 次のメッセージを選択（即座に）
      const nextMessage = newMessages[currentIndex] ?? newMessages[currentIndex - 1] ?? newMessages[0] ?? null;
      if (nextMessage) {
        onSelectMessage(nextMessage.id);
      } else {
        setSelectedId(null);
        setSelectedMessage(null);
        setDetailBody({ plainTextBody: null, htmlBody: null, bodyNotice: null, isLoading: false });
        replaceUrl(labelId, null);
      }
    }
    
    // アニメーション完了後にremovingIdsをクリア（短縮）
    setTimeout(() => {
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 200); // 500ms → 200msに短縮

    // 即座に処理中トーストを表示（体感改善）
    showToast("処理中...", "info");
    
    // APIリクエストを非同期で実行（UIをブロックしない）
    void (async () => {
      try {
        await postJsonOrThrow("/api/mailhub/archive", { id, action: "archive" });
        addToUndoStack({ id, message: targetMessage, action: "archive" });
        showToast("完了しました", "success");
        // カウントは楽観的更新で既に反映済み。必要に応じてバックグラウンドで更新
        void fetchCountsDebounced();
      } catch (e) {
        // エラー時のみロールバック
        bumpCounts(inverseDelta);
        setRemovingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setMessages(previousMessages);
        setSelectedId(id);
        setSelectedMessage(targetMessage);
        const errorMessage = e instanceof Error ? e.message : String(e);
        showToast(`エラー: ${errorMessage}`, "error");
      } finally {
        // Step 59: 処理完了後にフラグクリア
        setActionInProgress((prev) => { const next = new Set(prev); next.delete(id); return next; });
      }
    })();
  }, [messages, activeLabel?.statusType, bumpCounts, labelId, onSelectMessage, replaceUrl, showToast, fetchCountsDebounced, addToUndoStack, viewTab, actionInProgress]);

  const handleSetWaiting = useCallback(async (id: string) => {
    // Step 59: 二重押し防止
    if (actionInProgress.has(id)) return;
    setActionInProgress((prev) => new Set(prev).add(id));

    const targetMessage = messages.find((m) => m.id === id);
    if (!targetMessage) {
      setActionInProgress((prev) => { const next = new Set(prev); next.delete(id); return next; });
      return;
    }

    // 現在の状態が Waiting かどうかを確認
    const isCurrentlyWaiting = activeLabel?.statusType === "waiting";
    const action = isCurrentlyWaiting ? "unsetWaiting" : "setWaiting";
    const delta: Partial<{ todo: number; waiting: number; done: number; muted: number }> = isCurrentlyWaiting
      ? { waiting: -1, todo: +1 }
      : { todo: -1, waiting: +1 };
    const inverseDelta: Partial<{ todo: number; waiting: number; done: number; muted: number }> = isCurrentlyWaiting
      ? { waiting: +1, todo: -1 }
      : { todo: +1, waiting: -1 };
    
    // 即座にUI更新（レスポンス改善）
    bumpCounts(delta);
    
    // Flash効果（即座に開始）
    setFlashingIds((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setFlashingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 100); // 150ms → 100msに短縮
    
    // アニメーション開始（Flashと同時にスライド）
    const shouldRemoveFromCurrentList = viewTab !== "assigned";
    if (shouldRemoveFromCurrentList) {
      setRemovingIds((prev) => new Set(prev).add(id));
    }
    
    // Glow effect（即座に開始）
    setGlowTab(isCurrentlyWaiting ? "todo" : "waiting");
    setTimeout(() => setGlowTab(null), 1000); // 1500ms → 1000msに短縮

    const previousMessages = [...messages];
    if (shouldRemoveFromCurrentList) {
      const currentIndex = previousMessages.findIndex((m) => m.id === id);
      const newMessages = previousMessages.filter((m) => m.id !== id);
      
      // 即座にメッセージリストから削除（レスポンス改善）
      setMessages(newMessages);
      
      // 次のメッセージを選択（即座に）
      const nextMessage = newMessages[currentIndex] ?? newMessages[currentIndex - 1] ?? newMessages[0];
      if (nextMessage) {
        onSelectMessage(nextMessage.id);
      } else {
        setSelectedId(null);
        setSelectedMessage(null);
        setDetailBody({ plainTextBody: null, htmlBody: null, bodyNotice: null, isLoading: false });
        replaceUrl(labelId, null);
      }
    }
    
    // アニメーション完了後にremovingIdsをクリア（短縮）
    setTimeout(() => {
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 200); // 500ms → 200msに短縮

    // APIリクエストを非同期で実行（UIをブロックしない）
    // 担当情報は保持される（setWaitingは担当ラベルを削除しない）
    void (async () => {
      try {
        await postJsonOrThrow("/api/mailhub/status", { id, action });
        
        // 保留タブに移動した際に、担当情報が正しく表示されるように、保留ラベルで再読み込み
        // ただし、現在保留タブにいる場合のみ再読み込み（不要な再読み込みを避ける）
        if (!isCurrentlyWaiting && viewTab === "waiting") {
          const waitingLabel = labelGroups.flatMap((g) => g.items).find((item) => item.statusType === "waiting");
          if (waitingLabel) {
            // 保留タブで再読み込み（担当情報を含む）
            await loadList(waitingLabel.id, null);
          }
        }
        
        addToUndoStack({ 
          id, 
          message: targetMessage, 
          action: isCurrentlyWaiting ? "unsetWaiting" : "setWaiting" 
        });
        showToast(isCurrentlyWaiting ? "Todoに戻しました" : "保留にしました", "success");
        // カウントは楽観的更新で既に反映済み。必要に応じてバックグラウンドで更新
        void fetchCountsDebounced();
      } catch (e) {
        // エラー時のみロールバック
        bumpCounts(inverseDelta);
        setRemovingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setMessages(previousMessages);
        setSelectedId(id);
        setSelectedMessage(targetMessage);
        const errorMessage = e instanceof Error ? e.message : String(e);
        showToast(`エラー: ${errorMessage}`, "error");
      } finally {
        // Step 59: 処理完了後にフラグクリア
        setActionInProgress((prev) => { const next = new Set(prev); next.delete(id); return next; });
      }
    })();
  }, [messages, labelId, activeLabel?.statusType, viewTab, labelGroups, bumpCounts, onSelectMessage, loadList, replaceUrl, showToast, fetchCountsDebounced, addToUndoStack, actionInProgress]);

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
        const errorData = await res.json().catch(() => ({}));
        const errorMessage = errorData.message || errorData.error || `ステータス更新に失敗しました (${res.status})`;
        throw new Error(errorMessage);
      }
    } catch (e) {
      // 失敗時は戻す
      setIsClaimedMap((prev) => ({ ...prev, [id]: currentlyClaimed }));
      const errorMessage = e instanceof Error ? e.message : String(e);
      showToast(`エラー: ${errorMessage}`, "error");
    }
  }, [isClaimedMap, showToast]);

  const handleMute = useCallback(async (id: string) => {
    // Step 59: 二重押し防止
    if (actionInProgress.has(id)) return;
    setActionInProgress((prev) => new Set(prev).add(id));

    const targetMessage = messages.find((m) => m.id === id);
    if (!targetMessage) {
      setActionInProgress((prev) => { const next = new Set(prev); next.delete(id); return next; });
      return;
    }

    const fromStatus = activeLabel?.statusType ?? "todo";
    const delta: Partial<{ todo: number; waiting: number; done: number; muted: number }> =
      fromStatus === "waiting"
        ? { waiting: -1, muted: +1 }
        : fromStatus === "muted"
          ? { muted: 0 }
          : { todo: -1, muted: +1 };
    const inverseDelta: Partial<{ todo: number; waiting: number; done: number; muted: number }> =
      fromStatus === "waiting"
        ? { waiting: +1, muted: -1 }
        : fromStatus === "muted"
          ? { muted: 0 }
          : { todo: +1, muted: -1 };
    bumpCounts(delta);

    const previousMessages = [...messages];
    
    // Flash効果（一瞬明るく）- 即座に開始
    setFlashingIds((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setFlashingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 100);

    // 低優先に移動すると、基本的には一覧から消える（assignedビューのみ維持）
    const shouldRemoveFromCurrentList = viewTab !== "assigned";
    if (shouldRemoveFromCurrentList) {
      setRemovingIds((prev) => new Set(prev).add(id));
      // 即座にメッセージリストから削除（E2E/体感の安定化）
      const currentIndex = previousMessages.findIndex((m) => m.id === id);
      const newMessages = previousMessages.filter((m) => m.id !== id);
      setMessages(newMessages);

      // 次のメッセージを選択（即座に）
      const nextMessage = newMessages[currentIndex] ?? newMessages[currentIndex - 1] ?? newMessages[0];
      if (nextMessage) {
        onSelectMessage(nextMessage.id);
      } else {
        setSelectedId(null);
        setSelectedMessage(null);
        setDetailBody({ plainTextBody: null, htmlBody: null, bodyNotice: null, isLoading: false });
        replaceUrl(labelId, null);
      }

      // アニメーション完了後にremovingIdsをクリア
      setTimeout(() => {
        setRemovingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 200);
    }
    
    // Glow effect（低優先タブ）
    setGlowTab("muted");
    setTimeout(() => setGlowTab(null), 1000);

    try {
      await postJsonOrThrow("/api/mailhub/mute", { id, action: "mute" });
      addToUndoStack({ id, message: targetMessage, action: "mute" });
      showToast("低優先に移動しました", "success");
      // Activity表示を即時反映（サーバ取得が遅延/空でも最低1件は見える）
      setActivityLogs((prev) => [
        {
          timestamp: new Date().toISOString(),
          actorEmail: user.email,
          action: "mute",
          messageId: id,
          subject: targetMessage.subject ?? null,
          receivedAt: targetMessage.receivedAt ?? null,
        },
        ...prev,
      ].slice(0, 50));
      void fetchCountsDebounced();
    } catch (e) {
      // エラー時はロールバック
      bumpCounts(inverseDelta);
      if (shouldRemoveFromCurrentList) {
        setRemovingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
      setMessages(previousMessages);
      setSelectedId(id);
      setSelectedMessage(targetMessage);
      showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      // Step 59: 処理完了後にフラグクリア
      setActionInProgress((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  }, [messages, labelId, activeLabel?.statusType, bumpCounts, onSelectMessage, showToast, fetchCountsDebounced, addToUndoStack, user.email, replaceUrl, viewTab, actionInProgress]);

  // Step56: 返信完了マクロ（返信→ステータス変更を一発で実行）
  const handleReplyComplete = useCallback(async (id: string, status: "done" | "waiting" | "muted") => {
    if (!selectedMessage || !replyRoute) return;
    
    setIsCompletingReply(true);
    setShowReplyCompleteModal(false);
    
    try {
      // 既存のハンドラーを呼び出し（担当が外れない実装を再利用）
      if (status === "done") {
        await handleArchive(id);
      } else if (status === "waiting") {
        await handleSetWaiting(id);
      } else if (status === "muted") {
        await handleMute(id);
      }
      
      // Activityログに記録（証跡）
      const action = status === "done" ? "reply_mark_done" : status === "waiting" ? "reply_mark_waiting" : "reply_mark_muted";
      try {
        await fetch("/api/mailhub/activity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            messageId: id,
            metadata: {
              route: replyRoute.kind,
              channel: channelId,
              inquiryId: replyRoute.kind === "rakuten_rms" ? replyInquiryNumber : null,
              templateId: lastAppliedTemplate?.id ?? null,
              templateName: lastAppliedTemplate?.title ?? null,
              unresolvedVars: lastAppliedTemplate?.unresolvedVars ?? [],
              statusAfter: status,
            },
          }),
        });
      } catch {
        // Activity記録失敗は無視（best-effort）
      }

      // Step57（強い任意）: テンプレ適用→返信完了の証跡（best-effort）
      if (lastAppliedTemplate) {
        const templateAction =
          status === "done"
            ? "template_apply_mark_done"
            : status === "waiting"
              ? "template_apply_mark_waiting"
              : "template_apply_mark_muted";
        try {
          await fetch("/api/mailhub/activity", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: templateAction,
              messageId: id,
              metadata: {
                templateId: lastAppliedTemplate.id,
                templateName: lastAppliedTemplate.title,
                unresolvedVars: lastAppliedTemplate.unresolvedVars,
                route: replyRoute.kind,
                channel: channelId,
                inquiryId: replyRoute.kind === "rakuten_rms" ? replyInquiryNumber : null,
                statusAfter: status,
              },
            }),
          });
        } catch {
          // ignore
        }
      }
      
      showToast(`返信完了（${status === "done" ? "完了" : status === "waiting" ? "保留" : "低優先"}）`, "success");
    } catch (e) {
      showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setIsCompletingReply(false);
      setReplyCompleteStatus(null);
    }
  }, [selectedMessage, replyRoute, channelId, replyInquiryNumber, handleArchive, handleSetWaiting, handleMute, showToast, lastAppliedTemplate]);

  const handleSnooze = useCallback(async (id: string, until: string) => {
    const targetMessage = messages.find((m) => m.id === id);
    if (!targetMessage) return;

    const fromStatus = activeLabel?.statusType ?? "todo";
    // 楽観的にカウント反映（失敗時は戻す）
    const delta: Partial<{ todo: number; waiting: number; done: number; muted: number; snoozed?: number }> =
      fromStatus === "waiting"
        ? { waiting: -1, snoozed: +1 }
        : fromStatus === "muted"
          ? { muted: -1, snoozed: +1 }
          : fromStatus === "snoozed"
            ? { snoozed: 0 }
            : { todo: -1, snoozed: +1 };
    const inverseDelta: Partial<{ todo: number; waiting: number; done: number; muted: number; snoozed?: number }> =
      fromStatus === "waiting"
        ? { waiting: +1, snoozed: -1 }
        : fromStatus === "muted"
          ? { muted: +1, snoozed: -1 }
          : fromStatus === "snoozed"
            ? { snoozed: 0 }
            : { todo: +1, snoozed: -1 };
    
    // 即座にUI更新（レスポンス改善）
    bumpCounts(delta);
    
    // Flash効果（一瞬明るく）- 即座に開始
    setFlashingIds((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setFlashingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 100);
    
    // アニメーション開始（Flashと同時にスライド）
    const shouldRemoveFromCurrentList = viewTab !== "assigned";
    if (shouldRemoveFromCurrentList) {
      setRemovingIds((prev) => new Set(prev).add(id));
    }
    
    // Glow effect（Snoozedタブを強く光らせる）- 即座に開始
    setGlowTab("snoozed");
    setTimeout(() => setGlowTab(null), 1000);

    const previousMessages = [...messages];
    if (shouldRemoveFromCurrentList) {
      const currentIndex = previousMessages.findIndex((m) => m.id === id);
      const newMessages = previousMessages.filter((m) => m.id !== id);
      
      // 即座にメッセージリストから削除（レスポンス改善）
      setMessages(newMessages);
      
      // 次のメッセージを選択（即座に）
      const nextMessage = newMessages[currentIndex] ?? newMessages[currentIndex - 1] ?? newMessages[0] ?? null;
      if (nextMessage) {
        onSelectMessage(nextMessage.id);
      } else {
        setSelectedId(null);
        setSelectedMessage(null);
        setDetailBody({ plainTextBody: null, htmlBody: null, bodyNotice: null, isLoading: false });
        replaceUrl(labelId, null);
      }
    }
    
    // アニメーション完了後にremovingIdsをクリア（短縮）
    setTimeout(() => {
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 200);

    // APIリクエストを非同期で実行（UIをブロックしない）
    void (async () => {
      try {
        await postJsonOrThrow("/api/mailhub/snooze", { id, action: "snooze", until });
        addToUndoStack({ id, message: targetMessage, action: "snooze" });
        showToast(`期限付き保留にしました（${until}まで）`, "success");
        // カウントは楽観的更新で既に反映済み。必要に応じてバックグラウンドで更新
        void fetchCountsDebounced();
      } catch (e) {
        // エラー時のみロールバック
        bumpCounts(inverseDelta);
        setRemovingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setMessages(previousMessages);
        setSelectedId(id);
        setSelectedMessage(targetMessage);
        const errorMessage = e instanceof Error ? e.message : String(e);
        showToast(`エラー: ${errorMessage}`, "error");
      }
    })();
  }, [messages, activeLabel?.statusType, bumpCounts, labelId, onSelectMessage, replaceUrl, showToast, fetchCountsDebounced, addToUndoStack, viewTab]);

  const handleSnoozeDateSelect = useCallback((until: string) => {
    if (!selectedId) return;
    void handleSnooze(selectedId, until);
    setSnoozePopoverOpen(false);
  }, [selectedId, handleSnooze]);

  const handleUnsnooze = useCallback(async (id: string) => {
    const targetMessage = messages.find((m) => m.id === id);
    if (!targetMessage) return;

    // 楽観的にカウント反映（失敗時は戻す）
    const delta: Partial<{ todo: number; waiting: number; done: number; muted: number; snoozed?: number }> =
      { snoozed: -1, todo: +1 };
    const inverseDelta: Partial<{ todo: number; waiting: number; done: number; muted: number; snoozed?: number }> =
      { snoozed: +1, todo: -1 };
    
    // 即座にUI更新（レスポンス改善）
    bumpCounts(delta);
    
    // Flash効果（一瞬明るく）- 即座に開始
    setFlashingIds((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setFlashingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 100);
    
    // アニメーション開始（Flashと同時にスライド）
    const shouldRemoveFromCurrentList = viewTab !== "assigned";
    if (shouldRemoveFromCurrentList) {
      setRemovingIds((prev) => new Set(prev).add(id));
    }
    
    // Glow effect（Todoタブを強く光らせる）- 即座に開始
    setGlowTab("todo");
    setTimeout(() => setGlowTab(null), 1000);

    const previousMessages = [...messages];
    if (shouldRemoveFromCurrentList) {
      const currentIndex = previousMessages.findIndex((m) => m.id === id);
      const newMessages = previousMessages.filter((m) => m.id !== id);
      
      // 即座にメッセージリストから削除（レスポンス改善）
      setMessages(newMessages);
      
      // 次のメッセージを選択（即座に）
      const nextMessage = newMessages[currentIndex] ?? newMessages[currentIndex - 1] ?? newMessages[0] ?? null;
      if (nextMessage) {
        onSelectMessage(nextMessage.id);
      } else {
        setSelectedId(null);
        setSelectedMessage(null);
        setDetailBody({ plainTextBody: null, htmlBody: null, bodyNotice: null, isLoading: false });
        replaceUrl(labelId, null);
      }
    }
    
    // アニメーション完了後にremovingIdsをクリア（短縮）
    setTimeout(() => {
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 200);

    // APIリクエストを非同期で実行（UIをブロックしない）
    void (async () => {
      try {
        await postJsonOrThrow("/api/mailhub/snooze", { id, action: "unsnooze" });
        addToUndoStack({ id, message: targetMessage, action: "unsnooze" });
        showToast("Todoに戻しました", "success");
        // カウントは楽観的更新で既に反映済み。必要に応じてバックグラウンドで更新
        void fetchCountsDebounced();
      } catch (e) {
        // エラー時のみロールバック
        bumpCounts(inverseDelta);
        setRemovingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setMessages(previousMessages);
        setSelectedId(id);
        setSelectedMessage(targetMessage);
        const errorMessage = e instanceof Error ? e.message : String(e);
        showToast(`エラー: ${errorMessage}`, "error");
      }
    })();
  }, [messages, bumpCounts, labelId, onSelectMessage, replaceUrl, showToast, fetchCountsDebounced, addToUndoStack, viewTab]);

  const handleAssignClick = useCallback((id: string | null, bulkIds?: string[]) => {
    if (bulkIds && bulkIds.length > 0) {
      setAssigneeSelectorBulkIds(bulkIds);
      setAssigneeSelectorMessageId(null);
    } else {
      setAssigneeSelectorMessageId(id);
      setAssigneeSelectorBulkIds([]);
    }
    setShowAssigneeSelector(true);
  }, []);

  const handleAssigneeSelect = useCallback(async (assigneeEmail: string | null, handoffNote?: string, reason?: string) => {
    const ids = assigneeSelectorBulkIds.length > 0 ? assigneeSelectorBulkIds : (assigneeSelectorMessageId ? [assigneeSelectorMessageId] : []);
    if (ids.length === 0) return;

    // Step 91: takeover判定（既に担当者がいて、別の担当者に変更する場合）
    // 単一選択で既存担当者がいて、かつ担当変更(assign)の場合に理由必須
    if (ids.length === 1 && assigneeEmail) {
      const messageId = ids[0];
      const targetMessage = messages.find((m) => m.id === messageId);
      // 既に担当者がいて、自分ではない担当者への変更の場合 → takeover
      if (targetMessage?.assigneeSlug && targetMessage.assigneeSlug !== assigneeSlug(assigneeEmail)) {
        // reasonが未入力の場合、理由入力モーダルを表示
        if (!reason) {
          setPendingReasonModal({
            action: "takeover",
            messageId,
            assigneeEmail,
            handoffNote,
          });
          // モーダルを閉じずに戻る（handleAssigneeSelectorは閉じない）
          return;
        }
      }
    }

    // Step 72: 二重送信防止（処理中のIDがあれば早期リターン）
    if (ids.some((id) => actionInProgress.has(id))) return;
    
    // Step 72: 全対象IDをロック
    setActionInProgress((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });

    const previousMessages = [...messages];
    const previousSelectedMessage = selectedMessage;
    
    try {
      if (ids.length === 1) {
        // 単一選択
        const messageId = ids[0];
        const targetMessage = messages.find((m) => m.id === messageId);
        if (!targetMessage) {
          // Step 72: ロック解除
          setActionInProgress((prev) => {
            const next = new Set(prev);
            next.delete(messageId);
            return next;
          });
          return;
        }

        // Step 72: Optimistic更新: 即座にUIを更新（API待ち前）
        const newAssigneeSlug = assigneeEmail ? assigneeSlug(assigneeEmail) : null;
        const updatedMessages = messages.map((m) =>
          m.id === messageId ? { ...m, assigneeSlug: newAssigneeSlug } : m
        );
        setMessages(updatedMessages);
        
        // 詳細も更新
        if (selectedMessage?.id === messageId) {
          setSelectedMessage({ ...selectedMessage, assigneeSlug: newAssigneeSlug });
        }

        try {
          const res = await fetch("/api/mailhub/assign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: messageId,
              action: assigneeEmail ? "assign" : "unassign",
              assigneeEmail: assigneeEmail || undefined,
              reason, // Step 91: 理由入力
            }),
          });

          if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.message || errorData.error || `担当の${assigneeEmail ? "割り当て" : "解除"}に失敗しました (${res.status})`);
          }

          // 引き継ぎメモを保存（現在の担当者がいて、新しい担当者が異なる場合）
          if (handoffNote && handoffNote.trim() && targetMessage.assigneeSlug && assigneeEmail && assigneeEmail !== user.email) {
            try {
              await fetch("/api/mailhub/notes", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  messageId,
                  body: handoffNote.trim(),
                  isHandoffNote: true, // 引き継ぎメモとして記録
                }),
              });
            } catch {
              // 引き継ぎメモの保存失敗は警告のみ（担当変更は成功）
              console.warn("Failed to save handoff note");
            }
          }

          // 成功時はトーストを更新
          addToUndoStack({
            id: messageId,
            message: targetMessage,
            action: assigneeEmail ? "assign" : "unassign",
          });
          showToast(assigneeEmail ? (assigneeEmail === user.email ? "自分が担当しました" : "担当を割り当てました") : "担当を解除しました", "success");
          void fetchCountsDebounced();
        } catch (e) {
          // エラー時はロールバック
          setMessages(previousMessages);
          if (previousSelectedMessage) {
            setSelectedMessage(previousSelectedMessage);
          }
          const errorMessage = e instanceof Error ? e.message : String(e);
          showToast(`エラー: ${errorMessage}`, "error");
        } finally {
          // Step 72: ロック解除（success/fail両方で保証）
          setActionInProgress((prev) => {
            const next = new Set(prev);
            next.delete(messageId);
            return next;
          });
        }
      } else {
        // 一括選択（executeBulkActionは後で定義されるため、直接実装）
        const newAssigneeSlug = assigneeEmail ? assigneeSlug(assigneeEmail) : null;
        
        // Optimistic更新: 即座にUIを更新
        setMessages((prev) =>
          prev.map((m) => {
            if (ids.includes(m.id)) return { ...m, assigneeSlug: newAssigneeSlug };
            return m;
          }),
        );
        setSelectedMessage((prev) => {
          if (!prev) return prev;
          if (ids.includes(prev.id)) return { ...prev, assigneeSlug: newAssigneeSlug };
          return prev;
        });
        
        // 即座に処理中トーストを表示
        showToast("処理中...", "info");
        
        const successIds: string[] = [];
        const failedIds: string[] = [];
        
        for (const id of ids) {
          try {
            await postJsonOrThrow("/api/mailhub/assign", {
              id,
              action: assigneeEmail ? "assign" : "unassign",
              assigneeEmail: assigneeEmail || undefined,
            });
            successIds.push(id);
          } catch {
            failedIds.push(id);
          }
        }

        if (failedIds.length > 0) {
          // 失敗したものだけロールバック
          setMessages((prev) =>
            prev.map((m) => {
              if (failedIds.includes(m.id)) {
                const original = previousMessages.find((pm) => pm.id === m.id);
                return original || m;
              }
              return m;
            }),
          );
          setBulkResult({
            successIds,
            failedIds,
            failedMessages: failedIds.map((id) => {
              const m = messages.find((msg) => msg.id === id);
              return { id, subject: m?.subject ?? "" };
            }),
            action: "bulkAssign",
          });
          showToast(
            `${successIds.length}件処理完了。${failedIds.length}件失敗しました（再実行できます）`,
            "error",
          );
          void fetchCountsDebounced();
          setCheckedIds(new Set());
        } else {
          showToast(`${successIds.length}件を自分が担当しました`, "success");
          void fetchCountsDebounced();
          setCheckedIds(new Set());
        }
      }
    } catch (error) {
      // エラー時はロールバック（一括選択の場合）
      if (assigneeSelectorBulkIds.length > 0) {
        setMessages(previousMessages);
        if (previousSelectedMessage) {
          setSelectedMessage(previousSelectedMessage);
        }
      }
      showToast(`エラー: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      // Step 72: ロック解除（一括選択の場合）
      setActionInProgress((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      setShowAssigneeSelector(false);
      setAssigneeSelectorMessageId(null);
      setAssigneeSelectorBulkIds([]);
    }
  }, [actionInProgress, assigneeSelectorBulkIds, assigneeSelectorMessageId, messages, selectedMessage, showToast, fetchCountsDebounced, addToUndoStack, user.email]);

  // 後方互換のため、既存のhandleAssignも残す（非推奨）
  const handleAssign = useCallback(async (id: string) => {
    // 既存の動作（自分に割り当て）を維持
    setAssigneeSelectorMessageId(id);
    setAssigneeSelectorBulkIds([]);
    setShowAssigneeSelector(true);
    // モーダルで自分を選択する想定だが、直接実行する場合は以下を使用
    // await handleAssigneeSelect(user.email);
  }, []);

  // Step 111: Take Next（未割当を1件自動で自分に割当）
  const handleTakeNext = useCallback(async () => {
    if (readOnlyMode) {
      showToast("READ ONLYモードでは実行できません", "error");
      return;
    }
    
    // 現在のリスト内で未割当の先頭（または最古）を取得
    const unassignedMessages = filteredMessages.filter((m) => !m.assigneeSlug);
    if (unassignedMessages.length === 0) {
      showToast("未割当のメールがありません", "info");
      return;
    }
    
    // 先頭（または最古）を選択（receivedAtでソート）
    const targetMessage = unassignedMessages.sort((a, b) => {
      const aTime = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
      const bTime = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
      return aTime - bTime; // 最古順
    })[0];
    
    if (!targetMessage) return;
    
    // 自分にAssignして自動で開く
    try {
      // Optimistic更新: 即座にUIを更新
      const newAssigneeSlug = assigneeSlug(user.email);
      const updatedMessages = messages.map((m) =>
        m.id === targetMessage.id ? { ...m, assigneeSlug: newAssigneeSlug } : m
      );
      setMessages(updatedMessages);
      
      // API呼び出し
      const res = await fetch("/api/mailhub/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: targetMessage.id,
          action: "assign",
          assigneeEmail: user.email,
        }),
      });
      
      if (!res.ok) {
        // 失敗時はrollback
        setMessages((prev) =>
          prev.map((m) => (m.id === targetMessage.id ? { ...m, assigneeSlug: null } : m))
        );
        const errorData = await res.json().catch(() => ({}));
        const errorMessage = errorData.message || errorData.error || `担当の割り当てに失敗しました (${res.status})`;
        throw new Error(errorMessage);
      }
      
      await res.json();
      // 成功時は詳細を開く
      setSelectedId(targetMessage.id);
      setSelectedMessage({ ...targetMessage, assigneeSlug: newAssigneeSlug });
      replaceUrl(labelId, targetMessage.id);
      void loadDetailBodyOnly(targetMessage.id);
      
      void fetchCountsDebounced();
      showToast("未割当のメールを自分に割り当てました", "success");
    } catch (e) {
      showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }, [readOnlyMode, filteredMessages, messages, user.email, labelId, replaceUrl, loadDetailBodyOnly, fetchCountsDebounced, showToast]);

  const handleUnassign = useCallback(async (id: string) => {
    const targetMessage = messages.find((m) => m.id === id);
    if (!targetMessage) return;

    const previousMessages = [...messages];
    
    try {
      const res = await fetch("/api/mailhub/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "unassign" }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const errorMessage = errorData.message || errorData.error || `担当の解除に失敗しました (${res.status})`;
        throw new Error(errorMessage);
      }

      // 成功時はメッセージを更新（assigneeSlugをnullに）
      const updatedMessages = messages.map((m) =>
        m.id === id ? { ...m, assigneeSlug: null } : m
      );
      setMessages(updatedMessages);
      
      // 詳細も更新
      if (selectedMessage?.id === id) {
        setSelectedMessage({ ...selectedMessage, assigneeSlug: null });
      }

      addToUndoStack({
        id,
        message: targetMessage,
        action: "unassign",
      });
      showToast("担当を解除しました", "success");
      void fetchCountsDebounced();
    } catch (e) {
      setMessages(previousMessages);
      showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }, [messages, selectedMessage, showToast, fetchCountsDebounced, addToUndoStack]);


  // 一括処理の共通ロジック（3並列で実行、進捗表示付き）
  const executeBulkAction = useCallback(async (
    ids: string[],
    actionFn: (id: string) => Promise<void>,
    undoAction: "bulkArchive" | "bulkMute" | "bulkWaiting" | "bulkAssign",
  ): Promise<{ successIds: string[]; failedIds: string[]; messages: InboxListMessage[]; failedMessages: Array<{ id: string; subject: string }> }> => {
    const successIds: string[] = [];
    const failedIds: string[] = [];
    const messagesToUndo: InboxListMessage[] = [];
    const failedMessages: Array<{ id: string; subject: string }> = [];

    // 進捗表示を開始（E2Eが確実に検知できるよう、最低表示時間を確保）
    const startedAt = Date.now();
    setBulkProgress({ current: 0, total: ids.length });

    // 3並列ずつ処理
    const BATCH_SIZE = 3;
    let processedCount = 0;
    
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (id) => {
          await actionFn(id);
          return id;
        })
      );

      results.forEach((result, idx) => {
        const id = batch[idx];
        if (result.status === "fulfilled") {
          successIds.push(result.value);
          const msg = messages.find((m) => m.id === result.value);
          if (msg) messagesToUndo.push(msg);
        } else {
          failedIds.push(id);
          const msg = messages.find((m) => m.id === id);
          if (msg) {
            failedMessages.push({ id, subject: msg.subject || "(no subject)" });
          } else {
            failedMessages.push({ id, subject: id });
          }
        }
        processedCount++;
        setBulkProgress({ current: processedCount, total: ids.length });
      });
    }

    // 進捗表示を終了（最低300msは表示）
    const elapsed = Date.now() - startedAt;
    if (elapsed < 300) {
      await new Promise((r) => setTimeout(r, 300 - elapsed));
    }
    setBulkProgress(null);

    // Undoスタックに追加
    if (successIds.length > 0) {
      addToUndoStack({
        action: undoAction,
        ids: successIds,
        messages: messagesToUndo,
      });
    }

    return { successIds, failedIds, messages: messagesToUndo, failedMessages };
  }, [messages, addToUndoStack]);

  const handleToggleAssigneeForSelection = useCallback(async () => {
    if (selectedIds.length === 0 || bulkProgress) return;

    // 現在の割当状態に応じて、assign/unassignを振り分け
    const idToAssignee = new Map(messages.map((m) => [m.id, m.assigneeSlug] as const));
    const toUnassign = selectedIds.filter((id) => idToAssignee.get(id) === myAssigneeSlug);
    const toAssign = selectedIds.filter((id) => idToAssignee.get(id) !== myAssigneeSlug);

    try {
      let assignResult: { successIds: string[]; failedIds: string[] } | null = null;
      let unassignResult: { successIds: string[]; failedIds: string[] } | null = null;

      // assign（必要なら引き継ぎ）
      if (toAssign.length > 0) {
        assignResult = await executeBulkAction(
          toAssign,
          async (id) => {
            try {
              await postJsonOrThrow("/api/mailhub/assign", { id, action: "assign", force: false });
            } catch (e) {
              // 409エラー（already_assigned）の場合は引き継ぎで再試行
              const is409Error = 
                getErrorStatus(e) === 409 ||
                (e instanceof Error && (
                  e.message.includes("already_assigned") ||
                  e.message.includes("担当") ||
                  e.message.includes("409") ||
                  e.message.includes("Conflict")
                ));
              
              if (is409Error) {
                // 引き継ぎで再試行
                await postJsonOrThrow("/api/mailhub/assign", { id, action: "assign", force: true });
              } else {
                throw e;
              }
            }
          },
          "bulkAssign",
        );

        // 409エラーで失敗したものは引き継ぎで再試行
        if (assignResult.failedIds.length > 0) {
          const retryResult = await executeBulkAction(
            assignResult.failedIds,
            async (id) => {
              await postJsonOrThrow("/api/mailhub/assign", { id, action: "assign", force: true });
            },
            "bulkAssign",
          );
          // 再試行で成功したものを追加
          assignResult.successIds.push(...retryResult.successIds);
          // 再試行でも失敗したものはfailedIdsに残す
          assignResult.failedIds = retryResult.failedIds;
        }

        // 成功したIDのみを反映
        const successfulAssignIds = assignResult.successIds;
        if (successfulAssignIds.length > 0) {
          setMessages((prev) =>
            prev.map((m) => {
              if (successfulAssignIds.includes(m.id)) return { ...m, assigneeSlug: myAssigneeSlug };
              return m;
            }),
          );
          setSelectedMessage((prev) => {
            if (!prev) return prev;
            if (successfulAssignIds.includes(prev.id)) return { ...prev, assigneeSlug: myAssigneeSlug };
            return prev;
          });
        }
      }

      // unassign（自分担当だけ解除）
      if (toUnassign.length > 0) {
        unassignResult = await executeBulkAction(
          toUnassign,
          async (id) => {
            await postJsonOrThrow("/api/mailhub/assign", { id, action: "unassign" });
          },
          "bulkAssign",
        );

        // 成功したIDのみを反映
        const successfulUnassignIds = unassignResult.successIds;
        if (successfulUnassignIds.length > 0) {
          setMessages((prev) =>
            prev.map((m) => {
              if (successfulUnassignIds.includes(m.id)) return { ...m, assigneeSlug: null };
              return m;
            }),
          );
          setSelectedMessage((prev) => {
            if (!prev) return prev;
            if (successfulUnassignIds.includes(prev.id)) return { ...prev, assigneeSlug: null };
            return prev;
          });
        }
      }

      // 成功メッセージを表示（成功した件数を正確に表示）
      const totalSuccess = (assignResult?.successIds.length ?? 0) + (unassignResult?.successIds.length ?? 0);
      const totalFailed = (assignResult?.failedIds.length ?? 0) + (unassignResult?.failedIds.length ?? 0);
      
      // エラー状態をクリア（エラー画面が消えるように）
      setListError(null);
      
      if (totalSuccess > 0) {
        showToast(
          selectedIds.length > 1
            ? `担当更新: 成功 ${totalSuccess}件${totalFailed > 0 ? ` / 失敗 ${totalFailed}件` : ""}`
            : toAssign.length > 0
              ? "担当にしました"
              : "担当解除しました",
          "success",
        );
        void fetchCountsDebounced();
      }
      
      if (totalFailed > 0 && totalSuccess === 0) {
        showToast(`エラー: ${totalFailed}件の処理に失敗しました`, "error");
      }
      
      // 選択をクリア（処理完了後）
      if (totalSuccess > 0) {
        setCheckedIds(new Set());
      }
    } catch (e) {
      // エラー状態をクリア（エラー画面が消えるように）
      setListError(null);
      const errorMessage = e instanceof Error ? e.message : String(e);
      showToast(`エラー: ${errorMessage}`, "error");
    }
  }, [bulkProgress, executeBulkAction, fetchCountsDebounced, messages, myAssigneeSlug, selectedIds, showToast]);

  // 一括Archive
  const handleBulkArchive = useCallback(async (ids: string[]) => {
    if (ids.length === 0 || bulkProgress) return; // 実行中は無効化
    
    const fromStatus = activeLabel?.statusType ?? "todo";
    const previousMessages = [...messages];
    const previousSelectedId = selectedId;
    const previousSelectedMessage = selectedMessage;
    // 担当タブは「担当ラベルの総覧」なので、完了しても一覧から消さない（以前の保留バグと同型）
    const shouldRemoveFromCurrentList = viewTab !== "assigned";
    
    // 即座にUI更新（楽観的更新）- レスポンス改善
    const n = ids.length;
    const delta: Partial<{ todo: number; waiting: number; done: number; muted: number }> =
      fromStatus === "waiting"
        ? { waiting: -n, done: +n }
        : fromStatus === "muted"
          ? { muted: -n, done: +n }
          : { todo: -n, done: +n };
    const inverseDelta: Partial<{ todo: number; waiting: number; done: number; muted: number }> =
      fromStatus === "waiting"
        ? { waiting: +n, done: -n }
        : fromStatus === "muted"
          ? { muted: +n, done: -n }
          : { todo: +n, done: -n };
    
    bumpCounts(delta);
    
    // Flash効果（即座に開始）
    ids.forEach((id) => {
      setFlashingIds((prev) => new Set(prev).add(id));
    });
    setTimeout(() => {
      setFlashingIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }, 100); // 150ms → 100msに短縮
    
    // スライド開始（即座に開始）
    if (shouldRemoveFromCurrentList) {
      ids.forEach((id) => {
        setRemovingIds((prev) => new Set(prev).add(id));
      });
    }
    
    // Glow effect（即座に開始）
    setGlowTab("done");
    setTimeout(() => setGlowTab(null), 1000); // 1500ms → 1000msに短縮
    
    let newMessages = previousMessages;
    if (shouldRemoveFromCurrentList) {
      // 即座にメッセージリストから削除（レスポンス改善）
      newMessages = previousMessages.filter((m) => !ids.includes(m.id));
      setMessages(newMessages);
      
      // 選択状態を更新（即座に）
      if (previousSelectedId && ids.includes(previousSelectedId)) {
        if (newMessages.length > 0) {
          onSelectMessage(newMessages[0].id);
        } else {
          setSelectedId(null);
          setSelectedMessage(null);
          setDetailBody({ plainTextBody: null, htmlBody: null, bodyNotice: null, isLoading: false });
          replaceUrl(labelId, null);
        }
      }
    }
    
    // チェック状態をクリア（即座に）
    setCheckedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    
    // アニメーション完了後にremovingIdsをクリア（短縮）
    setTimeout(() => {
      setRemovingIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }, 200); // 500ms → 200msに短縮
    
    // APIリクエストを非同期で実行（UIをブロックしない）
    void (async () => {
      try {
        const { successIds, failedIds, failedMessages } = await executeBulkAction(
          ids,
          async (id) => {
            await postJsonOrThrow("/api/mailhub/archive", { id, action: "archive" });
          },
          "bulkArchive",
        );

        // 失敗したものはロールバック
        if (failedIds.length > 0) {
          const failedN = failedIds.length;
          const failedDelta: Partial<{ todo: number; waiting: number; done: number; muted: number }> =
            fromStatus === "waiting"
              ? { waiting: +failedN, done: -failedN }
              : fromStatus === "muted"
                ? { muted: +failedN, done: -failedN }
                : { todo: +failedN, done: -failedN };
          bumpCounts(failedDelta);
          
          // 失敗したメッセージをリストに戻す
          const failedMessagesList = previousMessages.filter((m) => failedIds.includes(m.id));
          setMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            const toAdd = failedMessagesList.filter((m) => !existingIds.has(m.id));
            return [...prev, ...toAdd].sort((a, b) => {
              const aIdx = previousMessages.findIndex((m) => m.id === a.id);
              const bIdx = previousMessages.findIndex((m) => m.id === b.id);
              return aIdx - bIdx;
            });
          });
          
          // 失敗したものをcheckedIdsに戻す
          setCheckedIds((prev) => {
            const next = new Set(prev);
            failedIds.forEach((id) => next.add(id));
            return next;
          });
          
          setBulkResult({
            successIds,
            failedIds,
            failedMessages,
            action: "bulkArchive",
          });
          showToast(`${successIds.length}件処理完了。${failedIds.length}件失敗しました（再実行できます）`, "error");
        } else {
          showToast(`${successIds.length}件を完了しました`, "success");
        }
        
        // カウントは楽観的更新で既に反映済み。必要に応じてバックグラウンドで更新
        void fetchCountsDebounced();
      } catch (e) {
        // エラー時は完全にロールバック
        bumpCounts(inverseDelta);
        setMessages(previousMessages);
        if (previousSelectedId) {
          setSelectedId(previousSelectedId);
          setSelectedMessage(previousSelectedMessage);
        }
        setCheckedIds(new Set(ids));
        setBulkProgress(null);
        showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    })();
  }, [activeLabel?.statusType, bumpCounts, messages, selectedId, selectedMessage, onSelectMessage, showToast, fetchCountsDebounced, labelId, executeBulkAction, bulkProgress, replaceUrl, viewTab]);

  // Step 90: 一括Archive（Done）- 確認付きラッパー
  const handleBulkDone = useCallback((ids: string[]) => {
    if (ids.length === 0 || bulkProgress) return;
    if (ids.length >= BULK_CONFIRM_THRESHOLD) {
      setPendingBulkConfirm({ action: "bulkDone", ids });
    } else {
      void handleBulkArchive(ids);
    }
  }, [bulkProgress, handleBulkArchive, BULK_CONFIRM_THRESHOLD]);

  // 一括Mute（選択されたメール）- 内部実行用
  const executeBulkMuteSelected = useCallback(async (ids: string[]) => {
    if (ids.length === 0 || bulkProgress) return; // 実行中は無効化
    
    try {
      const { successIds, failedIds, failedMessages } = await executeBulkAction(
        ids,
        async (id) => {
          await postJsonOrThrow("/api/mailhub/mute", { id, action: "mute" });
        },
        "bulkMute",
      );

      // UI更新
      if (successIds.length > 0) {
        const fromStatus = activeLabel?.statusType ?? "todo";
        const n = successIds.length;
        bumpCounts(
          fromStatus === "waiting"
            ? { waiting: -n, muted: +n }
            : fromStatus === "muted"
              ? { muted: 0 }
              : { todo: -n, muted: +n },
        );
        
        // Flash効果
        successIds.forEach((id) => {
          setFlashingIds((prev) => new Set(prev).add(id));
        });
        setTimeout(() => {
          setFlashingIds((prev) => {
            const next = new Set(prev);
            successIds.forEach((id) => next.delete(id));
            return next;
          });
        }, 150);
        
        // スライド開始
        setTimeout(() => {
          successIds.forEach((id) => {
            setRemovingIds((prev) => new Set(prev).add(id));
          });
        }, 150);
        
        // Glow effect
        setGlowTab("muted");
        setTimeout(() => setGlowTab(null), 1500);
        
        // アニメーション後に削除
        setTimeout(() => {
          setMessages((prev) => prev.filter((m) => !successIds.includes(m.id)));
          setRemovingIds((prev) => {
            const next = new Set(prev);
            successIds.forEach((id) => next.delete(id));
            return next;
          });
          
          if (selectedId && successIds.includes(selectedId)) {
            const remaining = messages.filter((m) => !successIds.includes(m.id));
            if (remaining.length > 0) {
              onSelectMessage(remaining[0].id);
            } else {
              setSelectedId(null);
              setSelectedMessage(null);
              setDetailBody({ plainTextBody: null, htmlBody: null, bodyNotice: null, isLoading: false });
              replaceUrl(labelId, null);
            }
          }
        }, 500);
        
        // 失敗分はcheckedIdsに残す（選択状態を維持）
        setCheckedIds((prev) => {
          const next = new Set(prev);
          successIds.forEach((id) => next.delete(id));
          return next;
        });
        void fetchCountsDebounced();
      }

      if (failedIds.length > 0) {
        setBulkResult({
          successIds,
          failedIds,
          failedMessages,
          action: "bulkMute",
        });
        showToast(`${successIds.length}件処理完了。${failedIds.length}件失敗しました（再実行できます）`, "error");
      } else {
        // すべて成功した場合も選択状態を維持（要件4）
        // setCheckedIds(new Set());
        showToast(`${successIds.length}件を低優先に移動しました`, "success");
      }
    } catch (e) {
      setBulkProgress(null);
      showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }, [activeLabel?.statusType, bumpCounts, messages, selectedId, onSelectMessage, showToast, fetchCountsDebounced, labelId, executeBulkAction, bulkProgress, replaceUrl]);

  // Step 90: 一括Mute（確認付きラッパー）
  const handleBulkMuteSelected = useCallback((ids: string[]) => {
    if (ids.length === 0 || bulkProgress) return;
    if (ids.length >= BULK_CONFIRM_THRESHOLD) {
      setPendingBulkConfirm({ action: "bulkMute", ids });
    } else {
      void executeBulkMuteSelected(ids);
    }
  }, [bulkProgress, executeBulkMuteSelected, BULK_CONFIRM_THRESHOLD]);

  // 一括Waiting
  const handleBulkWaiting = useCallback(async (ids: string[]) => {
    if (ids.length === 0 || bulkProgress) return; // 実行中は無効化
    
    try {
      const isCurrentlyWaiting = activeLabel?.statusType === "waiting";
      const action = isCurrentlyWaiting ? "unsetWaiting" : "setWaiting";
      const { successIds, failedIds, failedMessages } = await executeBulkAction(
        ids,
        async (id) => {
          await postJsonOrThrow("/api/mailhub/status", { id, action });
        },
        "bulkWaiting",
      );

      // UI更新
      if (successIds.length > 0) {
        const n = successIds.length;
        bumpCounts(isCurrentlyWaiting ? { waiting: -n, todo: +n } : { todo: -n, waiting: +n });

        // Flash効果
        successIds.forEach((id) => {
          setFlashingIds((prev) => new Set(prev).add(id));
        });
        setTimeout(() => {
          setFlashingIds((prev) => {
            const next = new Set(prev);
            successIds.forEach((id) => next.delete(id));
            return next;
          });
        }, 150);

        const shouldRemoveFromCurrentList = viewTab !== "assigned";
        if (shouldRemoveFromCurrentList) {
          // スライド開始
          setTimeout(() => {
            successIds.forEach((id) => {
              setRemovingIds((prev) => new Set(prev).add(id));
            });
          }, 150);
        }

        // Glow effect（保留 or 未対応）
        setGlowTab(isCurrentlyWaiting ? "todo" : "waiting");
        setTimeout(() => setGlowTab(null), 1500);

        if (shouldRemoveFromCurrentList) {
          // アニメーション後に削除
          setTimeout(() => {
            setMessages((prev) => prev.filter((m) => !successIds.includes(m.id)));
            setRemovingIds((prev) => {
              const next = new Set(prev);
              successIds.forEach((id) => next.delete(id));
              return next;
            });

            if (selectedId && successIds.includes(selectedId)) {
              // NOTE: 最新のmessages stateではなく、残存リストは setMessages(prev=>...) に委ねる。
              // ここでは安全に先頭へフォールバックする（クラッシュ防止）。
              setSelectedId(null);
              setSelectedMessage(null);
              setDetailBody({ plainTextBody: null, htmlBody: null, bodyNotice: null, isLoading: false });
              replaceUrl(labelId, null);
            }
          }, 500);
        }

        // 失敗分はcheckedIdsに残す
        setCheckedIds((prev) => {
          const next = new Set(prev);
          successIds.forEach((id) => next.delete(id));
          return next;
        });
        void fetchCountsDebounced();
      }

      if (failedIds.length > 0) {
        setBulkResult({
          successIds,
          failedIds,
          failedMessages,
          action: "bulkWaiting",
        });
        showToast(`${successIds.length}件処理完了。${failedIds.length}件失敗しました（再実行できます）`, "error");
      } else {
        // 選択状態を維持（連続操作のため）
        // setCheckedIds(new Set());
        showToast(isCurrentlyWaiting ? `${successIds.length}件を未対応に戻しました` : `${successIds.length}件を保留にしました`, "success");
      }
    } catch (e) {
      setBulkProgress(null);
      showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }, [activeLabel?.statusType, bumpCounts, selectedId, showToast, fetchCountsDebounced, labelId, executeBulkAction, bulkProgress, viewTab, replaceUrl]);

  // 一括Assign
  const handleBulkAssign = useCallback(async (ids: string[]) => {
    if (ids.length === 0 || bulkProgress) return; // 実行中は無効化
    
    try {
      const { successIds, failedIds, failedMessages } = await executeBulkAction(
        ids,
        async (id) => {
          try {
            await postJsonOrThrow("/api/mailhub/assign", { id, action: "assign", force: false });
          } catch (e) {
            // 既に他人が担当している場合は引き継ぐ（モーダルなし）
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.includes("already_assigned") || msg.includes("担当")) {
              await postJsonOrThrow("/api/mailhub/assign", { id, action: "assign", force: true });
            } else {
              throw e;
            }
          }
        },
        "bulkAssign",
      );

      // UI更新
      if (successIds.length > 0) {
        const updatedMessages = messages.map((m) =>
          successIds.includes(m.id) ? { ...m, assigneeSlug: myAssigneeSlug } : m
        );
        setMessages(updatedMessages);
        // 失敗分はcheckedIdsに残す
        setCheckedIds((prev) => {
          const next = new Set(prev);
          successIds.forEach((id) => next.delete(id));
          return next;
        });
        void fetchCountsDebounced();
      }

      if (failedIds.length > 0) {
        setBulkResult({
          successIds,
          failedIds,
          failedMessages,
          action: "bulkAssign",
        });
        showToast(`${successIds.length}件処理完了。${failedIds.length}件失敗しました（再実行できます）`, "error");
      } else {
        // すべて成功した場合も選択状態を維持（要件4）
        // setCheckedIds(new Set());
        showToast(`${successIds.length}件を自分が担当しました`, "success");
      }
    } catch (e) {
      setBulkProgress(null);
      showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }, [messages, myAssigneeSlug, showToast, fetchCountsDebounced, executeBulkAction, bulkProgress]);

  // Step 100: Unassignedビューで「一発Assign（自分）」できる導線（10件以上はStep90 confirm踏襲）
  const handleBulkAssignSelected = useCallback((ids: string[]) => {
    if (ids.length === 0 || bulkProgress) return;
    if (ids.length >= BULK_CONFIRM_THRESHOLD) {
      setPendingBulkConfirm({ action: "bulkAssign", ids });
    } else {
      void handleBulkAssign(ids);
    }
  }, [bulkProgress, handleBulkAssign, BULK_CONFIRM_THRESHOLD]);

  // リトライ（失敗分だけ再実行）
  const handleBulkRetry = useCallback(async () => {
    if (!bulkResult || bulkResult.failedIds.length === 0) return;
    
    const { failedIds, action } = bulkResult;
    
    // 結果を一時保存してクリア（再実行後に更新される）
    const savedAction = action;
    setBulkResult(null);
    
    // 失敗分だけ再実行
    if (savedAction === "bulkArchive") {
      await handleBulkArchive(failedIds);
    } else if (savedAction === "bulkMute") {
      await handleBulkMuteSelected(failedIds);
    } else if (savedAction === "bulkWaiting") {
      await handleBulkWaiting(failedIds);
    } else if (savedAction === "bulkAssign") {
      await handleBulkAssign(failedIds);
    }
  }, [bulkResult, handleBulkArchive, handleBulkMuteSelected, handleBulkWaiting, handleBulkAssign]);

  // Step 91: 理由入力モーダルのOKボタン処理
  const handleReasonConfirmOk = useCallback(() => {
    if (!pendingReasonModal) return;
    const { action, messageId, assigneeEmail } = pendingReasonModal;
    const reason = reasonText.trim();
    if (!reason) {
      showToast("理由を入力してください", "error");
      return;
    }
    setPendingReasonModal(null);
    setReasonText("");
    // モーダルをクローズしてから実行
    setShowAssigneeSelector(false);
    setAssigneeSelectorMessageId(null);
    setAssigneeSelectorBulkIds([]);
    // reasonを渡して再実行（handleAssigneeSelectのreason付きバージョン）
    if (action === "takeover" && assigneeEmail) {
      // 直接APIを呼び出す（handleAssigneeSelectはモーダル経由で既に閉じられているため）
      void (async () => {
        const targetMessage = messages.find((m) => m.id === messageId);
        if (!targetMessage) return;
        try {
          const res = await fetch("/api/mailhub/assign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: messageId,
              action: "assign",
              assigneeEmail,
              reason,
              force: true, // takeover
            }),
          });
          if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.message || errorData.error || `担当の変更に失敗しました (${res.status})`);
          }
          // UI更新
          const newAssigneeSlug = assigneeSlug(assigneeEmail);
          setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, assigneeSlug: newAssigneeSlug } : m));
          if (selectedMessage?.id === messageId) {
            setSelectedMessage({ ...selectedMessage, assigneeSlug: newAssigneeSlug });
          }
          showToast("担当を変更しました", "success");
          // Step 91: Activity ログに即時反映（サーバ側の非同期書き込みを待たずに表示）
          setActivityLogs((prev) => [
            {
              timestamp: new Date().toISOString(),
              actorEmail: user.email,
              action: "takeover",
              messageId,
              subject: messages.find((m) => m.id === messageId)?.subject ?? null,
              receivedAt: messages.find((m) => m.id === messageId)?.receivedAt ?? null,
              reason,
            },
            ...prev,
          ]);
          void fetchCountsDebounced();
        } catch (e) {
          showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
        }
      })();
    }
  }, [pendingReasonModal, reasonText, messages, selectedMessage, showToast, fetchCountsDebounced, user.email]);

  // Step 90: 確認モーダルのOKボタン処理
  const handleBulkConfirmOk = useCallback(() => {
    if (!pendingBulkConfirm) return;
    const { action, ids } = pendingBulkConfirm;
    setPendingBulkConfirm(null);
    if (action === "bulkDone") {
      void handleBulkArchive(ids);
    } else if (action === "bulkMute") {
      void executeBulkMuteSelected(ids);
    } else if (action === "bulkAssign") {
      void handleBulkAssign(ids);
    }
  }, [pendingBulkConfirm, handleBulkArchive, executeBulkMuteSelected, handleBulkAssign]);

  // Step 100: 左ナビのUnassignedを強調（Sidebar自体は触らず、labelを差し替え）
  const sidebarLabelGroups = useMemo(() => {
    const unassignedLoad = statusCounts?.unassignedLoad ?? 0;
    if (unassignedLoad <= 0) return labelGroups;
    return labelGroups.map((g) => {
      if (g.id !== "assignee") return g;
      return {
        ...g,
        items: g.items.map((it) => {
          if (it.id !== "unassigned") return it;
          // 既にprefix済みなら二重に付けない
          const nextLabel = it.label.startsWith("⚠ ") ? it.label : `⚠ ${it.label}`;
          return { ...it, label: nextLabel };
        }),
      };
    });
  }, [labelGroups, statusCounts?.unassignedLoad]);

  // Step 58: Ops Macro（Take+Waiting / Take+Done）
  const runMacro = useCallback(async (macroType: "take-waiting" | "take-done") => {
    // 対象IDs: checkedIds が1件以上ならそれら、なければ selected/focused の1件
    const targetIds = checkedIds.size > 0 ? Array.from(checkedIds) : selectedId ? [selectedId] : [];
    if (targetIds.length === 0) {
      showToast("対象メールがありません", "error");
      return;
    }

    // 対象メッセージの担当状態を取得
    const idToAssignee = new Map(messages.map((m) => [m.id, m.assigneeSlug] as const));
    const toAssign = targetIds.filter((id) => idToAssignee.get(id) !== myAssigneeSlug);

    try {
      // Step1: 自分担当でないものを assign（既に自分担当ならスキップ）
      if (toAssign.length > 0) {
        const { successIds, failedIds } = await executeBulkAction(
          toAssign,
          async (id) => {
            try {
              await postJsonOrThrow("/api/mailhub/assign", { id, action: "assign", force: false });
            } catch (e) {
              // 409: currentAssigneeSlug が自分なら成功扱い
              if (getErrorStatus(e) === 409) {
                const msg = e instanceof Error ? e.message : String(e);
                if (msg.includes("already_assigned")) {
                  // 自分が担当者の場合は成功扱い
                  return;
                }
              }
              throw e;
            }
          },
          "bulkAssign",
        );

        // 成功したものをUIに反映
        if (successIds.length > 0) {
          setMessages((prev) =>
            prev.map((m) => (successIds.includes(m.id) ? { ...m, assigneeSlug: myAssigneeSlug } : m))
          );
        }

        // 失敗分があればエラー表示して終了
        if (failedIds.length > 0) {
          showToast(`${failedIds.length}件の担当設定に失敗しました`, "error");
          return;
        }
      }

      // Step2: ステータス変更（Waiting or Archive/Done）
      if (macroType === "take-waiting") {
        await handleBulkWaiting(targetIds);
      } else {
        await handleBulkArchive(targetIds);
      }

      // 成功: checkedIds をクリア
      setCheckedIds(new Set());
    } catch (e) {
      showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }, [checkedIds, selectedId, messages, myAssigneeSlug, executeBulkAction, handleBulkWaiting, handleBulkArchive, showToast]);

  const handleUnmute = useCallback(async (id: string) => {
    const targetMessage = messages.find((m) => m.id === id);
    if (!targetMessage) return;

    const delta: Partial<{ todo: number; waiting: number; done: number; muted: number }> = { muted: -1, todo: +1 };
    const inverseDelta: Partial<{ todo: number; waiting: number; done: number; muted: number }> = { muted: +1, todo: -1 };
    bumpCounts(delta);

    const previousMessages = [...messages];
    
    // Flash効果（一瞬明るく）
    setFlashingIds((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setFlashingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 150);
    
    // アニメーション開始（Flash後にスライド）
    setTimeout(() => {
      setRemovingIds((prev) => new Set(prev).add(id));
    }, 150);
    
    // Glow effect（未対応へ戻る）
    setGlowTab("todo");
    setTimeout(() => setGlowTab(null), 1500);

    // アニメーション後に削除
    setTimeout(() => {
      const newMessages = messages.filter((m) => m.id !== id);
      setMessages(newMessages);
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });

      const currentIndex = previousMessages.findIndex((m) => m.id === id);
      const nextMessage = newMessages[currentIndex] ?? newMessages[currentIndex - 1] ?? newMessages[0];
      if (nextMessage) {
        onSelectMessage(nextMessage.id);
      } else {
        setSelectedId(null);
        setSelectedMessage(null);
        setDetailBody({ plainTextBody: null, htmlBody: null, bodyNotice: null, isLoading: false });
        replaceUrl(labelId, null);
      }
    }, 500);

    try {
      await postJsonOrThrow("/api/mailhub/mute", { id, action: "unmute" });
      addToUndoStack({ id, message: targetMessage, action: "unmute" });
      showToast("Inboxへ戻しました", "success");
      void fetchCountsDebounced();
    } catch (e) {
      bumpCounts(inverseDelta);
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setMessages(previousMessages);
      setSelectedId(id);
      setSelectedMessage(targetMessage);
      showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }, [messages, labelId, bumpCounts, onSelectMessage, showToast, fetchCountsDebounced, addToUndoStack, replaceUrl]);
  

  const handleBulkMute = useCallback(async () => {
    const candidates = triageCandidates;
    if (candidates.length === 0) {
      showToast("候補メールがありません", "error");
      return;
    }
    
    // API成功後にUIを更新（事故防止）
    const successIds: string[] = [];
    const failedIds: string[] = [];

    // 並列3件ずつ処理
    const BATCH_SIZE = 3;
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (msg) => {
          const res = await fetch("/api/mailhub/mute", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: msg.id, action: "mute" }),
          });
          if (!res.ok) {
            throw new Error(`Failed: ${res.status}`);
          }
          return msg.id;
        })
      );

      results.forEach((result, idx) => {
        if (result.status === "fulfilled") {
          successIds.push(result.value);
          addToUndoStack({ id: result.value, message: batch[idx], action: "mute" });
        } else {
          failedIds.push(batch[idx].id);
        }
      });
    }

    // 成功した分だけUIから削除（アニメーション付き）
    if (successIds.length > 0) {
      // アニメーション開始
      successIds.forEach((id) => {
        setRemovingIds((prev) => new Set(prev).add(id));
      });
      
      // Glow effect（強く光らせる）
      setGlowTab("muted");
      setTimeout(() => setGlowTab(null), 1500);
      
      // アニメーション後に削除（より長いアニメーション）
      setTimeout(() => {
        setMessages((prev) => prev.filter((m) => !successIds.includes(m.id)));
        setRemovingIds((prev) => {
          const next = new Set(prev);
          successIds.forEach((id) => next.delete(id));
          return next;
        });
        
        if (selectedId && successIds.includes(selectedId)) {
          const remaining = messages.filter((m) => !successIds.includes(m.id));
          if (remaining.length > 0) {
            onSelectMessage(remaining[0].id);
          } else {
            setSelectedId(null);
            setSelectedMessage(null);
            setDetailBody({ plainTextBody: null, htmlBody: null, bodyNotice: null, isLoading: false });
            replaceUrl(labelId, null);
          }
        }
      }, 500);
      
      void fetchCountsDebounced();
    }

    if (failedIds.length > 0) {
      showToast(`${successIds.length}件処理完了。${failedIds.length}件失敗しました`, "error");
    } else {
      showToast(`${successIds.length}件を低優先に移動しました`, "success");
    }
  }, [triageCandidates, messages, selectedId, onSelectMessage, showToast, fetchCountsDebounced, addToUndoStack, labelId, replaceUrl]);

  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0) return;
    
    // スタックから最新の操作を取り出す
    const latestUndo = undoStack[0];
    
    // スタックから削除
    setUndoStack((prev) => prev.slice(1));

    // 一括操作の場合
    if ("ids" in latestUndo && latestUndo.action.startsWith("bulk")) {
      const { action, ids, messages: undoMessages } = latestUndo;
      
      try {
        // 3並列で逆操作を実行
        const BATCH_SIZE = 3;
        const successIds: string[] = [];
        const failedIds: string[] = [];
        
        for (let i = 0; i < ids.length; i += BATCH_SIZE) {
          const batch = ids.slice(i, i + BATCH_SIZE);
          const results = await Promise.allSettled(
            batch.map(async (id) => {
              let endpoint: string;
              let apiAction: string;
              
              if (action === "bulkArchive") {
                endpoint = "/api/mailhub/archive";
                apiAction = "unarchive";
              } else if (action === "bulkMute") {
                endpoint = "/api/mailhub/mute";
                apiAction = "unmute";
              } else if (action === "bulkWaiting") {
                endpoint = "/api/mailhub/status";
                apiAction = "unsetWaiting";
              } else if (action === "bulkAssign") {
                endpoint = "/api/mailhub/assign";
                apiAction = "unassign";
              } else {
                throw new Error(`Unknown bulk action: ${action}`);
              }
              
              const res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, action: apiAction }),
              });
              if (!res.ok) {
                throw new Error(`Undo failed: ${res.status}`);
              }
              return id;
            })
          );
          
          results.forEach((result, idx) => {
            if (result.status === "fulfilled") {
              successIds.push(result.value);
            } else {
              failedIds.push(batch[idx]);
            }
          });
        }
        
        // UI更新
        if (successIds.length > 0) {
          // Step 51: 検索クエリがある場合は再検索、なければ楽観的更新
          if (serverSearchQuery) {
            await loadList(labelId, null, { q: serverSearchQuery });
          } else {
            // メッセージをリストに戻す
            setMessages((prev) => {
              const existingIds = new Set(prev.map((m) => m.id));
              const toAdd = undoMessages.filter((m) => !existingIds.has(m.id));
              return [...toAdd, ...prev];
            });
          }
          setCheckedIds(new Set());
          void fetchCountsDebounced();
        }
        
        if (failedIds.length > 0) {
          showToast(`${successIds.length}件を元に戻しました。${failedIds.length}件失敗しました`, "error");
        } else {
          showToast(`${successIds.length}件を元に戻しました`, "success");
        }
      } catch (e) {
        setUndoStack((prev) => [latestUndo, ...prev]);
        showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
        reloadCurrentList();
      }
      return;
    }
    
    // 単一操作の場合（既存のロジック）
    if (!("id" in latestUndo)) {
      return; // 型ガード
    }
    const { id, message, action } = latestUndo;

    try {
      // actionに応じて適切なAPIを呼ぶ
      let apiAction: string;
      let endpoint: string;
      if (action === "archive") {
        endpoint = "/api/mailhub/archive";
        apiAction = "unarchive";
      } else if (action === "setWaiting") {
        endpoint = "/api/mailhub/status";
        apiAction = "unsetWaiting";
      } else if (action === "unsetWaiting") {
        endpoint = "/api/mailhub/status";
        apiAction = "setWaiting";
      } else if (action === "mute") {
        endpoint = "/api/mailhub/mute";
        apiAction = "unmute";
      } else if (action === "unmute") {
        endpoint = "/api/mailhub/mute";
        apiAction = "mute";
      } else if (action === "assign") {
        // assignのUndo = unassign
        await handleUnassign(id);
        // Step 51: 検索クエリがある場合は再検索
        if (serverSearchQuery) {
          await loadList(labelId, id, { q: serverSearchQuery });
        }
        showToast("元に戻しました", "success");
        void fetchCountsDebounced();
        return;
      } else if (action === "unassign") {
        // unassignのUndo = assign
        await handleAssign(id);
        // Step 51: 検索クエリがある場合は再検索
        if (serverSearchQuery) {
          await loadList(labelId, id, { q: serverSearchQuery });
        }
        showToast("元に戻しました", "success");
        void fetchCountsDebounced();
        return;
      } else if (action === "snooze") {
        endpoint = "/api/mailhub/snooze";
        apiAction = "unsnooze";
      } else if (action === "unsnooze") {
        endpoint = "/api/mailhub/snooze";
        apiAction = "snooze";
        // unsnoozeのUndoはsnoozeだが、untilが必要なのでUndo不可として扱う
        throw new Error("Snooze解除の取り消しはできません");
      } else {
        throw new Error(`Unknown action: ${action}`);
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: apiAction }),
      });
      if (!res.ok) {
        throw new Error(`Undo failed: ${res.status}`);
      }
      
      // Step 51: 検索クエリがある場合は再検索（その後onSelectMessageを呼ぶ）
      if (serverSearchQuery) {
        await loadList(labelId, id, { q: serverSearchQuery });
      } else {
        // 検索クエリがない場合は楽観的更新
        setMessages((prev) => {
          // 既に存在する場合は追加しない
          if (prev.some((m) => m.id === id)) return prev;
          return [message, ...prev];
        });
        onSelectMessage(id);
      }
      
      showToast("元に戻しました", "success");
      void fetchCountsDebounced();
    } catch (e) {
      // エラー時はスタックに戻す
      setUndoStack((prev) => [latestUndo, ...prev]);
      showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
      reloadCurrentList();
    }
  }, [undoStack, serverSearchQuery, labelId, onSelectMessage, showToast, fetchCountsDebounced, reloadCurrentList, loadList, handleUnassign, handleAssign]);

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
    if (!textToCopy || !selectedMessage) return;

    try {
      try {
        await navigator.clipboard.writeText(textToCopy);
      } catch {
        // fallback（Playwright/ブラウザ制限対策）
        const ta = document.createElement("textarea");
        ta.value = textToCopy;
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
      showToast("返信内容をコピーしました", "success");
      // Activity記録（best-effort）
      try {
        const action = lastAppliedTemplate ? "template_copy" : "reply_copy_template";
        await fetch("/api/mailhub/activity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            messageId: selectedMessage.id,
            metadata: {
              route: replyRoute?.kind,
              channel: channelId,
              bodyLength: textToCopy.length,
              ...(lastAppliedTemplate
                ? {
                    templateId: lastAppliedTemplate.id,
                    templateName: lastAppliedTemplate.title,
                    unresolvedVars: lastAppliedTemplate.unresolvedVars,
                  }
                : {}),
            },
          }),
        });
      } catch {
        // ignore
      }
    } catch {
      showToast("コピーに失敗しました", "error");
    }
  }, [replyMessage, selectedMessage, replyRoute, showToast, lastAppliedTemplate, channelId]);

  // Step 106: コンテキスト情報をコピー
  const handleCopyContext = useCallback(async () => {
    if (!selectedMessage) return;

    // コピー内容を組み立て
    const lines: string[] = [];
    lines.push(`件名: ${selectedMessage.subject || "(なし)"}`);
    lines.push(`From: ${selectedMessage.from || "(なし)"}`);
    lines.push(`受信日時: ${selectedMessage.receivedAt || "(なし)"}`);
    lines.push(`messageId: ${selectedMessage.id}`);
    lines.push(`URL: ${typeof window !== "undefined" ? window.location.href : ""}`);
    if (selectedMessage.assigneeSlug) {
      lines.push(`担当者: ${selectedMessage.assigneeSlug}`);
    }
    // statusType（activeLabel）から取得
    if (activeLabel?.statusType) {
      lines.push(`ステータス: ${activeLabel.statusType}`);
    }

    const textToCopy = lines.join("\n");

    try {
      try {
        await navigator.clipboard.writeText(textToCopy);
      } catch {
        // fallback（navigator.clipboard が無い環境）
        const ta = document.createElement("textarea");
        ta.value = textToCopy;
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
      showToast("コンテキストをコピーしました", "success");
    } catch {
      showToast("コピーに失敗しました", "error");
    }
  }, [selectedMessage, activeLabel, showToast]);

  // 問い合わせ番号をコピー（Step55: Activityログ追加）
  const handleCopyInquiryNumber = useCallback(async () => {
    if (!replyInquiryNumber || !selectedMessage) return;

    try {
      await navigator.clipboard.writeText(replyInquiryNumber);
      showToast("問い合わせ番号をコピーしました", "success");
      // Activity記録（best-effort）
      try {
        await fetch("/api/mailhub/activity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "reply_copy_inquiry",
            messageId: selectedMessage.id,
            metadata: {
              inquiryId: replyInquiryNumber,
            },
          }),
        });
      } catch {
        // ignore
      }
    } catch {
      showToast("コピーに失敗しました", "error");
    }
  }, [replyInquiryNumber, selectedMessage, showToast]);

  // RMSを開くURLを生成（Step55: replyRouteから取得）
  const getRmsUrl = useCallback(() => {
    // replyRouteにopenUrlが含まれている場合はそれを使用
    if (replyRoute?.kind === "rakuten_rms" && replyRoute.openUrl) {
      return replyRoute.openUrl;
    }
    // フォールバック: 環境変数から取得（クライアント側では使用不可のため、サーバ側で設定）
    // デフォルト（未設定の場合は空文字を返して無効化）
    return "";
  }, [replyRoute]);

  // Step 112: Command Palette用のコマンドリスト
  const commandPaletteCommands = useMemo<Command[]>(() => [
    {
      id: "refresh",
      label: "Refresh",
      icon: <RefreshCw size={18} />,
      action: () => {
        void refreshLightSync();
      },
    },
    {
      id: "focus-search",
      label: "Focus Search",
      icon: <Search size={18} />,
      action: () => {
        const searchInput = document.querySelector<HTMLInputElement>('[data-testid="topbar-search"]');
        searchInput?.focus();
      },
    },
    {
      id: "toggle-activity",
      label: "Toggle Activity",
      icon: <Activity size={18} />,
      action: () => {
        setShowActivityDrawer((prev) => !prev);
      },
    },
    {
      id: "toggle-settings",
      label: "Toggle Settings",
      icon: <Settings size={18} />,
      action: () => {
        if (!isAdmin && !readOnlyMode) {
          showToast("Settingsはadminのみ利用可能です", "error");
          return;
        }
        setShowSettingsDrawer((prev) => !prev);
      },
      disabled: !isAdmin && !readOnlyMode,
    },
    {
      id: "take-next",
      label: "Take Next",
      icon: <Zap size={18} />,
      action: () => {
        void handleTakeNext();
      },
      disabled: readOnlyMode,
    },
    {
      id: "show-shortcuts",
      label: "Show Shortcuts",
      icon: <HelpCircle size={18} />,
      action: () => {
        setShowShortcutHelp(true);
      },
    },
  ], [refreshLightSync, showToast, isAdmin, readOnlyMode, handleTakeNext]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isCheckbox =
        target.tagName === "INPUT" &&
        ["checkbox", "radio"].includes(((target as HTMLInputElement).type || "").toLowerCase());
      const isTypingField =
        ((target.tagName === "INPUT" && !isCheckbox) || target.tagName === "TEXTAREA" || target.isContentEditable);
      
      if (isTypingField) {
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

      // Step 112: Command Paletteが開いている時は他のショートカットを無効化
      if (showCommandPalette) {
        // CommandPalette内でEscキーを押した時は閉じる（CommandPaletteコンポーネント内で処理）
        return;
      }

      // Step 112: Cmd+K / Ctrl+K: Command Palette
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && !e.shiftKey) {
        e.preventDefault();
        setShowCommandPalette(true);
        return;
      }
      // Views Command Palette: Cmd+Shift+K / Ctrl+Shift+K
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && e.shiftKey) {
        e.preventDefault();
        setShowViewsPalette(true);
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
          if (checkedIds.size > 0) {
            handleBulkDone(Array.from(checkedIds));
          } else if (selectedId) {
            handleArchive(selectedId);
          }
          break;
        }
        case "w": case "W": case "l": case "L": {
          e.preventDefault();
          if (checkedIds.size > 0) {
            handleBulkWaiting(Array.from(checkedIds));
          } else if (selectedId) {
            handleSetWaiting(selectedId);
          }
          break;
        }
        case "c": case "C": {
          e.preventDefault();
          void handleToggleAssigneeForSelection();
          break;
        }
        case "a": case "A": {
          e.preventDefault();
          // A: 担当解除（選択中のうち自分担当だけ解除）
          if (selectedIds.length === 0) break;
          const idToAssignee = new Map(messages.map((m) => [m.id, m.assigneeSlug] as const));
          const toUnassign = selectedIds.filter((id) => idToAssignee.get(id) === myAssigneeSlug);
          if (toUnassign.length === 0) break;
          void (async () => {
            try {
              await executeBulkAction(
                toUnassign,
                async (id) => {
                  await postJsonOrThrow("/api/mailhub/assign", { id, action: "unassign" });
                },
                "bulkAssign",
              );
              setMessages((prev) => prev.map((m) => (toUnassign.includes(m.id) ? { ...m, assigneeSlug: null } : m)));
              setSelectedMessage((prev) => (prev && toUnassign.includes(prev.id) ? { ...prev, assigneeSlug: null } : prev));
              showToast(`${toUnassign.length}件を担当解除しました`, "success");
              void fetchCountsDebounced();
            } catch (e) {
              showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
            }
          })();
          break;
        }
        case "u": case "U": {
          e.preventDefault();
          handleUndo();
          break;
        }
        case "s": case "S": {
          e.preventDefault();
          // Step 67: S = SLA Focus、Shift+S = Critical-only（SLA ON時のみ）
          if (e.shiftKey && slaFocus) {
            // Shift+S: Critical-only切替
            setSlaCriticalOnly((prev) => {
              const next = !prev;
              const url = new URL(window.location.href);
              if (next) url.searchParams.set("slaLevel", "critical");
              else url.searchParams.delete("slaLevel");
              window.history.replaceState({}, "", url.toString());
              return next;
            });
          } else {
            // S: SLA Focus ON/OFF
            setSlaFocus((prev) => {
              const next = !prev;
              const url = new URL(window.location.href);
              if (next) url.searchParams.set("sla", "1");
              else {
                url.searchParams.delete("sla");
                url.searchParams.delete("slaLevel");
              }
              window.history.replaceState({}, "", url.toString());
              // OFFにする場合はcriticalOnlyもクリア
              if (!next) setSlaCriticalOnly(false);
              return next;
            });
          }
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
        case "n": case "N": {
          // Step 111: N = Take Next（未割当を1件自動で自分に割当）
          e.preventDefault();
          void handleTakeNext();
          break;
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    selectedId,
    selectedMessage,
    showShortcutHelp,
    myAssigneeSlug,
    checkedIds,
    messages,
    handleMoveSelection,
    handleArchive,
    handleSetWaiting,
    handleMute,
    handleUnmute,
    handleToggleClaimed,
    handleAssign,
    handleUnassign,
    handleUndo,
    handleBulkArchive,
    handleBulkDone,
    handleBulkWaiting,
    handleBulkAssign,
    handleToggleAssigneeForSelection,
    executeBulkAction,
    selectedIds,
    activeLabel,
    fetchCountsDebounced,
    handleUnsnooze,
    openSnoozePopover,
    showToast,
    slaFocus,
    handleTakeNext,
    showCommandPalette,
  ]);

  // リサイズロジック
  const startResizing = useCallback((type: "sidebar" | "list") => {
    setResizing(type);
  }, []);

  const stopResizing = useCallback(() => {
    setResizing(null);
  }, []);

  const resize = useCallback((e: MouseEvent) => {
    if (resizing === "sidebar") {
      // サイドバーリサイズ: 最小200px、最大320px（レスポンシブ対応）
      const newWidth = Math.min(Math.max(e.clientX, 200), 320);
      setSidebarWidth(newWidth);
    } else if (resizing === "list") {
      // リストリサイズ: 最小280px、最大720px（レスポンシブ対応）
      const sidebarAndPadding = sidebarWidth + 16; // sidebar + main area padding
      const newWidth = Math.min(Math.max(e.clientX - sidebarAndPadding, 280), 720);
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
        <Sidebar
          sidebarWidth={sidebarWidth}
          labelId={labelId}
          viewTab={viewTab}
          glowTab={glowTab}
          labelGroups={sidebarLabelGroups}
          views={views}
          activeViewId={activeViewId}
          testMode={testMode}
          messagesLength={messages.length}
          channelCounts={channelCounts}
          statusCounts={statusCounts}
          user={user}
          version={version}
          logoutAction={logoutAction}
          onSelectLabel={onSelectLabel}
          onAssignedStatusClick={handleAssignedStatusClick}
          onSelectView={onSelectView}
          team={team}
          isAdmin={isAdmin}
          activeAssigneeSlug={activeAssigneeSlug}
          onSelectTeamMember={handleSelectTeamMember}
        />

        {/* サイドバーリサイザー */}
        <div 
          className="w-1 cursor-col-resize hover:bg-blue-500/30 transition-colors active:bg-blue-500/50 z-20"
          onMouseDown={() => startResizing("sidebar")}
        />

        {/* --- 右側エリア (ヘッダー + ツールバー + タブ + メイン) --- */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          
          {/* ヘッダー（検索バー - Gmail完全再現） */}
          <TopHeader
            searchTerm={searchTerm}
            onChangeSearch={setSearchTerm}
            onSearchSubmit={(query) => {
              // Step 98: note検索はStore側のみ（Gmail検索は使わない）
              const parsed = parseNoteSearch(query);
              const tagParsed = parseTagSearch(parsed.textQuery);
              const seenParsed = parseSeenSearch(tagParsed.textQuery);
              // Step 105: is:unseen / is:seen もStore側のみ
              if (parsed.hasNote || parsed.noteQuery || tagParsed.hasTag || tagParsed.tagSlug || seenParsed.isUnseen || seenParsed.isSeen) {
                setServerSearchQuery("");
                setSearchTerm(query);
                return;
              }
              // Step 51: Enterでサーバ検索を実行
              setServerSearchQuery(query);
              startTransition(async () => {
                try {
                  await loadList(labelId, null, { q: query });
                  listRef.current?.scrollTo({ top: 0 });
                } catch (e) {
                  setListError(e instanceof Error ? e.message : String(e));
                }
              });
            }}
            onSearchClear={() => {
              // Step 51: 検索解除
              setServerSearchQuery("");
              startTransition(async () => {
                try {
                  await loadList(labelId, selectedId, {});
                  listRef.current?.scrollTo({ top: 0 });
                } catch (e) {
                  setListError(e instanceof Error ? e.message : String(e));
                }
              });
            }}
            serverSearchQuery={serverSearchQuery}
            isPending={isPending}
            onOpenSettings={() => setShowSettingsDrawer(true)}
            showSettings={canOpenSettings}
            onOpenOps={() => setShowOpsDrawer(true)}
            onOpenHandoff={() => setShowHandoffDrawer(true)}
            onOpenActivity={(ruleId) => {
              // Settings上の「Activityで見る」などから開くケースでは、Settings overlay がクリックを遮るため先に閉じる
              setShowSettingsDrawer(false);
              setActivityRuleIdFilter(ruleId || null);
              setShowActivityDrawer(true);
            }}
            onOpenDiagnostics={() => setShowDiagnosticsDrawer(true)}
            onOpenHelp={() => setShowHelpDrawer(true)}
            onTakeNext={handleTakeNext}
            onRefresh={refreshLightSync}
            gmailLink={selectedMessage?.gmailLink ?? null}
            onOpenShortcutHelp={() => setShowShortcutHelp(true)}
            testMode={testMode}
            onTestReset={() => void handleTestReset()}
            mailhubEnv={mailhubEnv}
            readOnlyMode={readOnlyMode}
            onOpenQueues={openQueuesPopover}
            queuesButtonRef={queuesButtonRef}
            macroDisabled={readOnlyMode || (checkedIds.size === 0 && !selectedId)}
            onRunMacro={runMacro}
            onOpenCommandPalette={() => setShowCommandPalette(true)}
          />

          {/* Step 51: 検索中の見た目（検索中チップ） */}
          {serverSearchQuery && (
            <div className="px-4 py-2 bg-[#e8f0fe] border-b border-[#d2e3fc] flex items-center justify-between gap-2" data-testid="search-active-chip">
              <div className="flex items-center gap-2 text-sm text-[#1a73e8]">
                <Search size={16} />
                <span>検索中: <code className="text-xs bg-white px-1 py-0.5 rounded">{serverSearchQuery}</code></span>
              </div>
              <button
                type="button"
                data-testid="search-chip-clear"
                onClick={() => {
                  setServerSearchQuery("");
                  setSearchTerm("");
                  startTransition(async () => {
                    try {
                      await loadList(labelId, selectedId, {});
                      listRef.current?.scrollTo({ top: 0 });
                    } catch (e) {
                      setListError(e instanceof Error ? e.message : String(e));
                    }
                  });
                }}
                className="text-[#1a73e8] hover:text-[#1557b0] text-xs font-medium"
              >
                クリア
              </button>
            </div>
          )}

          <SettingsDrawer
            open={showSettingsDrawer}
            onClose={() => setShowSettingsDrawer(false)}
            onOpenActivity={(ruleId) => {
              // Settings内リンクから開く場合も、Settings overlay がクリックを遮るため先に閉じる
              setShowSettingsDrawer(false);
              setActivityRuleIdFilter(ruleId || null);
              setShowActivityDrawer(true);
            }}
          />

          <DiagnosticsDrawer
            open={showDiagnosticsDrawer}
            onClose={() => setShowDiagnosticsDrawer(false)}
          />

          <HelpDrawer
            open={showHelpDrawer}
            onClose={() => setShowHelpDrawer(false)}
            readOnlyMode={readOnlyMode}
            isAdmin={isAdmin}
            onShowOnboarding={() => setShowOnboarding(true)}
          />

          {showOnboarding && (
            <OnboardingModal onClose={() => setShowOnboarding(false)} />
          )}

          {/* ツールバー（アクションボタン群） */}
          <div className={t.toolbar} data-testid="toolbar">
            <div className="flex items-center gap-1 flex-1 min-w-0">
              {/* 選択状態表示（常にスペースを確保してボタンが動かないようにする） */}
              <span className="text-[13px] text-[#3c4043] mr-2 font-normal flex-shrink-0 min-w-[80px] text-right" data-testid="bulk-selection-count">
                {checkedIds.size > 0 ? `${checkedIds.size}件選択中` : '\u00A0'}
              </span>

              {/* アクションボタン（Gmail完全再現） */}
              <button 
                data-testid="action-done"
                onClick={() => {
                  if (checkedIds.size > 0) {
                    handleBulkDone(Array.from(checkedIds));
                  } else if (selectedId) {
                    handleArchive(selectedId);
                  }
                }}
                className={`${t.toolbarButton} ${(isActionInProgress || bulkProgress) ? "opacity-60" : ""}`} 
                title={readOnlyMode ? (getWriteBlockedTitle() ?? "実行できません") : "完了"}
                disabled={readOnlyMode || (!selectedId && checkedIds.size === 0) || isActionInProgress || bulkProgress !== null}
              >
                {(isActionInProgress || bulkProgress) ? (
                  <span className="action-spinner" data-testid="action-spinner" />
                ) : (
                  <CheckCircle size={20} className={checkedIds.size > 0 || selectedId ? "text-[#34a853]" : "text-[#5f6368]"} />
                )}
                <span className="hidden lg:inline">{(isActionInProgress || bulkProgress) ? "処理中" : "完了"}</span>
                {!(isActionInProgress || bulkProgress) && <span className={t.toolbarShortcut} title="ショートカット: E">E</span>}
              </button>
              
              <button 
                data-testid="action-waiting"
                onClick={() => {
                  if (checkedIds.size > 0) {
                    handleBulkWaiting(Array.from(checkedIds));
                  } else if (selectedId) {
                    handleSetWaiting(selectedId);
                  }
                }}
                className={`${t.toolbarButton} ${(isActionInProgress || bulkProgress) ? "opacity-60" : ""}`} 
                title={readOnlyMode ? (getWriteBlockedTitle() ?? "実行できません") : "保留"}
                disabled={readOnlyMode || (!selectedId && checkedIds.size === 0) || isActionInProgress || bulkProgress !== null}
              >
                <Clock size={20} className={checkedIds.size > 0 || selectedId ? "text-[#ea8600]" : "text-[#5f6368]"} />
                <span className="hidden lg:inline">保留</span>
                <span className={t.toolbarShortcut} title="ショートカット: W">W</span>
              </button>

              {/* 担当（1ボタンに統合 - Gmail完全再現） */}
              <button
                data-testid={checkedIds.size > 0 ? (allSelectedMine ? "action-unassign" : "action-assign") : (isSelectedMine ? "action-unassign" : "action-assign")}
                className={`${t.toolbarButton} ${(checkedIds.size > 0 ? someSelectedMine : isSelectedMine) ? t.toolbarButtonActive : ""} ${(isActionInProgress || bulkProgress) ? "opacity-60" : ""}`}
                onClick={() => {
                  if (checkedIds.size > 0) {
                    handleAssignClick(null, Array.from(checkedIds));
                  } else if (selectedId) {
                    handleAssignClick(selectedId);
                  }
                }}
                title={
                  readOnlyMode
                    ? (getWriteBlockedTitle() ?? "実行できません")
                    : checkedIds.size > 0
                    ? (allSelectedMine ? "選択分を担当解除" : "選択分を担当")
                    : (isSelectedMine ? "担当解除" : "担当")
                }
                disabled={readOnlyMode || selectedIds.length === 0 || bulkProgress !== null || isActionInProgress}
              >
                <UserCheck size={20} className={(checkedIds.size > 0 ? someSelectedMine : isSelectedMine) ? "text-[#1a73e8]" : "text-[#5f6368]"} />
                <span className="hidden lg:inline">{(checkedIds.size > 0 ? allSelectedMine : isSelectedMine) ? "担当解除" : "担当"}</span>
                <span className={t.toolbarShortcut} title="ショートカット: C">C</span>
              </button>

              {/* 低優先（常に表示 - 複数選択時は一括処理、単独選択時は単独処理） */}
              <button 
                data-testid={checkedIds.size > 0 ? "bulk-action-mute" : "action-mute"}
                onClick={() => {
                  if (checkedIds.size > 0) {
                    handleBulkMuteSelected(Array.from(checkedIds));
                  } else if (selectedId) {
                    handleMute(selectedId);
                  }
                }}
                className={`${t.toolbarButton} ${(isActionInProgress || bulkProgress) ? "opacity-60" : ""}`}
                title={readOnlyMode ? (getWriteBlockedTitle() ?? "実行できません") : (checkedIds.size > 0 ? "選択分を低優先へ" : "低優先へ")}
                disabled={readOnlyMode || (!selectedId && checkedIds.size === 0) || isActionInProgress || bulkProgress !== null}
              >
                <VolumeX size={20} className={checkedIds.size > 0 || selectedId ? "text-[#ea8600]" : "text-[#5f6368]"} />
                <span className="hidden lg:inline">低優先</span>
              </button>

              {/* Step 23: Gmail-like Labels */}
              <div className="relative">
                <button
                  data-testid="action-label"
                  ref={labelButtonRef}
                  type="button"
                  onClick={() => {
                    if (labelPopoverOpen) {
                      setLabelPopoverOpen(false);
                      return;
                    }
                    openLabelPopover();
                  }}
                  className={t.toolbarButton}
                  title={readOnlyMode ? (getWriteBlockedTitle() ?? "実行できません") : "ラベル"}
                  aria-disabled={selectedIds.length === 0}
                >
                  <Tag size={20} className={selectedIds.length > 0 ? "text-[#1a73e8]" : "text-[#5f6368]"} />
                  <span className="hidden lg:inline">ラベル</span>
                </button>
              </div>

              {/* 一括操作ボタン（選択時のみ有効 - Gmail完全再現） */}
              {checkedIds.size > 0 && (
                <>
                  <div className="w-px h-5 bg-[#dadce0] mx-2"></div>
                  {/* Step 100: Unassignedビューで「自分に一発Assign」 */}
                  {activeLabel?.id === "unassigned" && (
                    <button
                      data-testid="bulk-assign-me"
                      onClick={() => handleBulkAssignSelected(Array.from(checkedIds))}
                      className={`${t.toolbarButton} ${(isActionInProgress || bulkProgress) ? "opacity-60" : ""}`}
                      title={readOnlyMode ? (getWriteBlockedTitle() ?? "実行できません") : "選択分を自分に担当割当（即実行）"}
                      disabled={readOnlyMode || bulkProgress !== null || isActionInProgress}
                    >
                      <UserCheck size={20} className="text-[#1a73e8]" />
                      <span className="hidden lg:inline">自分へ</span>
                    </button>
                  )}
                  <button 
                    data-testid="bulk-assign-open"
                    onClick={() => handleAssignClick(null, Array.from(checkedIds))}
                    className={`${t.toolbarButton} ${(isActionInProgress || bulkProgress) ? "opacity-60" : ""}`}
                    title={readOnlyMode ? (getWriteBlockedTitle() ?? "実行できません") : "選択分を担当割当..."}
                    disabled={readOnlyMode || bulkProgress !== null}
                  >
                    <UserCheck size={20} className="text-[#1a73e8]" />
                    <span className="hidden lg:inline">担当…</span>
                  </button>
                  <button 
                    data-testid="bulk-action-clear"
                    onClick={() => {
                      setCheckedIds(new Set());
                      setLastCheckedId(null);
                    }}
                    className={t.toolbarButton}
                    title="選択解除"
                    disabled={bulkProgress !== null}
                  >
                    <Square size={20} className="text-[#5f6368]" />
                    <span className="hidden lg:inline">解除</span>
                  </button>
                </>
              )}

              {/* Step 63: Auto Assign (Round-robin) - Unassignedビューでのみ表示 */}
              {activeLabel?.id === "unassigned" && (isAdmin || testMode) && team.length > 0 && (
                <>
                  <div className="w-px h-5 bg-[#dadce0] mx-2"></div>
                  <button
                    data-testid="action-auto-assign"
                    onClick={() => {
                      // Round-robin配分を計算（assigneeSlugがnull/undefined/空文字のものが対象）
                      const unassignedMsgs = messages.filter((m) => !m.assigneeSlug || m.assigneeSlug === "").slice(0, 30);
                      if (unassignedMsgs.length === 0) {
                        showToast("未割当のメッセージがありません", "error");
                        return;
                      }
                      const preview = unassignedMsgs.map((m, i) => ({
                        id: m.id,
                        subject: m.subject,
                        assignee: team[i % team.length].email,
                      }));
                      setAutoAssignPreview(preview);
                      setShowAutoAssignModal(true);
                    }}
                    className={`${t.toolbarButton} ${bulkProgress ? "opacity-60" : ""}`}
                    title={readOnlyMode ? (getWriteBlockedTitle() ?? "実行できません") : "Auto Assign（配分）"}
                    disabled={readOnlyMode || bulkProgress !== null}
                  >
                    <Users size={20} className="text-[#1a73e8]" />
                    <span className="hidden lg:inline">配分</span>
                  </button>
                </>
              )}

              <div className="w-px h-5 bg-[#dadce0] mx-2"></div>

              <button 
                data-testid="action-undo"
                onClick={handleUndo}
                className={t.toolbarButton} 
                disabled={undoStack.length === 0}
                title={`取り消し${undoStack.length > 0 ? ` - ${undoStack.length}件` : ""}`}
              >
                <Undo2 size={20} className={undoStack.length > 0 ? "text-[#1a73e8]" : "text-[#5f6368]"} />
                <span className={t.toolbarShortcut} title="ショートカット: U">U</span>
                {undoStack.length > 0 && (
                  <span className="ml-1 text-[11px] bg-[#E8F0FE] text-[#1a73e8] px-1.5 py-0.5 rounded font-medium">
                    {undoStack.length}
                  </span>
                )}
              </button>

              {/* Step 66: SLA Focus ボタン */}
              <button 
                data-testid="action-sla-focus"
                onClick={() => {
                  setSlaFocus((prev) => {
                    const next = !prev;
                    const url = new URL(window.location.href);
                    if (next) url.searchParams.set("sla", "1");
                    else {
                      url.searchParams.delete("sla");
                      url.searchParams.delete("slaLevel");
                    }
                    window.history.replaceState({}, "", url.toString());
                    if (!next) setSlaCriticalOnly(false);
                    return next;
                  });
                }}
                className={`${t.toolbarButton} ${slaFocus ? "bg-[#fef7e0] border-[#f9ab00]" : ""} ${slaCriticalOnly ? "ring-2 ring-red-400" : ""}`} 
                title={slaFocus ? (slaCriticalOnly ? "SLA Focus: Critical-only" : "SLA Focus: ON（危険メールのみ表示中）") : "SLA Focus: OFF（全メール表示）"}
              >
                <AlertTriangle size={20} className={slaFocus ? "text-[#f9ab00]" : "text-[#5f6368]"} />
                <span className="hidden lg:inline">SLA</span>
              </button>
            </div>
          </div>

          {/* Step 52: Queues Popover（Portalで確実に表示） */}
          {queuesPopoverOpen &&
            queuesPopoverPos &&
            typeof document !== "undefined" &&
            createPortal(
              <div
                ref={queuesPopoverRef}
                data-testid="queues-popover"
                className="fixed z-[9999] w-[320px] rounded-lg border border-[#dadce0] bg-white shadow-[0_2px_10px_rgba(0,0,0,0.12)] p-3"
                style={{ top: queuesPopoverPos.top, left: queuesPopoverPos.left }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[12px] font-medium text-[#202124]">Queues（作業キュー）</div>
                  <button
                    type="button"
                    className="px-2 py-1 text-[12px] text-[#5f6368] hover:bg-[#f1f3f4] rounded"
                    onClick={() => setQueuesPopoverOpen(false)}
                  >
                    閉じる
                  </button>
                </div>
                <div className="max-h-64 overflow-auto">
                  {savedSearches.length === 0 ? (
                    <div className="text-[12px] text-[#5f6368] py-3">保存済みキューがありません</div>
                  ) : (
                    <div className="space-y-1">
                      {savedSearches.map((search) => (
                        <button
                          key={search.id}
                          type="button"
                          data-testid={`queues-item-${search.id}`}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#f1f3f4] text-left"
                          onClick={() => applyQueue(search)}
                        >
                          <span className="text-[13px] text-[#202124] flex-1">{search.name}</span>
                          {search.baseLabelId && (
                            <span className="text-[11px] text-[#5f6368] bg-[#f1f3f4] px-1.5 py-0.5 rounded">
                              {labelGroups.flatMap((g) => g.items).find((l) => l.id === search.baseLabelId)?.label ?? search.baseLabelId}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>,
              document.body,
            )}
          {/* Step 23: Label Popover（Portalで確実に表示） */}
          {labelPopoverOpen &&
            labelPopoverPos &&
            typeof document !== "undefined" &&
            createPortal(
              <div
                ref={labelPopoverRef}
                data-testid="label-popover"
                className="fixed z-[9999] w-[320px] rounded-lg border border-[#dadce0] bg-white shadow-[0_2px_10px_rgba(0,0,0,0.12)] p-3"
                style={{ top: labelPopoverPos.top, left: labelPopoverPos.left }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[12px] font-medium text-[#202124]">ラベル</div>
                  <button
                    type="button"
                    className="px-2 py-1 text-[12px] text-[#5f6368] hover:bg-[#f1f3f4] rounded"
                    onClick={() => setLabelPopoverOpen(false)}
                  >
                    閉じる
                  </button>
                </div>

                {selectedIds.length === 0 && (
                  <div className="mb-2 text-[12px] text-[#c5221f] bg-[#fce8e6] border border-[#f28b82] rounded px-2 py-1">
                    メールを選択してください（チェック or 行クリック）
                  </div>
                )}

                <input
                  value={labelPopoverQuery}
                  onChange={(e) => setLabelPopoverQuery(e.target.value)}
                  placeholder="ラベルを検索"
                  className="w-full border border-[#dadce0] rounded-md px-3 py-2 text-[13px] outline-none focus:border-[#1a73e8]"
                />

                <div className="mt-2 max-h-56 overflow-auto">
                  {visibleRegisteredLabels.length === 0 ? (
                    <div className="text-[12px] text-[#5f6368] py-3">登録済みラベルがありません</div>
                  ) : (
                    <div className="space-y-1">
                      {visibleRegisteredLabels.map((l) => {
                        const st = labelSelectionState.get(l.labelName) ?? { all: false, some: false };
                        const mark = st.all ? "✓" : st.some ? "−" : "";
                        return (
                          <button
                            key={l.labelName}
                            type="button"
                            className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#f1f3f4] text-left"
                            onClick={() => {
                              if (selectedIds.length === 0) {
                                showToast("メールを選択してください", "error");
                                return;
                              }
                              void handleToggleLabelForSelection(l.labelName);
                            }}
                          >
                            <span
                              className={`w-4 h-4 flex items-center justify-center rounded border ${
                                st.all
                                  ? "bg-[#1a73e8] border-[#1a73e8] text-white"
                                  : st.some
                                    ? "bg-[#E8F0FE] border-blue-200 text-[#1a73e8]"
                                    : "bg-white border-[#dadce0] text-transparent"
                              } text-[12px] leading-none`}
                              aria-hidden
                            >
                              {mark}
                            </span>
                            <span className="text-[13px] text-[#202124] truncate">{l.displayName ?? l.labelName}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 単体選択時のみ: ルール作成 */}
                {selectedIds.length === 1 && singleSelectedFromEmail && (
                  <div className="mt-3 space-y-2">
                    <label className="flex items-center gap-2 text-[12px] text-[#3c4043]">
                      <input
                        data-testid="label-auto-rule"
                        type="checkbox"
                        checked={autoApplyRule}
                        onChange={(e) => setAutoApplyRule(e.target.checked)}
                      />
                      この送信元に今後も自動適用（{singleSelectedFromEmail}）
                    </label>
                    {autoApplyRule && (
                      <div className="flex items-center gap-2 text-[12px] text-[#5f6368]">
                        <span className="shrink-0">一致:</span>
                        <button
                          type="button"
                          className={`px-2 py-1 rounded border ${
                            autoApplyRuleMatchMode === "email"
                              ? "bg-[#E8F0FE] border-blue-200 text-[#1a73e8]"
                              : "bg-white border-[#dadce0] text-[#5f6368]"
                          }`}
                          onClick={() => setAutoApplyRuleMatchMode("email")}
                        >
                          fromEmail
                        </button>
                        <button
                          type="button"
                          className={`px-2 py-1 rounded border ${
                            autoApplyRuleMatchMode === "domain"
                              ? "bg-[#E8F0FE] border-blue-200 text-[#1a73e8]"
                              : "bg-white border-[#dadce0] text-[#5f6368]"
                          } ${singleSelectedFromDomain ? "" : "opacity-40 cursor-not-allowed"}`}
                          disabled={!singleSelectedFromDomain}
                          onClick={() => {
                            if (!singleSelectedFromDomain) return;
                            setAutoApplyRuleMatchMode("domain");
                          }}
                          title={singleSelectedFromDomain ? `fromDomain: ${singleSelectedFromDomain}` : "fromDomainが取得できません"}
                        >
                          fromDomain
                        </button>
                        {autoApplyRuleMatchMode === "domain" && singleSelectedFromDomain && (
                          <span className="truncate">({singleSelectedFromDomain})</span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-3 border-t border-[#e8eaed] pt-3 space-y-2">
                  <div className="text-[11px] font-medium text-[#5f6368] uppercase tracking-wider">ラベル登録</div>
                  {canOpenSettings ? (
                    <>
                      <div className="flex items-center gap-2">
                        <input
                          data-testid="label-new-input"
                          value={newLabelName}
                          onChange={(e) => setNewLabelName(e.target.value)}
                          placeholder="例: VIP"
                          className="flex-1 border border-[#dadce0] rounded-md px-3 py-2 text-[13px] outline-none focus:border-[#1a73e8]"
                        />
                        <button
                          type="button"
                          data-testid="label-new-add"
                          className="px-3 py-2 text-[13px] bg-[#1a73e8] text-white rounded-md hover:bg-[#1557b0]"
                          onClick={() => void handleRegisterNewLabel()}
                        >
                          追加
                        </button>
                      </div>
                      <span className="inline-block text-[12px] text-[#5f6368]">
                        ※ラベル登録/ルール編集は管理者のみ
                      </span>
                    </>
                  ) : (
                    <div className="text-[12px] text-[#5f6368]">
                      ※ラベル登録は管理者のみ（既存ラベルの付与/解除は可能）
                    </div>
                  )}
                </div>
              </div>,
              document.body,
            )}

          {/* タブナビゲーション */}
          <div className={t.tabs} data-testid="tabs">
            <div className="flex items-center min-w-0">
              {/* Gmail風: 一括選択チェック（タブの左） */}
              <div className="flex items-center pr-2 pl-1">
                <input
                  ref={checkAllRef}
                  type="checkbox"
                  aria-label="表示中のメールを一括選択"
                  data-testid="checkbox-select-all"
                  checked={isAllVisibleChecked}
                  disabled={visibleIds.length === 0}
                  onChange={(e) => {
                    handleToggleCheckAllVisible(e.target.checked);
                  }}
                  className="w-4 h-4 rounded border-gray-300 bg-white text-[#1a73e8] focus:ring-2 focus:ring-blue-500/50 cursor-pointer disabled:opacity-40"
                />
              </div>

              {/* 受信箱タブ */}
              <button
                onClick={() => {
                  setViewTab("inbox");
                  // 受信箱タブ: todoラベルで再読み込み
                  const todoLabel = labelGroups.flatMap((g) => g.items).find((item) => item.statusType === "todo");
                  if (todoLabel) {
                    onSelectLabel(todoLabel);
                    listRef.current?.scrollTo({ top: 0 });
                  }
                }}
                className={`${t.tab} ${viewTab === "inbox" ? t.tabActive : ""}`}
                data-testid="tab-inbox"
              >
                受信箱
              </button>
              {/* 担当タブ */}
              <button
                onClick={() => {
                  setViewTab("assigned");
                  // 担当タブ: 担当ラベルでフィルタリングしてメッセージを取得
                  const todoLabel = labelGroups.flatMap((g) => g.items).find((item) => item.statusType === "todo");
                  if (todoLabel) {
                    startTransition(async () => {
                      try {
                        // 担当ラベルでフィルタリング（担当タブ専用）
                        const url = `/api/mailhub/list?label=${encodeURIComponent(todoLabel.id)}&max=100&assigneeSlug=${encodeURIComponent(myAssigneeSlug)}`;
                        const data = await fetchJson<{ label: string; messages: InboxListMessage[] }>(url);
                        setMessages(data.messages);
                        // 最初の担当メールを選択
                        const assignedMessage = data.messages[0];
                        if (assignedMessage) {
                          setSelectedId(assignedMessage.id);
                          setSelectedMessage(assignedMessage);
                          replaceUrl(todoLabel.id, assignedMessage.id);
                          void loadDetailBodyOnly(assignedMessage.id);
                        } else {
                          setSelectedId(null);
                          setSelectedMessage(null);
                          replaceUrl(todoLabel.id, null);
                        }
                        listRef.current?.scrollTo({ top: 0 });
                      } catch (e) {
                        setListError(e instanceof Error ? e.message : String(e));
                      }
                    });
                  }
                }}
                className={`${t.tab} ${viewTab === "assigned" ? t.tabActive : ""}`}
                data-testid="tab-assigned"
              >
                担当
              </button>
              {/* 保留タブ */}
              <button
                onClick={() => {
                  setViewTab("waiting");
                  // 保留タブ: waitingラベルで再読み込み
                  const waitingLabel = labelGroups.flatMap((g) => g.items).find((item) => item.statusType === "waiting");
                  if (waitingLabel) {
                    onSelectLabel(waitingLabel);
                    listRef.current?.scrollTo({ top: 0 });
                  }
                }}
                className={`${t.tab} ${viewTab === "waiting" ? t.tabActive : ""}`}
                data-testid="tab-waiting"
              >
                保留
              </button>
              {/* 低優先タブ */}
              <button
                onClick={() => {
                  setViewTab("muted");
                  // 低優先タブ: mutedラベルで再読み込み
                  const mutedLabel = labelGroups.flatMap((g) => g.items).find((item) => item.statusType === "muted");
                  if (mutedLabel) {
                    onSelectLabel(mutedLabel);
                    listRef.current?.scrollTo({ top: 0 });
                  }
                }}
                className={`${t.tab} ${viewTab === "muted" ? t.tabActive : ""}`}
                data-testid="tab-muted"
              >
                低優先
              </button>
            </div>

            {/* 右側: 選択中メールのナビゲーション/クイック操作（Gmail風：タブ行と同じ水平線に揃える） */}
            <div className="flex items-center gap-1 flex-shrink-0 pr-1">
              {selectedMessage && (
                <>
                  <button onClick={() => handleMoveSelection("up")} className={t.buttonIcon} title="上へ">
                    <ArrowUp size={20} className="text-[#5f6368]" />
                  </button>
                  <button onClick={() => handleMoveSelection("down")} className={t.buttonIcon} title="下へ">
                    <ArrowDown size={20} className="text-[#5f6368]" />
                  </button>

                  {selectedMessage.gmailLink && selectedMessage.threadId && (
                    <>
                      <div className="w-px h-5 bg-[#dadce0] mx-1" />
                      <a
                        href={buildGmailReplyLink(selectedMessage.gmailLink, selectedMessage.threadId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2 py-1 rounded-md text-xs text-[#3c4043] hover:bg-[#f1f3f4] transition-colors font-medium flex items-center gap-1.5"
                        title="返信（Gmail）"
                      >
                        <CornerUpLeft size={14} className="text-[#5f6368]" />
                        <span className="hidden sm:inline">返信</span>
                      </a>
                      <a
                        href={buildGmailForwardLink(selectedMessage.gmailLink, selectedMessage.threadId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2 py-1 rounded-md text-xs text-[#3c4043] hover:bg-[#f1f3f4] transition-colors font-medium"
                        title="転送（Gmail）"
                      >
                        <span className="hidden sm:inline">転送</span>
                      </a>
                    </>
                  )}

                  {selectedId && (
                    <>
                      <div className="w-px h-5 bg-[#dadce0] mx-1" />
                      {/* Step 60: 担当者選択UI */}
                      <button
                        data-testid="assignee-picker-open"
                        onClick={() => handleAssignClick(selectedId)}
                        className={`px-2 py-1 rounded-md text-xs transition-colors font-medium flex items-center gap-1.5 ${
                          isSelectedMine
                            ? "text-[#1a73e8] hover:bg-[#E8F0FE]"
                            : selectedAssigneeSlug
                            ? "text-[#ea8600] hover:bg-[#fef7e0]"
                            : "text-[#3c4043] hover:bg-[#f1f3f4]"
                        }`}
                        title={isSelectedMine ? "担当変更" : selectedAssigneeSlug ? "引き継ぐ" : "担当を設定"}
                      >
                        <UserCheck size={14} className={isSelectedMine ? "text-[#1a73e8]" : selectedAssigneeSlug ? "text-[#ea8600]" : "text-[#5f6368]"} />
                        <span className="hidden sm:inline">{isSelectedMine ? "担当変更" : selectedAssigneeSlug ? "引き継ぐ" : "担当"}</span>
                      </button>

                      {activeLabel?.statusType !== "muted" ? (
                        <button
                          data-testid="action-mute-detail"
                          onClick={() => handleMute(selectedId)}
                          className="px-2 py-1 rounded-md text-xs text-[#3c4043] hover:bg-[#f1f3f4] transition-colors font-medium flex items-center gap-1.5"
                          title="低優先へ"
                        >
                          <VolumeX size={14} className="text-[#5f6368]" />
                          <span className="hidden sm:inline">低優先</span>
                        </button>
                      ) : (
                        <button
                          data-testid="action-unmute-detail"
                          onClick={() => handleUnmute(selectedId)}
                          className="px-2 py-1 rounded-md text-xs text-[#3c4043] hover:bg-[#f1f3f4] transition-colors font-medium flex items-center gap-1.5"
                          title="Inboxへ戻す"
                        >
                          <VolumeX size={14} className="text-[#5f6368]" />
                          <span className="hidden sm:inline">復帰</span>
                        </button>
                      )}

                      {activeLabel?.statusType !== "snoozed" ? (
                        <div className="relative">
                          <button
                            ref={snoozeButtonRef}
                            data-testid="action-snooze-detail"
                            onClick={openSnoozePopover}
                            disabled={readOnlyMode}
                            className="px-2 py-1 rounded-md text-xs text-[#3c4043] hover:bg-[#f1f3f4] transition-colors font-medium flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                            title={readOnlyMode ? (getWriteBlockedTitle() ?? "実行できません") : "期限付き保留"}
                          >
                            <Clock size={14} className="text-[#5f6368]" />
                            <span className="hidden sm:inline">期限付き保留</span>
                          </button>
                          {snoozePopoverOpen && snoozePopoverPos && (
                            <div
                              ref={snoozePopoverRef}
                              className="fixed z-[200] bg-white rounded-lg shadow-lg border border-[#dadce0] p-2 min-w-[240px]"
                              style={{ top: `${snoozePopoverPos.top}px`, left: `${snoozePopoverPos.left}px` }}
                              data-testid="snooze-popover"
                            >
                              <div className="text-[11px] font-medium text-[#5f6368] mb-2 px-2 py-1">期限を選択</div>
                              <div className="space-y-1">
                                {[
                                  { label: "Tomorrow", days: 1 },
                                  { label: "+3 days", days: 3 },
                                  { label: "+1 week", days: 7 },
                                ].map((preset) => {
                                  const until = new Date();
                                  until.setDate(until.getDate() + preset.days);
                                  const untilStr = until.toISOString().split('T')[0];
                                  return (
                                    <button
                                      key={preset.label}
                                      onClick={() => handleSnoozeDateSelect(untilStr)}
                                      className="w-full text-left px-3 py-2 text-[13px] text-[#202124] hover:bg-[#f1f3f4] rounded transition-colors"
                                      data-testid={`snooze-preset-${preset.label}`}
                                    >
                                      {preset.label}
                                    </button>
                                  );
                                })}
                                <div className="border-t border-[#dadce0] my-1" />
                                <div className="px-3 py-2">
                                  <input
                                    type="date"
                                    min={new Date().toISOString().split('T')[0]}
                                    onChange={(e) => {
                                      if (e.target.value) {
                                        handleSnoozeDateSelect(e.target.value);
                                      }
                                    }}
                                    className="w-full text-[13px] text-[#202124] border border-[#dadce0] rounded px-2 py-1 focus:outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]/20"
                                    data-testid="snooze-date-input"
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <button
                          data-testid="action-unsnooze-detail"
                          onClick={() => selectedId && handleUnsnooze(selectedId)}
                          disabled={readOnlyMode}
                          className="px-2 py-1 rounded-md text-xs text-[#3c4043] hover:bg-[#f1f3f4] transition-colors font-medium flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                          title={readOnlyMode ? (getWriteBlockedTitle() ?? "実行できません") : "期限付き保留を解除"}
                        >
                          <Clock size={14} className="text-[#5f6368]" />
                          <span className="hidden sm:inline">解除</span>
                        </button>
                      )}

                      {/* Step 106: Copyボタン */}
                      <button
                        data-testid="action-copy-context"
                        onClick={() => void handleCopyContext()}
                        className="px-2 py-1 rounded-md text-xs text-[#3c4043] hover:bg-[#f1f3f4] transition-colors font-medium flex items-center gap-1.5"
                        title="コンテキストをコピー"
                      >
                        <Copy size={14} className="text-[#5f6368]" />
                        <span className="hidden sm:inline">Copy</span>
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
          

          {/* メインエリア (リスト + 詳細) */}
          <main className={t.mainArea}>
            {/* メール一覧 */}
            <div 
              className={t.listColumn}
              style={{ width: `${listWidth}px`, minWidth: '280px', maxWidth: '720px' }}
            >
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {listError ? (
                  <div className="p-8 text-center space-y-3">
                    <div className="text-red-600 text-sm font-medium">リストを取得できませんでした</div>
                    <div className="text-xs text-gray-500">{listError}</div>
                    <button onClick={reloadCurrentList} className="px-4 py-2 bg-blue-600 text-white rounded-md text-xs font-bold hover:bg-blue-700 transition-colors">再試行</button>
                  </div>
                ) : messages.length === 0 && !isPending ? (
                  <div className="flex-1 flex items-center justify-center p-8 text-gray-500 text-sm font-medium">
                    <div className="text-center space-y-2">
                      <div>メールが読み込まれていません</div>
                      <button onClick={reloadCurrentList} className="px-4 py-2 bg-blue-600 text-white rounded-md text-xs font-bold hover:bg-blue-700 transition-colors">再読み込み</button>
                    </div>
                  </div>
                ) : slaFocus && slaFilteredMessages.length === 0 && !isPending ? (
                  // Step 66: SLA Focus ON で0件
                  <div className="flex-1 flex items-center justify-center p-8 text-gray-500 text-sm font-medium" data-testid="sla-empty">
                    <div className="text-center space-y-2">
                      <AlertTriangle size={40} className="mx-auto text-[#34a853]" />
                      <div>SLA超過はありません</div>
                      <div className="text-xs text-gray-400">全てのメールが期限内です</div>
                    </div>
                  </div>
                ) : slaFilteredMessages.length === 0 && !isPending ? (
                  <div className="flex-1 flex items-center justify-center p-8 text-gray-500 text-sm font-medium" data-testid={serverSearchQuery ? undefined : (searchTerm ? undefined : (activeLabel?.statusType === "todo" ? "zero-inbox" : undefined))}>
                    {serverSearchQuery ? `検索結果が見つかりませんでした: ${serverSearchQuery}` : searchTerm ? "見つかりませんでした" : activeLabel?.statusType === "todo" ? "全て完了しました！お疲れさまです！" : "メールはありません"}
                  </div>
                ) : (
                  <div className="divide-y divide-gray-200" data-testid="message-list">
                    {displayMessages.map((mail) => {
                      const isActive = selectedId === mail.id;
                      const isChecked = checkedIds.has(mail.id);
                      const isUnread = mail.isUnread === true;
                      const rowTone = isUnread ? t.listItemUnread : t.listItemRead;
                      const isGroupHeader = mail.isGroupHeader;
                      const groupCount = mail.groupCount ?? 0;
                      const groupKey = mail.groupKey;
                      const isExpanded = groupKey ? expandedGroups.has(groupKey) : false;
                      const isGroupChild = mail.isGroupChild;
                      const hasNote = noteIndexIds?.has(mail.id) ?? false;
                      const workTags = workTagsById[mail.id] ?? [];
                      
                      return (
                        <div
                          key={mail.id}
                          data-message-id={mail.id}
                          data-testid="message-row"
                          data-is-group={isGroupHeader && groupCount > 1 ? "true" : undefined}
                          data-group-key={groupKey}
                          data-group-count={groupCount > 1 ? groupCount : undefined}
                          onClick={(e) => {
                            // Shift+Clickで範囲選択
                            if (e.shiftKey && lastCheckedId && lastCheckedId !== mail.id) {
                              const currentIndex = slaFilteredMessages.findIndex((m) => m.id === mail.id);
                              const lastIndex = slaFilteredMessages.findIndex((m) => m.id === lastCheckedId);
                              // フィルタ/リロード等で lastCheckedId が一覧から消えている場合がある（stale）。
                              // その場合は範囲選択を諦めて通常クリックとして扱う（クラッシュ防止）。
                              if (currentIndex === -1 || lastIndex === -1) {
                                setLastCheckedId(mail.id);
                                onSelectMessage(mail.id);
                                return;
                              }
                              const startIndex = Math.min(currentIndex, lastIndex);
                              const endIndex = Math.max(currentIndex, lastIndex);
                              
                              setCheckedIds((prev) => {
                                const next = new Set(prev);
                                for (let i = startIndex; i <= endIndex; i++) {
                                  const m = filteredMessages[i];
                                  if (m) next.add(m.id);
                                }
                                return next;
                              });
                              setLastCheckedId(mail.id);
                              return;
                            }
                            
                            onSelectMessage(mail.id);
                          }}
                          onDoubleClick={(e) => {
                            // ダブルクリックでチェックボックスのON/OFFを切り替え
                            if ((e.target as HTMLElement).closest('input[type="checkbox"]')) {
                              return; // チェックボックス自体のダブルクリックは無視
                            }
                            e.preventDefault();
                            e.stopPropagation();
                            setCheckedIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(mail.id)) {
                                next.delete(mail.id);
                                if (lastCheckedId === mail.id) {
                                  setLastCheckedId(null);
                                }
                              } else {
                                next.add(mail.id);
                                setLastCheckedId(mail.id);
                              }
                              return next;
                            });
                          }}
                          onMouseEnter={() => handleRowMouseEnter(mail.id)}
                          onMouseLeave={handleRowMouseLeave}
                        >
                          <div
                            data-testid={isActive ? "message-row-selected" : undefined}
                            className={`${t.listItem} ${rowTone} ${isActive ? t.listItemActive : ""} ${isChecked ? t.listItemChecked : ""} ${isTriageCandidate(mail.id) ? "bg-yellow-50" : ""} ${flashingIds.has(mail.id) ? "bg-blue-200 scale-[1.01] transition-all duration-200 shadow-md" : ""} ${removingIds.has(mail.id) ? "opacity-0 scale-95 -translate-x-8 transition-all duration-500 ease-out" : "transition-all duration-200"} relative`}
                          >
                            {/* Gmail風 1行表示: checkbox / star / from / subject - snippet / date (レスポンシブ) */}
                            <div className="grid grid-cols-[20px_20px_120px_1fr_auto] sm:grid-cols-[20px_20px_140px_1fr_auto] items-center gap-1 sm:gap-2 w-full min-w-0 whitespace-nowrap">
                            {/* チェックボックス（Gmail完全再現） */}
                            <div className="flex items-center justify-center">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  // onClickで状態更新するため、Reactの警告回避用
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const isShiftPressed = (e.nativeEvent as MouseEvent).shiftKey;
                                  const nextChecked = (e.currentTarget as HTMLInputElement).checked;

                                  if (isShiftPressed && lastCheckedId && lastCheckedId !== mail.id) {
                                    const currentIndex = slaFilteredMessages.findIndex((m) => m.id === mail.id);
                                    const lastIndex = slaFilteredMessages.findIndex((m) => m.id === lastCheckedId);
                                    const startIndex = Math.min(currentIndex, lastIndex);
                                    const endIndex = Math.max(currentIndex, lastIndex);

                                    setCheckedIds((prev) => {
                                      const next = new Set(prev);
                                      for (let i = startIndex; i <= endIndex; i++) {
                                        next.add(filteredMessages[i].id);
                                      }
                                      return next;
                                    });
                                  } else {
                                    setCheckedIds((prev) => {
                                      const next = new Set(prev);
                                      if (nextChecked) {
                                        next.add(mail.id);
                                        setLastCheckedId(mail.id);
                                      } else {
                                        next.delete(mail.id);
                                        if (lastCheckedId === mail.id) {
                                          setLastCheckedId(null);
                                        }
                                      }
                                      return next;
                                    });
                                  }
                                }}
                                className="w-4 h-4 rounded border-[#dadce0] bg-white text-[#1a73e8] focus:ring-2 focus:ring-[#1a73e8]/20 cursor-pointer hover:border-[#1a73e8] transition-colors"
                                data-testid={`checkbox-${mail.id}`}
                              />
                            </div>

                            {/* スター（Gmail完全再現） */}
                            <button
                              type="button"
                              aria-label="スター"
                              data-testid={`star-${mail.id}`}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                toggleStarLocal(mail.id);
                              }}
                              className="p-1 rounded hover:bg-[#f1f3f4] text-[#5f6368] hover:text-[#202124] transition-colors"
                              title={mail.isStarred ? "スターを外す" : "スターを付ける"}
                            >
                              <Star
                                size={18}
                                className={mail.isStarred ? "text-[#fbbc04] fill-[#fbbc04]" : "text-[#5f6368]"}
                                fill={mail.isStarred ? "currentColor" : "none"}
                              />
                            </button>

                            {/* 送信者（Gmail完全再現） */}
                            <div className="min-w-0 flex items-center gap-1.5">
                              {isUnread && <span className="w-1.5 h-1.5 rounded-full bg-[#1a73e8] flex-shrink-0" title="未読" />}
                              {/* Step 105: 未確認（unseen）バッジ */}
                              {!seenIds.has(mail.id) && <span data-testid="badge-unseen" className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0" title="未確認" />}
                              {mail.assigneeSlug === myAssigneeSlug && (
                                <span title="自分が担当">
                                  <UserCheck size={14} className="text-[#1a73e8] flex-shrink-0" />
                                </span>
                              )}
                              <span className={`truncate min-w-0 text-[13px] leading-[18px] ${isUnread ? "font-medium text-[#202124]" : "font-normal text-[#3c4043]"}`}>
                                {mail.from?.split('<')[0].trim() || mail.from}
                              </span>
                            </div>

                            {/* 件名 - 本文抜粋（Gmail完全再現） */}
                            <div className={`min-w-0 truncate text-[13px] leading-[18px] ${isUnread ? "font-medium text-[#202124]" : "font-normal text-[#202124]"} ${isGroupChild ? "pl-4 border-l-2 border-blue-200" : ""}`}>
                              {/* Step 89: グループ展開/折りたたみボタン */}
                              {isGroupHeader && groupCount > 1 && (
                                <button
                                  type="button"
                                  data-testid={`group-toggle-${groupKey}`}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (groupKey) toggleGroupExpand(groupKey);
                                  }}
                                  className="inline-flex items-center mr-2 px-1.5 py-0.5 text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-300 rounded hover:bg-blue-200 transition-colors"
                                  title={isExpanded ? "折りたたむ" : "展開する"}
                                >
                                  {isExpanded ? "▼" : "▶"} ×{groupCount}
                                </button>
                              )}
                              <span className={isUnread ? "font-medium" : "font-normal"}>{mail.subject ?? "(no subject)"}</span>
                              {workTags.length > 0 && (
                                <>
                                  {workTags.slice(0, 2).map((t) => (
                                    <span
                                      key={t}
                                      data-testid="work-tag-pill"
                                      className="ml-2 px-1 py-0.5 rounded text-[9px] font-bold bg-purple-50 text-purple-700 border border-purple-200"
                                      title={`状況タグ: ${t}`}
                                    >
                                      {t}
                                    </span>
                                  ))}
                                  {workTags.length > 2 && (
                                    <span
                                      data-testid="work-tag-more"
                                      className="ml-2 px-1 py-0.5 rounded text-[9px] font-bold bg-purple-50 text-purple-700 border border-purple-200"
                                      title={workTags.join(", ")}
                                    >
                                      +{workTags.length - 2}
                                    </span>
                                  )}
                                </>
                              )}
                              {hasNote && (
                                <span
                                  data-testid="note-badge"
                                  className="ml-2 px-1 py-0.5 text-[10px] rounded border border-[#dadce0] bg-[#f1f3f4] text-[#5f6368]"
                                  title="社内メモあり"
                                >
                                  📝
                                </span>
                              )}
                              <span className="text-[#5f6368]"> - </span>
                              <span className="text-[#5f6368] font-normal">{shortSnippet(mail.snippet, 140)}</span>
                              {isTriageCandidate(mail.id) && (
                                <span 
                                  data-testid="triage-badge-muted"
                                  className="ml-2 px-1 py-0.5 text-[9px] font-bold bg-yellow-100 text-yellow-700 border border-yellow-300 rounded uppercase tracking-wider"
                                  title="低優先候補"
                                >
                                  低優先
                                </span>
                              )}
                              {mail.assigneeSlug && (
                                <span 
                                  data-testid="assignee-pill"
                                  className={`ml-2 px-1 py-0.5 rounded text-[9px] font-bold ${
                                    mail.assigneeSlug === myAssigneeSlug
                                      ? "bg-[#E8F0FE] text-[#1a73e8] border border-blue-200"
                                      : "bg-gray-100 text-gray-600 border border-gray-300"
                                  }`}
                                  title={mail.assigneeSlug === myAssigneeSlug ? "自分が担当" : `担当: ${getAssigneeDisplayName(mail.assigneeSlug)}`}
                                >
                                  担当
                                </span>
                              )}
                              {!mail.assigneeSlug && (
                                <span
                                  data-testid="assignee-pill"
                                  className="ml-2 px-1 py-0.5 rounded text-[9px] font-bold bg-gray-100 text-gray-500 border border-gray-300"
                                  title="未割当"
                                >
                                  未割当
                                </span>
                              )}
                              {mail.snoozeUntil && (
                                <span
                                  data-testid="snooze-pill"
                                  className="ml-2 px-1 py-0.5 rounded text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-200"
                                  title={`期限付き保留: ${mail.snoozeUntil}`}
                                >
                                  Snooze: {mail.snoozeUntil.split('-').slice(1).join('/')}
                                </span>
                              )}
                              {(mail.userLabels ?? []).length > 0 && (
                                <>
                                  {(mail.userLabels ?? []).slice(0, 2).map((ln) => (
                                    <span
                                      key={ln}
                                      data-testid="user-label-pill"
                                      className="ml-2 px-1 py-0.5 rounded text-[9px] font-bold bg-purple-50 text-purple-700 border border-purple-200"
                                      title={ln}
                                    >
                                      {displayUserLabel(ln)}
                                    </span>
                                  ))}
                                  {(mail.userLabels ?? []).length > 2 && (
                                    <span
                                      data-testid="user-label-pill"
                                      className="ml-2 px-1 py-0.5 rounded text-[9px] font-bold bg-purple-50 text-purple-700 border border-purple-200"
                                      title={(mail.userLabels ?? []).join(", ")}
                                    >
                                      +{(mail.userLabels ?? []).length - 2}
                                    </span>
                                  )}
                                </>
                              )}
                            </div>

                            {/* 日時 + 経過（Gmail完全再現） */}
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <span className={`text-[12px] font-normal ${isActive ? 'text-[#3c4043]' : 'text-[#5f6368]'}`}>
                                {mail.receivedAt.split(' ')[1]}
                              </span>
                            {(() => {
                              const elapsedMs = getElapsedMs(mail.receivedAt);
                              const elapsedText = formatElapsedTime(elapsedMs);
                              const currentLabel = labelGroups.flatMap(g => g.items).find(item => item.id === labelId);
                              const isWaiting = labelId === "waiting" || currentLabel?.statusType === "waiting";
                              const color = isWaiting 
                                ? getElapsedColorWaiting(elapsedMs)
                                : getElapsedColorTodo(elapsedMs);
                              
                              const colorClass = color === "error" 
                                ? "bg-red-100 text-red-700 border-red-300"
                                : color === "warning"
                                ? "bg-yellow-100 text-yellow-700 border-yellow-300"
                                : "bg-gray-100 text-gray-600 border-gray-300";
                              
                              return (
                                <span className={`px-1 py-0.5 text-[9px] font-bold rounded border ${colorClass}`}>
                                  {elapsedText}
                                </span>
                              );
                            })()}
                          </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {/* Step 103: Load more button */}
                    {nextPageToken && (
                      <div className="flex justify-center py-4 border-t border-gray-200">
                        <button
                          type="button"
                          data-testid="action-load-more"
                          onClick={() => void handleLoadMore()}
                          disabled={isLoadingMore}
                          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {isLoadingMore ? "読み込み中..." : "さらに読み込む"}
                        </button>
                      </div>
                    )}
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
                <div className="flex-1 flex flex-col items-center justify-center text-[#5f6368] space-y-4">
                  <Mail className="w-12 h-12 opacity-10" />
                  <span className="text-sm font-medium opacity-40">メールを選択してください</span>
                </div>
              ) : (
                <>
                  <div className="flex-1 overflow-y-auto custom-scrollbar bg-white text-[#202124]">
                    {/* スティッキーヘッダー（件名、送信者、ジャンプボタン） */}
                    <div className="sticky top-0 z-10 bg-white border-b border-[#e8eaed] shadow-sm">
                      <div className="max-w-3xl mx-auto px-8 py-4">
                        <div className="flex items-center gap-3 mb-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#e8eaed] text-[#1a73e8] border border-[#dadce0] uppercase tracking-widest">MAIL</span>
                          <span className="text-[12px] text-[#5f6368] font-normal">{selectedMessage.receivedAt}</span>
                          <span
                            data-testid="assignee-pill"
                            className="text-[11px] font-medium px-2 py-0.5 rounded border border-[#dadce0] bg-[#f1f3f4] text-[#3c4043]"
                            title={selectedAssigneeSlug ? `担当: ${getAssigneeDisplayName(selectedAssigneeSlug)}` : "未割当"}
                          >
                            {selectedAssigneeSlug ? `担当: ${getAssigneeDisplayName(selectedAssigneeSlug)}` : "未割当"}
                          </span>
                          {(selectedMessage.userLabels ?? []).length > 0 && (
                            <span className="flex items-center gap-1">
                              {(selectedMessage.userLabels ?? []).slice(0, 2).map((ln) => (
                                <span
                                  key={ln}
                                  data-testid="user-label-pill"
                                  className="text-[11px] font-medium px-2 py-0.5 rounded border border-purple-200 bg-purple-50 text-purple-700"
                                  title={ln}
                                >
                                  {displayUserLabel(ln)}
                                </span>
                              ))}
                              {(selectedMessage.userLabels ?? []).length > 2 && (
                                <span
                                  data-testid="user-label-pill"
                                  className="text-[11px] font-medium px-2 py-0.5 rounded border border-purple-200 bg-purple-50 text-purple-700"
                                  title={(selectedMessage.userLabels ?? []).join(", ")}
                                >
                                  +{(selectedMessage.userLabels ?? []).length - 2}
                                </span>
                              )}
                            </span>
                          )}
                          <div className="ml-auto">
                            <button
                              type="button"
                              onClick={() => setShowExplainDrawer(true)}
                              className="px-3 py-1.5 text-[12px] font-medium text-[#5f6368] hover:text-[#202124] hover:bg-[#f1f3f4] rounded border border-[#dadce0] flex items-center gap-1.5 transition-colors"
                              data-testid="action-explain"
                              title="このメッセージに適用されるルールを説明"
                            >
                              <HelpCircle size={14} />
                              説明
                            </button>
                          </div>
                        </div>
                        {debugMode && detailBody.debugLabels && (
                          <div
                            className="mb-4 p-3 rounded-lg border border-[#dadce0] bg-[#f8f9fa] text-[#3c4043]"
                            data-testid="debug-labels"
                          >
                            <div className="text-[11px] font-medium text-[#5f6368] mb-1">DEBUG: Gmail labelIds / labelNames</div>
                            <div className="text-[10px] font-mono break-all">
                              <span className="text-[#5f6368]">labelIds:</span>{" "}
                              {detailBody.debugLabels.labelIds.join(", ")}
                            </div>
                            <div className="text-[10px] font-mono break-all mt-1">
                              <span className="text-[#5f6368]">labelNames:</span>{" "}
                              {detailBody.debugLabels.labelNames
                                .map((n) => n ?? "<unknown>")
                                .join(" | ")}
                            </div>
                          </div>
                        )}
                        <h1 className="text-[22px] font-normal mb-4 text-[#202124] leading-[28px]" data-testid="detail-subject">{selectedMessage.subject ?? "(no subject)"}</h1>
                        <div className="flex items-center gap-3 text-[14px] border-y border-[#e8eaed] py-4">
                          <div className="w-10 h-10 rounded-full bg-[#e8eaed] flex items-center justify-center font-medium text-[#3c4043] border border-[#dadce0]">
                            {selectedMessage.from?.[0]?.toUpperCase() ?? "?"}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-[#202124]">{selectedMessage.from?.split('<')[0].trim()}</span>
                              <span className="text-[12px] text-[#5f6368] hidden sm:inline font-normal">&lt;{selectedMessage.from?.split('<')[1]}</span>
                            </div>
                            <div className="text-[12px] text-[#5f6368] font-normal">共用受信箱 宛</div>
                            {selectedMessage.snoozeUntil && (
                              <div className="mt-2 text-[12px] text-blue-700 font-medium flex items-center gap-1.5">
                                <Clock size={12} className="text-blue-600" />
                                <span>Snoozed until: {selectedMessage.snoozeUntil}</span>
                              </div>
                            )}
                          </div>
                          {/* ジャンプボタン＆本文折りたたみボタン */}
                          <div className="ml-auto flex items-center gap-1">
                            {/* ジャンプボタン */}
                            <button
                              type="button"
                              onClick={() => document.getElementById("section-conversation")?.scrollIntoView({ behavior: "smooth" })}
                              className="px-2 py-1 text-[11px] text-[#5f6368] hover:text-[#202124] hover:bg-[#f1f3f4] rounded transition-colors"
                              title="会話履歴へ"
                              data-testid="jump-to-conversation"
                            >
                              会話
                            </button>
                            <button
                              type="button"
                              onClick={() => document.getElementById("section-notes")?.scrollIntoView({ behavior: "smooth" })}
                              className="px-2 py-1 text-[11px] text-[#5f6368] hover:text-[#202124] hover:bg-[#f1f3f4] rounded transition-colors"
                              title="社内メモへ"
                              data-testid="jump-to-notes"
                            >
                              メモ
                            </button>
                            <button
                              type="button"
                              onClick={() => document.getElementById("section-reply")?.scrollIntoView({ behavior: "smooth" })}
                              className="px-2 py-1 text-[11px] text-[#5f6368] hover:text-[#202124] hover:bg-[#f1f3f4] rounded transition-colors"
                              title="返信へ"
                              data-testid="jump-to-reply"
                            >
                              返信
                            </button>
                            {selectedMessage?.gmailLink && (
                              <a
                                href={selectedMessage.gmailLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2 py-1 text-[11px] text-[#1a73e8] hover:text-[#1557b0] hover:bg-[#e8f0fe] rounded transition-colors flex items-center gap-1"
                                title="Gmailで開く"
                                data-testid="jump-to-gmail"
                              >
                                <ExternalLink size={12} />
                                Gmail
                              </a>
                            )}
                            <div className="w-px h-4 bg-[#dadce0] mx-1" />
                            {/* 本文折りたたみボタン */}
                            <button
                              type="button"
                              onClick={() => setBodyCollapsed(!bodyCollapsed)}
                              className="p-2 text-[#5f6368] hover:text-[#202124] hover:bg-[#f1f3f4] rounded-full transition-colors"
                              title={bodyCollapsed ? "本文を展開" : "本文を折りたたむ"}
                              data-testid="toggle-body-collapse"
                            >
                              {bodyCollapsed ? (
                                <ChevronDown size={18} />
                              ) : (
                                <ChevronUp size={18} />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* スティッキーヘッダーここまで */}
                    
                    {/* スクロール可能なコンテンツエリア */}
                    <div className="max-w-3xl mx-auto px-8 pb-8">
                      {/* 本文セクション（折りたたみ可能） */}
                      {bodyCollapsed ? (
                        <div 
                          className="py-3 text-[12px] text-[#5f6368] italic cursor-pointer hover:text-[#202124] hover:bg-[#f8f9fa] rounded px-2 -mx-2 transition-colors"
                          onClick={() => setBodyCollapsed(false)}
                          data-testid="body-collapsed-hint"
                        >
                          クリックして本文を展開...
                        </div>
                      ) : (
                      <div className="relative">
                        {detailBody.isLoading ? (
                          <div className="space-y-4" data-testid="detail-skeleton">
                             <div className="h-4 bg-[#e8eaed] rounded w-3/4 animate-pulse" />
                             <div className="h-4 bg-[#e8eaed] rounded w-1/2 animate-pulse" />
                             <div className="h-4 bg-[#e8eaed] rounded w-2/3 animate-pulse" />
                          </div>
                        ) : detailError ? (
                          <div className="text-[#c5221f] text-[14px] font-normal bg-[#fce8e6] p-4 rounded-lg border border-[#f28b82]">
                            {detailError}
                            {selectedMessage?.gmailLink && (
                              <div className="mt-2">
                                <a
                                  href={selectedMessage.gmailLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[#1a73e8] hover:underline text-[12px]"
                                >
                                  Gmailで開く →
                                </a>
                              </div>
                            )}
                          </div>
                        ) : (
                          <>
                            {detailBody.bodyNotice && (
                              <div className="mb-4 text-[#ea8600] text-[14px] font-normal bg-[#fef7e0] p-3 rounded-lg border border-[#fdd663]">
                                {detailBody.bodyNotice}
                              </div>
                            )}
                            {detailBody.htmlBody ? (
                              <div
                                ref={htmlBodyRef}
                                className="prose max-w-none text-[14px] leading-[20px] text-[#202124] font-normal selection:bg-[#E8F0FE] [&_a]:text-blue-600 [&_a]:underline [&_img]:max-w-full [&_img]:h-auto [&_table]:border-collapse [&_td]:p-2 [&_th]:p-2"
                                data-testid="email-body-html"
                              />
                            ) : (
                              <div className="prose max-w-none text-[14px] leading-[20px] whitespace-pre-wrap text-[#202124] font-normal selection:bg-[#E8F0FE]" data-testid="email-body-text">
                                {detailBody.plainTextBody || "本文がありません"}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      )}

                      {/* Conversation (thread) */}
                      <div id="section-conversation" className="mt-10 pt-10 border-t border-gray-200" data-testid="thread-pane">
                        {/* Thread Actions Bar */}
                        {threadSummary && threadSummary.messages.length > 0 && (() => {
                          const threadMessageIds = threadSummary.messages.map((m) => m.id);
                          const statusCounts = threadSummary.messages.reduce(
                            (acc, m) => {
                              acc[m.statusType] = (acc[m.statusType] ?? 0) + 1;
                              return acc;
                            },
                            {} as Record<string, number>,
                          );
                          const assigneeCounts = threadSummary.messages.reduce(
                            (acc, m) => {
                              if (m.assigneeSlug === myAssigneeSlug) {
                                acc.mine = (acc.mine ?? 0) + 1;
                              } else if (m.assigneeSlug) {
                                acc.others = (acc.others ?? 0) + 1;
                              } else {
                                acc.unassigned = (acc.unassigned ?? 0) + 1;
                              }
                              return acc;
                            },
                            {} as { mine?: number; others?: number; unassigned?: number },
                          );
                          const summaryText = [
                            `Todo ${statusCounts.todo ?? 0}`,
                            `Waiting ${statusCounts.waiting ?? 0}`,
                            `Done ${statusCounts.done ?? 0}`,
                            `Muted ${statusCounts.muted ?? 0}`,
                          ]
                            .filter((s) => !s.endsWith(" 0"))
                            .join(" / ");
                          const assigneeText = [
                            assigneeCounts.mine ? `mine ${assigneeCounts.mine}` : null,
                            assigneeCounts.others ? `others ${assigneeCounts.others}` : null,
                            assigneeCounts.unassigned ? `unassigned ${assigneeCounts.unassigned}` : null,
                          ]
                            .filter(Boolean)
                            .join(" / ");
                          return (
                            <div className="mb-4 space-y-2" data-testid="thread-actions">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-[13px] font-bold text-[#202124]">
                                  Thread: {threadSummary.messages.length} messages
                                </div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <button
                                    type="button"
                                    data-testid="thread-action-done"
                                    className="px-2 py-1 text-[11px] font-medium rounded border border-[#dadce0] bg-white hover:bg-[#f1f3f4] disabled:opacity-40 disabled:cursor-not-allowed"
                                    disabled={readOnlyMode || bulkProgress !== null || threadMessageIds.length === 0}
                                    title={readOnlyMode ? (getWriteBlockedTitle() ?? "実行できません") : "Thread Done"}
                                    onClick={() => {
                                      if (readOnlyMode || bulkProgress !== null) return;
                                      void handleBulkArchive(threadMessageIds);
                                    }}
                                  >
                                    Thread Done
                                  </button>
                                  <button
                                    type="button"
                                    data-testid="thread-action-waiting"
                                    className="px-2 py-1 text-[11px] font-medium rounded border border-[#dadce0] bg-white hover:bg-[#f1f3f4] disabled:opacity-40 disabled:cursor-not-allowed"
                                    disabled={readOnlyMode || bulkProgress !== null || threadMessageIds.length === 0}
                                    title={readOnlyMode ? (getWriteBlockedTitle() ?? "実行できません") : "Thread Waiting"}
                                    onClick={() => {
                                      if (readOnlyMode || bulkProgress !== null) return;
                                      void handleBulkWaiting(threadMessageIds);
                                    }}
                                  >
                                    Thread Waiting
                                  </button>
                                  <button
                                    type="button"
                                    data-testid="thread-action-mute"
                                    className="px-2 py-1 text-[11px] font-medium rounded border border-[#dadce0] bg-white hover:bg-[#f1f3f4] disabled:opacity-40 disabled:cursor-not-allowed"
                                    disabled={readOnlyMode || bulkProgress !== null || threadMessageIds.length === 0}
                                    title={readOnlyMode ? (getWriteBlockedTitle() ?? "実行できません") : "Thread Mute"}
                                    onClick={() => {
                                      if (readOnlyMode || bulkProgress !== null) return;
                                      void handleBulkMuteSelected(threadMessageIds);
                                    }}
                                  >
                                    Thread Mute
                                  </button>
                                  <button
                                    type="button"
                                    data-testid="thread-action-assign"
                                    className="px-2 py-1 text-[11px] font-medium rounded border border-[#dadce0] bg-white hover:bg-[#f1f3f4] disabled:opacity-40 disabled:cursor-not-allowed"
                                    disabled={readOnlyMode || bulkProgress !== null || threadMessageIds.length === 0}
                                    title={readOnlyMode ? (getWriteBlockedTitle() ?? "実行できません") : "Thread Assign Me"}
                                    onClick={() => {
                                      if (readOnlyMode || bulkProgress !== null) return;
                                      void handleBulkAssign(threadMessageIds);
                                    }}
                                  >
                                    Thread Assign Me
                                  </button>
                                  <button
                                    type="button"
                                    data-testid="thread-action-label"
                                    className="px-2 py-1 text-[11px] font-medium rounded border border-[#dadce0] bg-white hover:bg-[#f1f3f4] disabled:opacity-40 disabled:cursor-not-allowed"
                                    disabled={readOnlyMode || bulkProgress !== null || threadMessageIds.length === 0}
                                    title={readOnlyMode ? (getWriteBlockedTitle() ?? "実行できません") : "Thread Label…"}
                                    onClick={() => {
                                      if (readOnlyMode || bulkProgress !== null) return;
                                      // 会話内の全messageIdをcheckedIdsに設定してからLabel Popoverを開く
                                      setCheckedIds(new Set(threadMessageIds));
                                      openLabelPopover();
                                    }}
                                  >
                                    Thread Label…
                                  </button>
                                  <button
                                    type="button"
                                    data-testid="thread-action-select"
                                    className="px-2 py-1 text-[11px] font-medium rounded border border-[#dadce0] bg-white hover:bg-[#f1f3f4] disabled:opacity-40 disabled:cursor-not-allowed"
                                    disabled={threadMessageIds.length === 0}
                                    title="この会話をまとめて選択（既存の一括アクションに接続）"
                                    onClick={() => {
                                      setCheckedIds((prev) => {
                                        const next = new Set(prev);
                                        for (const m of threadSummary.messages) next.add(m.id);
                                        return next;
                                      });
                                    }}
                                  >
                                    Thread Select
                                  </button>
                                  {checkedIds.size > 0 && (
                                    <button
                                      type="button"
                                      data-testid="thread-action-clear"
                                      className="px-2 py-1 text-[11px] font-medium rounded border border-[#dadce0] bg-white hover:bg-[#f1f3f4]"
                                      onClick={() => setCheckedIds(new Set())}
                                      title="選択をクリア"
                                    >
                                      Clear Selection
                                    </button>
                                  )}
                                </div>
                              </div>
                              {(summaryText || assigneeText) && (
                                <div className="text-[11px] text-[#5f6368] space-y-1">
                                  {summaryText && <div>Status: {summaryText}</div>}
                                  {assigneeText && <div>Assigned: {assigneeText}</div>}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        
                        <div className="flex items-center justify-between gap-3 mb-4">
                          <div className="text-[13px] font-bold text-[#202124]">
                            Conversation（{threadSummary?.messages?.length ?? 0}）
                          </div>
                        </div>

                        {threadLoading ? (
                          <div className="text-[12px] text-[#5f6368]">読み込み中...</div>
                        ) : threadError ? (
                          <div className="text-[12px] text-[#c5221f] bg-[#fce8e6] border border-[#f28b82] rounded p-3">
                            Conversationの取得に失敗しました: {threadError}
                          </div>
                        ) : !threadSummary || threadSummary.messages.length === 0 ? (
                          <div className="text-[12px] text-[#5f6368]">No messages</div>
                        ) : (
                          <div className="space-y-2">
                            {threadSummary.messages.map((m) => {
                              const isSelected = m.id === selectedMessage.id;
                              const expanded = threadExpandedIds.has(m.id);
                              const bodyState = threadBodies[m.id];
                              return (
                                <div
                                  key={m.id}
                                  data-testid="thread-item"
                                  className={`rounded-lg border p-3 ${isSelected ? "border-blue-300 bg-blue-50" : "border-[#dadce0] bg-white"}`}
                                >
                                  <div className="flex items-start gap-3">
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-[12px] font-medium text-[#202124] truncate">
                                          {m.from?.split("<")[0].trim() ?? "(unknown)"}
                                        </span>
                                        <span className="text-[11px] text-[#5f6368]">{m.date}</span>
                                        <span className="text-[10px] px-2 py-0.5 rounded border border-[#dadce0] bg-[#f1f3f4] text-[#3c4043]">
                                          {m.statusType}
                                        </span>
                                        {m.assigneeSlug && (
                                          <span className="text-[10px] px-2 py-0.5 rounded border border-[#dadce0] bg-[#f1f3f4] text-[#3c4043]">
                                            担当: {getAssigneeDisplayName(m.assigneeSlug)}
                                          </span>
                                        )}
                                        {Array.isArray(m.labels) && m.labels.length > 0 && (
                                          <span className="flex items-center gap-1">
                                            {m.labels.map((ln) => (
                                              <span
                                                key={ln}
                                                className="text-[10px] font-medium px-2 py-0.5 rounded border border-purple-200 bg-purple-50 text-purple-700"
                                                title={ln}
                                              >
                                                {displayUserLabel(ln)}
                                              </span>
                                            ))}
                                          </span>
                                        )}
                                      </div>
                                      <div className="mt-2 text-[12px] text-[#3c4043]">
                                        {m.snippet || "(no snippet)"}
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      data-testid="thread-expand"
                                      className="px-2 py-1 text-[11px] rounded border border-[#dadce0] bg-white hover:bg-[#f1f3f4]"
                                      onClick={() => void toggleThreadExpand(m.id)}
                                    >
                                      {expanded ? "Hide" : "Expand"}
                                    </button>
                                  </div>

                                  {expanded && (
                                    <div className="mt-3 pt-3 border-t border-[#e8eaed]" data-testid="thread-body">
                                      {m.id === selectedMessage.id ? (
                                        // 選択中のメールは上部に本文が表示されているため、ここでは「上部を参照」と表示
                                        <div className="text-[12px] text-[#5f6368] italic">
                                          このメールの本文は上部に表示されています
                                        </div>
                                      ) : bodyState?.isLoading ? (
                                        <div className="text-[12px] text-[#5f6368]">本文を読み込み中...</div>
                                      ) : bodyState?.error ? (
                                        <div className="text-[12px] text-[#c5221f]">本文取得エラー: {bodyState.error}</div>
                                      ) : (
                                        <>
                                          {bodyState?.bodyNotice && (
                                            <div className="mb-2 text-[12px] text-[#ea8600] bg-[#fef7e0] p-2 rounded border border-[#fdd663]">
                                              {bodyState.bodyNotice}
                                            </div>
                                          )}
                                          <div className="text-[13px] leading-[19px] whitespace-pre-wrap text-[#202124]">
                                            {bodyState?.plainTextBody || "本文がありません"}
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      
                      <div id="section-notes" className="mt-12 pt-12 border-t border-gray-200 flex flex-col gap-6">
                        {/* Step 101: Work Tags（状況タグ） */}
                        {selectedMessage?.id && (
                          <div className="rounded-xl border border-gray-200 bg-white p-5" data-testid="work-tags-panel">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-[13px] font-bold text-[#202124]">状況タグ</div>
                              <div className="text-[11px] text-[#5f6368]">検索: <span className="font-mono">has:tag</span> / <span className="font-mono">tag:&lt;slug&gt;</span></div>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {workTagDraft.length === 0 ? (
                                <div className="text-[12px] text-[#5f6368]">タグなし</div>
                              ) : (
                                workTagDraft.map((t) => (
                                  <span
                                    key={t}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-purple-200 bg-purple-50 text-purple-700 text-[12px] font-medium"
                                    data-testid={`work-tag-chip-${t}`}
                                  >
                                    {t}
                                    {!readOnlyMode && (
                                      <button
                                        type="button"
                                        className="text-purple-600 hover:text-purple-800"
                                        onClick={() => setWorkTagDraft((prev) => prev.filter((x) => x !== t))}
                                        data-testid={`work-tag-remove-${t}`}
                                        title="削除"
                                      >
                                        ×
                                      </button>
                                    )}
                                  </span>
                                ))
                              )}
                            </div>

                            <div className="mt-3 flex items-center gap-2">
                              <input
                                type="text"
                                value={workTagInput}
                                onChange={(e) => setWorkTagInput(e.target.value)}
                                placeholder="例: refund / stock / shipping / claim"
                                className="flex-1 text-[13px] border border-[#dadce0] rounded px-3 py-2 focus:outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]/20"
                                data-testid="work-tag-input"
                                disabled={readOnlyMode}
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const slug = normalizeTagSlug(workTagInput);
                                  if (!slug) return;
                                  setWorkTagDraft((prev) => (prev.includes(slug) ? prev : [...prev, slug]).slice(0, 20));
                                  setWorkTagInput("");
                                }}
                                className="px-3 py-2 rounded-md text-[12px] font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                data-testid="work-tag-add"
                                disabled={readOnlyMode}
                              >
                                追加
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (!selectedMessage?.id) return;
                                  const messageId = selectedMessage.id;
                                  const tags = workTagDraft;
                                  void (async () => {
                                    try {
                                      const res = await fetch("/api/mailhub/meta", {
                                        method: "PUT",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ messageId, tags }),
                                      });
                                      const data = (await res.json().catch(() => ({}))) as { meta?: { tags?: string[] } | null; error?: string; message?: string };
                                      if (!res.ok) {
                                        showToast(`エラー: ${data.message || data.error || res.statusText}`, "error");
                                        return;
                                      }
                                      const nextTags = Array.isArray(data.meta?.tags) ? data.meta?.tags ?? [] : [];
                                      setWorkTagsById((prev) => ({ ...prev, [messageId]: nextTags }));
                                      showToast("タグを保存しました", "success");
                                    } catch (e) {
                                      showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
                                    }
                                  })();
                                }}
                                className="px-3 py-2 rounded-md text-[12px] font-bold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                data-testid="work-tag-save"
                                disabled={readOnlyMode || !selectedMessage?.id}
                              >
                                保存
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Internal Ops（社内メモ + 個人下書き + テンプレ挿入） */}
                        {selectedMessage?.id && (() => {
                          // Step46: 変数埋め用のコンテキストを構築
                          const messageContext = {
                            inquiryId: replyRoute?.kind === "rakuten_rms" ? replyInquiryNumber : null,
                            orderId: null, // 将来用
                            customerEmail: selectedMessage.from?.match(/<(.+)>/)?.[1] ?? selectedMessage.from ?? null,
                            fromName: selectedMessage.from?.match(/^([^<]+)</)?.[1]?.trim() ?? null,
                            fromEmail: selectedMessage.from?.match(/<(.+)>/)?.[1] ?? selectedMessage.from ?? null,
                            subject: selectedMessage.subject ?? null,
                            store: replyRoute?.kind === "rakuten_rms" ? replyRoute.storeId ?? null : null,
                            assignee: selectedMessage.assigneeSlug ? getAssigneeDisplayName(selectedMessage.assigneeSlug) : null,
                            agent: user.name ?? user.email,
                            today: new Date().toISOString().split("T")[0], // YYYY-MM-DD
                          };
                          return (
                            <InternalOpsPane
                              messageId={selectedMessage.id}
                              readOnlyMode={readOnlyMode}
                              showToast={showToast}
                              messageContext={messageContext}
                              activityContext={{
                                route: replyRoute?.kind ?? null,
                                channel: channelId,
                              }}
                              onTemplateInsertToReply={replyRoute ? ({ text, templateId, templateTitle, unresolvedVars }) => {
                                // Step55: Replyブロックが表示されている場合（rakuten_rms/unknown）のみ、Replyブロックのテキストエリアに挿入
                                // Step57: gmailでもReply欄へ挿入する（返信パネル統合）
                                setReplyMessage((prev) => {
                                  const sep = prev.trim() ? "\n\n" : "";
                                  return `${prev}${sep}${text}`;
                                });
                                setLastAppliedTemplate({ id: templateId, title: templateTitle, unresolvedVars });
                              } : undefined}
                            />
                          );
                        })()}

                        {/* Replyブロック（Step55: 返信導線の最短化） */}
                        {replyRoute && (
                          <div id="section-reply" className="mt-8 pt-8 border-t border-gray-200" data-testid="reply-panel">
                            <div className={`rounded-xl p-6 border ${replyRoute.kind === "rakuten_rms" ? "bg-gray-50 border-gray-200" : "bg-blue-50 border-blue-200"}`}>
                              <div className="flex items-center gap-2 mb-4">
                                <span className={`text-sm font-bold ${replyRoute.kind === "rakuten_rms" ? "text-orange-600" : "text-blue-600"}`}>
                                  {replyRoute.kind === "rakuten_rms" ? "楽天RMS返信" : replyRoute.kind === "gmail" ? "Gmail返信" : "返信"}
                                </span>
                                {replyRoute.storeId && (
                                  <span className="text-xs text-gray-600">({replyRoute.storeId})</span>
                                )}
                                <span className="text-xs text-gray-500" data-testid="reply-route">{replyRoute.kind}</span>
                              </div>

                              {/* 問い合わせ番号（rakuten_rmsの場合のみ） */}
                              {replyRoute.kind === "rakuten_rms" && (
                                <div className="mb-4">
                                  <label className="block text-xs font-medium text-gray-700 mb-2">
                                    問い合わせ番号
                                  </label>
                                  <div className="flex gap-2">
                                    <input
                                      type="text"
                                      data-testid="reply-inquiry"
                                      value={replyInquiryNumber}
                                      onChange={(e) => setReplyInquiryNumber(e.target.value)}
                                      placeholder="問い合わせ番号を入力"
                                      className="flex-1 bg-white border border-gray-300 text-gray-900 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all"
                                    />
                                    {replyInquiryNumber && (
                                      <button
                                        onClick={handleCopyInquiryNumber}
                                        data-testid="reply-copy-inquiry"
                                        className="px-3 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-md text-xs font-medium transition-colors flex items-center gap-1"
                                        title="問い合わせ番号をコピー"
                                      >
                                        <Copy size={14} />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* 返信本文 */}
                              <div className="mb-4">
                                <div className="flex items-center justify-between mb-2">
                                  <label className="block text-xs font-medium text-gray-700">
                                    返信内容
                                  </label>
                                  {/* テンプレ選択ボタン（単体選択時のみ） */}
                                  {checkedIds.size === 0 && (
                                    <button
                                      type="button"
                                      data-testid="reply-template-select"
                                      onClick={() => {
                                        // InternalOpsPaneのテンプレ機能を再利用
                                        // テンプレ選択UIを表示
                                        const templateButton = document.querySelector('[data-testid="reply-templates-open"]');
                                        if (templateButton) {
                                          (templateButton as HTMLButtonElement).click();
                                        }
                                      }}
                                      className="px-2 py-1 text-[11px] border rounded hover:bg-gray-100 text-gray-700"
                                    >
                                      テンプレ
                                    </button>
                                  )}
                                </div>
                                <textarea
                                  data-testid="reply-body"
                                  value={replyMessage}
                                  onChange={(e) => setReplyMessage(e.target.value)}
                                  placeholder="返信内容を入力してください"
                                  rows={6}
                                  className="w-full bg-white border border-gray-300 text-gray-900 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all resize-y font-mono"
                                />
                                {lastAppliedTemplate && (
                                  <div className="mt-2 text-[12px] text-gray-600" data-testid="reply-template-applied">
                                    テンプレ: <span className="font-semibold">{lastAppliedTemplate.title}</span>{" "}
                                    <span className="text-[10px] font-mono text-gray-500">({lastAppliedTemplate.id})</span>
                                  </div>
                                )}
                                {lastAppliedTemplate && lastAppliedTemplate.unresolvedVars.length > 0 && (
                                  <div
                                    className="mt-2 text-[12px] text-[#ea8600] bg-[#fef7e0] p-2 rounded border border-[#fdd663]"
                                    data-testid="reply-template-unresolved"
                                  >
                                    未解決の変数: {lastAppliedTemplate.unresolvedVars.join(", ")}（そのまま送らないでください）
                                  </div>
                                )}
                              </div>

                              {/* アクションボタン */}
                              <div className="flex gap-2 flex-wrap">
                                {replyRoute.kind === "rakuten_rms" && (
                                  <>
                                    <button
                                      onClick={handleRakutenReply}
                                      disabled={!replyInquiryNumber || !replyMessage.trim() || isSendingReply || readOnlyMode}
                                      className="px-4 py-2 bg-orange-600 text-white hover:bg-orange-500 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed rounded-md text-sm font-medium transition-colors flex items-center gap-2"
                                    >
                                      <Send size={14} />
                                      {isSendingReply ? "送信中..." : "送信（RMS）"}
                                    </button>
                                    {replyInquiryNumber && (
                                      <button
                                        onClick={async () => {
                                          const url = getRmsUrl();
                                          if (url) {
                                            // TEST_MODEではwindow.openしない
                                            if (testMode) {
                                              showToast("RMSを開きました（TEST）", "success");
                                              // Activity記録（best-effort）
                                              try {
                                                await fetch("/api/mailhub/activity", {
                                                  method: "POST",
                                                  headers: { "Content-Type": "application/json" },
                                                  body: JSON.stringify({
                                                    action: "reply_open_rms",
                                                    messageId: selectedMessage?.id,
                                                    metadata: {
                                                      inquiryId: replyInquiryNumber,
                                                      url,
                                                    },
                                                  }),
                                                });
                                              } catch {
                                                // ignore
                                              }
                                            } else {
                                              window.open(url, "_blank", "noopener,noreferrer");
                                              // Activity記録（best-effort）
                                              try {
                                                await fetch("/api/mailhub/activity", {
                                                  method: "POST",
                                                  headers: { "Content-Type": "application/json" },
                                                  body: JSON.stringify({
                                                    action: "reply_open_rms",
                                                    messageId: selectedMessage?.id,
                                                    metadata: {
                                                      inquiryId: replyInquiryNumber,
                                                      url,
                                                    },
                                                  }),
                                                });
                                              } catch {
                                                // ignore
                                              }
                                            }
                                          } else {
                                            showToast("RMS URLが設定されていません", "error");
                                          }
                                        }}
                                        disabled={!getRmsUrl()}
                                        data-testid="reply-open-rms"
                                        className="px-4 py-2 bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed text-gray-700 rounded-md text-sm font-medium transition-colors flex items-center gap-2"
                                      >
                                        <ExternalLink size={14} />
                                        RMSを開く
                                      </button>
                                    )}
                                  </>
                                )}
                                {replyRoute.kind === "gmail" && (
                                  <a
                                    href={buildGmailReplyLink(selectedMessage.gmailLink, selectedMessage.threadId)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-500 rounded-md text-sm font-medium transition-colors flex items-center gap-2"
                                  >
                                    <ExternalLink size={14} />
                                    Gmailで返信
                                  </a>
                                )}
                                <button
                                  onClick={handleCopyReply}
                                  disabled={!replyMessage.trim()}
                                  data-testid="reply-copy-template"
                                  className="px-4 py-2 bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed text-gray-700 rounded-md text-sm font-medium transition-colors flex items-center gap-2"
                                >
                                  <Copy size={14} />
                                  コピー
                                </button>
                                
                                {/* Step56: 返信完了マクロ */}
                                <div className="flex gap-2 border-l border-gray-300 pl-2">
                                  <button
                                    onClick={() => {
                                      setReplyCompleteStatus("done");
                                      setShowReplyCompleteModal(true);
                                    }}
                                    disabled={readOnlyMode || isCompletingReply}
                                    data-testid="reply-mark-done"
                                    className="px-4 py-2 bg-green-600 text-white hover:bg-green-500 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed rounded-md text-sm font-medium transition-colors flex items-center gap-2"
                                    title={readOnlyMode ? "READ ONLYのため実行できません" : "返信完了（Done）"}
                                  >
                                    <CheckCircle size={14} />
                                    {isCompletingReply && replyCompleteStatus === "done" ? "処理中..." : "返信完了"}
                                  </button>
                                  <button
                                    onClick={() => {
                                      setReplyCompleteStatus("waiting");
                                      setShowReplyCompleteModal(true);
                                    }}
                                    disabled={readOnlyMode || isCompletingReply}
                                    data-testid="reply-mark-waiting"
                                    className="px-4 py-2 bg-yellow-600 text-white hover:bg-yellow-500 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed rounded-md text-sm font-medium transition-colors flex items-center gap-2"
                                    title={readOnlyMode ? "READ ONLYのため実行できません" : "返信完了（保留）"}
                                  >
                                    <Clock size={14} />
                                    {isCompletingReply && replyCompleteStatus === "waiting" ? "処理中..." : "返信完了（保留）"}
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Step56: 返信完了確認モーダル */}
                        {showReplyCompleteModal && replyCompleteStatus && selectedMessage && replyRoute && (
                          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setShowReplyCompleteModal(false)}>
                            <div className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-gray-200 p-6" onClick={(e) => e.stopPropagation()} data-testid="reply-confirm-modal">
                              <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-bold text-gray-900">返信完了の確認</h3>
                                <button
                                  onClick={() => setShowReplyCompleteModal(false)}
                                  className="p-1 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-gray-700 transition-colors"
                                >
                                  <LogOut className="w-5 h-5 rotate-180" />
                                </button>
                              </div>
                              
                              <div className="space-y-3 mb-6">
                                <div>
                                  <div className="text-xs font-medium text-gray-500 mb-1">件名</div>
                                  <div className="text-sm text-gray-900">{selectedMessage.subject || "(no subject)"}</div>
                                </div>
                                <div>
                                  <div className="text-xs font-medium text-gray-500 mb-1">送信元</div>
                                  <div className="text-sm text-gray-900">{selectedMessage.from || "-"}</div>
                                </div>
                                <div>
                                  <div className="text-xs font-medium text-gray-500 mb-1">返信ルート</div>
                                  <div className="text-sm text-gray-900">
                                    {replyRoute.kind === "rakuten_rms" ? "楽天RMS" : replyRoute.kind === "gmail" ? "Gmail" : "手動判断"}
                                  </div>
                                </div>
                                {replyRoute.kind === "rakuten_rms" && replyInquiryNumber && (
                                  <div>
                                    <div className="text-xs font-medium text-gray-500 mb-1">問い合わせ番号</div>
                                    <div className="text-sm text-gray-900">{replyInquiryNumber}</div>
                                  </div>
                                )}
                                {replyMessage && (
                                  <div>
                                    <div className="text-xs font-medium text-gray-500 mb-1">返信内容</div>
                                    <div className="text-sm text-gray-900 bg-gray-50 p-2 rounded border border-gray-200 max-h-32 overflow-y-auto">
                                      {replyMessage.substring(0, 200)}{replyMessage.length > 200 ? "..." : ""}
                                    </div>
                                  </div>
                                )}
                                {lastAppliedTemplate && (
                                  <div>
                                    <div className="text-xs font-medium text-gray-500 mb-1">適用テンプレ</div>
                                    <div className="text-sm text-gray-900">
                                      {lastAppliedTemplate.title} <span className="text-[10px] font-mono text-gray-500">({lastAppliedTemplate.id})</span>
                                    </div>
                                    {lastAppliedTemplate.unresolvedVars.length > 0 && (
                                      <div className="mt-1 text-[12px] text-[#ea8600]">
                                        未解決: {lastAppliedTemplate.unresolvedVars.join(", ")}
                                      </div>
                                    )}
                                  </div>
                                )}
                                <div>
                                  <div className="text-xs font-medium text-gray-500 mb-1">実行する操作</div>
                                  <div className="text-sm font-bold text-gray-900">
                                    {replyCompleteStatus === "done" ? "✅ Done（完了）" : replyCompleteStatus === "waiting" ? "🕗 Waiting（保留）" : "🧊 Muted（低優先）"}
                                  </div>
                                </div>
                              </div>
                              
                              <div className="flex gap-3">
                                <button
                                  onClick={() => setShowReplyCompleteModal(false)}
                                  className="flex-1 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-md text-sm font-medium transition-colors"
                                >
                                  キャンセル
                                </button>
                                <button
                                  onClick={() => {
                                    if (selectedMessage?.id && replyCompleteStatus) {
                                      void handleReplyComplete(selectedMessage.id, replyCompleteStatus);
                                    }
                                  }}
                                  disabled={isCompletingReply}
                                  data-testid="reply-confirm-apply"
                                  className="flex-1 px-4 py-2 bg-blue-600 text-white hover:bg-blue-500 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2"
                                >
                                  {isCompletingReply ? (
                                    <>
                                      <Clock size={14} className="animate-spin" />
                                      処理中...
                                    </>
                                  ) : (
                                    "実行"
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="w-full h-px bg-gradient-to-r from-transparent via-gray-300 to-transparent" />
                        <div className="flex justify-center items-center gap-6 opacity-30">
                           <CheckCircle size={20} className="text-gray-400" />
                           <div className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-400">End of Thread</div>
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
                { keys: ["A"], desc: "担当トグル（Assign/Unassign）" },
                { keys: ["S"], desc: "SLA Focus ON/OFF" },
                { keys: ["Shift", "S"], desc: "Critical-only切替（SLA ON時）" },
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


      {/* 一括操作結果モーダル */}
      {bulkResult && bulkResult.failedIds.length > 0 && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0f172a]/90 backdrop-blur-sm p-4" onClick={() => setBulkResult(null)}>
          <div className="w-full max-w-md bg-[#1e293b] rounded-2xl shadow-2xl border border-slate-700/50 p-8" onClick={(e) => e.stopPropagation()} data-testid="bulk-result-modal">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-black text-white tracking-tight">一括操作の結果</h3>
              <button onClick={() => setBulkResult(null)} className="p-1 hover:bg-slate-800 rounded-lg text-slate-500 hover:text-white transition-colors">
                <LogOut className="w-5 h-5 rotate-180" />
              </button>
            </div>
            <div className="space-y-4 mb-6">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="text-sm text-green-400 font-medium">成功: {bulkResult.successIds.length}件</div>
                  <div className="text-sm text-red-400 font-medium">失敗: {bulkResult.failedIds.length}件</div>
                </div>
              </div>
              {bulkResult.failedMessages.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs text-slate-400 mb-2">失敗したメール:</div>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {bulkResult.failedMessages.map((msg) => (
                      <div key={msg.id} className="text-xs text-slate-300 bg-slate-800/50 p-2 rounded">
                        {msg.subject}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setBulkResult(null)}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-md text-sm font-medium transition-colors"
              >
                閉じる
              </button>
              <button
                data-testid="bulk-retry-failed"
                onClick={handleBulkRetry}
                className="flex-1 px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-md text-sm font-medium transition-colors"
              >
                失敗分を再実行
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ops Board Drawer */}
      {showOpsDrawer && (
        <div className="fixed inset-0 z-[100] flex items-end justify-end bg-[#0f172a]/90 backdrop-blur-sm" onClick={() => setShowOpsDrawer(false)}>
          <div className="w-full max-w-2xl h-[80vh] bg-[#1e293b] rounded-t-2xl shadow-2xl border-t border-slate-700/50 flex flex-col" onClick={(e) => e.stopPropagation()} data-testid="ops-drawer">
            <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
              <h3 className="text-xl font-black text-white tracking-tight">Ops Board</h3>
              <button 
                onClick={() => setShowOpsDrawer(false)} 
                className="p-1 hover:bg-slate-800 rounded-lg text-slate-500 hover:text-white transition-colors"
                data-testid="ops-drawer-close"
              >
                <LogOut className="w-5 h-5 rotate-180" />
              </button>
            </div>
            
            {/* サマリー一覧 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {!opsSummary ? (
                <div className="text-center text-slate-500 text-sm py-8">読み込み中...</div>
              ) : (
                <>
                  {/* Todo Critical */}
                  {opsSummary.todo.critical.count > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="text-sm font-bold text-red-400">Todo Critical ({opsSummary.todo.critical.count}件)</h4>
                      </div>
                      <div className="space-y-1">
                        {opsSummary.todo.critical.items.map((item) => (
                          <div
                            key={item.id}
                            className="bg-red-500/10 p-2 rounded border border-red-500/30 hover:bg-red-500/20 transition-colors cursor-pointer"
                            onClick={async () => {
                              // Waiting staleのメールをクリックした場合はWaitingラベルへ切替
                              if (opsSummary.waiting.critical.items.some((i) => i.id === item.id) || 
                                  opsSummary.waiting.warn.items.some((i) => i.id === item.id)) {
                                const waitingLabel = labelGroups.flatMap((g) => g.items).find((it) => it.statusType === "waiting");
                                if (waitingLabel && labelId !== waitingLabel.id) {
                                  await loadList(waitingLabel.id, item.id);
                                  setShowOpsDrawer(false);
                                  return;
                                }
                              }
                              // Todo/Unassignedのメールをクリックした場合はTodoラベルへ切替
                              else {
                                const todoLabel = labelGroups.flatMap((g) => g.items).find((it) => it.statusType === "todo");
                                if (todoLabel && labelId !== todoLabel.id) {
                                  await loadList(todoLabel.id, item.id);
                                  setShowOpsDrawer(false);
                                  return;
                                }
                              }
                              onSelectMessage(item.id);
                              setShowOpsDrawer(false);
                            }}
                            data-testid={`ops-item-${item.id}`}
                          >
                            <div className="text-xs text-red-400 font-medium">{item.elapsed}</div>
                            <div className="text-sm text-white truncate">{item.subject || item.from || item.id}</div>
                            <div className="text-xs text-slate-400 truncate">{item.from}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Todo Warn */}
                  {opsSummary.todo.warn.count > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="text-sm font-bold text-yellow-400">Todo Warn ({opsSummary.todo.warn.count}件)</h4>
                      </div>
                      <div className="space-y-1">
                        {opsSummary.todo.warn.items.map((item) => (
                          <div
                            key={item.id}
                            className="bg-yellow-500/10 p-2 rounded border border-yellow-500/30 hover:bg-yellow-500/20 transition-colors cursor-pointer"
                            onClick={async () => {
                              // Waiting staleのメールをクリックした場合はWaitingラベルへ切替
                              if (opsSummary.waiting.critical.items.some((i) => i.id === item.id) || 
                                  opsSummary.waiting.warn.items.some((i) => i.id === item.id)) {
                                const waitingLabel = labelGroups.flatMap((g) => g.items).find((it) => it.statusType === "waiting");
                                if (waitingLabel && labelId !== waitingLabel.id) {
                                  await loadList(waitingLabel.id, item.id);
                                  setShowOpsDrawer(false);
                                  return;
                                }
                              }
                              // Todo/Unassignedのメールをクリックした場合はTodoラベルへ切替
                              else {
                                const todoLabel = labelGroups.flatMap((g) => g.items).find((it) => it.statusType === "todo");
                                if (todoLabel && labelId !== todoLabel.id) {
                                  await loadList(todoLabel.id, item.id);
                                  setShowOpsDrawer(false);
                                  return;
                                }
                              }
                              onSelectMessage(item.id);
                              setShowOpsDrawer(false);
                            }}
                            data-testid={`ops-item-${item.id}`}
                          >
                            <div className="text-xs text-yellow-400 font-medium">{item.elapsed}</div>
                            <div className="text-sm text-white truncate">{item.subject || item.from || item.id}</div>
                            <div className="text-xs text-slate-400 truncate">{item.from}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Waiting Critical */}
                  {opsSummary.waiting.critical.count > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="text-sm font-bold text-red-400">Waiting Critical ({opsSummary.waiting.critical.count}件)</h4>
                      </div>
                      <div className="space-y-1">
                        {opsSummary.waiting.critical.items.map((item) => (
                          <div
                            key={item.id}
                            className="bg-red-500/10 p-2 rounded border border-red-500/30 hover:bg-red-500/20 transition-colors cursor-pointer"
                            onClick={async () => {
                              // Waiting staleのメールをクリックした場合はWaitingラベルへ切替
                              if (opsSummary.waiting.critical.items.some((i) => i.id === item.id) || 
                                  opsSummary.waiting.warn.items.some((i) => i.id === item.id)) {
                                const waitingLabel = labelGroups.flatMap((g) => g.items).find((it) => it.statusType === "waiting");
                                if (waitingLabel && labelId !== waitingLabel.id) {
                                  await loadList(waitingLabel.id, item.id);
                                  setShowOpsDrawer(false);
                                  return;
                                }
                              }
                              // Todo/Unassignedのメールをクリックした場合はTodoラベルへ切替
                              else {
                                const todoLabel = labelGroups.flatMap((g) => g.items).find((it) => it.statusType === "todo");
                                if (todoLabel && labelId !== todoLabel.id) {
                                  await loadList(todoLabel.id, item.id);
                                  setShowOpsDrawer(false);
                                  return;
                                }
                              }
                              onSelectMessage(item.id);
                              setShowOpsDrawer(false);
                            }}
                            data-testid={`ops-item-${item.id}`}
                          >
                            <div className="text-xs text-red-400 font-medium">{item.elapsed}</div>
                            <div className="text-sm text-white truncate">{item.subject || item.from || item.id}</div>
                            <div className="text-xs text-slate-400 truncate">{item.from}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Waiting Warn */}
                  {opsSummary.waiting.warn.count > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="text-sm font-bold text-yellow-400">Waiting Warn ({opsSummary.waiting.warn.count}件)</h4>
                      </div>
                      <div className="space-y-1">
                        {opsSummary.waiting.warn.items.map((item) => (
                          <div
                            key={item.id}
                            className="bg-yellow-500/10 p-2 rounded border border-yellow-500/30 hover:bg-yellow-500/20 transition-colors cursor-pointer"
                            onClick={async () => {
                              // Waiting staleのメールをクリックした場合はWaitingラベルへ切替
                              if (opsSummary.waiting.critical.items.some((i) => i.id === item.id) || 
                                  opsSummary.waiting.warn.items.some((i) => i.id === item.id)) {
                                const waitingLabel = labelGroups.flatMap((g) => g.items).find((it) => it.statusType === "waiting");
                                if (waitingLabel && labelId !== waitingLabel.id) {
                                  await loadList(waitingLabel.id, item.id);
                                  setShowOpsDrawer(false);
                                  return;
                                }
                              }
                              // Todo/Unassignedのメールをクリックした場合はTodoラベルへ切替
                              else {
                                const todoLabel = labelGroups.flatMap((g) => g.items).find((it) => it.statusType === "todo");
                                if (todoLabel && labelId !== todoLabel.id) {
                                  await loadList(todoLabel.id, item.id);
                                  setShowOpsDrawer(false);
                                  return;
                                }
                              }
                              onSelectMessage(item.id);
                              setShowOpsDrawer(false);
                            }}
                            data-testid={`ops-item-${item.id}`}
                          >
                            <div className="text-xs text-yellow-400 font-medium">{item.elapsed}</div>
                            <div className="text-sm text-white truncate">{item.subject || item.from || item.id}</div>
                            <div className="text-xs text-slate-400 truncate">{item.from}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Unassigned Critical */}
                  {opsSummary.unassigned.critical.count > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="text-sm font-bold text-red-400">Unassigned Critical ({opsSummary.unassigned.critical.count}件)</h4>
                      </div>
                      <div className="space-y-1">
                        {opsSummary.unassigned.critical.items.map((item) => (
                          <div
                            key={item.id}
                            className="bg-red-500/10 p-2 rounded border border-red-500/30 hover:bg-red-500/20 transition-colors cursor-pointer"
                            onClick={async () => {
                              // Waiting staleのメールをクリックした場合はWaitingラベルへ切替
                              if (opsSummary.waiting.critical.items.some((i) => i.id === item.id) || 
                                  opsSummary.waiting.warn.items.some((i) => i.id === item.id)) {
                                const waitingLabel = labelGroups.flatMap((g) => g.items).find((it) => it.statusType === "waiting");
                                if (waitingLabel && labelId !== waitingLabel.id) {
                                  await loadList(waitingLabel.id, item.id);
                                  setShowOpsDrawer(false);
                                  return;
                                }
                              }
                              // Todo/Unassignedのメールをクリックした場合はTodoラベルへ切替
                              else {
                                const todoLabel = labelGroups.flatMap((g) => g.items).find((it) => it.statusType === "todo");
                                if (todoLabel && labelId !== todoLabel.id) {
                                  await loadList(todoLabel.id, item.id);
                                  setShowOpsDrawer(false);
                                  return;
                                }
                              }
                              onSelectMessage(item.id);
                              setShowOpsDrawer(false);
                            }}
                            data-testid={`ops-item-${item.id}`}
                          >
                            <div className="text-xs text-red-400 font-medium">{item.elapsed}</div>
                            <div className="text-sm text-white truncate">{item.subject || item.from || item.id}</div>
                            <div className="text-xs text-slate-400 truncate">{item.from}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Unassigned Warn */}
                  {opsSummary.unassigned.warn.count > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="text-sm font-bold text-yellow-400">Unassigned Warn ({opsSummary.unassigned.warn.count}件)</h4>
                      </div>
                      <div className="space-y-1">
                        {opsSummary.unassigned.warn.items.map((item) => (
                          <div
                            key={item.id}
                            className="bg-yellow-500/10 p-2 rounded border border-yellow-500/30 hover:bg-yellow-500/20 transition-colors cursor-pointer"
                            onClick={async () => {
                              // Waiting staleのメールをクリックした場合はWaitingラベルへ切替
                              if (opsSummary.waiting.critical.items.some((i) => i.id === item.id) || 
                                  opsSummary.waiting.warn.items.some((i) => i.id === item.id)) {
                                const waitingLabel = labelGroups.flatMap((g) => g.items).find((it) => it.statusType === "waiting");
                                if (waitingLabel && labelId !== waitingLabel.id) {
                                  await loadList(waitingLabel.id, item.id);
                                  setShowOpsDrawer(false);
                                  return;
                                }
                              }
                              // Todo/Unassignedのメールをクリックした場合はTodoラベルへ切替
                              else {
                                const todoLabel = labelGroups.flatMap((g) => g.items).find((it) => it.statusType === "todo");
                                if (todoLabel && labelId !== todoLabel.id) {
                                  await loadList(todoLabel.id, item.id);
                                  setShowOpsDrawer(false);
                                  return;
                                }
                              }
                              onSelectMessage(item.id);
                              setShowOpsDrawer(false);
                            }}
                            data-testid={`ops-item-${item.id}`}
                          >
                            <div className="text-xs text-yellow-400 font-medium">{item.elapsed}</div>
                            <div className="text-sm text-white truncate">{item.subject || item.from || item.id}</div>
                            <div className="text-xs text-slate-400 truncate">{item.from}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {opsSummary.todo.critical.count === 0 && opsSummary.todo.warn.count === 0 && 
                   opsSummary.waiting.critical.count === 0 && opsSummary.waiting.warn.count === 0 &&
                   opsSummary.unassigned.critical.count === 0 && opsSummary.unassigned.warn.count === 0 && (
                    <div className="text-center text-slate-500 text-sm py-8">滞留メールはありません</div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Handoff Drawer */}
      {showHandoffDrawer && (
        <HandoffDrawer
          open={showHandoffDrawer}
          onClose={() => setShowHandoffDrawer(false)}
          isAdmin={isAdmin}
          showToast={showToast}
        />
      )}

      {/* Explain Drawer */}
      {showExplainDrawer && (
        <ExplainDrawer
          open={showExplainDrawer}
          onClose={() => setShowExplainDrawer(false)}
          messageId={selectedId}
          isAdmin={isAdmin}
          showToast={showToast}
        />
      )}

      {/* Activity Drawer */}
      {showActivityDrawer && (
        <div className="fixed inset-0 z-[100] flex items-end justify-end bg-[#0f172a]/90 backdrop-blur-sm" onClick={() => setShowActivityDrawer(false)}>
          <div className="w-full max-w-2xl h-[80vh] bg-[#1e293b] rounded-t-2xl shadow-2xl border-t border-slate-700/50 flex flex-col" onClick={(e) => e.stopPropagation()} data-testid="activity-drawer">
            <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
              <h3 className="text-xl font-black text-white tracking-tight">Activity</h3>
              <div className="flex items-center gap-2">
                <a
                  href={`/api/mailhub/activity/export?${new URLSearchParams({
                    ...(activityFilter === "me" ? { actor: "me" } : {}),
                    ...(activityActionFilter !== "all" ? { action: activityActionFilter } : {}),
                    ...(activityRuleIdFilter ? { ruleId: activityRuleIdFilter } : {}),
                  }).toString()}`}
                  download
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-800 text-slate-400 hover:bg-slate-700 transition-colors"
                  data-testid="activity-export-csv"
                >
                  CSV Export
                </a>
                <button 
                  onClick={() => setShowActivityDrawer(false)} 
                  className="p-1 hover:bg-slate-800 rounded-lg text-slate-500 hover:text-white transition-colors"
                  data-testid="activity-drawer-close"
                >
                  <LogOut className="w-5 h-5 rotate-180" />
                </button>
              </div>
            </div>
            
            {/* フィルタ */}
            <div className="p-4 border-b border-slate-700/50 flex gap-2 flex-wrap">
              <button
                onClick={() => {
                  setActivityFilter("all");
                  setActivityActorEmail("");
                  setActivityRuleIdFilter(null);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  activityFilter === "all" && !activityRuleIdFilter
                    ? "bg-blue-600 text-white" 
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                }`}
                data-testid="activity-filter-all"
              >
                All
              </button>
              <button
                onClick={() => {
                  setActivityFilter("me");
                  setActivityActorEmail("");
                  setActivityRuleIdFilter(null);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  activityFilter === "me" && !activityRuleIdFilter
                    ? "bg-blue-600 text-white" 
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                }`}
                data-testid="activity-filter-me"
              >
                Mine
              </button>
              <input
                value={activityActorEmail}
                onChange={(e) => {
                  const v = e.target.value;
                  setActivityActorEmail(v);
                  if (v.trim()) setActivityFilter("all");
                }}
                placeholder="actor email（任意）"
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-800 text-slate-400 border border-slate-700 focus:outline-none focus:border-blue-500"
                data-testid="activity-filter-actor"
              />
              <select
                value={activityActionFilter}
                onChange={(e) => setActivityActionFilter(e.target.value)}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-800 text-slate-400 border border-slate-700 focus:outline-none focus:border-blue-500"
                data-testid="activity-filter-action"
              >
                <option value="all">All Actions</option>
                <option value="archive">Archive</option>
                <option value="mute">Mute</option>
                <option value="assign">Assign</option>
                <option value="setWaiting">Waiting</option>
              </select>
              <select
                value={activityPeriodFilter}
                onChange={(e) => setActivityPeriodFilter(e.target.value as "all" | "24h" | "7d" | "30d")}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-800 text-slate-400 border border-slate-700 focus:outline-none focus:border-blue-500"
                data-testid="activity-filter-period"
              >
                <option value="all">All Time</option>
                <option value="24h">24h</option>
                <option value="7d">7d</option>
                <option value="30d">30d</option>
              </select>
              <input
                value={activityMessageIdFilter}
                onChange={(e) => setActivityMessageIdFilter(e.target.value)}
                placeholder="messageId"
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-800 text-slate-400 border border-slate-700 focus:outline-none focus:border-blue-500"
                data-testid="activity-filter-messageId"
              />
              <input
                value={activitySubjectFilter}
                onChange={(e) => setActivitySubjectFilter(e.target.value)}
                placeholder="subject contains"
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-800 text-slate-400 border border-slate-700 focus:outline-none focus:border-blue-500"
                data-testid="activity-filter-subject"
              />
              {activityRuleIdFilter && (
                <div className="flex items-center gap-2 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md">
                  <span>Rule: {activityRuleIdFilter}</span>
                  <button
                    onClick={() => setActivityRuleIdFilter(null)}
                    className="hover:text-blue-200"
                    data-testid="activity-filter-ruleid-clear"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
            
            {/* ログ一覧 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {activityLogs.length === 0 ? (
                <div className="text-center text-slate-500 text-sm py-8">ログがありません</div>
              ) : (
                activityLogs.map((log, idx) => {
                  const elapsedMs = getElapsedMs(log.receivedAt);
                  const elapsedText = formatElapsedTime(elapsedMs);
                  const isWaiting = log.status === "waiting";
                  const color = isWaiting 
                    ? getElapsedColorWaiting(elapsedMs)
                    : getElapsedColorTodo(elapsedMs);
                  
                  const colorClass = color === "error" 
                    ? "bg-red-500/20 text-red-400 border-red-500/30"
                    : color === "warning"
                    ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                    : "bg-slate-700/50 text-slate-400 border-slate-600/30";
                  
                  return (
                    <div 
                      key={`${log.timestamp}-${idx}`}
                      className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/30 hover:bg-slate-800 transition-colors cursor-pointer"
                      onClick={() => {
                        if (log.messageId) {
                          onSelectMessage(log.messageId);
                          setShowActivityDrawer(false);
                        }
                      }}
                      data-testid={`activity-log-${idx}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium text-slate-300">{log.actorEmail.split("@")[0]}</span>
                            <span className="text-xs text-slate-500">{log.action}</span>
                            {log.channel && (
                              <span className="text-xs text-blue-400">{log.channel}</span>
                            )}
                            {log.status && (
                              <span className="text-xs text-orange-400">{log.status}</span>
                            )}
                          </div>
                          <div className="text-sm text-slate-200 truncate">{log.subject || log.messageId}</div>
                          {/* Step 91: reasonが存在する場合は表示 */}
                          {"reason" in log && log.reason && (
                            <div className="text-xs text-amber-400 mt-1" data-testid="activity-log-reason">
                              📝 {log.reason}
                            </div>
                          )}
                          <div className="text-xs text-slate-500 mt-1">
                            {new Date(log.timestamp).toLocaleString("ja-JP")}
                          </div>
                        </div>
                        {log.receivedAt && (
                          <span className={`px-2 py-1 text-[10px] font-bold rounded border ${colorClass}`}>
                            {elapsedText}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* 候補の一括低優先（E2E互換: TEST_MODEでは確認UIを表示） */}
      {showBulkMuteConfirm && (
        <div
          className="fixed inset-0 z-[190] flex items-center justify-center bg-black/30"
          data-testid="bulk-mute-confirm"
          onClick={() => setShowBulkMuteConfirm(false)}
        >
          <div
            className="w-full max-w-sm bg-white rounded-xl shadow-2xl border border-gray-200 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-bold text-[#202124]">候補を一括で低優先へ</div>
            <div className="mt-1 text-xs text-gray-600">
              {triageCandidates.length}件を低優先へ移動します。
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-3 py-2 text-xs font-bold rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                onClick={() => setShowBulkMuteConfirm(false)}
              >
                キャンセル
              </button>
              <button
                data-testid="bulk-mute-confirm-execute"
                className="px-3 py-2 text-xs font-bold rounded-md bg-yellow-600 text-white hover:bg-yellow-700"
                onClick={() => {
                  setShowBulkMuteConfirm(false);
                  void handleBulkMute();
                }}
              >
                実行
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 90: Safety Confirm Modal（一括操作の確認） */}
      {pendingBulkConfirm && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/30"
          data-testid="bulk-safety-confirm"
          onClick={() => setPendingBulkConfirm(null)}
        >
          <div
            className="w-full max-w-sm bg-white rounded-xl shadow-2xl border border-gray-200 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-medium text-gray-900 mb-3">⚠️ 確認</div>
            <div className="text-xs text-gray-600 mb-4">
              {pendingBulkConfirm.action === "bulkDone" && `${pendingBulkConfirm.ids.length}件のメールを完了にします。よろしいですか？`}
              {pendingBulkConfirm.action === "bulkMute" && `${pendingBulkConfirm.ids.length}件のメールを低優先にします。よろしいですか？`}
              {pendingBulkConfirm.action === "bulkAssign" && `${pendingBulkConfirm.ids.length}件のメールを自分に割り当てます。よろしいですか？`}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-3 py-2 text-xs font-bold rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                onClick={() => setPendingBulkConfirm(null)}
                data-testid="bulk-safety-confirm-cancel"
              >
                キャンセル
              </button>
              <button
                className="px-3 py-2 text-xs font-bold rounded-md bg-blue-600 text-white hover:bg-blue-700"
                onClick={handleBulkConfirmOk}
                data-testid="bulk-safety-confirm-ok"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 91: Audit Reason Modal（理由入力） */}
      {pendingReasonModal && (
        <div
          className="fixed inset-0 z-[210] flex items-center justify-center bg-black/40"
          data-testid="audit-reason-modal"
          onClick={() => {
            setPendingReasonModal(null);
            setReasonText("");
          }}
        >
          <div
            className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-gray-200 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-medium text-gray-900 mb-3">📝 理由の入力（必須）</div>
            <div className="text-xs text-gray-600 mb-3">
              {pendingReasonModal.action === "takeover" && "担当者を変更（引き継ぎ）するには、理由を入力してください。"}
            </div>
            <textarea
              data-testid="audit-reason-input"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              placeholder="例: 休暇対応のため引き継ぎ"
              rows={3}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-3 py-2 text-xs font-bold rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                onClick={() => {
                  setPendingReasonModal(null);
                  setReasonText("");
                }}
                data-testid="audit-reason-cancel"
              >
                キャンセル
              </button>
              <button
                className="px-3 py-2 text-xs font-bold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
                onClick={handleReasonConfirmOk}
                disabled={!reasonText.trim()}
                data-testid="audit-reason-ok"
              >
                実行
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 112: Command Palette */}
      {showCommandPalette && (
        <CommandPalette
          open={showCommandPalette}
          commands={commandPaletteCommands}
          onClose={() => setShowCommandPalette(false)}
        />
      )}

      {/* Views Command Palette */}
      {showViewsPalette && (
        <ViewsCommandPalette
          open={showViewsPalette}
          views={views}
          activeViewId={activeViewId}
          onSelectView={(id) => {
            onSelectView(id);
            setShowViewsPalette(false);
          }}
          onClose={() => setShowViewsPalette(false)}
        />
      )}

      {/* Assignee Selector */}
      {showAssigneeSelector && (
        <AssigneeSelector
          open={showAssigneeSelector}
          onClose={() => {
            setShowAssigneeSelector(false);
            setAssigneeSelectorMessageId(null);
            setAssigneeSelectorBulkIds([]);
          }}
          currentUserEmail={user.email}
          currentAssigneeEmail={
            assigneeSelectorMessageId
              ? (() => {
                  const msg = messages.find((m) => m.id === assigneeSelectorMessageId);
                  if (!msg?.assigneeSlug) return null;
                  // assigneeSlugからemailを逆算
                  const mySlug = assigneeSlug(user.email);
                  // 1. 自分と一致するか確認
                  if (msg.assigneeSlug === mySlug) return user.email;
                  // 2. teamメンバーから検索
                  const teamMember = team.find((m) => assigneeSlug(m.email) === msg.assigneeSlug);
                  if (teamMember) return teamMember.email;
                  // 3. 見つからない場合はnull（担当解除ボタンは表示されない）
                  return null;
                })()
              : null
          }
          onSelect={async (email) => {
            await handleAssigneeSelect(email);
          }}
          isAdmin={isAdmin}
        />
      )}

      {/* Step 63: Auto Assign Modal */}
      {showAutoAssignModal && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/30 backdrop-blur-sm" data-testid="auto-assign-modal">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-[#202124]">Auto Assign（配分プレビュー）</h2>
              <button
                type="button"
                onClick={() => setShowAutoAssignModal(false)}
                className="p-2 rounded hover:bg-gray-100"
                data-testid="auto-assign-cancel"
              >
                <X size={18} className="text-[#5f6368]" />
              </button>
            </div>
            
            {/* サマリー */}
            <div className="mb-4 text-sm text-[#5f6368]">
              <p>対象: <span className="font-medium text-[#202124]">{autoAssignPreview.length}件</span>（最大30件）</p>
              <div className="mt-2">
                <span className="font-medium">割当サマリー:</span>
                <div className="flex flex-wrap gap-2 mt-1">
                  {Object.entries(
                    autoAssignPreview.reduce<Record<string, number>>((acc, item) => {
                      acc[item.assignee] = (acc[item.assignee] || 0) + 1;
                      return acc;
                    }, {})
                  ).map(([email, count]) => (
                    <span key={email} className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs">
                      {email.split("@")[0]}: {count}件
                    </span>
                  ))}
                </div>
              </div>
            </div>
            
            {/* 先頭5件のプレビュー */}
            <div className="mb-4 max-h-[200px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-1 text-[#5f6368]">件名</th>
                    <th className="text-left px-2 py-1 text-[#5f6368]">割当先</th>
                  </tr>
                </thead>
                <tbody>
                  {autoAssignPreview.slice(0, 5).map((item) => (
                    <tr key={item.id} className="border-t border-gray-100">
                      <td className="px-2 py-1 truncate max-w-[200px]" title={item.subject ?? ""}>{item.subject ?? "(件名なし)"}</td>
                      <td className="px-2 py-1 text-blue-600">{item.assignee.split("@")[0]}</td>
                    </tr>
                  ))}
                  {autoAssignPreview.length > 5 && (
                    <tr className="border-t border-gray-100">
                      <td colSpan={2} className="px-2 py-1 text-center text-[#5f6368]">...他 {autoAssignPreview.length - 5} 件</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            
            {/* アクションボタン */}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAutoAssignModal(false)}
                className="px-4 py-2 text-sm text-[#5f6368] hover:bg-gray-100 rounded"
              >
                キャンセル
              </button>
              <button
                type="button"
                data-testid="auto-assign-apply"
                onClick={async () => {
                  setShowAutoAssignModal(false);
                  // 既存のbulk assign処理を使用
                  const successIds: string[] = [];
                  const failedIds: string[] = [];
                  const previousMessages = [...messages];
                  
                  // Optimistic更新
                  setMessages((prev) =>
                    prev.map((m) => {
                      const assignment = autoAssignPreview.find((a) => a.id === m.id);
                      if (assignment) {
                        return { ...m, assigneeSlug: assigneeSlug(assignment.assignee) };
                      }
                      return m;
                    })
                  );
                  
                  showToast(`${autoAssignPreview.length}件を配分中...`, "info");
                  
                  // 3並列で実行
                  const chunks: typeof autoAssignPreview[] = [];
                  for (let i = 0; i < autoAssignPreview.length; i += 3) {
                    chunks.push(autoAssignPreview.slice(i, i + 3));
                  }
                  
                  for (const chunk of chunks) {
                    await Promise.all(
                      chunk.map(async (item) => {
                        try {
                          const res = await fetch("/api/mailhub/assign", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              id: item.id,
                              action: "assign",
                              assigneeEmail: item.assignee,
                            }),
                          });
                          if (res.ok) {
                            successIds.push(item.id);
                          } else {
                            failedIds.push(item.id);
                          }
                        } catch {
                          failedIds.push(item.id);
                        }
                      })
                    );
                  }
                  
                  // 失敗分をロールバック
                  if (failedIds.length > 0) {
                    setMessages((prev) =>
                      prev.map((m) => {
                        if (failedIds.includes(m.id)) {
                          const original = previousMessages.find((pm) => pm.id === m.id);
                          return original || m;
                        }
                        return m;
                      })
                    );
                    setBulkResult({
                      successIds,
                      failedIds,
                      failedMessages: failedIds.map((id) => {
                        const m = messages.find((msg) => msg.id === id);
                        return { id, subject: m?.subject ?? "" };
                      }),
                      action: "bulkAssign",
                    });
                    showToast(`${successIds.length}件成功、${failedIds.length}件失敗`, "error");
                  } else {
                    showToast(`${successIds.length}件の配分が完了しました`, "success");
                  }
                  
                  void fetchCountsDebounced();
                }}
                className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded font-medium"
                disabled={autoAssignPreview.length === 0}
              >
                Apply（実行）
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* トースト通知 */}
      {toast && (
        <div data-testid="toast" className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-4 px-6 py-3 rounded-2xl shadow-2xl backdrop-blur-xl border transition-all animate-in slide-in-from-bottom-4 duration-300 ${
          toast.type === "error" 
            ? "bg-red-100 border-red-200 text-black shadow-lg" 
            : toast.type === "info"
            ? "bg-blue-100 border-blue-200 text-black"
            : "bg-emerald-100 border-emerald-200 text-black"
        }`}>
          <div className="flex items-center gap-3">
            {toast.type === "success" && <CheckCircle className="w-5 h-5" />}
            {toast.type === "info" && <Clock className="w-5 h-5" />}
            <span className="text-sm font-bold tracking-tight">{toast.message}</span>
          </div>
          {undoStack.length > 0 && (
            <button onClick={handleUndo} data-testid="toast-undo" className="ml-2 px-3 py-1 bg-black/10 hover:bg-black/20 text-black rounded-lg text-xs font-black uppercase tracking-widest transition-colors">
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
