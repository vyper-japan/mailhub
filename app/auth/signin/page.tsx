import { signIn } from "@/auth";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  async function signInAction() {
    "use server";
    await signIn("google", { redirectTo: "/" });
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4">
      <div className="w-full max-w-md bg-white border border-[#dadce0] rounded-lg p-6 shadow-sm">
        <h1 className="text-[18px] font-semibold text-[#202124]">MailHub にサインイン</h1>
        <p className="mt-2 text-[13px] text-[#5f6368]">
          共有受信箱を表示するために Google でログインしてください（社内ドメインのみ）。
        </p>

        <form action={signInAction} className="mt-5">
          <button
            type="submit"
            className="w-full h-10 rounded-md bg-[#1a73e8] text-white text-[14px] font-medium hover:bg-[#1669d6] active:bg-[#135cbc]"
            data-testid="signin-google"
          >
            Google でサインイン
          </button>
        </form>
      </div>
    </main>
  );
}


