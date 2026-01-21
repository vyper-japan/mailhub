export type LabelRuleMatch = {
  /** 送信元メールアドレス完全一致（デフォルト） */
  fromEmail?: string;
  /** 送信元ドメイン一致（任意） */
  fromDomain?: string;
};

/**
 * Assignアクション指定（Step 83追加）
 * - "me": 自分（API呼び出しユーザー）に割り当て
 * - { assigneeEmail: string }: 指定メールに割り当て
 */
export type AssignToSpec = "me" | { assigneeEmail: string };

export type LabelRule = {
  id: string;
  match: LabelRuleMatch;
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

export function matchRules(fromEmail: string, rules: LabelRule[]): string[] {
  const email = normalizeFromEmail(fromEmail);
  if (!email) return [];
  const domain = extractFromDomain(email);

  const out = new Set<string>();
  for (const r of rules) {
    if (!r.enabled) continue;
    if (r.match.fromEmail && normalizeFromEmail(r.match.fromEmail) === email) {
      for (const n of labelsForRule(r)) out.add(n);
      continue;
    }
    if (r.match.fromDomain && domain && r.match.fromDomain.toLowerCase() === domain) {
      for (const n of labelsForRule(r)) out.add(n);
      continue;
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
};

export function matchRulesWithAssign(fromEmail: string, rules: LabelRule[]): MatchResult {
  const email = normalizeFromEmail(fromEmail);
  if (!email) return { labels: [], assignTo: null };
  const domain = extractFromDomain(email);

  const labels = new Set<string>();
  let assignTo: AssignToSpec | null = null;

  for (const r of rules) {
    if (!r.enabled) continue;
    let matched = false;
    if (r.match.fromEmail && normalizeFromEmail(r.match.fromEmail) === email) {
      matched = true;
    } else if (r.match.fromDomain && domain && r.match.fromDomain.toLowerCase() === domain) {
      matched = true;
    }
    if (matched) {
      for (const n of labelsForRule(r)) labels.add(n);
      // assignTo: 最初にマッチしたルールのassignToを採用（複数ルールがある場合は先勝ち）
      if (assignTo === null && r.assignTo) {
        assignTo = r.assignTo;
      }
    }
  }
  return { labels: [...labels], assignTo };
}


