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

1. 残り INBOX zero-estimate channels を実運用観点で確認する:
   `gopro-yahoo`, `vyperglobal-rakuten`, `vyperglobal-yahoo`, `ams-vyper`, `datacolor`, `ebay`
   - `gopro-yahoo`, `vyperglobal-rakuten`, `ams-vyper`, `datacolor`: active inbox 0 / all-mail historical hitsあり
   - `vyperglobal-yahoo`, `ebay`: active inbox 0 / all-mail fallback 0
   - latest source audit gate: `knownCodeGaps: []`, `codeCoveragePass: true`
2. 新規 default views (`invoice-docs`, `customer-inquiries`, `noise-candidates`) は `todo` ベースに変更済み。実データ監査では `invoice-docs` は 552件、`customer-inquiries`/`noise-candidates` は 1000件下限かつ続きあり。現状は automation queue ではなく manual-review shortcut として扱い、チューニングは operator feedback 後に行う
3. suppressive rule safety gate は explicit `messageIds` + `messageSummaries` 対応済み。summary 欠落時は fail closed。production auto-discard policy はまだ有効化せず、real-data validation 後に進める
4. Brain suggestion は selected message に対する read-only deterministic UI/API まで追加済み
5. Brain decision ledger は Activity/rule suggestions から分離した append-only memory/file/sheets store と `GET/POST /api/mailhub/brain/decisions` まで追加済み。`/api/mailhub/config/health` でも store/secret/Sheets 状態を見られる
6. 任意: production/staging実データで stores pagination の手動ブラウザ確認。forced E2E は追加済み

直近の完了地点:

- commit `5e0bead fix: verify MailHub pagination and Yahoo source coverage`
- completion-push commit: `fix: harden MailHub rule safety and audit views`
- brain suggestion commit: `feat: add read-only MailHub brain suggestions`
- brain ledger commit: `feat: add MailHub brain decision ledger`
- brain ledger health commit: `feat: expose MailHub brain ledger health`
- brain ledger sheets commit: `feat: support Sheets-backed MailHub brain ledger`
- source coverage gate commit: `fix: classify MailHub source coverage gaps`
- prior commit `16e703a fix: clarify MailHub source scope and rule safety`
- source coverage commits already present:
  - `0e9f358 fix: include AMS source in MailHub coverage`
  - `fdcd3ac fix: audit real Gmail source coverage`
- follow-on wave verification:
  - focused Vitest 6 files / 38 tests PASS
  - forced pagination E2E Step104-1 PASS
  - `npm run typecheck` PASS
  - `npm run lint` PASS
  - `npm run test` 53 files / 500 tests PASS
  - `npm run build` PASS
  - `npm run audit:gmail-sources -- --out .ai-runs/mailhub-next-phase/gmail-source-coverage-audit.json --max-pages 3` PASS with corrected INBOX scope
- completion-push wave verification:
  - focused Vitest 3 files / 12 tests PASS
  - `npm run typecheck` PASS
  - `npm run audit:gmail-views -- --out .ai-runs/mailhub-next-phase/gmail-default-views-audit.json --max-pages 10` PASS
  - `git diff --check` PASS
  - `npm run lint` PASS
  - `npm run test` 53 files / 502 tests PASS
  - `npm run build` PASS
- brain suggestion wave verification:
  - focused Vitest 4 files / 58 tests PASS
  - `npm run typecheck` PASS
  - `npm run lint` PASS
  - `git diff --check` PASS
  - `npm run test` 55 files / 507 tests PASS
  - `npm run build` PASS
- brain ledger wave verification:
  - focused Vitest 4 files / 11 tests PASS
  - `npm run typecheck` PASS
  - `npm run lint` PASS
  - `git diff --check` PASS
  - `npm run test` 57 files / 513 tests PASS
  - `npm run build` PASS
  - post-fix focused Vitest 2 files / 6 tests PASS
  - post-fix `npm run typecheck` PASS
- brain ledger health wave verification:
  - focused Vitest 3 files / 15 tests PASS
  - `npm run typecheck` PASS
  - `npm run lint` PASS
  - `git diff --check` PASS
  - `npm run test` 57 files / 514 tests PASS
  - `npm run build` PASS
- brain ledger sheets wave verification:
  - focused Vitest 3 files / 18 tests PASS
  - `npm run typecheck` PASS
  - `npm run lint` PASS
  - `git diff --check` PASS
  - `npm run test` 57 files / 517 tests PASS
  - `npm run build` PASS
- source coverage gate wave verification:
  - `npm run audit:gmail-sources -- --out .ai-runs/mailhub-next-phase/gmail-source-coverage-audit.json --max-pages 3` PASS
  - latest audit generatedAt `2026-06-17T00:08:49.123Z`
  - `zeroEstimateAnalysis.knownCodeGaps` empty
  - `zeroEstimateAnalysis.coverageGate.codeCoveragePass` true
  - `zeroEstimateAnalysis.noEvidenceOperationalFollowups`: `vyperglobal-yahoo`, `ebay`
- build PASS
- tunnel URL: `https://hansen-bangkok-magnetic-projected.trycloudflare.com`
