# MailHub 改善計画 — Cursor実装指示書 v2

> **背景**: ブラウザQAテスト（2026/2/6, 2/8）で全機能を網羅的にテストした結果に基づく。
> MailHubの目的は「複数店舗の大量メールを一元管理し、担当振り分け＋不要メール処理を高速に回す」こと。
>
> **重要**: v2ではコードレビューを反映。MailHubは既に「一括選択（Shift対応+進捗+リトライ）・Undo・自動ラベル・担当・低優先・Activity・READ ONLY・Admin Guard・QA strict」まで実装済み。
> したがって、タスクを **A（既存機能のUI/UX調整）** と **B（新規実装）** に明確に分離する。

---

## Phase 0: バグ修正（最優先・全9件）

ここは全て明確な不具合。最初に全部潰す。

### 0-1. タグ保存 API の Google Sheets レンジエラー [BUG]

**現象**: 状況タグを追加→保存すると `エラー: Unable to parse range: ConfigMeta!A1:B2` が返る。
**原因推定**: `lib/configStore.ts` の SheetsConfigStore で、`mode: "json_blob"` 使用時のレンジ指定がシートの実体と合っていない。
**修正箇所**:
- `lib/configStore.ts` — SheetsConfigStore の `json_blob` モードの write メソッド
- Google Sheets の実際のシート名（`ConfigMeta` が存在するか、レンジ `A1:B2` にデータが書けるか）を確認
**テスト**: メール詳細 → 状況タグ入力 → 追加 → 保存 → エラーなし → リロード後もタグ残存

---

### 0-2. Activity API 405 エラー [BUG]

**現象**: `POST /api/mailhub/activity` が 405 (Method Not Allowed) を返す。
**修正箇所**: `app/api/mailhub/activity/route.ts`
- POSTハンドラが export されていない可能性。`export async function POST(req)` の有無を確認。

---

### 0-3. Queues API 500 エラー [BUG]

**現象**: `GET /api/mailhub/queues` が常に 500 を返す。設定モーダルを開くたびに発生。
**修正箇所**: `app/api/mailhub/queues/route.ts`
- 初期データが存在しない場合に空配列 `[]` を返すように修正。

---

### 0-4. Meta API 500 エラー [BUG]

**現象**: `/api/mailhub/meta` と `/api/mailhub/meta?list=1` が 500 を返す。
**修正箇所**: `app/api/mailhub/meta/route.ts`

---

### 0-5. 検索クリア後の URL パラメータ残留 [BUG]

**現象**: 検索バーのクリアボタンを押すとメール一覧はリセットされるが、URLの `q=` パラメータが残る。
**修正箇所**: `app/inbox/InboxShell.tsx` — 検索クリア処理
- 検索クリア時に `router.replace()` 等で `q` パラメータを URL から除去する。

---

### 0-6. Undo 後の詳細パネル未更新 [BUG]

**現象**: 保留→Undoすると、メール一覧にはメールが復帰するが、詳細パネルが「メールを選択してください」のまま。同じメールをクリックしても反応しない。
**修正箇所**: `app/inbox/InboxShell.tsx` — Undo 処理後の state 更新
- Undo完了後に `selectedId` を復元メールIDに再設定 + `fetchDetail()` を呼ぶ。

---

### 0-7. Undo カウンターの蓄積 [BUG]

**現象**: Undoカウンターが `(1)→(2)→(3)…` と増え続け、リセットされない。
**修正箇所**: `app/inbox/InboxShell.tsx` — undoStack の管理
- Undo 実行したら該当エントリを `pop`。
- 一定時間（30秒）経過した古いエントリを自動削除する TTL を入れる。

---

### 0-8. テンプレート内容のメール間リーク [BUG]

**現象**: メールAのGmail返信パネルでテンプレートを挿入後、メールBに切り替えてもテンプレート内容（テキスト＋ラベル）が残る。
**修正箇所**: `app/inbox/InboxShell.tsx`
- `selectedId` が変わった時に Gmail 返信パネルのテキストとテンプレートラベルをクリアする `useEffect` を追加。

---

### 0-9. favicon 404 [BUG]

**現象**: `/favicon.ico` が 404。
**修正**: `public/` ディレクトリに favicon.ico を配置。

---

## Phase 1: 新規実装（本当に足りないもの）

### 1-1. 「削除（ゴミ箱）」アクションの追加 [新規]

> **重要度: P0** — 現状だと Done（対応済み）と不要（ゴミ）が混ざりやすい。運用が回り始めると「完了の中から探す」が地獄になる。

**設計**:

| ステータス | 意味 | Gmail操作 |
|---|---|---|
| Done | 対応済み | MailHub/Done ラベル付与 + INBOX 除去 |
| Muted | 低優先 | MailHub/Muted ラベル付与 + INBOX 除去 |
| **Trash（新規）** | **不要** | **Gmail の TRASH へ移動（30日で自動削除）** |

**実装**:

1. **APIルート追加**: `app/api/mailhub/trash/route.ts`
```
POST /api/mailhub/trash
body: { id: string }  // messageId
→ Gmail API の messages.trash(id) を呼ぶ
→ activityStore にログ記録
→ ReadOnlyモードチェック（isReadOnlyMode()）
```

2. **Undo**: `messages.untrash(id)` でゴミ箱から復元。既存の undoStack に `{ type: "trash", id, message }` を push する。

3. **UIボタン追加**: `app/inbox/InboxShell.tsx`
- 上部ツールバー（完了/保留/担当/低優先の並び）に `🗑 削除` ボタンを追加
- メール一覧の各行ホバー時にも削除アイコン表示（Gmailと同じ UX）
- キーボードショートカット: `#`（Gmailと同じ）
- **一括削除**: 既存の `executeBulkAction()` を使い、チェック選択 → 一括ゴミ箱移動。10件以上は `pendingBulkConfirm` で安全確認。

4. **Trashビューは必須ではない**（Gmail側で復元できる）が、運用が落ち着くまで「🗑 ゴミ箱」タブがサイドバーにあると心理的に安心。余裕があれば追加。

---

### 1-2. 「条件一括処理」への拡張 [新規]

> **重要度: P0** — 今の「チェックボックス→一括操作」は動くが、楽天/Amazonの大量通知は**選択する行為自体がコスト**。

**現状（✅ 既に実装済み — 触らない）**:
- チェックボックス個別 + Shift範囲選択
- 全件選択（表示中のみ）
- 3並列バッチ処理 + 進捗表示 + 部分失敗リトライ
- 10件以上で安全確認ダイアログ

**新規で追加するもの**:

1. **「この検索条件に一致する全N件を一括処理」バナー**
- 全件選択チェックボックスを ON にした時、リスト上部に表示:
```
「表示中の20件を選択しました。この検索条件に一致する全128件を選択」
```
- クリックすると、**サーバー側で該当IDを全件取得**して `checkedIds` にセット
- Gmail の "Select all conversations that match this search" と同じ

2. **安全装置**:
- 最大200件など上限を固定（`MAX_BULK_TARGET = 200`）
- 100件以上は dryRun → プレビュー（先頭20件の件名表示）→ 「実行」の二段階
- 確認ダイアログ: `「128件のメールを低優先にします。この操作は取り消せる場合があります。」`

3. **APIエンドポイント追加**: `app/api/mailhub/list/route.ts`（既存拡張）
- `GET /api/mailhub/list?q=from:order@rakuten.co.jp&idsOnly=true&max=200`
- ID一覧のみ返す軽量版（本文取得なし）

---

### 1-3. Auto Rules にステータス自動適用を追加 [新規]

> **重要度: P1** — 既存の Auto Rules（ラベル付与+担当割り当て+Preview→Apply+Admin Guard+危険ドメイン警告）の**延長線上でいける**。

**現状の型定義** (`lib/labelRules.ts`):
```typescript
export type LabelRule = {
  id: string;
  match: LabelRuleMatch;         // fromEmail / fromDomain
  labelNames?: string[];         // ラベル付与
  assignTo?: AssignToSpec;       // 担当者割り当て
  enabled: boolean;
  createdAt: string;
};
```

**追加するフィールド**:
```typescript
export type LabelRule = {
  // ... 既存フィールドそのまま
  /** ★新規: ステータス自動適用（"done" | "muted" | "waiting" | null） */
  autoStatus?: "done" | "muted" | "waiting" | null;
};
```

**修正箇所**:

1. `lib/labelRules.ts` — `LabelRule` 型に `autoStatus` 追加 + `matchRulesWithAssign` の戻り値に `autoStatus` を追加
2. `lib/autoRulesRunner.ts` — ルールマッチ時に `autoStatus` があれば、Gmail ラベル操作（`MailHub/Status/Done` 等の付与 + INBOX 除去）も実行
3. `app/inbox/components/SettingsDrawer.tsx` — Auto Rules タブに「自動ステータス」ドロップダウン追加（選択肢: なし / 完了 / 低優先 / 保留）
4. `lib/labelRulesStore.ts` — 保存/読込時の `autoStatus` フィールド対応

**推奨ルール例**（Settings UIで設定可能）:
- `from:order@rakuten.co.jp` → 自動で低優先
- `from:order-confirm@order-rp.rms.rakuten.co.jp` → 自動で完了
- `from:noreply@amazon.co.jp` (subject含む: 発送しました) → 自動で完了

---

## Phase 2: 既存機能の UI/UX 調整（作り直し不要・見え方の改善）

> **このフェーズの全項目は、機能としては既に存在するが「見え方/導線が弱い」もの。**
> **既存コードを壊さず、UI層のみの変更で済むものが中心。**

### 2-1. 一括選択時の「一括モードUI」強化 [UX調整]

**現状（✅ 既に動いている）**:
- `checkedIds.size > 0` で `「N件選択中」` 表示
- 完了/保留/担当/低優先ボタンは既にバルク対応
- 10件以上の安全確認ダイアログ

**足りないのは「視覚的な切替感」**:

`app/inbox/InboxShell.tsx` のツールバー部分:
- `checkedIds.size > 0` の時、ツールバー背景を `bg-[#E8F0FE]`（青系）に変更して「一括モードに入った」ことを明示
- `「N件選択中」` をもっと目立つ位置（ツールバー左端、太字）に
- `[選択解除]` ボタンを追加（× アイコン）
- Phase 1-1 の `[🗑 削除]` ボタンも一括モードで表示

---

### 2-2. チャンネル（店舗フィルタ）の本番有効化 [UX調整]

**現状（✅ コード実装済み・テストモード限定で隠されている）**:
- `lib/channels.ts`: StoreA/B/C の定義あり
- `app/inbox/components/Sidebar.tsx`: `{testMode && ...}` でチャンネルセクションをレンダリング
- `InboxShell.tsx`: `channelId` state + `channelCounts` + API連携済み

**やること（3ステップ）**:

1. **`Sidebar.tsx` の `testMode &&` ガードを外す**
   - 行126付近の `{testMode &&` を削除し、チャンネルセクションを常時表示に

2. **`lib/channels.ts` を実際の店舗/ブランドに更新**:
```typescript
export const CHANNELS: Channel[] = [
  { id: "all", label: "すべて" },
  { id: "hills", label: "Hills",
    q: "(from:myhillsshop_webmail@hillspet.com)" },
  { id: "rakuten", label: "楽天",
    q: "(from:@rakuten.co.jp OR from:@order-rp.rms.rakuten.co.jp)" },
  { id: "amazon", label: "Amazon",
    q: "(from:@amazon.co.jp OR from:@sellercentral.amazon.co.jp)" },
];
```

3. **将来的な発展方向** — 今は「チャンネル」だが、本当に欲しいのは「Amazon/楽天（親）→ ストア（子）→ ブランド（タグ）」のような**ツリー構造**。
   これはチャンネルではなく**ラベル体系の拡張**として設計し直すのが正解。
   Phase 2 ではまず上記3ステップで「店舗切替ができる」状態にし、ツリー設計は別途検討。

---

### 2-3. 「返信完了」ボタンのアクセス改善 [UX調整]

> **体感スピードが上がる施策**。長文メールだとスクロールで失速する。

**修正箇所**: `app/inbox/InboxShell.tsx` または `app/inbox/components/InternalOpsPane.tsx`

**2つのアプローチ（どちらか選んで実装）**:

**A案: 上部固定バーに追加**
- 詳細パネル上部のツールバー（上へ/下へ/返信/転送…）に `✅ 返信完了` `⏸ 返信完了（保留）` ボタンを追加
- 常時表示（返信テキストが空でも押せる = メモなし返信完了）

**B案: フローティングバー（推奨）**
- 返信エリア（返信下書き or Gmail返信パネル）に**テキスト入力がある場合のみ**、画面下部にフローティングバーを表示:
  ```
  [✅ 返信完了] [⏸ 返信完了（保留）]
  ```
- `position: sticky; bottom: 0` で詳細カラム内に固定
- 入力がない場合は非表示（ノイズにならない）

---

### 2-4. 空ビューのメッセージ改善 [UX調整]

**現状**: すべてのビューで空の場合「メールが読み込まれていません」と表示される。
**修正箇所**: `app/inbox/InboxShell.tsx` — 空リスト表示部分

```typescript
function getEmptyMessage(labelId: string, searchQuery: string): string {
  if (searchQuery) return `「${searchQuery}」に一致するメールはありません`;
  switch (labelId) {
    case "waiting": return "保留中のメールはありません";
    case "muted": return "低優先メールはありません";
    case "done": return "完了したメールはありません 🎉";
    case "snoozed": return "スヌーズ中のメールはありません";
    case "mine": return "自分担当のメールはありません";
    case "unassigned": return "未割当のメールはありません";
    default: return "受信箱は空です 🎉";
  }
}
```

---

### 2-5. 差出人表示名マッピング [UX調整]

**現状**: `myhillsshop_webm...` のように途中で切れて全部同じに見える。

**修正箇所**: `app/inbox/InboxShell.tsx` — メール一覧の差出人レンダリング

**実装方針**:
- Settings に「差出人表示名」設定タブを追加（`app/inbox/components/SettingsDrawer.tsx`）
- configStore に保存:
```json
{
  "myhillsshop_webmail@hillspet.com": "Hills",
  "order@rakuten.co.jp": "楽天注文",
  "order-confirm@order-rp.rms.rakuten.co.jp": "楽天確定",
  "coupon@greenwich.co.jp": "らくらくーぽん"
}
```
- メール一覧でマッピングにヒットしたら短縮表示名を使用
- ヒットしない場合はメールアドレスの `@` 前の部分を表示

---

### 2-6. ツールバーの整理 [UX調整]

**現状**: 上部ツールバーに12個のアイコンが横並び。

**修正箇所**: `app/inbox/components/TopHeader.tsx`

**常時表示（日常使い）**:
- ⚙設定 / 🔄更新 / 🔗Gmailで開く

**「…」もっとメニューに格納**:
- Queues / N / Macro / Ops Board / Handoff / Activity / Help / Diagnostics

```tsx
<button onClick={() => setShowMoreMenu(!showMoreMenu)} className={t.toolbarButton}>
  <MoreHorizontal size={18} />
</button>
{showMoreMenu && (
  <div className="absolute right-0 top-12 bg-white border rounded-lg shadow-xl z-50 py-1 w-48">
    {[
      { label: "Queues", onClick: openQueues },
      { label: "Macro", onClick: openMacro },
      { label: "Ops Board", onClick: openOpsBoard },
      { label: "Handoff", onClick: openHandoff },
      { label: "Activity", onClick: openActivity },
      { label: "Help", onClick: openHelp },
      { label: "Diagnostics", onClick: openDiagnostics },
    ].map(item => (
      <button key={item.label} onClick={item.onClick}
        className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100">
        {item.label}
      </button>
    ))}
  </div>
)}
```

---

### 2-7. 未読/未確認バッジの統合 [UX調整]

**現状**: メール一覧に「未読」「未確認」の2つのバッジが並ぶ。違いが分かりにくい。
**修正箇所**: `app/inbox/InboxShell.tsx` — メール一覧のバッジ部分
- MailHubでメール詳細を開いたら自動的に「確認済み」にする
- 「未読」バッジ1つに統合（Gmail の既読/未読と同期）
- 「未確認」バッジは廃止

---

## Phase 3: 状況タグの整理

### 3-1. 状況タグをプリセット選択式にする [整理]

> 今の段階では分類軸が増えすぎると逆に遅くなる。

**現状の問題**:
- ステータス + ラベル + 担当者 + 状況タグ = 分類軸4つで多すぎる
- フリーテキスト入力なので表記ゆれが起きる（refund / Refund / 返金 etc.）
- Bug 0-1 でそもそも保存が壊れている

**方針（2択のどちらか）**:

**A案: プリセット選択式に変更（推奨）**
- フリーテキスト入力をやめ、定義済みタグリストからの選択式にする
- タグ一覧は Settings で管理（configStore 保存）
- デフォルトプリセット: `refund / stock / shipping / claim / inquiry / cancel`
- UIはチップ（タグクラウド）形式でワンクリック付与

**B案: 廃止してラベル機能に統合**
- refund / stock / shipping / claim を `MailHub/Label/` 配下のラベルとして作成
- 既存のラベル付与UIで管理

**どちらを選ぶかはオーナー判断**。まず Bug 0-1 を直した上で検討。

---

## Phase 4: 削ってよい機能

### 4-1. SLA機能の一時非表示

**現状**: SLAルールが0件で「SLA超過はありません」と出るだけ。ツールバーを占有。
**修正**: `app/inbox/InboxShell.tsx` でSLAルールが0件の場合、SLAボタンを非表示にする。

---

### 4-2. Help と Diagnostics の統合

**現状**: ツールバーに Help と Diagnostics ボタンが別々。Help の中にも Diagnostics タブがある。
**修正**: Diagnostics ボタンを削除。Help モーダル内の Diagnostics タブに統合。

---

### 4-3. 右パネルのテキストエリア統合（3→2）

**現状**: 「社内メモ（共有）」「返信下書き（個人）」「Gmail返信パネル」の3つのテキストエリア。

**修正箇所**: `app/inbox/components/InternalOpsPane.tsx`

**統合方針**:
- 「返信下書き（個人）」と「Gmail返信パネル」を1つの「返信エリア」に統合
- テキストエリア: localStorage 保存（現在の返信下書きと同じ）
- ボタン群: `[テンプレ] [コピー] [Gmailで返信] [返信完了] [返信完了（保留）]`
- 「Gmailで返信」押下時: テキストをクリップボードにコピー → Gmail を新タブで開く
- 結果: 「社内メモ（共有）」+「返信エリア（個人）」の2セクション

---

## Phase 5: コード品質（InboxShell.tsx の分割）

### 5-1. InboxShell.tsx が 8,419行

`.cursorrules.txt` に「1ファイル300行超えたら分割」とあるが、InboxShell は 8,419行。

**分割提案**:

```
app/inbox/
├── InboxShell.tsx              ← メインshell（状態管理+組み立てのみ、500行以下目標）
├── hooks/
│   ├── useMailList.ts          ← メール一覧の取得・ページング・フィルタ
│   ├── useMailDetail.ts        ← メール詳細の取得・表示
│   ├── useMailActions.ts       ← ステータス変更・Undo・削除
│   ├── useSearch.ts            ← 検索・URL同期
│   ├── useKeyboardShortcuts.ts ← ショートカット定義
│   └── useBulkSelect.ts       ← チェックボックス・一括操作・executeBulkAction
├── components/
│   ├── MailList.tsx            ← メール一覧カラム
│   ├── MailListItem.tsx        ← メール一覧の各行（チェック/スター/バッジ含む）
│   ├── MailDetail.tsx          ← メール詳細カラム
│   ├── MailDetailHeader.tsx    ← 詳細ヘッダー（件名・差出人・タブ）
│   ├── MailBody.tsx            ← 本文表示（折りたたみ含む）
│   ├── ActionToolbar.tsx       ← 上部アクションツールバー
│   ├── BulkActionBar.tsx       ← 一括アクションバー（チェック時の背景色変更含む）
│   ├── TagSection.tsx          ← 状況タグセクション
│   ├── ThreadView.tsx          ← 会話ビュー
│   └── GmailReplyPanel.tsx     ← Gmail返信パネル（統合後の返信エリア）
│   （既存の Sidebar, TopHeader, SettingsDrawer, InternalOpsPane 等はそのまま）
```

> **注意**: 段階的に行う。1ファイルずつ切り出してテスト。一度に全部やらない。

---

## 実装順序

```
Week 1: Phase 0 全9件（バグ修正）
         → 完了後に QA 再テストで全件クリア確認

Week 2: Phase 1-1（🗑 削除ボタン — 新規実装）
         + Phase 2-1（一括モードUI強化 — UX調整）
         → 「不要メールをどんどん捌ける」状態になる

Week 3: Phase 1-2（条件一括処理「全N件選択」 — 新規実装）
         + Phase 2-2（チャンネル本番有効化 — testModeガード外す）
         → 「楽天128件を一発で低優先」ができる状態

Week 4: Phase 1-3（Auto Rules ステータス自動適用 — 新規実装）
         + Phase 2-3（返信完了フローティング — UX調整）
         → 手動仕分け激減 + 返信速度UP

Week 5: Phase 2 残り（空メッセージ/差出人名/ツールバー/バッジ）
         + Phase 3（タグ整理）+ Phase 4（不要機能削除）

Week 6〜: Phase 5（InboxShell 分割 — 継続的に）
```

---

## テスト確認項目（実装後の再QA用）

### Phase 0 完了後
- [ ] タグ保存→リロード後も残る
- [ ] `POST /api/mailhub/activity` が200を返す
- [ ] `GET /api/mailhub/queues` が200を返す
- [ ] `GET /api/mailhub/meta` が200を返す
- [ ] 検索クリア後にURLが `?label=todo&view=inbox` のみ
- [ ] Undo後に詳細パネルが復帰メールを表示
- [ ] Undoカウンターが実行後に減る
- [ ] メール切替時にGmail返信パネルがクリアされる
- [ ] favicon が表示される

### Phase 1 完了後
- [ ] 🗑削除ボタンでGmailゴミ箱に移動される
- [ ] 削除のUndoでゴミ箱から復元される
- [ ] 一括選択→一括削除が機能する（10件以上で確認ダイアログ）
- [ ] 「全N件を選択」バナーが表示される（全件選択後）
- [ ] 条件一括処理で200件以上は上限制限される
- [ ] Auto Rules にステータス自動適用フィールドが表示される
- [ ] ルール実行後にステータスが自動変更される

### Phase 2 完了後
- [ ] チェック1件以上でツールバー背景色が変わる（一括モード感）
- [ ] サイドバーに店舗フィルタ（Hills/楽天/Amazon）が表示される
- [ ] 店舗クリックでフィルタリングされる
- [ ] 返信完了がスクロールなしで押せる（フローティング or 上部バー）
- [ ] 空ビューで文脈に応じたメッセージが表示される
- [ ] 差出人が短縮表示名で表示される
- [ ] ツールバーのアイコンが整理されている（3+もっとメニュー）
- [ ] 「未確認」バッジが「未読」に統合されている
