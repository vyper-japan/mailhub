# brief: mailhub-d6-trap-detection (SS5 Quick)

- テーマ: MailHub destructive 6 項目 (D1-D6) の実行前 罠検出
- 目的: D1 Gmail token 再発行 / D2 send-as 15 alias 登録 / D3 本番 env 原子的 swap / D4 READ_ONLY 解除 / D5 MAILHUB_SEND_ENABLED=1 / D6 canary 送信 の各手順に潜む罠 (順序依存・不可逆点・rollback 不能点・暗黙前提・checklist 欠落・誤記) を全て洗い出し、Codex worker がそのまま遂行できる安全 checklist を作る
- 受け手: ①Codex GPT-5.5 worker (checklist 遂行者) ②のび太 (destructive 承認者) ③Fable PM (工程管理)
- 最終成果物の形式: Markdown。罠一覧 (重大度 P0/P1/P2 付き) + D1→D6 の安全遂行 checklist (前提確認 → dry-run → 1件 manual gate → 本実行 → 検証 → rollback 手順を各 D に)
- 制約:
  - read-only。Gmail / admin.google.com / Vercel / Lolipop への操作・API 呼び出しは一切禁止。git もread-onlyコマンドのみ
  - 正本 = /Users/takayukisuzuki/VYPER-Dev/Mailhub/.ai-runs/mailhub-next-phase/DESTRUCTIVE_6_READINESS.md (W1 修正済み・main マージ済み)
  - 関連参照: 同 dir の mailhub-production-readiness-audit.json / prod-send-enable-runbook 系 doc / app/api/mailhub/send/route.ts (fail-closed gate) / lib/mailhub-send-*.ts
  - 既知の確定事項: DWD scope は gmail.settings.sharing が正 (.basic は誤記として W1 で修正済みのはず — 要確認)、send-as は 15 件 (ams_vyper@ は受信専用で除外)、送信封鎖は MAILHUB_SEND_ENABLED=0、W7 承認依頼メールは 2026-07-03 送信済み (scope 承認はまだ)
  - 罠の判定は「READINESS.md に書いてあること」と「コード実体」の突合で行う。推測での指摘は P2 に落とし、根拠 (file:line) 必須
