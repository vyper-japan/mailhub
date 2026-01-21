# MailHub 運用Runbook

MailHubの日常運用とトラブルシューティングの手順書です。

## 📋 目次

1. [オンボーディング](#オンボーディング)
2. [基本操作](#基本操作)
3. [環境設定](#環境設定)
4. [ログインと権限](#ログインと権限)
5. [返信の原則](#返信の原則)
6. [トラブルシューティング](#トラブルシューティング)
7. [デプロイとロールバック](#デプロイとロールバック)

---

## オンボーディング

### 初回ログイン時のガイド

新規ユーザーが初めてMailHubにアクセスすると、**オンボーディングモーダル**が自動表示されます。

- **内容**（3分で理解できる内容）:
  - 画面構成（左ラベル/中央一覧/右詳細）
  - キーボードショートカット（↑↓/E/U/M/?）
  - 低優先（Muted）と復帰
  - 担当（Assign）と引き継ぎ

- **動作**:
  - 「始める」ボタンで閉じると、次回以降は表示されません（localStorageに保存）
  - いつでも **Helpボタン（?）→ Quick Start → 「ガイドを表示」** から再表示可能

### 新人研修での活用

1. 新人に MailHub を開いてもらう（初回ガイドが自動表示される）
2. ガイドの内容を一緒に確認（画面構成、ショートカット、操作フロー）
3. 実際に1通のメールを処理して「完了」まで体験させる
4. 困ったときは **?** ボタンからヘルプを開くよう案内

---

## 基本操作

### 自動同期（フォーカス復帰時）

タブに戻る/フォーカス復帰時に、**一覧 + 件数 + Activity** の軽い同期が自動で走ります。
1分に1回までに制限され、入力中（検索/テキストエリア）には同期しません。

### 検索（Gmail検索式でサーバ検索）

トップバーの検索ボックスで、Gmailの検索式を使ってサーバ側で検索できます。

- **検索式の例**:
  - `subject:(メンテナンス)` - 件名に「メンテナンス」を含む
  - `from:rakuten.co.jp` - 送信元がrakuten.co.jp
  - `from:rakuten subject:(メンテナンス) newer_than:7d` - 複合条件（rakutenから、件名に「メンテナンス」を含み、7日以内）
- **使い方**:
  - 検索ボックスに検索式を入力して **Enter** で確定
  - 検索中は「検索中: [query]」チップが表示され、クリックで解除
  - **Esc** キーで検索をクリア
- **特徴**:
  - 検索状態でも操作（Done/Mute/Waiting/Assign/Label/Undo）が継続できる
  - 検索クエリはURLに保持され、共有・再読み込みで同じ結果に戻れる
  - 現在選択中のラベル（Channels/Status/Assignee）に対して検索が実行される

**運用推奨**:
- 目的のメールに素早く辿り着くために、検索を活用する
- よく使う検索式はViewsとして保存すると便利（Settings → Viewsタブ）
- よく使う検索はQueuesとして保存するとワンクリックで呼べる（Settings → Queuesタブ）

### Work Queues（作業キュー）

よく使う検索を保存してワンクリックで呼べるようにします。

- **使い方**: トップバーの **Queues** ボタンをクリックして保存済みキュー一覧を表示し、キューをクリックすると即座に検索が適用されます
- **管理**: Settings → **Queues** タブで管理（adminのみ作成/編集/削除、非adminは閲覧のみ）
- **運用例**:
  - 楽天お知らせ: `from:rakuten.co.jp subject:(お知らせ OR メンテナンス)`
  - SLA危険: `newer_than:3d -label:MailHub/Done -label:MailHub/Muted`
  - 未割当の長期滞留: `label:MailHub/Unassigned older_than:7d`

**運用推奨**:
- よく使う検索式はQueuesとして保存して、作業効率を上げる
- 編集は管理者のみ（非adminは閲覧のみ、READ ONLY時は編集不可）

### Reply Launcher（返信導線の最短化）

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
- RMS base URL設定手順: `MAILHUB_RAKUTEN_RMS_BASE_URL=https://rms.rakuten.co.jp` を環境変数に設定

### ショートカットキー

| キー | 動作 |
|------|------|
| `↑` / `↓` | メール一覧で上下移動 |
| `E` | 完了（Archive） |
| `W` | 保留（Waiting） |
| `M` | 低優先へ（ミュート） |
| `A` | 担当トグル（Assign/Unassign） |
| `C` | 対応中（Claim） |
| `U` | 元に戻す（Undo） |
| `S` | SLA Focus ON/OFF（危険メールのみ表示） |
| `Shift+S` | Critical-only切替（SLA ON時のみ有効） |
| `Cmd+K` / `Ctrl+K` | 検索ボックスにフォーカス |
| `T` | Templates Popoverを開く（input/textareaフォーカス中は無効） |
| `?` | ショートカットヘルプ表示 |
| `Esc` | ヘルプを閉じる / 検索をクリア |

### SLA Focus URL直リンク

SLA Focus状態をURLで共有できます：
- `/?sla=1` - SLA Focus ON（危険メールのみ表示）
- `/?sla=1&slaLevel=critical` - Critical-onlyモード（72h超えのみ）

### Auto Rules Runner（自動ラベリング定期実行）

有効化されたAuto Rulesを一括で実行できます。

- **使い方**: Settings → **Auto Rules** タブで **Run All (dryRun)** または **Run All (apply)** を実行
- **実行制限**: 最大200件（デフォルト100件）、1ルールあたり最大50件、並列3、タイムアウト6秒
- **安全ガード**:
  - productionでは `MAILHUB_RULES_SECRET` による認可が必要（第三者叩き防止）
  - READ ONLY時はApply禁止（dryRunのみOK）
  - apply時はadmin必須
- **冪等性**: 既に付与済みラベルはスキップ（重複付与を防止）
- **実行結果**: 候補件数、適用件数、失敗件数、truncated警告をモーダルで表示

**運用推奨**:
- まず staging で dryRun → 次に apply を一時解禁 → 証跡保存 → readOnly戻す
- truncatedが出たら「対象が多すぎ」＝クエリ見直し or maxTotal増加の判断
- GitHub Actionsで定期実行する場合は、最初はdryRun常用が安全

### Settings（ラベル/自動ルール）

ヘッダーの歯車（Settings）から右Drawerを開き、ラベルと自動ルールを管理できます。

- **Labels（ラベル）**
  - MailHub管理ラベルは `MailHub/Label/*` 配下のみ（誤爆防止）
  - **表示名の変更**はMailHub内のみ（Gmailラベル名は変更しない）
  - **削除（登録解除）**はconfirm必須（Gmail側のラベル自体は消さない）
- **Auto Rules（自動付与）**
  - まず **Preview（dryRun）** で対象件数/サンプルを確認してから **Apply now** を実行する
  - `fromDomain` は誤爆しやすいので、`gmail.com` 等の広いドメインは強警告が出たら基本は作らない
  - 自動付与は **addのみ**（removeはしない）

#### Auto Assign Rules（未割当の自動ルーティング）

- **目的**: 「未割当」を"人が見る前"に減らす（ただし事故防止優先）
- **場所**: Settings → **Auto Assign** タブ（独立タブ）
- **編集**: adminのみ（非adminは閲覧のみ）
- **運用**: Preview→Applyの2段階（まずstagingで）
  - 新ルールは必ず **Preview**（dryRun）で件数/サンプルを確認
  - 警告（広すぎドメイン / 件数>200）が出たら基本はルールを絞る
  - 問題ない場合のみ **Apply now**（最大50件）を実行
- **安全設計（重要）**
  - 適用対象は **Unassignedのみ**（既担当はスキップ）
  - **takeover（強制引き継ぎ）を自動ルールではしない**
  - Waiting/Done/Muted を付けても担当は維持される（担当ラベルは別系統）
- **READ ONLY時**
  - Preview（dryRun）は実行可能（閲覧・確認のみ）
  - Apply now は403（UIでも無効化＋理由表示）

**運用推奨**:
- 新ルールは必ずPreviewを通し、サンプル20件の送信元/件名を確認してからApplyする
- まずstagingでPreview→Applyを実行し、問題なければ本番に適用する
- 週次で「Muted（低優先）」を見直し、重要が混ざっていないか確認する

#### Rule Inspector（ルール診断・説明）

- **Explain（説明）**: メール詳細ペインの「説明」ボタンで、そのメールに適用されるルールを確認できます
  - マッチしたラベルルールとAssigneeルールのID、マッチ理由、適用結果を表示
  - adminユーザーはルールの設定画面へのリンクも表示されます
  - READ ONLYでも利用可能（説明のみ、副作用なし）
- **Diagnostics（診断）**: Settings → **Diagnostics** タブで、ルール全体の診断結果を確認できます
  - **衝突検知**: 同じ条件で異なる結果を返すルールの組み合わせを検出（例: 同じfromEmailで異なるラベルを付与する2つのルール）
  - **危険ルール検知**: 広すぎるドメイン（gmail.com等）やPreview件数が多すぎるルールを警告
  - **無効ルール検知**: 有効だがサンプル中にマッチしないルールを検出（削除候補）
  - **ヒット統計**: 各ルールのサンプル50件中のヒット数と上位5件のサンプルを表示
  - 非管理者も閲覧可能（診断は副作用ゼロ、READ ONLYでも実行可）

**運用推奨**:
- 新ルール追加後は、Diagnosticsタブで衝突や危険ルールがないか確認する
- 週次でDiagnosticsを確認し、無効ルールを削除して設定をクリーンに保つ
- 「説明」ボタンで予期しないルールが適用されていないか確認する

#### Rule Suggestions（ルール提案）

- **提案エンジン**: Activityログから自動的にルール候補を生成
  - Auto Mute提案: 複数人が繰り返し「低優先へ（ミュート）」を実行している送信元
  - Auto Assign提案: 特定の送信元に対して、特定担当への割り当てが繰り返されている場合
  - 閾値: デフォルト14日間、最小3アクション、最小2アクター（1人の好みをルール化しない）
- **UI**: Settings → **Suggestions** タブ
  - 提案カードには理由、根拠件数、関与したactor数が表示される
  - **Preview**ボタンで既存のdryRun導線に接続して対象件数を確認
  - adminのみ**採用して作成**ボタンでルールを作成（危険提案は強警告＋confirm必須）
  - READ ONLYでも閲覧・Previewは可能（採用はadmin必須）

**週次運用フロー**:
1. Settings → **Suggestions** タブを開く
2. 提案を確認（理由・根拠件数・関与actor数を確認）
3. **Preview**で対象件数を確認（誤爆の可能性をチェック）
4. 危険/衝突は**Diagnostics**タブで確認
5. adminが問題なければ**採用して作成**
6. 1週間後に**Diagnostics**タブで「無効ルール」を棚卸し（削除候補を確認）

#### Rule Ops（ルール運用・可視化・停止・監査）

- **ルールの有効/停止**: Settings → **Auto Rules** タブで、各ルールの **ON/OFF** チェックボックスで有効/停止を切り替えられます
  - `enabled=false` のルールは **Apply now** が無効化されます（Previewは引き続き実行可能）
  - 事故時の緊急停止として「**全ルール一時停止**」ボタンも用意されています（adminのみ）
- **ルール統計**: Settings → **Auto Rules** タブで、各ルールの統計情報が表示されます
  - **最終適用日時**: 最後にApply nowが実行された日時
  - **適用件数**: 7日間/30日間の適用件数
  - **最終適用サマリ**: 処理件数、マッチ件数、適用件数、スキップ件数、失敗件数
- **Activityで見る**: 各ルールの「**Activityで見る**」リンクをクリックすると、Activity Drawerが開き、そのルールに関連するログがフィルタ表示されます
  - `ruleId` でフィルタされたログが表示されます
  - 実際のメール変更（label付与・assign等）にも `ruleId` が記録されているため、後追いの調査が効きます

**週次ルール棚卸しフロー**:
1. Settings → **Auto Rules** タブを開く
2. 各ルールの統計を確認（最終適用日時、適用件数）
3. **触りすぎ/危険なルール**を特定（適用件数が異常に多い、広すぎるドメイン等）
4. 必要に応じて **ON/OFF** で一時停止（Previewは残す）
5. **Preview**で縮める（粒度をfromEmailにする等）
6. 問題なければ **Apply now** で再適用
7. **Activityで見る**で追跡（ruleIdフィルタでログを確認）
8. **Diagnostics**タブで衝突や危険ルールがないか確認

### Internal Ops（社内メモ / 返信下書き / テンプレ）

メール詳細ペイン下部に、日々の運用を速くする導線があります。

- **社内メモ（共有）**
  - メールごとに共有メモを保存（最大4000文字、空文字は削除扱い）
  - READ ONLYでは編集不可（UI/ APIともに403）
  - Activityには `note_set` / `note_clear` のみ記録（**本文はログに出さない**）
- **返信下書き（個人）**
  - 端末ローカル（`localStorage`）に保存。Gmail/RMSへ貼り付けるための文面をここで作る
  - 「コピー」でクリップボードへコピー
  - 「テンプレ」で定型文を挿入
- **Templates（定型文）**
  - Settingsの **Templates** タブで管理（adminのみ編集、現場は利用のみ）
  - 返信下書きパネルの「テンプレ」ボタン（または`T`キー）でテンプレ一覧を開く
  - テンプレを選択すると、変数埋め後のプレビューが表示される
  - 「挿入」ボタンで下書きテキストエリアに挿入、「コピー」ボタンでクリップボードにコピー
  - **未解決プレースホルダ**（`{{inquiryId}}`など）が残っている場合は警告が表示される（事故防止）
  - 変数: `{{inquiryId}}`（楽天問い合わせ番号）、`{{fromEmail}}`（送信元）、`{{assignee}}`（担当者）、`{{today}}`（YYYY-MM-DD）など
  - READ ONLYでは作成/編集/削除不可

### Saved Views（保存ビュー）+ Command Palette

- 左サイドバーの **Views** から、よく使う絞り込みをワンクリックで切替できます。
- **Cmd/Ctrl+K** で Views のコマンドパレットを開き、検索して Enter で即切替できます。
- Views の追加/編集/削除/並び替えは、Settingsの **Views** タブ（adminのみ）から行います。

## Settings Hardening（永続化/権限/診断）

### Admin運用
- Settingsの編集（ラベル登録/ルール編集/Import/Preview/Apply）は **管理者のみ**。
- 環境変数 `MAILHUB_ADMINS`（CSV）で管理者メールを指定する。
- 非管理者が直接APIを叩いても `403 forbidden_admin_only` で拒否される（UIでも歯車非表示）。

### 永続化（Config Store）
- `MAILHUB_CONFIG_STORE=sheets`（推奨）で、ラベル/ルール設定をGoogle Sheetsに保存する。
  - Tabs: `ConfigLabels` / `ConfigRules`（必要なら `MAILHUB_SHEETS_TAB_LABELS` / `MAILHUB_SHEETS_TAB_RULES` で変更）
- ローカルは `MAILHUB_CONFIG_STORE=file` で `.mailhub/*.json` に保存する。

### Import from File（file→sheets移行）
管理者のみ、Settingsフッターから以下の手順で実行する：
1. **Import Preview** を押して差分（add/update件数）を確認
2. 問題なければ **Import Apply** を実行（confirmあり）
   - 既存Sheets側にしかない設定は削除せず残す（非破壊マージ）

### Config Backup（Export）
管理者のみ、Settingsフッターの **Config Export** から実行できる：
- `GET /api/mailhub/config/export`
  - **READ ONLYでもOK**（Exportは読み取りのみ/副作用ゼロ）
  - 返すもの: labels/rules + メタ（exportedAt/version/storeType）
  - **秘密情報は含めない**（refresh token/client secret/webhook/alerts secret/admin list等は入らない）

GitHub Actions等（セッション無し）で取得する場合は Bearer secret を使う：
- 環境変数: `MAILHUB_CONFIG_EXPORT_SECRET`
- 例（手動）:
  ```bash
  curl --fail --retry 3 --max-time 20 \
    -H "Authorization: Bearer $MAILHUB_CONFIG_EXPORT_SECRET" \
    "https://<YOUR_DOMAIN>/api/mailhub/config/export" \
    -o mailhub-config.json
  ```

### バックアップ→復旧の一本道

**前提**: 設定が壊れた/消えた/変更ミスした場合の復旧手順

#### 1. バックアップの取得

**方法A: UIから（管理者のみ）**
1. Settings Drawerを開く
2. フッターの「Export config (JSON)」をクリック
3. JSONファイルがダウンロードされる（最後のExport時刻がフッターに表示される）

**方法B: GitHub Actionsから（自動バックアップ）**
- `.github/workflows/mailhub-config-backup.yml` が毎日03:15 JSTに自動実行
- Artifact保存場所: GitHub Actions → Workflow runs → Artifacts
- Retention: 14日間

**方法C: curlで手動取得（Bearer secret使用）**
```bash
curl --fail --retry 3 --max-time 20 \
  -H "Authorization: Bearer $MAILHUB_CONFIG_EXPORT_SECRET" \
  "https://<YOUR_DOMAIN>/api/mailhub/config/export" \
  -o mailhub-config-production-$(date +%Y%m%d-%H%M%S).json
```

#### 2. 復旧（Import Preview→Apply）

1. **バックアップJSONファイルを用意**
   - GitHub ActionsのArtifactからダウンロード、または手元のバックアップファイル

2. **Settings Drawerを開く**
   - フッターに「Import Preview」と「Import Apply」ボタンが表示される（sheets使用時のみ）

3. **Import Previewを実行**
   - 「Import Preview」をクリック
   - 差分（add/update件数）を確認
   - 問題なければ次へ

4. **Import Applyを実行**
   - 「Import Apply」をクリック
   - Confirmダイアログで確認
   - 実行後、Activityに `config_import_apply` として記録される

**注意**:
- Importは**非破壊マージ**（既存Sheets側にしかない設定は削除せず残す）
- READ ONLY時はImport不可（UI上もdisable）

### Help / Diagnostics（問い合わせテンプレ）
ヘッダーの **Info（Diagnostics）** ボタンから診断Drawerを開ける：
- Health（`/api/mailhub/config/health`）
- Version（`/api/version`）

困ったら：
1. Diagnosticsを開く
2. **「まとめてコピー」** を押す
3. そのままSlack/チャットに貼る

（秘密情報は含めません）

チェックリスト（運用で迷わない用）:
- `docs/pilot/STEP31_OPS_CHECKLIST.md`

### 診断（切り分け）
- `GET /api/mailhub/config/health`
  - storeType（memory/file/sheets）
  - isAdmin / adminsConfigured
  - labelsCount / rulesCount
  - sheets疎通（timeout付き）
  
「Settingsが出ない/保存できない」場合は、まず `config/health` の `storeType` と `adminsConfigured` と `sheets.ok` を確認する。

## Real Inbox Pilot（実データ接続の手順）

### 推奨（staging inbox を用意）
1. staging用の shared inbox（別アカウント/別ラベル運用）を作る
2. 本番 inbox から **一部だけ転送**して検証（事故を局所化）
3. staging環境の `GOOGLE_SHARED_INBOX_*` をその inbox に向ける

### どうしても本番 inbox に繋ぐ場合（一本道）
1. **まず READ ONLY で起動**（必須）
   - `MAILHUB_READ_ONLY=1`
   - `GET /api/mailhub/config/health` で `readOnly=true` / inboxマスク / admin状態を確認
2. UIで確認（書き込みは無効化される）
   - 一覧/詳細/検索
   - Labels/Rulesの閲覧、RulesのPreview（Applyは無効）
   - Activity/CSV/Alerts(dryRun)
3. OKなら **書き込み解禁（最小）**
   - `MAILHUB_READ_ONLY=0`
   - 1件だけ Done/Mute/Assign を実施し、Gmail側のラベル反映を確認（証跡: スクショ or Activityログ）

### 証跡（必須）
- 手動QAの結果は `PILOT_REPORT.md` に記録し、証跡ファイルは `docs/pilot/` に保存する。
- Activityの証跡が必要な場合：
  - MailHubの Activity Drawer を開く → **Export（CSV）** を実行
  - 保存したCSVを `docs/pilot/activity-YYYYMMDD.csv` として保管（ファイル名規約は任意だが日付を推奨）

### 注意（事故防止）
- READ ONLYは productionでも使える（初回移行・障害切り分けに有効）
- “Apply now” 系は admin必須 + confirm必須を維持する
- UIは補助。サーバ側403が本体（直接API叩きでも事故らない）

## Step28: Staging Ops（staging運用の一本道）

### 目的
- **どこでもアクセス**できる staging URL を用意し、READ ONLY で「閲覧/検索/Preview/Settings閲覧」だけを安全にできる状態にする
- 必要時のみ、管理者が **一時的にWRITE解禁**して最小の操作（1件）を行う

### staging推奨構成（テンプレ）
- `MAILHUB_ENV=staging`
- `MAILHUB_READ_ONLY=1`（デフォルト。事故ゼロ）
- `MAILHUB_CONFIG_STORE=sheets`（Settings: labels/rules を永続化）
- `MAILHUB_ACTIVITY_STORE=sheets`（操作ログを永続化）

※ `file` ストアはサーバレス環境で永続しません（再デプロイで消えます）。公開/検証環境は **sheets推奨**。

### 手動QA（stagingで必ずやる）
- 一般ユーザー:
  - ログイン → 一覧/詳細/検索/Preview/Settings閲覧ができる
  - 変更系操作は **UI上不可** かつ **APIは403**（READ ONLY/権限不足の理由が出る）
- adminユーザー:
  - READ ONLY時: adminでも変更不可（403）
  - WRITE解禁時のみ: Settings で labels/rules の作成/編集/Import ができる

### READ ONLY → WRITE（一時解禁）→ 緊急停止（一本道）
1. **通常運用（READ ONLY）**
   - `MAILHUB_READ_ONLY=1`
   - `GET /api/mailhub/config/health` で `readOnly=true` / `env=staging` / storeType を確認
2. **一時的にWRITE解禁（管理者のみ）**
   - `MAILHUB_READ_ONLY=0` に変更してデプロイ/再起動
   - **1件だけ** Assign/Waiting/Mute/Done/手動ラベル付与を実施し、証跡（スクショ/Activity）を残す
3. **緊急停止（即時）**
   - 何か違和感があれば **即座に `MAILHUB_READ_ONLY=1` に戻す**（全変更系APIが403になる）

---

## Step30: Production Rollout（READ ONLY公開→1件WRITE→READ ONLY復帰）

Productionは **最初に必ず READ ONLY** で公開し、問題が無いことを確認してから、管理者が短時間だけWRITE解禁して「1件だけ」操作します。

### 使うチェックリスト（一本道）
- `docs/pilot/PROD_WRITE_QA_CHECKLIST.md`

### 証跡の保存先（Production）
- `docs/pilot/prod/`
- 命名規約は `docs/pilot/NAMING.md`（Step30: Production環境用）に従う

### 重要（事故防止）
- 通常運用は **READ ONLY=1**（変更系APIはサーバ側403で強制拒否）
- WRITE解禁は **adminのみ・短時間・1件だけ**
- 違和感があれば即 **READ ONLYに戻す**（緊急停止）

### Import（file→sheets）運用（事故防止）
- 原則：staging/prod では Settingsデータは **sheets** に集約する
- 手順（管理者のみ）：
  1) **Import Preview**（差分を確認）  
  2) 問題なければ **Import Apply**（confirmあり）
- 仕様（非破壊マージ）：
  - file側にあるものは sheets 側に **追加/更新**する
  - sheets 側にしかない設定は **削除しない**（残る）
- ログ：
  - Preview/Apply は Activity に `config_import_preview` / `config_import_apply` として残す（messageId=meta）

### Alerts（定期実行はdryRunから）
- stagingではまず **dryRun=1** をデフォルトにしてノイズを調整する
- `MAILHUB_ALERTS_SECRET` は staging/prod で別に管理（Secrets分離）

#### ノイズが多い場合の調整方針（staging）
- **原則**: stagingは「通知を当てる」のではなく「検出ロジックを育てる」環境。まず dryRun でログ/サンプルを見て調整する。
- **調整の順番**:
  1) **scope を絞る**（まずは `scope=all` を避け、必要な範囲に限定）
  2) **閾値（older_than など）を引き上げる**（誤検知/過検知を減らす）
  3) **重複抑制の確認**（同一条件で連打されていないか Activity の `sla_*` を確認）
  4) **Slack/Webhookの分離**（staging/prodで別チャンネル）

### チャンネルとステータス

**Channels（チャンネル）**
- **All**: 全メールを表示
- **StoreA/B/C**: 各ストアのメールのみ表示

**Status（ステータス）**
- **Todo（未対応）**: INBOXにあるメール
- **Waiting（保留）**: `MailHub/Waiting`ラベルが付いたメール
- **Done（完了）**: `MailHub/Done`ラベルが付いたメール
- **Muted（低優先）**: `MailHub/Muted`ラベルが付いたメール（退避済み）

**Assignee（担当者）**
- **Mine（自分担当）**: 自分が担当しているメールのみ表示
- **Unassigned（未割当）**: 担当者が割り当てられていないメールのみ表示
- **運用（Unassigned Zero）**: Unassignedの件数が0でない場合、左ナビ上で目立つ表示（⚠）になります。Unassignedビューで複数選択→「自分へ（Bulk Assign）」または「担当…（ユーザー選択）」で一括Assignし、未割当を常に0に近づけます。

**低優先（ミュート）について**:
- 「迷惑（Spam）」ではなく、「読む必要は低いが、たまに重要が混ざる」メールを安全に退避する機能
- 低優先は“消す”のではなく“退避して後から見返せる”ことが必須
- Gmail側では`MailHub/Muted`ラベルを使用（SPAM/TRASHは使わない）
- **運用推奨**: 週1回Mutedを確認し、重要だけ拾う

**Smart Triage（低優先候補の自動提示）**:
- 低優先候補のメールに「低優先候補」バッジが自動表示されます
- トップバーに「候補を一括で低優先へ」ボタンが表示されます（候補がある時のみ）
- 一括ミュートは確認ダイアログ付きで実行されます
- **運用推奨**: まず候補一括で処理し、その後Mutedを週次で見直す
- **ルール編集**: `lib/triageRules.ts`を編集してルールを追加・変更できます（自動処理はしない）

**Collaboration（担当者アサイン + 引き継ぎ）**:
- メールに担当者を割り当てることができます
- 担当状態はGmailラベル（`MailHub/Assignee/<slug>`）で共有されます
- 1通のメールに担当者ラベルは必ず1つだけ（複数割当を防ぐ）
- 引き継ぎ時は確認ダイアログが表示されます（事故防止）
- **運用推奨**: 未割当→担当→Done/Waiting/Mutedの流れで処理
- **ショートカット**: `A`で担当トグル（未割当→自分担当、自分担当→解除）

**Bulk Actions（一括操作）**:
- 一覧の各行の左側にあるチェックボックスをクリックして複数選択
- 選択中の行は薄くハイライト表示されます
- 選択中はトップバーに一括アクションボタンが表示されます：
  - **Done**: 選択したメールを一括で完了（Archive）
  - **Mute**: 選択したメールを一括で低優先へ（Muted）
  - **Waiting**: 選択したメールを一括で保留へ
  - **Assign**: 選択したメールを一括で自分担当へ
  - **Clear**: 選択を解除
- 一括操作後、Undoボタンで直近の一括操作を取り消せます
- 3並列で処理されるため、大量のメールでも高速に処理されます

**Activity（操作ログ）**:
- トップバーの「Activity」ボタンで操作ログを確認できます
- **永続化**: Google Sheetsが推奨（再起動で消えない、事故調査に耐える）
  - 設定しない場合: メモリリングバッファ（直近200件、再起動で消える）
- **フィルタ**: Mine（自分の操作のみ）/ All（全員の操作）
- **アクション**: Archive/Mute/Assign/Waiting等で絞り込み可能
- **経過時間バッジ**: メール一覧とActivityパネルに表示
  - 24h超え（Todo）: 黄色警告
  - 72h超え（Todo）: 赤エラー
  - 48h超え（Waiting）: 黄色警告
  - 7日超え（Waiting）: 赤エラー
- **ログ行クリック**: 該当メッセージにジャンプ
- **CSVエクスポート**: Activity Drawerの「CSV Export」ボタンで、操作ログをCSV形式でダウンロードできます（必要時のみ使用）
- **困った時の確認先**: Activity → 誰が処理したかを確認

**SLA Alerts（放置防止通知）**:
- **通知チャネル**: Slack webhook（推奨）または無効化
- **設定**: `MAILHUB_ALERTS_PROVIDER=slack` + `MAILHUB_SLACK_WEBHOOK_URL` + `MAILHUB_ALERTS_SECRET`（本番必須）
- **実行**: GitHub Actionsで毎15分自動実行（`.github/workflows/mailhub-alerts.yml`）
- **認可**: production環境では`Authorization: Bearer <MAILHUB_ALERTS_SECRET>`ヘッダが必須
- **定期実行例（手動実行時）**:
  ```bash
  # dryRunで確認
  curl -H "Authorization: Bearer $MAILHUB_ALERTS_SECRET" \
    "https://<YOUR_DOMAIN>/api/mailhub/alerts/run?dryRun=1&scope=all"
  
  # 本番実行
  curl -H "Authorization: Bearer $MAILHUB_ALERTS_SECRET" \
    "https://<YOUR_DOMAIN>/api/mailhub/alerts/run?scope=all"
  ```
- **重複防止**: 同一メール/同一閾値で24時間以内は再通知しない（Activityログで判定）
- **漏れゼロ**: Gmail検索クエリでページング対応（最大10ページ、1500件まで）
- **上限到達検知**: `truncated: true`が返された場合は取りこぼしの可能性あり（Slack通知にも警告が含まれる）
- **アラートが来た時の運用**:
  ① **MailHubで確認**: SLA warn/critical相当の一覧を見る（検索クエリ例: `label:inbox older_than:1d`）
  ② **担当者Assign**: 未割当の場合は担当者を割り当て
  ③ **Waiting/Done**: 期限確認が必要な場合はWaiting、完了したらDone
  ④ **誤検知/大量時の逃げ**: 低優先度の場合はMutedやTriageで一括処理
- **誤通知時の確認手順**: Activity export CSVで `sla_*` アクションを確認
- **止め方**: `MAILHUB_ALERTS_PROVIDER=none` を設定

### メール操作の流れ

1. **メールを選択**: 一覧からクリック、または`↑`/`↓`で移動
2. **内容を確認**: 右ペインに詳細が表示される
3. **アクション実行**:
   - `E`: 完了（Archive）
   - `W`: 保留（Waiting）
   - `C`: 対応中（Claim）
4. **必要に応じてUndo**: `U`で直前の操作を取り消し

### 会話ビュー（Conversation / Thread）

- **背景確認**: 右ペインの `Conversation（N）` で同一スレッド内のメールを時系列で確認できます（メタ情報＋snippetで高速）。
- **本文の確認（lazy）**: `Expand` を押したメッセージだけ本文（text/plain）をその場で読み込みます（重くしない設計）。
- **会話をまとめて処理**: `Select this conversation` を押すと、その会話（thread）の messageIds が一括選択に追加され、既存の一括アクション（Done/Mute/Waiting/Assign/Label…）をそのまま適用できます。

#### Thread Actions（会話単位で一撃処理）

- **Thread Actionsバー**: Conversationヘッダー上部に `Thread: N messages` とアクションボタンが表示されます。
  - **Thread Done / Waiting / Mute / Assign Me / Label…**: 会話内の全メールに対して一括処理を実行します。
  - **Thread Select**: 会話内の全メールを選択状態にします（既存の一括アクションに接続）。
  - **Clear Selection**: 選択状態をクリアします。
- **状態サマリ**: Thread Actionsバー下部に、会話内の状態サマリが表示されます。
  - Status: `Todo x / Waiting y / Done z / Muted w`（0件のものは非表示）
  - Assigned: `mine a / others b / unassigned c`（0件のものは非表示）
- **安全設計**: Thread Actionsは既存のBulk処理エンジンを再利用するため、以下の機能が自動的に効きます：
  - 進捗表示（x/y件処理中）
  - 部分失敗モーダル（失敗分だけ再実行可能）
  - Undo（10秒以内に元に戻せる）
  - READ ONLY制御（READ ONLY時は全ボタンが無効化）
  - テストモード対応
- **運用推奨**:
  - 会話で背景確認 → Thread Actionでまとめて処理 → Undo/Retry の流れ
  - Thread ActionはBulkと同じ挙動（進捗/部分失敗/Undoあり）なので、事故防止のため「1件ずつ確認してから実行」を推奨

---

## 環境設定

### Staging環境

**URL**: `https://mailhub-staging.vercel.app`（例）

**環境変数設定（Vercel）**:
```
NEXTAUTH_URL=https://mailhub-staging.vercel.app
NEXTAUTH_SECRET=<staging用のシークレット>
NEXTAUTH_TRUST_HOST=true
GOOGLE_CLIENT_ID=<staging用>
GOOGLE_CLIENT_SECRET=<staging用>
GOOGLE_SHARED_INBOX_EMAIL=inbox@vtj.co.jp
GOOGLE_SHARED_INBOX_REFRESH_TOKEN=<staging用>
MAILHUB_TEST_MODE=0  # または未設定（本番ガードで無効化される）
```

**Google OAuth Redirect URI**:
```
https://mailhub-staging.vercel.app/api/auth/callback/google
```

### Production環境

**URL**: `https://mailhub.vercel.app`（例）

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
   - 設定しても動作しない（ガード機能）

3. **環境変数の確認**
   - Vercelのダッシュボードで各環境の変数を確認
   - `.env.local`はローカル開発用（Gitにコミットしない）

---

## ログインと権限

### ログイン方法

1. MailHubにアクセス
2. 「Sign in with Google」をクリック
3. **`@vtj.co.jp`ドメインのアカウント**でログイン
   - 他のドメインではログインできない（制限あり）

### 権限について

**共有受信箱へのアクセス**
- MailHubは`GOOGLE_SHARED_INBOX_EMAIL`で指定された共有受信箱を参照します
- 各ユーザーは、**Gmail上でこの共有受信箱を参照できる権限（委任など）**を持っている必要があります
- 権限がない場合、「Open in Gmail ↗」をクリックした際にログインや権限付与を求められる可能性があります

**権限の確認方法**
1. Gmailで共有受信箱にアクセスできるか確認
2. できない場合は、Google Workspace管理者に委任権限の付与を依頼

---

## 返信の原則

### Reply Templates（定型文 + 変数埋め）

- **基本フロー**: 「テンプレ」ボタン（または`T`キー）→ テンプレ選択 → プレビュー確認 → 挿入/コピー → Gmail/RMSへ貼り付け
- **変数埋め**: テンプレ本文内の`{{inquiryId}}`、`{{fromEmail}}`、`{{assignee}}`、`{{today}}`などが自動的に置換される
- **未解決プレースホルダ警告**: 変数が埋められない場合は警告が表示される（例: `{{inquiryId}} が未解決です`）
  - **重要**: 未解決プレースホルダが残っている場合は、そのまま送信しない（事故防止）
- **運用推奨**: 返信は「Templates → Insert/Copy → Gmail/RMSへ貼る」が基本。送信そのものは自動化せず、まずは事故らない支援（挿入/コピー/不足チェック）に徹する

## 返信の原則（旧）

### 楽天RMSからのメール

**判定条件**:
- StoreA/B/Cチャンネルで表示されている
- 件名や本文に「楽天」「RMS」「R-Messe」などのキーワードが含まれている

**返信方法**:
1. メールを開くと、右ペイン下部に「楽天RMS返信」パネルが表示される
2. 問い合わせ番号が自動入力される（本文から抽出）
3. 返信内容を入力
4. **送信（RMS）**ボタンをクリック
   - `RMS_*`環境変数が設定されている場合: MailHubから直接RMS API経由で返信を登録
   - 設定されていない場合: RMSのWebサイトへジャンプし、返信内容をクリップボードにコピー

**2段階認証について**:
- RMSの2段階認証は自動化しません
- ユーザーがブラウザでログインしている場合はそのまま利用できます

### 通常のメール

**返信方法**:
1. メールを開く
2. 右ペイン下部の「Reply」ボタンをクリック
3. Gmailの返信画面が新しいタブで開く
4. Gmail上で返信を完了

**フォワード**:
- 「Forward」ボタンでGmailのフォワード画面を開く

---

## トラブルシューティング

### 困った時の対処順序

1. **再読み込み**
   - `Cmd+R` / `Ctrl+R`でページを再読み込み
   - または、トップバーの更新ボタン（`R`キー）

2. **Allに戻す**
   - サイドバーの「All」チャンネルをクリック
   - 検索ボックスをクリア（`Esc`キー）

3. **キャッシュクリア**
   - ブラウザのキャッシュをクリア
   - または、シークレットモードで試す

4. **復旧手順**
   - ログアウトして再度ログイン
   - それでも解決しない場合は、管理者に連絡

### よくある問題

#### メールが表示されない

**確認事項**:
- チャンネルが正しく選択されているか（All/StoreA/B/C）
- ステータスが正しく選択されているか（Todo/Waiting/Done）
- 検索ボックスに文字が入っていないか

**対処**:
1. 「All」チャンネルに切り替え
2. 「Todo」ステータスに切り替え
3. 検索ボックスをクリア
4. 再読み込み

#### 「Open in Gmail ↗」が開けない

**原因**:
- 共有受信箱への権限がない
- Gmailのセッションが切れている

**対処**:
1. Gmailで直接共有受信箱にアクセスできるか確認
2. できない場合は、Google Workspace管理者に委任権限の付与を依頼
3. Gmailにログインしてから再度試す

#### 楽天RMS返信パネルが表示されない

**確認事項**:
- StoreA/B/Cチャンネルで表示されているか（Allチャンネルでは表示されない）
- メールが楽天RMSからのものか（件名や本文にキーワードが含まれているか）

**対処**:
1. StoreA/B/Cチャンネルに切り替え
2. 楽天RMSからのメールを選択
3. 右ペイン下部を確認

#### 検索がうまく動かない

**確認事項**:
- 全角/半角の違い（自動的に正規化されるが、念のため）
- 大文字/小文字の違い（自動的に無視される）

**対処**:
1. 検索ボックスをクリア（`Esc`キー）
2. 再度検索を試す
3. 別のキーワードで試す

### トラブル時の切り分け

1. **qa:strictが緑か確認**
   - GitHub Actionsで`qa:strict`がPASSしているか確認
   - 失敗している場合は、コードの問題の可能性

2. **Stagingで再現するか確認**
   - Staging環境で同じ問題が発生するか確認
   - 発生する場合は、環境設定の問題の可能性

3. **ローカルで再現するか確認**
   - ローカル環境で`MAILHUB_TEST_MODE=1 npm run dev`で再現するか確認
   - 再現する場合は、コードの問題の可能性

### 障害時テンプレ（問い合わせ時に必須）

**困ったら、以下の情報を必ず含めて報告してください**:

1. **Help/Diagnosticsをコピー**
   - ヘッダーのInfo（Diagnostics）ボタンをクリック
   - 「診断情報をコピー」をクリック
   - そのままSlack/チャットに貼り付け

2. **Activity CSVを添付**
   - Activity Drawerを開く
   - 「CSV Export」をクリック
   - ダウンロードしたCSVファイルを添付

3. **何をしたか（messageId + action）**
   - 操作したメールの `messageId`（GmailのURLから取得可能）
   - 実行した `action`（例: `assign`, `waiting`, `mute`, `done`, `label-add`）
   - 例: `messageId=18c4a9f3c2d1e7a3, action=assign`

4. **READ ONLYに切り替えたか**
   - 問題発生時に `MAILHUB_READ_ONLY=1` に切り替えたか
   - 切り替えた場合は、その時刻も記載

5. **証跡ファイル（可能なら）**
   - Gmail側スクショ: `docs/pilot/prod/gmail-<messageId>-<action>.png`
   - MailHub側スクショ: `docs/pilot/prod/mailhub-<messageId>-<action>.png`
   - または: `docs/pilot/prod/<messageId>_<action>_yyyymmdd-hhmm.png`（Step27互換形式）

**命名規約の詳細**: `docs/pilot/NAMING.md` を参照

4. **ブラウザのコンソールを確認**
   - ブラウザの開発者ツール（F12）でエラーを確認
   - エラーメッセージを記録して報告

---

## デプロイとロールバック

### デプロイ手順

1. **コードをコミット**
   ```bash
   git add .
   git commit -m "feat: 機能追加"
   git push origin main
   ```

2. **GitHub Actionsで自動デプロイ**
   - `main`ブランチにpushすると、自動的に`qa:strict`が実行される
   - すべてPASSすると、Vercelに自動デプロイされる

3. **デプロイ確認**
   - Vercelのダッシュボードでデプロイ状況を確認
   - Staging/Production環境それぞれで確認

### ロールバック手順

**Vercelでのロールバック**:

1. Vercelダッシュボードにログイン
2. プロジェクトを選択
3. 「Deployments」タブを開く
4. ロールバックしたいデプロイメントを選択
5. 「...」メニューから「Promote to Production」を選択
   - または、該当デプロイメントをクリックして「Promote」ボタンをクリック

**Gitでのロールバック**:

1. 問題のあるコミットを特定
2. 前のコミットに戻す
   ```bash
   git revert <問題のあるコミットハッシュ>
   git push origin main
   ```
3. 自動的に再デプロイされる

### バージョン確認

**UI上での確認**:
- サイドバー下部にバージョンが表示される（例: `vmain-abc1234`）
- クリックすると詳細情報が表示される

**APIでの確認**:
```bash
curl https://mailhub.vercel.app/api/version
```

**Health Check**:
```bash
curl https://mailhub.vercel.app/api/health
```

---

## 既知の制約

1. **RMS API未実装**
   - `RMS_*`環境変数が設定されていない場合、RMS返信はWebサイトへのジャンプとクリップボードコピーで対応
   - 今後、RMS APIの実装を予定

2. **検索の精度**
   - 全角/半角、大文字/小文字は自動的に正規化されるが、完全一致ではない場合がある

3. **メール件数の上限**
   - 一度に表示されるメールは最大20件（ページネーション未実装）

4. **Undoの制限**
   - Undoは直前の操作のみ（スタックは1件のみ）

---

## 緊急連絡先

問題が解決しない場合:
1. GitHubのIssuesに報告
2. チームチャットで連絡
3. 管理者に直接連絡

---

**最終更新**: 2025-01-02

