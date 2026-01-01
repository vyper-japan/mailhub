export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main>
      <h1 style={{ margin: "0 0 8px 0" }}>ログインできませんでした</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        vtj.co.jp アカウント以外は利用できません。
      </p>
      <div style={{ fontSize: 12, color: "#777" }}>error: {error ?? "-"}</div>
      <div style={{ marginTop: 16 }}>
        <a href="/auth/signin">サインインへ戻る</a>
      </div>
    </main>
  );
}


