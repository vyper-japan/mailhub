/**
 * Assignee Rules（未割当の自動ルーティング）
 * NOTE: UI（client）でも使うため server-only は付けない（純粋関数のみ）。
 */

export function normalizeFromEmail(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  // "Name <foo@bar.com>" 形式の抽出
  const m = s.match(/<([^>]+)>/);
  const email = (m?.[1] ?? s).trim().toLowerCase();
  if (!email.includes("@")) return null;
  if (email.includes(" ")) return null;
  return email;
}

export type AssigneeRuleMatch = {
  fromEmail?: string; // normalized
  fromDomain?: string; // lowercased, no leading "@"
};

export type AssigneeRuleWhen = {
  unassignedOnly: boolean;
};

export type AssigneeRuleSafety = {
  // 広すぎるドメインは UI 側で強警告 + confirm を出すためのフラグ
  dangerousDomainConfirm: boolean;
};

export type AssigneeRule = {
  id: string;
  enabled: boolean;
  priority: number; // smaller = earlier
  match: AssigneeRuleMatch;
  assigneeEmail: string; // must be @vtj.co.jp
  when: AssigneeRuleWhen;
  safety: AssigneeRuleSafety;
  createdAt: string;
  updatedAt?: string;
};

export type AssigneeRuleMatchResult =
  | { ok: true; reason: "fromEmail" | "fromDomain" }
  | { ok: false; reason: "no_match" | "invalid_rule" };

export function normalizeVtjEmail(input: string): string | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (!s.endsWith("@vtj.co.jp")) return null;
  // very loose email sanity
  if (!s.includes("@") || s.startsWith("@") || s.includes(" ")) return null;
  return s;
}

export function normalizeDomain(input: string): string | null {
  const s = input.trim().toLowerCase().replace(/^@/, "");
  if (!s) return null;
  if (s.includes(" ")) return null;
  if (!s.includes(".")) return null;
  return s;
}

export function isDangerousDomain(domain: string): boolean {
  const d = domain.trim().toLowerCase().replace(/^@/, "");
  // 代表的な「広すぎ」ドメイン（誤爆リスクが高い）
  const risky = new Set([
    "gmail.com",
    "yahoo.co.jp",
    "yahoo.com",
    "outlook.com",
    "hotmail.com",
    "icloud.com",
    "live.com",
  ]);
  return risky.has(d);
}

export function getFromDomain(fromEmail: string): string | null {
  const normalized = normalizeFromEmail(fromEmail);
  if (!normalized) return null;
  const at = normalized.lastIndexOf("@");
  if (at < 0) return null;
  const d = normalized.slice(at + 1).trim().toLowerCase();
  return d || null;
}

export function matchAssigneeRule(fromEmail: string, rule: AssigneeRule): AssigneeRuleMatchResult {
  const email = normalizeFromEmail(fromEmail);
  if (!email) return { ok: false, reason: "invalid_rule" };

  const m = rule.match ?? {};
  const byEmail = typeof m.fromEmail === "string" ? normalizeFromEmail(m.fromEmail) : null;
  const byDomain = typeof m.fromDomain === "string" ? normalizeDomain(m.fromDomain) : null;

  if (!byEmail && !byDomain) return { ok: false, reason: "invalid_rule" };

  if (byEmail && email === byEmail) return { ok: true, reason: "fromEmail" };

  if (byDomain) {
    const domain = getFromDomain(email);
    if (domain && domain === byDomain) return { ok: true, reason: "fromDomain" };
  }

  return { ok: false, reason: "no_match" };
}

export function pickAssigneeRule(fromEmail: string, rules: AssigneeRule[]): AssigneeRule | null {
  const effective = rules
    .filter((r) => r.enabled !== false)
    .slice()
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  for (const r of effective) {
    const hit = matchAssigneeRule(fromEmail, r);
    if (hit.ok) return r;
  }
  return null;
}

