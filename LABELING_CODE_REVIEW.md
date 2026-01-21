# ラベリング関連コード一覧

## 1. ラベル定義 (`lib/labels.ts`)

```typescript
export type LabelType = "channel" | "status" | "marketplace" | "assignee";
export type StatusType = "todo" | "waiting" | "done" | "muted";

export type LabelItem = {
  id: string;
  label: string;
  type: LabelType;
  q?: string;
  statusType?: StatusType;
  icon?: string;
};

export const LABEL_GROUPS: LabelGroup[] = [
  {
    id: "channels",
    label: "Channels",
    items: [
      { id: "all", label: "All", type: "channel" },
      { id: "store-a", label: "StoreA", type: "channel", q: "..." },
      { id: "store-b", label: "StoreB", type: "channel", q: "..." },
      { id: "store-c", label: "StoreC", type: "channel", q: "..." },
    ],
  },
  {
    id: "status",
    label: "Status",
    items: [
      { id: "todo", label: "Todo（未対応）", type: "status", statusType: "todo" },
      { id: "waiting", label: "Waiting（保留）", type: "status", statusType: "waiting" },
      { id: "done", label: "Done（完了）", type: "status", statusType: "done" },
      { id: "muted", label: "Muted（低優先）", type: "status", statusType: "muted" },
    ],
  },
  {
    id: "assignee",
    label: "Assignee",
    items: [
      { id: "mine", label: "Mine（自分担当）", type: "assignee" },
      { id: "unassigned", label: "Unassigned（未割当）", type: "assignee" },
    ],
  },
];
```

## 2. Gmailラベル定数 (`lib/gmail.ts`)

```typescript
export const MAILHUB_LABEL_WAITING = "MailHub/Waiting";
export const MAILHUB_LABEL_DONE = "MailHub/Done";
export const MAILHUB_LABEL_IN_PROGRESS = "MailHub/InProgress";
export const MAILHUB_LABEL_MUTED = "MailHub/Muted";
export const MAILHUB_LABEL_ASSIGNEE_PREFIX = "MailHub/Assignee/";
```

## 3. 担当者slug変換 (`lib/assignee.ts`)

```typescript
export function assigneeSlug(email: string): string {
  return email
    .toLowerCase()
    .replace(/@/g, "_at_")
    .replace(/\./g, "_")
    .replace(/[^a-z0-9_]/g, "");
}
// 例: "tanaka@vtj.co.jp" -> "tanaka_at_vtj_co_jp"
```

## 4. メッセージリスト取得 (`lib/gmail.ts` - `listLatestInboxMessages`)

```typescript
export type ListMessagesOptions = {
  max?: number;
  q?: string;
  labelIds?: string[];
  statusType?: "todo" | "waiting" | "done" | "muted";
  assigneeSlug?: string; // 担当者でフィルタリング
};

export async function listLatestInboxMessages(
  options: ListMessagesOptions = {},
): Promise<InboxListMessage[]> {
  const { max = 20, q, statusType, assigneeSlug: assigneeSlugParam } = options;
  let { labelIds } = options;

  // assigneeSlugが指定されている場合、担当ラベルIDを取得
  let assigneeLabelId: string | null = null;
  if (assigneeSlugParam) {
    const labelName = `${MAILHUB_LABEL_ASSIGNEE_PREFIX}${assigneeSlugParam}`;
    assigneeLabelId = await ensureLabelId(labelName);
  }

  // assigneeSlugが指定されている場合、担当ラベルのみでフィルタリング
  if (assigneeLabelId) {
    labelIds = [assigneeLabelId];
  } else {
    // statusType が指定されていれば labelIds を自動設定
    if (statusType === "waiting") {
      const waitingId = await ensureLabelId(MAILHUB_LABEL_WAITING);
      labelIds = waitingId ? [waitingId] : [];
    } else if (statusType === "done") {
      const doneId = await ensureLabelId(MAILHUB_LABEL_DONE);
      labelIds = doneId ? [doneId] : [];
    } else if (statusType === "muted") {
      const mutedId = await ensureLabelId(MAILHUB_LABEL_MUTED);
      labelIds = mutedId ? [mutedId] : [];
    } else if (!labelIds) {
      labelIds = ["INBOX"]; // デフォルト: Todo
    }
  }

  // Gmail APIでメッセージを取得
  const listRes = await gmail.users.messages.list({
    userId: sharedInboxEmail,
    labelIds,
    maxResults: max,
    includeSpamTrash: false,
    q,
  });

  // 各メッセージの詳細を取得し、担当者情報を抽出
  const items = await mapWithConcurrency(messages, 5, async (m) => {
    const msgRes = await gmail.users.messages.get({
      userId: sharedInboxEmail,
      id: m.id,
      format: "metadata",
      metadataHeaders: ["Subject", "From", "Date", "Message-ID"],
    });

    const labelIds = msgRes.data.labelIds || [];
    const assignee = getAssigneeFromLabelIds(labelIds, labelsMap.idToName);

    return {
      id: m.id,
      // ...
      assigneeSlug: assignee?.slug || null,
    };
  });

  return items;
}
```

## 5. 担当者ラベル取得関数 (`lib/gmail.ts`)

```typescript
function getAssigneeFromLabelIds(
  labelIds: string[],
  idToName: Map<string, string>,
): { slug: string; labelName: string } | null {
  for (const labelId of labelIds) {
    const labelName = idToName.get(labelId);
    if (labelName?.startsWith(MAILHUB_LABEL_ASSIGNEE_PREFIX)) {
      const slug = labelName.slice(MAILHUB_LABEL_ASSIGNEE_PREFIX.length);
      return { slug, labelName };
    }
  }
  return null;
}

async function ensureAssigneeLabelId(email: string): Promise<string | null> {
  const slug = assigneeSlug(email);
  const labelName = `${MAILHUB_LABEL_ASSIGNEE_PREFIX}${slug}`;
  return await ensureLabelId(labelName);
}

async function removeAllAssigneeLabels(
  labelIds: string[],
  idToName: Map<string, string>,
): Promise<string[]> {
  const assigneeLabelIds: string[] = [];
  for (const labelId of labelIds) {
    const labelName = idToName.get(labelId);
    if (labelName?.startsWith(MAILHUB_LABEL_ASSIGNEE_PREFIX)) {
      assigneeLabelIds.push(labelId);
    }
  }
  return assigneeLabelIds;
}
```

## 6. 担当メッセージ設定 (`lib/gmail.ts` - `assignMessage`)

```typescript
export async function assignMessage(
  id: string,
  assigneeEmail: string,
  opts?: { force?: boolean },
): Promise<{ currentAssigneeSlug: string | null }> {
  // テストモード
  if (isTestMode()) {
    const testAssigneeMap = getTestAssigneeMap();
    const currentSlug = testAssigneeMap.get(id) || null;
    if (currentSlug && !opts?.force) {
      return { currentAssigneeSlug: currentSlug };
    }
    testAssigneeMap.set(id, assigneeSlug(assigneeEmail));
    return { currentAssigneeSlug: currentSlug };
  }

  // 本番モード
  const { gmail, sharedInboxEmail } = createGmailClient();
  const labelsMap = await listLabelsMap();

  // 現在のラベルを取得
  const msgRes = await gmail.users.messages.get({
    userId: sharedInboxEmail,
    id,
    format: "metadata",
    metadataHeaders: [],
  });
  const currentLabelIds = msgRes.data.labelIds || [];
  
  // 現在の担当者を確認
  const currentAssignee = getAssigneeFromLabelIds(currentLabelIds, labelsMap.idToName);
  if (currentAssignee && !opts?.force) {
    return { currentAssigneeSlug: currentAssignee.slug };
  }

  // 既存の担当者ラベルを全て削除
  const removeLabelIds = await removeAllAssigneeLabels(currentLabelIds, labelsMap.idToName);
  
  // 新しい担当者ラベルを追加
  const assigneeLabelId = await ensureAssigneeLabelId(assigneeEmail);
  if (!assigneeLabelId) {
    throw new Error("Could not ensure Assignee label");
  }

  await gmail.users.messages.modify({
    userId: sharedInboxEmail,
    id,
    requestBody: {
      removeLabelIds: removeLabelIds.length > 0 ? removeLabelIds : undefined,
      addLabelIds: [assigneeLabelId],
    },
  });

  getCache().list.clear();
  getCache().detail.delete(`detail:${sharedInboxEmail}:id=${id}`);

  return { currentAssigneeSlug: currentAssignee?.slug || null };
}
```

## 7. 保留設定 (`lib/gmail.ts` - `setWaiting`)

```typescript
export async function setWaiting(id: string): Promise<void> {
  if (isTestMode()) {
    setTestStatus(id, "waiting");
    return;
  }

  const { gmail, sharedInboxEmail } = createGmailClient();
  const waitingId = await ensureLabelId(MAILHUB_LABEL_WAITING);
  const doneId = await ensureLabelId(MAILHUB_LABEL_DONE);

  const removeLabels = ["INBOX"];
  if (doneId) removeLabels.push(doneId);

  // 担当者ラベルは削除しない（担当かつ保留の状態を維持）
  await gmail.users.messages.modify({
    userId: sharedInboxEmail,
    id,
    requestBody: {
      addLabelIds: waitingId ? [waitingId] : undefined,
      removeLabelIds: removeLabels,
    },
  });

  getCache().list.clear();
  getCache().detail.delete(`detail:${sharedInboxEmail}:id=${id}`);
}
```

## 8. APIエンドポイント: リスト取得 (`app/api/mailhub/list/route.ts`)

```typescript
export async function GET(req: Request) {
  const authResult = await requireUser();
  if (!authResult.ok) {
    return authErrorResponse(authResult);
  }

  const url = new URL(req.url);
  const labelId = url.searchParams.get("label") ?? "all";
  const label = getLabelById(labelId) ?? getDefaultLabel();
  const query = getLabelQuery(label);

  const max = Number(url.searchParams.get("max") ?? "20");
  const safeMax = Number.isFinite(max) ? Math.min(Math.max(max, 1), 50) : 20;
  
  // assigneeSlug パラメータ（担当タブ用）
  const assigneeSlugParam = url.searchParams.get("assigneeSlug");

  const messages = await listLatestInboxMessages({
    max: safeMax,
    q: query,
    statusType: label.statusType,
    assigneeSlug: assigneeSlugParam || undefined,
  });
  
  return NextResponse.json(
    { label: label.id, messages },
    { headers: { "cache-control": "no-store" } },
  );
}
```

## 9. APIエンドポイント: 担当設定 (`app/api/mailhub/assign/route.ts`)

```typescript
export async function POST(req: NextRequest) {
  const authResult = await requireUser();
  if (!authResult.ok) {
    return authErrorResponse(authResult);
  }

  const body = await req.json();
  const id = body?.id;
  const action = body?.action; // "assign" | "unassign"
  const force = body?.force === true;

  if (action === "assign") {
    const result = await assignMessage(id, authResult.user.email, { force });
    if (result.currentAssigneeSlug && !force) {
      return NextResponse.json(
        { error: "already_assigned", currentAssigneeSlug: result.currentAssigneeSlug },
        { status: 409 },
      );
    }
    return NextResponse.json({ success: true, id, action });
  } else {
    await unassignMessage(id);
    return NextResponse.json({ success: true, id, action });
  }
}
```

## 10. フロントエンド: フィルタリング (`app/inbox/InboxShell.tsx`)

```typescript
const filteredMessages = useMemo(() => {
  let filtered = messages;
  
  // タブフィルタ（受信箱/担当/保留/低優先）
  if (viewTab === "inbox") {
    if (activeLabel?.type !== "channel" && activeLabel?.statusType !== "todo") {
      filtered = [];
    }
  } else if (viewTab === "assigned") {
    // 担当タブ: 自分が担当になっているものだけ表示
    filtered = filtered.filter((m) => m.assigneeSlug === myAssigneeSlug);
  } else if (viewTab === "waiting") {
    if (activeLabel?.statusType !== "waiting") {
      filtered = [];
    }
  } else if (viewTab === "muted") {
    if (activeLabel?.statusType !== "muted") {
      filtered = [];
    }
  }
  
  // 検索フィルタ
  if (searchTerm) {
    // ...
  }
  
  return filtered;
}, [messages, searchTerm, activeLabel, myAssigneeSlug, viewTab]);
```

## 11. フロントエンド: 担当タブクリック (`app/inbox/InboxShell.tsx`)

```typescript
// 担当タブボタン
<button
  onClick={() => {
    setViewTab("assigned");
    const todoLabel = labelGroups.flatMap((g) => g.items).find((item) => item.statusType === "todo");
    if (todoLabel) {
      startTransition(async () => {
        try {
          // 担当ラベルでフィルタリング（担当タブ専用）
          const url = `/api/mailhub/list?label=${encodeURIComponent(todoLabel.id)}&max=100&assigneeSlug=${encodeURIComponent(myAssigneeSlug)}`;
          const data = await fetchJson<{ label: string; messages: InboxListMessage[] }>(url);
          setMessages(data.messages);
          // ...
        } catch (e) {
          setListError(e instanceof Error ? e.message : String(e));
        }
      });
    }
  }}
>
  担当
</button>
```

## 12. フロントエンド: 保留設定 (`app/inbox/InboxShell.tsx` - `handleSetWaiting`)

```typescript
const handleSetWaiting = useCallback(async (id: string) => {
  const targetMessage = messages.find((m) => m.id === id);
  if (!targetMessage) return;

  const isCurrentlyWaiting = activeLabel?.statusType === "waiting";
  const action = isCurrentlyWaiting ? "unsetWaiting" : "setWaiting";
  
  // UI更新（楽観的）
  bumpCounts(delta);
  setMessages(newMessages);
  
  // APIリクエスト（非同期）
  void (async () => {
    try {
      await postJsonOrThrow("/api/mailhub/status", { id, action });
      
      // 保留タブに移動した際に、担当情報が正しく表示されるように再読み込み
      if (!isCurrentlyWaiting && viewTab === "waiting") {
        const waitingLabel = labelGroups.flatMap((g) => g.items).find((item) => item.statusType === "waiting");
        if (waitingLabel) {
          await loadList(waitingLabel.id, null);
        }
      }
      
      showToast("保留にしました", "success");
      void fetchCounts();
    } catch (e) {
      // エラー時ロールバック
      // ...
    }
  })();
}, [messages, labelId, activeLabel?.statusType, viewTab, labelGroups, ...]);
```

## 13. フロントエンド: 担当設定 (`app/inbox/InboxShell.tsx` - `handleAssign`)

```typescript
const handleAssign = useCallback(async (id: string, force: boolean = false) => {
  const targetMessage = messages.find((m) => m.id === id);
  if (!targetMessage) return;

  try {
    const res = await fetch("/api/mailhub/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "assign", force }),
    });

    if (!res.ok) {
      if (res.status === 409) {
        // 既に他人が担当している場合は強制引き継ぎ
        const forceRes = await fetch("/api/mailhub/assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, action: "assign", force: true }),
        });
        // ...
      }
      throw new Error(...);
    }

    // 成功時はメッセージを更新（assigneeSlugを反映）
    const updatedMessages = messages.map((m) =>
      m.id === id ? { ...m, assigneeSlug: myAssigneeSlug } : m
    );
    setMessages(updatedMessages);
    
    if (selectedMessage?.id === id) {
      setSelectedMessage({ ...selectedMessage, assigneeSlug: myAssigneeSlug });
    }

    showToast(force ? "引き継ぎました" : "自分が担当しました", "success");
    fetchCounts();
  } catch (e) {
    // エラー処理
  }
}, [messages, myAssigneeSlug, selectedMessage, ...]);
```

## 問題点の可能性

1. **担当タブでのフィルタリング**: `assigneeSlug`パラメータで担当ラベルのみでフィルタリングしているが、保留ラベルが付与されたメールも含まれるか確認が必要
2. **保留設定後の再読み込み**: `handleSetWaiting`で保留タブにいる場合のみ再読み込みしているが、担当タブにいる場合の処理がない
3. **担当設定後のリスト更新**: `handleAssign`でローカル状態を更新しているが、担当タブにいる場合の再読み込みがない
4. **テストモードでの担当情報**: テストモードで`assigneeSlug`パラメータでフィルタリングしているが、正しく動作しているか確認が必要




