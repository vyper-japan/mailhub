# 🚀 MailHub プロジェクト - 新しいチャット開始ガイド

## 📌 最初に読むべきファイル

新しいチャットセッションで作業を開始する際は、**この順序で**以下のファイルを参照してください：

### 1. `_HANDOVER_GUIDE.md` ⭐ **最重要**
- **Step 113の詳細な作業内容**が記載されています
- 現在の進捗状況、次の作業手順、参考実装がすべて記載されています
- **必ず最初に読んでください**

### 2. `_PROJECT_CHAT_LOG.md`
- Step 1からStep 113までのすべての実装記録
- 各ステップの目的、実装内容、変更ファイル、検証結果
- 特にStep 75, 76, 80の実装を参考にすると効率的

### 3. `README.md`
- プロジェクト全体の概要
- 実装済み機能の一覧
- 環境設定、デプロイ手順など

---

## 🎯 現在の作業（Step 113）

### 作業内容
Assigneeセクションに全メンバーを表示し、Assign操作で担当者を選択できるようにする

### 進捗状況
- ✅ **完了**: Sidebarの表示、test/resetでのseed追加
- ⏳ **未完了**: Settings DrawerのAssigneesタブ追加、AssigneeSelectorの修正

### 次の作業
1. Settings Drawerに「Assignees」タブを追加（管理者のみ編集可能）
2. Assign操作で担当者選択UIに全メンバーを表示
3. E2Eテスト追加・検証
4. `npm run qa:strict` 2回連続PASS

**詳細は`_HANDOVER_GUIDE.md`を参照してください。**

---

## 📚 重要な参考実装

### Step 75: Assignee名簿のConfigStore実装
- `lib/assigneeRegistryStore.ts`
- `app/api/mailhub/assignees/route.ts`

### Step 80: Settings Drawerのタブ追加
- `app/settings/labels/settings-panel.tsx`
- Assigneesタブの追加パターン

### Step 76: Assign操作の実装
- `app/inbox/components/AssigneeSelector.tsx`
- `/api/mailhub/assignees`から取得するパターン

---

## 🔧 開発環境

### 必要な環境変数
- `.env.local`ファイルを参照（`.env.example`をコピー）
- Google OAuth設定
- Gmail API設定

### ローカル開発
```bash
npm ci
npm run dev
```

### 品質チェック
```bash
npm run qa:strict
```

---

## ✅ 作業完了時のチェックリスト

- [ ] 実装が完了している
- [ ] E2Eテストが追加されている
- [ ] `npm run qa:strict` が2回連続PASS
- [ ] `_PROJECT_CHAT_LOG.md`に完了記録を追加
- [ ] コードレビュー（必要に応じて）

---

## 💡 ヒント

1. **既存の実装を参考にする**
   - Step 75, 76, 80の実装パターンを参考にすると効率的
   - `_PROJECT_CHAT_LOG.md`で各ステップの実装内容を確認

2. **小さく実装して検証**
   - 段階的に実装して、都度検証することで問題を早期発見

3. **E2Eテストを先に書く**
   - 受け入れ条件をE2Eテストで表現
   - 実装しながらテストを実行して確認

---

**最終更新**: 2026-01-23
**現在のステップ**: Step 113（作業中）
