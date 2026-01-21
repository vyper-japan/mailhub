/**
 * メールアドレスを担当者ラベルのslugに変換
 * @example "tanaka@vtj.co.jp" -> "tanaka_at_vtj_co_jp"
 */
export function assigneeSlug(email: string): string {
  return email
    .toLowerCase()
    .replace(/@/g, "_at_")
    .replace(/\./g, "_")
    .replace(/[^a-z0-9_]/g, "");
}




