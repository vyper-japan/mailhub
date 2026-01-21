"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { isBroadDomain, normalizeDomain } from "@/lib/ruleSafety";
import { buildMailhubLabelName, MAILHUB_USER_LABEL_PREFIX, slugifyMailhubLabel } from "@/lib/mailhub-labels";
import type { View } from "@/lib/views";
import { normalizeVtjEmail } from "@/lib/assigneeRules";

type SettingsMode = "drawer" | "page";

type RegisteredLabel = { labelName: string; displayName?: string; createdAt: string };
type LabelRule = {
  id: string;
  match: { fromEmail?: string; fromDomain?: string };
  labelNames?: string[];
  labelName?: string; // backward-compat
  assignTo?: "me" | { assigneeEmail: string }; // Step 84
  enabled: boolean;
  createdAt: string;
};

type ReplyTemplate = {
  id: string;
  title: string;
  route?: "rakuten_rms" | "gmail" | "any";
  body: string;
  updatedAt: string;
  updatedBy: string;
};

type TeamMember = {
  email: string;
  name: string | null;
  createdAt: string;
  updatedAt?: string;
};

type PreviewResult = {
  matchedCount: number;
  matchedIds: string[];
  samples: Array<{ id: string; subject: string | null; from: string | null }>;
  max: number;
  truncated: boolean;
};

type AssigneeRule = {
  id: string;
  enabled: boolean;
  priority: number;
  match: { fromEmail?: string; fromDomain?: string };
  assigneeEmail: string;
  when: { unassignedOnly: boolean };
  safety: { dangerousDomainConfirm: boolean };
  createdAt: string;
  updatedAt?: string;
};

type AssigneeApplyPreview = {
  matchedCount: number;
  matchedIds: string[];
  samples: Array<{ id: string; subject: string | null; from: string | null; assigneeEmail: string; ruleId: string }>;
  max: number;
  truncated: boolean;
  warnings: Array<{ type: "broad_domain" | "too_many"; message: string }>;
};

type ConfigHealth = {
  env?: "local" | "staging" | "production";
  storeType: "memory" | "file" | "sheets";
  configStore?: {
    requested: string | null;
    resolved: "memory" | "file" | "sheets";
    sheetsConfigured: boolean;
    sheetsOk: boolean | null;
    sheetsDetail: string | null;
  };
  activityStore?: { requested: string; resolved: "memory" | "file" | "sheets"; sheetsConfigured: boolean };
  isAdmin: boolean;
  readOnly: boolean;
  gmailScopes: string[] | null;
  gmailModifyEnabled: boolean | null;
  gmailScopeError: string | null;
  sharedInboxEmailMasked: string | null;
  labelPrefix: string;
  writeGuards: { readOnly: boolean; isAdmin: boolean; testMode: boolean; productionTestModeForcedOff: boolean };
  adminsConfigured: boolean;
  adminInvalidCount: number;
  adminNonVtjCount: number;
  readOk: boolean;
  readError: string | null;
  labelsCount: number;
  rulesCount: number;
  sheets: null | { configured: boolean; ok: boolean | null; detail: string | null };
};

type ImportPreview = {
  labels: {
    sourceCount: number;
    targetCount: number;
    willAdd: number;
    willUpdate: number;
    willSkip: number;
    add: Array<{ labelName: string; afterDisplayName?: string }>;
    update: Array<{ labelName: string; beforeDisplayName?: string; afterDisplayName?: string }>;
    skip: Array<{ labelName: string }>;
  };
  rules: {
    sourceCount: number;
    targetCount: number;
    willAdd: number;
    willUpdate: number;
    willSkip: number;
    add: Array<{ id: string }>;
    update: Array<{ id: string }>;
    skip: Array<{ id: string }>;
  };
  warnings: Array<{ level: "danger"; message: string; totalChanges: number; threshold: number }>;
  requiresConfirm: boolean;
  previewToken?: string;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const data = (await res.json().catch(() => ({} as Record<string, unknown>))) as Record<string, unknown>;
  if (!res.ok) {
    const msg =
      (typeof data.message === "string" ? data.message : undefined) ||
      (typeof data.error === "string" ? data.error : undefined) ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export function SettingsPanel({ mode, onOpenActivity }: { mode: SettingsMode; onOpenActivity?: (ruleId?: string) => void }) {
  const [tab, setTab] = useState<"labels" | "rules" | "templates" | "auto-assign" | "views" | "team" | "assignees" | "diagnostics" | "suggestions" | "queues">("labels");
  const [toast, setToast] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [labels, setLabels] = useState<RegisteredLabel[]>([]);
  const [rules, setRules] = useState<LabelRule[]>([]);
  const [assigneeRules, setAssigneeRules] = useState<AssigneeRule[]>([]);
  const [templates, setTemplates] = useState<ReplyTemplate[]>([]);
  const [views, setViews] = useState<View[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [roster, setRoster] = useState<string[]>([]);
  const [rosterDraft, setRosterDraft] = useState<string>("");
  // Step 80: Assignees（担当者名簿）
  const [assignees, setAssignees] = useState<Array<{ email: string; displayName: string | null }>>([]);
  const [assigneesDraft, setAssigneesDraft] = useState<Array<{ email: string; displayName: string | null }>>([]);
  const [assigneesSaving, setAssigneesSaving] = useState(false);
  const [savedSearches, setSavedSearches] = useState<Array<{ id: string; name: string; query: string; baseLabelId?: string | null }>>([]);
  const [newQueueName, setNewQueueName] = useState("");
  const [newQueueQuery, setNewQueueQuery] = useState("");
  const [newQueueBaseLabelId, setNewQueueBaseLabelId] = useState<string | null>(null);
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null);

  const [labelQuery, setLabelQuery] = useState("");
  const [newLabelDisplayName, setNewLabelDisplayName] = useState("");

  const [ruleLabelSelection, setRuleLabelSelection] = useState<Record<string, boolean>>({});
  const [matchMode, setMatchMode] = useState<"email" | "domain">("email");
  const [matchValue, setMatchValue] = useState("");
  // Step 84: Auto RulesにAssignee選択を追加
  const [ruleAssignTo, setRuleAssignTo] = useState<"" | "me" | string>(""); // "" = 未設定, "me" = 自分, それ以外 = email
  const [ruleAssigneeOptions, setRuleAssigneeOptions] = useState<Array<{ email: string; displayName: string | null }>>([]);

  const [previewByRuleId, setPreviewByRuleId] = useState<Record<string, PreviewResult | null>>({});
  const [isBusyRuleId, setIsBusyRuleId] = useState<string | null>(null);

  const [assigneeMatchMode, setAssigneeMatchMode] = useState<"email" | "domain">("domain");
  const [assigneeMatchValue, setAssigneeMatchValue] = useState("");
  const [assigneeEmailInput, setAssigneeEmailInput] = useState("");
  const [assigneePriority, setAssigneePriority] = useState<number>(0);
  const [assigneeDraftById, setAssigneeDraftById] = useState<Record<string, { enabled: boolean; priority: number; matchMode: "email" | "domain"; matchValue: string; assigneeEmail: string }>>({});
  const [assigneePreview, setAssigneePreview] = useState<AssigneeApplyPreview | null>(null);
  const [isBusyAssignee, setIsBusyAssignee] = useState(false);
  const [configHealth, setConfigHealth] = useState<ConfigHealth | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [lastExportAt, setLastExportAt] = useState<string | null>(null);
  // Step 53: Auto Rules Runner
  const [runAllResult, setRunAllResult] = useState<{
    mode: "dryRun" | "apply";
    truncated: boolean;
    totalCandidates: number;
    totalApplied: number;
    totalSkipped: number;
    totalFailed: number;
    perRule: Array<{
      ruleId: string;
      candidates: number;
      applied: number;
      skipped: number;
      failed: number;
      failedIds: string[];
      truncated: boolean;
    }>;
  } | null>(null);
  const [isRunningAll, setIsRunningAll] = useState(false);

  // Diagnostics
  type RuleInspection = {
    conflicts: Array<{
      type: "label_label" | "assignee_assignee" | "cross_type";
      ruleIds: string[];
      matchCondition: { fromEmail?: string; fromDomain?: string };
      conflictingResults: Array<{ ruleId: string; result: string | string[] }>;
      message: string;
    }>;
    dangerous: Array<{
      ruleId: string;
      ruleType: "label" | "assignee";
      reason: "broad_domain" | "too_many_matches";
      matchCondition: { fromEmail?: string; fromDomain?: string };
      message: string;
      previewCount?: number;
    }>;
    inactive: Array<{
      ruleId: string;
      ruleType: "label" | "assignee";
      matchCondition: { fromEmail?: string; fromDomain?: string };
      message: string;
    }>;
    hitStats: Array<{
      ruleId: string;
      ruleType: "label" | "assignee";
      hitCount: number;
      sampleMessages: Array<{ id: string; subject: string | null; from: string | null }>;
    }>;
  };
  const [ruleInspection, setRuleInspection] = useState<RuleInspection | null>(null);
  const [isLoadingInspection, setIsLoadingInspection] = useState(false);

  // Suggestions
  type RuleSuggestion = {
    suggestionId: string;
    type: "auto_label" | "auto_mute" | "auto_assign";
    sender: { fromEmail?: string; fromDomain?: string };
    reason: string;
    evidenceCount: number;
    actorCount: number;
    actors: string[];
    proposedRule: {
      match: { fromEmail?: string; fromDomain?: string };
      labelNames?: string[];
      assigneeEmail?: string;
    };
    warnings: Array<{ type: "broad_domain" | "too_many_matches"; message: string }>;
  };
  const [ruleSuggestions, setRuleSuggestions] = useState<{ suggestions: RuleSuggestion[]; warnings: Array<{ type: string; message: string }> } | null>(null);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [suggestionDays, setSuggestionDays] = useState(14);
  const [suggestionMinActions, setSuggestionMinActions] = useState(3);
  const [suggestionMinActors, setSuggestionMinActors] = useState(2);

  // Rule Stats
  type RuleStats = {
    ruleId: string;
    enabled: boolean;
    lastPreviewAt: string | null;
    lastApplyAt: string | null;
    appliedMessagesCount7d: number;
    appliedMessagesCount30d: number;
    lastApplySummary: {
      processed: number;
      matched: number;
      applied: number;
      skipped: number;
      failed: number;
    } | null;
  };
  const [ruleStats, setRuleStats] = useState<Record<string, RuleStats>>({});

  const [newTemplateTitle, setNewTemplateTitle] = useState("");
  const [newTemplateRoute, setNewTemplateRoute] = useState<"rakuten_rms" | "gmail" | "any">("any");
  const [newTemplateBody, setNewTemplateBody] = useState("");
  const [templateDraftById, setTemplateDraftById] = useState<Record<string, { title: string; route: "rakuten_rms" | "gmail" | "any"; body: string }>>({});

  const [newViewName, setNewViewName] = useState("");
  const [newViewIcon, setNewViewIcon] = useState("");
  const [newViewLabelId, setNewViewLabelId] = useState("todo");
  const [newViewQ, setNewViewQ] = useState("");
  const [newViewPinned, setNewViewPinned] = useState(true);
  const [viewDraftById, setViewDraftById] = useState<Record<string, { name: string; icon: string; labelId: string; q: string; pinned: boolean }>>({});

  const [newTeamEmail, setNewTeamEmail] = useState("");
  const [newTeamName, setNewTeamName] = useState("");
  const [teamDraftById, setTeamDraftById] = useState<Record<string, { name: string | null }>>({});

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const showError = useCallback((msg: string) => {
    setErrorBanner(msg);
    showToast(msg);
  }, [showToast]);

  const load = useCallback(async () => {
    try {
      const [l, r, ar, t, v, tm, q] = await Promise.all([
        fetchJson<{ labels: RegisteredLabel[] }>("/api/mailhub/labels"),
        fetchJson<{ rules: LabelRule[] }>("/api/mailhub/rules"),
        fetchJson<{ rules: AssigneeRule[] }>("/api/mailhub/assignee-rules"),
        fetchJson<{ templates: ReplyTemplate[] }>("/api/mailhub/templates"),
        fetchJson<{ views: View[] }>("/api/mailhub/views"),
        fetchJson<{ team: TeamMember[]; roster?: string[] }>("/api/mailhub/team"),
        fetchJson<{ searches: Array<{ id: string; name: string; query: string; baseLabelId?: string | null }> }>("/api/mailhub/queues").catch(() => ({ searches: [] })),
      ]);
      setLabels(l.labels ?? []);
      setRules(r.rules ?? []);
      setAssigneeRules(ar.rules ?? []);
      setTemplates(t.templates ?? []);
      setViews(v.views ?? []);
      setTeam(tm.team ?? []);
      setRoster(tm.roster ?? []);
      setSavedSearches(q.searches ?? []);
      setErrorBanner(null);
    } catch (e) {
      showError(`設定の読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [showError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const h = await fetchJson<ConfigHealth>("/api/mailhub/config/health");
        setConfigHealth(h);
      } catch {
        setConfigHealth(null);
      }
    })();
  }, []);

  // Step 84: Auto Rules用Assignee一覧を取得
  useEffect(() => {
    void (async () => {
      try {
        const data = await fetchJson<{ assignees: Array<{ email: string; displayName?: string | null }> }>("/api/mailhub/assignees");
        setRuleAssigneeOptions(data.assignees.map((a) => ({ email: a.email, displayName: a.displayName ?? null })));
      } catch {
        setRuleAssigneeOptions([]);
      }
    })();
  }, []);

  const loadRuleInspection = useCallback(async () => {
    setIsLoadingInspection(true);
    try {
      const res = await fetchJson<{ inspection: RuleInspection }>("/api/mailhub/rules/inspect?type=all&sampleSize=50");
      setRuleInspection(res.inspection);
    } catch (e) {
      showError(`ルール診断の読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      setRuleInspection(null);
    } finally {
      setIsLoadingInspection(false);
    }
  }, [showError]);

  useEffect(() => {
    if (tab === "diagnostics") {
      void loadRuleInspection();
    }
  }, [tab, loadRuleInspection]);

  // Step 80: Assigneesタブが開かれた時に読み込む（毎回再読み込み）
  useEffect(() => {
    if (tab === "assignees") {
      void (async () => {
        try {
          const res = await fetchJson<{ assignees: Array<{ email: string; displayName: string | null }> }>("/api/mailhub/assignees");
          setAssignees(res.assignees ?? []);
          setAssigneesDraft(res.assignees ?? []);
        } catch (e) {
          showError(`担当者名簿の読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
        }
      })();
    }
  }, [tab, showError]);

  const loadRuleSuggestions = useCallback(async () => {
    setIsLoadingSuggestions(true);
    try {
      const res = await fetchJson<{ suggestions: RuleSuggestion[]; warnings: Array<{ type: string; message: string }> }>(
        `/api/mailhub/rules/suggestions?days=${suggestionDays}&minActions=${suggestionMinActions}&minActors=${suggestionMinActors}`,
      );
      setRuleSuggestions(res);
    } catch (e) {
      showError(`ルール提案の読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      setRuleSuggestions(null);
    } finally {
      setIsLoadingSuggestions(false);
    }
  }, [suggestionDays, suggestionMinActions, suggestionMinActors, showError]);

  useEffect(() => {
    if (tab === "suggestions") {
      void loadRuleSuggestions();
    }
  }, [tab, loadRuleSuggestions]);

  const loadRuleStats = useCallback(async () => {
    try {
      const res = await fetchJson<{ stats: RuleStats[] }>("/api/mailhub/rules/stats?days=30");
      const statsMap: Record<string, RuleStats> = {};
      for (const stat of res.stats) {
        statsMap[stat.ruleId] = stat;
      }
      setRuleStats(statsMap);
    } catch (e) {
      showError(`ルール統計の読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      setRuleStats({});
    }
  }, [showError]);

  useEffect(() => {
    if (tab === "rules") {
      void loadRuleStats();
    }
  }, [tab, loadRuleStats]);

  // 最後のExport時刻をlocalStorageから読み込む
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem("mailhub-config-export-last");
    if (stored) {
      try {
        const timestamp = parseInt(stored, 10);
        if (!isNaN(timestamp)) {
          setLastExportAt(new Date(timestamp).toLocaleString("ja-JP"));
        }
      } catch {
        // ignore
      }
    }
  }, []);

  const isAdmin = configHealth?.isAdmin === true;
  const readOnly = configHealth?.readOnly === true;
  const gmailModifyEnabled = configHealth?.gmailModifyEnabled !== false;
  const canWriteGmail = !readOnly && gmailModifyEnabled;
  const canWriteStore = !readOnly;

  const mailhubLabels = useMemo(() => {
    const only = labels.filter((l) => l.labelName.startsWith(MAILHUB_USER_LABEL_PREFIX));
    const q = labelQuery.trim().toLowerCase();
    if (!q) return only;
    return only.filter((l) => {
      const display = (l.displayName ?? l.labelName).toLowerCase();
      return display.includes(q) || l.labelName.toLowerCase().includes(q);
    });
  }, [labels, labelQuery]);

  const labelOptions = useMemo(() => {
    return labels
      .filter((l) => l.labelName.startsWith(MAILHUB_USER_LABEL_PREFIX))
      .map((l) => ({ labelName: l.labelName, displayName: l.displayName ?? l.labelName }));
  }, [labels]);

  const selectedRuleLabelNames = useMemo(() => {
    return Object.entries(ruleLabelSelection)
      .filter(([, v]) => v)
      .map(([k]) => k);
  }, [ruleLabelSelection]);

  const createLabel = useCallback(async () => {
    if (!canWriteGmail) {
      showError(readOnly ? "READ ONLYのため保存できません" : "Gmail権限がreadonlyのため保存できません（gmail.modifyが必要）");
      return;
    }
    if (!isAdmin) {
      showError("管理者のみ操作できます");
      return;
    }
    const displayName = newLabelDisplayName.trim();
    if (!displayName) return;
    try {
      const labelName = buildMailhubLabelName(displayName);
      await fetchJson("/api/mailhub/labels", { method: "POST", body: JSON.stringify({ labelName, displayName }) });
      setNewLabelDisplayName("");
      showToast("ラベルを作成しました");
      await load();
    } catch (e) {
      showError(`保存できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [canWriteGmail, isAdmin, load, newLabelDisplayName, readOnly, showError, showToast]);

  const renameLabel = useCallback(async (labelName: string, displayName: string) => {
    if (!canWriteGmail) {
      showError(readOnly ? "READ ONLYのため保存できません" : "Gmail権限がreadonlyのため保存できません（gmail.modifyが必要）");
      return;
    }
    if (!isAdmin) {
      showError("管理者のみ操作できます");
      return;
    }
    try {
      await fetchJson("/api/mailhub/labels", { method: "PATCH", body: JSON.stringify({ labelName, displayName }) });
      showToast("表示名を更新しました");
      await load();
    } catch (e) {
      showError(`保存できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [canWriteGmail, isAdmin, load, readOnly, showError, showToast]);

  const deleteLabel = useCallback(async (labelName: string) => {
    if (!canWriteGmail) {
      showError(readOnly ? "READ ONLYのため保存できません" : "Gmail権限がreadonlyのため保存できません（gmail.modifyが必要）");
      return;
    }
    if (!isAdmin) {
      showError("管理者のみ操作できます");
      return;
    }
    const ok = window.confirm(
      `このラベルを登録解除しますか？\n\n- 対象: ${labelName}\n- 影響: Gmail上のラベル自体は削除せず、MailHubの「登録一覧」から外れるだけです。\n\n続行しますか？`,
    );
    if (!ok) return;
    try {
      await fetchJson(`/api/mailhub/labels?labelName=${encodeURIComponent(labelName)}`, { method: "DELETE" });
      showToast("登録ラベルを削除しました");
      await load();
    } catch (e) {
      showError(`保存できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [canWriteGmail, isAdmin, load, readOnly, showError, showToast]);

  const createRule = useCallback(async () => {
    if (!canWriteGmail) {
      showError(readOnly ? "READ ONLYのため保存できません" : "Gmail権限がreadonlyのため保存できません（gmail.modifyが必要）");
      return;
    }
    if (!isAdmin) {
      showError("管理者のみ操作できます");
      return;
    }
    const v = matchValue.trim();
    if (!v) return;
    if (selectedRuleLabelNames.length === 0) {
      showToast("適用ラベルを選択してください");
      return;
    }
    const match =
      matchMode === "email"
        ? { fromEmail: v }
        : { fromDomain: normalizeDomain(v) };
    const domain = matchMode === "domain" ? normalizeDomain(v) : null;
    if (domain && isBroadDomain(domain)) {
      const ok = window.confirm(
        `⚠️ fromDomain が広範囲です（誤爆の可能性）: ${domain}\n\nこのドメイン配下のメールに自動でラベルが付きます。作成しますか？`,
      );
      if (!ok) return;
    }
    // Step 84: assignToを構築
    let assignTo: "me" | { assigneeEmail: string } | undefined;
    if (ruleAssignTo === "me") {
      assignTo = "me";
    } else if (ruleAssignTo && ruleAssignTo !== "") {
      assignTo = { assigneeEmail: ruleAssignTo };
    }
    try {
      await fetchJson("/api/mailhub/rules", {
        method: "POST",
        body: JSON.stringify({ match, labelNames: selectedRuleLabelNames, enabled: true, assignTo }),
      });
      setMatchValue("");
      setRuleAssignTo(""); // reset
      showToast("ルールを作成しました");
      await load();
    } catch (e) {
      showError(`保存できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [canWriteGmail, isAdmin, load, matchMode, matchValue, readOnly, ruleAssignTo, selectedRuleLabelNames, showError, showToast]);

  const createAssigneeRule = useCallback(async () => {
    if (!canWriteStore) {
      showError("READ ONLYのため保存できません");
      return;
    }
    if (!isAdmin) {
      showError("管理者のみ操作できます");
      return;
    }
    const v = assigneeMatchValue.trim();
    if (!v) return;
    const email = normalizeVtjEmail(assigneeEmailInput ?? "");
    if (!email) {
      showError("assigneeEmailは @vtj.co.jp のみ許可です");
      return;
    }
    const match =
      assigneeMatchMode === "email"
        ? { fromEmail: v }
        : { fromDomain: normalizeDomain(v) };
    const domain = assigneeMatchMode === "domain" ? normalizeDomain(v) : null;
    const risky = Boolean(domain && isBroadDomain(domain));
    if (risky) {
      const ok = window.confirm(
        `⚠️ fromDomain が広範囲です（誤爆の可能性）: ${domain}\n\n未割当メールに自動で担当が付きます。作成しますか？`,
      );
      if (!ok) return;
    }
    try {
      await fetchJson("/api/mailhub/assignee-rules", {
        method: "POST",
        body: JSON.stringify({
          match,
          assigneeEmail: email,
          priority: assigneePriority,
          enabled: true,
          unassignedOnly: true,
          dangerousDomainConfirm: risky,
        }),
      });
      setAssigneeMatchValue("");
      setAssigneeEmailInput("");
      setAssigneePriority(0);
      showToast("Assignee Ruleを作成しました");
      await load();
    } catch (e) {
      showError(`保存できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [assigneeEmailInput, assigneeMatchMode, assigneeMatchValue, assigneePriority, canWriteStore, isAdmin, load, showError, showToast]);

  const deleteAssigneeRule = useCallback(async (id: string) => {
    if (!canWriteStore) {
      showError("READ ONLYのため保存できません");
      return;
    }
    if (!isAdmin) {
      showError("管理者のみ操作できます");
      return;
    }
    const ok = window.confirm("このAssignee Ruleを削除しますか？");
    if (!ok) return;
    try {
      await fetchJson(`/api/mailhub/assignee-rules/${encodeURIComponent(id)}`, { method: "DELETE" });
      showToast("Assignee Ruleを削除しました");
      await load();
    } catch (e) {
      showError(`保存できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [canWriteStore, isAdmin, load, showError, showToast]);

  const saveAssigneeRule = useCallback(async (id: string) => {
    if (!canWriteStore) {
      showError("READ ONLYのため保存できません");
      return;
    }
    if (!isAdmin) {
      showError("管理者のみ操作できます");
      return;
    }
    const draft = assigneeDraftById[id];
    if (!draft) return;
    const match =
      draft.matchMode === "email"
        ? { fromEmail: draft.matchValue }
        : { fromDomain: normalizeDomain(draft.matchValue) };
    const email = normalizeVtjEmail(draft.assigneeEmail);
    if (!email) {
      showError("assigneeEmailは @vtj.co.jp のみ許可です");
      return;
    }
    const domain = draft.matchMode === "domain" ? normalizeDomain(draft.matchValue) : null;
    const risky = Boolean(domain && isBroadDomain(domain));
    if (risky) {
      const ok = window.confirm(`⚠️ fromDomain が広範囲です（誤爆の可能性）: ${domain}\n\n保存しますか？`);
      if (!ok) return;
    }
    try {
      await fetchJson(`/api/mailhub/assignee-rules/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          enabled: draft.enabled,
          priority: draft.priority,
          match,
          assigneeEmail: email,
          unassignedOnly: true,
          dangerousDomainConfirm: risky,
        }),
      });
      showToast("Assignee Ruleを保存しました");
      await load();
    } catch (e) {
      showError(`保存できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [assigneeDraftById, canWriteStore, isAdmin, load, showError, showToast]);

  const previewAssigneeRules = useCallback(async () => {
    setIsBusyAssignee(true);
    try {
      const res = await fetchJson<{ preview: AssigneeApplyPreview | null }>("/api/mailhub/assignee-rules/apply", {
        method: "POST",
        body: JSON.stringify({ dryRun: true, max: 200, log: true }),
      });
      if (!res.preview) {
        showToast("Preview: 0件");
        setAssigneePreview({ matchedCount: 0, matchedIds: [], samples: [], max: 0, truncated: false, warnings: [] });
        return;
      }
      setAssigneePreview(res.preview);
      showToast(`Preview: ${res.preview.matchedCount}件`);
    } catch (e) {
      showError(`Previewに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsBusyAssignee(false);
    }
  }, [showError, showToast]);

  const applyAssigneeRulesNow = useCallback(async () => {
    if (!canWriteGmail) {
      showError(readOnly ? "READ ONLYのため実行できません（Previewのみ）" : "Gmail権限がreadonlyのため実行できません（gmail.modifyが必要）");
      return;
    }
    if (!isAdmin) {
      showError("管理者のみ操作できます");
      return;
    }
    // Previewに基づく強警告
    if (assigneePreview) {
      const hasTooMany = assigneePreview.warnings.some((w) => w.type === "too_many");
      const hasBroad = assigneePreview.warnings.some((w) => w.type === "broad_domain");
      if (hasTooMany || hasBroad) {
        const ok = window.confirm(
          `⚠️ 警告あり\n\n${assigneePreview.warnings.map((w) => `- ${w.message}`).join("\n")}\n\nそれでも Apply now を実行しますか？`,
        );
        if (!ok) return;
      }
    }
    setIsBusyAssignee(true);
    try {
      await fetchJson("/api/mailhub/assignee-rules/apply", {
        method: "POST",
        body: JSON.stringify({ dryRun: false, max: 50, log: true }),
      });
      showToast("Apply now を実行しました（最大50件）");
      // 一覧側の反映はInboxShell側のリロードに依存するが、Settings側は再読み込みだけでOK
      await load();
    } catch (e) {
      showError(`Applyに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsBusyAssignee(false);
    }
  }, [assigneePreview, canWriteGmail, isAdmin, load, readOnly, showError, showToast]);

  const toggleRuleEnabled = useCallback(async (id: string, enabled: boolean) => {
    if (!canWriteGmail) {
      showError(readOnly ? "READ ONLYのため保存できません" : "Gmail権限がreadonlyのため保存できません（gmail.modifyが必要）");
      return;
    }
    if (!isAdmin) {
      showError("管理者のみ操作できます");
      return;
    }
    try {
      await fetchJson(`/api/mailhub/rules/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      await load();
    } catch (e) {
      showError(`保存できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [canWriteGmail, isAdmin, load, readOnly, showError]);

  const deleteRule = useCallback(async (id: string) => {
    if (!canWriteGmail) {
      showError(readOnly ? "READ ONLYのため保存できません" : "Gmail権限がreadonlyのため保存できません（gmail.modifyが必要）");
      return;
    }
    if (!isAdmin) {
      showError("管理者のみ操作できます");
      return;
    }
    const ok = window.confirm("このルールを削除しますか？");
    if (!ok) return;
    try {
      await fetchJson(`/api/mailhub/rules/${encodeURIComponent(id)}`, { method: "DELETE" });
      showToast("ルールを削除しました");
      await load();
    } catch (e) {
      showError(`保存できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [canWriteGmail, isAdmin, load, readOnly, showError, showToast]);

  const previewRule = useCallback(async (id: string) => {
    if (!isAdmin) {
      showError("管理者のみ操作できます");
      return;
    }
    setIsBusyRuleId(id);
    try {
      const res = await fetchJson<{ preview: PreviewResult }>("/api/mailhub/rules/apply", {
        method: "POST",
        body: JSON.stringify({ ruleId: id, dryRun: true, max: 50, log: true }),
      });
      setPreviewByRuleId((prev) => ({ ...prev, [id]: res.preview }));
      showToast(`Preview: ${res.preview.matchedCount}件`);
      setErrorBanner(null);
    } catch (e) {
      showError(`Previewに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsBusyRuleId(null);
    }
  }, [isAdmin, showError, showToast]);

  const applyRuleNow = useCallback(async (id: string) => {
    if (!canWriteGmail) {
      showError(readOnly ? "READ ONLYのため実行できません（Previewのみ）" : "Gmail権限がreadonlyのため実行できません（gmail.modifyが必要）");
      return;
    }
    if (!isAdmin) {
      showError("管理者のみ操作できます");
      return;
    }
    setIsBusyRuleId(id);
    try {
      const preview = previewByRuleId[id];
      if (preview && preview.matchedCount > 200) {
        const ok = window.confirm(`⚠️ 対象が多すぎます（${preview.matchedCount}件）。本当に実行しますか？`);
        if (!ok) return;
      }
      await fetchJson("/api/mailhub/rules/apply", {
        method: "POST",
        body: JSON.stringify({ ruleId: id, dryRun: false, max: 50, log: true }),
      });
      showToast("Apply now を実行しました（最大50件）");
      await load();
      // stats は Activity を正とするため、Apply後に再取得して即時反映する
      await loadRuleStats();
      setErrorBanner(null);
    } catch (e) {
      showError(`Applyに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsBusyRuleId(null);
    }
  }, [canWriteGmail, isAdmin, load, loadRuleStats, previewByRuleId, readOnly, showError, showToast]);

  const runImportDryRun = useCallback(async () => {
    if (!canWriteStore) {
      showError("READ ONLYのため実行できません");
      return;
    }
    if (!isAdmin) {
      showError("管理者のみ操作できます");
      return;
    }
    setIsImporting(true);
    try {
      const res = await fetchJson<{ preview: ImportPreview; previewToken: string }>("/api/mailhub/config/import", {
        method: "POST",
        body: JSON.stringify({ dryRun: true, log: true }),
      });
      setImportPreview({ ...res.preview, previewToken: res.previewToken });
      showToast("Import Previewを取得しました");
      setErrorBanner(null);
    } catch (e) {
      showError(`Import Previewに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsImporting(false);
    }
  }, [canWriteStore, isAdmin, showError, showToast]);

  const runImportExecute = useCallback(async () => {
    if (!canWriteStore) {
      showError("READ ONLYのため実行できません");
      return;
    }
    if (!isAdmin) {
      showError("管理者のみ操作できます");
      return;
    }
    if (!importPreview?.previewToken) {
      showError("先にImport Previewを取得してください");
      return;
    }
    if (importPreview.requiresConfirm) {
      const totalChanges =
        importPreview.labels.willAdd +
        importPreview.labels.willUpdate +
        importPreview.rules.willAdd +
        importPreview.rules.willUpdate;
      const ok = window.confirm(`⚠️ 変更件数が${totalChanges}件です。Importを実行しますか？`);
      if (!ok) return;
    }
    setIsImporting(true);
    try {
      await fetchJson<{ ok: true; preview: ImportPreview }>("/api/mailhub/config/import", {
        method: "POST",
        body: JSON.stringify({ dryRun: false, previewToken: importPreview.previewToken, confirmed: importPreview.requiresConfirm }),
      });
      showToast("Importを実行しました");
      setImportPreview(null);
      await load();
      setErrorBanner(null);
    } catch (e) {
      showError(`Importに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsImporting(false);
    }
  }, [canWriteStore, importPreview, isAdmin, load, showError, showToast]);

  const handleExportConfig = useCallback(async () => {
    if (!isAdmin) {
      showError("管理者のみ操作できます");
      return;
    }
    try {
      const res = await fetch("/api/mailhub/config/export", { cache: "no-store" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const msg = typeof data.message === "string" ? data.message : typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const contentDisposition = res.headers.get("content-disposition");
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      a.download = filenameMatch ? filenameMatch[1] : `mailhub-config-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      // 成功時にlocalStorageに時刻を保存
      const now = Date.now();
      localStorage.setItem("mailhub-config-export-last", String(now));
      setLastExportAt(new Date(now).toLocaleString("ja-JP"));
      showToast("Config Exportをダウンロードしました");
    } catch (e) {
      showError(`Config Exportに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [isAdmin, showError, showToast]);

  const handleWeeklyReportCsv = useCallback(async () => {
    if (!isAdmin) {
      showError("管理者のみ操作できます");
      return;
    }
    try {
      // 直近7日（YYYY-MM-DD）
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const res = await fetch(`/api/mailhub/report/weekly?since=${encodeURIComponent(since)}`, { cache: "no-store" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const msg = typeof data.message === "string" ? data.message : typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const contentDisposition = res.headers.get("content-disposition");
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      a.download = filenameMatch ? filenameMatch[1] : `mailhub-weekly-${since}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      showToast("Weekly Report CSVをダウンロードしました");
    } catch (e) {
      showError(`Weekly Report CSVに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [isAdmin, showError, showToast]);

  const renderDiffList = <T,>(
    title: string,
    items: T[],
    renderItem: (item: T) => string,
    testId: string,
  ) => {
    if (!items.length) return null;
    const limit = 20;
    const visible = items.slice(0, limit);
    const rest = items.length - visible.length;
    return (
      <div className="mt-2" data-testid={testId}>
        <div className="text-[11px] font-medium text-[#202124]">{title}（{items.length}件）</div>
        <ul className="mt-1 space-y-1">
          {visible.map((item, idx) => (
            <li key={`${testId}-${idx}`} className="font-mono text-[11px] text-[#5f6368] break-all">
              {renderItem(item)}
            </li>
          ))}
        </ul>
        {rest > 0 && <div className="text-[11px] text-[#5f6368] mt-1">他 {rest} 件</div>}
      </div>
    );
  };

  const canEditTemplates = canWriteStore && isAdmin;

  const createTemplate = useCallback(async () => {
    if (!canWriteStore) {
      showError("READ ONLYのため保存できません");
      return;
    }
    if (!isAdmin) {
      showError("管理者のみ操作できます");
      return;
    }
    const title = newTemplateTitle.trim();
    const body = newTemplateBody;
    if (!title || !body.trim()) {
      showToast("タイトルと本文を入力してください");
      return;
    }
    try {
      await fetchJson("/api/mailhub/templates", {
        method: "POST",
        body: JSON.stringify({ title, route: newTemplateRoute, body }),
      });
      setNewTemplateTitle("");
      setNewTemplateRoute("any");
      setNewTemplateBody("");
      showToast("テンプレを作成しました");
      await load();
    } catch (e) {
      showError(`保存できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [canWriteStore, isAdmin, load, newTemplateBody, newTemplateTitle, newTemplateRoute, showError, showToast]);

  const saveTemplate = useCallback(async (id: string) => {
    if (!canWriteStore) {
      showError("READ ONLYのため保存できません");
      return;
    }
    if (!isAdmin) {
      showError("管理者のみ操作できます");
      return;
    }
    const draft = templateDraftById[id];
    if (!draft) return;
    try {
      await fetchJson(`/api/mailhub/templates/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ title: draft.title, route: draft.route, body: draft.body }),
      });
      showToast("テンプレを更新しました");
      await load();
    } catch (e) {
      showError(`保存できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [canWriteStore, isAdmin, load, showError, showToast, templateDraftById]);

  const deleteTemplate = useCallback(async (id: string) => {
    if (!canWriteStore) {
      showError("READ ONLYのため保存できません");
      return;
    }
    if (!isAdmin) {
      showError("管理者のみ操作できます");
      return;
    }
    const ok = window.confirm("このテンプレを削除しますか？");
    if (!ok) return;
    try {
      await fetchJson(`/api/mailhub/templates/${encodeURIComponent(id)}`, { method: "DELETE" });
      showToast("テンプレを削除しました");
      await load();
    } catch (e) {
      showError(`保存できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [canWriteStore, isAdmin, load, showError, showToast]);

  const canEditViews = canWriteStore && isAdmin;

  const createView = useCallback(async () => {
    if (!canWriteStore) {
      showError("READ ONLYのため保存できません");
      return;
    }
    if (!isAdmin) {
      showError("管理者のみ操作できます");
      return;
    }
    const name = newViewName.trim();
    if (!name) return;
    try {
      await fetchJson("/api/mailhub/views", {
        method: "POST",
        body: JSON.stringify({
          name,
          icon: newViewIcon.trim() || undefined,
          labelId: newViewLabelId,
          q: newViewQ.trim() || undefined,
          pinned: newViewPinned,
          order: 999,
        }),
      });
      setNewViewName("");
      setNewViewIcon("");
      setNewViewQ("");
      setNewViewPinned(true);
      showToast("ビューを作成しました");
      await load();
    } catch (e) {
      showError(`保存できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [canWriteStore, isAdmin, load, newViewIcon, newViewLabelId, newViewName, newViewPinned, newViewQ, showError, showToast]);

  const saveView = useCallback(async (id: string) => {
    if (!canWriteStore) {
      showError("READ ONLYのため保存できません");
      return;
    }
    if (!isAdmin) {
      showError("管理者のみ操作できます");
      return;
    }
    const draft = viewDraftById[id];
    if (!draft) return;
    try {
      await fetchJson(`/api/mailhub/views/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: draft.name,
          icon: draft.icon.trim() ? draft.icon.trim() : null,
          labelId: draft.labelId,
          q: draft.q.trim() ? draft.q.trim() : null,
          pinned: draft.pinned,
        }),
      });
      showToast("ビューを更新しました");
      await load();
    } catch (e) {
      showError(`保存できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [canWriteStore, isAdmin, load, showError, showToast, viewDraftById]);

  const deleteView = useCallback(async (id: string) => {
    if (!canWriteStore) {
      showError("READ ONLYのため保存できません");
      return;
    }
    if (!isAdmin) {
      showError("管理者のみ操作できます");
      return;
    }
    const ok = window.confirm("このビューを削除しますか？");
    if (!ok) return;
    try {
      await fetchJson(`/api/mailhub/views/${encodeURIComponent(id)}`, { method: "DELETE" });
      showToast("ビューを削除しました");
      await load();
    } catch (e) {
      showError(`保存できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [canWriteStore, isAdmin, load, showError, showToast]);

  const moveView = useCallback(async (id: string, dir: "up" | "down") => {
    if (!canWriteStore) {
      showError("READ ONLYのため保存できません");
      return;
    }
    if (!isAdmin) {
      showError("管理者のみ操作できます");
      return;
    }
    const idx = views.findIndex((v) => v.id === id);
    if (idx === -1) return;
    const next = [...views].sort((a, b) => a.order - b.order);
    const pos = next.findIndex((v) => v.id === id);
    const swapWith = dir === "up" ? pos - 1 : pos + 1;
    if (swapWith < 0 || swapWith >= next.length) return;
    const tmp = next[pos];
    next[pos] = next[swapWith];
    next[swapWith] = tmp;
    const ids = next.map((v) => v.id);
    try {
      await fetchJson("/api/mailhub/views", { method: "POST", body: JSON.stringify({ action: "reorder", ids }) });
      await load();
    } catch (e) {
      showError(`並び替えに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [canWriteStore, isAdmin, load, showError, views]);

  return (
    <div className={mode === "page" ? "p-8 max-w-4xl" : "p-4"} data-testid="settings-panel-root">
      {toast && (
        <div className="mb-3 text-[12px] text-[#202124] bg-[#E8F0FE] border border-blue-200 rounded px-3 py-2" data-testid="settings-toast">
          {toast}
        </div>
      )}
      {errorBanner && (
        <div className="mb-3 text-[12px] text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2 flex items-start justify-between gap-3" data-testid="settings-error">
          <span className="min-w-0">{errorBanner}</span>
          <button type="button" className="text-red-700 hover:underline flex-shrink-0" onClick={() => setErrorBanner(null)}>
            閉じる
          </button>
        </div>
      )}

      <div className="flex gap-2 mb-4" role="tablist" aria-label="Settings tabs">
        <button
          type="button"
          data-testid="settings-tab-labels"
          onClick={() => setTab("labels")}
          className={`px-3 py-2 rounded border text-[13px] ${
            tab === "labels" ? "bg-[#E8F0FE] border-blue-200 text-[#1a73e8]" : "bg-white border-[#dadce0] text-[#5f6368]"
          }`}
        >
          Labels
        </button>
        <button
          type="button"
          data-testid="settings-tab-rules"
          onClick={() => setTab("rules")}
          className={`px-3 py-2 rounded border text-[13px] ${
            tab === "rules" ? "bg-[#E8F0FE] border-blue-200 text-[#1a73e8]" : "bg-white border-[#dadce0] text-[#5f6368]"
          }`}
        >
          Auto Rules
        </button>
        <button
          type="button"
          data-testid="settings-tab-templates"
          onClick={() => setTab("templates")}
          className={`px-3 py-2 rounded border text-[13px] ${
            tab === "templates" ? "bg-[#E8F0FE] border-blue-200 text-[#1a73e8]" : "bg-white border-[#dadce0] text-[#5f6368]"
          }`}
        >
          Templates
        </button>
        <button
          type="button"
          data-testid="settings-tab-auto-assign"
          onClick={() => setTab("auto-assign")}
          className={`px-3 py-2 rounded border text-[13px] ${
            tab === "auto-assign" ? "bg-[#E8F0FE] border-blue-200 text-[#1a73e8]" : "bg-white border-[#dadce0] text-[#5f6368]"
          }`}
        >
          Auto Assign
        </button>
        <button
          type="button"
          data-testid="settings-tab-views"
          onClick={() => setTab("views")}
          className={`px-3 py-2 rounded border text-[13px] ${
            tab === "views" ? "bg-[#E8F0FE] border-blue-200 text-[#1a73e8]" : "bg-white border-[#dadce0] text-[#5f6368]"
          }`}
        >
          Views
        </button>
        <button
          type="button"
          data-testid="settings-tab-team"
          onClick={() => setTab("team")}
          className={`px-3 py-2 rounded border text-[13px] ${
            tab === "team" ? "bg-[#E8F0FE] border-blue-200 text-[#1a73e8]" : "bg-white border-[#dadce0] text-[#5f6368]"
          }`}
        >
          Team
        </button>
        <button
          type="button"
          data-testid="settings-tab-assignees"
          onClick={() => setTab("assignees")}
          className={`px-3 py-2 rounded border text-[13px] ${
            tab === "assignees" ? "bg-[#E8F0FE] border-blue-200 text-[#1a73e8]" : "bg-white border-[#dadce0] text-[#5f6368]"
          }`}
        >
          Assignees
        </button>
        <button
          type="button"
          data-testid="settings-tab-diagnostics"
          onClick={() => setTab("diagnostics")}
          className={`px-3 py-2 rounded border text-[13px] ${
            tab === "diagnostics" ? "bg-[#E8F0FE] border-blue-200 text-[#1a73e8]" : "bg-white border-[#dadce0] text-[#5f6368]"
          }`}
        >
          Diagnostics
        </button>
        <button
          type="button"
          data-testid="settings-tab-suggestions"
          onClick={() => setTab("suggestions")}
          className={`px-3 py-2 rounded border text-[13px] ${
            tab === "suggestions" ? "bg-[#E8F0FE] border-blue-200 text-[#1a73e8]" : "bg-white border-[#dadce0] text-[#5f6368]"
          }`}
        >
          Suggestions
        </button>
        <button
          type="button"
          data-testid="settings-tab-queues"
          onClick={() => setTab("queues")}
          className={`px-3 py-2 rounded border text-[13px] ${
            tab === "queues" ? "bg-[#E8F0FE] border-blue-200 text-[#1a73e8]" : "bg-white border-[#dadce0] text-[#5f6368]"
          }`}
        >
          Queues
        </button>
      </div>

      {tab === "labels" ? (
        <section data-testid="settings-panel-labels">
          {!isAdmin && (
            <div className="mb-3 text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              Settingsの編集（ラベル登録/ルール編集）は管理者のみです。
            </div>
          )}
          <div className="text-[12px] text-[#5f6368] mb-2">
            MailHub用ラベル（<span className="font-mono">{MAILHUB_USER_LABEL_PREFIX}*</span>）のみ表示します。
          </div>

          <div className="flex gap-2 mb-3">
            <input
              data-testid="labels-search"
              value={labelQuery}
              onChange={(e) => setLabelQuery(e.target.value)}
              placeholder="検索"
              className="flex-1 border rounded px-3 py-2 text-sm"
            />
          </div>

          <div className="border rounded p-3 mb-4">
            <div className="text-sm font-medium mb-2">新規ラベル</div>
            <div className="flex gap-2">
              <input
                data-testid="label-new-display"
                value={newLabelDisplayName}
                onChange={(e) => setNewLabelDisplayName(e.target.value)}
                placeholder="例: VIP"
                className="flex-1 border rounded px-3 py-2 text-sm"
              />
              <button
                data-testid="label-new-create"
                className="px-4 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-40"
                onClick={() => void createLabel()}
                disabled={!isAdmin}
              >
                作成
              </button>
            </div>
            <div className="mt-2 text-[12px] text-[#5f6368]">
              作成されるGmailラベル名:{" "}
              <span className="font-mono">{MAILHUB_USER_LABEL_PREFIX}{slugifyMailhubLabel(newLabelDisplayName || "label")}</span>
            </div>
          </div>

          {mailhubLabels.length === 0 ? (
            <div className="text-sm text-gray-600">まだ登録がありません。</div>
          ) : (
            <ul className="space-y-2">
              {mailhubLabels.map((l) => (
                <li key={l.labelName} className="border rounded px-3 py-3">
                  <div className="text-xs text-gray-600 font-mono break-all">{l.labelName}</div>
                  <div className="flex gap-2 mt-2">
                    <input
                      defaultValue={l.displayName ?? ""}
                      placeholder="表示名（MailHub内のみ）"
                      className="flex-1 border rounded px-3 py-2 text-sm"
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if ((l.displayName ?? "") === next) return;
                        void renameLabel(l.labelName, next);
                      }}
                      disabled={!isAdmin}
                    />
                    <button
                      data-testid={`label-delete-${l.labelName}`}
                      className="text-sm text-red-600 hover:underline disabled:opacity-40"
                      onClick={() => void deleteLabel(l.labelName)}
                      disabled={!isAdmin}
                    >
                      削除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : tab === "rules" ? (
        <section data-testid="settings-panel-rules">
          {!isAdmin && (
            <div className="mb-3 text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              Settingsの編集（ラベル登録/ルール編集）は管理者のみです。
            </div>
          )}
          {isAdmin && rules.length > 0 && (
            <div className="mb-3 flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={async () => {
                  if (!window.confirm("すべてのルールを一時停止しますか？\n\n事故時の緊急停止用です。Previewは引き続き実行できます。")) return;
                  try {
                    const allDisabled = rules.every((r) => !r.enabled);
                    if (allDisabled) {
                      // 全再有効化
                      await Promise.all(rules.map((r) => fetchJson(`/api/mailhub/rules/${encodeURIComponent(r.id)}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) })));
                      showToast("すべてのルールを再有効化しました");
                    } else {
                      // 全停止
                      await Promise.all(rules.map((r) => fetchJson(`/api/mailhub/rules/${encodeURIComponent(r.id)}`, { method: "PATCH", body: JSON.stringify({ enabled: false }) })));
                      showToast("すべてのルールを一時停止しました");
                    }
                    await load();
                    await loadRuleStats();
                  } catch (e) {
                    showError(`操作に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
                  }
                }}
                className="px-3 py-1.5 text-xs border rounded hover:bg-gray-50 disabled:opacity-40"
                disabled={readOnly || !canWriteGmail}
                data-testid="rules-pause-all"
              >
                {rules.every((r) => !r.enabled) ? "全ルール再有効化" : "全ルール一時停止"}
              </button>
              {/* Step 53: Run All Buttons */}
              <button
                type="button"
                data-testid="rules-run-all-dryrun"
                onClick={async () => {
                  setIsRunningAll(true);
                  try {
                    const result = await fetchJson<{
                      mode: "dryRun" | "apply";
                      truncated: boolean;
                      totalCandidates: number;
                      totalApplied: number;
                      totalSkipped: number;
                      totalFailed: number;
                      perRule: Array<{
                        ruleId: string;
                        candidates: number;
                        applied: number;
                        skipped: number;
                        failed: number;
                        failedIds: string[];
                        truncated: boolean;
                      }>;
                    }>("/api/mailhub/rules/run-all", {
                      method: "POST",
                      body: JSON.stringify({ dryRun: true, log: true }),
                    });
                    setRunAllResult(result);
                    showToast(`Preview完了: 候補${result.totalCandidates}件 / 適用予定${result.totalApplied}件`);
                  } catch (e) {
                    showError(`実行に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
                  } finally {
                    setIsRunningAll(false);
                  }
                }}
                className="px-3 py-1.5 text-xs border rounded hover:bg-gray-50 disabled:opacity-40"
                disabled={isRunningAll}
              >
                Run All (dryRun)
              </button>
              <button
                type="button"
                data-testid="rules-run-all-apply"
                onClick={async () => {
                  if (!window.confirm("すべての有効化されたルールを実行しますか？\n\n実際にラベルが付与されます。")) return;
                  setIsRunningAll(true);
                  try {
                    const result = await fetchJson<{
                      mode: "dryRun" | "apply";
                      truncated: boolean;
                      totalCandidates: number;
                      totalApplied: number;
                      totalSkipped: number;
                      totalFailed: number;
                      perRule: Array<{
                        ruleId: string;
                        candidates: number;
                        applied: number;
                        skipped: number;
                        failed: number;
                        failedIds: string[];
                        truncated: boolean;
                      }>;
                    }>("/api/mailhub/rules/run-all", {
                      method: "POST",
                      body: JSON.stringify({ dryRun: false, log: true }),
                    });
                    setRunAllResult(result);
                    showToast(`実行完了: 候補${result.totalCandidates}件 / 適用${result.totalApplied}件`);
                    await load();
                    await loadRuleStats();
                  } catch (e) {
                    showError(`実行に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
                  } finally {
                    setIsRunningAll(false);
                  }
                }}
                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
                disabled={isRunningAll || readOnly || !canWriteGmail}
                title={readOnly ? "READ ONLYのため実行できません" : !canWriteGmail ? "Gmail権限が不足しています" : ""}
              >
                Run All (apply)
              </button>
            </div>
          )}
          <div className="border rounded p-3 mb-4">
            <div className="text-sm font-medium mb-2">新規ルール</div>
            <div className="grid grid-cols-1 gap-2">
              <select
                data-testid="rule-match-mode"
                value={matchMode}
                onChange={(e) => setMatchMode(e.target.value === "domain" ? "domain" : "email")}
                className="border rounded px-3 py-2 text-sm"
              >
                <option value="email">fromEmail完全一致</option>
                <option value="domain">fromDomain一致</option>
              </select>
              <input
                data-testid="rule-match-value"
                value={matchValue}
                onChange={(e) => setMatchValue(e.target.value)}
                placeholder={matchMode === "email" ? "例: foo@bar.com" : "例: bar.com"}
                className={`border rounded px-3 py-2 text-sm ${
                  matchMode === "domain" && isBroadDomain(normalizeDomain(matchValue)) ? "border-amber-400 bg-amber-50" : ""
                }`}
              />
              <div className="border rounded p-2">
                <div className="text-xs text-gray-600 mb-2">適用ラベル（複数可）</div>
                <div className="space-y-1 max-h-40 overflow-auto">
                  {labelOptions.length === 0 ? (
                    <div className="text-xs text-gray-500">先にLabelsでラベルを作成してください。</div>
                  ) : (
                    labelOptions.map((o) => (
                      <label key={o.labelName} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={ruleLabelSelection[o.labelName] === true}
                          onChange={(e) =>
                            setRuleLabelSelection((prev) => ({ ...prev, [o.labelName]: e.target.checked }))
                          }
                        />
                        <span className="truncate">{o.displayName}</span>
                        <span className="text-[10px] text-gray-500 font-mono truncate">{o.labelName}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
              {/* Step 84: Assignee選択 */}
              <div className="border rounded p-2">
                <div className="text-xs text-gray-600 mb-2">担当者に割り当て（任意）</div>
                <select
                  data-testid="rule-assign-to"
                  value={ruleAssignTo}
                  onChange={(e) => setRuleAssignTo(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm"
                  disabled={!isAdmin || readOnly}
                >
                  <option value="">割り当てなし</option>
                  <option value="me">自分（me）</option>
                  {ruleAssigneeOptions.map((a) => (
                    <option key={a.email} value={a.email}>
                      {a.displayName ? `${a.displayName} (${a.email})` : a.email}
                    </option>
                  ))}
                </select>
              </div>
              <button
                data-testid="rule-create"
                className="px-4 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-40"
                onClick={() => void createRule()}
                disabled={!isAdmin || readOnly}
              >
                追加
              </button>
            </div>
          </div>

          {rules.length === 0 ? (
            <div className="text-sm text-gray-600">まだルールがありません。</div>
          ) : (
            <ul className="space-y-2">
              {rules.map((r) => {
                const labels = r.labelNames?.length ? r.labelNames : r.labelName ? [r.labelName] : [];
                const matchType = r.match.fromEmail ? "fromEmail" : "fromDomain";
                const matchValue = r.match.fromEmail ?? r.match.fromDomain ?? "";
                const isRisky = matchType === "fromDomain" && isBroadDomain(matchValue);
                const preview = previewByRuleId[r.id] ?? null;
                const busy = isBusyRuleId === r.id;
                const stats = ruleStats[r.id];
                return (
                  <li key={r.id} className="border rounded px-3 py-3" data-testid={`rule-row-${r.id}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium flex items-center gap-2">
                          <span>{matchType}: {matchValue}</span>
                          {isRisky && <span className="text-xs text-amber-800">⚠️広範囲</span>}
                          {!r.enabled && <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">停止中</span>}
                        </div>
                        <div className="text-xs text-gray-600 mt-1 break-all">
                          apply: {labels.length ? labels.join(", ") : "(none)"}
                          {r.assignTo && (
                            <span className="ml-2 text-blue-600">
                              → assign: {r.assignTo === "me" ? "自分" : typeof r.assignTo === "object" && r.assignTo.assigneeEmail ? r.assignTo.assigneeEmail : String(r.assignTo)}
                            </span>
                          )}
                        </div>
                        {preview && (
                          <div className="mt-2 text-xs text-gray-700" data-testid={`rule-preview-${r.id}`}>
                            Preview: {preview.matchedCount}件（max={preview.max}）
                          </div>
                        )}
                        {stats && (
                          <div className="mt-2 text-xs text-gray-600 space-y-0.5">
                            {stats.lastApplyAt && (
                              <div>最終適用: {new Date(stats.lastApplyAt).toLocaleString("ja-JP")}</div>
                            )}
                            {(stats.appliedMessagesCount7d > 0 || stats.appliedMessagesCount30d > 0) && (
                              <div>
                                適用件数: 7日={stats.appliedMessagesCount7d}件 / 30日={stats.appliedMessagesCount30d}件
                              </div>
                            )}
                            {stats.lastApplySummary && (
                              <div className="text-[10px] text-gray-500">
                                最終適用サマリ: 処理={stats.lastApplySummary.processed} / マッチ={stats.lastApplySummary.matched} / 適用={stats.lastApplySummary.applied} / スキップ={stats.lastApplySummary.skipped} / 失敗={stats.lastApplySummary.failed}
                              </div>
                            )}
                            {onOpenActivity && (
                              <button
                                type="button"
                                onClick={() => onOpenActivity(r.id)}
                                className="text-blue-600 hover:text-blue-800 underline text-[10px]"
                                data-testid={`rule-activity-link-${r.id}`}
                              >
                                Activityで見る
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <label className="text-sm flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={r.enabled}
                            onChange={(e) => void toggleRuleEnabled(r.id, e.target.checked)}
                            disabled={!isAdmin || readOnly}
                            data-testid={`rule-enabled-toggle-${r.id}`}
                          />
                          ON
                        </label>
                        <button
                          data-testid={`rule-preview-btn-${r.id}`}
                          className="px-2 py-1 text-sm border rounded hover:bg-gray-50 disabled:opacity-40"
                          onClick={() => void previewRule(r.id)}
                          disabled={busy || !isAdmin}
                        >
                          Preview
                        </button>
                        <button
                          data-testid={`rule-apply-btn-${r.id}`}
                          className="px-2 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
                          onClick={() => void applyRuleNow(r.id)}
                          disabled={busy || r.enabled === false || !isAdmin}
                          title={r.enabled ? "" : "OFFのルールは実行できません"}
                        >
                          Apply now
                        </button>
                        <button
                          data-testid={`rule-delete-btn-${r.id}`}
                          className="text-sm text-red-600 hover:underline"
                          onClick={() => void deleteRule(r.id)}
                          disabled={busy || !isAdmin}
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Step 53: Run All Result Modal */}
          {runAllResult && typeof document !== "undefined" && createPortal(
            <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/20" data-testid="run-all-result-modal">
              <div className="bg-white rounded-lg shadow-lg border border-[#dadce0] p-6 max-w-2xl w-full max-h-[80vh] overflow-auto">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-lg font-semibold text-[#202124]">
                    Run All結果 ({runAllResult.mode === "dryRun" ? "Preview" : "Apply"})
                  </div>
                  <button
                    type="button"
                    onClick={() => setRunAllResult(null)}
                    className="p-1 rounded hover:bg-[#f1f3f4]"
                    data-testid="run-all-result-close"
                  >
                    <X size={20} className="text-[#5f6368]" />
                  </button>
                </div>
                <div className="space-y-4">
                  {runAllResult.truncated && (
                    <div className="text-sm text-red-900 bg-red-50 border border-red-200 rounded px-3 py-2">
                      ⚠️ 上限に達しました（truncated）。対象が多すぎる可能性があります。クエリを見直すか、maxTotalを増やしてください。
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="text-[#5f6368]">候補件数</div>
                      <div className="text-lg font-semibold text-[#202124]">{runAllResult.totalCandidates}</div>
                    </div>
                    <div>
                      <div className="text-[#5f6368]">適用件数</div>
                      <div className="text-lg font-semibold text-green-600">{runAllResult.totalApplied}</div>
                    </div>
                    <div>
                      <div className="text-[#5f6368]">スキップ件数</div>
                      <div className="text-lg font-semibold text-[#202124]">{runAllResult.totalSkipped}</div>
                    </div>
                    <div>
                      <div className="text-[#5f6368]">失敗件数</div>
                      <div className="text-lg font-semibold text-red-600">{runAllResult.totalFailed}</div>
                    </div>
                  </div>
                  {runAllResult.perRule.length > 0 && (
                    <div>
                      <div className="text-sm font-medium text-[#202124] mb-2">ルール別結果</div>
                      <div className="space-y-2 max-h-64 overflow-auto">
                        {runAllResult.perRule.map((ruleResult) => {
                          const rule = rules.find((r) => r.id === ruleResult.ruleId);
                          return (
                            <div key={ruleResult.ruleId} className="border border-[#dadce0] rounded p-2 text-xs">
                              <div className="font-medium text-[#202124]">
                                {rule ? `${rule.match.fromEmail ?? rule.match.fromDomain ?? ruleResult.ruleId}` : ruleResult.ruleId}
                              </div>
                              <div className="text-[#5f6368] mt-1">
                                候補: {ruleResult.candidates} / 適用: {ruleResult.applied} / スキップ: {ruleResult.skipped} / 失敗: {ruleResult.failed}
                                {ruleResult.truncated && <span className="text-red-600 ml-2">(上限到達)</span>}
                              </div>
                              {ruleResult.failedIds.length > 0 && (
                                <div className="text-[#5f6368] mt-1 text-[10px]">
                                  失敗ID: {ruleResult.failedIds.slice(0, 5).join(", ")}
                                  {ruleResult.failedIds.length > 5 && ` ...他${ruleResult.failedIds.length - 5}件`}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )}
        </section>
      ) : tab === "auto-assign" ? (
        <section data-testid="settings-panel-auto-assign">
          {!isAdmin && (
            <div className="mb-3 text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              Auto Assignの編集は管理者のみです（閲覧は可能）。
            </div>
          )}
          {readOnly && (
            <div className="mb-3 text-[12px] text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
              READ ONLYのため Apply now はできません（Previewのみ）。
            </div>
          )}
          {/* Assignee Rules */}
          <div data-testid="settings-assignee-rules-section">
            <div className="text-sm font-medium mb-2">Assignee Rules（未割当の自動ルーティング）</div>
            <div className="text-[12px] text-[#5f6368] mb-3">
              - 適用対象は <span className="font-mono">Unassigned</span> のみ（takeoverしません）<br />
              - 運用は Preview 常用 → 問題なければ Apply now（最大50件）
            </div>

            <div className="border rounded p-3 mb-4">
              <div className="text-sm font-medium mb-2">新規Assignee Rule</div>
              <div className="grid grid-cols-1 gap-2">
                <select
                  data-testid="assignee-rule-match-mode"
                  value={assigneeMatchMode}
                  onChange={(e) => setAssigneeMatchMode(e.target.value === "email" ? "email" : "domain")}
                  className="border rounded px-3 py-2 text-sm"
                  disabled={!isAdmin || !canWriteStore}
                >
                  <option value="domain">fromDomain一致（未割当のみ）</option>
                  <option value="email">fromEmail完全一致（未割当のみ）</option>
                </select>
                <input
                  data-testid="assignee-rule-match-value"
                  value={assigneeMatchValue}
                  onChange={(e) => setAssigneeMatchValue(e.target.value)}
                  placeholder={assigneeMatchMode === "email" ? "例: foo@bar.com" : "例: example.com"}
                  className={`border rounded px-3 py-2 text-sm ${
                    assigneeMatchMode === "domain" && isBroadDomain(normalizeDomain(assigneeMatchValue)) ? "border-amber-400 bg-amber-50" : ""
                  }`}
                  disabled={!isAdmin || !canWriteStore}
                />
                <input
                  data-testid="assignee-rule-assignee-email"
                  value={assigneeEmailInput}
                  onChange={(e) => setAssigneeEmailInput(e.target.value)}
                  placeholder="assigneeEmail（@vtj.co.jpのみ）"
                  className="border rounded px-3 py-2 text-sm"
                  disabled={!isAdmin || !canWriteStore}
                />
                <input
                  data-testid="assignee-rule-priority"
                  type="number"
                  value={assigneePriority}
                  onChange={(e) => setAssigneePriority(parseInt(e.target.value || "0", 10))}
                  className="border rounded px-3 py-2 text-sm"
                  disabled={!isAdmin || !canWriteStore}
                />
                <button
                  type="button"
                  data-testid="assignee-rule-create"
                  className="px-4 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-40"
                  onClick={() => void createAssigneeRule()}
                  disabled={!isAdmin || !canWriteStore}
                >
                  追加
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 mb-3">
              <button
                type="button"
                data-testid="assignee-rule-preview"
                className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 disabled:opacity-40"
                onClick={() => void previewAssigneeRules()}
                disabled={isBusyAssignee}
                title={!isAdmin ? "管理者のみ実行可能" : ""}
              >
                Preview
              </button>
              <button
                type="button"
                data-testid="assignee-rule-apply"
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
                onClick={() => void applyAssigneeRulesNow()}
                disabled={isBusyAssignee || !isAdmin || !canWriteGmail}
                title={!isAdmin ? "管理者のみ実行可能" : !canWriteGmail ? (readOnly ? "READ ONLY（Previewのみ）" : "gmail.modifyが必要") : ""}
              >
                Apply now
              </button>
              {assigneePreview && (
                <div className="text-xs text-gray-700" data-testid="assignee-rules-preview">
                  Preview: {assigneePreview.matchedCount}件（max={assigneePreview.max}）
                  {assigneePreview.samples && assigneePreview.samples.length > 0 && (
                    <div className="mt-2 text-[11px] text-gray-600">
                      サンプル（上位{Math.min(assigneePreview.samples.length, 20)}件）:
                      <ul className="mt-1 space-y-1 max-h-40 overflow-auto">
                        {assigneePreview.samples.slice(0, 20).map((s) => (
                          <li key={s.id} className="border rounded p-2 bg-gray-50">
                            <div className="text-[10px] font-mono">{s.id}</div>
                            <div className="text-[11px] truncate">{s.subject ?? "(no subject)"}</div>
                            <div className="text-[10px] text-gray-500 truncate">{s.from ?? "(unknown)"}</div>
                            <div className="text-[10px] text-blue-600">→ {s.assigneeEmail}</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            {assigneePreview?.warnings?.length ? (
              <div className="mb-3 text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                {assigneePreview.warnings.map((w, i) => (
                  <div key={i}>{w.message}</div>
                ))}
              </div>
            ) : null}

            {isAdmin && assigneeRules.length > 0 && (
              <div className="mb-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm("すべてのAssignee Rulesを一時停止しますか？\n\n事故時の緊急停止用です。Previewは引き続き実行できます。")) return;
                    try {
                      const allDisabled = assigneeRules.every((r) => !r.enabled);
                      if (allDisabled) {
                        // 全再有効化
                        await Promise.all(assigneeRules.map((r) => fetchJson(`/api/mailhub/assignee-rules/${encodeURIComponent(r.id)}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) })));
                        showToast("すべてのAssignee Rulesを再有効化しました");
                      } else {
                        // 全停止
                        await Promise.all(assigneeRules.map((r) => fetchJson(`/api/mailhub/assignee-rules/${encodeURIComponent(r.id)}`, { method: "PATCH", body: JSON.stringify({ enabled: false }) })));
                        showToast("すべてのAssignee Rulesを一時停止しました");
                      }
                      await load();
                      await loadRuleStats();
                    } catch (e) {
                      showError(`操作に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
                    }
                  }}
                  className="px-3 py-1.5 text-xs border rounded hover:bg-gray-50 disabled:opacity-40"
                  disabled={readOnly || !canWriteGmail}
                  data-testid="assignee-rules-pause-all"
                >
                  {assigneeRules.every((r) => !r.enabled) ? "全Assignee Rules再有効化" : "全Assignee Rules一時停止"}
                </button>
              </div>
            )}

            {assigneeRules.length === 0 ? (
              <div className="text-sm text-gray-600">まだAssignee Rulesがありません。</div>
            ) : (
              <ul className="space-y-2">
                {assigneeRules
                  .slice()
                  .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
                  .map((r) => {
                    const matchType = r.match.fromEmail ? "fromEmail" : "fromDomain";
                    const matchVal = r.match.fromEmail ?? r.match.fromDomain ?? "";
                    const isRisky = matchType === "fromDomain" && isBroadDomain(matchVal);
                    const stats = ruleStats[r.id];
                    const draft =
                      assigneeDraftById[r.id] ??
                      ({
                        enabled: r.enabled,
                        priority: r.priority ?? 0,
                        matchMode: matchType === "fromEmail" ? "email" : "domain",
                        matchValue: matchVal,
                        assigneeEmail: r.assigneeEmail,
                      } as const);

                    return (
                      <li key={r.id} className="border rounded px-3 py-3" data-testid={`assignee-rule-row-${r.id}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium flex items-center gap-2">
                              <span>{matchType}: {matchVal}</span>
                              {isRisky && <span className="text-xs text-amber-800">⚠️広範囲</span>}
                              {!r.enabled && <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">停止中</span>}
                            </div>
                            <div className="text-xs text-gray-600 mt-1 break-all">
                              assignee: {r.assigneeEmail} / priority: {r.priority ?? 0} / unassignedOnly: true
                            </div>
                            {stats && (
                              <div className="mt-2 text-xs text-gray-600 space-y-0.5">
                                {stats.lastApplyAt && (
                                  <div>最終適用: {new Date(stats.lastApplyAt).toLocaleString("ja-JP")}</div>
                                )}
                                {(stats.appliedMessagesCount7d > 0 || stats.appliedMessagesCount30d > 0) && (
                                  <div>
                                    適用件数: 7日={stats.appliedMessagesCount7d}件 / 30日={stats.appliedMessagesCount30d}件
                                  </div>
                                )}
                                {stats.lastApplySummary && (
                                  <div className="text-[10px] text-gray-500">
                                    最終適用サマリ: 処理={stats.lastApplySummary.processed} / マッチ={stats.lastApplySummary.matched} / 適用={stats.lastApplySummary.applied} / スキップ={stats.lastApplySummary.skipped} / 失敗={stats.lastApplySummary.failed}
                                  </div>
                                )}
                                {onOpenActivity && (
                                  <button
                                    type="button"
                                    onClick={() => onOpenActivity(r.id)}
                                    className="text-blue-600 hover:text-blue-800 underline text-[10px]"
                                    data-testid={`assignee-rule-activity-link-${r.id}`}
                                  >
                                    Activityで見る
                                  </button>
                                )}
                              </div>
                            )}
                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 mt-2">
                              <select
                                value={draft.matchMode}
                                onChange={(e) =>
                                  setAssigneeDraftById((prev) => ({
                                    ...prev,
                                    [r.id]: { ...draft, matchMode: e.target.value === "email" ? "email" : "domain" },
                                  }))
                                }
                                className="border rounded px-2 py-1.5 text-sm"
                                disabled={!isAdmin || !canWriteStore}
                              >
                                <option value="domain">fromDomain</option>
                                <option value="email">fromEmail</option>
                              </select>
                              <input
                                value={draft.matchValue}
                                onChange={(e) =>
                                  setAssigneeDraftById((prev) => ({ ...prev, [r.id]: { ...draft, matchValue: e.target.value } }))
                                }
                                className="border rounded px-2 py-1.5 text-sm"
                                disabled={!isAdmin || !canWriteStore}
                              />
                              <input
                                value={draft.assigneeEmail}
                                onChange={(e) =>
                                  setAssigneeDraftById((prev) => ({ ...prev, [r.id]: { ...draft, assigneeEmail: e.target.value } }))
                                }
                                className="border rounded px-2 py-1.5 text-sm"
                                disabled={!isAdmin || !canWriteStore}
                              />
                              <input
                                type="number"
                                value={draft.priority}
                                onChange={(e) =>
                                  setAssigneeDraftById((prev) => ({ ...prev, [r.id]: { ...draft, priority: parseInt(e.target.value || "0", 10) } }))
                                }
                                className="border rounded px-2 py-1.5 text-sm"
                                disabled={!isAdmin || !canWriteStore}
                              />
                            </div>
                          </div>

                          <div className="flex items-center gap-2 flex-shrink-0">
                            <label className="text-sm flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={draft.enabled}
                                onChange={(e) =>
                                  setAssigneeDraftById((prev) => ({ ...prev, [r.id]: { ...draft, enabled: e.target.checked } }))
                                }
                                disabled={!isAdmin || !canWriteStore || readOnly}
                                data-testid={`assignee-rule-enabled-toggle-${r.id}`}
                              />
                              ON
                            </label>
                            <button
                              type="button"
                              data-testid={`assignee-rule-save-${r.id}`}
                              className="px-2 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
                              onClick={() => void saveAssigneeRule(r.id)}
                              disabled={!isAdmin || !canWriteStore}
                            >
                              保存
                            </button>
                            <button
                              type="button"
                              data-testid={`assignee-rule-delete-${r.id}`}
                              className="text-sm text-red-600 hover:underline disabled:opacity-40"
                              onClick={() => void deleteAssigneeRule(r.id)}
                              disabled={!isAdmin || !canWriteStore}
                            >
                              削除
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
              </ul>
            )}
          </div>
        </section>
      ) : tab === "templates" ? (
        <section data-testid="settings-panel-templates">
          {!isAdmin && (
            <div className="mb-3 text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              テンプレの編集は管理者のみです（閲覧は可能）。
            </div>
          )}
          {readOnly && (
            <div className="mb-3 text-[12px] text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
              READ ONLYのためテンプレの作成/編集/削除はできません。
            </div>
          )}

          <div className="border rounded p-3 mb-4">
            <div className="text-sm font-medium mb-2">新規テンプレ</div>
            <div className="grid grid-cols-1 gap-2">
              <input
                data-testid="template-new-title"
                value={newTemplateTitle}
                onChange={(e) => setNewTemplateTitle(e.target.value)}
                placeholder="タイトル（例: 受領しました）"
                className="border rounded px-3 py-2 text-sm"
                disabled={!canEditTemplates}
              />
              <select
                data-testid="template-new-route"
                value={newTemplateRoute}
                onChange={(e) => setNewTemplateRoute(e.target.value === "rakuten_rms" ? "rakuten_rms" : e.target.value === "gmail" ? "gmail" : "any")}
                className="border rounded px-3 py-2 text-sm"
                disabled={!canEditTemplates}
                title="このテンプレを主に使う返信ルート（フィルタ用）"
              >
                <option value="any">any（共通）</option>
                <option value="gmail">gmail</option>
                <option value="rakuten_rms">rakuten_rms</option>
              </select>
              <textarea
                data-testid="template-new-body"
                value={newTemplateBody}
                onChange={(e) => setNewTemplateBody(e.target.value)}
                placeholder="本文"
                rows={5}
                className="border rounded px-3 py-2 text-sm font-mono"
                disabled={!canEditTemplates}
              />
              <button
                type="button"
                data-testid="template-create"
                className="px-4 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-40"
                onClick={() => void createTemplate()}
                disabled={!canEditTemplates}
              >
                作成
              </button>
            </div>
            <div className="mt-2 text-[12px] text-[#5f6368]">
              ※テンプレ本文は<strong>プレーンテキストのみ</strong>（HTMLタグは保存できません）。未解決の変数（例:{" "}
              <span className="font-mono">{"{{inquiryId}}"}</span>）は空欄にせず警告します。
            </div>
          </div>

          {templates.length === 0 ? (
            <div className="text-sm text-gray-600">まだテンプレがありません。</div>
          ) : (
            <ul className="space-y-2">
              {templates.map((t) => {
                const draft = templateDraftById[t.id] ?? { title: t.title, route: (t.route ?? "any") as "rakuten_rms" | "gmail" | "any", body: t.body };
                return (
                  <li key={t.id} className="border rounded px-3 py-3" data-testid={`template-row-${t.id}`}>
                    <div className="text-[11px] text-gray-600 font-mono break-all">{t.id}</div>
                    <div className="grid grid-cols-1 gap-2 mt-2">
                      <input
                        data-testid={`template-title-${t.id}`}
                        value={draft.title}
                        onChange={(e) =>
                          setTemplateDraftById((prev) => ({ ...prev, [t.id]: { ...draft, title: e.target.value } }))
                        }
                        className="border rounded px-3 py-2 text-sm"
                        disabled={!isAdmin}
                      />
                      <select
                        data-testid={`template-route-${t.id}`}
                        value={draft.route}
                        onChange={(e) =>
                          setTemplateDraftById((prev) => ({
                            ...prev,
                            [t.id]: {
                              ...draft,
                              route: e.target.value === "rakuten_rms" ? "rakuten_rms" : e.target.value === "gmail" ? "gmail" : "any",
                            },
                          }))
                        }
                        className="border rounded px-3 py-2 text-sm"
                        disabled={!isAdmin}
                      >
                        <option value="any">any</option>
                        <option value="gmail">gmail</option>
                        <option value="rakuten_rms">rakuten_rms</option>
                      </select>
                      <textarea
                        data-testid={`template-body-${t.id}`}
                        value={draft.body}
                        onChange={(e) =>
                          setTemplateDraftById((prev) => ({ ...prev, [t.id]: { ...draft, body: e.target.value } }))
                        }
                        rows={6}
                        className="border rounded px-3 py-2 text-sm font-mono"
                        disabled={!isAdmin}
                      />
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[11px] text-[#5f6368]">
                          最終更新: {t.updatedAt} / {t.updatedBy}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            data-testid={`template-save-${t.id}`}
                            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
                            onClick={() => void saveTemplate(t.id)}
                            disabled={!canEditTemplates}
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            data-testid={`template-delete-${t.id}`}
                            className="text-sm text-red-600 hover:underline disabled:opacity-40"
                            onClick={() => void deleteTemplate(t.id)}
                            disabled={!canEditTemplates}
                          >
                            削除
                          </button>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : tab === "views" ? (
        <section data-testid="settings-panel-views">
          {!isAdmin && (
            <div className="mb-3 text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              Viewsの編集は管理者のみです（閲覧は可能）。
            </div>
          )}
          {readOnly && (
            <div className="mb-3 text-[12px] text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
              READ ONLYのためViewsの作成/編集/削除/並び替えはできません。
            </div>
          )}

          <div className="border rounded p-3 mb-4">
            <div className="text-sm font-medium mb-2">新規ビュー</div>
            <div className="grid grid-cols-1 gap-2">
              <input
                data-testid="view-new-name"
                value={newViewName}
                onChange={(e) => setNewViewName(e.target.value)}
                placeholder="表示名（例: 期限超過）"
                className="border rounded px-3 py-2 text-sm"
                disabled={!canEditViews}
              />
              <div className="flex gap-2">
                <input
                  data-testid="view-new-icon"
                  value={newViewIcon}
                  onChange={(e) => setNewViewIcon(e.target.value)}
                  placeholder="icon（例: ⚠️）"
                  className="w-28 border rounded px-3 py-2 text-sm"
                  disabled={!canEditViews}
                />
                <select
                  data-testid="view-new-labelId"
                  value={newViewLabelId}
                  onChange={(e) => setNewViewLabelId(e.target.value)}
                  className="flex-1 border rounded px-3 py-2 text-sm"
                  disabled={!canEditViews}
                >
                  <option value="todo">todo</option>
                  <option value="waiting">waiting</option>
                  <option value="muted">muted</option>
                  <option value="mine">mine</option>
                  <option value="unassigned">unassigned</option>
                  <option value="all">all</option>
                  <option value="store-a">store-a</option>
                  <option value="store-b">store-b</option>
                  <option value="store-c">store-c</option>
                </select>
                <label className="flex items-center gap-2 text-sm px-2">
                  <input
                    data-testid="view-new-pinned"
                    type="checkbox"
                    checked={newViewPinned}
                    onChange={(e) => setNewViewPinned(e.target.checked)}
                    disabled={!canEditViews}
                  />
                  pinned
                </label>
              </div>
              <input
                data-testid="view-new-q"
                value={newViewQ}
                onChange={(e) => setNewViewQ(e.target.value)}
                placeholder="Gmail検索（例: older_than:7d）"
                className="border rounded px-3 py-2 text-sm font-mono"
                disabled={!canEditViews}
              />
              <button
                type="button"
                data-testid="view-create"
                className="px-4 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-40"
                onClick={() => void createView()}
                disabled={!canEditViews}
              >
                作成
              </button>
            </div>
            <div className="mt-2 text-[12px] text-[#5f6368]">
              例）<span className="font-mono">labelId=todo, q=older_than:7d</span> で「期限超過」ビュー
            </div>
          </div>

          {views.length === 0 ? (
            <div className="text-sm text-gray-600">まだビューがありません。</div>
          ) : (
            <ul className="space-y-2">
              {[...views].sort((a, b) => a.order - b.order).map((v) => {
                const draft = viewDraftById[v.id] ?? {
                  name: v.name,
                  icon: v.icon ?? "",
                  labelId: v.labelId,
                  q: v.q ?? "",
                  pinned: v.pinned,
                };
                return (
                  <li key={v.id} className="border rounded px-3 py-3" data-testid={`view-row-${v.id}`}>
                    <div className="text-[11px] text-gray-600 font-mono break-all">{v.id}</div>
                    <div className="grid grid-cols-1 gap-2 mt-2">
                      <div className="flex gap-2">
                        <input
                          data-testid={`view-icon-${v.id}`}
                          value={draft.icon}
                          onChange={(e) => setViewDraftById((p) => ({ ...p, [v.id]: { ...draft, icon: e.target.value } }))}
                          className="w-28 border rounded px-3 py-2 text-sm"
                          disabled={!isAdmin}
                        />
                        <input
                          data-testid={`view-name-${v.id}`}
                          value={draft.name}
                          onChange={(e) => setViewDraftById((p) => ({ ...p, [v.id]: { ...draft, name: e.target.value } }))}
                          className="flex-1 border rounded px-3 py-2 text-sm"
                          disabled={!isAdmin}
                        />
                      </div>
                      <div className="flex gap-2 items-center">
                        <select
                          data-testid={`view-labelId-${v.id}`}
                          value={draft.labelId}
                          onChange={(e) => setViewDraftById((p) => ({ ...p, [v.id]: { ...draft, labelId: e.target.value } }))}
                          className="flex-1 border rounded px-3 py-2 text-sm font-mono"
                          disabled={!isAdmin}
                        >
                          <option value="todo">todo</option>
                          <option value="waiting">waiting</option>
                          <option value="muted">muted</option>
                          <option value="mine">mine</option>
                          <option value="unassigned">unassigned</option>
                          <option value="all">all</option>
                          <option value="store-a">store-a</option>
                          <option value="store-b">store-b</option>
                          <option value="store-c">store-c</option>
                        </select>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            data-testid={`view-pinned-${v.id}`}
                            type="checkbox"
                            checked={draft.pinned}
                            onChange={(e) => setViewDraftById((p) => ({ ...p, [v.id]: { ...draft, pinned: e.target.checked } }))}
                            disabled={!isAdmin}
                          />
                          pinned
                        </label>
                      </div>
                      <input
                        data-testid={`view-q-${v.id}`}
                        value={draft.q}
                        onChange={(e) => setViewDraftById((p) => ({ ...p, [v.id]: { ...draft, q: e.target.value } }))}
                        className="border rounded px-3 py-2 text-sm font-mono"
                        disabled={!isAdmin}
                        placeholder="q（任意）"
                      />
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[11px] text-[#5f6368]">order={v.order}</div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            data-testid={`view-move-up-${v.id}`}
                            className="px-2 py-1 border rounded hover:bg-gray-50 disabled:opacity-40"
                            onClick={() => void moveView(v.id, "up")}
                            disabled={!canEditViews}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            data-testid={`view-move-down-${v.id}`}
                            className="px-2 py-1 border rounded hover:bg-gray-50 disabled:opacity-40"
                            onClick={() => void moveView(v.id, "down")}
                            disabled={!canEditViews}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            data-testid={`view-save-${v.id}`}
                            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
                            onClick={() => void saveView(v.id)}
                            disabled={!canEditViews}
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            data-testid={`view-delete-${v.id}`}
                            className="text-sm text-red-600 hover:underline disabled:opacity-40"
                            onClick={() => void deleteView(v.id)}
                            disabled={!canEditViews}
                          >
                            削除
                          </button>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : tab === "team" ? (
        <section data-testid="settings-panel-team">
          {!isAdmin && (
            <div className="mb-3 text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              Settingsの編集（Team管理）は管理者のみです。
            </div>
          )}
          <div className="text-[12px] text-[#5f6368] mb-2">
            Team名簿に登録されたメンバーにのみ、メールを割り当てることができます。
          </div>

          <div className="border rounded p-3 mb-4">
            <div className="text-sm font-medium mb-2">新規メンバー</div>
            <div className="grid grid-cols-1 gap-2">
              <input
                data-testid="team-new-email"
                value={newTeamEmail}
                onChange={(e) => setNewTeamEmail(e.target.value)}
                placeholder="メールアドレス（例: tanaka@vtj.co.jp）"
                className="flex-1 border rounded px-3 py-2 text-sm"
                disabled={!isAdmin || readOnly}
              />
              <input
                data-testid="team-new-name"
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                placeholder="表示名（任意、例: 田中太郎）"
                className="flex-1 border rounded px-3 py-2 text-sm"
                disabled={!isAdmin || readOnly}
              />
              <button
                data-testid="team-create"
                className="px-4 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-40"
                onClick={async () => {
                  if (!newTeamEmail.trim()) {
                    showToast("メールアドレスを入力してください");
                    return;
                  }
                  try {
                    await fetchJson("/api/mailhub/team", {
                      method: "POST",
                      body: JSON.stringify({ email: newTeamEmail.trim(), name: newTeamName.trim() || null }),
                    });
                    showToast("メンバーを追加しました");
                    setNewTeamEmail("");
                    setNewTeamName("");
                    await load();
                  } catch (e) {
                    showError(`メンバーの追加に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
                  }
                }}
                disabled={!isAdmin || readOnly || !newTeamEmail.trim()}
              >
                追加
              </button>
            </div>
          </div>

          {team.length === 0 ? (
            <div className="text-sm text-gray-600">まだメンバーが登録されていません。</div>
          ) : (
            <ul className="space-y-2">
              {team.map((m) => {
                const draft = teamDraftById[m.email] ?? { name: m.name };
                return (
                  <li key={m.email} className="border rounded px-3 py-3" data-testid={`team-row-${m.email}`}>
                    <div className="text-xs text-gray-600 font-mono break-all mb-1">{m.email}</div>
                    <div className="flex gap-2 mt-2">
                      <input
                        data-testid={`team-edit-name-${m.email}`}
                        value={draft.name ?? ""}
                        placeholder="表示名（任意）"
                        className="flex-1 border rounded px-3 py-2 text-sm"
                        onChange={(e) => {
                          const next = e.target.value.trim() || null;
                          const currentName = m.name ?? null;
                          if (currentName === next) {
                            // 変更がない場合はdraftを削除
                            setTeamDraftById((prev) => {
                              const next = { ...prev };
                              delete next[m.email];
                              return next;
                            });
                          } else {
                            // 変更がある場合はdraftを設定
                            setTeamDraftById((prev) => ({ ...prev, [m.email]: { name: next } }));
                          }
                        }}
                        disabled={!isAdmin || readOnly}
                      />
                    </div>
                    <div className="flex justify-end gap-2 mt-2">
                      <button
                        data-testid={`team-save-${m.email}`}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm disabled:opacity-40"
                        onClick={async () => {
                          const draft = teamDraftById[m.email];
                          if (!draft) return;
                          try {
                            await fetchJson(`/api/mailhub/team/${encodeURIComponent(m.email)}`, {
                              method: "PATCH",
                              body: JSON.stringify({ name: draft.name }),
                            });
                            showToast("メンバーを保存しました");
                            setTeamDraftById((prev) => {
                              const next = { ...prev };
                              delete next[m.email];
                              return next;
                            });
                            await load();
                          } catch (e) {
                            showError(`メンバーの保存に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
                          }
                        }}
                        disabled={!isAdmin || readOnly || !teamDraftById[m.email]}
                      >
                        保存
                      </button>
                      <button
                        data-testid={`team-delete-${m.email}`}
                        className="text-sm text-red-600 hover:underline disabled:opacity-40"
                        onClick={async () => {
                          if (!window.confirm(`このメンバーを削除してもよろしいですか？\n\n${m.email}`)) return;
                          try {
                            await fetchJson(`/api/mailhub/team/${encodeURIComponent(m.email)}`, { method: "DELETE" });
                            showToast("メンバーを削除しました");
                            await load();
                          } catch (e) {
                            showError(`メンバーの削除に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
                          }
                        }}
                        disabled={!isAdmin || readOnly}
                      >
                        削除
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Step 109: Roster（assign候補の名簿） */}
          <div className="mt-8 border-t pt-6">
            <div className="text-sm font-medium mb-2">Roster（assign候補の名簿）</div>
            <div className="text-[12px] text-[#5f6368] mb-3">
              Rosterに登録されたメールアドレス（vtj.co.jpのみ）が、assign候補として表示されます。
            </div>
            <div className="border rounded p-3 mb-4">
              <div className="text-sm font-medium mb-2">Roster編集</div>
              <textarea
                data-testid="roster-edit"
                value={rosterDraft || roster.join("\n")}
                onChange={(e) => setRosterDraft(e.target.value)}
                placeholder="メールアドレスを1行ずつ入力（例:&#10;tanaka@vtj.co.jp&#10;suzuki@vtj.co.jp&#10;yamada@vtj.co.jp）"
                className="w-full border rounded px-3 py-2 text-sm font-mono min-h-[120px]"
                disabled={!isAdmin || readOnly}
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  data-testid="roster-save"
                  className="px-4 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-40"
                  onClick={async () => {
                    const emails = (rosterDraft || roster.join("\n"))
                      .split("\n")
                      .map((line) => line.trim())
                      .filter((line) => line);
                    try {
                      const result = await fetchJson<{ roster: string[] }>("/api/mailhub/team", {
                        method: "PUT",
                        body: JSON.stringify({ roster: emails }),
                      });
                      setRoster(result.roster ?? []);
                      setRosterDraft("");
                      showToast("Rosterを保存しました");
                      await load();
                    } catch (e) {
                      showError(`Rosterの保存に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
                    }
                  }}
                  disabled={!isAdmin || readOnly}
                >
                  保存
                </button>
                <button
                  data-testid="roster-reset"
                  className="px-4 py-2 border rounded text-sm disabled:opacity-40"
                  onClick={() => {
                    setRosterDraft("");
                  }}
                  disabled={!isAdmin || readOnly || !rosterDraft}
                >
                  リセット
                </button>
              </div>
            </div>
            {roster.length > 0 && (
              <div className="border rounded p-3">
                <div className="text-sm font-medium mb-2">現在のRoster（{roster.length}件）</div>
                <ul className="space-y-1">
                  {roster.map((email) => (
                    <li key={email} className="text-xs font-mono text-gray-600" data-testid={`roster-item-${email}`}>
                      {email}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      ) : tab === "assignees" ? (
        <section data-testid="settings-panel-assignees">
          {!isAdmin && (
            <div className="mb-3 text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              担当者名簿の編集は管理者のみです。
            </div>
          )}
          <div className="text-[12px] text-[#5f6368] mb-2">
            担当者名簿（Assignees）に登録されたメンバーにメールを割り当てることができます。
          </div>

          {/* 追加ボタン */}
          <div className="mb-4">
            <button
              data-testid="assignees-add"
              className="px-4 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-40"
              disabled={!isAdmin || readOnly}
              onClick={() => {
                setAssigneesDraft((prev) => [...prev, { email: "", displayName: null }]);
              }}
            >
              Add
            </button>
          </div>

          {/* 一覧 */}
          {assigneesDraft.length === 0 ? (
            <div className="text-[12px] text-[#5f6368] py-4">
              担当者が登録されていません。
            </div>
          ) : (
            <ul className="space-y-2 mb-4">
              {assigneesDraft.map((a, idx) => (
                <li key={idx} className="border rounded p-3">
                  <div className="flex flex-col gap-2">
                    <input
                      data-testid={`assignees-email-${idx}`}
                      value={a.email}
                      onChange={(e) => {
                        const updated = [...assigneesDraft];
                        updated[idx] = { ...updated[idx], email: e.target.value };
                        setAssigneesDraft(updated);
                      }}
                      placeholder="メールアドレス（例: tanaka@vtj.co.jp）"
                      className="flex-1 border rounded px-3 py-2 text-sm"
                      disabled={!isAdmin || readOnly}
                    />
                    <div className="flex gap-2">
                      <input
                        data-testid={`assignees-displayName-${idx}`}
                        value={a.displayName ?? ""}
                        onChange={(e) => {
                          const updated = [...assigneesDraft];
                          updated[idx] = { ...updated[idx], displayName: e.target.value || null };
                          setAssigneesDraft(updated);
                        }}
                        placeholder="表示名（任意、例: 田中太郎）"
                        className="flex-1 border rounded px-3 py-2 text-sm"
                        disabled={!isAdmin || readOnly}
                      />
                      <button
                        data-testid={`assignees-remove-${idx}`}
                        className="text-sm text-red-600 hover:underline disabled:opacity-40"
                        disabled={!isAdmin || readOnly}
                        onClick={() => {
                          if (!window.confirm(`${a.email || "(未入力)"} を削除しますか？`)) return;
                          setAssigneesDraft((prev) => prev.filter((_, i) => i !== idx));
                        }}
                      >
                        削除
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* 保存ボタン */}
          <div className="flex gap-2">
            <button
              data-testid="assignees-save"
              className="px-4 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-40"
              disabled={!isAdmin || readOnly || assigneesSaving}
              onClick={async () => {
                // バリデーション
                const cleaned = assigneesDraft
                  .map((a) => ({ email: a.email.toLowerCase().trim(), displayName: a.displayName?.trim() || null }))
                  .filter((a) => a.email);
                
                // vtj.co.jpドメインチェック
                const invalidDomain = cleaned.find((a) => !a.email.endsWith("@vtj.co.jp"));
                if (invalidDomain) {
                  showToast(`${invalidDomain.email} は @vtj.co.jp ドメインではありません`);
                  return;
                }
                
                // 重複チェック
                const emails = cleaned.map((a) => a.email);
                const duplicates = emails.filter((e, i) => emails.indexOf(e) !== i);
                if (duplicates.length > 0) {
                  showToast(`重複: ${duplicates.join(", ")}`);
                  return;
                }
                
                setAssigneesSaving(true);
                try {
                  await fetchJson("/api/mailhub/assignees", {
                    method: "POST",
                    body: JSON.stringify({ assignees: cleaned }),
                  });
                  setAssignees(cleaned);
                  setAssigneesDraft(cleaned);
                  showToast("担当者名簿を保存しました");
                } catch (e) {
                  showError(`保存に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
                } finally {
                  setAssigneesSaving(false);
                }
              }}
            >
              {assigneesSaving ? "保存中..." : "Save"}
            </button>
            <button
              data-testid="assignees-reset"
              className="px-4 py-2 border rounded text-sm disabled:opacity-40"
              disabled={!isAdmin || readOnly || assigneesSaving}
              onClick={() => {
                setAssigneesDraft([...assignees]);
              }}
            >
              Reset
            </button>
          </div>
        </section>
      ) : tab === "diagnostics" ? (
        <section data-testid="settings-panel-diagnostics">
          <div className="text-[12px] text-[#5f6368] mb-4">
            ルール診断結果とヒット統計を表示します（非管理者も閲覧可能）。
          </div>

          {/* Config Health */}
          {configHealth && (
            <div className="mb-6 border rounded p-4 bg-white">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Config Health</h3>
              <div className="space-y-1 text-xs text-gray-600">
                <div>
                  Env: <span className="font-mono">{configHealth.env ?? "unknown"}</span> / ReadOnly:{" "}
                  <span className="font-mono">{String(configHealth.readOnly)}</span> / Admin:{" "}
                  <span className="font-mono">{String(configHealth.isAdmin)}</span>
                </div>
                <div>
                  Config Store: <span className="font-mono">{configHealth.configStore?.resolved ?? configHealth.storeType}</span> / Activity Store:{" "}
                  <span className="font-mono">{configHealth.activityStore?.resolved ?? "unknown"}</span>
                </div>
                <div>
                  Labels: <span className="font-mono">{configHealth.labelsCount}</span> / Rules:{" "}
                  <span className="font-mono">{configHealth.rulesCount}</span>
                </div>
                {!configHealth.readOk && (
                  <div className="text-red-700 mt-1">readError: {configHealth.readError ?? "(unknown)"}</div>
                )}
              </div>
            </div>
          )}

          {/* Rule Inspection */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Rule Inspection</h3>
              <button
                type="button"
                onClick={() => void loadRuleInspection()}
                disabled={isLoadingInspection}
                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
                data-testid="diagnostics-refresh"
              >
                {isLoadingInspection ? "読み込み中..." : "再読み込み"}
              </button>
            </div>

            {isLoadingInspection ? (
              <div className="text-sm text-gray-500 text-center py-8">読み込み中...</div>
            ) : !ruleInspection ? (
              <div className="text-sm text-gray-500 text-center py-8">診断データを取得できませんでした</div>
            ) : (
              <div className="space-y-6">
                {/* Conflicts */}
                {ruleInspection.conflicts.length > 0 && (
                  <div className="border border-red-200 rounded p-4 bg-red-50">
                    <h4 className="text-sm font-semibold text-red-900 mb-2">⚠️ ルール衝突 ({ruleInspection.conflicts.length}件)</h4>
                    <div className="space-y-3">
                      {ruleInspection.conflicts.map((c, i) => (
                        <div key={i} className="text-xs text-red-800 bg-white rounded p-2" data-testid={`diagnostics-conflict-${i}`}>
                          <div className="font-medium mb-1">{c.message}</div>
                          <div className="text-[11px] text-gray-600">
                            ルールID: {c.ruleIds.join(", ")} / 条件:{" "}
                            {c.matchCondition.fromEmail
                              ? `fromEmail=${c.matchCondition.fromEmail}`
                              : c.matchCondition.fromDomain
                                ? `fromDomain=${c.matchCondition.fromDomain}`
                                : "(不明)"}
                          </div>
                          <div className="text-[11px] text-gray-600 mt-1">
                            結果: {c.conflictingResults.map((r) => `${r.ruleId}→${Array.isArray(r.result) ? r.result.join(",") : r.result}`).join(" vs ")}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Dangerous Rules */}
                {ruleInspection.dangerous.length > 0 && (
                  <div className="border border-amber-200 rounded p-4 bg-amber-50">
                    <h4 className="text-sm font-semibold text-amber-900 mb-2">⚠️ 危険なルール ({ruleInspection.dangerous.length}件)</h4>
                    <div className="space-y-2">
                      {ruleInspection.dangerous.map((d, i) => (
                        <div key={i} className="text-xs text-amber-800 bg-white rounded p-2" data-testid={`diagnostics-dangerous-${i}`}>
                          <div className="font-medium mb-1">{d.message}</div>
                          <div className="text-[11px] text-gray-600">
                            ルールID: {d.ruleId} / タイプ: {d.ruleType} / 理由: {d.reason}
                            {d.previewCount !== undefined && ` / Preview件数: ${d.previewCount}`}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Inactive Rules */}
                {ruleInspection.inactive.length > 0 && (
                  <div className="border border-gray-200 rounded p-4 bg-gray-50">
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">ℹ️ 無効なルール ({ruleInspection.inactive.length}件)</h4>
                    <div className="space-y-2">
                      {ruleInspection.inactive.map((inactive, i) => (
                        <div key={i} className="text-xs text-gray-700 bg-white rounded p-2" data-testid={`diagnostics-inactive-${i}`}>
                          <div className="font-medium mb-1">{inactive.message}</div>
                          <div className="text-[11px] text-gray-600">
                            ルールID: {inactive.ruleId} / タイプ: {inactive.ruleType}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Hit Stats */}
                {ruleInspection.hitStats.length > 0 && (
                  <div className="border border-gray-200 rounded p-4 bg-white">
                    <h4 className="text-sm font-semibold text-gray-900 mb-3">📊 ヒット統計 (サンプル50件中)</h4>
                    <div className="space-y-3">
                      {ruleInspection.hitStats.map((stat) => (
                        <div key={stat.ruleId} className="border border-gray-200 rounded p-3" data-testid={`diagnostics-hitstat-${stat.ruleId}`}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-xs font-medium text-gray-900">
                              ルールID: {stat.ruleId} ({stat.ruleType})
                            </div>
                            <div className="text-xs text-gray-600">ヒット数: {stat.hitCount}</div>
                          </div>
                          {stat.sampleMessages.length > 0 && (
                            <details className="mt-2">
                              <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-900">サンプル ({stat.sampleMessages.length}件)</summary>
                              <div className="mt-2 space-y-1 pl-4">
                                {stat.sampleMessages.map((msg) => (
                                  <div key={msg.id} className="text-[11px] text-gray-600">
                                    <span className="font-mono">{msg.id}</span>: {msg.subject ?? "(no subject)"} / {msg.from ?? "(unknown)"}
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* No Issues */}
                {ruleInspection.conflicts.length === 0 &&
                  ruleInspection.dangerous.length === 0 &&
                  ruleInspection.inactive.length === 0 &&
                  ruleInspection.hitStats.length === 0 && (
                    <div className="text-sm text-gray-500 text-center py-8">問題は検出されませんでした</div>
                  )}
              </div>
            )}
          </div>
        </section>
      ) : tab === "suggestions" ? (
        <section data-testid="settings-panel-suggestions">
          <div className="text-[12px] text-[#5f6368] mb-4">
            Activityログから自動的にルール提案を生成します（非管理者も閲覧可能、採用はadminのみ）。
          </div>

          {/* パラメータ設定 */}
          <div className="mb-4 border rounded p-3 bg-white">
            <div className="text-sm font-medium mb-2">検索パラメータ</div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-gray-600">期間（日）</label>
                <input
                  type="number"
                  value={suggestionDays}
                  onChange={(e) => setSuggestionDays(Math.max(1, Math.min(90, parseInt(e.target.value, 10) || 14)))}
                  className="w-full border rounded px-2 py-1 text-sm"
                  min={1}
                  max={90}
                />
              </div>
              <div>
                <label className="text-xs text-gray-600">最小アクション数</label>
                <input
                  type="number"
                  value={suggestionMinActions}
                  onChange={(e) => setSuggestionMinActions(Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 3)))}
                  className="w-full border rounded px-2 py-1 text-sm"
                  min={1}
                  max={100}
                />
              </div>
              <div>
                <label className="text-xs text-gray-600">最小アクター数</label>
                <input
                  type="number"
                  value={suggestionMinActors}
                  onChange={(e) => setSuggestionMinActors(Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 2)))}
                  className="w-full border rounded px-2 py-1 text-sm"
                  min={1}
                  max={50}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadRuleSuggestions()}
              disabled={isLoadingSuggestions}
              className="mt-2 px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
              data-testid="suggestions-refresh"
            >
              {isLoadingSuggestions ? "読み込み中..." : "再読み込み"}
            </button>
          </div>

          {/* 提案リスト */}
          {isLoadingSuggestions ? (
            <div className="text-sm text-gray-500 text-center py-8">読み込み中...</div>
          ) : !ruleSuggestions ? (
            <div className="text-sm text-gray-500 text-center py-8">提案データを取得できませんでした</div>
          ) : (
            <div className="space-y-4">
              {/* 全体の警告 */}
              {ruleSuggestions.warnings.length > 0 && (
                <div className="border border-amber-200 rounded p-3 bg-amber-50">
                  {ruleSuggestions.warnings.map((w, i) => (
                    <div key={i} className="text-xs text-amber-800">{w.message}</div>
                  ))}
                </div>
              )}

              {/* 提案カード */}
              {ruleSuggestions.suggestions.length === 0 ? (
                <div className="text-sm text-gray-500 text-center py-8">提案はありません</div>
              ) : (
                ruleSuggestions.suggestions.map((suggestion) => (
                  <div key={suggestion.suggestionId} className="border border-gray-200 rounded p-4 bg-white" data-testid={`suggestion-${suggestion.suggestionId}`}>
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-semibold text-gray-900">
                            {suggestion.type === "auto_label" ? "Auto Label" : suggestion.type === "auto_mute" ? "Auto Mute" : "Auto Assign"}
                          </span>
                          {suggestion.warnings.length > 0 && (
                            <span className="text-xs text-amber-800 bg-amber-100 px-2 py-0.5 rounded">⚠️ 警告あり</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-600 mb-1">
                          送信元: {suggestion.sender.fromEmail ?? suggestion.sender.fromDomain ?? "(不明)"}
                        </div>
                        <div className="text-xs text-gray-700 mb-1">{suggestion.reason}</div>
                        <div className="text-xs text-gray-500">
                          根拠: {suggestion.evidenceCount}件 / 関与: {suggestion.actorCount}人 ({suggestion.actors.slice(0, 3).join(", ")}
                          {suggestion.actors.length > 3 ? "..." : ""})
                        </div>
                        {suggestion.warnings.length > 0 && (
                          <div className="mt-2 text-xs text-amber-800">
                            {suggestion.warnings.map((w, i) => (
                              <div key={i}>⚠️ {w.message}</div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          type="button"
                          onClick={async () => {
                            // Preview機能（既存のdryRun導線に接続）
                            try {
                              // Activityログを記録（best-effort）
                              try {
                                await fetchJson("/api/mailhub/rules/suggestions/preview", {
                                  method: "POST",
                                  body: JSON.stringify({ suggestionId: suggestion.suggestionId, type: suggestion.type }),
                                });
                              } catch {
                                // 無視
                              }

                              if (suggestion.type === "auto_assign") {
                                // Assignee Rule Preview
                                const res = await fetchJson<{ preview: AssigneeApplyPreview }>("/api/mailhub/assignee-rules/apply", {
                                  method: "POST",
                                  body: JSON.stringify({
                                    dryRun: true,
                                    match: suggestion.proposedRule.match,
                                    assigneeEmail: suggestion.proposedRule.assigneeEmail,
                                  }),
                                });
                                showToast(`Preview: ${res.preview.matchedCount}件`);
                              } else {
                                // Label Rule Preview
                                const res = await fetchJson<{ preview: PreviewResult }>("/api/mailhub/rules/apply", {
                                  method: "POST",
                                  body: JSON.stringify({
                                    dryRun: true,
                                    match: suggestion.proposedRule.match,
                                    labelNames: suggestion.proposedRule.labelNames,
                                  }),
                                });
                                showToast(`Preview: ${res.preview.matchedCount}件`);
                              }
                            } catch (e) {
                              showError(`Previewに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
                            }
                          }}
                          className="px-3 py-1.5 text-xs border rounded hover:bg-gray-50"
                          data-testid={`suggestion-preview-${suggestion.suggestionId}`}
                        >
                          Preview
                        </button>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={async () => {
                              if (!canWriteStore) {
                                showError(readOnly ? "READ ONLYのため保存できません" : "Gmail権限がreadonlyのため保存できません");
                                return;
                              }

                              let ok = true;
                              if (suggestion.warnings.length > 0) {
                                ok = window.confirm(
                                  `⚠️ 警告があります:\n${suggestion.warnings.map((w) => `- ${w.message}`).join("\n")}\n\nこの提案を採用してルールを作成しますか？`,
                                );
                                if (!ok) return;
                              }

                              ok = window.confirm(`この提案を採用してルールを作成しますか？\n\n送信元: ${suggestion.sender.fromEmail ?? suggestion.sender.fromDomain}\n理由: ${suggestion.reason}`);
                              if (!ok) return;

                              try {
                                if (suggestion.type === "auto_assign") {
                                  await fetchJson("/api/mailhub/assignee-rules", {
                                    method: "POST",
                                    body: JSON.stringify({
                                      match: suggestion.proposedRule.match,
                                      assigneeEmail: suggestion.proposedRule.assigneeEmail,
                                      enabled: true,
                                      priority: 0,
                                      when: { unassignedOnly: true },
                                      safety: { dangerousDomainConfirm: suggestion.warnings.some((w) => w.type === "broad_domain") },
                                      suggestionId: suggestion.suggestionId,
                                      suggestionType: suggestion.type,
                                    }),
                                  });
                                  // ActivityログはAPI側で記録される
                                } else {
                                  await fetchJson("/api/mailhub/rules", {
                                    method: "POST",
                                    body: JSON.stringify({
                                      match: suggestion.proposedRule.match,
                                      labelNames: suggestion.proposedRule.labelNames,
                                      enabled: true,
                                      suggestionId: suggestion.suggestionId,
                                      suggestionType: suggestion.type,
                                    }),
                                  });
                                  // ActivityログはAPI側で記録される
                                }
                                showToast("ルールを作成しました");
                                await load();
                                await loadRuleSuggestions();
                              } catch (e) {
                                showError(`ルールの作成に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
                              }
                            }}
                            disabled={!canWriteStore || !isAdmin}
                            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
                            data-testid={`suggestion-apply-${suggestion.suggestionId}`}
                          >
                            採用して作成
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </section>
      ) : null}

      {/* Step 52: Queues Tab */}
      {tab === "queues" ? (
        <section data-testid="settings-panel-queues">
          <div className="text-[12px] text-[#5f6368] mb-4">
            よく使う検索を保存してワンクリックで呼べるようにします（adminのみ編集可能、非adminは閲覧のみ）。
          </div>

          {!isAdmin && (
            <div className="mb-3 text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              閲覧のみ（編集はadminのみ）
            </div>
          )}

          {readOnly && isAdmin && (
            <div className="mb-3 text-[12px] text-red-900 bg-red-50 border border-red-200 rounded px-3 py-2">
              READ ONLYのため編集できません
            </div>
          )}

          {/* Create Form (admin only) */}
          {isAdmin && !readOnly && (
            <div className="mb-4 p-3 border border-[#dadce0] rounded">
              <div className="text-[13px] font-medium text-[#202124] mb-2">
                {editingQueueId ? "編集" : "新規作成"}
              </div>
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="名前（例: 楽天：メンテ通知）"
                  value={editingQueueId ? savedSearches.find((s) => s.id === editingQueueId)?.name ?? newQueueName : newQueueName}
                  onChange={(e) => {
                    if (editingQueueId) {
                      // 編集時は直接更新（後で保存）
                      setSavedSearches((prev) =>
                        prev.map((s) => (s.id === editingQueueId ? { ...s, name: e.target.value } : s))
                      );
                    } else {
                      setNewQueueName(e.target.value);
                    }
                  }}
                  className="w-full border border-[#dadce0] rounded px-2 py-1.5 text-[13px]"
                  maxLength={40}
                />
                <input
                  type="text"
                  placeholder="Gmail検索式（例: from:rakuten subject:(メンテナンス)）"
                  value={editingQueueId ? savedSearches.find((s) => s.id === editingQueueId)?.query ?? newQueueQuery : newQueueQuery}
                  onChange={(e) => {
                    if (editingQueueId) {
                      setSavedSearches((prev) =>
                        prev.map((s) => (s.id === editingQueueId ? { ...s, query: e.target.value } : s))
                      );
                    } else {
                      setNewQueueQuery(e.target.value);
                    }
                  }}
                  className="w-full border border-[#dadce0] rounded px-2 py-1.5 text-[13px]"
                  maxLength={500}
                />
                <select
                  value={editingQueueId ? savedSearches.find((s) => s.id === editingQueueId)?.baseLabelId ?? newQueueBaseLabelId ?? "" : newQueueBaseLabelId ?? ""}
                  onChange={(e) => {
                    const value = e.target.value || null;
                    if (editingQueueId) {
                      setSavedSearches((prev) =>
                        prev.map((s) => (s.id === editingQueueId ? { ...s, baseLabelId: value } : s))
                      );
                    } else {
                      setNewQueueBaseLabelId(value);
                    }
                  }}
                  className="w-full border border-[#dadce0] rounded px-2 py-1.5 text-[13px]"
                >
                  <option value="">現在のラベルを維持</option>
                  <option value="all">All</option>
                  <option value="todo">Todo</option>
                  <option value="waiting">Waiting</option>
                  <option value="mine">Mine</option>
                  <option value="unassigned">Unassigned</option>
                </select>
                <div className="flex gap-2">
                  <button
                    type="button"
                    data-testid={editingQueueId ? "queue-save" : "queue-create"}
                    onClick={async () => {
                      if (editingQueueId) {
                        const search = savedSearches.find((s) => s.id === editingQueueId);
                        if (!search) return;
                        try {
                          await fetchJson(`/api/mailhub/queues/${editingQueueId}`, {
                            method: "PATCH",
                            body: JSON.stringify({
                              name: search.name,
                              query: search.query,
                              baseLabelId: search.baseLabelId,
                            }),
                          });
                          showToast("更新しました");
                          setEditingQueueId(null);
                          await load();
                        } catch (e) {
                          showError(`更新に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
                        }
                      } else {
                        if (!newQueueName.trim() || !newQueueQuery.trim()) {
                          showError("名前と検索式を入力してください");
                          return;
                        }
                        try {
                          await fetchJson("/api/mailhub/queues", {
                            method: "POST",
                            body: JSON.stringify({
                              name: newQueueName.trim(),
                              query: newQueueQuery.trim(),
                              baseLabelId: newQueueBaseLabelId,
                            }),
                          });
                          showToast("作成しました");
                          setNewQueueName("");
                          setNewQueueQuery("");
                          setNewQueueBaseLabelId(null);
                          await load();
                        } catch (e) {
                          showError(`作成に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
                        }
                      }
                    }}
                    className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    {editingQueueId ? "保存" : "作成"}
                  </button>
                  {editingQueueId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingQueueId(null);
                        void load();
                      }}
                      className="px-3 py-1.5 text-xs border rounded hover:bg-gray-50"
                    >
                      キャンセル
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* List */}
          <div className="space-y-2">
            {savedSearches.length === 0 ? (
              <div className="text-[12px] text-[#5f6368] py-3">保存済みキューがありません</div>
            ) : (
              savedSearches.map((search) => (
                <div
                  key={search.id}
                  data-testid={`queue-row-${search.id}`}
                  className="p-3 border border-[#dadce0] rounded flex items-center justify-between"
                >
                  <div className="flex-1">
                    <div className="text-[13px] font-medium text-[#202124]">{search.name}</div>
                    <div className="text-[11px] text-[#5f6368] mt-1 font-mono">{search.query}</div>
                    {search.baseLabelId && (
                      <div className="text-[11px] text-[#5f6368] mt-1">
                        適用先: {search.baseLabelId}
                      </div>
                    )}
                  </div>
                  {isAdmin && !readOnly && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingQueueId(search.id);
                          setNewQueueName(search.name);
                          setNewQueueQuery(search.query);
                          setNewQueueBaseLabelId(search.baseLabelId ?? null);
                        }}
                        className="px-2 py-1 text-xs border rounded hover:bg-gray-50"
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        data-testid={`queue-delete-${search.id}`}
                        onClick={async () => {
                          if (!window.confirm(`「${search.name}」を削除しますか？`)) return;
                          try {
                            await fetchJson(`/api/mailhub/queues/${search.id}`, {
                              method: "DELETE",
                            });
                            showToast("削除しました");
                            await load();
                          } catch (e) {
                            showError(`削除に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
                          }
                        }}
                        className="px-2 py-1 text-xs border rounded hover:bg-gray-50 text-red-600"
                      >
                        削除
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      ) : null}

      {/* Footer: store status / import */}
      <div className="mt-6 pt-4 border-t border-[#e8eaed] text-[12px] text-[#5f6368] flex items-center justify-between gap-3" data-testid="settings-footer">
        <div className="truncate">
          Env: <span className="font-mono text-[#202124]">{configHealth?.env ?? "unknown"}</span> / Config:{" "}
          <span className="font-mono text-[#202124]">{configHealth?.configStore?.resolved ?? configHealth?.storeType ?? "unknown"}</span>{" "}
          / Activity: <span className="font-mono text-[#202124]">{configHealth?.activityStore?.resolved ?? "unknown"}</span>{" "}
          {readOnly && <span className="ml-2 text-red-700 font-medium">READ ONLY</span>}
          {configHealth?.gmailModifyEnabled === false && (
            <span className="ml-2 text-amber-800">Gmail権限: readonly（modify不可）</span>
          )}
          {(configHealth?.configStore?.resolved ?? configHealth?.storeType) === "sheets" && (
            <span className="ml-2">({configHealth?.configStore?.sheetsOk ? "OK" : "ERR"})</span>
          )}
          {configHealth?.activityStore?.requested === "sheets" && configHealth?.activityStore?.resolved !== "sheets" && (
            <span className="ml-2 text-amber-800">Activity: sheets設定不足（memoryへフォールバック）</span>
          )}
          {!configHealth?.adminsConfigured && (
            <span className="ml-2 text-amber-800">MAILHUB_ADMINS 未設定</span>
          )}
          {configHealth && !configHealth.readOk && (
            <span className="ml-2 text-red-700">設定読み取り失敗</span>
          )}
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              data-testid="config-export"
              className="px-2 py-1 border rounded hover:bg-gray-50"
              onClick={() => void handleExportConfig()}
              title="設定（labels/rules/assignees）をJSONでバックアップ（秘密情報は含みません）"
            >
              Export
            </button>
            <button
              type="button"
              data-testid="weekly-report-csv"
              className="px-2 py-1 border rounded hover:bg-gray-50"
              onClick={() => void handleWeeklyReportCsv()}
              title="週次レポート（Activity集計/actorトップ/未割当残件）をCSVでダウンロード"
            >
              Weekly Report CSV
            </button>
            {lastExportAt && (
              <span className="text-[11px] text-[#5f6368]" title="最後のExport時刻">
                最終: {lastExportAt}
              </span>
            )}
            {(configHealth?.storeType === "sheets" || configHealth?.writeGuards?.testMode) && (
              <>
            <button
              type="button"
              data-testid="config-import-preview"
              className="px-2 py-1 border rounded hover:bg-gray-50 disabled:opacity-40"
              onClick={() => void runImportDryRun()}
              disabled={isImporting || readOnly}
            >
              Import Preview
            </button>
            <button
              type="button"
              data-testid="config-import-apply"
              className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
              onClick={() => void runImportExecute()}
              disabled={
                isImporting ||
                readOnly ||
                !importPreview ||
                (importPreview.labels.willAdd + importPreview.labels.willUpdate + importPreview.rules.willAdd + importPreview.rules.willUpdate === 0)
              }
              title={!importPreview ? "先にPreviewを取得してください" : ""}
            >
              Import Apply
            </button>
              </>
            )}
          </div>
        )}
      </div>

      {configHealth && (
        <div className="mt-3 text-[12px] border rounded px-3 py-2 bg-white" data-testid="settings-health">
          <div className="font-medium text-[#202124]">Health</div>
          <div className="mt-1">
            Env: <span className="font-mono">{configHealth.env ?? "unknown"}</span>
          </div>
          <div className="mt-1">
            Inbox: <span className="font-mono">{configHealth.sharedInboxEmailMasked ?? "(unknown)"}</span> / Prefix:{" "}
            <span className="font-mono">{configHealth.labelPrefix}</span>
          </div>
          <div className="mt-1">
            Gmail scopes:{" "}
            <span className="font-mono">
              {configHealth.gmailScopes ? configHealth.gmailScopes.join(" ") : "(unknown)"}
            </span>
            {configHealth.gmailScopeError && (
              <span className="ml-2 text-amber-800">({configHealth.gmailScopeError})</span>
            )}
          </div>
          <div className="mt-1">
            Stores: config={configHealth.configStore?.resolved ?? configHealth.storeType} / activity=
            {configHealth.activityStore?.resolved ?? "unknown"}
          </div>
          <div>
            Guards: readOnly={String(configHealth.writeGuards.readOnly)} / admin={String(configHealth.writeGuards.isAdmin)} / testMode={String(configHealth.writeGuards.testMode)}
          </div>
          {!configHealth.readOk && (
            <div className="text-red-700 mt-1">readError: {configHealth.readError ?? "(unknown)"}</div>
          )}
          {(configHealth.adminInvalidCount > 0 || configHealth.adminNonVtjCount > 0) && (
            <div className="text-amber-800 mt-1">
              admins: invalid={configHealth.adminInvalidCount}, nonVtj={configHealth.adminNonVtjCount}
            </div>
          )}
        </div>
      )}

      {importPreview && (
        <div className="mt-3 text-[12px] border rounded px-3 py-2 bg-white" data-testid="config-import-preview-result">
          <div className="font-medium text-[#202124]">Import Preview（File → Sheets）</div>
          {importPreview.warnings.length > 0 && (
            <div className="mt-2 text-[12px] text-red-700" data-testid="config-import-warning">
              {importPreview.warnings.map((w, idx) => (
                <div key={`warning-${idx}`}>{w.message}</div>
              ))}
            </div>
          )}
          <div className="mt-2">
            Labels: file {importPreview.labels.sourceCount} / current {importPreview.labels.targetCount} / add {importPreview.labels.willAdd} / update {importPreview.labels.willUpdate} / skip {importPreview.labels.willSkip}
          </div>
          <div>
            Rules: file {importPreview.rules.sourceCount} / current {importPreview.rules.targetCount} / add {importPreview.rules.willAdd} / update {importPreview.rules.willUpdate} / skip {importPreview.rules.willSkip}
          </div>
          {renderDiffList(
            "Labels Add",
            importPreview.labels.add,
            (item) => `${item.labelName} ${item.afterDisplayName ? `(${item.afterDisplayName})` : ""}`.trim(),
            "config-import-labels-add",
          )}
          {renderDiffList(
            "Labels Update",
            importPreview.labels.update,
            (item) => `${item.labelName} ${item.beforeDisplayName ?? ""} → ${item.afterDisplayName ?? ""}`.trim(),
            "config-import-labels-update",
          )}
          {renderDiffList(
            "Labels Skip",
            importPreview.labels.skip,
            (item) => item.labelName,
            "config-import-labels-skip",
          )}
          {renderDiffList(
            "Rules Add",
            importPreview.rules.add,
            (item) => item.id,
            "config-import-rules-add",
          )}
          {renderDiffList(
            "Rules Update",
            importPreview.rules.update,
            (item) => item.id,
            "config-import-rules-update",
          )}
          {renderDiffList(
            "Rules Skip",
            importPreview.rules.skip,
            (item) => item.id,
            "config-import-rules-skip",
          )}
        </div>
      )}
    </div>
  );
}


