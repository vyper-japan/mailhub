# PILOT_REPORT (Step27) - 実メール接続パイロット

## 環境
- Date: 2026-01-07
- Shared Inbox (masked): inf***@vtj.co.jp
- NODE_ENV: development
- MAILHUB_READ_ONLY: 1 → 0
- MAILHUB_CONFIG_STORE: file
- MAILHUB_ACTIVITY_STORE: （未記入）
- Admin user: info@vtj.co.jp

## READ ONLY確認（MAILHUB_READ_ONLY=1）
- [x] 一覧表示 OK
- [x] 詳細表示 OK（本文が表示される / 常時エラーにならない）
- [x] 検索 OK
- [x] チャンネル/ステータス/担当フィルタ OK
- [x] 変更系ボタン disable + 理由表示 OK
- [x] 変更系API 403 OK（UIから叩けた場合でも拒否される）
- [x] rules/apply は Preview(dryRun) のみ可 / Apply不可 OK
- [x] alerts/run は dryRun のみ可 OK

## WRITE確認（MAILHUB_READ_ONLY=0 / 1件だけ）
対象メール:
- messageId: （未記入：取得方法 → Chrome DevTools > Network で `/api/mailhub/detail?id=...` の `id` をコピペ）

実施:
- [x] Assign 実行 → MailHub更新 → Gmail側ラベル反映（スクショ）
- [x] Waiting 実行 → MailHub更新 → Gmail側ラベル反映（スクショ）
- [x] Mute or Done 実行 → MailHub更新 → Gmail側ラベル反映（スクショ）
- [x] 手動ラベル付与（MailHub/Label/*） → MailHub更新 → Gmail側ラベル反映（スクショ）

補足:
- Gmail scopes が `gmail.readonly` のみだとWRITEが全滅するため、`gmail.modify` を含む refresh token に更新して実施。
- Muted/Done/Waiting の状態ラベルは相互排他になるように調整し、Gmail反映遅延も吸収（戻りバグ解消）。

## 添付（証拠）
- [ ] Gmail側スクショ: `./docs/pilot/gmail-<messageId>-<action>.png`（手元で追加）
- [ ] MailHub側スクショ: `./docs/pilot/mailhub-<messageId>-<action>.png`（手元で追加）
- [ ] Activity CSV Export: `./docs/pilot/activity-<date>-<env>.csv`（手元で追加）
- [x] MailHub側スクショ（READ ONLY Health）: `./docs/pilot/mailhub-meta-readonly-health.png`

### ファイル名規約（第三者レビュー用）
推奨ファイル名（コピペで統一）：
- Gmail側スクショ：`docs/pilot/gmail-<messageId>-<action>.png`
- MailHub側スクショ：`docs/pilot/mailhub-<messageId>-<action>.png`
- Activity CSV：`docs/pilot/activity-<date>-<env>.csv`

補足：
- `messageId` と紐づかない画面（設定/Health等）は `messageId=meta` を使用（例：`mailhub-meta-readonly-health.png`）

## 結論
- 判定: PASS
- 問題点:
- 次アクション:


