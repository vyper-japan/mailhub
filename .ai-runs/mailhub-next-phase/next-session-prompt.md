# Prompt For New Session

MailHub の次フェーズを開始してください。

最初に以下を読んでください:

1. `AGENTS.md`
2. `.ai-runs/mailhub-next-phase/plan.md`
3. `.ai-runs/mailhub-next-phase/progress.md`
4. `.ai-runs/mailhub-next-phase/decisions.md`
5. `.ai-runs/mailhub-next-phase/blockers.md`
6. `.ai-runs/mailhub-next-phase/commands.md`
7. `.ai-runs/mailhub-next-phase/next.md`
8. `git status -sb`

重要方針:

- 大規模チームで贅沢にレビューする方針は維持する。
- ただしエージェントを無制限に同時起動して詰まらせない。
- 3-6並列の wave で回し、各 wave に timeout/watchdog を置く。
- エージェント wait/close がハングしたら、そのまま固まらずローカル実行へ切り替える。
- Esc 中断が起きたら、実行中プロセスと git 状態を確認して、最新の検証済み地点から復帰する。
- 30秒以上かかる作業では短い進捗報告を出す。

次の最優先タスク:

実データ/設定ベースで、楽天・Amazon・Yahoo・各ストアのメールアドレス/チャンネルが MailHub に全部入る設計・実装になっているかを監査し、抜けや検索条件の狭さがあれば修正してください。

直近の完了地点:

- commit `1987a6b Polish MailHub inbox density and attachments`
- pushed to `origin/main`
- unit 488 tests PASS
- targeted E2E 16 tests PASS with retries disabled
- build PASS
- tunnel URL: `https://hansen-bangkok-magnetic-projected.trycloudflare.com`

