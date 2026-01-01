import SignInButton from "./sign-in-button";

export default function SignInPage() {
  return (
    <main>
      <h1 style={{ margin: "0 0 8px 0" }}>ログイン</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        vtj.co.jp アカウントのみ利用できます。
      </p>
      <SignInButton />
    </main>
  );
}


