# MailHub Next Phase Next Actions

## 2026-06-27 Resume Here: T2 destructive 解禁 or MX 切替段取り

Lolipop → mailhub@ 集約構造は完成。次は本丸の **T2 destructive 6項目** または **MX 切替段取り** のどちらかから着手する。CoWork 待ちは不要。

### 現在地（2026-06-27 13:00 JST）
- ✅ routing 17 channel × 12 Lolipop アドレス全てに mailhub@ 経路接続済み
- ✅ mailhub@ User INBOX 直接到達 5/5 実証（SA DWD impersonation 経由、Spam 行きゼロ）
- ✅ Amazon 系（cricut_sc / gopro_mp / akgstore 等）バイヤーメッセージ既に大量到達確認済
- ✅ コミット `26e4931` で origin/main 反映

### 次の選択肢

#### B. T2 destructive 6項目の runbook 起案
- 実送信解禁 / refresh token 再発行 / send-as 15登録 / その他
- 各項目の approval gate / 順序 / rollback 設計
- 実行はのび太 explicit approval 後

#### C. MX 切替段取り起案
- lolipop.jp MX → Google Workspace 直受
- 前提: T2 完了 + MailDealer 解約段取り確定
- SPF/DKIM/DMARC 更新（spf.makeshop.jp 必須、Phase2 調査で既出）

### デバッグ初手（mailhub@ INBOX 確認）
```bash
python3 <<'PY'
from google.oauth2 import service_account
from googleapiclient.discovery import build
SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
creds = service_account.Credentials.from_service_account_file(
    "/Users/takayukisuzuki/.config/gcloud/ec-data-hub-sa-key.json", scopes=SCOPES
).with_subject("mailhub@vtj.co.jp")
svc = build("gmail", "v1", credentials=creds, cache_discovery=False)
resp = svc.users().messages().list(userId="me", q="<query>", maxResults=30).execute()
print(resp.get("messages", []))
PY
```

### Hard Gates（継続）
- vyper_r@ 触らない
- 既存転送先削除しない、追加のみ
- destructive 6項目はのび太 explicit approval なしに実行禁止
- GitHub Secrets / Sheets / 本番 apply 系は承認なしに実行しない
- 「本番完了」と言わず必ず再送・到達確認まで行う

### 関連ファイル
- 引き継ぎ正本: `.ai-runs/mailhub-next-phase/NEXT_SESSION_HANDOFF.md`
- 進捗ログ: `.ai-runs/mailhub-next-phase/progress.md`
- blockers: `.ai-runs/mailhub-next-phase/blockers.md`
- memory: `~/.claude/projects/-Users-takayukisuzuki-VYPER-Dev-Mailhub/memory/project_mailhub_routing.md`
