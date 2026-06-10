# 🚀 MailHub プロジェクト - 新しいセッション開始ガイド

**最終更新**: 2026-06-11（vision-gap偵察完了・ロードマップのび太承認済み）
**現在地**: シールドV2.5走行#1〜#4 sign-off済み + 走行#5（ビジョン・ギャップ偵察）完了。**次=T1 mailhub-prod-rollout**

---

## 📌 プロジェクトの最終ゴール（のび太 2026-06-10 言語化）

メールディーラー解約（-¥272,640/年）のため、自社で必要な機能だけを盛り込んだメーラーを作る:
1. 複数ストアの問い合わせを一箇所で見れる、Gmail並みサクサクのメーラー
2. 外注スタッフがログインし、返信が必要なメールを一発で発見できる
3. 各サイトのAPI（楽天/Amazon/MakeShop等）でメーラー内から正確に返信
4. スパム等ノイズをフィルタし「本当に必要なメールだけ」見える
5. 担当者指定 + Chatwork通知
6. 過去Q&Aナレッジ（別構築）からAIが返信下書きを自動生成、人間が承認して送信ボタンを押す
7. 送信結果がナレッジに還流して精度が上がり続けるループ

## ✅ 承認済みロードマップ（2026-06-11 のび太GO、推奨順で進行）

```
【運用・並行】MX切替実行 ← メールディーラー解約のクリティカルパス（mx-cutover/MX_CUTOVER_RUNBOOK.md のび太レビュー待ち）

T1 mailhub-prod-rollout   (S-M) ★次はこれ
T2 mailhub-inapp-send     (M)   ← ビジョンの心臓部（アプリ内送信）
T3 mailhub-chatwork-notify(M)
T4 mailhub-noise-zero     (M)
T5 mailhub-ai-draft-v1    (M)
──後続── T6 R-Messe API / T7 ナレッジ還流ループ / T8 サクサク高速化
```

根拠レポート（コードfile:line付き、HEAD=63dcee2時点）:
`~/.claude/instructions/mailhub-vision-gap/phase0/{r1-ingest-send,r2-noise-triage,r3-assign-notify-rollout,r4-performance-arch,r5-knowledge-assets,pm-synthesis}.md`

## 🎯 T1 mailhub-prod-rollout のスコープ（偵察確定済み、再偵察は差分のみでよい）

1. **本番env整備**（R3レポートのenv分類表が正本）: NEXTAUTH_*、GOOGLE_*（shared inbox）、`MAILHUB_ENV=production`、`MAILHUB_READ_ONLY=0`、`MAILHUB_ADMINS`、`MAILHUB_CONFIG_STORE=sheets`、`MAILHUB_ACTIVITY_STORE=sheets`、`MAILHUB_SHEETS_*` 3点、各secret（ALERTS/CONFIG_EXPORT/RULES + env.example未掲載の`MAILHUB_SNOOZE_SECRET`/`MAILHUB_PUBLIC_BASE_URL`）
2. **ConfigAssignees初期投入** + config importのassignees対応（exportは対応済み・importはlabels/rulesのみ＝非対称。lib/config-export.ts:10-45 vs app/api/mailhub/config/import/route.ts:184-229）
3. **チャンネル実店舗化**: lib/channels.ts:19 / lib/labels.ts:37-49 のStoreA/B/Cプレースホルダーを実店舗に、Sidebar.tsx:126 のtestModeガード外し
4. **セキュリティ穴修正**: `/api/mailhub/team` GETが未認証公開（app/api/mailhub/team/route.ts:12-19、requireUserなし）
5. **slug統一**: assign APIのresponse slugが`email.split("@")[0]`で正規slug（lib/assignee.ts:5-10）と不一致（app/api/mailhub/assign/route.ts:56-57）
6. **workflow schedule有効化**: mailhub-alerts.yml / mailhub-config-export.yml のscheduleコメントアウト解除
7. デプロイ形態の確定（OPS_RUNBOOK.mdはVercel前提だがstale可能性、要確認）

## 🔑 T2以降の設計上の確定事項（偵察#5の重要発見、忘れると手戻り）

- **アプリ内送信は未実装**: Gmailはリンクアウトのみ・`gmail.send`スコープなし（scripts/get-refresh-token.mjs:59）、楽天RMS routeはTODO stub（app/api/mailhub/rakuten/reply/route.ts:75）
- **From問題**: mailhub@で受けた41グループ宛メールへの返信は、From=元のグループアドレスが必須 → Gmail send-asエイリアス（41グループ分）の設定がT2の必須要件
- **楽天だけR-Messe必須**: Amazonバイヤーメッセージ/MakeShopはGmail返信で顧客に届く。楽天はR-Messe集約 → T2のGmail送信でAmazon+MakeShop+直メールをカバー、楽天はT6で
- **AIナレッジ資産**: vyper-eye（Mac内SQLite）にcommunication_corpus 376,509件 / hills_qa 1,628 / canonical 202 / FTS5実装済み。MailHubはVercel前提のため、T5 v1はexport方式→v2でAPI化
- **TEST_MODEはConfigStore=memory固定** → Sheets系はE2Eで検出不可、unitテスト必須（走行#1の教訓）

## 📚 参照ドキュメント

| ファイル | 用途 | 注意 |
|---|---|---|
| `_PROJECT_CHAT_LOG.md` | Step 1〜113の実装記録 | 参考程度 |
| `_HANDOVER_GUIDE.md` | 旧Step113ガイド | **stale（2026-01-23）。Step113は完了済み、信用しない** |
| `IMPROVEMENT_PLAN.md` | 改善計画v2 | Phase 0完了。Phase 1+はT4/T8に吸収済み |
| `MAIL_MIGRATION_STATUS.md` | MX移行ステータス正本 | mailhub@が41グループ受信の設計 |
| `mx-cutover/MX_CUTOVER_RUNBOOK.md` | MX切替手順書 | のび太レビュー待ち |
| `OPS_RUNBOOK.md` | 運用手順 | 一部stale |

## 🔧 開発・品質チェック

```bash
npm ci && npm run dev      # ローカル開発
npm run qa:strict          # 品質ゲート（2回連続PASSが完了条件、E2E 123本）
```

- 開発はシールドV2.5パイプライン（偵察→PRD→実装→検証→番人→Phase4.5ゲート）で走行する
- codexサンドボックスはポートbind不可 → playwright/qa:strict実行はFable代行
- E2Eのflaky対策規約は走行#3で確立済み（expect.poll、Promise.all+waitForResponse、自前reset+seed）
