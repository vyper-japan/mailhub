import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getMessageDetail, listLatestInboxMessages } from "@/lib/gmail";
import { LABEL_GROUPS, getLabelById, getDefaultLabel, getLabelQuery } from "@/lib/labels";
import type { ChannelId } from "@/lib/channels";
import { isTestMode } from "@/lib/test-mode";
import { getMailhubEnv } from "@/lib/mailhub-env";
import { getViewsStore } from "@/lib/viewsStore";
import { assigneeSlug } from "@/lib/assignee";
import InboxShell from "@/app/inbox/InboxShell";

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
  const mailhubEnv = getMailhubEnv();

  // ユーザー情報を取得
  let userEmail: string | null = null;
  let userName: string | null = null;
  if (testMode) {
    userEmail = "test@vtj.co.jp";
    userName = "Test";
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

  const viewId = getFirstString(sp?.view);
  const view = viewId ? await getViewsStore().get(viewId).catch(() => null) : null;

  // label パラメータを優先、なければ channel（後方互換）、なければデフォルト
  const labelId = view?.labelId ?? getFirstString(sp?.label) ?? getFirstString(sp?.channel);
  const label = getLabelById(labelId) ?? getDefaultLabel();
  const baseLabelQuery = getLabelQuery(label);
  
  // Step 51: 検索クエリをURLから読み込む（ViewのqとURLのqの両方を考慮）
  const userSearchQuery = getFirstString(sp?.q) ?? "";
  const viewQ = view?.q;
  const labelQuery = viewQ ? [baseLabelQuery, viewQ].filter(Boolean).join(" ") : baseLabelQuery;

  // channelIdを取得（返信ルーター用）
  // labelパラメータから推測（label=store-a → channelId=store-a）
  const channelIdParam = getFirstString(sp?.channel) ?? labelId;
  const channelId: ChannelId = channelIdParam === "store-a" || channelIdParam === "store-b" || channelIdParam === "store-c" 
    ? channelIdParam 
    : "all";

  // Step 104: maxパラメータをURLから取得
  const maxParam = getFirstString(sp?.max);
  const listMax = (() => {
    if (!maxParam) return 20;
    const n = parseInt(maxParam, 10);
    if (isNaN(n)) return 20;
    return Math.max(1, Math.min(50, n));
  })();

  let listError: string | null = null;
  const messages = await (async () => {
    try {
      // statusTypeがundefinedの場合はフィルタリングしない（全メールを表示）
      // デフォルトラベル（all）やchannelタイプの場合はstatusTypeをundefinedにする
      // ただし、statusタイプのラベルの場合のみstatusTypeを渡す
      const statusType =
        view?.statusType ?? (label.type === "status" ? label.statusType : undefined);

      const viewAssigneeSlug =
        view?.assignee === "mine" ? assigneeSlug(userEmail) : undefined;
      const viewUnassigned = view?.assignee === "unassigned" ? true : undefined;

      // Step 51: ユーザー検索クエリを合成（baseQuery AND userQuery）
      let finalQuery = labelQuery;
      if (userSearchQuery && userSearchQuery.trim()) {
        const cleanedQ = userSearchQuery.trim().replace(/\n/g, " ").slice(0, 500);
        if (cleanedQ.length > 0) {
          const parts = [labelQuery, cleanedQ].filter(Boolean);
          finalQuery = parts.map((x) => `(${x})`).join(" ");
        }
      }
      
      const result = await listLatestInboxMessages({
        max: listMax, // Step 104: URL指定のmaxを使用
        q: finalQuery,
        statusType,
        assigneeSlug: viewAssigneeSlug,
        unassigned: viewUnassigned,
      });
      // statusTypeでフィルタリングした結果が空の場合、デフォルト（all）で再試行
      // これにより、初期状態でmutedラベルを選択してもメールが表示される
      if (result.messages.length === 0 && statusType && label.id !== "all") {
        const defaultLabel = getDefaultLabel();
        const defaultResult = await listLatestInboxMessages({
          max: 20,
          q: getLabelQuery(defaultLabel),
          statusType: undefined, // 全メールを表示
        });
        // デフォルトでも空の場合は空配列を返す
        return defaultResult.messages.length > 0 ? defaultResult.messages : result.messages;
      }
      return result.messages;
    } catch (e) {
      listError = e instanceof Error ? e.message : String(e);
      console.error(`[page.tsx] Error loading messages:`, e);
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
    <main className="h-screen flex overflow-hidden bg-white">
      {/* InboxShellにサイドバーとユーザー情報を丸ごと任せる（インタラクティブな要素が多いため） */}
      <InboxShell
        initialLabelId={label.id}
        initialChannelId={channelId}
        labelGroups={LABEL_GROUPS}
        initialMessages={messages}
        initialSelectedId={selectedId ?? null}
        initialSelectedMessage={selectedMessage}
        initialDetail={detailError ? null : detail}
        initialSearchQuery={userSearchQuery}
        user={{
          email: userEmail ?? "",
          name: userName ?? "",
        }}
        logoutAction={logoutAction}
        testMode={testMode}
        mailhubEnv={mailhubEnv}
        debugMode={process.env.NODE_ENV !== "production"}
        listError={listError}
      />
    </main>
  );
}
