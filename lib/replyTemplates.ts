/**
 * Reply Templates - 変数埋めロジック
 * Step46: プレースホルダ置換 + 未解決検出
 */

export type TemplateVariable = {
  key: string;
  value: string | null; // null = 未解決
  resolved: boolean;
};

export type TemplateRenderResult = {
  rendered: string; // 変数埋め後の本文
  unresolved: string[]; // 未解決のプレースホルダ（例: ["{{inquiryId}}", "{{orderId}}"]）
  warnings: string[]; // 警告メッセージ
};

/**
 * テンプレ本文から変数を抽出（{{key}}形式）
 */
export function extractTemplateVariables(templateBody: string): string[] {
  const matches = templateBody.matchAll(/\{\{(\w+)\}\}/g);
  const vars = new Set<string>();
  for (const match of matches) {
    vars.add(match[1]);
  }
  return Array.from(vars);
}

/**
 * テンプレをレンダリング（変数埋め）
 * @param templateBody テンプレ本文（{{key}}形式のプレースホルダを含む）
 * @param variables 変数マップ（key -> value、nullは未解決）
 */
export function renderTemplate(templateBody: string, variables: Record<string, string | null>): TemplateRenderResult {
  const unresolved: string[] = [];
  const warnings: string[] = [];
  
  // テンプレ本文内の変数を抽出
  const varKeys = extractTemplateVariables(templateBody);
  
  // 未解決の変数を検出
  for (const key of varKeys) {
    if (!(key in variables) || variables[key] === null) {
      unresolved.push(`{{${key}}}`);
    }
  }
  
  // 変数埋め（未解決はそのまま残す）
  let rendered = templateBody;
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    if (rendered.includes(placeholder)) {
      if (value === null) {
        // 未解決はそのまま残す（事故防止）
        warnings.push(`{{${key}}} が未解決です`);
      } else {
        rendered = rendered.replaceAll(placeholder, value);
      }
    }
  }
  
  // 未解決プレースホルダが残っている場合は警告
  if (unresolved.length > 0) {
    warnings.push(`未解決のプレースホルダ: ${unresolved.join(", ")}`);
  }
  
  return {
    rendered,
    unresolved,
    warnings,
  };
}

/**
 * メッセージ情報から変数マップを構築
 */
export type MessageContext = {
  inquiryId?: string | null; // 楽天問い合わせ番号
  orderId?: string | null;
  customerEmail?: string | null;
  fromName?: string | null;
  fromEmail?: string | null;
  subject?: string | null;
  store?: string | null; // StoreA/B/Cなど
  assignee?: string | null; // 担当者名
  agent?: string | null; // 操作者（表示名 or email）
  today?: string; // YYYY-MM-DD（デフォルト: 今日）
};

export function buildVariablesFromContext(context: MessageContext): Record<string, string | null> {
  const today = context.today ?? new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  
  return {
    inquiryId: context.inquiryId ?? null,
    orderId: context.orderId ?? null,
    customerEmail: context.customerEmail ?? null,
    fromName: context.fromName ?? null,
    fromEmail: context.fromEmail ?? null,
    subject: context.subject ?? null,
    store: context.store ?? null,
    assignee: context.assignee ?? null,
    agent: context.agent ?? null,
    today,
  };
}
