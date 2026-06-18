# Step30 Production Rollout（READ ONLY公開→1件WRITE→段階解禁→運用開始）

このチェックリストは、Production環境で **READ ONLY公開 →（短時間だけ）WRITE 1件 → READ ONLYに復帰** を事故なく完走し、第三者が証跡で判断できる状態にするためのものです。

---

## ✅ Done（合格条件）
- [ ] Production が **READ ONLY** で社内公開できる（ログイン・閲覧・検索・フィルタ・Activity閲覧・CSV ExportがOK）
- [ ] 変更系（Archive/Mute/Waiting/Assign/Rules Apply/Import 等）が **UIでもAPIでも確実に拒否（403）**
- [ ] adminのみ、短時間だけ **WRITE解禁 → 1件だけ操作 → Gmail反映** の証跡が取れる
- [ ] すぐ **READ ONLY に戻せる（緊急停止が機能する）**
- [ ] SLA Alerts が **安全に**動く（secret必須 / dryRun導線 / truncated警告 / 失敗観測）

---

## 0) 本番用の前提チェック（設定・事故防止）

### 必須（最低限）
- [ ] `MAILHUB_ENV=production`
- [ ] `MAILHUB_READ_ONLY=1`（最初は必ず）
- [ ] `MAILHUB_TEST_MODE` は未設定（本番で使わない）
- [ ] `MAILHUB_ADMINS`（CSVでadminユーザー、`@vtj.co.jp`）
- [ ] `MAILHUB_TEAM_MEMBERS`（CSVでstaffユーザー、`@vtj.co.jp`、最低1名）
- [ ] `NEXTAUTH_URL`（本番HTTPS URL、localhost不可）
- [ ] `NEXTAUTH_SECRET`（本番用、GitHub Actions secret）
- [ ] `GOOGLE_CLIENT_ID`（GitHub Actions variable）
- [ ] `GOOGLE_SHARED_INBOX_EMAIL`（GitHub Actions variable）
- [ ] `GOOGLE_CLIENT_SECRET`（GitHub Actions secret）
- [ ] `GOOGLE_SHARED_INBOX_REFRESH_TOKEN`（GitHub Actions secret）

### 推奨（永続化）
- [ ] `MAILHUB_CONFIG_STORE=sheets`
- [ ] `MAILHUB_ACTIVITY_STORE=sheets`
- [ ] `MAILHUB_SHEETS_ID` または `MAILHUB_SHEETS_SPREADSHEET_ID`（GitHub Actions variable）
- [ ] `MAILHUB_SHEETS_CLIENT_EMAIL`（GitHub Actions variable）
- [ ] `MAILHUB_SHEETS_PRIVATE_KEY`（GitHub Actions secret）
- [ ] `MAILHUB_SHEETS_TAB_RULES=ConfigRules`（任意、変更する場合のみ）
- [ ] `MAILHUB_SHEETS_TAB_ASSIGNEE_RULES=ConfigAssigneeRules`（任意、変更する場合のみ）

### GitHub Actions source policy（readiness contract基準）
- GitHub Actions secrets: `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_SHARED_INBOX_REFRESH_TOKEN`, `MAILHUB_SHEETS_PRIVATE_KEY`
- GitHub Actions variables: `MAILHUB_ENV`, `NEXTAUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_SHARED_INBOX_EMAIL`, `MAILHUB_ADMINS`, `MAILHUB_TEAM_MEMBERS`, `MAILHUB_CONFIG_STORE`, `MAILHUB_ACTIVITY_STORE`, `MAILHUB_SHEETS_ID`/`MAILHUB_SHEETS_SPREADSHEET_ID`, `MAILHUB_SHEETS_CLIENT_EMAIL`, `MAILHUB_READ_ONLY`
- Routing proof workflow は別途 `GOOGLE_CLIENT_ID` / `GOOGLE_SHARED_INBOX_EMAIL` を secrets として読むため、同名 secret が残っていても staff runtime の primary source は variables として検証する

### Alerts（本番運用）
- [ ] `MAILHUB_ALERTS_SECRET`（必須・長いランダム値）
- [ ] `SLACK_WEBHOOK_URL`（使うなら）

### Preflight（値は出さない）
```bash
npm run setup:mailhub-staff-github-config -- \
  --out .ai-runs/mailhub-next-phase/mailhub-staff-github-config-plan.json
npm run audit:github-staff-secrets -- --no-fail \
  --out .ai-runs/mailhub-next-phase/github-staff-secrets-readiness.json
npm run audit:github-staff-secrets-contract
```

---

## 1) Production を READ ONLY でデプロイ（最初の安全状態）

### Healthで確認（まずこれ）
ブラウザで：
- `https://<PROD_URL>/api/mailhub/config/health`

確認するキー：
- [ ] `env: "production"`
- [ ] `readOnly: true`
- [ ] `isAdmin: true`（adminで見ている時）
- [ ] `writeGuards` が期待どおり表示されている（readOnly/admin/storeType等）
- [ ] `configStore.resolved` / `activityStore.resolved` が期待どおり（推奨: `sheets`）

証跡（meta）
- [ ] `docs/pilot/prod/mailhub-meta-topbar-readonly.png`
- [ ] `docs/pilot/prod/mailhub-meta-health-readonly.png`
- [ ] `docs/pilot/prod/staff-workflow-evidence-manifest.json` に READ ONLY確認者と上記2ファイル名を記録

---

## 2) READ ONLY 人間QA（5分）

全部「触って」確認：
- [ ] 一覧が出る（Todo/Waiting/Done/Muted/Assignee）
- [ ] 詳細が開く（本文が読める / Open in GmailもOK）
- [ ] Activity Drawerが開ける（閲覧OK）
- [ ] CSV Exportができる（Activity Export）
- [ ] 変更系（Archive/Mute/Waiting/Assign等）が **UIで押せない**（disable理由が出る）

### APIでも403になることを確認（adminでもREAD ONLYなら403）
（どれか1つでOK）
- [ ] `POST /api/mailhub/archive` を叩くと 403（READ ONLY）
- [ ] `POST /api/mailhub/assign` を叩くと 403（READ ONLY）

証跡（任意だが推奨）
- [ ] `docs/pilot/prod/mailhub-meta-readonly-403.png`（403が分かる画面）

---

## 3) admin短時間WRITE解禁（1件だけ）→証跡→即READ ONLY復帰

### 解禁（短時間だけ）
- [ ] Production の環境変数で **一時的に `MAILHUB_READ_ONLY=0`** にして再デプロイ
- [ ] TopHeaderで確認：READ ONLYバッジが消えている

証跡（meta）
- [ ] `docs/pilot/prod/mailhub-meta-topbar-write.png`

### 対象メッセージのmessageId取得
- MailHubのURL `?id=<messageId>` からコピー（または DevTools > Network の `/api/mailhub/detail?id=...`）

記入：
- messageId: `________________________`

### 操作（1件だけ）
以下から **1つだけ**選び、1回だけ実行：
- [ ] Assign（おすすめ）
- [ ] Waiting（Activity action: `setWaiting`）
- [ ] Archive（UI上のDone/対応済み操作）
- [ ] Mute

action（ファイル名用）：
- action: `assign | setWaiting | archive | mute`

### 証跡（Step27互換）
- [ ] Gmail側：`docs/pilot/prod/gmail-<messageId>-<action>.png`
- [ ] MailHub側：`docs/pilot/prod/mailhub-<messageId>-<action>.png`
- [ ] Activity CSV：`docs/pilot/prod/activity-<YYYYMMDD>-prod.csv`
- [ ] `docs/pilot/prod/staff-workflow-evidence-manifest.json` の `controlledWritePilot` に messageId、action、操作担当、上記3ファイル名を記録
- [ ] Activity CSV 内の controlled write（`assign` / `setWaiting` / `archive` / `mute`）は、上記1件だけになっている

### 復帰（必須）
- [ ] `MAILHUB_READ_ONLY=1` に戻して再デプロイ（緊急停止）
- [ ] TopHeaderで READ ONLYバッジが復活
- [ ] Healthで `readOnly: true` を再確認

証跡（meta）
- [ ] `docs/pilot/prod/mailhub-meta-topbar-back-to-readonly.png`
- [ ] `staff-workflow-evidence-manifest.json` の `controlledWritePilot.returnedToReadOnly` を `true` にする

---

## 4) SLA Alerts（本番運用の最初の型）

最初は **dryRun常用**でOK（壊さない運用）。

### 仕上げチェック
- [ ] `MAILHUB_ALERTS_SECRET` なしの叩き方は 401/403 になる
- [ ] dryRunで結果が返る（通知は送られない/またはpreviewのみ）
- [ ] `truncated: true` の場合は warning がSlack/Activityに残る
- [ ] 失敗（5xx/timeout）は観測できる（GitHub Actions / Activity / Slack 等）

---

## 🧾 実施結果（ここを埋めれば第三者レビュー可能）

### 実施サマリ
- Date:
- Prod URL:
- Admin user:
- READ ONLY開始: OK
- WRITE一時解禁: OK
- 操作（1件だけ）:
- messageId:
- READ ONLY復帰: OK

### 証跡ファイル（保存した実ファイル名を記入）
- meta（READ ONLY）: `docs/pilot/prod/mailhub-meta-topbar-readonly.png`
- meta（health）: `docs/pilot/prod/mailhub-meta-health-readonly.png`
- Gmail側: `docs/pilot/prod/gmail-<messageId>-<action>.png`
- MailHub側: `docs/pilot/prod/mailhub-<messageId>-<action>.png`
- Activity CSV: `docs/pilot/prod/activity-<YYYYMMDD>-prod.csv`
- meta（WRITE）: `docs/pilot/prod/mailhub-meta-topbar-write.png`
- meta（復帰）: `docs/pilot/prod/mailhub-meta-topbar-back-to-readonly.png`
- manifest: `docs/pilot/prod/staff-workflow-evidence-manifest.json`

### manifest雛形

手書きより先に、次のCLIで生成してください。

```bash
npm run setup:mailhub-staff-manifest -- \
  --captured-by admin@vtj.co.jp \
  --staff-email staff@vtj.co.jp \
  --actor-email staff@vtj.co.jp \
  --message-id message-id \
  --action assign \
  --date 20260617
```

```json
{
  "schema": "mailhub.staff-workflow-evidence.v1",
  "capturedAt": "2026-06-17T00:00:00.000Z",
  "capturedBy": "admin@vtj.co.jp",
  "environment": "production",
  "readOnlyRollout": {
    "readOnly": true,
    "mailhubTopbar": "mailhub-meta-topbar-readonly.png",
    "mailhubHealth": "mailhub-meta-health-readonly.png",
    "verifiedStaffEmails": ["staff@vtj.co.jp"]
  },
  "controlledWritePilot": {
    "messageId": "message-id",
    "action": "assign",
    "actorEmail": "staff@vtj.co.jp",
    "mailhubWriteTopbar": "mailhub-meta-topbar-write.png",
    "mailhubBackToReadOnlyTopbar": "mailhub-meta-topbar-back-to-readonly.png",
    "activityCsv": "activity-20260617-prod.csv",
    "gmailProof": "gmail-message-id-assign.png",
    "mailhubProof": "mailhub-message-id-assign.png",
    "returnedToReadOnly": true
  }
}
```
