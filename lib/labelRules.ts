export type LabelRuleMatch = {
  /** 送信元メールアドレス完全一致（デフォルト） */
  fromEmail?: string;
  /** 送信元ドメイン一致（任意） */
  fromDomain?: string;
  /** 件名にいずれかを含む（任意・OR） */
  subjectContains?: string[];
  /** 件名にいずれも含まない（任意・AND） */
  subjectNotContains?: string[];
};

export type LabelRuleAction = "label" | "archive";

/**
 * Assignアクション指定（Step 83追加）
 * - "me": 自分（API呼び出しユーザー）に割り当て
 * - { assigneeEmail: string }: 指定メールに割り当て
 */
export type AssignToSpec = "me" | { assigneeEmail: string };

export type LabelRule = {
  id: string;
  match: LabelRuleMatch;
  action?: LabelRuleAction;
  /**
   * 付与するラベル（複数可）
   * - backward-compat: labelName も読み取り対象にする
   */
  labelNames?: string[];
  labelName?: string;
  /**
   * (Step 83) 担当者割り当て（optional）
   * - "me": 自分に割り当て
   * - { assigneeEmail: "x@vtj.co.jp" }: 指定メールに割り当て
   */
  assignTo?: AssignToSpec;
  enabled: boolean;
  createdAt: string; // ISO
};

export function normalizeFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return null;
  // very small sanity check
  if (!trimmed.includes("@")) return null;
  return trimmed;
}

export function normalizeAssignToSpec(value: unknown): AssignToSpec | undefined {
  if (value === "me") return "me";
  if (!value || typeof value !== "object") return undefined;
  const raw = (value as Record<string, unknown>).assigneeEmail;
  if (typeof raw !== "string") return undefined;
  const email = normalizeFromEmail(raw);
  if (!email || !email.endsWith("@vtj.co.jp")) return undefined;
  return { assigneeEmail: email };
}

/**
 * "Name <foo@bar.com>" / "foo@bar.com" / "\"Name\" <foo@bar.com>" を想定してemailを抽出する。
 */
export function extractFromEmail(fromHeader: string | null | undefined): string | null {
  if (!fromHeader) return null;
  const s = fromHeader.trim();
  if (!s) return null;

  const angle = s.match(/<\s*([^>\s]+@[^>\s]+)\s*>/);
  if (angle?.[1]) return normalizeFromEmail(angle[1]);

  // fallback: first token that looks like an email
  const token = s.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  if (token?.[1]) return normalizeFromEmail(token[1]);

  return null;
}

export function extractFromDomain(fromEmail: string | null | undefined): string | null {
  const normalized = normalizeFromEmail(fromEmail);
  if (!normalized) return null;
  const at = normalized.lastIndexOf("@");
  if (at === -1) return null;
  const domain = normalized.slice(at + 1);
  return domain || null;
}

function labelsForRule(r: LabelRule): string[] {
  if (Array.isArray(r.labelNames) && r.labelNames.length > 0) return r.labelNames.filter(Boolean);
  if (typeof r.labelName === "string" && r.labelName) return [r.labelName];
  return [];
}

function normalizeTextList(values: string[] | undefined): string[] {
  return (values ?? [])
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

function matchSubject(subject: string | null | undefined, match: LabelRuleMatch): boolean {
  const normalizedSubject = (subject ?? "").toLowerCase();
  const contains = normalizeTextList(match.subjectContains);
  if (contains.length > 0 && !contains.some((needle) => normalizedSubject.includes(needle))) return false;

  const notContains = normalizeTextList(match.subjectNotContains);
  if (notContains.length > 0 && notContains.some((needle) => normalizedSubject.includes(needle))) return false;

  return true;
}

function matchFrom(email: string, domain: string | null, match: LabelRuleMatch): boolean {
  if (match.fromEmail && normalizeFromEmail(match.fromEmail) === email) return true;
  if (match.fromDomain && domain && match.fromDomain.trim().toLowerCase().replace(/^@/, "") === domain) return true;
  return false;
}

function ruleMatches(email: string, domain: string | null, subject: string | null | undefined, rule: LabelRule): boolean {
  return matchFrom(email, domain, rule.match) && matchSubject(subject, rule.match);
}

function actionForRule(rule: LabelRule): LabelRuleAction {
  return rule.action === "archive" ? "archive" : "label";
}

export function matchRules(fromEmail: string, rules: LabelRule[], subject?: string | null): string[] {
  const email = normalizeFromEmail(fromEmail);
  if (!email) return [];
  const domain = extractFromDomain(email);

  const out = new Set<string>();
  for (const r of rules) {
    if (!r.enabled) continue;
    if (ruleMatches(email, domain, subject, r)) {
      for (const n of labelsForRule(r)) out.add(n);
    }
  }
  return [...out];
}

/**
 * Step 83: matchRulesの拡張版。labels + assignToを返す
 */
export type MatchResult = {
  labels: string[];
  assignTo: AssignToSpec | null; // 最初にマッチしたルールのassignToを返す（複数ルールがある場合は先勝ち）
  action: LabelRuleAction | null; // 最初にマッチしたルールのaction。未指定はlabel
  matchedRuleId: string | null;
};

export function matchRulesWithAssign(fromEmail: string, rules: LabelRule[], subject?: string | null): MatchResult {
  const email = normalizeFromEmail(fromEmail);
  if (!email) return { labels: [], assignTo: null, action: null, matchedRuleId: null };
  const domain = extractFromDomain(email);

  const labels = new Set<string>();
  let assignTo: AssignToSpec | null = null;
  let action: LabelRuleAction | null = null;
  let matchedRuleId: string | null = null;

  for (const r of rules) {
    if (!r.enabled) continue;
    const matched = ruleMatches(email, domain, subject, r);
    if (matched) {
      if (matchedRuleId === null) {
        matchedRuleId = r.id;
        action = actionForRule(r);
      }
      for (const n of labelsForRule(r)) labels.add(n);
      // assignTo: 最初にマッチしたルールのassignToを採用（複数ルールがある場合は先勝ち）
      if (assignTo === null && r.assignTo) {
        assignTo = r.assignTo;
      }
    }
  }
  return { labels: [...labels], assignTo, action, matchedRuleId };
}
