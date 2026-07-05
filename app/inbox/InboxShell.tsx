"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { createPortal, flushSync } from "react-dom";
import DOMPurify from "dompurify";
import type { ChannelCounts, InboxListMessage, MessageDetail, StatusCounts } from "@/lib/mailhub-types";
import type { LabelGroup, LabelItem } from "@/lib/labels";
import type { ThreadMessageSummary } from "@/lib/thread";
import { routeReply } from "@/lib/replyRouter";
import { getSendResolverChannels, resolveReplyContext } from "@/lib/mailhub-send-resolver";
import { evaluateMailhubReplyOwnershipShield } from "@/lib/mailhub-shield";
import { extractInquiryNumber } from "@/lib/rakuten/extract";
import { coerceChannelId, getChannelSourceScope, getChannels, type ChannelId, type ChannelSourceScope } from "@/lib/channels";
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
import { GmailComposePanel, type GmailComposePanelProps } from "./components/GmailComposePanel";
import { ViewsCommandPalette } from "./components/ViewsCommandPalette";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { AssigneeSelector } from "./components/AssigneeSelector";
import type { View } from "@/lib/views";
import { extractFromDomain, extractFromEmail } from "@/lib/labelRules";
import { 
  CheckCircle, Clock, Undo2, 
  ExternalLink, 
  ArrowUp, ArrowDown, CornerUpLeft,
  LogOut, Mail, Copy, Send, VolumeX, UserCheck, Square, Star, Tag, HelpCircle, Search, MessageSquare, Paperclip,
  ChevronUp, ChevronDown, Users, X, AlertTriangle, RefreshCw, Activity, Settings, Zap, Download, Rows3
} from 'lucide-react';
import { formatElapsedTime, getElapsedMs, getElapsedColorTodo, getElapsedColorWaiting, getSlaLevel } from "@/lib/time-utils";
import { isBroadDomain } from "@/lib/ruleSafety";
import { buildMailhubLabelName } from "@/lib/mailhub-labels";

type DebugLabels = { labelIds: string[]; labelNames: Array<string | null> };
type DetailWithDebug = MessageDetail & { debugLabels?: DebugLabels };
type DetailBodyState = {
  messageId: string | null;
  plainTextBody: string | null;
  htmlBody: string | null;
  bodyNotice: string | null;
  attachments: MessageDetail["attachments"];
  isLoading: boolean;
  debugLabels?: { labelIds: string[]; labelNames: Array<string | null> };
};
type SanitizedHtmlState = {
  messageId: string | null;
  rawHtml: string | null;
  html: string;
  ready: boolean;
};
type GmailSentStatus = "idle" | "sent" | "sent_and_done" | "sent_but_not_done" | "maybe_sent";
type PostSendAction = "none" | "done";
type ListDensity = "comfortable" | "compact";
type MailhubSendSuccessResponse = {
  ok: true;
  status: Exclude<GmailSentStatus, "idle" | "maybe_sent">;
  action: "reply_send";
  messageId: string;
  threadId: string;
  sentMessageId: string;
  clientRequestId: string;
  fromAlias: string;
  fromChannelId: ChannelId;
  to: string;
  postSendAction: PostSendAction;
  done?: { ok: true; action: "archive"; undoable: true } | { ok: false; error: "gmail_api_error"; error_code: string; message: string };
  auditWarning?: true;
};
type MailhubSendErrorResponse = {
  ok: false;
  error?: string;
  message?: string;
  messageId?: string;
  clientRequestId?: string;
  duplicateKey?: "clientRequestId" | "bodyHash";
};
type NoisePreviewStatus = "safe_to_suppress" | "protected" | "missing_summary" | "not_noise";
type NoisePreviewItem = {
  id: string;
  threadId: string | null;
  subject: string | null;
  from: string | null;
  status: NoisePreviewStatus;
  classification: {
    purpose: string;
    suppressible: boolean;
    blockedReasons: string[];
    evidence: Array<{ field: string; keyword: string }>;
  };
};
type NoisePreviewResponse = {
  safeCandidates: NoisePreviewItem[];
  protected: NoisePreviewItem[];
  missingSummary: NoisePreviewItem[];
  notNoise: NoisePreviewItem[];
  warnings: Array<{ type: string; message: string; id?: string }>;
};
type NoiseApplyResponse = {
  processed: number;
  mutedCount: number;
  skippedCount: number;
  failedCount: number;
  muted: Array<{ id: string }>;
  skipped: Array<{ id: string; reason: string }>;
  failed: Array<{ id: string; error: string }>;
};
type GmailSendBlockedReason =
  | null
  | "read_only"
  | "send_disabled"
  | "missing_scope"
  | "send_as_unaccepted"
  | "send_as_check_failed";
type GmailSendHealthState = {
  gmailSendReady: boolean;
  blockedReason: GmailSendBlockedReason;
  acceptedAliases: string[];
  missingAliases: string[];
  checkedAt: string | null;
};
type MailhubListMeta = {
  loadedCount: number;
  max: number;
  hasMore: boolean;
  pageTokenApplied: boolean;
  sourceScope: ChannelSourceScope | null;
};
type MailhubListResponse = {
  label: string;
  messages: InboxListMessage[];
  nextPageToken?: string;
  meta?: MailhubListMeta;
};
type BrainDecisionView = {
  messageId: string;
  purpose: string;
  disposition: string;
  nextAction: string;
  replyRoute: string;
  draftNeeded: boolean;
  discardCandidate: boolean;
  humanRequired: boolean;
  confidence: "low" | "medium" | "high";
  evidence: Array<{ source: string; label: string; detail: string }>;
  warnings: string[];
};
type AiDraftSuggestionView = {
  id: string;
  source: "deterministic_draft_v1";
  route: "gmail";
  title: string;
  body: string;
  bodyHash: string;
  bodyLength: number;
  inputHash: string;
  evidence: Array<{ source: string; label: string; summary: string }>;
  warnings: string[];
  unresolvedVars: string[];
  requiresHumanReview: true;
};
type AiDraftResultView =
  | {
      status: "ready";
      suggestion: AiDraftSuggestionView;
      blockedReason: null;
      message: string;
      inputHash: string;
    }
  | {
      status: "blocked" | "not_needed";
      suggestion: null;
      blockedReason: string;
      message: string;
      inputHash: string;
      evidence: Array<{ source: string; label: string; summary: string }>;
      warnings: string[];
    };
type BrainDecisionState =
  | { status: "idle"; messageId: null }
  | { status: "loading"; messageId: string }
  | { status: "ready"; messageId: string; decision: BrainDecisionView }
  | { status: "error"; messageId: string; message: string };
type AiDraftState =
  | { status: "idle"; messageId: null }
  | { status: "loading"; messageId: string }
  | { status: "ready"; messageId: string; result: AiDraftResultView }
  | { status: "error"; messageId: string; message: string };
type OpsSummaryItemView = {
  id: string;
  subject: string | null;
  from: string | null;
  receivedAt: string;
  elapsed: string;
  status: "critical" | "warn";
  gmailLink: string | null;
};
type OpsSummaryBucketView = {
  critical: { count: number; items: OpsSummaryItemView[] };
  warn: { count: number; items: OpsSummaryItemView[] };
};
type OpsReadinessView = {
  available: boolean;
  generatedAt: string | null;
  auditRepoHead: string | null;
  currentRepoHead: string | null;
  currentRepoParentHead: string | null;
  repoHeadMatches: boolean | null;
  productionReady: boolean;
  p0Blockers: string[];
  p1Blockers: string[];
  sourceCodeCoverageReady: boolean;
  sourceInventoryReady: boolean;
  currentSharedGmailRoutingReady: boolean;
  routingProbeReady: boolean;
  routingProbePreflightReady: boolean;
  routingProbeGithubSecretsReady: boolean;
  defaultViewsRealDataValidated: boolean;
  defaultViewsManualReviewOnly: boolean;
  defaultViewsBulkAutomationSafe: boolean;
  defaultViewsManualReviewOnlyViews: string[];
  defaultViewsBulkUnsafeViews: string[];
  currentRuleConfigRealDataSafetyReady: boolean;
  currentRuleConfigFingerprintPresent: boolean;
  currentRuleConfigSourceProductionReady: boolean;
  ruleConfigFingerprint: string | null;
  ruleConfigSourceRequested: string | null;
  ruleConfigSourceResolved: string | null;
  ruleConfigSourceWarnings: string[];
  unconfirmedChannels: string[];
  missingProbeAddresses: string[];
  missingProbeSmtpEnv: string[];
  missingGithubRoutingSecrets: string[];
  missingGithubExternalSmtpSecrets: string[];
  missingGithubGmailProofSecrets: string[];
  githubExternalSmtpSecretsReady: boolean;
  githubGmailProofSecretsReady: boolean;
  presentGithubRoutingSecrets: string[];
  probeSmtpWarnings: string[];
  mxRecords: Array<{ exchange: string; priority: number }>;
};
type OpsSummaryView = {
  todo: OpsSummaryBucketView;
  waiting: OpsSummaryBucketView;
  unassigned: OpsSummaryBucketView;
  productionReadiness?: OpsReadinessView;
};

type OperationalStatusStripProps = {
  readOnlyMode: boolean;
  writeGuardReady: boolean;
  mailhubEnv: string;
  testMode: boolean;
  statusCounts: StatusCounts | null;
  activeLabel: LabelItem | null;
  activeChannelScope: ChannelSourceScope | null;
  selectedMessage: InboxListMessage | null;
  selectedAssigneeName: string | null;
  productionReadiness: OpsReadinessView | null;
  onOpenOps: () => void;
  onOpenCommandPalette: () => void;
};

function OperationalStatusStrip({
  readOnlyMode,
  writeGuardReady,
  mailhubEnv,
  testMode,
  statusCounts,
  activeLabel,
  activeChannelScope,
  selectedMessage,
  selectedAssigneeName,
  productionReadiness,
  onOpenOps,
  onOpenCommandPalette,
}: OperationalStatusStripProps) {
  const repoMismatch = productionReadiness?.repoHeadMatches === false;
  const productionBlocked = Boolean(productionReadiness && (!productionReadiness.productionReady || repoMismatch));
  const productionLabel = productionReadiness
    ? repoMismatch
      ? "監査HEAD不一致"
      : productionReadiness.productionReady
        ? "本番準備OK"
        : "本番準備ブロック"
    : "運用確認未取得";
  const blockerCount = (productionReadiness?.p0Blockers.length ?? 0) + (productionReadiness?.p1Blockers.length ?? 0);
  const queueLabel = activeChannelScope
    ? `${activeChannelScope.channel.label} / ${activeChannelScope.isAggregate ? `${activeChannelScope.sourceChannels.length}店舗` : `${activeChannelScope.sourceAddresses.length}宛先`}`
    : activeLabel?.label ?? "Inbox";
  const selectedLabel = selectedMessage
    ? `${selectedAssigneeName ?? "未割当"} / ${selectedMessage.receivedAt?.split(" ")[1] ?? "時刻不明"}`
    : "未選択";
  const writeLabel = !writeGuardReady ? "WRITE CHECKING" : readOnlyMode ? "READ ONLY" : productionBlocked ? "WRITE LIMITED" : "WRITE ENABLED";
  const writeTitle = !writeGuardReady
    ? "書き込み安全性を確認中"
    : readOnlyMode
      ? "書き込み系アクションは停止中"
      : productionBlocked
        ? "書き込みは可能ですが、本番準備ブロッカーが残っています"
      : "書き込み系アクションが有効";

  return (
    <div
      data-testid="ops-status-strip"
      className="border-b border-[#dadce0] bg-[#f8fbff] px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-2 text-[12px] leading-5 text-[#3c4043]">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${
            !writeGuardReady
              ? "border-[#dadce0] bg-white text-[#5f6368]"
              : readOnlyMode
              ? "border-[#f4b4ae] bg-[#fce8e6] text-[#a50e0e]"
              : productionBlocked
              ? "border-[#fdd663] bg-[#fef7e0] text-[#92400e]"
              : "border-[#c8e6c9] bg-[#e6f4ea] text-[#137333]"
          }`}
          title={writeTitle}
        >
          {writeLabel}
        </span>
        <span className="inline-flex items-center rounded-full border border-[#dadce0] bg-white px-2 py-0.5 font-medium text-[#3c4043]">
          {testMode ? "TEST" : mailhubEnv.toUpperCase()}
        </span>
        <button
          type="button"
          onClick={onOpenOps}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium transition-colors ${
            productionBlocked
              ? "border-[#fdd663] bg-[#fef7e0] text-[#92400e] hover:bg-[#fde68a]/40"
              : productionReadiness?.productionReady
                ? "border-[#c8e6c9] bg-white text-[#137333] hover:bg-[#e6f4ea]"
                : "border-[#dadce0] bg-white text-[#5f6368] hover:bg-[#f1f3f4]"
          }`}
          data-testid="ops-status-production"
          title="Ops Boardを開く"
        >
          {productionBlocked ? <AlertTriangle size={13} /> : <CheckCircle size={13} />}
          {productionLabel}
          {blockerCount > 0 && <span>({blockerCount})</span>}
        </button>
        <span className="inline-flex min-w-0 max-w-[280px] items-center gap-1 rounded-full border border-[#d2e3fc] bg-white px-2 py-0.5 text-[#1a73e8]">
          <span className="font-medium">Queue</span>
          <span className="truncate">{queueLabel}</span>
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-[#dadce0] bg-white px-2 py-0.5">
          <span className="font-medium">Now</span>
          <span>{selectedLabel}</span>
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-[#dadce0] bg-white px-2 py-0.5">
          未割当 {statusCounts?.unassignedLoad ?? 0}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-[#dadce0] bg-white px-2 py-0.5">
          自分 {statusCounts?.assignedMine ?? 0}
        </span>
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-[#dadce0] bg-white px-2 py-0.5 font-medium text-[#3c4043] hover:bg-[#f1f3f4]"
          data-testid="ops-status-command"
          title="コマンドパレット"
        >
          <Zap size={13} className="text-[#5f6368]" />
          <span className="hidden sm:inline">⌘K</span>
        </button>
      </div>
    </div>
  );
}

const DETAIL_CACHE_TTL_MS = 60_000;
const DETAIL_CACHE_REFRESH_DELAY_MS = 180;
const HOVER_PREFETCH_DELAY_MS = 40;
const THREAD_LOAD_DELAY_MS = 260;
const SANITIZED_HTML_CACHE_MAX_SIZE = 30;
const BACKGROUND_FETCH_IDLE_TIMEOUT_MS = 2_500;
const CHANNEL_COUNT_PREFETCH_BATCH_SIZE = 3;
const RULES_APPLY_SUCCESS_COOLDOWN_MS = 30_000;
const RULES_APPLY_FAILURE_COOLDOWN_MS = 60_000;
const RULES_APPLY_TEST_COOLDOWN_MS = 1_000;
const MAYBE_SENT_MESSAGE =
  "すでに同じ送信が処理されています。送信済みの可能性があるため、受信トレイ/送信済みを確認してください";
const UNRESOLVED_TEMPLATE_VAR_RE = /{{\s*[\w.-]+\s*}}/g;

function getHttpStatus(e: unknown): number | null {
  if (!e || typeof e !== "object") return null;
  const status = (e as { status?: unknown }).status;
  return typeof status === "number" && Number.isFinite(status) ? status : null;
}

function shouldCooldownRulesApplyFailure(e: unknown): boolean {
  const status = getHttpStatus(e);
  return status === 429 || (status !== null && status >= 500);
}

function scheduleIdleTask(callback: () => void, timeout = BACKGROUND_FETCH_IDLE_TIMEOUT_MS): () => void {
  if (typeof window === "undefined") return () => {};
  const idleWindow = window as Window & {
    requestIdleCallback?: (cb: () => void, options?: { timeout?: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof idleWindow.requestIdleCallback === "function") {
    const id = idleWindow.requestIdleCallback(callback, { timeout });
    return () => idleWindow.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(callback, timeout);
  return () => window.clearTimeout(id);
}

function emptyDetailBodyState(messageId: string | null = null, isLoading = false): DetailBodyState {
  return {
    messageId,
    plainTextBody: null,
    htmlBody: null,
    bodyNotice: null,
    attachments: [],
    isLoading,
  };
}

function detailToBodyState(detail: MessageDetail): DetailBodyState {
  return {
    messageId: detail.id,
    plainTextBody: detail.plainTextBody,
    htmlBody: detail.htmlBody,
    bodyNotice: detail.bodyNotice,
    attachments: detail.attachments ?? [],
    isLoading: false,
    debugLabels: (detail as DetailWithDebug).debugLabels,
  };
}

function sanitizeMailHtml(rawHtml: string): string {
  return DOMPurify.sanitize(rawHtml, {
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
}

function formatAddressDisplayName(headerValue: string | null | undefined): string | null {
  const raw = headerValue?.trim();
  if (!raw) return null;
  const beforeAngle = raw.includes("<") ? raw.split("<")[0].trim() : "";
  const displayName = beforeAngle.replace(/^"(.+)"$/, "$1").trim();
  if (displayName) return displayName;
  return extractFromEmail(raw) ?? raw;
}

function joinAddressTitle(...values: Array<string | null | undefined>): string {
  return values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)).join(" / ");
}

function collectAddressEmails(...values: Array<string | string[] | null | undefined>): string[] {
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const value of values) {
    const rawValues = Array.isArray(value) ? value : [value];
    for (const rawValue of rawValues) {
      for (const candidate of rawValue?.split(",") ?? []) {
        const email = extractFromEmail(candidate);
        if (!email || seen.has(email)) continue;
        seen.add(email);
        emails.push(email);
      }
    }
  }
  return emails;
}

function isInternalRecipientEmail(email: string | null | undefined): email is string {
  return Boolean(email?.endsWith("@vtj.co.jp"));
}

function formatAttachmentSize(size: number | null): string | null {
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return null;
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function createClientRequestId(): string {
  return crypto.randomUUID();
}

function extractUnresolvedTemplateVars(value: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of value.matchAll(UNRESOLVED_TEMPLATE_VAR_RE)) {
    const key = match[0].replace(/^{{\s*/, "").replace(/\s*}}$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

function bodyContainsUnresolvedTemplateVar(value: string): boolean {
  return /{{\s*[\w.-]+\s*}}/.test(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function coerceGmailSendBlockedReason(value: unknown): GmailSendBlockedReason {
  if (
    value === null ||
    value === "read_only" ||
    value === "send_disabled" ||
    value === "missing_scope" ||
    value === "send_as_unaccepted" ||
    value === "send_as_check_failed"
  ) {
    return value;
  }
  return "send_disabled";
}

type Props = {
  initialLabelId: string;
  initialChannelId: ChannelId;
  labelGroups: LabelGroup[];
  initialMessages: InboxListMessage[];
  initialNextPageToken?: string | null;
  initialSelectedId: string | null;
  initialSelectedMessage: InboxListMessage | null;
  initialDetail: MessageDetail | null;
  initialSearchQuery?: string;
  initialTeam?: Array<{ email: string; name: string | null }>;
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
  initialNextPageToken = null,
  initialSelectedId,
  initialSelectedMessage,
  initialDetail,
  initialSearchQuery = "",
  initialTeam = [],
  user,
  logoutAction,
  testMode,
  mailhubEnv,
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
  const labelIdRef = useRef(labelId);
  useEffect(() => {
    labelIdRef.current = labelId;
  }, [labelId]);
  const [channelId, setChannelId] = useState<ChannelId>(initialChannelId);
  const availableChannelIds = useMemo(
    () => getChannels(testMode).map((channel) => channel.id),
    [testMode],
  );
  const resolveChannelId = useCallback(
    (candidate: string | null | undefined): ChannelId => {
      if (!candidate || !availableChannelIds.includes(candidate as ChannelId)) return "all";
      return coerceChannelId(candidate, testMode) ?? "all";
    },
    [availableChannelIds, testMode],
  );
  const [messages, setMessages] = useState<InboxListMessage[]>(() => initialMessages);
  // Step 103: ページングトークン
  const [nextPageToken, setNextPageToken] = useState<string | null>(initialNextPageToken);
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
  const selectedIdRef = useRef<string | null>(initialSelectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  const [selectedMessage, setSelectedMessage] = useState<InboxListMessage | null>(
    initialSelectedMessage,
  );
  const [selectedDetail, setSelectedDetail] = useState<MessageDetail | null>(initialDetail);
  // Step 50拡張: initialDetailをキャッシュに保存（即座に表示できるように）
  useEffect(() => {
    if (initialDetail && initialSelectedId) {
      detailCacheRef.current.set(initialSelectedId, {
        detail: initialDetail,
        fetchedAt: Date.now(),
      });
    }
  }, [initialDetail, initialSelectedId]);

  useEffect(() => {
    setSelectedDetail((prev) => (prev && prev.id !== selectedMessage?.id ? null : prev));
  }, [selectedMessage?.id]);

  const [detailBody, setDetailBody] = useState<DetailBodyState>(() =>
    initialDetail ? detailToBodyState(initialDetail) : emptyDetailBodyState(),
  );
  const [isClientReady, setIsClientReady] = useState(false);
  const htmlSanitizeCacheRef = useRef<Map<string, { rawHtml: string; sanitizedHtml: string }>>(new Map());
  const htmlBodyRef = useRef<HTMLDivElement | null>(null);
  const detailBodyFrameRef = useRef<HTMLDivElement | null>(null);
  const renderedHtmlRef = useRef<{ messageId: string | null; rawHtml: string | null }>({
    messageId: null,
    rawHtml: null,
  });
  const [stableDetailBodyMinHeight, setStableDetailBodyMinHeight] = useState(180);

  useEffect(() => {
    setIsClientReady(true);
  }, []);

  const cacheSanitizedDetailHtml = useCallback((detail: MessageDetail) => {
    const rawHtml = detail.htmlBody;
    if (!rawHtml) return;
    const cached = htmlSanitizeCacheRef.current.get(detail.id);
    if (cached?.rawHtml === rawHtml) return;
    const sanitizedHtml = sanitizeMailHtml(rawHtml);
    const cache = htmlSanitizeCacheRef.current;
    cache.set(detail.id, { rawHtml, sanitizedHtml });
    if (cache.size > SANITIZED_HTML_CACHE_MAX_SIZE) {
      const oldestKey = cache.keys().next().value;
      if (typeof oldestKey === "string") cache.delete(oldestKey);
    }
  }, []);

  const [sanitizedHtmlState, setSanitizedHtmlState] = useState<SanitizedHtmlState>({
    messageId: null,
    rawHtml: null,
    html: "",
    ready: true,
  });

  const setSanitizedHtmlStateStable = useCallback((next: SanitizedHtmlState) => {
    setSanitizedHtmlState((prev) =>
      prev.messageId === next.messageId &&
      prev.rawHtml === next.rawHtml &&
      prev.html === next.html &&
      prev.ready === next.ready
        ? prev
        : next,
    );
  }, []);

  useEffect(() => {
    const messageId = detailBody.messageId;
    const rawHtml = detailBody.htmlBody;
    if (!rawHtml || !messageId) {
      setSanitizedHtmlStateStable({ messageId: null, rawHtml: null, html: "", ready: true });
      return;
    }
    if (!isClientReady || detailBody.isLoading || messageId !== selectedMessage?.id) {
      setSanitizedHtmlStateStable({ messageId, rawHtml, html: "", ready: false });
      return;
    }

    const cached = htmlSanitizeCacheRef.current.get(messageId);
    if (cached?.rawHtml === rawHtml) {
      setSanitizedHtmlStateStable({ messageId, rawHtml, html: cached.sanitizedHtml, ready: true });
      return;
    }

    let cancelled = false;
    setSanitizedHtmlStateStable({ messageId, rawHtml, html: "", ready: false });
    const cancelIdle = scheduleIdleTask(() => {
      const sanitizedHtml = sanitizeMailHtml(rawHtml);
      if (cancelled) return;
      const cache = htmlSanitizeCacheRef.current;
      cache.set(messageId, { rawHtml, sanitizedHtml });
      if (cache.size > SANITIZED_HTML_CACHE_MAX_SIZE) {
        const oldestKey = cache.keys().next().value;
        if (typeof oldestKey === "string") cache.delete(oldestKey);
      }
      setSanitizedHtmlStateStable({ messageId, rawHtml, html: sanitizedHtml, ready: true });
    }, 120);

    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [
    detailBody.htmlBody,
    detailBody.isLoading,
    detailBody.messageId,
    isClientReady,
    selectedMessage?.id,
    setSanitizedHtmlStateStable,
  ]);

  const isSelectedHtmlBodyPending =
    Boolean(detailBody.htmlBody) &&
    (!sanitizedHtmlState.ready ||
      sanitizedHtmlState.messageId !== detailBody.messageId ||
      sanitizedHtmlState.rawHtml !== detailBody.htmlBody);

  useLayoutEffect(() => {
    const element = htmlBodyRef.current;
    if (!element) return;

    const shouldRenderHtml =
      isClientReady &&
      !detailBody.isLoading &&
      Boolean(detailBody.htmlBody) &&
      detailBody.messageId !== null &&
      detailBody.messageId === selectedMessage?.id &&
      sanitizedHtmlState.ready &&
      sanitizedHtmlState.messageId === detailBody.messageId &&
      sanitizedHtmlState.rawHtml === detailBody.htmlBody;

    if (!shouldRenderHtml || !detailBody.htmlBody) {
      if (renderedHtmlRef.current.messageId !== null || renderedHtmlRef.current.rawHtml !== null) {
        element.innerHTML = "";
        renderedHtmlRef.current = { messageId: null, rawHtml: null };
      }
      return;
    }

    if (
      renderedHtmlRef.current.messageId === detailBody.messageId &&
      renderedHtmlRef.current.rawHtml === detailBody.htmlBody
    ) {
      return;
    }

    element.innerHTML = sanitizedHtmlState.html;
    renderedHtmlRef.current = { messageId: detailBody.messageId, rawHtml: detailBody.htmlBody };
  }, [
    detailBody.htmlBody,
    detailBody.isLoading,
    detailBody.messageId,
    isClientReady,
    sanitizedHtmlState.html,
    sanitizedHtmlState.messageId,
    sanitizedHtmlState.rawHtml,
    sanitizedHtmlState.ready,
    selectedMessage?.id,
  ]);

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
  const workTagDraftRef = useRef<string[]>([]);
  const locallySavedWorkTagIdsRef = useRef<Set<string>>(new Set());

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
    const cancelIdle = scheduleIdleTask(() => {
      void (async () => {
        const ids = await fetchNoteIds({ hasNote: true });
        if (!cancelled) setNoteIndexIds(new Set(ids));
      })();
    });
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [fetchNoteIds]);

  // Step 101: Work Tags index を取得（一覧表示と検索に使用）
  useEffect(() => {
    let cancelled = false;
    const cancelIdle = scheduleIdleTask(() => {
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
          setWorkTagsById((prev) => {
            if (locallySavedWorkTagIdsRef.current.size === 0) return next;
            const merged = { ...next };
            for (const id of locallySavedWorkTagIdsRef.current) {
              if (prev[id]) merged[id] = prev[id];
            }
            return merged;
          });
        } catch {
          // ignore
        }
      })();
    });
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, []);

  // 選択中メッセージのDraftを同期（UIで編集→保存）
  useEffect(() => {
    if (!selectedId) {
      setWorkTagDraft([]);
      workTagDraftRef.current = [];
      setWorkTagInput("");
      return;
    }
    const nextDraft = workTagsById[selectedId] ?? [];
    setWorkTagDraft(nextDraft);
    workTagDraftRef.current = nextDraft;
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
  const rulesApplyInFlightKeysRef = useRef<Set<string>>(new Set());
  const rulesApplyCooldownUntilByKeyRef = useRef<Map<string, number>>(new Map());
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
  
  const [viewTab, setViewTab] = useState<"inbox" | "assigned" | "waiting" | "muted" | "snoozed">(() => getInitialViewTab()); // タブ切り替え（今返す、自分が対応、返事待ち、処理不要、日付を決めて戻す）
  
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
  const [listWidth, setListWidth] = useState(480);
  const [listDensity, setListDensity] = useState<ListDensity>("comfortable");
  const [resizing, setResizing] = useState<"sidebar" | "list" | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("mailhub-list-density");
      if (stored === "comfortable" || stored === "compact") {
        setListDensity(stored);
      }
    } catch {
      // localStorage is a convenience only; keep the default density if unavailable.
    }
  }, []);

  const toggleListDensity = useCallback(() => {
    setListDensity((prev) => {
      const next: ListDensity = prev === "comfortable" ? "compact" : "comfortable";
      try {
        localStorage.setItem("mailhub-list-density", next);
      } catch {
        // Ignore storage failures; the visual toggle still applies for this session.
      }
      return next;
    });
  }, []);

  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Undoスタック（複数の操作をUndoできるように）
  const UNDO_TTL_MS = 30 * 1000;
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
  type UndoStackItem = UndoItem & { createdAt: number };
  const [undoStack, setUndoStack] = useState<UndoStackItem[]>([]);

  useEffect(() => {
    if (undoStack.length === 0) return;

    const pruneExpiredUndoItems = () => {
      const now = Date.now();
      setUndoStack((prev) => {
        const next = prev.filter((item) => now - item.createdAt < UNDO_TTL_MS);
        return next.length === prev.length ? prev : next;
      });
    };

    pruneExpiredUndoItems();
    const timer = setInterval(pruneExpiredUndoItems, 1000);
    return () => clearInterval(timer);
  }, [UNDO_TTL_MS, undoStack.length]);

  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [showBulkMuteConfirm, setShowBulkMuteConfirm] = useState(false);
  const [senderMutePreview, setSenderMutePreview] = useState<{
    fromEmail: string;
    messages: NoisePreviewItem[];
    protectedCount: number;
    missingSummaryCount: number;
    notNoiseCount: number;
    warningCount: number;
    isLoading: boolean;
    isExecuting: boolean;
    error: string | null;
  } | null>(null);
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
    source?: "gmail_reply" | "assignee_picker";
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
  const [isSendingGmailReply, setIsSendingGmailReply] = useState(false);
  const [gmailSendError, setGmailSendError] = useState<string | null>(null);
  const [gmailSentStatus, setGmailSentStatus] = useState<GmailSentStatus>("idle");
  const [gmailClientRequestId, setGmailClientRequestId] = useState<string | null>(null);
  const [lastAppliedTemplate, setLastAppliedTemplate] = useState<{
    id: string;
    title: string;
    unresolvedVars: string[];
  } | null>(null);
  const [lastAppliedBrainDraft, setLastAppliedBrainDraft] = useState<{
    id: string;
    title: string;
    source: "deterministic_draft_v1";
    bodyHash: string;
    inputHash: string;
  } | null>(null);
  const [brainDecision, setBrainDecision] = useState<BrainDecisionState>({ status: "idle", messageId: null });
  const [aiDraft, setAiDraft] = useState<AiDraftState>({ status: "idle", messageId: null });

  useEffect(() => {
    // 既に空なら同一値を返してsetStateの再レンダリングを発生させない
    // (リスト自動選択によるid変化のたびに全体再レンダリングすると、
    //  Settingsドロワー等の操作中stateとレースする — Step80-1 flaky化の教訓)
    setReplyMessage((prev) => (prev ? "" : prev));
    setLastAppliedTemplate((prev) => (prev ? null : prev));
    setLastAppliedBrainDraft((prev) => (prev ? null : prev));
    setAiDraft((prev) => (prev.status === "idle" ? prev : { status: "idle", messageId: null }));
    setGmailSendError((prev) => (prev ? null : prev));
    setGmailSentStatus((prev) => (prev === "idle" ? prev : "idle"));
    setGmailClientRequestId(selectedMessage?.id ? createClientRequestId() : null);
  }, [selectedMessage?.id]);
  
  // 本文の折りたたみ状態
  const [bodyCollapsed, setBodyCollapsed] = useState(false);

  useLayoutEffect(() => {
    if (bodyCollapsed || detailError || detailBody.isLoading || detailBody.messageId !== selectedMessage?.id) return;
    const frame = detailBodyFrameRef.current;
    if (!frame) return;
    const nextHeight = Math.min(720, Math.max(180, Math.round(frame.getBoundingClientRect().height)));
    setStableDetailBodyMinHeight((prev) => (Math.abs(prev - nextHeight) > 8 ? nextHeight : prev));
  }, [
    bodyCollapsed,
    detailBody.htmlBody,
    detailBody.isLoading,
    detailBody.messageId,
    detailBody.plainTextBody,
    detailError,
    selectedMessage?.id,
  ]);
  
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
  const [writeGuardReady, setWriteGuardReady] = useState<boolean>(false);
  const [writeBlockedReason, setWriteBlockedReason] = useState<null | "read_only" | "insufficient_permissions">(null);
  const [gmailSendHealth, setGmailSendHealth] = useState<GmailSendHealthState>({
    gmailSendReady: false,
    blockedReason: "send_disabled",
    acceptedAliases: [],
    missingAliases: [],
    checkedAt: null,
  });
  const sendEnabledFromHealth = gmailSendHealth.gmailSendReady;
  const sendAsAcceptedByAlias = useMemo(() => {
    const accepted: Record<string, true> = {};
    for (const alias of gmailSendHealth.acceptedAliases) {
      accepted[alias.toLowerCase()] = true;
    }
    return accepted;
  }, [gmailSendHealth.acceptedAliases]);
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
  const [opsSummary, setOpsSummary] = useState<OpsSummaryView | null>(null);
  const [opsReadiness, setOpsReadiness] = useState<OpsReadinessView | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const detailScrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const detailInFlightIdRef = useRef<string | null>(null);
  const listInFlightRequestIdRef = useRef<string | null>(null);
  const lastFocusSyncAtRef = useRef<number>(0);
  const initialEmptyLoadAttemptedRef = useRef(false);
  
  // Step 93: Hover Prefetch用のref
  const hoverPrefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverPrefetchAbortRef = useRef<AbortController | null>(null);
  const hoverPrefetchTargetIdRef = useRef<string | null>(null);
  const adjacentPrefetchAbortRef = useRef<AbortController | null>(null);
  const detailPrefetchInFlightRef = useRef<Map<string, Promise<MessageDetail | null>>>(new Map());
  
  // Step 50: Detailキャッシュ（LRU、最大20件、TTL 60秒）
  type DetailCacheEntry = {
    detail: MessageDetail;
    fetchedAt: number;
  };
  const detailCacheRef = useRef<Map<string, DetailCacheEntry>>(new Map());
  const DETAIL_CACHE_MAX_SIZE = 20;

  // URL同期は history API のみで行う（Next Router の連続 replace による throttling を回避）
  const replaceUrl = useCallback((label: string, id: string | null, keepView: boolean = true, searchQ?: string | null) => {
    const params = new URLSearchParams(window.location.search);
    params.set("label", label);
    const nextChannel = resolveChannelId(label);
    if (nextChannel === "all") params.delete("channel");
    else params.set("channel", nextChannel);
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
  }, [pathname, resolveChannelId]);

  const replaceUrlWithView = useCallback((viewId: string, label: string, id: string | null) => {
    const params = new URLSearchParams(window.location.search);
    params.set("view", viewId);
    params.set("label", label);
    const nextChannel = resolveChannelId(label);
    if (nextChannel === "all") params.delete("channel");
    else params.set("channel", nextChannel);
    if (id) params.set("id", id);
    else params.delete("id");
    const qs = params.toString();
    const nextUrl = qs ? `${pathname}?${qs}` : `${pathname}`;
    window.history.replaceState(null, "", nextUrl);
  }, [pathname, resolveChannelId]);

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
  const [team, setTeam] = useState<Array<{ email: string; name: string | null }>>(() => initialTeam);

  useEffect(() => {
    let cancelled = false;
    const cancelIdle = scheduleIdleTask(() => {
      void (async () => {
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
    });
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, []);

  // Step 77: /api/mailhub/assignees から名簿を取得（全員ツリー化）
  useEffect(() => {
    let cancelled = false;
    const cancelIdle = scheduleIdleTask(() => {
      void (async () => {
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
    });
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, []);

  const activeLabel = useMemo((): LabelItem | null => {
    for (const group of labelGroups) {
      const hit = group.items.find((item) => item.id === labelId);
      if (hit) return hit;
    }
    return labelGroups[0]?.items[0] ?? null;
  }, [labelId, labelGroups]);

  const activeChannelScope = useMemo(() => {
    if (activeLabel?.type !== "channel") return null;
    return getChannelSourceScope(activeLabel.id, testMode);
  }, [activeLabel?.id, activeLabel?.type, testMode]);

  const listDiagnostics = useMemo(() => {
    return {
      activeLabelId: labelId,
      activeLabelName: activeLabel?.label ?? null,
      activeLabelType: activeLabel?.type ?? null,
      searchQuery: serverSearchQuery || null,
      pageSize: listMax,
      loadedCount: messages.length,
      hasMore: Boolean(nextPageToken),
      isPartial: Boolean(nextPageToken),
      sourceScope: activeChannelScope,
      listError,
    };
  }, [
    activeChannelScope,
    activeLabel?.label,
    activeLabel?.type,
    labelId,
    listError,
    listMax,
    messages.length,
    nextPageToken,
    serverSearchQuery,
  ]);

  // Step 81: slug→displayNameのMapを作成（team名簿から）
  const assigneeDisplayNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of team) {
      const slug = assigneeSlug(m.email);
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
  const selectedAssigneeName = useMemo(
    () => getAssigneeDisplayName(selectedAssigneeSlug),
    [getAssigneeDisplayName, selectedAssigneeSlug],
  );
  const isSelectedMine = selectedAssigneeSlug === myAssigneeSlug;
  const selectedOwnerActionLabel = !selectedAssigneeSlug ? "担当する" : isSelectedMine ? "変更" : "引き継ぐ";
  const selectedOwnerStatusLabel = !selectedAssigneeSlug
    ? "未割当"
    : isSelectedMine
      ? `自分担当: ${selectedAssigneeName ?? "自分"}`
      : `担当: ${selectedAssigneeName ?? "他担当"}`;
  const selectedOwnerActionTitle = !selectedAssigneeSlug
    ? "このメールを担当する"
    : isSelectedMine
      ? "担当者を変更"
      : `自分に引き継ぐ: ${selectedAssigneeName ?? selectedAssigneeSlug}`;
  // Step 114: 他人担当かどうか（担当者がいて、自分ではない）
  const isSelectedOtherAssigned = Boolean(selectedAssigneeSlug && !isSelectedMine);

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

  // Step 114: 選択中に他人担当が含まれるか
  const someSelectedOtherAssigned = useMemo(() => {
    if (selectedIds.length === 0) return false;
    return selectedIds.some((id) => {
      const slug = messages.find((m) => m.id === id)?.assigneeSlug ?? null;
      return slug && slug !== myAssigneeSlug;
    });
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
      // タブフィルタ（今返す/自分が対応/返事待ち/処理不要）
      if (viewTab === "inbox") {
        // 今返すタブ: activeLabelがtodoの場合、またはチャンネルラベルの場合は表示
        // チャンネルラベル（all, store-a, store-b, store-c）の場合はstatusTypeチェックをスキップ
        if (activeLabel?.type !== "channel" && activeLabel?.statusType !== "todo") {
          filtered = [];
        }
      } else if (viewTab === "assigned") {
        // 担当タブ: 自分が担当になっているものだけ表示
        filtered = filtered.filter((m) => m.assigneeSlug === myAssigneeSlug);
      } else if (viewTab === "waiting") {
        // 返事待ちタブ: activeLabelがwaitingの場合のみ表示（loadListでwaitingラベルを読み込んでいるため）
        if (activeLabel?.statusType !== "waiting") {
          filtered = [];
        }
      } else if (viewTab === "muted") {
        // 処理不要タブ: activeLabelがmutedの場合のみ表示（loadListでmutedラベルを読み込んでいるため）
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
    const params = new URLSearchParams(window.location.search);
    setChannelId(resolveChannelId(params.get("channel") ?? labelId));
  }, [labelId, selectedId, serverSearchQuery, replaceUrl, resolveChannelId]);

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
    const cancelIdle = scheduleIdleTask(() => {
      void fetchCounts();
    }, 3_000);
    return cancelIdle;
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
      setOpsReadiness(data.summary?.productionReadiness ?? null);
    } catch (e) {
      console.error("Failed to fetch ops summary:", e);
    }
  }, []);

  const fetchOpsReadiness = useCallback(async () => {
    try {
      const res = await fetch("/api/mailhub/ops/readiness", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("Failed to fetch ops readiness:", data);
        return;
      }
      setOpsReadiness(data.productionReadiness ?? null);
    } catch (e) {
      console.error("Failed to fetch ops readiness:", e);
    }
  }, []);

  useEffect(() => {
    if (!showOpsDrawer) return;
    const timerId = window.setTimeout(() => {
      void fetchOpsSummary();
    }, 200);
    return () => window.clearTimeout(timerId);
  }, [showOpsDrawer, fetchOpsSummary]);

  useEffect(() => {
    const cancelIdle = scheduleIdleTask(() => {
      void fetchOpsReadiness();
    }, 3_000);
    return cancelIdle;
  }, [fetchOpsReadiness]);

  // バージョン情報を取得
  useEffect(() => {
    const cancelIdle = scheduleIdleTask(() => {
      fetch("/api/version")
        .then((res) => res.json())
        .then((data) => setVersion(data.version))
        .catch(() => setVersion(null));
    }, 3_000);
    return cancelIdle;
  }, []);

  // Step 50: キャッシュから古いエントリを削除（LRU）
  const evictOldCacheEntries = useCallback(() => {
    const cache = detailCacheRef.current;
    const now = Date.now();
    const entriesToDelete: string[] = [];
    
    // TTL超過を削除
    for (const [key, entry] of cache.entries()) {
      if (now - entry.fetchedAt > DETAIL_CACHE_TTL_MS) {
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

  const prefetchDetailToCache = useCallback(async (id: string, signal: AbortSignal): Promise<MessageDetail | null> => {
    const cached = detailCacheRef.current.get(id);
    if (cached && Date.now() - cached.fetchedAt < DETAIL_CACHE_TTL_MS) return cached.detail;

    const inFlight = detailPrefetchInFlightRef.current.get(id);
    if (inFlight) return inFlight;

    const promise = (async (): Promise<MessageDetail | null> => {
      const res = await fetch(`/api/mailhub/detail?id=${encodeURIComponent(id)}`, {
        cache: "no-store",
        signal,
      });
      if (!res.ok) return null;

      const data = (await res.json()) as { detail: MessageDetail };
      evictOldCacheEntries();
      detailCacheRef.current.set(id, {
        detail: data.detail,
        fetchedAt: Date.now(),
      });
      cacheSanitizedDetailHtml(data.detail);
      return data.detail;
    })();

    detailPrefetchInFlightRef.current.set(id, promise);
    try {
      return await promise;
    } finally {
      if (detailPrefetchInFlightRef.current.get(id) === promise) {
        detailPrefetchInFlightRef.current.delete(id);
      }
    }
  }, [cacheSanitizedDetailHtml, evictOldCacheEntries]);

  const loadDetailBodyOnly = useCallback(async (id: string, useCache: boolean = true) => {
    // プリフェッチモード（useCache = false）の場合は、detailInFlightIdRefを変更しない
    // これにより、現在選択中のメールのレスポンスが正しく処理される
    const isPrefetch = !useCache;
    let controller: AbortController;
    
    if (isPrefetch) {
      // プリフェッチ：独立したコントローラーを使用（メインのフェッチに干渉しない）
      controller = new AbortController();
    } else {
      // 通常のフェッチ：前のリクエストをキャンセルしてdetailInFlightIdRefを設定
      abortRef.current?.abort();
      controller = new AbortController();
      abortRef.current = controller;
      detailInFlightIdRef.current = id;
    }

    // Step 50: キャッシュから取得を試みる（プリフェッチ以外）
    if (!isPrefetch) {
      const cached = detailCacheRef.current.get(id);
      if (cached) {
        const now = Date.now();
        if (now - cached.fetchedAt < DETAIL_CACHE_TTL_MS) {
          // キャッシュヒット：即座に反映（detailInFlightIdRefと一致する時だけ）
          if (detailInFlightIdRef.current === id) {
            setDetailError(null);
            setSelectedDetail(cached.detail);
            setDetailBody(detailToBodyState(cached.detail));
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
      setDetailBody((b) =>
        b.messageId === id ? { ...b, isLoading: true } : emptyDetailBodyState(id, true),
      );
    }

    const prefetchPromise = !isPrefetch ? detailPrefetchInFlightRef.current.get(id) : null;
    if (prefetchPromise) {
      try {
        const prefetchedDetail = await prefetchPromise;
        if (detailInFlightIdRef.current !== id) return;
        if (prefetchedDetail) {
          setSelectedDetail(prefetchedDetail);
          setDetailBody(detailToBodyState(prefetchedDetail));
          if (prefetchedDetail.isInProgress !== undefined) {
            setIsClaimedMap((prev) => ({ ...prev, [id]: prefetchedDetail.isInProgress ?? false }));
          }
          return;
        }
      } catch {
        if (detailInFlightIdRef.current !== id) return;
        // Prefetch is best-effort. If it was cancelled or failed, fall back to the main detail request.
      }
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
      detailCacheRef.current.set(id, {
        detail: data.detail,
        fetchedAt: Date.now(),
      });

      // detailInFlightIdRef.currentと一致する時だけUIを更新（連続クリック対策）
      // selectedIdはstate更新の遅延があるためdetailInFlightIdRefを使用
      if (detailInFlightIdRef.current === id) {
        setSelectedDetail(data.detail);
        setDetailBody(detailToBodyState(data.detail));
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
      if (selectedIdRef.current === id && detailInFlightIdRef.current === id) {
        setDetailError(errorMessage);
        setDetailBody((b) =>
          b.messageId === id ? { ...b, isLoading: false } : emptyDetailBodyState(id, false),
        );
      }
    }
  }, [evictOldCacheEntries]);

  useEffect(() => {
    if (!selectedId || !selectedMessage || detailError) return;
    if (selectedDetail?.id === selectedId && detailBody.messageId === selectedId && !detailBody.isLoading) return;
    if (detailBody.messageId === selectedId && detailBody.isLoading) return;

    void loadDetailBodyOnly(selectedId);
  }, [
    detailBody.isLoading,
    detailBody.messageId,
    detailError,
    loadDetailBodyOnly,
    selectedDetail?.id,
    selectedId,
    selectedMessage,
  ]);

  useEffect(() => {
    if (!selectedId) return;
    const visibleMessages = slaFilteredMessages.length > 0 ? slaFilteredMessages : messages;
    const selectedIndex = visibleMessages.findIndex((message) => message.id === selectedId);
    if (selectedIndex < 0) return;
    const warmIds = [selectedIndex + 1, selectedIndex + 2, selectedIndex - 1, selectedIndex + 3, selectedIndex - 2]
      .map((index) => visibleMessages[index]?.id)
      .filter((nextId): nextId is string => Boolean(nextId && nextId !== selectedId));
    if (warmIds.length === 0) return;

    const controller = new AbortController();
    const cancelIdle = scheduleIdleTask(() => {
      void (async () => {
        for (let i = 0; i < warmIds.length && !controller.signal.aborted; i += 2) {
          const batch = warmIds.slice(i, i + 2);
          await Promise.allSettled(batch.map((id) => prefetchDetailToCache(id, controller.signal)));
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        }
      })();
    }, 20);

    return () => {
      cancelIdle();
      controller.abort();
    };
  }, [messages, prefetchDetailToCache, selectedId, slaFilteredMessages]);

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
    const messageId = selectedMessage.id;
    threadInFlightRef.current = messageId;
    startTransition(() => {
      setThreadSummary(null);
      setThreadError(null);
      setThreadLoading(false);
      setThreadExpandedIds(new Set());
      setThreadBodies({});
    });
    const timer = window.setTimeout(() => {
      void loadThreadSummary(messageId);
    }, THREAD_LOAD_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [selectedMessage?.id, loadThreadSummary, startTransition]);

  // 返信ルートを判定
  const replyRoute = useMemo(() => {
    if (!selectedMessage || !selectedDetail || selectedDetail.id !== selectedMessage.id) return null;
    if (!selectedDetail.plainTextBody) return null;
    return routeReply(selectedDetail, channelId, testMode);
  }, [selectedMessage, selectedDetail, channelId, testMode]);

  const gmailResolvedContext = useMemo(() => {
    if (replyRoute?.kind !== "gmail" || !selectedMessage || !selectedDetail || selectedDetail.id !== selectedMessage.id) {
      return null;
    }
    return resolveReplyContext(selectedDetail, getSendResolverChannels(testMode), {
      sharedInboxEmail: user.email,
    });
  }, [replyRoute?.kind, selectedMessage, selectedDetail, testMode, user.email]);

  const showGmailComposePanel = Boolean(
    replyRoute?.kind === "gmail" &&
      selectedMessage &&
      selectedDetail &&
      selectedDetail.id === selectedMessage.id &&
      !(gmailResolvedContext?.ok === false && gmailResolvedContext.error === "rakuten_reply_blocked"),
  );

  const gmailReplyOwnershipShield = useMemo(() => {
    if (!showGmailComposePanel || !selectedMessage) return null;
    return evaluateMailhubReplyOwnershipShield({
      actorEmail: user.email,
      actorDisplayName: user.name || user.email.split("@")[0],
      assigneeSlug: selectedAssigneeSlug,
      assigneeDisplayName: selectedAssigneeName,
    });
  }, [selectedAssigneeName, selectedAssigneeSlug, selectedMessage, showGmailComposePanel, user.email, user.name]);

  const selectedAddressContext = useMemo(() => {
    if (!selectedMessage) return null;
    const currentDetail = selectedDetail?.id === selectedMessage.id ? selectedDetail : null;
    const fromEmail = extractFromEmail(selectedMessage.from);
    const senderName = formatAddressDisplayName(selectedMessage.from) ?? "送信者不明";
    const toEmails = collectAddressEmails(
      currentDetail?.deliveredTo,
      currentDetail?.xOriginalTo,
      currentDetail?.to,
      currentDetail?.cc,
      currentDetail?.bcc,
    );
    const channels = testMode ? [...getChannels(true), ...getChannels(false)] : getChannels(false);
    const recipientChannel = channels.find(
      (channel) =>
        channel.id !== "all" &&
        channel.id !== "stores" &&
        channel.addresses.some((address) => toEmails.includes(address.toLowerCase())),
    );
    const channelEmail = recipientChannel?.addresses.find((address) => toEmails.includes(address.toLowerCase()));
    const recipientEmail =
      channelEmail ?? toEmails.find((email) => isInternalRecipientEmail(email)) ?? null;
    const recipientLabel = recipientChannel?.label ?? recipientEmail ?? null;
    const toTitle = joinAddressTitle(recipientEmail, recipientChannel?.label);
    const fromTitle = joinAddressTitle(selectedMessage.from, toTitle ? `To: ${toTitle}` : null);

    return {
      senderName,
      fromEmail,
      fromLabel: fromEmail ?? senderName,
      recipientEmail,
      recipientLabel,
      recipientTitle: toTitle,
      title: fromTitle || fromEmail || "",
    };
  }, [selectedDetail, selectedMessage, testMode]);

  useEffect(() => {
    if (!selectedMessage || !selectedDetail || selectedDetail.id !== selectedMessage.id) {
      setBrainDecision((prev) => (prev.status === "idle" ? prev : { status: "idle", messageId: null }));
      return;
    }

    const messageId = selectedMessage.id;
    const controller = new AbortController();
    setBrainDecision({ status: "loading", messageId });

    void (async () => {
      try {
        const res = await fetch(
          `/api/mailhub/brain?messageId=${encodeURIComponent(messageId)}&channel=${encodeURIComponent(channelId)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = (await res.json().catch(() => ({}))) as {
          decision?: BrainDecisionView;
          error?: string;
          message?: string;
        };
        if (!res.ok || !data.decision) {
          throw new Error(data.message || data.error || `${res.status} ${res.statusText}`);
        }
        if (selectedIdRef.current !== messageId) return;
        setBrainDecision({ status: "ready", messageId, decision: data.decision });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (selectedIdRef.current !== messageId) return;
        setBrainDecision({ status: "error", messageId, message: e instanceof Error ? e.message : String(e) });
      }
    })();

    return () => controller.abort();
  }, [channelId, selectedDetail, selectedMessage]);

  useEffect(() => {
    if (!selectedMessage || !selectedDetail || selectedDetail.id !== selectedMessage.id) {
      setAiDraft((prev) => (prev.status === "idle" ? prev : { status: "idle", messageId: null }));
      return;
    }

    const messageId = selectedMessage.id;
    const controller = new AbortController();
    setAiDraft({ status: "loading", messageId });

    void (async () => {
      try {
        const res = await fetch(
          `/api/mailhub/brain/draft?messageId=${encodeURIComponent(messageId)}&channel=${encodeURIComponent(channelId)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = (await res.json().catch(() => ({}))) as {
          result?: AiDraftResultView;
          error?: string;
          message?: string;
        };
        if (!res.ok || !data.result) {
          throw new Error(data.message || data.error || `${res.status} ${res.statusText}`);
        }
        if (selectedIdRef.current !== messageId) return;
        setAiDraft({ status: "ready", messageId, result: data.result });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (selectedIdRef.current !== messageId) return;
        setAiDraft({ status: "error", messageId, message: e instanceof Error ? e.message : String(e) });
      }
    })();

    return () => controller.abort();
  }, [channelId, selectedDetail, selectedMessage]);

  const gmailUnresolvedVars = useMemo(() => {
    return Array.from(new Set([...(lastAppliedTemplate?.unresolvedVars ?? []), ...extractUnresolvedTemplateVars(replyMessage)]));
  }, [lastAppliedTemplate?.unresolvedVars, replyMessage]);

  const gmailSendDisabledReason = useMemo<GmailComposePanelProps["sendDisabledReason"]>(() => {
    if (readOnlyMode) return "read_only";
    if (gmailSentStatus === "maybe_sent") return "maybe_sent";
    if (!replyMessage.trim()) return "empty_body";
    if ((lastAppliedTemplate?.unresolvedVars.length ?? 0) > 0 || bodyContainsUnresolvedTemplateVar(replyMessage)) {
      return "unresolved_template_vars";
    }
    if (!gmailResolvedContext) return "resolve_failed";
    if (!gmailResolvedContext.ok) return "resolve_failed";
    if (gmailReplyOwnershipShield && !gmailReplyOwnershipShield.ok) return gmailReplyOwnershipShield.reason;
    if (!sendEnabledFromHealth) return "send_disabled";
    if (sendAsAcceptedByAlias[gmailResolvedContext.context.fromAlias.toLowerCase()] !== true) {
      return "send_as_unaccepted";
    }
    return null;
  }, [
    gmailResolvedContext,
    gmailReplyOwnershipShield,
    gmailSentStatus,
    lastAppliedTemplate?.unresolvedVars.length,
    readOnlyMode,
    replyMessage,
    sendAsAcceptedByAlias,
    sendEnabledFromHealth,
  ]);

  const gmailResolveErrorMessage =
    gmailResolvedContext && !gmailResolvedContext.ok ? gmailResolvedContext.message : null;

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

  const startRowPrefetch = useCallback((id: string) => {
    if (id === selectedId) return;
    const cached = detailCacheRef.current.get(id);
    if (cached && Date.now() - cached.fetchedAt < DETAIL_CACHE_TTL_MS) return;

    if (hoverPrefetchAbortRef.current && hoverPrefetchTargetIdRef.current !== id) {
      hoverPrefetchAbortRef.current.abort();
      hoverPrefetchAbortRef.current = null;
    }

    hoverPrefetchTargetIdRef.current = id;
    const controller = new AbortController();
    hoverPrefetchAbortRef.current = controller;

    void prefetchDetailToCache(id, controller.signal).catch(() => {
      // AbortErrorやネットワークエラーは無視（prefetchなので）
    }).finally(() => {
      if (hoverPrefetchAbortRef.current === controller) {
        hoverPrefetchAbortRef.current = null;
      }
      if (hoverPrefetchTargetIdRef.current === id) {
        hoverPrefetchTargetIdRef.current = null;
      }
    });
  }, [prefetchDetailToCache, selectedId]);

  // Step 93: Hover/focus/pointer intent prefetch（クリック直前の体感待ちを減らす）
  const handleRowMouseEnter = useCallback((id: string) => {
    if (id === selectedId) return;
    const cached = detailCacheRef.current.get(id);
    if (cached && Date.now() - cached.fetchedAt < DETAIL_CACHE_TTL_MS) return;

    if (hoverPrefetchTimerRef.current) {
      clearTimeout(hoverPrefetchTimerRef.current);
      hoverPrefetchTimerRef.current = null;
    }

    hoverPrefetchTargetIdRef.current = id;
    hoverPrefetchTimerRef.current = setTimeout(() => {
      hoverPrefetchTimerRef.current = null;
      startRowPrefetch(id);
    }, HOVER_PREFETCH_DELAY_MS);
  }, [selectedId, startRowPrefetch]);

  const handleRowImmediatePrefetch = useCallback((id: string) => {
    if (hoverPrefetchTimerRef.current && hoverPrefetchTargetIdRef.current === id) {
      clearTimeout(hoverPrefetchTimerRef.current);
      hoverPrefetchTimerRef.current = null;
    }
    startRowPrefetch(id);
  }, [startRowPrefetch]);
  
  // Step 93: マウス離脱時にタイマーをキャンセル
  const handleRowMouseLeave = useCallback(() => {
    if (hoverPrefetchTimerRef.current) {
      clearTimeout(hoverPrefetchTimerRef.current);
      hoverPrefetchTimerRef.current = null;
    }
    // 注意: 進行中のリクエストはキャンセルしない（完了させてキャッシュに保存）
  }, []);

  useLayoutEffect(() => {
    detailScrollRef.current?.scrollTo({ top: 0, left: 0 });
  }, [selectedMessage?.id]);

  const onSelectMessage = useCallback((id: string) => {
    if (id === selectedId) return;

    if (hoverPrefetchTimerRef.current) {
      clearTimeout(hoverPrefetchTimerRef.current);
      hoverPrefetchTimerRef.current = null;
    }
    if (hoverPrefetchAbortRef.current && hoverPrefetchTargetIdRef.current !== id) {
      hoverPrefetchAbortRef.current.abort();
      hoverPrefetchAbortRef.current = null;
      hoverPrefetchTargetIdRef.current = null;
    }
    adjacentPrefetchAbortRef.current?.abort();
    adjacentPrefetchAbortRef.current = null;
    
    // Step 50: キャッシュから即座に表示を試みる
    const cached = detailCacheRef.current.get(id);
    const hasFreshCache = cached && Date.now() - cached.fetchedAt < DETAIL_CACHE_TTL_MS;
    const visibleMessages = slaFilteredMessages.length > 0 ? slaFilteredMessages : messages;
    const selectedIndex = visibleMessages.findIndex((m) => m.id === id);
    const adjacentPrefetchIds = selectedIndex >= 0
      ? [selectedIndex + 1, selectedIndex + 2, selectedIndex - 1]
          .map((index) => visibleMessages[index]?.id)
          .filter((nextId): nextId is string => Boolean(nextId && nextId !== id))
      : [];
    abortRef.current?.abort();
    detailInFlightIdRef.current = id;
    selectedIdRef.current = id;
    
    // flushSyncを使って、選択メッセージとタイトルと本文の更新を同期的に行う
    // これにより、連続クリック時にタイトルと本文がずれる問題を防ぐ
    const selectedMsg = messages.find((m) => m.id === id) ?? null;
    detailScrollRef.current?.scrollTo({ top: 0, left: 0 });
    flushSync(() => {
      setSelectedId(id);
      setSelectedMessage(selectedMsg);
      setReplyMessage(""); // 返信メッセージをリセット
      setLastAppliedTemplate(null); // テンプレ適用状態をリセット
      setLastAppliedBrainDraft(null);
      setBodyCollapsed(false); // 本文の折りたたみをリセット
      setDetailError(null);
      setSelectedDetail(null);
      
      if (hasFreshCache && cached) {
        // キャッシュヒット：即座に表示
        setSelectedDetail(cached.detail);
        setDetailBody(detailToBodyState(cached.detail));
      } else {
        // キャッシュがない場合：ローディング状態を表示
        setDetailBody(emptyDetailBodyState(id, true));
      }
    });
    window.requestAnimationFrame(() => {
      if (selectedIdRef.current === id) detailScrollRef.current?.scrollTo({ top: 0, left: 0 });
    });
    
    // バックグラウンドで最新データを取得。キャッシュ表示時はクリック体感を優先して少し遅らせる。
    if (hasFreshCache) {
      window.setTimeout(() => {
        if (selectedIdRef.current === id) void loadDetailBodyOnly(id, false);
      }, DETAIL_CACHE_REFRESH_DELAY_MS);
    } else {
      void loadDetailBodyOnly(id);
    }
    if (adjacentPrefetchIds.length > 0) {
      window.requestAnimationFrame(() => {
        if (selectedIdRef.current !== id) return;
        const controller = new AbortController();
        adjacentPrefetchAbortRef.current = controller;
        void Promise.allSettled(adjacentPrefetchIds.map((nextId) => prefetchDetailToCache(nextId, controller.signal))).finally(() => {
          if (adjacentPrefetchAbortRef.current === controller) {
            adjacentPrefetchAbortRef.current = null;
          }
        });
      });
    }
    // Step 51: 検索クエリをURLに保持（idだけ変える時もqが消えないように）
    replaceUrl(labelId, id, true, serverSearchQuery || undefined);
    
    // Step 105: Seenとして記録
    markAsSeen(id);
  }, [
    labelId,
    loadDetailBodyOnly,
    markAsSeen,
    messages,
    prefetchDetailToCache,
    replaceUrl,
    serverSearchQuery,
    selectedId,
    slaFilteredMessages,
  ]);

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

  const applyRulesBestEffort = useCallback(async (key: string, messageIds: string[]) => {
    if (messageIds.length === 0) return;
    if (!writeGuardReady || readOnlyMode) return;

    const now = Date.now();
    const cooldownUntil = rulesApplyCooldownUntilByKeyRef.current.get(key) ?? 0;
    if (cooldownUntil > now) return;
    if (rulesApplyInFlightKeysRef.current.has(key)) return;

    rulesApplyInFlightKeysRef.current.add(key);
    try {
      const idSet = new Set(messageIds);
      const res = (await postJsonOrThrow("/api/mailhub/rules/apply", {
        messageIds,
        messageSummaries: messages
          .filter((message) => idSet.has(message.id))
          .map((message) => ({
            id: message.id,
            subject: message.subject ?? null,
            from: message.from ?? null,
            snippet: message.snippet ?? null,
            attachmentCount: message.attachmentCount ?? 0,
          })),
      })) as { appliedDetails?: Array<{ id: string; labels: string[] }> };

      const successCooldownMs = testMode ? RULES_APPLY_TEST_COOLDOWN_MS : RULES_APPLY_SUCCESS_COOLDOWN_MS;
      rulesApplyCooldownUntilByKeyRef.current.set(key, Date.now() + successCooldownMs);

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
    } catch (e) {
      if (shouldCooldownRulesApplyFailure(e)) {
        const failureCooldownMs = testMode ? RULES_APPLY_TEST_COOLDOWN_MS : RULES_APPLY_FAILURE_COOLDOWN_MS;
        rulesApplyCooldownUntilByKeyRef.current.set(key, Date.now() + failureCooldownMs);
      }
      // ignore（一覧表示が最優先）
    } finally {
      rulesApplyInFlightKeysRef.current.delete(key);
    }
  }, [messages, readOnlyMode, testMode, writeGuardReady]);

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
    listInFlightRequestIdRef.current = requestId;
    
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
      const data = await fetchJson<MailhubListResponse>(url);
      
      // リクエストIDが変わっていたら無視（レースコンディション対策）
      if (listInFlightRequestIdRef.current !== requestId) return;
      
      // 状態を更新
      setMessages(data.messages);
      setNextPageToken(data.nextPageToken ?? null); // Step 103
      // Channels件数を更新（別画面へ移動しても消えない）
      const nextLabel = labelGroups.flatMap((g) => g.items).find((it) => it.id === nextLabelId);
      if (nextLabel?.type === "channel") {
        setChannelCounts((prev) => ({ ...prev, [nextLabelId]: data.meta?.loadedCount ?? data.messages.length }));
      }

      const nextSelected =
        preferredSelectedId && data.messages.some((m) => m.id === preferredSelectedId)
          ? preferredSelectedId
          : data.messages[0]?.id ?? null;
      setSelectedDetail(null);
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
      } else {
        setSelectedDetail(null);
        setDetailBody(emptyDetailBodyState());
      }
    } catch (e) {
      // リクエストIDが変わっていたら無視
      if (listInFlightRequestIdRef.current !== requestId) return;
      
      const errorMessage = e instanceof Error ? e.message : String(e);
      setListError(errorMessage);
    }
  }, [labelGroups, loadDetailBodyOnly, replaceUrl, replaceUrlWithView, myAssigneeSlug, listMax]);

  const handleRelatedChannelSearch = useCallback((query: string) => {
    const allLabel = labelGroups.flatMap((g) => g.items).find((item) => item.id === "all");
    const nextLabelId = allLabel?.id ?? "all";
    setSearchTerm(query);
    setServerSearchQuery(query);
    setLabelId(nextLabelId);
    setChannelId("all");
    setViewTab("inbox");
    startTransition(async () => {
      try {
        await loadList(nextLabelId, null, { q: query, keepView: false });
        listRef.current?.scrollTo({ top: 0 });
      } catch (e) {
        setListError(e instanceof Error ? e.message : String(e));
      }
    });
  }, [labelGroups, loadList]);

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
      const data = await fetchJson<MailhubListResponse>(url);
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
  useEffect(() => {
    if (messages.length === 0) return;
    if (!writeGuardReady || readOnlyMode) return;

    const key = `${labelId}:${messages.map((m) => m.id).join(",")}`;
    const now = Date.now();
    const cooldownUntil = rulesApplyCooldownUntilByKeyRef.current.get(key) ?? 0;
    if (cooldownUntil > now) return;
    if (rulesApplyInFlightKeysRef.current.has(key)) return;

    const messageIds = messages.map((m) => m.id);
    const cancelIdle = scheduleIdleTask(() => {
      void applyRulesBestEffort(key, messageIds);
    }, 3_500);
    return cancelIdle;
  }, [applyRulesBestEffort, labelId, messages, readOnlyMode, writeGuardReady]);

  const fetchRegisteredLabels = useCallback(async () => {
    try {
      const data = await fetchJson<{ labels: Array<{ labelName: string; displayName?: string; createdAt: string }> }>("/api/mailhub/labels");
      setRegisteredLabels(data.labels ?? []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const cancelIdle = scheduleIdleTask(() => {
      void fetchRegisteredLabels();
    }, 3_000);
    return cancelIdle;
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
    const cancelIdle = scheduleIdleTask(() => {
      void fetchSavedSearches();
    }, 3_000);
    return cancelIdle;
  }, [fetchSavedSearches]);

  useEffect(() => {
    // Settingsはadminのみ表示（サーバ側でも拒否するが、UIでも事故防止）
    // NOTE: TEST_MODEではE2EでSettingsを確実に操作できるように、admin扱いで表示する。
    const cancelIdle = scheduleIdleTask(() => {
      void (async () => {
        try {
          const res = await fetch("/api/mailhub/config/health", { cache: "no-store" });
          const json = (await res.json().catch(() => ({}))) as {
            isAdmin?: boolean;
            readOnly?: boolean;
            gmailModifyEnabled?: boolean | null;
            gmailSendReady?: boolean;
            gmailSendBlockedReason?: GmailSendBlockedReason;
            sendAs?: {
              acceptedAliases?: unknown;
              missingAliases?: unknown;
              checkedAt?: string | null;
            };
          };
          const admin = testMode ? true : json.isAdmin === true;
          setCanOpenSettings(admin);
          setIsAdmin(admin);
          setGmailSendHealth({
            gmailSendReady: json.gmailSendReady === true,
            blockedReason: coerceGmailSendBlockedReason(json.gmailSendBlockedReason ?? (json.gmailSendReady === true ? null : "send_disabled")),
            acceptedAliases: stringArray(json.sendAs?.acceptedAliases),
            missingAliases: stringArray(json.sendAs?.missingAliases),
            checkedAt: typeof json.sendAs?.checkedAt === "string" ? json.sendAs.checkedAt : null,
          });
          const blocked =
            json.readOnly === true
              ? ("read_only" as const)
              : json.gmailModifyEnabled === false
                ? ("insufficient_permissions" as const)
                : null;
          setWriteBlockedReason(blocked);
          setReadOnlyMode(blocked !== null);
          setWriteGuardReady(true);
        } catch {
          setCanOpenSettings(testMode);
          setIsAdmin(testMode);
          setWriteBlockedReason(null);
          setReadOnlyMode(false);
          setWriteGuardReady(false);
        }
      })();
    }, 3_000);
    return cancelIdle;
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
    const cancelIdle = scheduleIdleTask(() => {
      void (async () => {
        try {
          // 取得は軽量化のため max=20（現状UIの表示と一致）。初回操作を塞がないよう小バッチで進める。
          for (let i = 0; i < channelIds.length && !cancelled; i += CHANNEL_COUNT_PREFETCH_BATCH_SIZE) {
            const batchIds = channelIds.slice(i, i + CHANNEL_COUNT_PREFETCH_BATCH_SIZE);
            const results = await Promise.all(
              batchIds.map(async (id) => {
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
            await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
          }
        } catch {
          // ignore（表示が消えないことが最優先。失敗時は現状維持）
        }
      })();
    }, 3_500);

    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [testMode, labelGroups, channelCounts]);

  // 初期化時にメールが空の場合、loadListを呼ぶ（loadList定義後に配置）
  useEffect(() => {
    if (
      !initialEmptyLoadAttemptedRef.current &&
      messages.length === 0 &&
      initialMessages.length === 0 &&
      !listError &&
      !isPending
    ) {
      initialEmptyLoadAttemptedRef.current = true;
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
    const nextChannelId = resolveChannelId(item.id);
    // 同じラベルでも再読み込みする（リストが更新されない問題を修正）
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("assignee");
      if (nextChannelId === "all") url.searchParams.delete("channel");
      else url.searchParams.set("channel", nextChannelId);
      window.history.replaceState({}, "", url.toString());
    }
    setLabelId(item.id);
    setActiveViewId(null);
    // Step 64: Team View をクリア
    setActiveAssigneeSlug(null);
    
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
    setChannelId(nextChannelId);
    
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
  }, [loadList, resolveChannelId]);

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
    const memberSlug = assigneeSlug(email);
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
        rulesApplyCooldownUntilByKeyRef.current.delete(`${labelId}:${messages.map((m) => m.id).join(",")}`);
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
    labelId,
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
    setUndoStack((prev) => [{ ...item, createdAt: Date.now() }, ...prev].slice(0, 10)); // 最大10件まで保持
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
        setDetailBody(emptyDetailBodyState());
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
      showToast("対応済みにしました", "success");
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

  const markDoneWithUndo = useCallback(async (
    id: string,
    options: { skipApi: boolean },
  ): Promise<{ ok: true } | { ok: false; message: string }> => {
    if (actionInProgress.has(id)) return { ok: false, message: "処理中です" };
    setActionInProgress((prev) => new Set(prev).add(id));

    const targetMessage = messages.find((m) => m.id === id);
    if (!targetMessage) {
      setActionInProgress((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      return { ok: false, message: "メールが見つかりませんでした" };
    }

    const fromStatus = activeLabel?.statusType ?? "todo";
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
    const previousMessages = [...messages];
    const previousSelectedMessage = selectedMessage;
    const shouldRemoveFromCurrentList = viewTab !== "assigned";

    bumpCounts(delta);
    setFlashingIds((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setFlashingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 100);
    if (shouldRemoveFromCurrentList) {
      setRemovingIds((prev) => new Set(prev).add(id));
    }
    setGlowTab("done");
    setTimeout(() => setGlowTab(null), 1000);

    if (shouldRemoveFromCurrentList) {
      const currentIndex = previousMessages.findIndex((m) => m.id === id);
      const newMessages = previousMessages.filter((m) => m.id !== id);
      setMessages(newMessages);
      const nextMessage = newMessages[currentIndex] ?? newMessages[currentIndex - 1] ?? newMessages[0] ?? null;
      if (nextMessage) {
        onSelectMessage(nextMessage.id);
      } else {
        setSelectedId(null);
        setSelectedMessage(null);
        setSelectedDetail(null);
        setDetailBody(emptyDetailBodyState());
        replaceUrl(labelId, null);
      }
    }

    setTimeout(() => {
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 200);

    try {
      if (!options.skipApi) {
        await postJsonOrThrow("/api/mailhub/archive", { id, action: "archive" });
      }
      addToUndoStack({ id, message: targetMessage, action: "archive" });
      void fetchCountsDebounced();
      return { ok: true };
    } catch (e) {
      bumpCounts(inverseDelta);
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setMessages(previousMessages);
      setSelectedId(id);
      setSelectedMessage(previousSelectedMessage ?? targetMessage);
      const errorMessage = e instanceof Error ? e.message : String(e);
      return { ok: false, message: errorMessage };
    } finally {
      setActionInProgress((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [
    actionInProgress,
    activeLabel?.statusType,
    addToUndoStack,
    bumpCounts,
    fetchCountsDebounced,
    labelId,
    messages,
    onSelectMessage,
    replaceUrl,
    selectedMessage,
    viewTab,
  ]);

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
        setDetailBody(emptyDetailBodyState());
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
        showToast(isCurrentlyWaiting ? "今返すに戻しました" : "返事待ちにしました", "success");
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

    // 処理不要に移動すると、基本的には一覧から消える（assignedビューのみ維持）
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
        setDetailBody(emptyDetailBodyState());
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
    
    // Glow effect（処理不要タブ）
    setGlowTab("muted");
    setTimeout(() => setGlowTab(null), 1000);

    try {
      await postJsonOrThrow("/api/mailhub/mute", { id, action: "mute" });
      addToUndoStack({ id, message: targetMessage, action: "mute" });
      showToast("処理不要に移動しました", "success");
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

  const openSenderMutePreview = useCallback(async () => {
    if (readOnlyMode) {
      showToast(getWriteBlockedTitle() ?? "実行できません", "error");
      return;
    }
    if (!selectedMessage) return;
    const fromEmail = extractFromEmail(selectedMessage.from);
    if (!fromEmail) {
      showToast("送信元メールアドレスを取得できません", "error");
      return;
    }

    setSenderMutePreview({
      fromEmail,
      messages: [],
      protectedCount: 0,
      missingSummaryCount: 0,
      notNoiseCount: 0,
      warningCount: 0,
      isLoading: true,
      isExecuting: false,
      error: null,
    });
    try {
      const params = new URLSearchParams();
      const scopeLabel = activeLabel?.type === "channel" ? labelId : "all";
      const targetStatus = activeLabel?.statusType === "waiting" ? "waiting" : "todo";
      params.set("label", scopeLabel);
      params.set("max", "50");
      params.set("statusType", targetStatus);
      params.set("q", `from:${fromEmail}`);
      const data = await fetchJson<{ messages: InboxListMessage[] }>(`/api/mailhub/list?${params.toString()}`);
      const seen = new Set<string>();
      const candidates = data.messages.filter((message) => {
        if (seen.has(message.id)) return false;
        seen.add(message.id);
        return true;
      });
      if (candidates.length === 0) {
        setSenderMutePreview({
          fromEmail,
          messages: [],
          protectedCount: 0,
          missingSummaryCount: 0,
          notNoiseCount: 0,
          warningCount: 0,
          isLoading: false,
          isExecuting: false,
          error: null,
        });
        return;
      }
      const preview = await postJsonOrThrow<NoisePreviewResponse>("/api/mailhub/noise/preview", {
        messageIds: candidates.map((message) => message.id),
      });
      if (!preview) throw new Error("preview_failed");
      setSenderMutePreview({
        fromEmail,
        messages: preview.safeCandidates,
        protectedCount: preview.protected.length,
        missingSummaryCount: preview.missingSummary.length,
        notNoiseCount: preview.notNoise.length,
        warningCount: preview.warnings.length,
        isLoading: false,
        isExecuting: false,
        error: null,
      });
    } catch (e) {
      setSenderMutePreview({
        fromEmail,
        messages: [],
        protectedCount: 0,
        missingSummaryCount: 0,
        notNoiseCount: 0,
        warningCount: 0,
        isLoading: false,
        isExecuting: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }, [activeLabel?.statusType, activeLabel?.type, getWriteBlockedTitle, labelId, readOnlyMode, selectedMessage, showToast]);

  const executeSenderMutePreview = useCallback(async () => {
    if (!senderMutePreview || senderMutePreview.isExecuting || senderMutePreview.messages.length === 0) return;
    const ids = senderMutePreview.messages.map((message) => message.id);
    setSenderMutePreview((prev) => (prev ? { ...prev, isExecuting: true, error: null } : prev));

    const result = await postJsonOrThrow<NoiseApplyResponse>("/api/mailhub/noise/apply", {
      messageIds: ids,
      fromEmail: senderMutePreview.fromEmail,
    }).catch((e) => {
      setSenderMutePreview((prev) =>
        prev ? { ...prev, isExecuting: false, error: e instanceof Error ? e.message : String(e) } : prev,
      );
      showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
      return null;
    });
    if (!result) return;

    if (result.failedCount > 0) {
      const firstError = result.failed[0]?.error ?? "unknown_error";
      setSenderMutePreview((prev) =>
        prev ? { ...prev, isExecuting: false, error: `${result.failedCount}件を処理不要にできませんでした: ${firstError}` } : prev,
      );
      showToast(`${result.failedCount}件を処理不要にできませんでした`, "error");
      void fetchCountsDebounced();
      return;
    }

    if (result.mutedCount === 0) {
      setSenderMutePreview((prev) =>
        prev ? { ...prev, isExecuting: false, error: "安全に処理不要へ移動できるメールはありませんでした" } : prev,
      );
      showToast("安全に処理不要へ移動できるメールはありませんでした", "error");
      return;
    }

    setSenderMutePreview(null);
    const skippedSuffix = result.skippedCount > 0 ? `（${result.skippedCount}件は保護/対象外）` : "";
    showToast(`${result.mutedCount}件を処理不要に移動しました${skippedSuffix}`, "success");
    void fetchCountsDebounced();
    await loadList(labelId, null, { q: serverSearchQuery || undefined });
  }, [fetchCountsDebounced, labelId, loadList, senderMutePreview, serverSearchQuery, showToast]);

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
      
      showToast(`返信完了（${status === "done" ? "対応済み" : status === "waiting" ? "返事待ち" : "処理不要"}）`, "success");
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
        setDetailBody(emptyDetailBodyState());
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
        showToast(`指定日に戻す設定にしました（${until}まで）`, "success");
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
        setDetailBody(emptyDetailBodyState());
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

  // Step 114: targetIds引数を追加して、ツールバーから直接呼び出し可能に
  const handleAssigneeSelect = useCallback(async (assigneeEmail: string | null, handoffNote?: string, reason?: string, targetIds?: string[]) => {
    // targetIdsが渡されたらそれを使い、なければ状態変数から取得
    const ids = targetIds && targetIds.length > 0 ? targetIds : (assigneeSelectorBulkIds.length > 0 ? assigneeSelectorBulkIds : (assigneeSelectorMessageId ? [assigneeSelectorMessageId] : []));
    if (ids.length === 0) return;

    // Step 91: takeover判定（「他人担当」からの変更のみ理由必須）
    if (ids.length === 1 && assigneeEmail) {
      const messageId = ids[0];
      const targetMessage = messages.find((m) => m.id === messageId);
      const mySlug = assigneeSlug(user.email);
      // 既に担当者がいて、かつ「自分以外」担当からの変更なら takeover
      if (
        targetMessage?.assigneeSlug &&
        targetMessage.assigneeSlug !== mySlug &&
        targetMessage.assigneeSlug !== assigneeSlug(assigneeEmail)
      ) {
        // reasonが未入力の場合、理由入力モーダルを表示
        if (!reason) {
          setPendingReasonModal({
            action: "takeover",
            messageId,
            assigneeEmail,
            handoffNote,
            source:
              selectedMessage?.id === messageId && showGmailComposePanel && replyRoute?.kind === "gmail"
                ? "gmail_reply"
                : "assignee_picker",
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
        const shouldForceAssign =
          Boolean(assigneeEmail) &&
          Boolean(targetMessage.assigneeSlug) &&
          targetMessage.assigneeSlug !== newAssigneeSlug;
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
              force: assigneeEmail ? shouldForceAssign : false,
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
  }, [
    actionInProgress,
    assigneeSelectorBulkIds,
    assigneeSelectorMessageId,
    messages,
    selectedMessage,
    showGmailComposePanel,
    replyRoute?.kind,
    showToast,
    fetchCountsDebounced,
    addToUndoStack,
    user.email,
  ]);

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
          setDetailBody(emptyDetailBodyState());
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
          showToast(`${successIds.length}件を対応済みにしました`, "success");
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
      const startedAt = Date.now();
      setBulkProgress({ current: 0, total: ids.length });
      const result = await postJsonOrThrow<NoiseApplyResponse>("/api/mailhub/noise/apply", { messageIds: ids });
      if (!result) throw new Error("noise_apply_failed");
      setBulkProgress({ current: ids.length, total: ids.length });
      const elapsed = Date.now() - startedAt;
      if (elapsed < 300) {
        await new Promise((r) => setTimeout(r, 300 - elapsed));
      }
      setBulkProgress(null);

      const successIds = result.muted.map((item) => item.id);
      const failedIds = result.failed.map((item) => item.id);
      const failedMessages = failedIds.map((id) => {
        const msg = messages.find((m) => m.id === id);
        return { id, subject: msg?.subject || id };
      });
      const skippedCount = result.skipped.length;
      if (successIds.length > 0) {
        addToUndoStack({
          action: "bulkMute",
          ids: successIds,
          messages: messages.filter((m) => successIds.includes(m.id)),
        });
      }

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
              setDetailBody(emptyDetailBodyState());
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
      } else if (successIds.length === 0 && skippedCount > 0) {
        showToast(`${skippedCount}件は保護/対象外のため処理不要にしませんでした`, "info");
      } else {
        // すべて成功した場合も選択状態を維持（要件4）
        // setCheckedIds(new Set());
        const skippedSuffix = skippedCount > 0 ? `（${skippedCount}件は保護/対象外）` : "";
        showToast(`${successIds.length}件を処理不要に移動しました${skippedSuffix}`, "success");
      }
    } catch (e) {
      setBulkProgress(null);
      showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }, [activeLabel?.statusType, addToUndoStack, bumpCounts, messages, selectedId, onSelectMessage, showToast, fetchCountsDebounced, labelId, bulkProgress, replaceUrl]);

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
              setDetailBody(emptyDetailBodyState());
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
        showToast(isCurrentlyWaiting ? `${successIds.length}件を今返すに戻しました` : `${successIds.length}件を返事待ちにしました`, "success");
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

    const labelIdAtAction = labelId;
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
      if (labelIdRef.current !== labelIdAtAction) return;
      setRemovingIds((prev) => new Set(prev).add(id));
    }, 150);
    
    // Glow effect（未対応へ戻る）
    setGlowTab("todo");
    setTimeout(() => setGlowTab(null), 1500);

    // アニメーション後に削除
    setTimeout(() => {
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (labelIdRef.current !== labelIdAtAction) return;
      const newMessages = messages.filter((m) => m.id !== id);
      setMessages(newMessages);

      const currentIndex = previousMessages.findIndex((m) => m.id === id);
      const nextMessage = newMessages[currentIndex] ?? newMessages[currentIndex - 1] ?? newMessages[0];
      if (nextMessage) {
        onSelectMessage(nextMessage.id);
      } else {
        setSelectedId(null);
        setSelectedMessage(null);
        setDetailBody(emptyDetailBodyState());
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
    
    const result = await postJsonOrThrow<NoiseApplyResponse>("/api/mailhub/noise/apply", {
      messageIds: candidates.map((msg) => msg.id),
    });
    if (!result) throw new Error("noise_apply_failed");
    const successIds = result.muted.map((item) => item.id);
    const failedIds = result.failed.map((item) => item.id);
    const skippedCount = result.skipped.length;

    if (successIds.length > 0) {
      addToUndoStack({
        action: "bulkMute",
        ids: successIds,
        messages: candidates.filter((msg) => successIds.includes(msg.id)),
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
            setDetailBody(emptyDetailBodyState());
            replaceUrl(labelId, null);
          }
        }
      }, 500);
      
      void fetchCountsDebounced();
    }

    if (failedIds.length > 0) {
      showToast(`${successIds.length}件処理完了。${failedIds.length}件失敗しました`, "error");
    } else if (successIds.length === 0 && skippedCount > 0) {
      showToast(`${skippedCount}件は保護/対象外のため処理不要にしませんでした`, "info");
    } else {
      const skippedSuffix = skippedCount > 0 ? `（${skippedCount}件は保護/対象外）` : "";
      showToast(`${successIds.length}件を処理不要に移動しました${skippedSuffix}`, "success");
    }
  }, [triageCandidates, messages, selectedId, onSelectMessage, showToast, fetchCountsDebounced, addToUndoStack, labelId, replaceUrl]);

  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0) return;
    
    // スタックから最新の操作を取り出す
    const latestUndo = undoStack[0];

    if (Date.now() - latestUndo.createdAt > UNDO_TTL_MS) {
      setUndoStack((prev) => prev.slice(1));
      showToast("Undoの期限が切れました", "info");
      return;
    }
    
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
        flushSync(() => {
          setMessages((prev) => {
            // 既に存在する場合は追加しない
            if (prev.some((m) => m.id === id)) return prev;
            return [message, ...prev];
          });
          setSelectedId(id);
          setSelectedMessage(message);
          setReplyMessage("");
          setLastAppliedTemplate(null);
          setLastAppliedBrainDraft(null);
          setBodyCollapsed(false);
          setDetailError(null);
          setDetailBody(emptyDetailBodyState(id, true));
        });
        replaceUrl(labelId, id);
        void loadDetailBodyOnly(id);
      }
      
      showToast("元に戻しました", "success");
      void fetchCountsDebounced();
    } catch (e) {
      // エラー時はスタックに戻す
      setUndoStack((prev) => [latestUndo, ...prev]);
      showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
      reloadCurrentList();
    }
  }, [undoStack, UNDO_TTL_MS, serverSearchQuery, labelId, showToast, fetchCountsDebounced, reloadCurrentList, loadList, handleUnassign, handleAssign, replaceUrl, loadDetailBodyOnly]);

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
        showToast(data.message || "RMS APIは直接送信できません。RMSを開いて手動で返信してください。", "error");
      } else {
        throw new Error(data.error || "返信に失敗しました");
      }
    } catch (e) {
      showToast(`エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setIsSendingReply(false);
    }
  }, [selectedMessage, replyRoute, replyInquiryNumber, replyMessage, showToast, handleSetWaiting]);

  const handleGmailCancel = useCallback(() => {
    setReplyMessage("");
    setLastAppliedBrainDraft(null);
    setGmailSendError(null);
    setGmailSentStatus("idle");
    setGmailClientRequestId(selectedMessage?.id ? createClientRequestId() : null);
  }, [selectedMessage?.id]);

  const handleGmailTakeOwnership = useCallback(() => {
    if (!selectedMessage?.id) return;
    if (readOnlyMode) {
      showToast("READ ONLYのため担当変更できません", "error");
      return;
    }
    void handleAssigneeSelect(user.email, undefined, undefined, [selectedMessage.id]);
  }, [handleAssigneeSelect, readOnlyMode, selectedMessage?.id, showToast, user.email]);

  const handleGmailSend = useCallback(async (postSendAction: PostSendAction) => {
    if (!selectedMessage || !selectedDetail || replyRoute?.kind !== "gmail") return;

    if (readOnlyMode) {
      showToast("READ ONLYのため送信できません", "error");
      return;
    }
    if ((lastAppliedTemplate?.unresolvedVars.length ?? 0) > 0 || bodyContainsUnresolvedTemplateVar(replyMessage)) {
      setGmailSendError("未解決の変数があります");
      showToast("未解決の変数があります", "error");
      return;
    }
    if (!replyMessage.trim()) {
      setGmailSendError("本文を入力してください");
      return;
    }
    if (!gmailResolvedContext?.ok) {
      const message = gmailResolvedContext?.message ?? "返信先を解決できませんでした";
      setGmailSendError(message);
      return;
    }
    if (gmailReplyOwnershipShield && !gmailReplyOwnershipShield.ok) {
      setGmailSendError(gmailReplyOwnershipShield.message);
      showToast(gmailReplyOwnershipShield.message, "error");
      return;
    }
    if (!sendEnabledFromHealth) {
      setGmailSendError("Gmail送信はまだ有効化されていません");
      return;
    }
    if (sendAsAcceptedByAlias[gmailResolvedContext.context.fromAlias.toLowerCase()] !== true) {
      setGmailSendError("このFromはGmail send-asで未承認です");
      return;
    }
    if (isSendingGmailReply || gmailSentStatus !== "idle") return;

    const requestId = gmailClientRequestId ?? createClientRequestId();
    setGmailClientRequestId(requestId);
    setIsSendingGmailReply(true);
    setGmailSendError(null);

    try {
      const res = await fetch("/api/mailhub/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId: selectedMessage.id,
          bodyText: replyMessage,
          clientRequestId: requestId,
          postSendAction,
          templateId: lastAppliedTemplate?.id ?? null,
          templateTitle: lastAppliedTemplate?.title ?? null,
          aiDraftId: lastAppliedBrainDraft?.id ?? null,
          aiDraftTitle: lastAppliedBrainDraft?.title ?? null,
          aiDraftSource: lastAppliedBrainDraft?.source ?? null,
          aiDraftBodyHash: lastAppliedBrainDraft?.bodyHash ?? null,
          aiDraftInputHash: lastAppliedBrainDraft?.inputHash ?? null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as MailhubSendSuccessResponse | MailhubSendErrorResponse;
      if (!res.ok || data.ok !== true) {
        const errorData = data as MailhubSendErrorResponse;
        const message = errorData.message || errorData.error || `${res.status} ${res.statusText}`;
        if (res.status === 409 && errorData.error === "duplicate_send") {
          setGmailSentStatus("maybe_sent");
          setGmailSendError(MAYBE_SENT_MESSAGE);
          showToast(MAYBE_SENT_MESSAGE, "info");
          return;
        }
        if (
          res.status === 409 &&
          (errorData.error === "reply_lock_required" || errorData.error === "reply_locked_by_other")
        ) {
          setGmailSendError(message);
          showToast(message, "error");
          return;
        }
        throw new Error(message);
      }

      if (data.auditWarning === true) {
        console.warn("mailhub send audit warning", {
          messageId: data.messageId,
          clientRequestId: data.clientRequestId,
          status: data.status,
        });
      }

      setGmailSentStatus(data.status);
      setGmailClientRequestId(null);

      if (data.status === "sent_and_done") {
        const doneResult = await markDoneWithUndo(selectedMessage.id, { skipApi: true });
        if (doneResult.ok) {
          showToast("送信しました。Doneは元に戻せます", "success");
        } else {
          console.warn("mailhub sent_and_done local Done sync failed", {
            messageId: selectedMessage.id,
            reason: doneResult.message,
          });
          showToast("送信しました。Doneにしました", "success");
        }
        return;
      }

      if (data.status === "sent_but_not_done") {
        showToast("送信しましたがDoneにできませんでした。手動で完了してください", "error");
        return;
      }

      showToast("送信しました（送信は取り消せません）", "success");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setGmailSendError(message);
      showToast(`送信できませんでした: ${message}`, "error");
      setGmailClientRequestId(requestId);
    } finally {
      setIsSendingGmailReply(false);
    }
  }, [
    gmailClientRequestId,
    gmailReplyOwnershipShield,
    gmailResolvedContext,
    gmailSentStatus,
    isSendingGmailReply,
    lastAppliedBrainDraft?.bodyHash,
    lastAppliedBrainDraft?.id,
    lastAppliedBrainDraft?.inputHash,
    lastAppliedBrainDraft?.source,
    lastAppliedBrainDraft?.title,
    lastAppliedTemplate?.id,
    lastAppliedTemplate?.title,
    lastAppliedTemplate?.unresolvedVars.length,
    markDoneWithUndo,
    readOnlyMode,
    replyMessage,
    replyRoute?.kind,
    selectedDetail,
    selectedMessage,
    sendAsAcceptedByAlias,
    sendEnabledFromHealth,
    showToast,
  ]);

  const handleInsertBrainDraft = useCallback((draft: AiDraftSuggestionView) => {
    if (!selectedMessage) return;
    if (readOnlyMode) {
      showToast("READ ONLYのためAI下書きを挿入できません", "error");
      return;
    }

    setReplyMessage((prev) => {
      const sep = prev.trim() ? "\n\n" : "";
      return `${prev}${sep}${draft.body}`;
    });
    setLastAppliedTemplate(null);
    setLastAppliedBrainDraft({
      id: draft.id,
      title: draft.title,
      source: draft.source,
      bodyHash: draft.bodyHash,
      inputHash: draft.inputHash,
    });
    setGmailSendError(null);
    showToast("AI下書きを返信欄に挿入しました", "success");
  }, [readOnlyMode, selectedMessage, showToast]);

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
      label: "設定を開く",
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
      label: "未割当を取る",
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
      // リストリサイズ: 広幅では一覧を主に伸ばし、詳細本文の作業幅は安定させる
      const sidebarAndPadding = sidebarWidth + 16; // sidebar + main area padding
      const newWidth = Math.min(Math.max(e.clientX - sidebarAndPadding, 320), 900);
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

  const pendingReasonContext = useMemo(() => {
    if (!pendingReasonModal) return null;

    const targetMessage =
      messages.find((m) => m.id === pendingReasonModal.messageId) ??
      (selectedMessage?.id === pendingReasonModal.messageId ? selectedMessage : null);
    const currentOwnerName = getAssigneeDisplayName(targetMessage?.assigneeSlug ?? null) ?? "他担当";
    const nextOwnerSlug = pendingReasonModal.assigneeEmail ? assigneeSlug(pendingReasonModal.assigneeEmail) : null;
    const nextOwnerName = getAssigneeDisplayName(nextOwnerSlug) ?? pendingReasonModal.assigneeEmail ?? "未指定";
    const nextOwnerLabel = nextOwnerSlug === myAssigneeSlug ? `自分 (${nextOwnerName})` : nextOwnerName;

    return {
      currentOwnerName,
      nextOwnerLabel,
      subject: targetMessage?.subject ?? "選択中のメール",
      isGmailReply: pendingReasonModal.source === "gmail_reply",
    };
  }, [getAssigneeDisplayName, messages, myAssigneeSlug, pendingReasonModal, selectedMessage]);

  const selectedWorkContext = useMemo(() => {
    if (!selectedMessage) return null;

    const statusType = (() => {
      if (activeLabel?.statusType) return activeLabel.statusType;
      if (viewTab === "waiting") return "waiting";
      if (viewTab === "muted") return "muted";
      if (viewTab === "snoozed") return "snoozed";
      return "todo";
    })();
    const statusLabel =
      statusType === "waiting"
        ? "返事待ち"
        : statusType === "muted"
          ? "処理不要"
          : statusType === "done"
            ? "対応済み"
            : statusType === "snoozed"
              ? "スヌーズ"
              : viewTab === "assigned"
                ? "自分が対応"
                : "今返す";
    const elapsedMs = getElapsedMs(selectedMessage.receivedAt);
    const slaLevel = getSlaLevel({ statusType, receivedAtIso: selectedMessage.receivedAt });
    const ownerLabel = selectedAssigneeName ?? "未割当";
    const ownerState = selectedAssigneeSlug
      ? isSelectedMine
        ? "自分"
        : "他担当"
      : "未割当";
    const ownerTone = selectedAssigneeSlug
      ? isSelectedMine
        ? "border-[#d2e3fc] bg-[#e8f0fe] text-[#1a73e8]"
        : "border-[#fdd663] bg-[#fef7e0] text-[#92400e]"
      : "border-[#dadce0] bg-white text-[#5f6368]";
    const routeLabel =
      !selectedDetail || selectedDetail.id !== selectedMessage.id
        ? "返信経路を判定中"
        : replyRoute?.kind === "rakuten_rms"
          ? "楽天RMS"
          : replyRoute?.kind === "gmail"
            ? "Gmail返信"
            : "返信先確認";
    const routeTitle = replyRoute?.kind === "rakuten_rms" && replyRoute.inquiryId
      ? `楽天RMS #${replyRoute.inquiryId}`
      : routeLabel;
    const routeTone =
      replyRoute?.kind === "rakuten_rms"
        ? "border-[#fdd663] bg-[#fef7e0] text-[#92400e]"
        : replyRoute?.kind === "gmail"
          ? "border-[#c8e6c9] bg-[#e6f4ea] text-[#137333]"
          : "border-[#dadce0] bg-white text-[#5f6368]";
    const slaTone =
      slaLevel === "critical"
        ? "border-[#f4b4ae] bg-[#fce8e6] text-[#a50e0e]"
        : slaLevel === "warn"
          ? "border-[#fdd663] bg-[#fef7e0] text-[#92400e]"
          : "border-[#dadce0] bg-white text-[#5f6368]";
    const scopeLabel = activeChannelScope?.channel.label ?? activeLabel?.label ?? "現在の一覧";
    const recipientLabel = selectedAddressContext?.recipientLabel ? `宛先 ${selectedAddressContext.recipientLabel}` : null;
    const scopeTitle = joinAddressTitle(
      scopeLabel,
      selectedAddressContext?.recipientTitle ? `宛先: ${selectedAddressContext.recipientTitle}` : null,
    );

    return {
      statusLabel,
      scopeLabel,
      scopeDisplayLabel: recipientLabel ?? scopeLabel,
      scopeTitle,
      recipientLabel,
      recipientEmail: selectedAddressContext?.recipientEmail ?? null,
      ownerLabel,
      ownerState,
      ownerTone,
      routeLabel,
      routeTitle,
      routeTone,
      slaLabel: `${formatElapsedTime(elapsedMs)}経過`,
      slaTone,
      receivedAt: selectedMessage.receivedAt,
    };
  }, [
    activeChannelScope?.channel.label,
    activeLabel?.label,
    activeLabel?.statusType,
    isSelectedMine,
    replyRoute?.inquiryId,
    replyRoute?.kind,
    selectedAddressContext?.recipientEmail,
    selectedAddressContext?.recipientLabel,
    selectedAddressContext?.recipientTitle,
    selectedAssigneeName,
    selectedAssigneeSlug,
    selectedDetail,
    selectedMessage,
    viewTab,
  ]);

  const selectedListBasisPx = Math.max(listWidth, 480);
  const selectedDetailBasis = `min(872px, max(460px, calc(100vw - ${sidebarWidth + selectedListBasisPx}px)))`;

  return (
    <div
      className={`w-full h-full min-h-0 overflow-hidden ${t.bg} flex flex-col font-sans`}
      data-mailhub-client-ready={isClientReady ? "true" : "false"}
    >
      <div className="flex min-h-0 flex-1 overflow-hidden">
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
        <div className="flex min-h-0 flex-1 flex-col min-w-0 overflow-hidden">
          
          {/* ヘッダー（検索バー） */}
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
              replaceUrl(labelId, selectedId, true, "");
              startTransition(async () => {
                try {
                  await loadList(labelId, selectedId, { q: "" });
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

          <OperationalStatusStrip
            readOnlyMode={readOnlyMode}
            writeGuardReady={writeGuardReady}
            mailhubEnv={mailhubEnv}
            testMode={testMode}
            statusCounts={statusCounts}
            activeLabel={activeLabel}
            activeChannelScope={activeChannelScope}
            selectedMessage={selectedMessage}
            selectedAssigneeName={selectedAssigneeName}
            productionReadiness={opsReadiness}
            onOpenOps={() => setShowOpsDrawer(true)}
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
                  replaceUrl(labelId, selectedId, true, "");
                  startTransition(async () => {
                    try {
                      await loadList(labelId, selectedId, { q: "" });
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
            testMode={testMode}
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
            listDiagnostics={listDiagnostics}
          />

          <HelpDrawer
            open={showHelpDrawer}
            onClose={() => setShowHelpDrawer(false)}
            readOnlyMode={readOnlyMode}
            isAdmin={isAdmin}
            listDiagnostics={listDiagnostics}
            onShowOnboarding={() => setShowOnboarding(true)}
          />

          {showOnboarding && (
            <OnboardingModal onClose={() => setShowOnboarding(false)} />
          )}

          {/* ツールバー（アクションボタン群） */}
          <div className={t.toolbar} data-testid="toolbar">
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <button
                data-testid="toolbar-take-next"
                onClick={() => {
                  void handleTakeNext();
                }}
                className={`${t.toolbarButton} min-w-[44px] xl:min-w-[112px] justify-center bg-[#1a73e8] text-white hover:bg-[#1557b0] hover:text-white ${(isActionInProgress || bulkProgress) ? "opacity-60" : ""}`}
                title={readOnlyMode ? (getWriteBlockedTitle() ?? "実行できません") : "誰かが取るメールを自分の対応にして開く"}
                disabled={readOnlyMode || isActionInProgress || bulkProgress !== null}
              >
                <Zap size={18} className="text-white" />
                <span className="hidden xl:inline">未割当を取る</span>
              </button>

              <div className="w-px h-5 bg-[#dadce0] mx-1"></div>

              {/* 選択状態表示（常にスペースを確保してボタンが動かないようにする） */}
              <span className="text-[13px] text-[#3c4043] mr-1 font-normal flex-shrink-0 min-w-[48px] text-right" data-testid="bulk-selection-count">
                {checkedIds.size > 0 ? `${checkedIds.size}件選択中` : '\u00A0'}
              </span>

              {/* 作業アクション */}
              <button 
                data-testid="action-done"
                onClick={() => {
                  if (checkedIds.size > 0) {
                    handleBulkDone(Array.from(checkedIds));
                  } else if (selectedId) {
                    handleArchive(selectedId);
                  }
                }}
                className={`${t.toolbarButton} min-w-[44px] xl:min-w-[76px] justify-center ${(isActionInProgress || bulkProgress) ? "opacity-60" : ""}`}
                title={readOnlyMode ? (getWriteBlockedTitle() ?? "実行できません") : "対応済みにする"}
                disabled={readOnlyMode || (!selectedId && checkedIds.size === 0) || isActionInProgress || bulkProgress !== null}
              >
                {(isActionInProgress || bulkProgress) ? (
                  <span className="action-spinner" data-testid="action-spinner" />
                ) : (
                  <CheckCircle size={20} className={checkedIds.size > 0 || selectedId ? "text-[#34a853]" : "text-[#5f6368]"} />
                )}
                <span className="hidden xl:inline">{(isActionInProgress || bulkProgress) ? "処理中" : "対応済み"}</span>
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
                className={`${t.toolbarButton} min-w-[44px] xl:min-w-[76px] justify-center ${(isActionInProgress || bulkProgress) ? "opacity-60" : ""}`}
                title={readOnlyMode ? (getWriteBlockedTitle() ?? "実行できません") : "返事待ちにする"}
                disabled={readOnlyMode || (!selectedId && checkedIds.size === 0) || isActionInProgress || bulkProgress !== null}
              >
                <Clock size={20} className={checkedIds.size > 0 || selectedId ? "text-[#ea8600]" : "text-[#5f6368]"} />
                <span className="hidden xl:inline">返事待ち</span>
                <span className={t.toolbarShortcut} title="ショートカット: W">W</span>
              </button>

              {/* Step 114: 担当ボタン（状態で挙動分岐） */}
              {/* 未割当 → 即座に自分に割当、自分担当 → 即座に解除、他人担当 → ポップアップで引き継ぎ */}
              <button
                data-testid={
                  checkedIds.size > 0
                    ? (someSelectedOtherAssigned ? "action-takeover" : allSelectedMine ? "action-unassign" : "action-assign")
                    : (isSelectedOtherAssigned ? "action-takeover" : isSelectedMine ? "action-unassign" : "action-assign")
                }
                className={`${t.toolbarButton} min-w-[44px] xl:min-w-[76px] justify-center ${(checkedIds.size > 0 ? someSelectedMine : isSelectedMine) ? t.toolbarButtonActive : ""} ${(isActionInProgress || bulkProgress) ? "opacity-60" : ""}`}
                onClick={async () => {
                  // Step 114: 状態によって挙動を分岐
                  if (checkedIds.size > 0) {
                    const ids = Array.from(checkedIds);
                    // 複数選択時：他人担当が含まれる場合はポップアップ
                    if (someSelectedOtherAssigned) {
                      handleAssignClick(null, ids);
                    } else if (allSelectedMine) {
                      // 全て自分担当 → 即座に解除（IDを直接渡す）
                      await handleAssigneeSelect(null, undefined, undefined, ids);
                    } else {
                      // 未割当を含む → 即座に自分に割当（IDを直接渡す）
                      await handleAssigneeSelect(user.email, undefined, undefined, ids);
                    }
                  } else if (selectedId) {
                    // 単一選択時
                    if (isSelectedOtherAssigned) {
                      // 他人担当 → ポップアップで引き継ぎ
                      handleAssignClick(selectedId);
                    } else if (isSelectedMine) {
                      // 自分担当 → 即座に解除（IDを直接渡す）
                      await handleAssigneeSelect(null, undefined, undefined, [selectedId]);
                    } else {
                      // 未割当 → 即座に自分に割当（IDを直接渡す）
                      await handleAssigneeSelect(user.email, undefined, undefined, [selectedId]);
                    }
                  }
                }}
                title={
                  readOnlyMode
                    ? (getWriteBlockedTitle() ?? "実行できません")
                    : checkedIds.size > 0
                    ? (someSelectedOtherAssigned ? "選択分を引き継ぎ" : allSelectedMine ? "選択分を担当解除" : "選択分を担当")
                    : (isSelectedOtherAssigned ? "引き継ぎ" : isSelectedMine ? "担当解除" : "担当")
                }
                disabled={readOnlyMode || selectedIds.length === 0 || bulkProgress !== null || isActionInProgress}
              >
                <UserCheck size={20} className={(checkedIds.size > 0 ? someSelectedMine : isSelectedMine) ? "text-[#1a73e8]" : "text-[#5f6368]"} />
                <span className="hidden xl:inline">
                  {checkedIds.size > 0
                    ? (someSelectedOtherAssigned ? "引き継ぎ" : allSelectedMine ? "担当解除" : "担当")
                    : (isSelectedOtherAssigned ? "引き継ぎ" : isSelectedMine ? "担当解除" : "担当")}
                </span>
                <span className={t.toolbarShortcut} title="ショートカット: C">C</span>
              </button>

              {/* 処理不要（常に表示 - 複数選択時は一括処理、単独選択時は単独処理） */}
              <button 
                data-testid={checkedIds.size > 0 ? "bulk-action-mute" : "action-mute"}
                onClick={() => {
                  if (checkedIds.size > 0) {
                    handleBulkMuteSelected(Array.from(checkedIds));
                  } else if (selectedId) {
                    handleMute(selectedId);
                  }
                }}
                className={`${t.toolbarButton} min-w-[44px] xl:min-w-[82px] justify-center ${(isActionInProgress || bulkProgress) ? "opacity-60" : ""}`}
                title={readOnlyMode ? (getWriteBlockedTitle() ?? "実行できません") : (checkedIds.size > 0 ? "選択分を処理不要にする" : "処理不要にする")}
                disabled={readOnlyMode || (!selectedId && checkedIds.size === 0) || isActionInProgress || bulkProgress !== null}
              >
                <VolumeX size={20} className={checkedIds.size > 0 || selectedId ? "text-[#ea8600]" : "text-[#5f6368]"} />
                <span className="hidden xl:inline">処理不要</span>
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
                  <span className="hidden xl:inline">ラベル</span>
                </button>
              </div>

              {/* 一括操作ボタン（選択時のみ有効） */}
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
                      <span className="hidden 2xl:inline">自分へ</span>
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
                    <span className="hidden 2xl:inline">担当…</span>
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
                    <span className="hidden 2xl:inline">解除</span>
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
                    <span className="hidden 2xl:inline">配分</span>
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
                title={slaFocus ? (slaCriticalOnly ? "特に長く残っているメールだけ表示中" : "長く残っているメールを表示中") : "長く残っているメールを表示"}
              >
                <AlertTriangle size={20} className={slaFocus ? "text-[#f9ab00]" : "text-[#5f6368]"} />
                <span className="hidden 2xl:inline">長く残っている</span>
              </button>

              <div className="w-px h-5 bg-[#dadce0] mx-2"></div>

              <button
                data-testid="list-density-toggle"
                type="button"
                onClick={toggleListDensity}
                className={`${t.toolbarButton} ${listDensity === "compact" ? t.toolbarButtonActive : ""}`}
                title={listDensity === "compact" ? "一覧密度: Compact。クリックでComfortableへ" : "一覧密度: Comfortable。クリックでCompactへ"}
                aria-pressed={listDensity === "compact"}
              >
                <Rows3 size={20} className={listDensity === "compact" ? "text-[#1a73e8]" : "text-[#5f6368]"} />
                <span className="hidden 2xl:inline">{listDensity === "compact" ? "Compact" : "Comfortable"}</span>
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
                  <div className="text-[12px] font-medium text-[#202124]">よく見る一覧</div>
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
            <div className="flex min-w-0 items-center overflow-x-auto">
              {/* 表示中メールの一括選択チェック（タブの左） */}
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

              {/* 今返すタブ */}
              <button
                onClick={() => {
                  setViewTab("inbox");
                  // 今返すタブ: todoラベルで再読み込み
                  const todoLabel = labelGroups.flatMap((g) => g.items).find((item) => item.statusType === "todo");
                  if (todoLabel) {
                    onSelectLabel(todoLabel);
                    listRef.current?.scrollTo({ top: 0 });
                  }
                }}
                className={`${t.tab} ${viewTab === "inbox" ? t.tabActive : ""}`}
                data-testid="tab-inbox"
              >
                <span>今返す</span>
                {statusCounts && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[11px] leading-3 ${viewTab === "inbox" ? "bg-white text-[#1a73e8]" : "bg-[#f1f3f4] text-[#5f6368]"}`}>
                    {statusCounts.todo}
                  </span>
                )}
              </button>
              {/* 自分が対応タブ */}
              <button
                onClick={() => {
                  setViewTab("assigned");
                  // 自分が対応タブ: 担当ラベルでフィルタリングしてメッセージを取得
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
                <span>自分が対応</span>
                {statusCounts && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[11px] leading-3 ${viewTab === "assigned" ? "bg-white text-[#1a73e8]" : "bg-[#f1f3f4] text-[#5f6368]"}`}>
                    {statusCounts.assignedMine ?? 0}
                  </span>
                )}
              </button>
              {/* 返事待ちタブ */}
              <button
                onClick={() => {
                  setViewTab("waiting");
                  // 返事待ちタブ: waitingラベルで再読み込み
                  const waitingLabel = labelGroups.flatMap((g) => g.items).find((item) => item.statusType === "waiting");
                  if (waitingLabel) {
                    onSelectLabel(waitingLabel);
                    listRef.current?.scrollTo({ top: 0 });
                  }
                }}
                className={`${t.tab} ${viewTab === "waiting" ? t.tabActive : ""}`}
                data-testid="tab-waiting"
              >
                <span>返事待ち</span>
                {statusCounts && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[11px] leading-3 ${viewTab === "waiting" ? "bg-white text-[#1a73e8]" : "bg-[#f1f3f4] text-[#5f6368]"}`}>
                    {statusCounts.waiting}
                  </span>
                )}
              </button>
              {/* 処理不要タブ */}
              <button
                onClick={() => {
                  setViewTab("muted");
                  // 処理不要タブ: mutedラベルで再読み込み
                  const mutedLabel = labelGroups.flatMap((g) => g.items).find((item) => item.statusType === "muted");
                  if (mutedLabel) {
                    onSelectLabel(mutedLabel);
                    listRef.current?.scrollTo({ top: 0 });
                  }
                }}
                className={`${t.tab} ${viewTab === "muted" ? t.tabActive : ""}`}
                data-testid="tab-muted"
              >
                <span>処理不要</span>
                {statusCounts && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[11px] leading-3 ${viewTab === "muted" ? "bg-white text-[#1a73e8]" : "bg-[#f1f3f4] text-[#5f6368]"}`}>
                    {statusCounts.muted}
                  </span>
                )}
              </button>
            </div>

            {/* 右側: 選択中メールのナビゲーション/クイック操作（タブ行と同じ水平線に揃える） */}
            <div className="hidden items-center gap-1 flex-shrink-0 pr-1 xl:flex">
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
                        <span className="hidden 2xl:inline">返信</span>
                      </a>
                      <a
                        href={buildGmailForwardLink(selectedMessage.gmailLink, selectedMessage.threadId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2 py-1 rounded-md text-xs text-[#3c4043] hover:bg-[#f1f3f4] transition-colors font-medium"
                        title="転送（Gmail）"
                      >
                        <span className="hidden 2xl:inline">転送</span>
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
                        <span className="hidden 2xl:inline">{isSelectedMine ? "担当変更" : selectedAssigneeSlug ? "引き継ぐ" : "担当"}</span>
                      </button>

                      {activeLabel?.statusType !== "muted" ? (
                        <>
                          <button
                            data-testid="action-mute-detail"
                            onClick={() => handleMute(selectedId)}
                            className="px-2 py-1 rounded-md text-xs text-[#3c4043] hover:bg-[#f1f3f4] transition-colors font-medium flex items-center gap-1.5"
                            title="処理不要にする"
                          >
                            <VolumeX size={14} className="text-[#5f6368]" />
                            <span className="hidden 2xl:inline">処理不要</span>
                          </button>
                          <button
                            data-testid="action-mute-sender"
                            onClick={() => void openSenderMutePreview()}
                            disabled={readOnlyMode}
                            className="px-2 py-1 rounded-md text-xs text-[#3c4043] hover:bg-[#f1f3f4] transition-colors font-medium flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                            title={readOnlyMode ? (getWriteBlockedTitle() ?? "実行できません") : "同じ送信元の未処理メールをまとめて処理不要にする"}
                          >
                            <VolumeX size={14} className="text-[#5f6368]" />
                            <span className="hidden 2xl:inline">同送信元</span>
                          </button>
                        </>
                      ) : (
                        <button
                          data-testid="action-unmute-detail"
                          onClick={() => handleUnmute(selectedId)}
                          className="px-2 py-1 rounded-md text-xs text-[#3c4043] hover:bg-[#f1f3f4] transition-colors font-medium flex items-center gap-1.5"
                          title="Inboxへ戻す"
                        >
                          <VolumeX size={14} className="text-[#5f6368]" />
                          <span className="hidden 2xl:inline">復帰</span>
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
                            title={readOnlyMode ? (getWriteBlockedTitle() ?? "実行できません") : "指定日に戻す"}
                          >
                            <Clock size={14} className="text-[#5f6368]" />
                            <span className="hidden 2xl:inline">指定日に戻す</span>
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
                                  { label: "明日", days: 1 },
                                  { label: "3日後", days: 3 },
                                  { label: "1週間後", days: 7 },
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
                            title={readOnlyMode ? (getWriteBlockedTitle() ?? "実行できません") : "指定日戻しを解除"}
                        >
                          <Clock size={14} className="text-[#5f6368]" />
                          <span className="hidden 2xl:inline">解除</span>
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
                        <span className="hidden 2xl:inline">Copy</span>
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
              className={`${t.listColumn} ${selectedMessage ? "mailhub-list-selected" : ""}`}
              style={{
                flex: selectedMessage ? `1 1 ${listWidth}px` : undefined,
                width: selectedMessage ? undefined : `min(${listWidth}px, max(320px, calc(100vw - ${sidebarWidth + 460}px)))`,
                minWidth: '320px',
                maxWidth: selectedMessage ? 'none' : '620px',
              }}
            >
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {activeChannelScope && (
                  <div
                    data-testid="channel-scope-bar"
                    className="sticky top-0 z-10 border-b border-[#e8eaed] bg-[#f8fbff] px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[12px] font-medium text-[#202124]">
                          <span className="h-2 w-2 rounded-full bg-[#1a73e8]" />
                          <span className="truncate">{activeChannelScope.channel.label}</span>
                          <span className="shrink-0 rounded-full border border-[#d2e3fc] bg-white px-1.5 py-0.5 text-[11px] text-[#1a73e8]">
                            {messages.length}件読み込み済み
                          </span>
                          <span className="shrink-0 rounded-full border border-[#dadce0] bg-white px-1.5 py-0.5 text-[11px] text-[#5f6368]">
                            {activeChannelScope.isAggregate
                              ? `${activeChannelScope.sourceChannels.length}店舗 / ${activeChannelScope.sourceAddresses.length}宛先`
                              : `${activeChannelScope.sourceAddresses.length}宛先`}
                          </span>
                          {nextPageToken && (
                            <span className="shrink-0 rounded-full border border-[#fde68a] bg-[#fffbeb] px-1.5 py-0.5 text-[11px] text-[#92400e]">
                              続きあり
                            </span>
                          )}
                        </div>
                        <div
                          className="mt-1 truncate text-[11px] text-[#5f6368]"
                          title={
                            activeChannelScope.isAggregate
                              ? activeChannelScope.sourceAddresses.join(", ")
                              : activeChannelScope.sourceAddresses.join(", ")
                          }
                        >
                          {activeChannelScope.isAggregate
                            ? `含む店舗: ${activeChannelScope.sourceChannels.map((item) => item.label).join(" / ")}`
                            : `専用宛先: ${activeChannelScope.sourceAddresses.join(", ")}`}
                        </div>
                        {nextPageToken && (
                          <div className="mt-1 text-[11px] text-[#92400e]">
                            全件ではありません。下の「さらに表示」で続きを読み込めます。
                          </div>
                        )}
                      </div>
                      {activeChannelScope.channel.relatedQ && (
                        <button
                          type="button"
                          data-testid="channel-related-search"
                          onClick={() => handleRelatedChannelSearch(activeChannelScope.channel.relatedQ!)}
                          className="shrink-0 inline-flex items-center gap-1 rounded border border-[#dadce0] bg-white px-2 py-1 text-[12px] font-medium text-[#3c4043] hover:bg-[#f1f3f4]"
                          title={`すべてのメールから検索: ${activeChannelScope.channel.relatedQ}`}
                        >
                          <Search size={13} className="text-[#5f6368]" />
                          関連候補
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {listError ? (
                  <div className="p-8 text-center space-y-3">
                    <div className="text-red-600 text-sm font-medium">リストを取得できませんでした</div>
                    <div className="text-xs text-gray-500">{listError}</div>
                    <button onClick={reloadCurrentList} className="px-4 py-2 bg-blue-600 text-white rounded-md text-xs font-bold hover:bg-blue-700 transition-colors">再試行</button>
                  </div>
                ) : messages.length === 0 ? (
                  <div
                    className="flex min-h-[320px] items-center justify-center p-8 text-gray-500 text-sm font-medium"
                    data-testid="empty-list-state"
                  >
                    <div className="text-center space-y-3 max-w-[340px]">
                      <div className="text-gray-900 font-semibold">
                        {activeChannelScope ? `${activeChannelScope.channel.label} は0件です` : "この条件では0件です"}
                      </div>
                      <div className="text-xs text-gray-500 leading-relaxed">
                        {activeChannelScope
                          ? activeChannelScope.isAggregate
                            ? `対象: ${activeChannelScope.sourceChannels.map((item) => item.label).join(" / ")}`
                            : `専用宛先: ${activeChannelScope.sourceAddresses.join(", ")}`
                          : activeLabel?.label
                            ? `現在の絞り込み: ${activeLabel.label}`
                            : "現在の絞り込みではメールがありません"}
                      </div>
                      {activeChannelScope && (
                        <div
                          className="rounded-md border border-[#e8eaed] bg-white px-3 py-2 text-[11px] font-normal leading-relaxed text-[#5f6368]"
                          data-testid="empty-channel-scope"
                        >
                          <span className="block text-[#3c4043]">
                            確認対象: {activeChannelScope.sourceAddresses.join(", ")}
                          </span>
                          宛先違いの可能性がある場合は、すべてのメールか関連候補から探せます。
                          {serverSearchQuery && (
                            <span className="block mt-1">
                              検索条件: <span className="font-mono">{serverSearchQuery}</span>
                            </span>
                          )}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        {activeChannelScope?.channel.relatedQ && (
                          <button
                            type="button"
                            data-testid="empty-channel-related-search"
                            onClick={() => handleRelatedChannelSearch(activeChannelScope.channel.relatedQ!)}
                            className="px-3 py-2 border border-[#dadce0] bg-white text-[#3c4043] rounded-md text-xs font-bold hover:bg-[#f1f3f4] transition-colors"
                          >
                            関連候補
                          </button>
                        )}
                        <button
                          onClick={() => {
                            const stores = labelGroups.flatMap((g) => g.items).find((item) => item.id === "stores");
                            if (stores) onSelectLabel(stores);
                          }}
                          className="px-3 py-2 bg-blue-600 text-white rounded-md text-xs font-bold hover:bg-blue-700 transition-colors"
                        >
                          ストア全部
                        </button>
                        <button
                          onClick={() => {
                            const all = labelGroups.flatMap((g) => g.items).find((item) => item.id === "all");
                            if (all) onSelectLabel(all);
                          }}
                          className="px-3 py-2 border border-gray-300 text-gray-700 rounded-md text-xs font-bold hover:bg-gray-50 transition-colors"
                        >
                          すべて
                        </button>
                        <button onClick={reloadCurrentList} className="px-3 py-2 border border-gray-300 text-gray-700 rounded-md text-xs font-bold hover:bg-gray-50 transition-colors">再読み込み</button>
                      </div>
                    </div>
                  </div>
                ) : slaFocus && slaFilteredMessages.length === 0 && !isPending ? (
                  // Step 66: SLA Focus ON で0件
                  <div className="flex min-h-[320px] items-center justify-center p-8 text-gray-500 text-sm font-medium" data-testid="sla-empty">
                    <div className="text-center space-y-2">
                      <AlertTriangle size={40} className="mx-auto text-[#34a853]" />
                      <div>長く残っているメールはありません</div>
                      <div className="text-xs text-gray-400">全てのメールが期限内です</div>
                    </div>
                  </div>
                ) : slaFilteredMessages.length === 0 && !isPending ? (
                  <div className="flex min-h-[320px] items-center justify-center p-8 text-gray-500 text-sm font-medium" data-testid={serverSearchQuery ? undefined : (searchTerm ? undefined : (activeLabel?.statusType === "todo" ? "zero-inbox" : undefined))}>
                    {serverSearchQuery ? `検索結果が見つかりませんでした: ${serverSearchQuery}` : searchTerm ? "見つかりませんでした" : activeLabel?.statusType === "todo" ? "今返すメールはありません" : "メールはありません"}
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
                      const isCompactDensity = listDensity === "compact";
                      const rowAssigneeName = getAssigneeDisplayName(mail.assigneeSlug);
                      const rowAssigneeState = !mail.assigneeSlug
                        ? "unassigned"
                        : mail.assigneeSlug === myAssigneeSlug
                          ? "mine"
                          : "other";
                      const rowAssigneeLabel =
                        rowAssigneeState === "unassigned"
                          ? "未割当"
                          : rowAssigneeState === "mine"
                            ? "自分担当"
                            : `担当: ${rowAssigneeName ?? "他担当"}`;
                      const rowAssigneeTitle =
                        rowAssigneeState === "unassigned"
                          ? "未割当"
                          : rowAssigneeState === "mine"
                            ? "自分が担当"
                            : `担当: ${rowAssigneeName ?? mail.assigneeSlug}`;
                      const rowAssigneeTone =
                        rowAssigneeState === "mine"
                          ? "border-[#d2e3fc] bg-[#e8f0fe] text-[#1a73e8]"
                          : rowAssigneeState === "other"
                            ? "border-[#fdd663] bg-[#fef7e0] text-[#92400e]"
                            : "border-[#dadce0] bg-white text-[#5f6368]";
                      
                      return (
                        <div
                          key={mail.id}
                          data-message-id={mail.id}
                          data-testid="message-row"
                          data-active={isActive ? "true" : undefined}
                          data-is-group={isGroupHeader && groupCount > 1 ? "true" : undefined}
                          data-group-key={groupKey}
                          data-group-count={groupCount > 1 ? groupCount : undefined}
                          role="option"
                          aria-selected={isActive}
                          className="mailhub-message-row-shell cursor-pointer"
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
                          onPointerEnter={() => handleRowMouseEnter(mail.id)}
                          onPointerDown={() => handleRowImmediatePrefetch(mail.id)}
                          onFocus={() => handleRowImmediatePrefetch(mail.id)}
                          onMouseLeave={handleRowMouseLeave}
                        >
                          <div
                            data-testid={isActive ? "message-row-selected" : undefined}
                            className={`${t.listItem} ${isCompactDensity ? "!min-h-[48px] !py-1.5" : "!min-h-[62px] !py-2"} ${rowTone} ${isActive ? t.listItemActive : ""} ${isChecked ? t.listItemChecked : ""} ${isTriageCandidate(mail.id) ? "bg-yellow-50" : ""} ${flashingIds.has(mail.id) ? "bg-blue-200 scale-[1.01] transition-all duration-200 shadow-md" : ""} ${removingIds.has(mail.id) ? "opacity-0 scale-95 -translate-x-8 transition-all duration-500 ease-out" : "transition-[background-color,box-shadow,border-color] duration-75"} relative`}
                          >
                            {/* Assignee カラーバー（左端） */}
                            {mail.assigneeSlug && (
                              <div
                                data-testid="assignee-bar"
                                className={`absolute left-0 top-0 bottom-0 w-[3px] ${
                                  mail.assigneeSlug === myAssigneeSlug
                                    ? "bg-blue-500"
                                    : "bg-gray-400"
                                }`}
                                title={mail.assigneeSlug === myAssigneeSlug ? "自分が担当" : `担当: ${getAssigneeDisplayName(mail.assigneeSlug)}`}
                              />
                            )}
                            {/* checkbox / star / sender+subject / date */}
                            <div className="mailhub-row-grid grid w-full min-w-0 grid-cols-[16px_17px_minmax(0,1fr)_38px] items-start gap-1">
                            {/* チェックボックス */}
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
                                className="h-[14px] w-[14px] cursor-pointer rounded border-[#dadce0] bg-white text-[#1a73e8] transition-colors hover:border-[#1a73e8] focus:ring-2 focus:ring-[#1a73e8]/20"
                                data-testid={`checkbox-${mail.id}`}
                              />
                            </div>

                            {/* スター */}
                            <button
                              type="button"
                              aria-label="スター"
                              data-testid={`star-${mail.id}`}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                toggleStarLocal(mail.id);
                              }}
                              className="rounded p-0.5 text-[#5f6368] transition-colors hover:bg-[#f1f3f4] hover:text-[#202124]"
                              title={mail.isStarred ? "スターを外す" : "スターを付ける"}
                            >
                              <Star
                                size={17}
                                className={mail.isStarred ? "text-[#fbbc04] fill-[#fbbc04]" : "text-[#5f6368]"}
                                fill={mail.isStarred ? "currentColor" : "none"}
                              />
                            </button>

                            <div className="mailhub-row-text-block min-w-0" data-testid="row-text-block">
                              <div className="mailhub-row-sender-line flex min-w-0 items-center gap-1">
                                {isUnread && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#1a73e8]" title="未読" />}
                                {!seenIds.has(mail.id) && <span data-testid="badge-unseen" className="h-2 w-2 flex-shrink-0 rounded-full bg-orange-400" title="未確認" />}
                                {mail.assigneeSlug === myAssigneeSlug && (
                                  <span title="自分が担当">
                                    <UserCheck size={14} className="flex-shrink-0 text-[#1a73e8]" />
                                  </span>
                                )}
                                <span data-testid="row-sender" className={`min-w-0 truncate text-[13px] leading-[18px] ${isUnread ? "font-semibold text-[#202124]" : "font-medium text-[#3c4043]"}`}>
                                  {mail.from?.split("<")[0].trim() || mail.from}
                                </span>
                                <button
                                  type="button"
                                  data-testid="assignee-pill"
                                  data-owner-state={rowAssigneeState}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleAssignClick(mail.id);
                                  }}
                                  onDoubleClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                  }}
                                  className={`ml-auto inline-flex h-[18px] max-w-[104px] shrink-0 items-center gap-0.5 overflow-hidden rounded border px-1.5 text-[10px] font-semibold leading-none transition-colors hover:opacity-80 ${rowAssigneeTone}`}
                                  title={rowAssigneeTitle}
                                >
                                  <UserCheck size={11} className="shrink-0" />
                                  <span className="truncate">{rowAssigneeLabel}</span>
                                </button>
                              </div>

                              <div className={`mailhub-row-subject-line flex min-w-0 items-center gap-1 text-[13px] leading-[18px] ${isUnread ? "font-medium text-[#202124]" : "font-normal text-[#202124]"} ${isGroupChild ? "pl-4 border-l-2 border-blue-200" : ""}`}>
                                {isGroupHeader && groupCount > 1 && (
                                  <button
                                    type="button"
                                    data-testid={`group-toggle-${groupKey}`}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      if (groupKey) toggleGroupExpand(groupKey);
                                    }}
                                    className="mr-1 inline-flex flex-shrink-0 items-center rounded border border-blue-300 bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 transition-colors hover:bg-blue-200"
                                    title={isExpanded ? "折りたたむ" : "展開する"}
                                  >
                                    {isExpanded ? "▼" : "▶"} ×{groupCount}
                                  </button>
                                )}
                                <span data-testid="row-subject" className={`min-w-0 truncate ${isUnread ? "font-semibold" : "font-medium"}`}>{mail.subject ?? "(no subject)"}</span>
                              </div>

                              <div className="mailhub-row-snippet-line mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] leading-[16px] text-[#5f6368]">
                                {mail.snippet ? <span className="mailhub-row-inline-separator flex-shrink-0 text-[#5f6368]"> - </span> : null}
                                <span data-testid="row-snippet" className="block min-w-0 flex-1 truncate font-normal">{shortSnippet(mail.snippet ?? "", 180)}</span>
                                {workTags.slice(0, 2).map((tag) => (
                                  <span key={tag} data-testid="work-tag-pill" className="mailhub-row-chip inline-flex max-w-[82px] truncate rounded border border-purple-200 bg-purple-50 px-1 py-0.5 text-[9px] font-bold text-purple-700" title={`状況タグ: ${tag}`}>{tag}</span>
                                ))}
                                {workTags.length > 2 && (
                                  <span data-testid="work-tag-more" className="mailhub-row-chip inline-flex rounded border border-purple-200 bg-purple-50 px-1 py-0.5 text-[9px] font-bold text-purple-700" title={workTags.join(", ")}>+{workTags.length - 2}</span>
                                )}
                                {hasNote && <span data-testid="note-badge" className="mailhub-row-chip inline-flex rounded border border-[#dadce0] bg-[#f1f3f4] px-1 py-0.5 text-[10px] text-[#5f6368]" title="社内メモあり">📝</span>}
                                {mail.snoozeUntil && <span data-testid="snooze-pill" className="mailhub-row-chip inline-flex rounded border border-blue-200 bg-blue-50 px-1 py-0.5 text-[9px] font-bold text-blue-700" title={`指定日に戻す: ${mail.snoozeUntil}`}>Snooze: {mail.snoozeUntil.split("-").slice(1).join("/")}</span>}
                                {(mail.userLabels ?? []).slice(0, 2).map((labelName) => (
                                  <span key={labelName} data-testid="user-label-pill" className="mailhub-row-chip inline-flex max-w-[82px] truncate rounded border border-purple-200 bg-purple-50 px-1 py-0.5 text-[9px] font-bold text-purple-700" title={labelName}>{displayUserLabel(labelName)}</span>
                                ))}
                                {(mail.userLabels ?? []).length > 2 && (
                                  <span data-testid="user-label-pill" className="mailhub-row-chip inline-flex rounded border border-purple-200 bg-purple-50 px-1 py-0.5 text-[9px] font-bold text-purple-700" title={(mail.userLabels ?? []).join(", ")}>+{(mail.userLabels ?? []).length - 2}</span>
                                )}
                                {isTriageCandidate(mail.id) && <span data-testid="triage-badge-muted" className="mailhub-row-chip inline-flex rounded border border-yellow-300 bg-yellow-100 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-yellow-700" title="処理不要候補">処理不要</span>}
                              </div>
                            </div>

                            {/* 日時 + 経過 */}
                            <div className="flex min-w-[38px] max-w-[38px] flex-shrink-0 flex-col items-end gap-1">
                              <div className="flex items-center gap-1">
                                {mail.attachmentCount ? (
                                  <span
                                    className="inline-flex items-center gap-0.5 text-[11px] text-[#5f6368]"
                                    title={`添付 ${mail.attachmentCount}件`}
                                    data-testid="message-attachment-indicator"
                                  >
                                    <Paperclip size={13} />
                                    {mail.attachmentCount > 1 && <span>{mail.attachmentCount}</span>}
                                  </span>
                                ) : null}
                                <span className={`text-[11px] font-normal ${isActive ? 'text-[#3c4043]' : 'text-[#5f6368]'}`} title={mail.receivedAt}>
                                  {mail.receivedAt.split(' ')[1]?.slice(0, 5)}
                                </span>
                              </div>
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
                                <span className={`rounded border px-1 py-0.5 text-[9px] font-bold ${colorClass}`}>
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
                      <div className="flex justify-center border-t border-[#e8eaed] py-3">
                        <button
                          type="button"
                          data-testid="action-load-more"
                          onClick={() => void handleLoadMore()}
                          disabled={isLoadingMore}
                          className="inline-flex h-9 items-center gap-2 rounded-full border border-[#dadce0] bg-white px-4 text-[13px] font-medium text-[#3c4043] transition-colors hover:bg-[#f1f3f4] active:bg-[#e8eaed] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <ChevronDown size={16} className="text-[#5f6368]" />
                          {isLoadingMore ? "読み込み中..." : "さらに表示"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* リストリサイザー */}
            <div 
              className="mailhub-list-resizer w-1 cursor-col-resize hover:bg-blue-500/30 transition-colors active:bg-blue-500/50 z-20 -mx-2"
              onMouseDown={() => startResizing("list")}
            />

            {/* 詳細表示 */}
            <div
              className={`${t.detailColumn} ${selectedMessage ? "mailhub-detail-selected" : ""}`}
              data-testid="detail-pane"
              style={selectedMessage ? {
                flexBasis: selectedDetailBasis,
                flexGrow: 0,
                flexShrink: 0,
                width: selectedDetailBasis,
              } : undefined}
            >
              {!selectedMessage ? (
                <div className="flex-1 flex flex-col items-center justify-center text-[#5f6368] space-y-4">
                  <Mail className="w-12 h-12 opacity-10" />
                  <span className="text-sm font-medium opacity-40">メールを選択してください</span>
                </div>
              ) : (
                <>
                  <div className="md:hidden bg-white border-b border-[#e8eaed] px-3 py-2">
                    <button
                      type="button"
                      className="text-[13px] font-medium text-[#1a73e8] px-2 py-1 rounded hover:bg-[#f1f3f4]"
                      onClick={() => {
                        setSelectedId(null);
                        selectedIdRef.current = null;
                        setSelectedMessage(null);
                        setSelectedDetail(null);
                        setDetailBody(emptyDetailBodyState());
                        replaceUrl(labelId, null, true, serverSearchQuery || undefined);
                      }}
                    >
                      ← 一覧に戻る
                    </button>
                  </div>
                  <div ref={detailScrollRef} className="flex-1 overflow-y-auto custom-scrollbar bg-white text-[#202124]">
                    <div className="sticky top-0 z-10 border-b border-[#e8eaed] bg-white/95 backdrop-blur">
                      <div className="mx-auto w-full max-w-[820px] px-4 py-0.5 sm:px-5 lg:px-6" data-testid="detail-header-inner">
                        <div className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1 xl:flex-nowrap">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-5 text-[#202124]"
                                data-testid="detail-subject"
                                title={`${selectedMessage.subject ?? "(no subject)"} / ${selectedMessage.from ?? ""}`}
                              >
                                {selectedMessage.subject ?? "(no subject)"}
                              </span>
                            </div>
                            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-4 text-[#5f6368]" data-testid="detail-context-line">
                              <span
                                className="min-w-0 max-w-[280px] truncate text-[#3c4043]"
                                data-testid={selectedAddressContext?.fromEmail ? "detail-from-email" : undefined}
                                title={selectedAddressContext?.title ?? selectedMessage.from ?? ""}
                              >
                                {selectedAddressContext?.fromLabel ?? "送信者不明"}
                              </span>
                              <span className="hidden text-[#dadce0] sm:inline xl:hidden 2xl:inline">|</span>
                              <span className="hidden shrink-0 sm:inline xl:hidden 2xl:inline">{activeLabel?.label ?? "現在の一覧"}</span>
                              <span className="hidden text-[#dadce0] sm:inline xl:hidden 2xl:inline">|</span>
                              <span className="hidden shrink-0 sm:inline xl:hidden 2xl:inline">{selectedMessage.receivedAt}</span>
                              {selectedMessage.attachmentCount ? (
                                <>
                                  <span className="hidden text-[#dadce0] sm:inline xl:hidden 2xl:inline">|</span>
                                  <span className="hidden shrink-0 items-center gap-1 sm:inline-flex xl:hidden 2xl:inline-flex">
                                    <Paperclip size={12} />
                                    添付 {selectedMessage.attachmentCount}
                                  </span>
                                </>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex basis-full shrink-0 items-center justify-end gap-1 xl:basis-auto" data-testid="detail-header-actions">
                          <button
                            data-testid="assignee-pill"
                            type="button"
                            onClick={() => handleAssignClick(selectedMessage?.id ?? selectedId)}
                            className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-md flex max-w-[220px] items-center gap-1 cursor-pointer transition-colors hover:opacity-90 ${
                              !selectedAssigneeSlug
                                ? "bg-[#e8f0fe] text-[#1a73e8] border border-[#d2e3fc] hover:bg-[#d2e3fc]"
                                : selectedAssigneeSlug === myAssigneeSlug
                                  ? "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
                                  : "bg-[#fef7e0] text-[#92400e] border border-[#fdd663] hover:bg-[#feefc3]"
                            }`}
                            title={selectedOwnerActionTitle}
                          >
                            <UserCheck size={12} className="shrink-0" />
                            <span className="hidden min-w-0 truncate sm:inline">{selectedOwnerStatusLabel}</span>
                            <span className="hidden opacity-70 sm:inline">|</span>
                            <span className="shrink-0 font-semibold">{selectedOwnerActionLabel}</span>
                          </button>

                          {(selectedMessage.userLabels ?? []).length > 0 && (
                            <span className="hidden lg:flex items-center gap-1 shrink-0">
                              {(selectedMessage.userLabels ?? []).slice(0, 1).map((ln) => (
                                <span
                                  key={ln}
                                  data-testid="user-label-pill"
                                  className="max-w-[110px] truncate text-[11px] font-medium px-2 py-0.5 rounded border border-purple-200 bg-purple-50 text-purple-700"
                                  title={ln}
                                >
                                  {displayUserLabel(ln)}
                                </span>
                              ))}
                              {(selectedMessage.userLabels ?? []).length > 1 && (
                                <span
                                  data-testid="user-label-pill"
                                  className="text-[11px] font-medium px-2 py-0.5 rounded border border-purple-200 bg-purple-50 text-purple-700"
                                  title={(selectedMessage.userLabels ?? []).join(", ")}
                                >
                                  +{(selectedMessage.userLabels ?? []).length - 1}
                                </span>
                              )}
                            </span>
                          )}

                          <button
                            type="button"
                            onClick={() => document.getElementById("section-notes")?.scrollIntoView({ behavior: "smooth" })}
                            className="shrink-0 p-1.5 text-[#5f6368] hover:text-[#202124] hover:bg-[#f1f3f4] rounded-full transition-colors"
                            title="社内メモへ"
                            data-testid="jump-to-notes"
                          >
                            <MessageSquare size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowExplainDrawer(true)}
                            className="shrink-0 p-1.5 text-[#5f6368] hover:text-[#202124] hover:bg-[#f1f3f4] rounded-full transition-colors"
                            data-testid="action-explain"
                            title="このメッセージに適用されるルールを説明"
                          >
                            <HelpCircle size={16} />
                          </button>
                          {selectedMessage?.gmailLink && (
                            <a
                              href={selectedMessage.gmailLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hidden shrink-0 p-1.5 text-[#1a73e8] hover:text-[#1557b0] hover:bg-[#e8f0fe] rounded-full transition-colors xl:inline-flex"
                              title="Gmailで開く"
                              data-testid="jump-to-gmail"
                            >
                              <ExternalLink size={15} />
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => setBodyCollapsed(!bodyCollapsed)}
                            className="hidden shrink-0 p-1.5 text-[#5f6368] hover:text-[#202124] hover:bg-[#f1f3f4] rounded-full transition-colors xl:inline-flex"
                            title={bodyCollapsed ? "本文を展開" : "本文を折りたたむ"}
                            data-testid="toggle-body-collapse"
                          >
                              {bodyCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* スクロール可能なコンテンツエリア */}
                    <div className="mx-auto w-full max-w-[820px] px-4 pt-0 pb-8 sm:px-5 lg:px-6" data-testid="detail-content-inner">
                      {selectedWorkContext && (
                        <div
                          className="mb-2 flex flex-wrap items-center gap-1.5 border-y border-[#e8eaed] bg-[#f8fbff] px-0 py-1 text-[11px] leading-4 text-[#3c4043]"
                          data-testid="detail-work-context"
                        >
                          <div
                            className="inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-full border border-[#dadce0] bg-white px-2 font-medium"
                            title={`${selectedWorkContext.statusLabel} / ${selectedWorkContext.scopeTitle}`}
                          >
                            <CheckCircle size={12} className="shrink-0 text-[#5f6368]" />
                            <span className="font-semibold text-[#202124]">{selectedWorkContext.statusLabel}</span>
                            <span
                              className="hidden max-w-[132px] truncate text-[#5f6368] sm:inline"
                              data-testid={selectedWorkContext.recipientLabel ? "detail-recipient-context" : undefined}
                              title={selectedWorkContext.scopeTitle}
                            >
                              {selectedWorkContext.scopeDisplayLabel}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAssignClick(selectedMessage?.id ?? selectedId)}
                            className={`inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-full border px-2 font-medium ${selectedWorkContext.ownerTone} hover:opacity-80`}
                            data-testid="detail-owner-context"
                            title={selectedOwnerActionTitle}
                          >
                            <UserCheck size={12} />
                            <span className="truncate">{selectedWorkContext.ownerLabel}</span>
                            <span className="opacity-70">|</span>
                            <span className="shrink-0 font-semibold">{selectedOwnerActionLabel}</span>
                          </button>
                          <div
                            className={`inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-full border px-2 font-medium ${selectedWorkContext.routeTone}`}
                            data-testid="detail-route-context"
                            title={selectedWorkContext.routeTitle}
                          >
                            <CornerUpLeft size={12} />
                            <span className="truncate">{selectedWorkContext.routeLabel}</span>
                          </div>
                          <div
                            className={`inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-full border px-2 font-medium ${selectedWorkContext.slaTone}`}
                            data-testid="detail-sla-context"
                            title={selectedWorkContext.receivedAt}
                          >
                            <Clock size={12} />
                            <span className="truncate">{selectedWorkContext.slaLabel}</span>
                          </div>
                        </div>
                      )}
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
                      <div className="relative" ref={detailBodyFrameRef}>
                        {detailBody.isLoading || detailBody.messageId !== selectedMessage.id || isSelectedHtmlBodyPending ? (
                          <div
                            className="min-h-[180px] space-y-3 py-1"
                            data-testid="detail-skeleton"
                            aria-busy="true"
                            style={{ minHeight: stableDetailBodyMinHeight }}
                          >
                            <div className="mailhub-detail-shimmer h-3 rounded-full w-[88%]" />
                            <div className="mailhub-detail-shimmer h-3 rounded-full w-[62%]" />
                            <div className="pt-2 space-y-2">
                              <div className="mailhub-detail-shimmer h-3 rounded-full w-full" />
                              <div className="mailhub-detail-shimmer h-3 rounded-full w-[94%]" />
                              <div className="mailhub-detail-shimmer h-3 rounded-full w-[76%]" />
                            </div>
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
                                key={`${selectedMessage.id}:html`}
                                ref={htmlBodyRef}
                                className="mailhub-email-body prose max-w-none text-[14px] leading-[20px] text-[#202124] font-normal selection:bg-[#E8F0FE] [&_a]:text-blue-600 [&_a]:underline [&_img]:max-w-full [&_img]:h-auto [&_table]:border-collapse [&_td]:p-2 [&_th]:p-2"
                                data-detail-message-id={selectedMessage.id}
                                data-testid="email-body-html"
                              />
                            ) : (
                              <div
                                key={`${selectedMessage.id}:text`}
                                className="mailhub-email-body prose max-w-none text-[14px] leading-[20px] whitespace-pre-wrap text-[#202124] font-normal selection:bg-[#E8F0FE]"
                                data-detail-message-id={selectedMessage.id}
                                data-testid="email-body-text"
                              >
                                {detailBody.plainTextBody || "本文がありません"}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      )}

                      {detailBody.attachments.length > 0 && !detailBody.isLoading && !detailError && (
                        <div className="mt-5" data-testid="detail-attachments">
                          <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-[#3c4043]">
                            <Paperclip size={14} className="text-[#5f6368]" />
                            添付ファイル {detailBody.attachments.length}件
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {detailBody.attachments.map((attachment) => {
                              const sizeLabel = formatAttachmentSize(attachment.size);
                              const attachmentParams = new URLSearchParams({
                                messageId: selectedMessage.id,
                                attachmentId: attachment.id,
                              });
                              const openHref = `/api/mailhub/attachment?${attachmentParams.toString()}&disposition=inline`;
                              const downloadHref = `/api/mailhub/attachment?${attachmentParams.toString()}&disposition=attachment`;
                              return (
                                <div
                                  key={attachment.id}
                                  className="inline-flex h-9 max-w-full items-center overflow-hidden rounded-md border border-[#dadce0] bg-white text-[13px] text-[#202124] shadow-[0_1px_2px_rgba(60,64,67,0.08)] transition-colors hover:bg-[#f8fafd]"
                                  data-testid="attachment-chip"
                                  title={attachment.filename}
                                >
                                  <a
                                    href={openHref}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex h-full min-w-0 items-center gap-2 px-3 hover:bg-[#f1f3f4] focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/30"
                                    data-testid="attachment-open"
                                    aria-label={`${attachment.filename}を開く${sizeLabel ? `、${sizeLabel}` : ""}`}
                                    title={`${attachment.filename}を開く`}
                                  >
                                    <Paperclip size={15} className="shrink-0 text-[#5f6368]" />
                                    <span className="truncate font-medium" style={{ maxWidth: "min(260px, calc(100vw - 168px))" }}>
                                      {attachment.filename}
                                    </span>
                                    {sizeLabel && <span className="ml-1 shrink-0 text-[11px] text-[#5f6368]">{sizeLabel}</span>}
                                  </a>
                                  <a
                                    href={downloadHref}
                                    download={attachment.filename}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex h-full w-8 shrink-0 items-center justify-center border-l border-[#e8eaed] text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#202124] focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/30"
                                    data-testid="attachment-download"
                                    aria-label={`${attachment.filename}をダウンロード`}
                                    title="ダウンロード"
                                  >
                                    <Download size={15} />
                                  </a>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Conversation (thread) */}
                      {(threadLoading || threadError || (threadSummary?.messages.length ?? 0) > 1) && (
                      <div id="section-conversation" className="mt-4 pt-4 border-t border-[#e8eaed]" data-testid="thread-pane">
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
                            statusCounts.todo ? `今返す ${statusCounts.todo}` : null,
                            statusCounts.waiting ? `返事待ち ${statusCounts.waiting}` : null,
                            statusCounts.done ? `完了 ${statusCounts.done}` : null,
                            statusCounts.muted ? `処理不要 ${statusCounts.muted}` : null,
                          ]
                            .filter(Boolean)
                            .join(" / ");
                          const assigneeText = [
                            assigneeCounts.mine ? `自分 ${assigneeCounts.mine}` : null,
                            assigneeCounts.others ? `他担当 ${assigneeCounts.others}` : null,
                            assigneeCounts.unassigned ? `未担当 ${assigneeCounts.unassigned}` : null,
                          ]
                            .filter(Boolean)
                            .join(" / ");
                          const actionButtonClass =
                            "inline-flex h-7 w-7 shrink-0 items-center justify-center gap-1.5 rounded-md border border-transparent px-0 text-[12px] font-medium text-[#5f6368] transition-colors hover:border-[#dadce0] hover:bg-[#f1f3f4] hover:text-[#202124] active:bg-[#e8eaed] disabled:cursor-not-allowed disabled:opacity-40 min-[1360px]:w-auto min-[1360px]:px-1.5";
                          return (
                            <div className="mb-2 flex flex-nowrap items-center justify-between gap-2 border-y border-[#e8eaed] bg-white py-2" data-testid="thread-actions">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 text-[13px] font-medium text-[#202124]">
                                  <MessageSquare size={15} className="shrink-0 text-[#5f6368]" />
                                  <span className="whitespace-nowrap">{threadSummary.messages.length}件のやりとり</span>
                                  <span className="sr-only">Thread: {threadSummary.messages.length} messages</span>
                                </div>
                                {(summaryText || assigneeText) && (
                                  <div className="mt-0.5 truncate text-[11px] text-[#5f6368]">
                                    {[summaryText, assigneeText].filter(Boolean).join(" / ")}
                                  </div>
                                )}
                              </div>
                              <div className="flex shrink-0 flex-nowrap items-center justify-end gap-1 overflow-visible whitespace-nowrap">
                                <button
                                  type="button"
                                  data-testid="thread-action-done"
                                  className={actionButtonClass}
                                  disabled={readOnlyMode || bulkProgress !== null || threadMessageIds.length === 0}
                                  title={readOnlyMode ? (getWriteBlockedTitle() ?? "実行できません") : "会話を完了"}
                                  onClick={() => {
                                    if (readOnlyMode || bulkProgress !== null) return;
                                    void handleBulkArchive(threadMessageIds);
                                  }}
                                >
                                  <CheckCircle size={15} className="text-[#34a853]" />
                                  <span className="sr-only min-[1360px]:not-sr-only">完了</span>
                                </button>
                                <button
                                  type="button"
                                  data-testid="thread-action-waiting"
                                  className={actionButtonClass}
                                  disabled={readOnlyMode || bulkProgress !== null || threadMessageIds.length === 0}
                                  title={readOnlyMode ? (getWriteBlockedTitle() ?? "実行できません") : "会話を返事待ちにする"}
                                  onClick={() => {
                                    if (readOnlyMode || bulkProgress !== null) return;
                                    void handleBulkWaiting(threadMessageIds);
                                  }}
                                >
                                  <Clock size={15} className="text-[#ea8600]" />
                                  <span className="sr-only min-[1360px]:not-sr-only">返事待ち</span>
                                </button>
                                <button
                                  type="button"
                                  data-testid="thread-action-mute"
                                  className={actionButtonClass}
                                  disabled={readOnlyMode || bulkProgress !== null || threadMessageIds.length === 0}
                                  title={readOnlyMode ? (getWriteBlockedTitle() ?? "実行できません") : "会話を処理不要"}
                                  onClick={() => {
                                    if (readOnlyMode || bulkProgress !== null) return;
                                    void handleBulkMuteSelected(threadMessageIds);
                                  }}
                                >
                                  <VolumeX size={15} className="text-[#5f6368]" />
                                  <span className="sr-only min-[1360px]:not-sr-only">処理不要</span>
                                </button>
                                <button
                                  type="button"
                                  data-testid="thread-action-assign"
                                  className={actionButtonClass}
                                  disabled={readOnlyMode || bulkProgress !== null || threadMessageIds.length === 0}
                                  title={readOnlyMode ? (getWriteBlockedTitle() ?? "実行できません") : "会話を自分に割り当て"}
                                  onClick={() => {
                                    if (readOnlyMode || bulkProgress !== null) return;
                                    void handleBulkAssign(threadMessageIds);
                                  }}
                                >
                                  <UserCheck size={15} className="text-[#1a73e8]" />
                                  <span className="sr-only min-[1360px]:not-sr-only">担当</span>
                                </button>
                                <button
                                  type="button"
                                  data-testid="thread-action-label"
                                  className={actionButtonClass}
                                  disabled={readOnlyMode || bulkProgress !== null || threadMessageIds.length === 0}
                                  title={readOnlyMode ? (getWriteBlockedTitle() ?? "実行できません") : "会話にラベル"}
                                  onClick={() => {
                                    if (readOnlyMode || bulkProgress !== null) return;
                                    // 会話内の全messageIdをcheckedIdsに設定してからLabel Popoverを開く
                                    setCheckedIds(new Set(threadMessageIds));
                                    openLabelPopover();
                                  }}
                                >
                                  <Tag size={15} className="text-[#7b1fa2]" />
                                  <span className="sr-only min-[1360px]:not-sr-only">ラベル</span>
                                </button>
                                <button
                                  type="button"
                                  data-testid="thread-action-select"
                                  className={actionButtonClass}
                                  disabled={threadMessageIds.length === 0}
                                  title="この会話だけをまとめて選択"
                                  onClick={() => {
                                    setCheckedIds(new Set(threadMessageIds));
                                  }}
                                >
                                  <Square size={15} className="text-[#5f6368]" />
                                  <span className="sr-only min-[1360px]:not-sr-only">選択</span>
                                </button>
                                {checkedIds.size > 0 && (
                                  <button
                                    type="button"
                                    data-testid="thread-action-clear"
                                    className={actionButtonClass}
                                    onClick={() => setCheckedIds(new Set())}
                                    title="選択をクリア"
                                  >
                                    <X size={15} className="text-[#5f6368]" />
                                    <span className="sr-only">解除</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          );
	                        })()}

	                        {threadLoading ? (
                          <div className="text-[12px] text-[#5f6368]">読み込み中...</div>
                        ) : threadError ? (
                          <div className="rounded-md border border-[#f28b82] bg-[#fce8e6] p-3 text-[12px] text-[#c5221f]">
                            Conversationの取得に失敗しました: {threadError}
                          </div>
                        ) : !threadSummary || threadSummary.messages.length <= 1 ? (
                          null
                        ) : (
                          <div className="overflow-hidden border-y border-[#e8eaed] bg-white" data-testid="thread-list">
                            {threadSummary.messages.map((m, index) => {
                              const isSelected = m.id === selectedMessage.id;
	                              const expanded = threadExpandedIds.has(m.id);
	                              const showBody = !isSelected && expanded;
                              const bodyState = threadBodies[m.id];
                              const statusLabel =
                                m.statusType === "todo"
                                  ? "今返す"
                                  : m.statusType === "waiting"
                                    ? "返事待ち"
                                    : m.statusType === "done"
                                      ? "完了"
                                      : m.statusType === "muted"
                                        ? "処理不要"
                                        : m.statusType;
                              return (
                                <div
                                  key={m.id}
                                  data-testid="thread-item"
	                                  className={`group border-t border-[#e8eaed] transition-colors first:border-t-0 ${
                                    isSelected ? "bg-[#f8fbff]" : "bg-white hover:bg-[#f8fafd]"
                                  }`}
                                >
                                  <div className={`flex min-h-[46px] items-start gap-3 py-2 ${isSelected ? "border-l-4 border-[#1a73e8] pl-2 pr-3" : "border-l-4 border-transparent pl-2 pr-3"}`}>
	                                    {isSelected ? (
	                                      <div className="mt-0.5 h-7 w-7 shrink-0" aria-hidden="true" />
	                                    ) : (
	                                      <button
	                                        type="button"
	                                        data-testid="thread-expand"
	                                        className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#5f6368] transition-colors hover:bg-[#f1f3f4] hover:text-[#202124] focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/40"
	                                        onClick={() => void toggleThreadExpand(m.id)}
	                                        aria-label={showBody ? "会話を閉じる" : "会話を開く"}
	                                        title={showBody ? "閉じる" : "開く"}
	                                      >
	                                        {showBody ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
	                                      </button>
	                                    )}
                                    <div className="min-w-0 flex-1">
                                      <div className="flex min-w-0 items-center gap-2">
                                        <span className={`truncate text-[13px] ${isSelected ? "font-semibold text-[#202124]" : "font-medium text-[#3c4043]"}`}>
                                          {m.from?.split("<")[0].trim() ?? "(unknown)"}
                                        </span>
                                        {isSelected && (
                                          <span className="shrink-0 rounded-full bg-[#e8f0fe] px-2 py-0.5 text-[10px] font-semibold text-[#1a73e8]">
                                            表示中
                                          </span>
                                        )}
                                        <span className="ml-auto shrink-0 text-[11px] text-[#5f6368]">{m.date}</span>
                                      </div>
                                      <div className="mt-1 flex min-w-0 items-center gap-2 text-[12px] text-[#5f6368]">
                                        <span className="min-w-0 flex-1 truncate text-[#3c4043]">
                                          {m.snippet || "(no snippet)"}
                                        </span>
                                        {m.attachmentCount ? (
                                          <span
                                            className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[#f1f3f4] px-2 py-0.5 text-[10px] font-medium text-[#5f6368]"
                                            title={`添付 ${m.attachmentCount}件`}
                                          >
                                            <Paperclip size={11} />
                                            {m.attachmentCount}
                                          </span>
                                        ) : null}
                                        <span className="shrink-0 rounded-full bg-[#f1f3f4] px-2 py-0.5 text-[10px] font-medium text-[#5f6368]">
                                          {statusLabel}
                                        </span>
                                        {m.assigneeSlug && (
                                          <span className="hidden shrink-0 rounded-full bg-[#f1f3f4] px-2 py-0.5 text-[10px] font-medium text-[#5f6368] sm:inline">
                                            {getAssigneeDisplayName(m.assigneeSlug)}
                                          </span>
                                        )}
                                      </div>
                                      {Array.isArray(m.labels) && m.labels.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-1">
                                          {m.labels.slice(0, 4).map((ln) => (
                                            <span
                                              key={ln}
                                              className="rounded-full border border-[#eadcf8] bg-[#f7f2fb] px-2 py-0.5 text-[10px] font-medium text-[#681da8]"
                                              title={ln}
                                            >
                                              {displayUserLabel(ln)}
                                            </span>
                                          ))}
                                          {m.labels.length > 4 && (
                                            <span className="rounded-full bg-[#f1f3f4] px-2 py-0.5 text-[10px] font-medium text-[#5f6368]">
                                              +{m.labels.length - 4}
                                            </span>
                                          )}
                                        </div>
                                      )}
                                      {showBody && (
                                        <div className="mt-3 border-t border-[#f1f3f4] pt-3" data-testid="thread-body">
	                                          {bodyState?.isLoading ? (
	                                            <div className="text-[12px] text-[#5f6368]">本文を読み込み中...</div>
                                          ) : bodyState?.error ? (
                                            <div className="text-[12px] text-[#c5221f]">本文取得エラー: {bodyState.error}</div>
                                          ) : (
                                            <>
                                              {bodyState?.bodyNotice && (
                                                <div className="mb-2 rounded border border-[#fdd663] bg-[#fef7e0] p-2 text-[12px] text-[#ea8600]">
                                                  {bodyState.bodyNotice}
                                                </div>
                                              )}
                                              <div className="max-h-[420px] overflow-auto whitespace-pre-wrap pr-1 text-[13px] leading-[19px] text-[#202124]">
                                                {bodyState?.plainTextBody || "本文がありません"}
                                              </div>
                                            </>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  {index < threadSummary.messages.length - 1 && (
                                    <div className="ml-12 h-px bg-[#f1f3f4]" aria-hidden="true" />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      )}
                      
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
                                        onClick={() => setWorkTagDraft((prev) => {
                                          const next = prev.filter((x) => x !== t);
                                          workTagDraftRef.current = next;
                                          return next;
                                        })}
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
                                  setWorkTagDraft((prev) => {
                                    const next = (prev.includes(slug) ? prev : [...prev, slug]).slice(0, 20);
                                    workTagDraftRef.current = next;
                                    return next;
                                  });
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
                                  const tags = workTagDraftRef.current;
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
                                      locallySavedWorkTagIdsRef.current.add(messageId);
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
                                setLastAppliedBrainDraft(null);
                              } : undefined}
                            />
                          );
                        })()}

                        {selectedMessage?.id && brainDecision.status !== "idle" && brainDecision.messageId === selectedMessage.id && (
                          <div className="rounded-xl border border-sky-200 bg-sky-50 p-5" data-testid="brain-suggestion-panel">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-2">
                                <Zap size={16} className="text-sky-700" />
                                <div>
                                  <div className="text-[13px] font-bold text-[#202124]">AI判断</div>
                                  <div className="text-[11px] text-[#5f6368]">提案のみ・自動処理なし</div>
                                </div>
                              </div>
                              {brainDecision.status === "ready" && (
                                <span className="rounded-full border border-sky-200 bg-white px-2 py-1 text-[11px] font-semibold text-sky-800" data-testid="brain-suggestion-meta">
                                  {brainDecision.decision.confidence}
                                </span>
                              )}
                            </div>

                            {brainDecision.status === "loading" && (
                              <div className="mt-3 text-[12px] text-[#5f6368]" data-testid="brain-suggestion-loading">
                                判断を読み込み中...
                              </div>
                            )}

                            {brainDecision.status === "error" && (
                              <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-[12px] text-red-700" data-testid="brain-suggestion-error">
                                {brainDecision.message}
                              </div>
                            )}

                            {brainDecision.status === "ready" && (
                              <div className="mt-3 space-y-3" data-testid="brain-suggestion-body">
                                <div className="grid gap-2 sm:grid-cols-3">
                                  <div className="rounded border border-sky-100 bg-white px-3 py-2">
                                    <div className="text-[10px] font-semibold uppercase text-[#5f6368]">種別</div>
                                    <div className="mt-1 text-[13px] font-bold text-[#202124]">{brainDecision.decision.purpose}</div>
                                  </div>
                                  <div className="rounded border border-sky-100 bg-white px-3 py-2">
                                    <div className="text-[10px] font-semibold uppercase text-[#5f6368]">行き先</div>
                                    <div className="mt-1 text-[13px] font-bold text-[#202124]">{brainDecision.decision.disposition}</div>
                                  </div>
                                  <div className="rounded border border-sky-100 bg-white px-3 py-2">
                                    <div className="text-[10px] font-semibold uppercase text-[#5f6368]">返信</div>
                                    <div className="mt-1 text-[13px] font-bold text-[#202124]">{brainDecision.decision.replyRoute}</div>
                                  </div>
                                </div>
                                <div className="rounded border border-sky-100 bg-white px-3 py-2 text-[13px] text-[#202124]">
                                  {brainDecision.decision.nextAction}
                                </div>
                                {brainDecision.decision.evidence.length > 0 && (
                                  <div className="flex flex-wrap gap-2">
                                    {brainDecision.decision.evidence.slice(0, 6).map((item, index) => (
                                      <span
                                        key={`${item.source}-${item.label}-${item.detail}-${index}`}
                                        className="rounded-full border border-sky-200 bg-white px-2 py-1 text-[11px] text-sky-900"
                                      >
                                        {item.label}: {item.detail}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {(brainDecision.decision.discardCandidate || brainDecision.decision.warnings.length > 0) && (
                                  <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-[12px] text-amber-900">
                                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                                    <div>
                                      {brainDecision.decision.discardCandidate
                                        ? "処理不要候補ですが、人の確認が必要です。"
                                        : "人の確認が必要です。"}
                                    </div>
                                  </div>
                                )}
                                {aiDraft.messageId === selectedMessage.id && (
                                  <div className="rounded border border-sky-100 bg-white px-3 py-2" data-testid="brain-draft-panel">
                                    {aiDraft.status === "loading" && (
                                      <div className="text-[12px] text-[#5f6368]" data-testid="brain-draft-loading">
                                        AI下書きを確認中...
                                      </div>
                                    )}
                                    {aiDraft.status === "error" && (
                                      <div className="text-[12px] text-red-700" data-testid="brain-draft-error">
                                        {aiDraft.message}
                                      </div>
                                    )}
                                    {aiDraft.status === "ready" && aiDraft.result.status !== "ready" && (
                                      <div className="text-[12px] text-[#5f6368]" data-testid="brain-draft-blocked">
                                        {aiDraft.result.message}
                                      </div>
                                    )}
                                    {aiDraft.status === "ready" && aiDraft.result.status === "ready" && (
                                      <div className="space-y-2" data-testid="brain-draft-ready">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <div>
                                            <div className="text-[12px] font-semibold text-[#202124]">{aiDraft.result.suggestion.title}</div>
                                            <div className="text-[11px] text-[#5f6368]">
                                              hash {aiDraft.result.suggestion.bodyHash} / {aiDraft.result.suggestion.bodyLength}字
                                            </div>
                                          </div>
                                          <button
                                            type="button"
                                            data-testid="brain-draft-insert"
                                            onClick={() => {
                                              const suggestion = aiDraft.result.suggestion;
                                              if (suggestion) handleInsertBrainDraft(suggestion);
                                            }}
                                            disabled={readOnlyMode || replyRoute?.kind !== aiDraft.result.suggestion.route}
                                            className="rounded border border-sky-200 bg-sky-50 px-3 py-1.5 text-[12px] font-semibold text-sky-800 hover:bg-sky-100 disabled:cursor-not-allowed disabled:border-[#e8eaed] disabled:bg-[#f1f3f4] disabled:text-[#9aa0a6]"
                                          >
                                            返信欄に挿入
                                          </button>
                                        </div>
                                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-[#e8eaed] bg-[#f8fafd] p-2 text-[12px] leading-5 text-[#202124]" data-testid="brain-draft-preview">
                                          {aiDraft.result.suggestion.body}
                                        </pre>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Replyブロック（Step55: 返信導線の最短化） */}
                        {replyRoute?.kind === "rakuten_rms" && (
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
                                {lastAppliedBrainDraft && (
                                  <div className="mt-2 text-[12px] text-gray-600" data-testid="brain-draft-applied">
                                    AI下書き: <span className="font-semibold">{lastAppliedBrainDraft.title}</span>{" "}
                                    <span className="text-[10px] font-mono text-gray-500">({lastAppliedBrainDraft.bodyHash})</span>
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
                                      disabled={!testMode || !replyInquiryNumber || !replyMessage.trim() || isSendingReply || readOnlyMode}
                                      title={testMode ? "TEST_MODEのRMS送信シミュレーション" : "RMS API直接送信は未実装です。RMSを開く/コピーを使ってください"}
                                      className="px-4 py-2 bg-orange-600 text-white hover:bg-orange-500 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed rounded-md text-sm font-medium transition-colors flex items-center gap-2"
                                    >
                                      <Send size={14} />
                                      {isSendingReply ? "送信中..." : testMode ? "送信（RMS TEST）" : "RMS API未実装"}
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
                                    title={readOnlyMode ? "READ ONLYのため実行できません" : "返信完了（対応済み）"}
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
                                    title={readOnlyMode ? "READ ONLYのため実行できません" : "返信完了（返事待ち）"}
                                  >
                                    <Clock size={14} />
                                    {isCompletingReply && replyCompleteStatus === "waiting" ? "処理中..." : "返信完了（返事待ち）"}
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {showGmailComposePanel && selectedMessage && (
                          <div id="section-reply" className="mt-8 pt-8 border-t border-gray-200" data-testid="reply-panel">
                            <div className="flex items-center justify-between gap-3 mb-2">
                              <span className="text-xs text-gray-500" data-testid="reply-route">gmail</span>
                              {gmailReplyOwnershipShield?.ok === false ? (
                                <div className="flex flex-wrap justify-end gap-1.5" data-testid="gmail-external-reply-blocked-actions">
                                  <button
                                    type="button"
                                    disabled
                                    data-testid="gmail-external-reply-disabled"
                                    title={gmailReplyOwnershipShield.message}
                                    className="flex cursor-not-allowed items-center gap-1 rounded-md bg-gray-100 px-3 py-2 text-xs font-medium text-gray-400"
                                  >
                                    <ExternalLink size={14} />
                                    Gmailで返信
                                  </button>
                                  <button
                                    type="button"
                                    data-testid="gmail-external-reply-ownership-action"
                                    onClick={handleGmailTakeOwnership}
                                    disabled={readOnlyMode || actionInProgress.has(selectedMessage.id)}
                                    title={readOnlyMode ? "READ ONLYのため担当変更できません" : selectedOwnerActionTitle}
                                    className="flex items-center gap-1 rounded-md border border-[#d2e3fc] bg-[#e8f0fe] px-3 py-2 text-xs font-semibold text-[#1a73e8] transition-colors hover:bg-[#d2e3fc] disabled:cursor-not-allowed disabled:border-[#e8eaed] disabled:bg-[#f1f3f4] disabled:text-[#9aa0a6]"
                                  >
                                    <UserCheck size={14} />
                                    {actionInProgress.has(selectedMessage.id) ? "処理中" : selectedOwnerActionLabel}
                                  </button>
                                </div>
                              ) : (
                                <a
                                  href={buildGmailReplyLink(selectedMessage.gmailLink, selectedMessage.threadId)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  data-testid="gmail-external-reply-link"
                                  className="px-3 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-md text-xs font-medium transition-colors flex items-center gap-1"
                                >
                                  <ExternalLink size={14} />
                                  Gmailで返信
                                </a>
                              )}
                            </div>
                            <GmailComposePanel
                              messageId={selectedMessage.id}
                              fromAlias={gmailResolvedContext?.ok ? gmailResolvedContext.context.fromAlias : null}
                              fromLabel={gmailResolvedContext?.ok ? gmailResolvedContext.context.fromChannelLabel : null}
                              to={gmailResolvedContext?.ok ? gmailResolvedContext.context.to : null}
                              subject={gmailResolvedContext?.ok ? gmailResolvedContext.context.subject : (selectedMessage.subject ?? "(no subject)")}
                              bodyText={replyMessage}
                              unresolvedVars={gmailUnresolvedVars}
                              readOnly={readOnlyMode}
                              sendEnabled={sendEnabledFromHealth}
                              sendDisabledReason={gmailSendDisabledReason}
                              isSendingGmailReply={isSendingGmailReply}
                              isTakingOwnership={actionInProgress.has(selectedMessage.id)}
                              sentStatus={gmailSentStatus}
                              replyOwnershipShield={gmailReplyOwnershipShield}
                              errorMessage={gmailSendError ?? gmailResolveErrorMessage}
                              onBodyChange={(value) => {
                                setReplyMessage(value);
                                setGmailSendError(null);
                              }}
                              onSend={(postSendAction) => {
                                void handleGmailSend(postSendAction);
                              }}
                              onTakeOwnership={handleGmailTakeOwnership}
                              onCancel={handleGmailCancel}
                            />
                            {lastAppliedBrainDraft && (
                              <div className="mt-2 rounded border border-sky-100 bg-sky-50 px-3 py-2 text-[12px] text-sky-900" data-testid="brain-draft-applied">
                                AI下書き: <span className="font-semibold">{lastAppliedBrainDraft.title}</span>{" "}
                                <span className="font-mono text-[10px]">{lastAppliedBrainDraft.bodyHash}</span>
                              </div>
                            )}
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
                                    {replyCompleteStatus === "done" ? "対応済み" : replyCompleteStatus === "waiting" ? "返事待ち" : "処理不要"}
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
                { keys: ["E"], desc: "対応済みにする" },
                { keys: ["W"], desc: "返事待ちにする" },
                { keys: ["C"], desc: "対応中（Claim）" },
                { keys: ["A"], desc: "担当トグル（Assign/Unassign）" },
                { keys: ["S"], desc: "長く残っているメールを表示" },
                { keys: ["Shift", "S"], desc: "特に長く残っているメールだけ表示" },
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
                  {opsSummary.productionReadiness && (
                    <div
                      className={`rounded-lg border p-3 ${
                        opsSummary.productionReadiness.repoHeadMatches === false
                          ? "border-yellow-500/30 bg-yellow-500/10"
                          : opsSummary.productionReadiness.productionReady
                          ? "border-emerald-500/30 bg-emerald-500/10"
                          : "border-red-500/30 bg-red-500/10"
                      }`}
                      data-testid="ops-production-readiness"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className={`flex items-center gap-2 text-sm font-bold ${
                            opsSummary.productionReadiness.repoHeadMatches === false
                              ? "text-yellow-300"
                              : opsSummary.productionReadiness.productionReady
                                ? "text-emerald-300"
                                : "text-red-300"
                          }`}>
                            {opsSummary.productionReadiness.productionReady && opsSummary.productionReadiness.repoHeadMatches !== false ? (
                              <CheckCircle className="h-4 w-4 shrink-0" />
                            ) : (
                              <AlertTriangle className="h-4 w-4 shrink-0" />
                            )}
                            <span>
                              {opsSummary.productionReadiness.repoHeadMatches === false
                                ? "本番判定 再監査必要"
                                : opsSummary.productionReadiness.productionReady
                                  ? "本番判定 OK"
                                  : "本番判定 保留"}
                            </span>
                          </div>
                          <div className="mt-1 text-xs leading-relaxed text-slate-300">
                            {opsSummary.productionReadiness.available
                              ? opsSummary.productionReadiness.repoHeadMatches === false
                                ? "readiness 監査成果物が現在のコードHEADと一致していません。監査を再実行してください。"
                                : opsSummary.productionReadiness.productionReady
                                ? "source coverage・routing・view/rule safety のゲートを通過しています。"
                                : `残P0: ${opsSummary.productionReadiness.p0Blockers.join(", ") || "なし"}`
                              : "readiness 監査成果物がありません。"}
                          </div>
                          {opsSummary.productionReadiness.available && (
                            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300">
                              <div className="rounded border border-slate-700/60 bg-slate-950/30 px-2 py-1">
                                未確認チャンネル: {opsSummary.productionReadiness.unconfirmedChannels.length}
                              </div>
                              <div className="rounded border border-slate-700/60 bg-slate-950/30 px-2 py-1">
                                未到達probe宛先: {opsSummary.productionReadiness.missingProbeAddresses.length}
                              </div>
                              <div className="rounded border border-slate-700/60 bg-slate-950/30 px-2 py-1">
                                SMTP preflight: {opsSummary.productionReadiness.routingProbePreflightReady ? "OK" : "未完了"}
                              </div>
                              <div className="rounded border border-slate-700/60 bg-slate-950/30 px-2 py-1">
                                SMTP不足env: {opsSummary.productionReadiness.missingProbeSmtpEnv.length}
                              </div>
                              <div className="rounded border border-slate-700/60 bg-slate-950/30 px-2 py-1">
                                Actions secrets: {opsSummary.productionReadiness.routingProbeGithubSecretsReady ? "OK" : "未完了"}
                              </div>
                              <div className="rounded border border-slate-700/60 bg-slate-950/30 px-2 py-1">
                                Actions不足: {opsSummary.productionReadiness.missingGithubRoutingSecrets.length}
                              </div>
                              <div className="rounded border border-slate-700/60 bg-slate-950/30 px-2 py-1">
                                Actions SMTP: {opsSummary.productionReadiness.githubExternalSmtpSecretsReady ? "OK" : "未完了"}
                              </div>
                              <div className="rounded border border-slate-700/60 bg-slate-950/30 px-2 py-1">
                                Actions Gmail: {opsSummary.productionReadiness.githubGmailProofSecretsReady ? "OK" : "未完了"}
                              </div>
                              <div className="rounded border border-slate-700/60 bg-slate-950/30 px-2 py-1">
                                View構文: {opsSummary.productionReadiness.defaultViewsRealDataValidated ? "OK" : "要確認"}
                              </div>
                              <div className="rounded border border-slate-700/60 bg-slate-950/30 px-2 py-1">
                                View用途: {opsSummary.productionReadiness.defaultViewsBulkAutomationSafe ? "一括可" : "手動確認のみ"}
                              </div>
                              <div className="rounded border border-slate-700/60 bg-slate-950/30 px-2 py-1">
                                一括不可View: {opsSummary.productionReadiness.defaultViewsBulkUnsafeViews.length}
                              </div>
                              <div className="rounded border border-slate-700/60 bg-slate-950/30 px-2 py-1">
                                Rule安全性: {opsSummary.productionReadiness.currentRuleConfigRealDataSafetyReady ? "OK" : "要確認"}
                              </div>
                              <div className="rounded border border-slate-700/60 bg-slate-950/30 px-2 py-1">
                                手動View: {opsSummary.productionReadiness.defaultViewsManualReviewOnly ? "あり" : "なし"}
                              </div>
                              <div className="rounded border border-slate-700/60 bg-slate-950/30 px-2 py-1">
                                Rule指紋: {opsSummary.productionReadiness.currentRuleConfigFingerprintPresent ? "OK" : "なし"}
                              </div>
                              <div className="rounded border border-slate-700/60 bg-slate-950/30 px-2 py-1 truncate">
                                Rule設定元: {opsSummary.productionReadiness.currentRuleConfigSourceProductionReady ? "Sheets" : (opsSummary.productionReadiness.ruleConfigSourceResolved || "未取得")}
                              </div>
                              <div className="rounded border border-slate-700/60 bg-slate-950/30 px-2 py-1 truncate">
                                Rule hash: {opsSummary.productionReadiness.ruleConfigFingerprint?.slice(7, 19) || "未取得"}
                              </div>
                              {opsSummary.productionReadiness.missingProbeSmtpEnv.length > 0 && (
                                <div className="col-span-2 rounded border border-slate-700/60 bg-slate-950/30 px-2 py-1 break-words">
                                  不足: {opsSummary.productionReadiness.missingProbeSmtpEnv.join(", ")}
                                </div>
                              )}
                              {opsSummary.productionReadiness.missingGithubRoutingSecrets.length > 0 && (
                                <div className="col-span-2 rounded border border-slate-700/60 bg-slate-950/30 px-2 py-1 break-words">
                                  Actions不足: {opsSummary.productionReadiness.missingGithubRoutingSecrets.join(", ")}
                                </div>
                              )}
                              {opsSummary.productionReadiness.missingGithubExternalSmtpSecrets.length > 0 && (
                                <div className="col-span-2 rounded border border-slate-700/60 bg-slate-950/30 px-2 py-1 break-words">
                                  Actions SMTP不足: {opsSummary.productionReadiness.missingGithubExternalSmtpSecrets.join(", ")}
                                </div>
                              )}
                              {opsSummary.productionReadiness.defaultViewsBulkUnsafeViews.length > 0 && (
                                <div className="col-span-2 rounded border border-slate-700/60 bg-slate-950/30 px-2 py-1 break-words">
                                  一括不可View: {opsSummary.productionReadiness.defaultViewsBulkUnsafeViews.join(", ")}
                                </div>
                              )}
                              {opsSummary.productionReadiness.missingGithubGmailProofSecrets.length > 0 && (
                                <div className="col-span-2 rounded border border-slate-700/60 bg-slate-950/30 px-2 py-1 break-words">
                                  Actions Gmail不足: {opsSummary.productionReadiness.missingGithubGmailProofSecrets.join(", ")}
                                </div>
                              )}
                              <div className="col-span-2 rounded border border-slate-700/60 bg-slate-950/30 px-2 py-1">
                                MX: {opsSummary.productionReadiness.mxRecords.map((record) => `${record.priority} ${record.exchange}`).join(", ") || "未取得"}
                              </div>
                              {opsSummary.productionReadiness.auditRepoHead && (
                                <div className="col-span-2 rounded border border-slate-700/60 bg-slate-950/30 px-2 py-1">
                                  audit HEAD: {opsSummary.productionReadiness.auditRepoHead.slice(0, 7)}
                                  {opsSummary.productionReadiness.currentRepoHead
                                    ? ` / current: ${opsSummary.productionReadiness.currentRepoHead.slice(0, 7)}`
                                    : " / current: 不明"}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        {opsSummary.productionReadiness.generatedAt && (
                          <div className="shrink-0 text-right text-[11px] text-slate-500">
                            {new Date(opsSummary.productionReadiness.generatedAt).toLocaleString("ja-JP")}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 今返す: 特に長く残っている */}
                  {opsSummary.todo.critical.count > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="text-sm font-bold text-red-400">今返す・特に長い ({opsSummary.todo.critical.count}件)</h4>
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

                  {/* 今返す: 長く残っている */}
                  {opsSummary.todo.warn.count > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="text-sm font-bold text-yellow-400">今返す・長く残っている ({opsSummary.todo.warn.count}件)</h4>
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

                  {/* 返事待ち: 特に長く残っている */}
                  {opsSummary.waiting.critical.count > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="text-sm font-bold text-red-400">返事待ち・特に長い ({opsSummary.waiting.critical.count}件)</h4>
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

                  {/* 返事待ち: 長く残っている */}
                  {opsSummary.waiting.warn.count > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="text-sm font-bold text-yellow-400">返事待ち・長く残っている ({opsSummary.waiting.warn.count}件)</h4>
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

                  {/* 誰かが取る: 特に長く残っている */}
                  {opsSummary.unassigned.critical.count > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="text-sm font-bold text-red-400">誰かが取る・特に長い ({opsSummary.unassigned.critical.count}件)</h4>
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

                  {/* 誰かが取る: 長く残っている */}
                  {opsSummary.unassigned.warn.count > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="text-sm font-bold text-yellow-400">誰かが取る・長く残っている ({opsSummary.unassigned.warn.count}件)</h4>
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

      {/* 候補の一括処理不要（E2E互換: TEST_MODEでは確認UIを表示） */}
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
            <div className="text-sm font-bold text-[#202124]">候補を一括で処理不要へ</div>
            <div className="mt-1 text-xs text-gray-600">
              {triageCandidates.length}件を処理不要へ移動します。
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

      {senderMutePreview && (
        <div
          className="fixed inset-0 z-[195] flex items-center justify-center bg-black/30 px-4"
          data-testid="sender-mute-preview"
          onClick={() => {
            if (!senderMutePreview.isExecuting) setSenderMutePreview(null);
          }}
        >
          <div
            className="w-full max-w-lg bg-white rounded-xl shadow-2xl border border-gray-200 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-bold text-[#202124]">同じ送信元を処理不要へ</div>
                <div className="mt-1 text-xs text-[#5f6368] truncate" title={senderMutePreview.fromEmail}>
                  from:{senderMutePreview.fromEmail}
                </div>
              </div>
              <button
                type="button"
                className="rounded p-1 text-[#5f6368] hover:bg-[#f1f3f4]"
                onClick={() => setSenderMutePreview(null)}
                disabled={senderMutePreview.isExecuting}
                title="閉じる"
              >
                <X size={18} />
              </button>
            </div>

            {senderMutePreview.isLoading ? (
              <div className="py-8 text-center text-sm text-[#5f6368]">同じ送信元の未処理メールを探しています...</div>
            ) : senderMutePreview.error ? (
              <div className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {senderMutePreview.error}
              </div>
            ) : (
              <>
                <div className="mt-4 rounded border border-[#e8eaed] bg-[#f8fbff] px-3 py-2 text-xs text-[#3c4043]">
                  実行対象 {senderMutePreview.messages.length}件 / 保護 {senderMutePreview.protectedCount}件 / 未判定 {senderMutePreview.missingSummaryCount}件 / 対象外 {senderMutePreview.notNoiseCount}件
                  {senderMutePreview.warningCount > 0 ? ` / 警告 ${senderMutePreview.warningCount}件` : ""}
                </div>
                <div className="mt-3 max-h-56 overflow-auto rounded border border-[#e8eaed]">
                  {senderMutePreview.messages.length === 0 ? (
                    <div className="p-4 text-sm text-[#5f6368]">安全に処理不要へ移動できる対象メールはありません</div>
                  ) : (
                    senderMutePreview.messages.slice(0, 12).map((message) => (
                      <div key={message.id} className="border-b border-[#f1f3f4] px-3 py-2 last:border-b-0">
                        <div className="truncate text-[13px] font-medium text-[#202124]">{message.subject ?? "(no subject)"}</div>
                        <div className="mt-0.5 truncate text-[11px] text-[#5f6368]">{message.from ?? "from unknown"}</div>
                      </div>
                    ))
                  )}
                </div>
                {senderMutePreview.messages.length > 12 && (
                  <div className="mt-2 text-[11px] text-[#5f6368]">ほか {senderMutePreview.messages.length - 12}件</div>
                )}
              </>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                className="px-3 py-2 text-xs font-bold rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                onClick={() => setSenderMutePreview(null)}
                disabled={senderMutePreview.isExecuting}
              >
                キャンセル
              </button>
              <button
                data-testid="sender-mute-execute"
                className="px-3 py-2 text-xs font-bold rounded-md bg-yellow-600 text-white hover:bg-yellow-700 disabled:opacity-50"
                onClick={() => void executeSenderMutePreview()}
                disabled={senderMutePreview.isLoading || senderMutePreview.isExecuting || senderMutePreview.messages.length === 0}
              >
                {senderMutePreview.isExecuting ? "処理中..." : "まとめて処理不要"}
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
              {pendingBulkConfirm.action === "bulkDone" && `${pendingBulkConfirm.ids.length}件のメールを対応済みにします。よろしいですか？`}
              {pendingBulkConfirm.action === "bulkMute" && `${pendingBulkConfirm.ids.length}件のメールを処理不要にします。よろしいですか？`}
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
            <div className="text-sm font-semibold text-gray-900 mb-2">理由の入力（引き継ぎ）</div>
            <div className="text-xs leading-5 text-gray-600">
              {pendingReasonModal.action === "takeover" && "他の担当者の対応を自分側へ引き継ぎます。理由はActivityに残ります。"}
            </div>
            {pendingReasonContext && (
              <div
                className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
                data-testid="audit-reason-context"
              >
                <div className="font-semibold text-amber-950" data-testid="audit-reason-subject">
                  {pendingReasonContext.subject}
                </div>
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  <div className="rounded-md border border-amber-200 bg-white px-2 py-1.5" data-testid="audit-reason-current-owner">
                    <div className="text-[11px] text-amber-700">現在の担当</div>
                    <div className="font-semibold">{pendingReasonContext.currentOwnerName}</div>
                  </div>
                  <div className="rounded-md border border-[#d2e3fc] bg-white px-2 py-1.5" data-testid="audit-reason-next-owner">
                    <div className="text-[11px] text-[#1a73e8]">引き継ぎ先</div>
                    <div className="font-semibold text-[#1a73e8]">{pendingReasonContext.nextOwnerLabel}</div>
                  </div>
                </div>
                {pendingReasonContext.isGmailReply && (
                  <div className="mt-2 rounded-md border border-[#d2e3fc] bg-[#e8f0fe] px-2 py-1.5 text-[#174ea6]" data-testid="audit-reason-reply-note">
                    Gmail返信は、引き継ぎ完了後に有効になります。
                  </div>
                )}
              </div>
            )}
            <label htmlFor="audit-reason-input" className="mt-3 block text-xs font-medium text-gray-700">
              理由
            </label>
            <textarea
              id="audit-reason-input"
              data-testid="audit-reason-input"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              placeholder="例: 休暇対応のため引き継ぎ"
              rows={3}
              className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
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
                理由を記録して引き継ぐ
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
