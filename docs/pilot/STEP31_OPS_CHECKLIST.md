# Step31 Ops Hardening（Config Backup/Export + Help/Diagnostics）

このチェックリストは「困ったら自分で切り分け→バックアップ→復旧導線」までを、最短で確認するためのものです。

---

## ✅ Done（合格条件）
- [ ] adminが **Config Export（秘密なし）** をUIから実行できる
- [ ] GitHub Actions（Bearer secret）で **Config Export** を実行できる（セッション不要）
- [ ] Help/Diagnostics Drawerで **health + version** を一括コピーして共有できる
- [ ] `qa:strict` が **2回連続PASS**

---

## 1) UI（admin）: Config Export
- [ ] MailHubにadminでログイン
- [ ] 歯車（Settings）を開く
- [ ] フッターの **Config Export** をクリック
- [ ] `mailhub-config-<env>-<timestamp>.json` がダウンロードされる

保存先（推奨）:
- `docs/pilot/<env>/config-export-<YYYYMMDD-HHmmss>.json`（任意）

確認（中身）:
- [ ] `labels` / `rules` が入っている
- [ ] secret/refresh token/webhook などの機微情報が入っていない

---

## 2) Help/Diagnostics Drawer（問い合わせテンプレ）
- [ ] ヘッダーの **Info（Diagnostics）** をクリック
- [ ] **Health** と **Version** が表示される
- [ ] **まとめてコピー** が押せる

困った時の共有:
- [ ] まとめてコピー → Slack/チャットに貼り付けて共有できる

---

## 3) GitHub Actions（Bearer secret）: Config Export

前提:
- [ ] `MAILHUB_CONFIG_EXPORT_SECRET` を本番環境に設定済み
- [ ] GitHub Actions側にも同じsecretを設定済み

実行:
- [ ] Actionsの手動実行で Config Export が成功
- [ ] artifact（json）が保存される

---

## 4) 復旧導線（Import Preview→Apply）

注: Importは **READ ONLYでは不可**、adminのみ実行可能。

- [ ] Settingsフッターの **Import Preview** が動く
- [ ] Preview結果が出る（add/update件数）
- [ ] 必要なら **Import Apply** が実行できる（confirmあり）

