export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
}

export async function postJsonOrThrow<T>(
  url: string,
  body: unknown,
): Promise<T | null> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errorData = (await res.json().catch(() => ({} as Record<string, unknown>))) as Record<string, unknown>;
    const errorMessage =
      (typeof errorData.message === "string" ? errorData.message : undefined) ||
      (typeof errorData.error === "string" ? errorData.error : undefined) ||
      `${res.status} ${res.statusText}`;
    // ステータスコードを含むエラーオブジェクトを投げる（409エラーの検出を容易にするため）
    const error = new Error(errorMessage) as Error & { status?: number; errorData?: unknown };
    error.status = res.status;
    error.errorData = errorData;
    throw error;
  }
  return (await res.json().catch(() => null)) as T | null;
}




