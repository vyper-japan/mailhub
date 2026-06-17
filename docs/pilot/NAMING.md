# docs/pilot/ 証跡ファイル命名規約（Step27）

第三者が見ても「どのメールに、何をした証跡か」が一発で分かるよう、**必ずファイル名に `messageId` と `action`** を入れます。

## 推奨ファイル名（コピペで統一）
- Gmail側スクショ：`docs/pilot/gmail-<messageId>-<action>.png`
- MailHub側スクショ：`docs/pilot/mailhub-<messageId>-<action>.png`
- Activity CSV：`docs/pilot/activity-<date>-<env>.csv`

## action 例（おすすめ）
- `assign`
- `setWaiting`
- `mute`
- `archive`
- `readonly-health`

## 例
- `docs/pilot/gmail-18c4a9f3c2d1e7a3-archive.png`
- `docs/pilot/mailhub-18c4a9f3c2d1e7a3-archive.png`
- `docs/pilot/activity-20260107-local.csv`

## 補足（messageIdと紐づかない画面）
設定/Healthなど、特定のメールに紐づかないスクショは **`messageId=meta`** を使ってOKです。

- 例：`docs/pilot/mailhub-meta-readonly-health.png`

---

## Staging環境用（Step28以降）

staging環境での証跡は `docs/pilot/staging/` 配下に保存してください。

### 命名規約
- **段階解禁（Step29）/ メッセージに紐づく証跡（Step27互換）**
  - Gmail側スクショ：`docs/pilot/staging/gmail-<messageId>-<action>.png`
  - MailHub側スクショ：`docs/pilot/staging/mailhub-<messageId>-<action>.png`
  - Activity CSV：`docs/pilot/staging/activity-<date>-staging.csv`
- **メッセージに紐づかない証跡（meta）**
  - `docs/pilot/staging/mailhub-meta-<feature>.png`
  - `docs/pilot/staging/health-staging-YYYYMMDD.json`

### 例
- `docs/pilot/staging/gmail-18c4a9f3c2d1e7a3-assign.png`
- `docs/pilot/staging/mailhub-18c4a9f3c2d1e7a3-assign.png`
- `docs/pilot/staging/activity-20260107-staging.csv`
- `docs/pilot/staging/mailhub-meta-topbar-nonadmin.png`
- `docs/pilot/staging/health-staging-20260107.json`

詳細は `STAGING_QA_CHECKLIST.md` を参照してください。


---

## Production環境用（Step30）

production環境での証跡は `docs/pilot/prod/` 配下に保存してください。

### 命名規約

**形式A: Step27互換（推奨）**
- Gmail側スクショ：`docs/pilot/prod/gmail-<messageId>-<action>.png`
- MailHub側スクショ：`docs/pilot/prod/mailhub-<messageId>-<action>.png`
- Activity CSV：`docs/pilot/prod/activity-<YYYYMMDD>-prod.csv`

**形式B: タイムスタンプ付き（Step27互換の拡張）**
- Gmail側スクショ：`docs/pilot/prod/<messageId>_<action>_yyyymmdd-hhmm.png`
- MailHub側スクショ：`docs/pilot/prod/<messageId>_<action>_yyyymmdd-hhmm.png`
- 例：`docs/pilot/prod/18c4a9f3c2d1e7a3_assign_20260109-1430.png`

**メッセージに紐づかない証跡（meta）**
- `docs/pilot/prod/mailhub-meta-<feature>.png`
- 例：`docs/pilot/prod/mailhub-meta-health-readonly.png`

**スタッフ運用証跡manifest（必須）**
- `docs/pilot/prod/staff-workflow-evidence-manifest.json`
- 生成コマンド：`npm run setup:mailhub-staff-manifest -- --captured-by admin@vtj.co.jp --staff-email staff@vtj.co.jp --actor-email staff@vtj.co.jp --message-id <messageId> --action assign --date <YYYYMMDD>`
- `schema` は `mailhub.staff-workflow-evidence.v1`
- `capturedBy` / `readOnlyRollout.verifiedStaffEmails[]` / `controlledWritePilot.actorEmail` は `@vtj.co.jp`
- `environment` は `production`
- READ ONLY証跡は `readOnlyRollout.mailhubTopbar` と `readOnlyRollout.mailhubHealth` に実ファイル名を入れる
- WRITE 1件証跡は `controlledWritePilot.*` に messageId、action、Gmail/MailHubスクショ、Activity CSV、READ ONLY復帰フラグを入れる
- `controlledWritePilot.action` は Activity に記録される実アクション名（`assign` / `setWaiting` / `archive` / `mute`）に合わせる
- 監査では `controlledWritePilot.messageId` / `action` / `actorEmail` と Gmail/MailHub PNG ファイル名、Activity CSV 行の一致を確認し、Activity CSV 内の controlled write は1行だけ許可する

### 例

**形式A（推奨）**:
- `docs/pilot/prod/gmail-18c4a9f3c2d1e7a3-assign.png`
- `docs/pilot/prod/mailhub-18c4a9f3c2d1e7a3-assign.png`
- `docs/pilot/prod/activity-20260109-prod.csv`
- `docs/pilot/prod/mailhub-meta-topbar-readonly.png`
- `docs/pilot/prod/staff-workflow-evidence-manifest.json`

**形式B（タイムスタンプ付き）**:
- `docs/pilot/prod/18c4a9f3c2d1e7a3_assign_20260109-1430.png`
- `docs/pilot/prod/18c4a9f3c2d1e7a3_archive_20260109-1500.png`

詳細は `docs/pilot/PROD_WRITE_QA_CHECKLIST.md` を参照してください。
