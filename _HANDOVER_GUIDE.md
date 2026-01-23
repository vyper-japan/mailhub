# MailHub プロジェクト引き継ぎガイド

## 📋 このファイルの目的

このファイルは、新しいチャットセッションでMailHubプロジェクトの作業を引き継ぐための完全なガイドです。
`_PROJECT_CHAT_LOG.md`と合わせて参照することで、これまでの作業内容と現在の進捗を完全に理解できます。

---

## 🎯 現在の状況（2026-01-23時点）

### 完了しているステップ
- **Step 1-113**: 大部分のステップが完了（詳細は`_PROJECT_CHAT_LOG.md`を参照）
- **最新完了**: Step 112 Command Palette（Ctrl/⌘K）で操作を最短化

### 作業中のステップ
- **Step 113**: Assigneeセクションに全メンバー表示（作業中）

---

## 📝 Step 113 の詳細情報

### 目的
- Assigneeセクションに Mine/Unassigned + 全メンバー（Taka/Maki/Yuka/Eri/Kumiko）を表示
- Assign操作で担当者を選択できる（自分以外にも割当可能）
- "Mine"はログイン中ユーザーの表示名（例：Taka）になる

### 受け入れ条件
1. サイドバーに Assignee: Mine(Taka), Unassigned, Maki, Yuka, Eri, Kumiko が表示される
2. クリックでその担当者のメールに絞り込める（一覧が壊れない）
3. 詳細の Assign ボタンで担当者選択UIが出る
4. 選んだ担当者に割り当てられ、一覧/詳細の pill も更新される
5. 既に他人担当なら Takeover 確認が出る
6. `npm run qa:strict` が2回連続PASS

### 実装方針（最小差分）
- assignees を ConfigStore に追加（labels/rules と同系統の保存）
- API: GET /api/mailhub/assignees（全員OK）＋ 変更系は admin のみ
- Assign API を assigneeEmail 受け取り対応（既存は自分固定だったので拡張）
- UI: Settings Drawer に "Assignees" タブ（最小UI）
- UI: Assign ポップオーバーで assignees を選択

### 現在の進捗（✅完了 / ⏳未完了）

#### ✅ 完了済み
1. `app/api/mailhub/test/reset/route.ts`: AssigneeRegistryにseed追加（Taka/Maki/Yuka/Eri/Kumiko）
2. `app/inbox/components/Sidebar.tsx`: 
   - Mine表示名を「Mine (表示名)」に変更（例: "Mine (Taka)"）
   - AssigneeセクションにTeam全メンバーを追加表示
   - Teamセクションは自分以外のみ表示（admin/testMode時）
3. `e2e/qa-strict-unified.spec.ts`: カラーバー対応のE2Eテスト修正

#### ⏳ 未完了（次の作業）
1. **Settings Drawerに「Assignees」タブ追加**
   - 管理者のみ追加/編集できる（事故らない）
   - 非管理者は閲覧のみ（選択肢としては見える）
   - UIは最小（名前＋emailの表だけ）でOK
   - 各メンバーの社内メール（例：maki@vtj.co.jp など）を登録する

2. **Assign操作で担当者選択UIに全メンバー表示**
   - AssigneeSelectorコンポーネントを修正
   - `/api/mailhub/assignees`から取得した一覧を表示
   - 選択した担当者に割り当てられる

3. **`npm run qa:strict` 2回連続PASS**
   - 実装完了後に検証

### 関連ファイル
- `app/inbox/components/Sidebar.tsx`（Mine表示名変更、Assigneeセクションに全メンバー追加）
- `app/api/mailhub/test/reset/route.ts`（AssigneeRegistry seed追加）
- `app/api/mailhub/assignees/route.ts`（Assignee API - 既存）
- `app/settings/labels/settings-panel.tsx`（Settings Drawer - Assigneesタブ追加が必要）
- `app/inbox/components/AssigneeSelector.tsx`（担当者選択UI - 修正が必要）
- `e2e/qa-strict-unified.spec.ts`（E2Eテスト）

---

## 📚 重要な参考資料

### 1. プロジェクト全体の記録
- **`_PROJECT_CHAT_LOG.md`**: Step 1からStep 113までのすべての実装記録
  - 各ステップの目的、実装内容、変更ファイル、検証結果が記録されている
  - 新しいチャットでは、このファイルを最初に読むこと

### 2. 既存の実装パターン
Step 113の実装では、以下の既存実装を参考にすること：

#### Assignee名簿の実装（Step 75, 80）
- `lib/assigneeRegistryStore.ts`: AssigneeRegistryのConfigStore実装
- `app/api/mailhub/assignees/route.ts`: Assignee API（GET/POST/DELETE）
- `app/settings/labels/settings-panel.tsx`: Settings Drawerの実装パターン

#### Assign操作の実装（Step 60, 76）
- `app/inbox/components/AssigneeSelector.tsx`: 担当者選択UI
- `app/api/mailhub/assign/route.ts`: Assign API（assigneeEmail対応済み）

#### サイドバーの実装（Step 64, 77）
- `app/inbox/components/Sidebar.tsx`: サイドバーコンポーネント
- Teamメンバーの表示ロジック（既に実装済み）

### 3. コードベースの構造
```
MailHub/
├── app/
│   ├── inbox/
│   │   ├── components/
│   │   │   ├── Sidebar.tsx          # サイドバー（Step 113で一部修正済み）
│   │   │   └── AssigneeSelector.tsx # 担当者選択UI（修正が必要）
│   │   └── InboxShell.tsx           # メインシェル
│   ├── api/
│   │   └── mailhub/
│   │       ├── assignees/            # Assignee API（既存）
│   │       └── assign/               # Assign API（既存）
│   └── settings/
│       └── labels/
│           └── settings-panel.tsx    # Settings Drawer（Assigneesタブ追加が必要）
├── lib/
│   ├── assigneeRegistryStore.ts      # AssigneeRegistry Store（既存）
│   └── labels.ts                     # ラベル定義
└── e2e/
    └── qa-strict-unified.spec.ts     # E2Eテスト
```

---

## 🚀 次の作業手順

### Step 1: Settings Drawerに「Assignees」タブ追加

1. **`app/settings/labels/settings-panel.tsx`を確認**
   - 既存のタブ（Labels, Rules, Templates等）の実装パターンを確認
   - Assigneesタブを追加する位置を決定

2. **AssigneesタブのUI実装**
   - 管理者のみ追加/編集可能（非管理者は閲覧のみ）
   - 最小UI: 名前＋emailの表
   - Add/Remove/Save/Reset操作
   - ConfigStore（AssigneeRegistryStore）に保存

3. **既存のAssignees APIを確認**
   - `app/api/mailhub/assignees/route.ts`を確認
   - GET/POST/DELETEが実装されているか確認

### Step 2: Assign操作で担当者選択UIに全メンバー表示

1. **`app/inbox/components/AssigneeSelector.tsx`を確認**
   - 現在の実装を確認
   - `/api/mailhub/assignees`から取得するように修正

2. **AssigneeSelectorの修正**
   - `/api/mailhub/team`から`/api/mailhub/assignees`に変更
   - 全メンバーを表示
   - 選択した担当者に割り当てられる

### Step 3: E2Eテスト追加・検証

1. **E2Eテスト追加**
   - Settings DrawerでAssigneesタブを開く
   - Assigneeを追加/削除
   - Assign操作で担当者選択UIに全メンバーが表示される
   - 選択した担当者に割り当てられる

2. **`npm run qa:strict` 2回連続PASS**
   - クリーン環境で2回連続実行
   - すべてのテストがPASSすることを確認

---

## 🔍 トラブルシューティング

### よくある問題と解決方法

1. **Assigneeが表示されない**
   - `/api/mailhub/assignees`が正しくseedされているか確認
   - `app/api/mailhub/test/reset/route.ts`でAssigneeRegistryにseedされているか確認

2. **Assign操作が動作しない**
   - `app/api/mailhub/assign/route.ts`で`assigneeEmail`が正しく受け取られているか確認
   - AssigneeSelectorが正しく`assigneeEmail`を渡しているか確認

3. **Settings DrawerでAssigneesタブが表示されない**
   - `app/settings/labels/settings-panel.tsx`でタブが追加されているか確認
   - タブの表示条件（admin/非admin）が正しいか確認

---

## 📖 参考: 既存の実装例

### Settings Drawerのタブ追加例（Step 80）
```typescript
// app/settings/labels/settings-panel.tsx
// Assigneesタブの追加パターン（参考）
const tabs = [
  { id: "labels", label: "Labels" },
  { id: "rules", label: "Auto Rules" },
  { id: "assignees", label: "Assignees" }, // ← これを追加
  // ...
];
```

### AssigneeSelectorの修正例（Step 76）
```typescript
// app/inbox/components/AssigneeSelector.tsx
// /api/mailhub/assigneesから取得するパターン（参考）
const assignees = await fetch("/api/mailhub/assignees").then(r => r.json());
```

---

## ✅ 完了チェックリスト

Step 113が完了したら、以下を確認：

- [ ] Settings Drawerに「Assignees」タブが追加されている
- [ ] 管理者のみ追加/編集可能、非管理者は閲覧のみ
- [ ] Assign操作で担当者選択UIに全メンバーが表示される
- [ ] 選択した担当者に割り当てられる
- [ ] 既に他人担当なら Takeover 確認が出る
- [ ] E2Eテストが追加されている
- [ ] `npm run qa:strict` が2回連続PASS
- [ ] `_PROJECT_CHAT_LOG.md`にStep 113完了の記録を追加

---

## 💡 ヒント

1. **既存の実装を参考にする**
   - Step 75, 80, 76の実装を参考にすると効率的
   - `_PROJECT_CHAT_LOG.md`で各ステップの実装内容を確認

2. **小さく実装して検証**
   - Settings Drawerのタブ追加 → 検証
   - AssigneeSelectorの修正 → 検証
   - 段階的に進めることで問題を早期発見

3. **E2Eテストを先に書く**
   - 受け入れ条件をE2Eテストで表現
   - 実装しながらテストを実行して確認

---

## 📞 質問がある場合

新しいチャットで作業を続ける際、不明な点があれば：
1. `_PROJECT_CHAT_LOG.md`で関連するステップを確認
2. 既存の実装コードを参照
3. 必要に応じてコードベース検索を使用

---

**最終更新**: 2026-01-23
**次のステップ**: Step 113の残りの実装（Settings DrawerのAssigneesタブ追加、AssigneeSelector修正）
