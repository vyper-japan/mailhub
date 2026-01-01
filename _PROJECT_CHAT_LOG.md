# MailHub Project Chat Log

---
**Date**: 2026-01-01 12:00
**Topic**: [Step 1] Hello Inbox & Foundation
**Summary**: 
- Google Auth 実装（vtj.co.jp ドメイン制限）
- Gmail API 連携（server-only 隔離設計）
- 最新1件表示機能の実装
- refresh token 取得スクリプトの作成
**Next Step**: Step 1.1 Hardening

---
**Date**: 2026-01-01 13:00
**Topic**: [Step 1.1] Hardening & Stability
**Summary**: 
- プロダクト名を「MailHub」に統一
- ログアウトの CSRF 問題を Server Action で修正
- Gmail リンクを `rfc822msgid` 検索方式で安定化
- .gitignore / .env.example 等の構成整理
**Next Step**: Step 2 Thread List

---
**Date**: 2026-01-01 14:00
**Topic**: [Step 2] Thread List & Detail
**Summary**: 
- 最新20件のリスト表示実装
- クリックによるメール詳細表示（text/plain 抽出）
- `authuser` 指定による Gmail リンクのアカウント固定
- `verify` スクリプト導入による品質担保
**Next Step**: Step 3 Channels

---
**Date**: 2026-01-01 15:00
**Topic**: [Step 3] Channels & Filtering
**Summary**: 
- 店舗別チャンネル（All, StoreA, StoreB, StoreC）の実装
- `deliveredto` / `to` / `cc` を含めた高度な Gmail 検索クエリ適用
- URL パラメータによる状態維持
**Next Step**: Step 3.1 Fast Preview

---
**Date**: 2026-01-01 16:00
**Topic**: [Step 3.1] Fast Preview & Cache
**Summary**: 
- server-only TTL キャッシュ実装（10s/60s）
- `next/link` 採用による画面遷移の高速化
- キャッシュキーへのユーザー識別子統合
**Next Step**: Step 4/5 UI Optimization

---
**Date**: 2026-01-01 17:30
**Topic**: [Step 6/7/8] Operational Excellence (Archive/Shortcuts/Zero Inbox)
**Summary**: 
- アーカイブ（INBOXラベル削除）と Undo 機能の実装
- キーボードショートカット（↑↓, E, U, ?）の導入
- トースト通知による操作フィードバック
- 全件処理完了時の「Zero Inbox」達成画面の実装
**Next Step**: Step 9 Status Implementation

---
**Date**: 2026-01-01 19:00
**Topic**: [Step 9] Gmail Label Sync (Status)
**Summary**: 
- 独自ラベル（MailHub/Waiting, MailHub/Done）による状態管理
- Waiting / Done フォルダへの自動振り分けロジック
- テストモード（MAILHUB_TEST_MODE）の導入による E2E 検証環境の整備
- 左ナビへの常時件数表示（API endpoint `/api/mailhub/counts`）
**Next Step**: UI Perfect Porting

---
**Date**: 2026-01-01 21:00
**Topic**: UI Perfect Porting (Deep Blue)
**Summary**: 
- `design_concepts.tsx` (Concept D) の本番移植
- 全体背景を `#0f172a` に刷新し、カードレイアウトを導入
- `lucide-react` アイコンへの完全移行
- 既存の Gmail ロジックを維持したまま、モダンなダークテーマ UI へ刷新
**Next Step**: Resizable Layout

---
**Date**: 2026-01-01 22:00
**Topic**: UI Overhaul - Resizable Layout & Topbar
**Summary**: 
- サイドバーとリストカラムの幅をドラッグで調整できる機能（Resizable Layout）を実装
- 各カラム間にリサイズ用ハンドルを追加し、操作性を向上
- トップバーの刷新（アクションボタン、検索窓、システムボタンの配置）
- `npm run verify` による最終ビルド・型チェックの通過確認
**Next Step**: Step 10 TopBar Actions 実装

---
**Date**: 2026-01-01 23:00
**Topic**: [Step 10] TopBar Actions Implementation
**Summary**: 
- トップバーのアクションボタン（Done, Later, Claimed, Refresh, Nav）を実装
- **Done**: 既存のアーカイブロジックと統合
- **Later**: Waiting状態のトグル機能を実装（WaitingならTodoに戻す）
- **Claimed**: 「対応中（InProgress）」ラベルのトグル機能を新規実装。右ペインのバッジと同期
- **Refresh**: 現在のリストを再取得しつつ、選択状態を可能な限り維持
- **Search**: 表示中の最新20件をクライアントサイドで即時フィルタリングする機能を実装（Cmd+K / Esc ショートカット対応）
- **Nav**: トップバーの ↑↓ ボタンでメール選択を移動（スクロール追従）
- **テストモード**: MAILHUB_TEST_MODE=1 にて Gmail API 無しでもこれらの操作がUI上で完結することを確認
- `npm run verify` 通過
**Next Step**: プロジェクトの安定運用とフィードバック収集

---
**Date**: 2026-01-01 23:30
**Topic**: [Step 11] Reply Actions (楽天RMS返信ルート)
**Summary**: 
- 返信先を判定するRouter（lib/replyRouter.ts）を実装
- 楽天RMS用のコンテキスト抽出（lib/rakuten/extract.ts）を実装
- 楽天RMS返信API（app/api/mailhub/rakuten/reply/route.ts）を実装（API優先＋フォールバック）
- UIに返信パネルを追加（問い合わせ番号自動抽出、送信/コピー/RMSを開くボタン）
- テストモード用の楽天メールfixture（msg-021）を追加
- README・env.exampleに楽天RMS返信機能の説明を追加
**Next Step**: Step 11.1 QA Gate

---
**Date**: 2026-01-01 23:45
**Topic**: [Step 11.1] QA Gate（開けない撲滅 / 楽天fixture確実表示 / smoke自動検証）
**Summary**: 
- **pinned機能**: fixtures/messages.jsonに`pinned: true`を追加し、テストモードでmsg-021を先頭に表示するように実装
- **smokeスクリプト**: `scripts/smoke.mjs`を追加し、以下の自動検証を実装
  1) fixtures/details/msg-021.jsonが存在する
  2) extractInquiryNumberが正しく動作する（問い合わせ番号抽出）
  3) replyRouterがrakuten_rms判定になる
  4) msg-021がmessages.jsonに含まれ、pinned: trueが設定されている
- **package.json**: `npm run smoke`スクリプトを追加
- **型定義**: InboxListMessageに`pinned?: boolean`を追加
- **ソートロジック**: テストモードでpinnedメッセージを先頭にソートする処理を追加
**検証結果**:
- `npm run smoke`: ✅ All smoke tests passed! (8 checks, 0 errors)
- `npm run verify`: ✅ 型チェック・ビルド通過
**Next Step**: プロジェクトの安定運用とフィードバック収集
---

