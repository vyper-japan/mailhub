# Step28 Staging 手動QAチェックリスト

このチェックリストは、Step28（Staging Ops）の実装が正しく動作していることを「第三者が見て納得できる」形で確認するためのものです。

## 📋 事前準備（stagingで必須）

### 環境変数設定
- [ ] **staging用URL**（社内から/外からアクセスできる）
- [ ] **staging の env**:
  - `MAILHUB_ENV=staging`
  - `MAILHUB_READ_ONLY` は **未設定でも READ ONLY になる**（今回の実装により）
  - `MAILHUB_ADMINS`（あなた + 代替の2〜3名）
  - `MAILHUB_CONFIG_STORE` / `MAILHUB_ACTIVITY_STORE`（推奨は `sheets`）
- [ ] **Google OAuth の Redirect URI**（staging URL）を追加済み
- [ ] （SLA/alerts を staging で回すなら）staging 用 secret / webhook を分離

### 確認方法
```bash
# staging環境で以下を確認
curl -s https://<STAGING_URL>/api/mailhub/config/health | jq '.env, .readOnly, .storeType, .activityStoreType'
# 期待値: "staging", true, "sheets" (or "file"), "sheets" (or "file")
```

---

## ✅ 手動QA 1：一般ユーザー（非admin）での確認

**目的**: 誤操作や設定変更ができないことを保証

### 確認項目
- [ ] ログインできる（`@vtj.co.jp`のみ）
- [ ] **TopHeader に STAGINGバッジ** が出ている
- [ ] **TopHeader に READ ONLYバッジ** が出ている
- [ ] 一覧・プレビュー・検索ができる
- [ ] **変更系が全部無効**（UIのdisable + 理由表示）
  - [ ] Done / Waiting / Mute / Assign / Label / Bulk 全部
- [ ] **Settings（歯車）が非表示**（UI二重化が効いている）

### 証跡（スクショ）
以下のファイル名で `docs/pilot/staging/` に保存してください：

- [ ] `docs/pilot/staging/mailhub-meta-topbar-nonadmin.png`（STAGING/READ ONLYが見える）
- [ ] `docs/pilot/staging/mailhub-meta-disabled-actions-nonadmin.png`（操作無効が見える）

### 確認コマンド（API側の拒否も確認）
```bash
# 一般ユーザーでログインした状態で
curl -H "Cookie: <SESSION_COOKIE>" \
  https://<STAGING_URL>/api/mailhub/archive \
  -X POST -H "Content-Type: application/json" \
  -d '{"id":"test","action":"archive"}'
# 期待値: 403 {"error":"read_only","message":"READ ONLYのため実行できません"}
```

---

## ✅ 手動QA 2：adminユーザーでの確認（READ ONLYのまま）

**目的**: adminでも READ ONLY では変更できない（サーバ403）を保証

### 確認項目
- [ ] adminでログイン
- [ ] **歯車が表示される**
- [ ] **Settings Drawer のフッター**に以下が出ている：
  - [ ] `env=staging`
  - [ ] `readOnly=true`
  - [ ] `configStoreType` / `activityStoreType`（resolved含む）
  - [ ] `writeGuards` 的な情報が見える
- [ ] **Labels / Auto Rules の作成・Apply・Import** が read onlyで不可（UI上も明示）
- [ ] ブラウザの操作で「実行」はできない（押せない/押しても失敗）
- [ ] もし押下でAPIが飛ぶ導線が残っていても **403で拒否される**（事故防止）

### 証跡（スクショ）
以下のファイル名で `docs/pilot/staging/` に保存してください：

- [ ] `docs/pilot/staging/mailhub-meta-settings-health-admin.png`（healthの内容が分かる）
- [ ] `docs/pilot/staging/mailhub-meta-readonly-block-admin.png`（操作不可が分かる）

### 確認コマンド（API側の拒否も確認）
```bash
# adminユーザーでログインした状態で（READ ONLYのまま）
curl -H "Cookie: <SESSION_COOKIE>" \
  https://<STAGING_URL>/api/mailhub/labels \
  -X POST -H "Content-Type: application/json" \
  -d '{"labelName":"MailHub/Label/Test","displayName":"Test"}'
# 期待値: 403 {"error":"read_only","message":"READ ONLYのため実行できません"}
```

---

## ✅ 手動QA 3：Sheets永続化が効いているか（staging）

**目的**: stagingが "どこからアクセスしても同じ設定" になっていることを確認

**注意**: READ ONLY だと「作成できない」ので、確認方法を2パターンに分けます。

### A) 既にlabels/rulesが入っている前提の確認

- [ ] Settingsで `labelsCount` / `rulesCount` が期待値
- [ ] Activity Drawer でログが取れている
- [ ] CSV Export で落とせる

### B) READ ONLY解除を一瞬だけやる確認（次の"段階解禁"の予行演習）

**注意**: 解除は「Step29」でやります（後述）。Step28の完了としては、まずAでOK。

---

## 📝 証跡ファイル命名規約

`docs/pilot/staging/` 配下に以下の命名規約で保存してください：

### スクリーンショット
- `mailhub-meta-<feature>.png`（Step28: メッセージ非依存の証跡）
  - 例: `mailhub-meta-topbar-nonadmin.png`
  - 例: `mailhub-meta-settings-health-admin.png`

### Activity CSV Export（必要時のみ）
- `activity-<date>-staging.csv`
  - 例: `activity-20260107-staging.csv`

### Health API レスポンス（必要時のみ）
- `health-staging-YYYYMMDD.json`
  - 例: `health-staging-20260107.json`

**詳細**: 命名規約の全体像は `NAMING.md` を参照してください。

---

## ✅ 完了判定

Step28の手動QA完了条件：

- [ ] **QA 1（一般ユーザー）**: 全ての確認項目がPASS、証跡ファイル2件が保存済み
- [ ] **QA 2（adminユーザー）**: 全ての確認項目がPASS、証跡ファイル2件が保存済み
- [ ] **QA 3（Sheets永続化）**: Aパターンで確認完了（またはBパターンで予行演習完了）

---

## 📌 次のステップ（Step29）

Step28完了後、Step29では以下を実施します：

1. **READ ONLY解除**（`MAILHUB_READ_ONLY=0`）の予行演習
2. **1件だけ**操作（Done/Mute/Assign/ラベル付与）の確認
3. **Gmail側でのラベル反映確認**（証跡: スクショ）
4. **Activityログの永続化確認**（Sheets側で確認）

Step29の詳細は別途 `STAGING_WRITE_QA_CHECKLIST.md` を参照してください。

