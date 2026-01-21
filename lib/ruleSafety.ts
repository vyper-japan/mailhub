/**
 * ルール運用の安全弁（誤爆防止）
 * - fromDomain が広すぎるケースをヒューリスティックに検知し、UIで警告/confirmに使う
 */

export function normalizeDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^@/, "").replace(/^\./, "");
}

/**
 * fromDomain が「広すぎる」可能性が高いものを検知する。
 * 完全なPublic Suffix Listではなく、運用で危険になりやすいものを優先して弾く。
 */
export function isBroadDomain(domain: string): boolean {
  const d = normalizeDomain(domain);
  if (!d) return false;

  const riskyExact = new Set([
    "gmail.com",
    "googlemail.com",
    "yahoo.com",
    "outlook.com",
    "hotmail.com",
    "icloud.com",
  ]);
  if (riskyExact.has(d)) return true;

  // 例: example.com / foo.net / bar.org（会社ドメインだと致命傷になりやすい）
  if (/^[^.]+\.(com|net|org)$/.test(d)) return true;

  // 例: rakuten.co.jp / something.ne.jp（会社ドメインだと致命傷になりやすい）
  if (/^[^.]+\.(co|ne)\.jp$/.test(d)) return true;

  return false;
}



