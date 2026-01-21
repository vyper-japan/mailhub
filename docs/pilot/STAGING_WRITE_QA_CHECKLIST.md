# Step29 Staging Ops Drill（段階解禁 + 運用チューニング + 証跡）

このチェックリストは、staging環境で **READ ONLY → WRITE（adminのみ）→ READ ONLY** を事故なく完走できることを、証跡付きで確認するためのものです。

## ✅ Done（合格条件）
- [ ] stagingで READ ONLY → WRITE（adminのみ）→ READ ONLY に戻す、の一連が事故なく完走
- [ ] WRITEでやる操作は **1件だけ**（Done / Mute / Assign のどれか1つ）
- [ ] その1件が **Gmail側に反映された証跡**（スクショ or Activity CSV）を残す
- [ ] Auto Rules は **Preview(dryRun)→Apply** の導線が運用できる形になっている（stagingでは原則READ ONLYでPreview中心）
- [ ] SLA Alerts は staging では **dryRun常用**、ノイズが多い場合の調整方針がRunbookに反映

---

## 0) 事前確認（必須）

### stagingの安全状態（READ ONLY）
- [ ] `MAILHUB_ENV=staging`
- [ ] `MAILHUB_READ_ONLY` が **未設定でも readOnly=true**（安全側に倒れる）
- [ ] `MAILHUB_ADMINS` が2〜3名で設定済み
- [ ] `MAILHUB_CONFIG_STORE=sheets`（推奨）
- [ ] `MAILHUB_ACTIVITY_STORE=sheets`（推奨）

### Healthで確認（まずこれ）
ブラウザで：
- `https://<STAGING_URL>/api/mailhub/config/health`

確認するキー：
- [ ] `env: "staging"`
- [ ] `readOnly: true`
- [ ] `configStore.resolved: "sheets"`（推奨）
- [ ] `activityStore.resolved: "sheets"`（推奨）

証跡（任意だが推奨）：
- [ ] `docs/pilot/staging/health-staging-YYYYMMDD.json`

---

## 1) 段階解禁：WRITE 1件だけできる状態にする（adminのみ）

### 手順
1. staging の環境変数で **一時的に `MAILHUB_READ_ONLY=0`** にする（Vercelの場合はstaging環境変数を更新→再デプロイ）
2. **adminだけでログイン**（一般ユーザーは触らない）
3. TopHeaderで必ず確認：
   - [ ] **STAGINGバッジ**が見えている
   - [ ] **READ ONLYバッジが消えている**（= write状態）

証跡（meta）：
- [ ] `docs/pilot/staging/mailhub-meta-topbar-admin-write.png`（STAGINGが見える + READ ONLYが消えている）

---

## 2) WRITEで「1件だけ」操作する（最重要）

### 対象メッセージのmessageId取得
- MailHubのURLパラメータ `?id=<messageId>` からコピー（または DevTools > Network の `/api/mailhub/detail?id=...`）

記入：
- messageId: `________________________`

### 操作（どれか1つだけ）
以下から **1つだけ**選び、1回だけ実行：
- [ ] Assign（おすすめ）
- [ ] Waiting
- [ ] Done
- [ ] Mute
- [ ] Label（MailHub/Label/*）

action（ファイル名用）：
- action: `assign | waiting | done | mute | label-add`

---

## 3) 証跡を残す（Step27互換）

### スクショ（推奨：Gmail + MailHub）
- [ ] Gmail側：`docs/pilot/staging/gmail-<messageId>-<action>.png`
- [ ] MailHub側：`docs/pilot/staging/mailhub-<messageId>-<action>.png`

### Activity CSV（代替または追加）
Activity Drawer → Export（CSV）で保存：
- [ ] `docs/pilot/staging/activity-<date>-staging.csv`

---

## 4) staging を READ ONLY に戻す（必須）

### 手順
1. `MAILHUB_READ_ONLY` を **削除**（未設定に戻す）または `MAILHUB_READ_ONLY=1` に戻す
2. Healthで確認：
   - [ ] `readOnly: true`
3. TopHeaderで確認：
   - [ ] **READ ONLYバッジが復活**している

証跡（meta）：
- [ ] `docs/pilot/staging/mailhub-meta-topbar-admin-readonly.png`

---

## 5) Auto Rules / SLA Alerts（運用チューニング観点）

### Auto Rules
- [ ] Preview（dryRun）で対象件数/サンプルを確認できる
- [ ] stagingでは原則READ ONLY運用（Applyは段階解禁時のみ、必要最小限）

### SLA Alerts（stagingはdryRun常用）
- [ ] stagingでは `dryRun=1` を常用する（ノイズ調整のため）
- [ ] ノイズが多い場合の方針（Runbookに従う）：
  - 閾値/対象範囲（scope）を絞る
  - Slack/Webhookは staging/prod で分離

---

## 🧾 実施結果（ここを埋めれば第三者レビュー可能）

### 実施サマリ
- Date:
- Staging URL:
- Admin user:
- 操作（1件だけ）: assign
- messageId:

### 証跡ファイル（保存した実ファイル名を記入）
- Gmail側スクショ: `docs/pilot/staging/gmail-<messageId>-assign.png`
- MailHub側スクショ: `docs/pilot/staging/mailhub-<messageId>-assign.png`
- Activity CSV: `docs/pilot/staging/activity-<date>-staging.csv`
- meta（任意）:
  - `docs/pilot/staging/mailhub-meta-topbar-admin-write.png`
  - `docs/pilot/staging/mailhub-meta-topbar-admin-readonly.png`



