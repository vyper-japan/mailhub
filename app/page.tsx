import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getMessageDetail, listLatestInboxMessages } from "@/lib/gmail";
import { LABEL_GROUPS, getLabelById, getDefaultLabel, getLabelQuery } from "@/lib/labels";
import { getChannelById, type ChannelId } from "@/lib/channels";
import { isTestMode } from "@/lib/test-mode";
import InboxShell from "@/app/inbox/InboxShell";
import { CheckCircle } from "lucide-react";

type SearchParams = Record<string, string | string[] | undefined>;

function getFirstString(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0];
  return undefined;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const testMode = isTestMode();

  // ユーザー情報を取得
  let userEmail: string | null = null;
  let userName: string | null = null;
  if (testMode) {
    userEmail = "test-user@vtj.co.jp";
    userName = "Test User";
  } else {
    const session = await auth();
    if (!session?.user?.email) {
      redirect("/auth/signin");
    }
    userEmail = session.user.email;
    userName = session.user.name ?? userEmail.split("@")[0];
  }

  async function logoutAction() {
    "use server";
    await signOut({ redirectTo: "/auth/signin" });
  }

  const sp = searchParams ? await searchParams : undefined;

  // label パラメータを優先、なければ channel（後方互換）、なければデフォルト
  const labelId = getFirstString(sp?.label) ?? getFirstString(sp?.channel);
  const label = getLabelById(labelId) ?? getDefaultLabel();
  const labelQuery = getLabelQuery(label);

  // channelIdを取得（返信ルーター用）
  // labelパラメータから推測（label=store-a → channelId=store-a）
  const channelIdParam = getFirstString(sp?.channel) ?? labelId;
  const channelId: ChannelId = channelIdParam === "store-a" || channelIdParam === "store-b" || channelIdParam === "store-c" 
    ? channelIdParam 
    : "all";

  let listError: string | null = null;
  const messages = await (async () => {
    try {
      return await listLatestInboxMessages({
        max: 20,
        q: labelQuery,
        statusType: label.statusType,
      });
    } catch (e) {
      listError = e instanceof Error ? e.message : String(e);
      return [];
    }
  })();

  const requestedId = getFirstString(sp?.id);
  const selectedId =
    requestedId && messages.some((m) => m.id === requestedId)
      ? requestedId
      : messages[0]?.id;

  let detailError: string | null = null;
  const detail = await (async () => {
    if (!selectedId) return null;
    try {
      return await getMessageDetail(selectedId);
    } catch (e) {
      detailError = e instanceof Error ? e.message : String(e);
      return null;
    }
  })();

  const selectedMessage = selectedId
    ? messages.find((m) => m.id === selectedId) ?? null
    : null;

  return (
    <main className="h-screen flex overflow-hidden bg-[#0f172a]">
      {/* InboxShellにサイドバーとユーザー情報を丸ごと任せる（インタラクティブな要素が多いため） */}
      <InboxShell
        initialLabelId={label.id}
        initialChannelId={channelId}
        labelGroups={LABEL_GROUPS}
        initialMessages={messages}
        initialSelectedId={selectedId ?? null}
        initialSelectedMessage={selectedMessage}
        initialDetail={detailError ? null : detail}
        user={{
          email: userEmail ?? "",
          name: userName ?? "",
        }}
        logoutAction={logoutAction}
        testMode={testMode}
        listError={listError}
      />
    </main>
  );
}
