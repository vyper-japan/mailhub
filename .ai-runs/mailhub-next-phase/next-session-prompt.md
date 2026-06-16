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

今回の next-phase wave のコミットを確認し、以下を続けてください:

1. INBOX-scoped audit の zero-estimate channels を実運用観点で確認する:
   `cricut-yahoo`, `gopro-yahoo`, `vyperglobal-rakuten`, `vyperglobal-yahoo`, `ams-vyper`, `datacolor`, `ebay`
2. `stores` の強制ページングE2E/browser checkを追加する:
   first page with `nextPageToken`, second page append, visible partial-list warning, support bundle list diagnostics
3. 新規 default views (`invoice-docs`, `customer-inquiries`, `noise-candidates`) を実データでチューニングする
4. suppressive rule safety gate は入ったが、production auto-discard policy はまだ有効化せず、real-data validation 後に進める

直近の完了地点:

- commit TBD: next-phase source visibility and rule safety wave
- source coverage commits already present:
  - `0e9f358 fix: include AMS source in MailHub coverage`
  - `fdcd3ac fix: audit real Gmail source coverage`
- latest wave verification:
  - focused Vitest 6 files / 38 tests PASS
  - `npm run typecheck` PASS
  - `npm run lint` PASS
  - `npm run test` 53 files / 500 tests PASS
  - `npm run build` PASS
  - `npm run audit:gmail-sources -- --out .ai-runs/mailhub-next-phase/gmail-source-coverage-audit.json --max-pages 3` PASS with corrected INBOX scope
- build PASS
- tunnel URL: `https://hansen-bangkok-magnetic-projected.trycloudflare.com`
