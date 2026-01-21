# MailHub

社内メンバー（外注含む）が同じ受信箱を見て処理するための、超軽量Webアプリです。

## できること（現状）

- Googleログイン（`vtj.co.jp` ドメインのみ）
- 共用受信箱（1つのGmail）を **server-only** で参照（トークンをクライアントに出しません）
- 最新20件の一覧（左）→クリックで詳細（右）
- 本文は `text/plain` のみ抽出して安全に表示（HTMLは表示しない）
- `Open in Gmail ↗`（`rfc822msgid:` 検索 + `authuser=共有受信箱` で事故を減らす）
- **Step 3**: 3店舗チャンネル固定で絞り込み（All / StoreA / StoreB / StoreC）
- **Step 6**: アーカイブ（完了）＋ Undo（取り消し）
- **Step 7**: キーボードショートカット（↑↓移動 / E完了 / U取り消し / ?ヘルプ）
- **Step 8**: Zero Inbox（0件で🎉達成感演出＋次の行動導線）
- **Step 9**: Status実装（Todo/Waiting/DoneをGmailラベル連動 + W/Tショートカット）
- **Step 10**: Auth統一 + 操作ログ
- **Step 11**: Reply Actions（楽天RMS返信ルート：API優先＋フォールバック）
- **Step 13**: 低優先（ミュート）機能（MailHub/Mutedラベルで安全に退避）
- **Step 14**: Smart Triage（低優先候補の自動提示 + 一括ミュート）
- **Step 15**: Collaboration（担当者アサイン + 引き継ぎ + 自分フィルタ）
- **Step 16**: Bulk Actions（複数選択 + 一括処理：Done/Mute/Waiting/Assign）
- **Step 24**: Settings（ラベル/自動ルール管理 + Preview→Applyの安全弁）
- **Step 51**: Search v2（Gmail検索式でサーバ検索 + URL共有 + 操作継続）
- **Step 52**: Work Queues（定型検索＝作業キュー保存＆共有）
- **Step 53**: Auto Rules Runner（自動ラベリング定期実行・安全設計）
- **Step 55**: Reply Launcher（返信導線の最短化：RMS/Gmail判定、問い合わせ番号抽出、テンプレ挿入）

## Settings（ラベル/自動ルール管理）

ヘッダー右側の **歯車（Settings）** から右Drawerを開き、以下を管理できます：

- **Labels**: MailHub管理ラベル（`MailHub/Label/*`）の作成/表示名変更/登録解除
  - Gmailの既存ラベルを勝手に変更/削除しません（MailHubプレフィックス以外は触りません）
- **Auto Rules**: 送信元（fromEmail / fromDomain）に応じた自動付与ルール
  - 事故防止のため、まず **Preview（dryRun）** で対象件数とサンプルを確認してから **Apply now** を実行してください
  - 自動付与は **addのみ**（removeはしません）

### Auto Assign Rules（未割当の自動ルーティング）

- **目的**: 「未割当」を"人が見る前"に減らす（ただし事故防止優先）
- **場所**: Settings → **Auto Assign** タブ（独立タブ）
- **編集**: adminのみ（非adminは閲覧のみ、ConfigStore永続化）
- **適用**: Preview→Applyの2段階（まずstagingで）
  - Preview（dryRun）は READ ONLY でもOK
  - Apply now は **admin必須** + **READ ONLYでは403**
- **設計方針（事故防止）**
  - 適用対象は **Unassignedのみ**（既担当はスキップ）
  - **takeover（強制引き継ぎ）を自動ルールでは絶対にしない**
  - Applyは最大50件/同時実行3/1件6秒タイムアウト（安全側に倒す）

### Rule Inspector（ルール診断・説明）

- **Explain（説明）**: メール詳細ペインの「説明」ボタンで、そのメールに適用されるラベルルールとAssigneeルールを確認できます
  - マッチしたルールのID、マッチ理由（fromEmail/fromDomain）、適用結果（ラベル名/担当者）を表示
  - adminユーザーはルールの設定画面へのリンクも表示されます
  - READ ONLYでも利用可能（説明のみ、副作用なし）
- **Diagnostics（診断）**: Settings → **Diagnostics** タブで、ルール全体の診断結果を確認できます
  - **衝突検知**: 同じ条件で異なる結果を返すルールの組み合わせを検出
  - **危険ルール検知**: 広すぎるドメイン（gmail.com等）やPreview件数が多すぎるルールを警告
  - **無効ルール検知**: 有効だがサンプル中にマッチしないルールを検出
  - **ヒット統計**: 各ルールのサンプル50件中のヒット数と上位5件のサンプルを表示
  - 非管理者も閲覧可能（診断は副作用ゼロ）

### Rule Suggestions（ルール提案）

- **提案エンジン**: Activityログから自動的にルール候補を生成します
  - **Auto Mute提案**: 複数人が繰り返し「低優先へ（ミュート）」を実行している送信元
  - **Auto Assign提案**: 特定の送信元に対して、特定担当への割り当てが繰り返されている場合
  - 閾値: デフォルトで14日間、最小3アクション、最小2アクター（1人の好みをルール化しないため）
- **UI**: Settings → **Suggestions** タブで提案を確認できます
  - 提案カードには理由、根拠件数、関与したactor数が表示されます
  - **Preview**ボタンで既存のdryRun導線に接続して対象件数を確認できます
  - adminのみ**採用して作成**ボタンでルールを作成できます（危険提案は強警告＋confirm必須）
  - READ ONLYでも閲覧・Previewは可能（採用はadmin必須）
- **運用推奨**: 週次でSuggestionsを確認し、Previewで件数を確認してから採用する

## Reply Launcher（返信導線の最短化）

メール詳細ペインに「Reply（返信）」ブロックが表示され、返信先種別を自動判定して最適な導線を提供します。

- **返信先判定**
  - **Gmail返信**: 通常のメールはGmailで返信
  - **楽天RMS返信**: 楽天メール（StoreA/B/Cチャンネル）はRMSで返信
  - **Unknown**: 判定できない場合は手動判断
- **RMS導線（楽天メールの場合）**
  - 問い合わせ番号が自動抽出される（既存extract活用）
  - 「RMSを開く」ボタンで該当画面へ遷移（URLは `MAILHUB_RAKUTEN_RMS_BASE_URL` で設定可能）
  - 「問い合わせ番号をコピー」ボタン（トーストで成功表示）
  - ※自動ログイン/2FA突破は絶対にしない（安全上NG）。導線の最短化まで。
- **テンプレを返信作業に接続**
  - Replyブロック内でテンプレを選択できる
  - 選択したテンプレ本文をReplyブロックのテキストエリアに挿入（編集可）
  - 「コピー」でクリップボードへ（トースト表示）
- **単体/複数選択時で挙動を分ける**
  - 単体：テンプレ挿入・転記・RMS/Gmail導線すべて有効
  - 複数：テンプレの「コピー」だけ許可（事故防止）
- **READ ONLYでも使える範囲を明確化**
  - READ ONLY時：「RMSを開く」「コピー」はOK
  - READ ONLY時：「社内メモへ転記（=書き込み）」はNG（理由表示）

**運用推奨**:
- 返せない時はWaitingではなくSnooze（期限必須）
- RMSは「開く+コピー」が基本運用
- READ ONLY時はコピーはOK、書き込みはNG

## Internal Ops（社内メモ / 返信下書き / テンプレ）

メール詳細ペインの下部に、運用を速くするための「Internal Ops」機能があります。

- **社内メモ（共有）**
  - メールごとに共有メモを保存できます（ConfigStore永続化）。
  - 最大4000文字、空文字は削除扱い。
  - READ ONLYでは編集できません（UI/ APIともに403）。
  - Activityには `note_set` / `note_clear` を記録します（**本文はログに出しません**）。
- **返信下書き（個人）**
  - 端末ごとに `localStorage` へ保存します（messageId単位）。
  - 「コピー」でGmail/RMSへ貼り付け用の文章を即コピーできます。
  - 「テンプレ」から定型文を挿入できます。
- **テンプレ（共有）**
  - Settings → **Templates** タブで管理（adminのみ作成/編集/削除、閲覧は全員）。
  - 最大10000文字、既定テンプレが3件入っています。

## Search（Gmail検索式でサーバ検索）

トップバーの検索ボックスで、Gmailの検索式を使ってサーバ側で検索できます。

- **検索式の例**:
  - `subject:(メンテナンス)` - 件名に「メンテナンス」を含む
  - `from:rakuten.co.jp` - 送信元がrakuten.co.jp
  - `from:rakuten subject:(メンテナンス) newer_than:7d` - 複合条件
- **使い方**:
  - 検索ボックスに検索式を入力して **Enter** で確定
  - 検索中は「検索中: [query]」チップが表示され、クリックで解除
  - **Esc** キーで検索をクリア
- **特徴**:
  - 検索状態でも操作（Done/Mute/Waiting/Assign/Label/Undo）が継続できる
  - 検索クエリはURLに保持され、共有・再読み込みで同じ結果に戻れる
  - 現在選択中のラベル（Channels/Status/Assignee）に対して検索が実行される

## Work Queues（作業キュー）

よく使う検索を保存してワンクリックで呼べるようにします。

- **使い方**:
  - トップバーの **Queues** ボタンをクリックして保存済みキュー一覧を表示
  - キューをクリックすると即座に検索が適用され、一覧が更新されます
  - URLに検索クエリが保持され、共有・再読み込みで同じ結果に戻れます
- **管理**:
  - Settings → **Queues** タブで管理（adminのみ作成/編集/削除、非adminは閲覧のみ）
  - 名前、Gmail検索式、適用先ラベル（任意）を設定できます
  - 最大50件まで保存可能
- **運用例**:
  - 楽天お知らせ: `from:rakuten.co.jp subject:(お知らせ OR メンテナンス)`
  - SLA危険: `newer_than:3d -label:MailHub/Done -label:MailHub/Muted`
  - 未割当の長期滞留: `label:MailHub/Unassigned older_than:7d`

## Saved Views（保存ビュー）+ Command Palette

- 左サイドバーの **Views** から、よく使う絞り込みをワンクリックで切替できます（例: `mine`, `unassigned`, `waiting`）。
- **Cmd/Ctrl+K** で Views のコマンドパレットを開き、検索して Enter で即切替できます。
- Views は共有設定で、Settings → **Views** タブから管理できます（adminのみ編集、非adminは閲覧のみ）。

## Settings Hardening（本番運用のための永続化/権限/診断）

### 永続化（Config Store）
Settingsで管理するラベル/ルールは `MAILHUB_CONFIG_STORE` で永続化方式を選べます：

- `MAILHUB_CONFIG_STORE=file`（開発/CI向け）: `.mailhub/registered-labels.json` / `.mailhub/labelRules.json`
- `MAILHUB_CONFIG_STORE=sheets`（staging/prod推奨）: Google Sheets（Tabs: `ConfigLabels` / `ConfigRules`）

Sheets設定はActivityと同じService Account方式を流用します（`MAILHUB_SHEETS_SPREADSHEET_ID` 等）。

### Admin Guard（事故防止）
Settingsの編集（ラベル登録/ルール編集/Import/Preview/Apply）は **管理者のみ**です。

- `MAILHUB_ADMINS="takayuki@vtj.co.jp,..."`（CSV）で管理者を指定
- 非管理者は歯車が表示されず、APIも `403 forbidden_admin_only` で拒否されます

### 診断
`GET /api/mailhub/config/health` で、Config Storeの状態（storeType/admin/sheets疎通/件数）を確認できます。

## Real Inbox Pilot（実データ接続の安全装置）

### READ ONLY（最優先の安全装置）
実メール（shared inbox）に接続して検証する際は、まず **READ ONLY** で起動してください。

- `MAILHUB_READ_ONLY=1`：変更系APIは **403**、UIも無効化（Preview/閲覧のみ）
- `MAILHUB_READ_ONLY=0`：書き込み解禁（Done/Waiting/Mute/Assign/ラベル付与などが有効）

現在の状態は Settings Drawer の Health サマリ（readOnly/admin/inboxマスク等）で確認できます。

### Step28: Staging Ops（どこでもアクセス + 事故ゼロ運用）
staging は **デフォルトREAD ONLY** を推奨します（環境変数 `MAILHUB_ENV=staging` の場合、`MAILHUB_READ_ONLY` 未設定でも安全側に倒れます）。

**staging推奨（テンプレ）**:
- `MAILHUB_ENV=staging`
- `MAILHUB_READ_ONLY=1`（事故ゼロ）
- `MAILHUB_CONFIG_STORE=sheets`（Settingsデータを永続化）
- `MAILHUB_ACTIVITY_STORE=sheets`（操作ログを永続化）

注意（将来の公開/ホスティング）:
- `file` ストアはサーバレス環境で永続しません（再デプロイで消えます）。公開するなら最終的に **sheets推奨**。

### Step27: 実メール接続パイロット（証跡づくり）
実データ接続の手動QAは `PILOT_REPORT.md` を埋め、証跡（スクショ/CSV）を `docs/pilot/` に保存してください。
Activityの証跡を残す場合は、Activity Drawerの **Export（CSV）** を使い `docs/pilot/activity-YYYYMMDD.csv` などで保存してください。

## 認証・認可

- **認証**: Googleログインのみ（`vtj.co.jp` ドメイン限定）
- **認可**: 全APIで認証チェック（未ログイン→401、ドメイン不一致→403）
- **UI**: ヘッダーにログイン中ユーザー（email）を表示

## 操作ログ（Activity）

状態を変える操作（Archive / Unarchive / Waiting / Todoに戻す）は、サーバー側で以下の形式でログ出力されます（Vercel logsで追跡可能）：

```json
{
  "type": "AUDIT_LOG",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "actorEmail": "user@vtj.co.jp",
  "action": "setWaiting",
  "messageId": "msg-001",
  "label": "all"
}
```

- `actorEmail` はサーバー側でセッションから取得（クライアントから渡さない）
- Vercel Dashboard → Logs でリアルタイム確認可能

### Activity永続化（本番推奨）

**本番環境でActivityログを永続化するには、Google Sheets設定が必要です**：

1. Google Cloud ConsoleでService Accountを作成
2. Service AccountにGoogle Sheets APIを有効化
3. スプレッドシートを作成し、Service Accountに編集権限を付与
4. 環境変数を設定：
   - `MAILHUB_ACTIVITY_STORE=sheets`
   - `MAILHUB_SHEETS_SPREADSHEET_ID=<スプレッドシートID>`
   - `MAILHUB_SHEETS_CLIENT_EMAIL=<Service Account Email>`
   - `MAILHUB_SHEETS_PRIVATE_KEY=<Private Key（\nをエスケープ）>`
   - `MAILHUB_SHEETS_SHEET_NAME=Activity`（オプション、デフォルト: Activity）

**設定しない場合**: メモリリングバッファ（直近200件、再起動で消える）が使用されます。

**CSVエクスポート**: Activity Drawerの「CSV Export」ボタンで、操作ログをCSV形式でダウンロードできます。

### SLA Alerts（放置防止通知）

**通知を使うなら Slack webhook を入れる**:
1. SlackでIncoming Webhookを作成
2. 環境変数を設定：
   - `MAILHUB_ALERTS_PROVIDER=slack`
   - `MAILHUB_SLACK_WEBHOOK_URL=<webhook URL>`
   - `MAILHUB_ALERTS_SECRET=<secret token>`（本番必須）
3. Vercel Cronで10分おきに `/api/mailhub/alerts/run` を実行

**定期実行のやり方**:
```bash
# dryRunで確認（まずdryRunで確認→本番ON）
curl -H "Authorization: Bearer $MAILHUB_ALERTS_SECRET" \
  "https://<YOUR_DOMAIN>/api/mailhub/alerts/run?dryRun=1&scope=all"

# 本番実行
curl -H "Authorization: Bearer $MAILHUB_ALERTS_SECRET" \
  "https://<YOUR_DOMAIN>/api/mailhub/alerts/run?scope=all"
```

**staging/prodでWebhookを分ける注意**: 各環境で異なるWebhook URLを設定してください（通知の重複を防ぐため）。

**止め方**: `MAILHUB_ALERTS_PROVIDER=none` を設定すると通知が無効化されます。

## 環境設定（Staging/Production）

MailHubは**Staging**と**Production**の2環境で動作します（Vercel想定）。

### Staging環境

**環境変数設定（Vercel）**:
```
NEXTAUTH_URL=https://mailhub-staging.vercel.app
NEXTAUTH_SECRET=<staging用のシークレット>
NEXTAUTH_TRUST_HOST=true
GOOGLE_CLIENT_ID=<staging用>
GOOGLE_CLIENT_SECRET=<staging用>
GOOGLE_SHARED_INBOX_EMAIL=inbox@vtj.co.jp
GOOGLE_SHARED_INBOX_REFRESH_TOKEN=<staging用>
MAILHUB_TEST_MODE=0  # または未設定
```

**Google OAuth Redirect URI**:
```
https://mailhub-staging.vercel.app/api/auth/callback/google
```

### Production環境

**環境変数設定（Vercel）**:
```
NEXTAUTH_URL=https://mailhub.vercel.app
NEXTAUTH_SECRET=<本番用のシークレット>
NEXTAUTH_TRUST_HOST=true
GOOGLE_CLIENT_ID=<本番用>
GOOGLE_CLIENT_SECRET=<本番用>
GOOGLE_SHARED_INBOX_EMAIL=inbox@vtj.co.jp
GOOGLE_SHARED_INBOX_REFRESH_TOKEN=<本番用>
# MAILHUB_TEST_MODE は設定しない（本番ガードで無効化される）
```

**Google OAuth Redirect URI**:
```
https://mailhub.vercel.app/api/auth/callback/google
```

### ⚠️ 重要な注意事項

1. **`NEXTAUTH_URL`の設定ミスに注意**
   - StagingとProductionで異なるURLを設定すること
   - 設定ミスがあると認証が失敗する

2. **本番で`MAILHUB_TEST_MODE`を設定しない**
   - Production環境では`NODE_ENV=production`により自動的に無効化される
   - 設定しても動作しない（ガード機能により強制的に無効化）

3. **環境変数の確認**
   - Vercelのダッシュボードで各環境の変数を確認
   - `.env.local`はローカル開発用（Gitにコミットしない）

詳細は [OPS_RUNBOOK.md](./OPS_RUNBOOK.md) を参照してください。

## QA-Strict（厳格テスト）

MailHubは機械的な検証により品質を担保しています。

### クリーン環境での厳格QA

```bash
rm -rf node_modules .next && npm ci && npm run qa:strict
```

この1行で以下を順に実行します：
- `verify`: TypeScript型チェック + ビルド
- `smoke`: 基本的なfixture検証
- `lint`: Next.js Lint
- `test:coverage`: Unitテスト（カバレッジ80%以上）
- `security:scan`: セキュリティ静的解析
- `e2e`: Playwright E2Eテスト

### 個別実行

```bash
npm run verify        # TypeScript + Build
npm run smoke         # Fixture検証
npm run lint          # Lint
npm run test          # Unitテスト
npm run test:coverage # Unitテスト（カバレッジ付き）
npm run security:scan # セキュリティスキャン
npm run e2e           # E2Eテスト
```

詳細は `QA_REPORT.md` を参照してください。

## ローカル起動手順

1) 依存関係をインストール（再現性のため `npm ci` 推奨）

```bash
npm ci
```

※ 再現性のため **`package-lock.json` を前提に `npm ci` を推奨**します。

2) 環境変数を用意

```bash
cp .env.example .env.local || cp env.example .env.local
```

`.env.local` を本物で埋めてください（最低でも Google OAuth と shared inbox の refresh token）。

3) refresh token 未取得なら（共用受信箱で許可）

```bash
node scripts/get-refresh-token.mjs
```

※ `refresh_token` が出ない場合、`https://myaccount.google.com/permissions` で対象アプリのアクセス権を取り消してから再実行してください。
※ WRITE（Assign/Waiting/Mute/Done/ラベル変更）を行うには `gmail.modify` が必要です（スコープ不足だと全部403になります）。

4) 起動

```bash
npm run dev
```

5) ブラウザで確認

- `http://localhost:3000`

## Reproゲート（CI/外注検証向け）

クリーン環境相当で：

```bash
rm -rf node_modules .next
npm ci

NEXTAUTH_SECRET=dummy \
NEXTAUTH_URL=http://localhost:3000 \
NEXTAUTH_TRUST_HOST=true \
GOOGLE_CLIENT_ID=dummy \
GOOGLE_CLIENT_SECRET=dummy \
GOOGLE_SHARED_INBOX_EMAIL=inbox@vtj.co.jp \
GOOGLE_SHARED_INBOX_REFRESH_TOKEN=dummy \
npm run verify
```

※ `verify` は `npm run typecheck && npm run build` です（`build` が環境変数を必要とするため、上記のようにダミー値でOKです）。

## 必要な環境変数一覧

| 変数名 | 用途 |
| --- | --- |
| `NEXTAUTH_URL` | NextAuthのURL（local: `http://localhost:3000`） |
| `NEXTAUTH_SECRET` | NextAuthの署名用シークレット |
| `NEXTAUTH_TRUST_HOST` | `true` 推奨 |
| `GOOGLE_CLIENT_ID` | Google OAuth クライアントID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth クライアントSecret |
| `GOOGLE_SHARED_INBOX_EMAIL` | 共用受信箱（例: `inbox@vtj.co.jp`） |
| `GOOGLE_SHARED_INBOX_REFRESH_TOKEN` | 共用受信箱の refresh token（サーバー側のみ） |

## Google Cloud 側の手順（簡潔版）

1) Gmail APIを有効化  
2) OAuth同意画面（社内利用なら Internal 推奨）  
3) OAuthクライアント（Web application）を作成し、Redirect URI に追加

- `http://localhost:3000/api/auth/callback/google`
- `http://localhost:47865/oauth2callback`
- `https://<YOUR-VERCEL-DOMAIN>/api/auth/callback/google`

## チャンネル（Step 3）

- チャンネル追加/変更は **`lib/channels.ts` を編集**してください（UIからの追加編集はしません）
- URL例：
  - `/?channel=all`
  - `/?channel=store-a&id=<messageId>`

## Gmail API スコープ

Step 6（アーカイブ機能）を使うには、refresh token を取得する際に以下のスコープが必要です：

- `https://mail.google.com/`（フルアクセス）

または最小権限で：

- `https://www.googleapis.com/auth/gmail.readonly`（読み取り）
- `https://www.googleapis.com/auth/gmail.modify`（ラベル変更）

※ `scripts/get-refresh-token.mjs` はデフォルトで最小権限（`gmail.readonly` + `gmail.modify`）を要求します。
（必要なら `OAUTH_SCOPES` にカンマ区切りでスコープを指定して上書きできます）

## Status機能（Step 9）

Status は Gmail ラベルを使って状態を管理します：

| Status | Gmail上の状態 |
| --- | --- |
| Todo（未対応） | INBOX にある |
| Waiting（保留） | `MailHub/Waiting` ラベル + INBOX外 |
| Done（完了） | `MailHub/Done` ラベル + INBOX外 |

ラベルは初回使用時に自動作成されます。

**ショートカット**:
- `E`: 完了（Archive）
- `W`: 保留（Waiting）
- `T`: Todoに戻す（Waiting/Doneから）
- `M`: 低優先へ（ミュート）
- `U`: Undo

## 低優先（ミュート）機能（Step 13）

低優先メールは「迷惑（Spam）」ではなく、「読む必要は低いが、たまに重要が混ざる」メールを安全に退避する機能です。

**特徴**:
- 低優先は“消す”のではなく“退避して後から見返せる”ことが必須
- Gmail側では`MailHub/Muted`ラベルを使用（SPAM/TRASHは使わない）
- 左ナビのStatusに「Muted（低優先）」を追加し、そこから退避したメール一覧を見れる
- Muted画面では「Inboxへ戻す（復帰）」ができる

**運用推奨**: 週1回Mutedを確認し、重要だけ拾う

## Smart Triage（低優先候補の自動提示）（Step 14）

Smart Triageは、低優先候補のメールを自動的に識別し、一括でミュートできる機能です。

**特徴**:
- 自動ラベル付け（勝手にミュート）はしない
- 候補メールに「低優先候補」バッジを表示
- トップバーに「候補を一括で低優先へ」ボタンを表示（候補がある時のみ）
- 確認ダイアログ付きで一括ミュート実行
- 実行後はUndo（10秒）とMuted画面での復帰が可能

**ルール編集**:
- ルール定義は `lib/triageRules.ts` に集約されています
- 新しいルールを追加する場合は、`TRIAGE_RULES` 配列に `TriageRule` オブジェクトを追加してください
- 重要キーワード（「重要」「至急」「問い合わせ」等）が含まれる場合は自動的に候補から除外されます

**運用推奨**:
- まず候補一括で処理し、その後Mutedを週次で見直す
- ルールは運用で調整していく（最初から完璧にしない）

## 監視とヘルスチェック

### Health Check

```bash
curl https://mailhub.vercel.app/api/health
```

**レスポンス例**:
```json
{
  "status": "ok",
  "nodeEnv": "production",
  "testMode": false,
  "timestamp": "2025-01-02T00:00:00.000Z"
}
```

### バージョン確認

**UI上**: サイドバー下部にバージョンが表示されます（例: `vmain-abc1234`）

**API**:
```bash
curl https://mailhub.vercel.app/api/version
```

**レスポンス例**:
```json
{
  "version": "main-abc1234",
  "commitSha": "abc1234567890abcdef",
  "ref": "main",
  "packageVersion": "0.1.0"
}
```

## デプロイとロールバック

### デプロイ手順

1. コードをコミット・プッシュ
   ```bash
   git add .
   git commit -m "feat: 機能追加"
   git push origin main
   ```

2. GitHub Actionsで自動デプロイ
   - `main`ブランチにpushすると、自動的に`qa:strict`が実行される
   - すべてPASSすると、Vercelに自動デプロイされる

### ロールバック手順

**Vercelでのロールバック**:
1. Vercelダッシュボードにログイン
2. プロジェクトを選択
3. 「Deployments」タブを開く
4. ロールバックしたいデプロイメントを選択
5. 「...」メニューから「Promote to Production」を選択

詳細は [OPS_RUNBOOK.md](./OPS_RUNBOOK.md) を参照してください。

## メモ

- `next-auth` は **v5 beta を固定**しています（勝手に上げないでください）
- `Open in Gmail ↗` は、各ユーザーが **共有受信箱（`GOOGLE_SHARED_INBOX_EMAIL`）をGmail上で参照できる権限（委任など）** を持っていることが前提です。無い場合はログインや権限付与を求められる可能性があります。
- 運用の詳細は [OPS_RUNBOOK.md](./OPS_RUNBOOK.md) を参照してください。


