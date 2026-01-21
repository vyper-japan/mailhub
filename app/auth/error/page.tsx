import Link from "next/link";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function getFirstString(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0];
  return undefined;
}

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = searchParams ? await searchParams : undefined;
  const error = getFirstString(sp?.error) ?? "unknown";

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4">
      <div className="w-full max-w-md bg-white border border-[#dadce0] rounded-lg p-6 shadow-sm">
        <h1 className="text-[18px] font-semibold text-[#202124]">サインインに失敗しました</h1>
        <p className="mt-2 text-[13px] text-[#5f6368]">
          エラー: <span className="font-mono text-[#202124]">{error}</span>
        </p>
        <div className="mt-5 flex items-center gap-3">
          <Link
            href="/auth/signin"
            className="inline-flex items-center justify-center h-9 px-4 rounded-md bg-[#1a73e8] text-white text-[14px] font-medium hover:bg-[#1669d6]"
          >
            サインインに戻る
          </Link>
          <Link
            href="/"
            className="inline-flex items-center justify-center h-9 px-4 rounded-md border border-[#dadce0] text-[#202124] text-[14px] hover:bg-[#f1f3f4]"
          >
            トップへ
          </Link>
        </div>
      </div>
    </main>
  );
}


